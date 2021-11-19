import type { Instance as Peer, SignalData } from 'simple-peer';
import { Observable, Subject } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { DefaultEncoding } from './encoding.js';
import type { Encoding } from './encoding.js';
import { wrtc, SimplePeer } from './polyfill.js';

/** Peers 配置 */
export interface PeersConfig {
    /** 当前 Peer 的名字 */
    label?: string;
    /** API 服务的 URL, 默认为 `` `${location.origin}/api/peers/` ``，在 nodejs 环境下必须设置 */
    url?: string;
    /** 用户 TOKEN */
    token: string;
    /** 房间 ID */
    room: string;
    /** 编解码消息 */
    encoding?: (instance: Peers) => Encoding | undefined;
    /** 调试输出 */
    logger?: (...args: unknown[]) => void;
}

/** 默认URL */
function getDefaultUrl(): string {
    if (typeof location != 'object') {
        throw new Error(`'url' must specified in nodejs`);
    }
    return `${location.origin}/api/peers/`;
}

/** P2P 连接 */
export class Peers {
    constructor(readonly config: PeersConfig) {
        this.logger =
            config.logger ??
            (() => {
                // noop
            });
        config.url ??= getDefaultUrl();
        const url = new URL(config.url ?? getDefaultUrl());
        if (url.pathname === '/' || url.pathname === '/api' || url.pathname === '/api/') {
            url.pathname = '/api/peers/';
        } else if (!url.pathname.endsWith('/')) {
            url.pathname += '/';
        }
        config.url = url.href;
        this.encoding = config.encoding?.(this) ?? new DefaultEncoding();

        this._socket = io(url.origin, {
            path: `${url.pathname}socket.io`,
            auth: {
                token: config.token,
                room: config.room,
                label: config.label,
            },
        });

        this._socket.on(
            'prepare',
            ({ sockets, iceServers }: { sockets: Record<string, string>; iceServers: RTCIceServer[] }) => {
                for (const id in sockets) {
                    // 记录连接的标签
                    this._labels.set(id, sockets[id]);
                    if (id === this._socket.id) continue;
                    this._rtcConfig = { iceServers };

                    if (!this._peers.has(id)) {
                        this._createPeer(id, true);
                    }
                }
            },
        );

        this._socket.on('signal', (source: string, data: SignalData & { label?: string }) => {
            let peer = this._peers.get(source);
            if (!peer) {
                peer = this._createPeer(source);
            }
            peer.signal(data);
            // 发来 signal 时更新标签
            if (data.label) {
                this._labels.set(source, data.label);
            }
        });

        this._socket.on('error', (err: { data: string }) => {
            this.logger('socket err', err);
            this._data.error(new Error(err.data || String(err)));
            this.destroy();
        });
    }
    /** 记录日志 */
    protected readonly logger: (...args: unknown[]) => void;
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
    /** 连接的其他 Peer 的 ID */
    get peers(): string[] {
        return [...this._peers.keys()];
    }

    /** Peer 的标签 */
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
            wrtc: wrtc,
        });
        this._peers.set(id, peer);

        peer.on('signal', (data) => {
            this._socket.emit('signal', id, data);
        });

        peer.on('connect', () => {
            this.logger('peer connected', id);
        });

        peer.on('close', () => {
            this.logger('peer close', id);
            this._peers.delete(id);
        });

        peer.on('error', (err) => {
            this.logger('peer error', id, err);
            this._peers.delete(id);
        });

        peer.on('data', (data) => {
            void this._onPeerData(id, data as Uint8Array);
        });
        return peer;
    }

    /** 数据回调 */
    protected async _onPeerData(sender: string, data: Uint8Array): Promise<void> {
        const message = await this.encoding.onMessage(sender, data);
        if (message == null) return;
        this._data.next(message);
    }

    /** 结束 */
    destroy(): void {
        this._socket.close();
        for (const peer of this._peers.values()) {
            peer.end();
        }
        this._peers.clear();
        this.encoding.destroy();
    }

    /** 发送数据的实现 */
    protected _send(chunks: Uint8Array[], receiver: Peer): void {
        for (const chunk of chunks) {
            receiver.write(chunk);
        }
    }

    /** 发送数据 */
    async send(data: unknown, receivers?: readonly string[] | string): Promise<void> {
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
        let chunks = this.encoding.encode(data);
        if (!Array.isArray(chunks)) {
            chunks = await chunks;
        }
        for (const peer of peers) {
            this._send(chunks, peer);
        }
    }
}
