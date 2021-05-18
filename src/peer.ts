import { Observable, Subject } from 'rxjs';
import SimplePeer, { Instance as Peer, Options, SignalData } from 'simple-peer';
import { io, Socket } from 'socket.io-client';
import { Encoding } from './encoding';

/** config of peers */
export interface PeersConfig {
    /** a friendly name for this peer */
    label?: string;
    /** url of api connection, defaults to `location.origin` */
    url?: string;
    /** user token */
    token: string;
    /** room id */
    room: string;
    /** 编解码消息 */
    encoding?: (this: Peers) => Encoding;
    /** WRTC 实现 */
    wrtc?: Options['wrtc'];
}

/** 默认URL */
function getDefaultUrl(): string {
    if (typeof location == 'undefined') {
        throw new Error(`'url' must specified in nodejs`);
    }
    return location.origin;
}

/** P2P connection */
export class Peers {
    constructor(readonly config: PeersConfig) {
        const url = (config.url ??= getDefaultUrl());
        this.encoding = config.encoding?.call(this) ?? new Encoding();

        this._socket = io(url, {
            path: '/socket.io/peers',
            auth: {
                token: config.token,
                room: config.room,
                label: config.label,
            },
        });

        this._socket.on('prepare', ({ sockets, iceServers }) => {
            for (const id in sockets) {
                this._labels.set(id, (sockets as Record<string, string>)[id]);
                if (id === this._socket.id) continue;
                this._rtcConfig = {
                    iceServers: iceServers as RTCIceServer[],
                };

                if (!this._peers.has(id)) {
                    this._createPeer(id, true);
                }
            }
        });

        this._socket.on('signal', (source, data) => {
            let peer = this._peers.get(source);
            if (!peer) {
                peer = this._createPeer(source);
            }
            const d = data as SignalData & { label?: string };
            peer.signal(d);
            this._labels.set(source, d.label);
        });

        this._socket.on('error', (err: { data: string }) => {
            this._data.error(new Error(err.data));
            this.destroy();
        });
    }
    /** 编解码消息 */
    protected readonly encoding: Encoding;

    /** socket for signaling */
    private readonly _socket: Socket;
    /** Created p2p connection */
    private readonly _peers = new Map<string, Peer>();
    /** Created p2p connection */
    private readonly _labels = new Map<string, string | undefined>();
    /** config of rtc connection */
    private _rtcConfig: RTCConfiguration = {};
    /** 收到数据 */
    private _data = new Subject<{ sender: string; message: unknown }>();
    /** 自己的 ID */
    get id(): string {
        return this._socket.id;
    }
    /** 链接的 ID */
    get peers(): string[] {
        return [...this._peers.keys()];
    }

    /** 链接的标签 */
    labelOf(id: string): string {
        const label = this._labels.get(id);
        return label ?? id;
    }

    /** 收到数据 */
    get data(): Observable<{ sender: string; message: unknown }> {
        return this._data.asObservable();
    }

    /** create peer connection, add to peers */
    private _createPeer(id: string, initiator = false): Peer {
        const peer = new SimplePeer({
            initiator,
            config: this._rtcConfig,
            objectMode: true,
            wrtc: this.config.wrtc,
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
    protected _onPeerData(sender: string, data: Uint8Array): void {
        const message = this.encoding.onMessage(sender, data);
        if (message == null) return;
        this._data.next(message);
    }

    /** 结束 */
    destroy(): void {
        this._socket.close();
        for (const peer of this._peers.values()) {
            peer.destroy();
        }
        this._peers.clear();
        this.encoding.destroy();
    }

    /** 发送数据的实现 */
    protected async _send(chunks: Uint8Array[], receiver: Peer): Promise<void> {
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
        const chunks = this.encoding.encode(data);
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
