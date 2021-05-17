import { UbjsonEncoder, UbjsonDecoder } from '@shelacek/ubjson';

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

/** 编解码消息 */
export class Encoding {
    /** 消息计数器 */
    protected messageCounter = 1;
    /** 缓存收到的数据 */
    protected cache = new Map<string, Array<ArrayBuffer | false>>();
    /** 编码 */
    encode(data: unknown): ArrayBuffer[] {
        const buffer = encoder.encode(data);
        if (buffer.byteLength > MAX_LEN * MAX_CHUNK) throw new Error(`Message is too large`);
        const messageId = this.messageCounter++;
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
    decode(chunks: ArrayBuffer[]): unknown {
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

    /** 收到消息时调用以存储消息 */
    onMessage(sender: string, chunk: ArrayBuffer): { sender: string; message: unknown } | undefined {
        const reader = new DataView(chunk);
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
            const message = this.decode(cache as ArrayBuffer[]);
            this.cache.delete(cacheKey);
            return { sender, message };
        }
        return undefined;
    }

    /** 清理实例 */
    destroy(): void {
        this.cache.clear();
    }
}
