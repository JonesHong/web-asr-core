import { ConfigManager } from './config-manager';

/**
 * AudioRingBuffer - 環形緩衝區for音訊資料 (Web Audio API 增強版)
 * 
 * 特點：
 * - 固定大小的環形緩衝區，避免無限增長
 * - 支援連續寫入和讀取
 * - 自動覆蓋舊資料（當緩衝區滿時）
 * - 線程安全（如果使用 SharedArrayBuffer）
 * - Web Audio API 整合功能
 */
export class AudioRingBuffer {
    private buffer: Float32Array;
    private capacity: number;
    private writePos: number = 0;
    private readPos: number = 0;
    private size: number = 0;
    private useSharedArrayBuffer: boolean;
    private audioContext?: AudioContext;
    private scriptProcessor?: ScriptProcessorNode;
    private audioWorklet?: AudioWorkletNode;
    
    /**
     * @param capacity 緩衝區容量（樣本數），預設從 ConfigManager 取得
     * @param useSharedArrayBuffer 是否使用 SharedArrayBuffer（for Web Worker），預設從 ConfigManager 取得
     * @param config 可選的配置管理器實例
     */
    constructor(
        capacity?: number,
        useSharedArrayBuffer?: boolean,
        config: ConfigManager = ConfigManager.getInstance()
    ) {
        // 使用提供的參數或從配置取得預設值
        this.capacity = capacity ?? config.audio.ringBuffer.capacity;
        this.useSharedArrayBuffer = useSharedArrayBuffer ?? config.audio.ringBuffer.useSharedArrayBuffer;

        if (this.useSharedArrayBuffer && typeof SharedArrayBuffer !== 'undefined') {
            const sharedBuffer = new SharedArrayBuffer(this.capacity * Float32Array.BYTES_PER_ELEMENT);
            this.buffer = new Float32Array(sharedBuffer);
        } else {
            this.buffer = new Float32Array(this.capacity);
        }
    }

    /**
     * 寫入音訊資料
     * @param samples 要寫入的音訊樣本
     * @returns 實際寫入的樣本數
     */
    write(samples: Float32Array): number {
        const samplesToWrite = samples.length;
        
        // 如果資料超過容量，只寫入最新的部分
        const actualWrite = Math.min(samplesToWrite, this.capacity);
        const startOffset = Math.max(0, samplesToWrite - this.capacity);
        
        for (let i = 0; i < actualWrite; i++) {
            this.buffer[this.writePos] = samples[startOffset + i];
            this.writePos = (this.writePos + 1) % this.capacity;
            
            if (this.size < this.capacity) {
                this.size++;
            } else {
                // 緩衝區滿了，移動讀取位置（覆蓋舊資料）
                this.readPos = (this.readPos + 1) % this.capacity;
            }
        }
        
        return actualWrite;
    }

    /**
     * 讀取音訊資料
     * @param length 要讀取的樣本數
     * @returns 讀取的音訊資料，如果資料不足返回 null
     */
    read(length: number): Float32Array | null {
        if (this.size < length) {
            return null;  // 資料不足
        }

        const result = new Float32Array(length);
        for (let i = 0; i < length; i++) {
            result[i] = this.buffer[this.readPos];
            this.readPos = (this.readPos + 1) % this.capacity;
            this.size--;
        }

        return result;
    }

    /**
     * 查看資料但不移動讀取位置
     * @param length 要查看的樣本數
     * @returns 音訊資料，如果資料不足返回 null
     */
    peek(length: number): Float32Array | null {
        if (this.size < length) {
            return null;
        }

        const result = new Float32Array(length);
        let peekPos = this.readPos;
        
        for (let i = 0; i < length; i++) {
            result[i] = this.buffer[peekPos];
            peekPos = (peekPos + 1) % this.capacity;
        }

        return result;
    }

    /**
     * 跳過指定數量的樣本
     * @param length 要跳過的樣本數
     * @returns 實際跳過的樣本數
     */
    skip(length: number): number {
        const actualSkip = Math.min(length, this.size);
        this.readPos = (this.readPos + actualSkip) % this.capacity;
        this.size -= actualSkip;
        return actualSkip;
    }

    /**
     * 獲取可用的樣本數
     */
    available(): number {
        return this.size;
    }

    /**
     * 獲取剩餘容量
     */
    remaining(): number {
        return this.capacity - this.size;
    }

