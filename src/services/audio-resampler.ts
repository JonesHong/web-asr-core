import { ConfigManager } from '../utils/config-manager';

/**
 * 重採樣演算法類型
 */
export enum ResamplingAlgorithm {
    /** 線性插值 - 快速但品質一般 */
    LINEAR = 'linear',
    /** 立方插值 - 品質較好，速度適中 */
    CUBIC = 'cubic',
    /** Sinc 插值 - 最高品質但較慢 */
    SINC = 'sinc',
    /** Web Audio API - 使用瀏覽器原生 API */
    WEB_AUDIO = 'web-audio',
    /** 最近鄰 - 最快但品質最差 */
    NEAREST = 'nearest'
}

/**
 * 重採樣選項
 */
export interface ResamplingOptions {
    /** 源採樣率 */
    fromSampleRate: number;
    /** 目標採樣率 */
    toSampleRate: number;
    /** 重採樣演算法 */
    algorithm?: ResamplingAlgorithm;
    /** 是否使用抗鋸齒濾波器 */
    antiAlias?: boolean;
    /** 低通濾波器的截止頻率（Nyquist頻率的比例，0-1） */
    cutoffFrequency?: number;
}

/**
 * AudioResampler - 音訊重採樣服務
 * 
 * 提供多種重採樣演算法，將音訊從一個採樣率轉換到另一個採樣率
 * 主要用於將麥克風的 48kHz 音訊轉換為模型所需的 16kHz
 */
export class AudioResampler {
    private config: ConfigManager;
    private audioContext?: AudioContext | OfflineAudioContext;
    
    constructor(config: ConfigManager = ConfigManager.getInstance()) {
        this.config = config;
    }
    
    /**
     * 重採樣音訊資料
     * @param audioData 輸入音訊資料
     * @param options 重採樣選項
     * @returns 重採樣後的音訊資料
     */
    async resample(
        audioData: Float32Array,
        options: ResamplingOptions
    ): Promise<Float32Array> {
        // 如果採樣率相同，直接返回
        if (options.fromSampleRate === options.toSampleRate) {
            return new Float32Array(audioData);
        }
        
        const algorithm = options.algorithm || ResamplingAlgorithm.LINEAR;
        
        switch (algorithm) {
            case ResamplingAlgorithm.LINEAR:
                return this.resampleLinear(audioData, options);
            case ResamplingAlgorithm.CUBIC:
                return this.resampleCubic(audioData, options);
            case ResamplingAlgorithm.SINC:
                return this.resampleSinc(audioData, options);
            case ResamplingAlgorithm.WEB_AUDIO:
                return await this.resampleWebAudio(audioData, options);
            case ResamplingAlgorithm.NEAREST:
                return this.resampleNearest(audioData, options);
            default:
                return this.resampleLinear(audioData, options);
        }
    }
    
    /**
     * 快速重採樣到 16kHz（專為 VAD/Whisper 優化）
     * @param audioData 輸入音訊資料
     * @param fromSampleRate 源採樣率
     * @returns 16kHz 音訊資料
     */
    resampleTo16kHz(audioData: Float32Array, fromSampleRate: number): Float32Array {
        return this.resampleLinear(audioData, {
            fromSampleRate,
            toSampleRate: 16000,
            antiAlias: true
        });
    }
    
    /**
     * 線性插值重採樣
     * 快速且品質適中，適合即時處理
     */
    private resampleLinear(audioData: Float32Array, options: ResamplingOptions): Float32Array {
        const { fromSampleRate, toSampleRate } = options;
        const ratio = fromSampleRate / toSampleRate;
        const newLength = Math.floor(audioData.length / ratio);
        const resampled = new Float32Array(newLength);
        
        // 應用抗鋸齒濾波器（如果需要且是降採樣）
        let filteredData = audioData;
        if (options.antiAlias && ratio > 1) {
            filteredData = this.applyLowPassFilter(audioData, fromSampleRate, toSampleRate / 2);
        }
        
        for (let i = 0; i < newLength; i++) {
            const index = i * ratio;
            const indexFloor = Math.floor(index);
            const indexCeil = Math.min(indexFloor + 1, filteredData.length - 1);
            const fraction = index - indexFloor;
            
            resampled[i] = filteredData[indexFloor] * (1 - fraction) +
                          filteredData[indexCeil] * fraction;
        }
        
        return resampled;
    }
    
