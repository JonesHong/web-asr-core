import { ConfigManager } from './config-manager';

/**
 * AudioChunker - 音訊分塊處理器
 * 
 * 負責將連續的音訊流切割成固定大小的塊
 * 處理剩餘樣本的暫存和合併
 * 支援重疊（overlap）以保持連續性
 */
export class AudioChunker {
    private remainder: Float32Array;
    private chunkSize: number;
    private overlap: number;
    private overlapBuffer: Float32Array | null = null;
    private serviceType?: 'vad' | 'wakeword' | 'whisper';

    /**
     * @param chunkSize 每個塊的大小（樣本數）
     * @param overlap 重疊樣本數（用於保持連續性，預設為 0）
     * @param serviceType 服務類型，用於從 ConfigManager 取得預設值
     * @param config 可選的配置管理器實例
     */
    constructor(
        chunkSize?: number,
        overlap?: number,
        serviceType?: 'vad' | 'wakeword' | 'whisper',
        config: ConfigManager = ConfigManager.getInstance()
    ) {
        this.serviceType = serviceType;
        
        // 如果指定了服務類型，從配置取得預設值
        if (serviceType && !chunkSize && !overlap) {
            const serviceConfig = config.audio.chunker[serviceType];
            this.chunkSize = serviceConfig.chunkSize;
            this.overlap = serviceConfig.overlap;
        } else {
            // 使用提供的參數或預設值
            this.chunkSize = chunkSize ?? 512;
            this.overlap = overlap ?? 0;
        }
        
        this.overlap = Math.min(this.overlap, this.chunkSize - 1); // 重疊不能超過塊大小
        this.remainder = new Float32Array(0);
        
        if (this.overlap > 0) {
            this.overlapBuffer = new Float32Array(this.overlap);
        }
    }
    
    /**
     * 從 ConfigManager 建立 VAD 專用的 Chunker
     */
    static forVAD(config: ConfigManager = ConfigManager.getInstance()): AudioChunker {
        return new AudioChunker(undefined, undefined, 'vad', config);
    }
    
    /**
     * 從 ConfigManager 建立 WakeWord 專用的 Chunker
     */
    static forWakeWord(config: ConfigManager = ConfigManager.getInstance()): AudioChunker {
        return new AudioChunker(undefined, undefined, 'wakeword', config);
    }
    
    /**
     * 從 ConfigManager 建立 Whisper 專用的 Chunker
     */
    static forWhisper(config: ConfigManager = ConfigManager.getInstance()): AudioChunker {
        return new AudioChunker(undefined, undefined, 'whisper', config);
    }

    /**
     * 將輸入音訊切割成固定大小的塊
     * @param input 輸入的音訊資料
     * @returns 切割好的音訊塊陣列
     */
    chunk(input: Float32Array): Float32Array[] {
        // 合併剩餘資料和新輸入
        const totalLength = this.remainder.length + input.length;
        const combined = new Float32Array(totalLength);
        combined.set(this.remainder, 0);
        combined.set(input, this.remainder.length);

        const chunks: Float32Array[] = [];
        let offset = 0;

        // 切割成固定大小的塊
        while (offset + this.chunkSize <= combined.length) {
            const chunk = new Float32Array(this.chunkSize);
            
            // 如果有重疊，加入之前的重疊資料
            if (this.overlap > 0 && this.overlapBuffer && chunks.length > 0) {
                // 複製重疊部分
                chunk.set(this.overlapBuffer, 0);
                // 複製新資料
                chunk.set(
                    combined.slice(offset, offset + this.chunkSize - this.overlap),
                    this.overlap
                );
            } else {
                // 無重疊，直接複製
                chunk.set(combined.slice(offset, offset + this.chunkSize));
            }

            chunks.push(chunk);

            // 保存這個塊的尾部作為下一個塊的重疊
            if (this.overlap > 0 && this.overlapBuffer) {
                const chunkEnd = offset + this.chunkSize;
                this.overlapBuffer.set(
                    combined.slice(chunkEnd - this.overlap, chunkEnd)
                );
            }

            offset += this.chunkSize - this.overlap;
        }

        // 保存剩餘的樣本
        this.remainder = combined.slice(offset);

        return chunks;
    }

    /**
     * 強制處理剩餘的資料（用於結束時）
     * @param padValue 填充值（預設為 0）
     * @returns 最後一個塊（可能包含填充）或 null
     */
    flush(padValue: number = 0): Float32Array | null {
        if (this.remainder.length === 0) {
            return null;
        }

        const finalChunk = new Float32Array(this.chunkSize);
        finalChunk.fill(padValue);
        
        // 如果有重疊資料，先填入
        let offset = 0;
        if (this.overlap > 0 && this.overlapBuffer) {
            finalChunk.set(this.overlapBuffer, 0);
            offset = this.overlap;
        }
        
        // 填入剩餘資料
        const copyLength = Math.min(this.remainder.length, this.chunkSize - offset);
        finalChunk.set(this.remainder.slice(0, copyLength), offset);
        
        // 清空剩餘資料
        this.remainder = new Float32Array(0);
        
        return finalChunk;
    }