    /**
     * 清空緩衝區
     */
    clear(): void {
        this.writePos = 0;
        this.readPos = 0;
        this.size = 0;
    }

    /**
     * 是否為空
     */
    isEmpty(): boolean {
        return this.size === 0;
    }

    /**
     * 是否已滿
     */
    isFull(): boolean {
        return this.size === this.capacity;
    }

    /**
     * 獲取緩衝區的狀態資訊
     */
    getStats(): {
        capacity: number;
        size: number;
        available: number;
        remaining: number;
        writePos: number;
        readPos: number;
        useSharedArrayBuffer: boolean;
    } {
        return {
            capacity: this.capacity,
            size: this.size,
            available: this.available(),
            remaining: this.remaining(),
            writePos: this.writePos,
            readPos: this.readPos,
            useSharedArrayBuffer: this.useSharedArrayBuffer
        };
    }

    /**
     * 讀取所有可用資料
     * @returns 所有可用的音訊資料
     */
    readAll(): Float32Array {
        const allData = new Float32Array(this.size);
        let readIndex = 0;
        
        while (this.size > 0) {
            allData[readIndex++] = this.buffer[this.readPos];
            this.readPos = (this.readPos + 1) % this.capacity;
            this.size--;
        }
        
        return allData;
    }

    /**
     * 從緩衝區獲取最新的 N 個樣本（不移動指針）
     * @param length 要獲取的樣本數
     * @returns 最新的音訊資料
     */
    getLatest(length: number): Float32Array | null {
        if (this.size < length) {
            return null;
        }

        const result = new Float32Array(length);
        // 計算起始位置（從寫入位置往回）
        let pos = (this.writePos - length + this.capacity) % this.capacity;
        
        for (let i = 0; i < length; i++) {
            result[i] = this.buffer[pos];
            pos = (pos + 1) % this.capacity;
        }

        return result;
    }
    
    /**
     * 獲取緩衝區容量
     */
    getCapacity(): number {
        return this.capacity;
    }
    
    /**
     * 連接到 Web Audio API 節點進行即時處理
     */
    async connectToAudioNode(
        audioContext: AudioContext,
        useWorklet: boolean = true
    ): Promise<AudioNode> {
        this.audioContext = audioContext;
        
        if (useWorklet && audioContext.audioWorklet) {
            // 使用 AudioWorklet（推薦）
            return this.createAudioWorklet();
        } else {
            // 降級到 ScriptProcessorNode
            return this.createScriptProcessor();
        }
    }
    
    /**
     * 創建 AudioWorklet 節點
     */
    private async createAudioWorklet(): Promise<AudioWorkletNode> {
        if (!this.audioContext) throw new Error('AudioContext not initialized');
        
        // 註冊 AudioWorklet 處理器
        await this.audioContext.audioWorklet.addModule(
            'data:application/javascript,' + encodeURIComponent(`
                class RingBufferProcessor extends AudioWorkletProcessor {
                    constructor(options) {
                        super();
                        this.bufferSize = options.processorOptions.bufferSize || 16000;
                        this.ringBuffer = new Float32Array(this.bufferSize);
                        this.writePos = 0;
                        this.readPos = 0;
                        this.size = 0;
                        
                        // 接收來自主線程的命令
                        this.port.onmessage = (event) => {
                            if (event.data.type === 'read') {
                                const data = this.read(event.data.length);
                                this.port.postMessage({ type: 'data', data });
                            }
                        };
                    }
                    
                    write(samples) {
                        for (let i = 0; i < samples.length; i++) {
                            this.ringBuffer[this.writePos] = samples[i];
                            this.writePos = (this.writePos + 1) % this.bufferSize;
                            if (this.size < this.bufferSize) {
                                this.size++;
                            } else {
                                this.readPos = (this.readPos + 1) % this.bufferSize;
                            }
                        }
                    }
                    
                    read(length) {
                        if (this.size < length) return null;
                        const result = new Float32Array(length);
                        for (let i = 0; i < length; i++) {
                            result[i] = this.ringBuffer[this.readPos];
                            this.readPos = (this.readPos + 1) % this.bufferSize;
                            this.size--;
                        }
                        return result;
                    }
                    
                    process(inputs, outputs, parameters) {
                        const input = inputs[0];
                        if (input.length > 0) {
                            const channelData = input[0];
                            this.write(channelData);
                            
                            // 通知主線程有新資料
                            this.port.postMessage({ 
                                type: 'buffer-updated', 
                                size: this.size 
                            });
                        }
                        return true;
                    }
                }
                
                registerProcessor('ring-buffer-processor', RingBufferProcessor);
            `)
        );
        
        this.audioWorklet = new AudioWorkletNode(
            this.audioContext,
            'ring-buffer-processor',
            {
                processorOptions: {
                    bufferSize: this.getCapacity()
                }
            }
        );
        
        return this.audioWorklet;
    }
    
