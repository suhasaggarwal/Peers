import SimplePeer, { Instance as Peer } from 'simple-peer';
import { io, Socket } from 'socket.io-client';

/** config of peers */
export interface PeersConfig {
    /** url of api connection, defaults to `location.origin` */
    url?: string;
    /** user token */
    token: string;
    /** room id */
    room: string;
}

/** P2P connection */
export class Peers {
    constructor(config: PeersConfig) {
        const url = config.url ?? location.origin;

        this.socket = io(url, {
            path: '/peers',
            auth: {
                token: config.token,
                room: config.room,
            },
        });

        this.socket.on('prepare', ({ sockets, iceServers }) => {
            for (const id of sockets) {
                if (id === this.socket.id) continue;
                config = {
                    iceServers: iceServers as RTCIceServer[],
                };

                if (!this.peers.has(id)) {
                    this.createPeer(id, true);
                }
            }
        });

        this.socket.on('signal', (source, data) => {
            let peer = this.peers.get(source);
            if (!peer) {
                peer = this.createPeer(source);
            }
            peer.signal(data);
        });
    }

    /** socket for signaling */
    private readonly socket: Socket;
    /** Created p2p connection */
    private readonly peers = new Map<string, Peer>();
    /** config of rtc connection */
    private rtcConfig: RTCConfiguration = {};

    /** create peer connection, add to peers */
    private createPeer(id: string, initiator = false): Peer {
        const peer = new SimplePeer({
            initiator,
            config: this.rtcConfig,
            objectMode: true,
        });
        this.peers.set(id, peer);

        peer.on('signal', (data) => {
            this.socket.emit('signal', id, data);
        });

        peer.on('connect', () => {
            // console.log('CONNECT', id);
        });

        peer.on('close', () => {
            this.peers.delete(id);
            // console.log('CLOSED', id);
        });

        peer.on('error', (err) => {
            this.onPeerError(id, err);
            this.peers.delete(id);
        });

        peer.on('data', (data) => {
            this.onPeerData(id, data);
        });
        return peer;
    }

    /** 错误回调 */
    private onPeerError(id: string, err: Error): void {
        void id;
        void err;
    }

    /** 数据回调 */
    private onPeerData(id: string, data: ArrayBuffer): void {
        void id;
        void data;
    }
}