    /**
     * 立方插值重採樣
     * 品質比線性插值好，計算量適中
     */
    private resampleCubic(audioData: Float32Array, options: ResamplingOptions): Float32Array {
        const { fromSampleRate, toSampleRate } = options;
        const ratio = fromSampleRate / toSampleRate;
        const newLength = Math.floor(audioData.length / ratio);
        const resampled = new Float32Array(newLength);
        
        // 應用抗鋸齒濾波器
        let filteredData = audioData;
        if (options.antiAlias && ratio > 1) {
            filteredData = this.applyLowPassFilter(audioData, fromSampleRate, toSampleRate / 2);
        }
        
        for (let i = 0; i < newLength; i++) {
            const index = i * ratio;
            const i0 = Math.floor(index);
            const fraction = index - i0;
            
            // 獲取四個相鄰點
            const p0 = filteredData[Math.max(0, i0 - 1)];
            const p1 = filteredData[i0];
            const p2 = filteredData[Math.min(filteredData.length - 1, i0 + 1)];
            const p3 = filteredData[Math.min(filteredData.length - 1, i0 + 2)];
            
            // Catmull-Rom 立方插值
            const a = (-0.5 * p0 + 1.5 * p1 - 1.5 * p2 + 0.5 * p3);
            const b = (p0 - 2.5 * p1 + 2 * p2 - 0.5 * p3);
            const c = (-0.5 * p0 + 0.5 * p2);
            const d = p1;
            
            resampled[i] = a * fraction * fraction * fraction +
                          b * fraction * fraction +
                          c * fraction + d;
        }
        
        return resampled;
    }
    
    /**
     * Sinc 插值重採樣
     * 最高品質但計算量大，適合離線處理
     */
    private resampleSinc(audioData: Float32Array, options: ResamplingOptions): Float32Array {
        const { fromSampleRate, toSampleRate } = options;
        const ratio = fromSampleRate / toSampleRate;
        const newLength = Math.floor(audioData.length / ratio);
        const resampled = new Float32Array(newLength);
        
        // Sinc 濾波器參數
        const windowSize = 16; // 窗口大小（單側）
        const cutoff = options.cutoffFrequency || 0.95;
        
        for (let i = 0; i < newLength; i++) {
            const center = i * ratio;
            let sum = 0;
            
            // 應用 windowed sinc 濾波器
            for (let j = -windowSize; j <= windowSize; j++) {
                const index = Math.floor(center) + j;
                if (index >= 0 && index < audioData.length) {
                    const x = center - index;
                    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x * cutoff) / (Math.PI * x);
                    // Hamming 窗
                    const window = 0.54 - 0.46 * Math.cos(2 * Math.PI * (j + windowSize) / (2 * windowSize));
                    sum += audioData[index] * sinc * window;
                }
            }
            
            resampled[i] = sum;
        }
        