    /**
     * 創建 ScriptProcessorNode（降級方案）
     */
    private createScriptProcessor(): ScriptProcessorNode {
        if (!this.audioContext) throw new Error('AudioContext not initialized');
        
        this.scriptProcessor = this.audioContext.createScriptProcessor(
            512,  // 緩衝區大小
            1,    // 輸入聲道數
            1     // 輸出聲道數
        );
        
        this.scriptProcessor.onaudioprocess = (event) => {
            const inputData = event.inputBuffer.getChannelData(0);
            // 寫入到 RingBuffer
            this.write(new Float32Array(inputData));
        };
        
        return this.scriptProcessor;
    }
    
    /**
     * 將 RingBuffer 資料轉換為 AudioBuffer（用於播放）
     */
    toAudioBuffer(audioContext: AudioContext, length?: number): AudioBuffer | null {
        const dataLength = length || this.available();
        const data = this.peek(dataLength);
        
        if (!data) return null;
        
        const audioBuffer = audioContext.createBuffer(
            1,                      // 單聲道
            data.length,            // 長度
            audioContext.sampleRate // 採樣率
        );
        
        // 複製資料到 AudioBuffer
        const channelData = audioBuffer.getChannelData(0);
        channelData.set(data);
        
        return audioBuffer;
    }
    
    /**
     * 從 AudioBuffer 寫入資料
     */
    fromAudioBuffer(audioBuffer: AudioBuffer, channelIndex: number = 0): number {
        const channelData = audioBuffer.getChannelData(channelIndex);
        return this.write(channelData);
    }
    
    /**
     * 使用 OfflineAudioContext 進行批次處理
     */
    async processOffline(
        processor: (context: OfflineAudioContext, buffer: AudioBuffer) => Promise<AudioNode>,
        outputSampleRate: number = 16000
    ): Promise<Float32Array> {
        const data = this.readAll();
        if (!data || data.length === 0) {
            return new Float32Array(0);
        }
        
        // 創建離線音訊上下文
        const offlineContext = new OfflineAudioContext(
            1,                  // 聲道數
            data.length,        // 長度
            outputSampleRate    // 採樣率
        );
        
        // 創建源緩衝區
        const sourceBuffer = offlineContext.createBuffer(1, data.length, outputSampleRate);
        const sourceChannelData = sourceBuffer.getChannelData(0);
        sourceChannelData.set(data);
        
        // 應用處理
        const processedNode = await processor(offlineContext, sourceBuffer);
        processedNode.connect(offlineContext.destination);
        
        // 渲染
        const renderedBuffer = await offlineContext.startRendering();
        return renderedBuffer.getChannelData(0);
    }
    
    /**
     * 使用 Web Audio API 進行重採樣
     */
    async resample(targetSampleRate: number): Promise<Float32Array> {
        const data = this.peek(this.available());
        if (!data) return new Float32Array(0);
        
        const currentSampleRate = 16000; // 假設當前是 16kHz
        const duration = data.length / currentSampleRate;
        const outputLength = Math.floor(duration * targetSampleRate);
        
        // 使用 OfflineAudioContext 進行重採樣
        const offlineContext = new OfflineAudioContext(
            1,
            outputLength,
            targetSampleRate
        );
        
        const sourceBuffer = offlineContext.createBuffer(
            1,
            data.length,
            currentSampleRate
        );
        const sourceChannelData = sourceBuffer.getChannelData(0);
        sourceChannelData.set(data);
        
        const source = offlineContext.createBufferSource();
        source.buffer = sourceBuffer;
        source.connect(offlineContext.destination);
        source.start();
        
        const renderedBuffer = await offlineContext.startRendering();
        return renderedBuffer.getChannelData(0);
    }
}

export default AudioRingBuffer;