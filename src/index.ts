import { Observable, Subject } from 'rxjs';
import SimplePeer, { Instance as Peer } from 'simple-peer';
import { io, Socket } from 'socket.io-client';
import { UbjsonEncoder, UbjsonDecoder } from '@shelacek/ubjson';

/** config of peers */
export interface PeersConfig {
    /** url of api connection, defaults to `location.origin` */
    url?: string;
    /** user token */
    token: string;
    /** room id */
    room: string;
}

const encoder = new UbjsonEncoder({
    optimizeArrays: 'onlyTypedArrays',
    optimizeObjects: false,
});
const decoder = new UbjsonDecoder({
    int64Handling: 'raw',
    highPrecisionNumberHandling: 'raw',
    useTypedArrays: true,
});
/** 单个消息分片大小上限 */
const MAX_LEN = 15 * 1024;
/** 单个消息分片数量上限 */
const MAX_CHUNK = 65535;

/** P2P connection */
export class Peers {
    constructor(config: PeersConfig) {
        const url = config.url ?? location.origin;

        this._socket = io(url, {
            path: '/peers',
            auth: {
                token: config.token,
                room: config.room,
            },
        });

        this._socket.on('prepare', ({ sockets, iceServers }) => {
            for (const id of sockets) {
                if (id === this._socket.id) continue;
                this._rtcConfig = {
                    iceServers: iceServers as RTCIceServer[],
                };

                if (!this._peers.has(id)) {
                    this.createPeer(id, true);
                }
            }
        });

        this._socket.on('signal', (source, data) => {
            let peer = this._peers.get(source);
            if (!peer) {
                peer = this.createPeer(source);
            }
            peer.signal(data);
        });
    }

    /** socket for signaling */
    private readonly _socket: Socket;
    /** Created p2p connection */
    private readonly _peers = new Map<string, Peer>();
    /** 消息计数器 */
    private _messageCounter = 1;
    /** config of rtc connection */
    private _rtcConfig: RTCConfiguration = {};
    /** 收到数据 */
    private _data = new Subject<{ sender: string; data: unknown }>();
    /** 缓存收到的数据 */
    private _dataCache = new Map<string, Array<ArrayBuffer | false>>();
    /** 自己的 ID */
    get id(): string {
        return this._socket.id;
    }
    /** 链接的 ID */
    get peers(): string[] {
        return [...this._peers.keys()];
    }

    /** 收到数据 */
    get data(): Observable<{ sender: string; data: unknown }> {
        return this._data.asObservable();
    }

    /** create peer connection, add to peers */
    private createPeer(id: string, initiator = false): Peer {
        const peer = new SimplePeer({
            initiator,
            config: this._rtcConfig,
            objectMode: true,
        });
        this._peers.set(id, peer);

        peer.on('signal', (data) => {
            this._socket.emit('signal', id, data);
        });

        // peer.on('connect', () => {
        // });

        peer.on('close', () => {
            this._peers.delete(id);
        });

        peer.on('error', () => {
            this._peers.delete(id);
        });

        peer.on('data', (data) => {
            this._onPeerData(id, data);
        });
        return peer;
    }

    /** 数据回调 */
    private _onPeerData(id: string, data: ArrayBuffer): void {
        const reader = new DataView(data);
        const messageId = reader.getUint32(0);
        const chunkId = reader.getUint16(4);
        const chunkCount = reader.getUint16(6);
        const cacheKey = `${id}::${messageId}`;
        let cache = this._dataCache.get(cacheKey);
        if (!cache) {
            cache = [];
            cache.length = chunkCount;
            cache.fill(false);
            this._dataCache.set(cacheKey, cache);
        }
        if (cache.length !== chunkCount) {
            throw new Error(`Invalid chunk from ${id}`);
        }
        cache[chunkId] = data;
        if (!cache.includes(false)) {
            const message = this._decode(cache as ArrayBuffer[]);
            this._dataCache.delete(cacheKey);
            this._data.next({ sender: id, data: message });
        }
    }

    /** 编码 */
    protected _encode(data: unknown): ArrayBuffer[] {
        const buffer = encoder.encode(data);
        if (buffer.byteLength > MAX_LEN * MAX_CHUNK) throw new Error(`Message is too large`);
        const messageId = this._messageCounter++;
        const chunks = [];
        const chunkCount = Math.ceil(buffer.byteLength / MAX_LEN);
        for (let i = 0; i < chunkCount; i++) {
            const start = MAX_LEN * i;
            const end = chunkCount - 1 === i ? buffer.byteLength : MAX_LEN * (i + 1);
            // | message id (4) | chunk id (2) | chunk count (2) | data |
            const chunk = new ArrayBuffer(8 + end - start);
            const writer = new DataView(chunk);
            writer.setUint32(0, messageId);
            writer.setUint16(4, i);
            writer.setUint16(6, chunkCount);
            const view = new Uint8Array(chunk, 8);
            view.set(new Uint8Array(buffer, start, end - start));
            chunks.push(chunk);
        }
        return chunks;
    }

    /** 解码 */
    protected _decode(chunks: ArrayBuffer[]): unknown {
        if (chunks.length === 0) throw new Error(`Chunks is empty`);
        if (chunks.length > MAX_CHUNK) throw new Error(`Too many chunks`);
        const chunk0 = chunks[0];
        const reader = new DataView(chunk0);
        const messageId = reader.getUint32(0);
        const chunkCount = reader.getUint16(6);
        if (chunkCount !== chunks.length) throw new Error(`Invalid chunk count`);

        const buffer = new ArrayBuffer(chunkCount * MAX_LEN);
        for (let i = 0; i < chunkCount; i++) {
            const start = MAX_LEN * i;
            const end = chunkCount - 1 === i ? buffer.byteLength : MAX_LEN * (i + 1);
            // | message id (4) | chunk id (2) | chunk count (2) | data |
            const chunk = chunks[i];
            const reader = new DataView(chunk);
            const myMessageId = reader.getUint32(0);
            const myIndex = reader.getUint16(4);
            const myChunkCount = reader.getUint16(6);
            if (myMessageId !== messageId || myIndex !== i || myChunkCount !== chunkCount) {
                throw new Error(`Invalid chunk at index ${i}`);
            }
            const view = new Uint8Array(chunk, 8);
            new Uint8Array(buffer, start, end - start).set(view);
        }
        return decoder.decode(buffer);
    }

    /** 结束 */
    destroy(): void {
        this._socket.close();
        for (const peer of this._peers.values()) {
            peer.destroy();
        }
    }

    /** 发送数据的实现 */
    protected async _send(chunks: ArrayBuffer[], receiver: Peer): Promise<void> {
        for (const chunk of chunks) {
            await new Promise<void>((resolve, reject) => {
                receiver.write(chunk, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }
    }

    /** 发送数据 */
    async send(data: unknown, receivers?: readonly string[] | string): Promise<void> {
        const chunks = this._encode(data);
        let peers;
        if (!receivers) {
            peers = [...this._peers.values()];
        } else {
            peers = [];
            if (!Array.isArray(receivers as string[])) {
                receivers = [receivers as string];
            }
            for (const id of receivers) {
                const peer = this._peers.get(id);
                if (!peer) throw new Error(`Peer with id ${id} is not found`);
                peers.push(peer);
            }
        }
        await Promise.all(peers.map((peer) => this._send(chunks, peer)));
    }
}
