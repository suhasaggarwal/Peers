import { encode, decode } from '@cloudpss/ubjson';
import type { Promisable } from 'type-fest';

/** 单个消息分片大小上限，不包括消息头 */
const MAX_LEN = 15 * 1024;
/** 消息头大小 */
const HEADER_SIZE = 8;
/** 单个消息分片数量上限 */
const MAX_CHUNK = 65535;

/** 转为 DataView */
function getView(chunk: Uint8Array): DataView {
    return new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
}

/** 编解码消息 */
export interface Encoding {
    /** 编码 */
    encode(data: unknown): Promisable<Uint8Array[]>;
    /** 解码 */
    decode(chunks: Uint8Array[]): Promisable<unknown>;
    /** 收到消息时调用以存储消息 */
    onMessage(sender: string, chunk: Uint8Array): Promise<{ sender: string; message: unknown } | undefined>;
    /** 清理实例 */
    destroy(): void;
}

/** 编解码消息 */
export class DefaultEncoding implements Encoding {
    /** 消息计数器 */
    protected messageCounter = 1;
    /** 缓存收到的数据 */
    protected cache = new Map<string, Array<Uint8Array | false>>();
    /** 编码 */
    encode(data: unknown): Promisable<Uint8Array[]> {
        const buffer = encode(data);
        if (buffer.byteLength > MAX_LEN * MAX_CHUNK) throw new Error(`Message is too large`);
        const messageId = this.messageCounter++;
        const chunks = [];
        const chunkCount = Math.ceil(buffer.byteLength / MAX_LEN);
        for (let i = 0; i < chunkCount; i++) {
            const start = MAX_LEN * i;
            const end = chunkCount - 1 === i ? buffer.byteLength : MAX_LEN * (i + 1);
            // | message id (4) | chunk id (2) | chunk count (2) | data |
            const chunk = new Uint8Array(HEADER_SIZE + end - start);
            const writer = getView(chunk);
            writer.setUint32(0, messageId);
            writer.setUint16(4, i);
            writer.setUint16(6, chunkCount);
            chunk.set(buffer.subarray(start, end), HEADER_SIZE);
            chunks.push(chunk);
        }
        return chunks;
    }

    /** 解码 */
    decode(chunks: Uint8Array[]): Promisable<unknown> {
        if (chunks.length === 0) throw new Error(`Chunks is empty`);
        if (chunks.length > MAX_CHUNK) throw new Error(`Too many chunks`);
        const chunkLast = chunks[chunks.length - 1];
        const reader = getView(chunkLast);
        const messageId = reader.getUint32(0);
        const chunkCount = reader.getUint16(6);
        if (chunkCount !== chunks.length) throw new Error(`Invalid chunk count`);

        const length = chunks.reduce((sum, chunk) => sum + (chunk.byteLength - HEADER_SIZE), 0);
        const buffer = new Uint8Array(length);
        let ptr = 0;
        for (let i = 0; i < chunkCount; i++) {
            // | message id (4) | chunk id (2) | chunk count (2) | data |
            const chunk = chunks[i];
            const reader = getView(chunk);
            const myMessageId = reader.getUint32(0);
            const myIndex = reader.getUint16(4);
            const myChunkCount = reader.getUint16(6);
            if (myMessageId !== messageId || myIndex !== i || myChunkCount !== chunkCount) {
                throw new Error(`Invalid chunk at index ${i}`);
            }
            const data = chunk.subarray(HEADER_SIZE);
            buffer.set(data, ptr);
            ptr += data.byteLength;
        }
        return decode(buffer);
    }

    /** 收到消息时调用以存储消息 */
    async onMessage(sender: string, chunk: Uint8Array): Promise<{ sender: string; message: unknown } | undefined> {
        const reader = getView(chunk);
        const messageId = reader.getUint32(0);
        const chunkId = reader.getUint16(4);
        const chunkCount = reader.getUint16(6);
        const cacheKey = `${sender}::${messageId}`;
        let cache = this.cache.get(cacheKey);
        if (!cache) {
            cache = [];
            cache.length = chunkCount;
            cache.fill(false);
            this.cache.set(cacheKey, cache);
        }
        if (cache.length !== chunkCount) {
            throw new Error(`Invalid chunk from ${sender}`);
        }
        cache[chunkId] = chunk;
        if (!cache.includes(false)) {
            const message = await this.decode(cache as Uint8Array[]);
            this.cache.delete(cacheKey);
            return { sender, message };
        }
        return undefined;
    }

    /** 清理实例 */
    destroy(): void {
        // DO nothing
    }
}