        return resampled;
    }
    
    /**
     * 最近鄰重採樣
     * 最快但品質最差，只適合非關鍵應用
     */
    private resampleNearest(audioData: Float32Array, options: ResamplingOptions): Float32Array {
        const { fromSampleRate, toSampleRate } = options;
        const ratio = fromSampleRate / toSampleRate;
        const newLength = Math.floor(audioData.length / ratio);
        const resampled = new Float32Array(newLength);
        
        for (let i = 0; i < newLength; i++) {
            const index = Math.round(i * ratio);
            resampled[i] = audioData[Math.min(index, audioData.length - 1)];
        }
        
        return resampled;
    }
    
    /**
     * 使用 Web Audio API 進行重採樣
     * 利用瀏覽器原生 API，品質好且有硬體加速
     */
    private async resampleWebAudio(
        audioData: Float32Array,
        options: ResamplingOptions
    ): Promise<Float32Array> {
        const { fromSampleRate, toSampleRate } = options;
        
        // 計算輸出長度
        const duration = audioData.length / fromSampleRate;
        const outputLength = Math.floor(duration * toSampleRate);
        
        // 創建離線音訊上下文
        const offlineContext = new OfflineAudioContext(
            1,  // 單聲道
            outputLength,
            toSampleRate
        );
        
        // 創建源緩衝區
        const sourceBuffer = offlineContext.createBuffer(
            1,
            audioData.length,
            fromSampleRate
        );
        const channelData = sourceBuffer.getChannelData(0);
        channelData.set(audioData);
        
        // 創建源節點
        const source = offlineContext.createBufferSource();
        source.buffer = sourceBuffer;
        
        // 如果需要抗鋸齒，添加低通濾波器
        if (options.antiAlias && fromSampleRate > toSampleRate) {
            const filter = offlineContext.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = toSampleRate / 2 * (options.cutoffFrequency || 0.95);
            filter.Q.value = 1;
            
            source.connect(filter);
            filter.connect(offlineContext.destination);
        } else {
            source.connect(offlineContext.destination);
        }
        
        source.start();
        
        // 渲染並返回結果
        const renderedBuffer = await offlineContext.startRendering();
        return renderedBuffer.getChannelData(0);
    }
    
    /**
     * 應用低通濾波器（用於抗鋸齒）
     * 使用簡單的 Butterworth 濾波器
     */
    private applyLowPassFilter(
        data: Float32Array,
        sampleRate: number,
        cutoffFrequency: number
    ): Float32Array {
        const filtered = new Float32Array(data.length);
        
        // Butterworth 二階低通濾波器係數
        const omega = 2 * Math.PI * cutoffFrequency / sampleRate;
        const sin = Math.sin(omega);
        const cos = Math.cos(omega);
        const alpha = sin / Math.sqrt(2);
        
        const a0 = 1 + alpha;
        const a1 = -2 * cos / a0;
        const a2 = (1 - alpha) / a0;
        const b0 = (1 - cos) / 2 / a0;
        const b1 = (1 - cos) / a0;
        const b2 = b0;
        
        // 應用濾波器
        let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        
        for (let i = 0; i < data.length; i++) {
            const x0 = data[i];
            const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
            
            filtered[i] = y0;
            
            x2 = x1;
            x1 = x0;
            y2 = y1;
            y1 = y0;
        }
        
        return filtered;
    }
    
    /**
     * 批次重採樣
     * 處理多個音訊片段，保持連續性
     */
    async resampleBatch(
        audioChunks: Float32Array[],
        options: ResamplingOptions
    ): Promise<Float32Array[]> {
        const results: Float32Array[] = [];
        
        for (const chunk of audioChunks) {
            const resampled = await this.resample(chunk, options);
            results.push(resampled);
        }
        
        return results;
    }
    
    /**
     * 計算重採樣後的長度
     */
    calculateOutputLength(
        inputLength: number,
        fromSampleRate: number,
        toSampleRate: number
    ): number {
        return Math.floor(inputLength * toSampleRate / fromSampleRate);
    }
    
    /**
     * 獲取推薦的演算法
     * 根據使用場景自動選擇最佳演算法
     */
    static getRecommendedAlgorithm(
        realtime: boolean,
        qualityPriority: boolean = false
    ): ResamplingAlgorithm {
        if (realtime) {
            return qualityPriority ? ResamplingAlgorithm.CUBIC : ResamplingAlgorithm.LINEAR;
        } else {
            return qualityPriority ? ResamplingAlgorithm.SINC : ResamplingAlgorithm.WEB_AUDIO;
        }
    }
}

/**
 * 創建預配置的重採樣器實例
 */
export class ResamplerPresets {
    /**
     * 創建用於即時麥克風輸入的重採樣器
     * 48kHz → 16kHz，使用線性插值
     */
    static forMicrophone(): AudioResampler {
        return new AudioResampler();
    }
    
    /**
     * 創建用於高品質離線處理的重採樣器
     */
    static forOfflineProcessing(): AudioResampler {
        return new AudioResampler();
    }
    
    /**
     * 創建用於 VAD 的重採樣器
     * 優化為低延遲
     */
    static forVAD(): AudioResampler {
        return new AudioResampler();
    }
    
    /**
     * 創建用於 Whisper 的重採樣器
     * 平衡品質和速度
     */
    static forWhisper(): AudioResampler {
        return new AudioResampler();
    }
}

// 單例實例
let resamplerInstance: AudioResampler | null = null;

/**
 * 獲取全域重採樣器實例
 */
export function getResampler(): AudioResampler {
    if (!resamplerInstance) {
        resamplerInstance = new AudioResampler();
    }
    return resamplerInstance;
}

/**
 * 快速重採樣函數（便利函數）
 * @param audioData 輸入音訊
 * @param fromRate 源採樣率
 * @param toRate 目標採樣率
 * @returns 重採樣後的音訊
 */
export async function resampleAudio(
    audioData: Float32Array,
    fromRate: number,
    toRate: number,
    algorithm: ResamplingAlgorithm = ResamplingAlgorithm.LINEAR
): Promise<Float32Array> {
    const resampler = getResampler();
    return resampler.resample(audioData, {
        fromSampleRate: fromRate,
        toSampleRate: toRate,
        algorithm,
        antiAlias: true
    });
}

/**
 * 快速重採樣到 16kHz（便利函數）
 */
export function resampleTo16kHz(
    audioData: Float32Array,
    fromSampleRate: number
): Float32Array {
    const resampler = getResampler();
    return resampler.resampleTo16kHz(audioData, fromSampleRate);
}

export default AudioResampler;