    /**
     * 重置狀態
     */
    reset(): void {
        this.remainder = new Float32Array(0);
        if (this.overlapBuffer) {
            this.overlapBuffer.fill(0);
        }
    }

    /**
     * 獲取當前剩餘的樣本數
     */
    getRemainderSize(): number {
        return this.remainder.length;
    }

    /**
     * 獲取當前的剩餘資料（不會清除）
     */
    getRemainder(): Float32Array {
        return new Float32Array(this.remainder);
    }

    /**
     * 設定新的塊大小
     * @param newSize 新的塊大小
     * @param preserveRemainder 是否保留剩餘資料
     */
    setChunkSize(newSize: number, preserveRemainder: boolean = true): void {
        this.chunkSize = newSize;
        if (!preserveRemainder) {
            this.remainder = new Float32Array(0);
        }
        
        // 調整重疊大小
        this.overlap = Math.min(this.overlap, newSize - 1);
        if (this.overlap > 0) {
            this.overlapBuffer = new Float32Array(this.overlap);
        }
    }

    /**
     * 獲取配置資訊
     */
    getConfig(): {
        chunkSize: number;
        overlap: number;
        remainderSize: number;
    } {
        return {
            chunkSize: this.chunkSize,
            overlap: this.overlap,
            remainderSize: this.remainder.length
        };
    }

    /**
     * 預先計算需要多少個完整的塊
     * @param inputLength 輸入長度
     * @returns 可以產生的完整塊數量
     */
    calculateChunkCount(inputLength: number): number {
        const totalLength = this.remainder.length + inputLength;
        const effectiveChunkSize = this.chunkSize - this.overlap;
        
        if (totalLength < this.chunkSize) {
            return 0;
        }
        
        if (this.overlap > 0) {
            // 第一個塊需要完整大小，後續塊考慮重疊
            return 1 + Math.floor((totalLength - this.chunkSize) / effectiveChunkSize);
        } else {
            return Math.floor(totalLength / this.chunkSize);
        }
    }
}

/**
 * MultiChannelAudioChunker - 多通道音訊分塊處理器
 * 
 * 支援多個不同塊大小的並行處理
 * 適用於 VAD (512) 和 WakeWord (1280) 同時處理
 */
export class MultiChannelAudioChunker {
    private chunkers: Map<string, AudioChunker>;
    private config: ConfigManager;

    constructor(config: ConfigManager = ConfigManager.getInstance()) {
        this.chunkers = new Map();
        this.config = config;
    }

    /**
     * 註冊一個新的分塊通道
     * @param channelId 通道識別符
     * @param chunkSize 塊大小
     * @param overlap 重疊大小
     */
    registerChannel(channelId: string, chunkSize: number, overlap: number = 0): void {
        this.chunkers.set(channelId, new AudioChunker(chunkSize, overlap));
    }
    
    /**
     * 從 ConfigManager 註冊預設的服務通道
     * @param serviceType 服務類型 ('vad' | 'wakeword' | 'whisper')
     */
    registerServiceChannel(serviceType: 'vad' | 'wakeword' | 'whisper'): void {
        const chunker = new AudioChunker(undefined, undefined, serviceType, this.config);
        this.chunkers.set(serviceType, chunker);
    }
    
    /**
     * 註冊所有預設服務通道
     */
    registerAllDefaultChannels(): void {
        this.registerServiceChannel('vad');
        this.registerServiceChannel('wakeword');
        this.registerServiceChannel('whisper');
    }

    /**
     * 移除通道
     * @param channelId 通道識別符
     */
    removeChannel(channelId: string): void {
        this.chunkers.delete(channelId);
    }

    /**
     * 處理音訊並返回各通道的結果
     * @param input 輸入音訊
     * @returns 各通道的分塊結果
     */
    process(input: Float32Array): Map<string, Float32Array[]> {
        const results = new Map<string, Float32Array[]>();
        
        for (const [channelId, chunker] of this.chunkers) {
            // 每個 chunker 獨立處理同一份輸入
            results.set(channelId, chunker.chunk(input));
        }
        
        return results;
    }

    /**
     * 清空所有通道的剩餘資料
     * @param padValue 填充值
     * @returns 各通道的最後一塊
     */
    flushAll(padValue: number = 0): Map<string, Float32Array | null> {
        const results = new Map<string, Float32Array | null>();
        
        for (const [channelId, chunker] of this.chunkers) {
            results.set(channelId, chunker.flush(padValue));
        }
        
        return results;
    }

    /**
     * 重置所有通道
     */
    resetAll(): void {
        for (const chunker of this.chunkers.values()) {
            chunker.reset();
        }
    }

    /**
     * 獲取特定通道的 chunker
     * @param channelId 通道識別符
     */
    getChannel(channelId: string): AudioChunker | undefined {
        return this.chunkers.get(channelId);
    }

    /**
     * 獲取所有通道的狀態
     */
    getAllStats(): Map<string, any> {
        const stats = new Map();
        
        for (const [channelId, chunker] of this.chunkers) {
            stats.set(channelId, chunker.getConfig());
        }
        
        return stats;
    }
}

export default AudioChunker;