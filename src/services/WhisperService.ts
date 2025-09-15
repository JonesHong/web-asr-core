/**
 * WhisperService - Whisper 語音識別服務類別（Event Architecture v2）
 * 
 * 提供事件驅動的語音轉文字服務
 * 使用 transformers.js 和 Whisper 模型進行高精度語音識別
 */

import { EventEmitter } from '../core/EventEmitter';
import { AudioChunker } from '../utils/AudioChunker';
import { AudioRingBuffer } from '../utils/AudioRingBuffer';
import { ConfigManager } from '../utils/config-manager';
import type { WhisperResources, WhisperOptions, WhisperResult, WhisperStreamCallbacks } from '../types';
import {
  loadWhisperResources,
  transcribe,
  chunkAudioForTranscription,
  whisperEvents
} from './whisper';

/**
 * Whisper 服務特定選項
 */
export interface WhisperServiceOptions {
  /** 預設語言 */
  language?: string;
  /** 溫度參數（創造性） */
  temperature?: number;
  /** 最大生成長度 */
  maxLength?: number;
  /** 最小音訊長度（毫秒） */
  minAudioLength?: number;
}

/**
 * Whisper 服務事件定義
 */
export interface WhisperEvents {
  ready: {
    modelId: string;
    config: {
      sampleRate: number;
      language?: string;
      temperature: number;
      maxLength: number;
    };
    timestamp: number;
  };
  transcriptionStart: {
    timestamp: number;
    audioLength: number;
  };
  transcriptionComplete: {
    text: string;
    duration: number;
    segments?: any[];
    timestamp: number;
  };
  transcriptionProgress: {
    progress: number;
    partialText?: string;
    timestamp: number;
  };
  // 串流事件
  streamChunkStart: {
    timestamp: number;
  };
  streamPartial: {
    partial: string;
    committed: string;
    timestamp: number;
  };
  streamChunkEnd: {
    committed: string;
    timestamp: number;
  };
  streamFinalize: {
    text: string;
    timestamp: number;
  };
  statistics: {
    totalTranscriptions: number;
    averageTranscriptionTime: number;
    totalAudioProcessed: number;
    charactersTranscribed: number;
  };
  error: {
    error: Error;
    context: string;
    timestamp: number;
  };
}

/**
 * WhisperService - 事件驅動的語音識別服務
 * 
 * @example
 * ```typescript
 * const whisper = new WhisperService();
 * // 或使用自訂選項
 * const whisper = new WhisperService({
 *   language: 'zh',
 *   temperature: 0.8
 * });
 * 
 * // 訂閱事件
 * whisper.on('transcriptionComplete', ({ text, duration }) => {
 *   console.log(`Transcription: ${text} (took ${duration}ms)`);
 * });
 * 
 * whisper.on('transcriptionProgress', ({ progress }) => {
 *   console.log(`Progress: ${progress}%`);
 * });
 * 
 * // 初始化
 * await whisper.initialize('whisper-base');
 * 
 * // 轉錄音訊
 * const result = await whisper.transcribe(audioData);
 * console.log(result.text);
 * ```
 */
export class WhisperService extends EventEmitter<WhisperEvents> {
  private pipeline: any = null;
  private modelId: string = '';
  private config = ConfigManager.getInstance();
  private options: WhisperServiceOptions;
  private chunker: AudioChunker | null = null;
  
  // 統計資料
  private stats = {
    totalTranscriptions: 0,
    totalTranscriptionTime: 0,
    totalAudioProcessed: 0,
    charactersTranscribed: 0,
    lastStatsEmit: Date.now()
  };
  
  constructor(options?: WhisperServiceOptions) {
    super();
    this.options = options || {};
    this.setupStreamEventListeners();
  }

  /**
   * 設定串流事件監聽器
   * 將核心 whisper.ts 的事件轉發到 WhisperService 事件
   */
  private setupStreamEventListeners(): void {
    // 監聽串流相關事件並轉發
    whisperEvents.addEventListener('stream-chunk-start', (event: any) => {
      this.emit('streamChunkStart', {
        timestamp: event.detail?.timestamp || Date.now()
      });
    });

    whisperEvents.addEventListener('stream-partial', (event: any) => {
      this.emit('streamPartial', {
        partial: event.detail?.partial || '',
        committed: event.detail?.committed || '',
        timestamp: Date.now()
      });
    });

    whisperEvents.addEventListener('stream-chunk-end', (event: any) => {
      this.emit('streamChunkEnd', {
        committed: event.detail?.committed || '',
        timestamp: event.detail?.timestamp || Date.now()
      });
    });

    whisperEvents.addEventListener('stream-finalize', (event: any) => {
      this.emit('streamFinalize', {
        text: event.detail?.text || '',
        timestamp: event.detail?.timestamp || Date.now()
      });
    });
  }
  
  /**
   * 初始化 Whisper 服務
   * @param modelId Whisper 模型 ID（可選）
   * @param loadOptions 載入選項
   * @returns Promise<void>
   */
  async initialize(modelId?: string, loadOptions?: any): Promise<void> {
    try {
      // 載入 Whisper 資源
      const resources = await loadWhisperResources(modelId, loadOptions);
      this.pipeline = resources.pipeline;
      this.modelId = resources.modelId;
      
      // 創建 chunker（Whisper 使用可變大小）
      this.chunker = AudioChunker.forWhisper();
      
      // 發射 ready 事件
      this.emit('ready', {
        modelId: this.modelId,
        config: {
          sampleRate: this.config.audio.sampleRate,
          language: this.options.language ?? this.config.whisper.language ?? 'auto',
          temperature: this.options.temperature ?? 0,
          maxLength: this.options.maxLength ?? 500
        },
        timestamp: Date.now()
      });
    } catch (error) {
      this.emit('error', {
        error: error as Error,
        context: 'initialize',
        timestamp: Date.now()
      });
      throw error;
    }
  }
  
  /**
   * 轉錄音訊
   * @param audio 音訊資料
   * @param options 轉錄選項
   * @returns 轉錄結果
   */
  async transcribe(
    audio: Float32Array,
    options?: WhisperOptions
  ): Promise<WhisperResult> {
    if (!this.pipeline) {
      throw new Error('Whisper service not initialized. Call initialize() first.');
    }

    const startTime = Date.now();
    const audioLength = audio.length / this.config.audio.sampleRate * 1000; // ms

    try {
      // 發射開始事件
      this.emit('transcriptionStart', {
        timestamp: startTime,
        audioLength
      });

      // 合併服務選項和傳入選項
      const mergedOptions: WhisperOptions = {
        language: this.options.language,
        temperature: this.options.temperature,
        max_new_tokens: this.options.maxLength,
        ...options
      };

      // 呼叫核心轉錄函數
      const result = await transcribe(
        { pipeline: this.pipeline, modelId: this.modelId },
        audio,
        mergedOptions
      );

      const duration = Date.now() - startTime;

      // 更新統計
      this.updateStatistics(duration, audioLength, result.text.length);

      // 發射完成事件
      this.emit('transcriptionComplete', {
        text: result.text,
        duration,
        segments: result.segments,
        timestamp: Date.now()
      });

      return result;
    } catch (error) {
      this.emit('error', {
        error: error as Error,
        context: 'transcribe',
        timestamp: Date.now()
      });
      throw error;
    }
  }

  /**
   * 使用串流模式轉錄音訊
   * @param audio 音訊資料
   * @param options 轉錄選項（包含串流回調）
   * @returns 轉錄結果
   */
  async transcribeWithStreaming(
    audio: Float32Array,
    options?: WhisperOptions & { streamCallbacks?: WhisperStreamCallbacks }
  ): Promise<WhisperResult> {
    if (!this.pipeline) {
      throw new Error('Whisper service not initialized. Call initialize() first.');
    }

    const startTime = Date.now();
    const audioLength = audio.length / this.config.audio.sampleRate * 1000; // ms

    try {
      // 發射開始事件
      this.emit('transcriptionStart', {
        timestamp: startTime,
        audioLength
      });

      // 合併服務選項和傳入選項，強制啟用串流
      const mergedOptions: WhisperOptions = {
        language: this.options.language,
        temperature: this.options.temperature,
        max_new_tokens: this.options.maxLength,
        ...options,
        streaming: true, // 強制啟用串流
        streamCallbacks: options?.streamCallbacks
      };

      // 呼叫核心轉錄函數
      const result = await transcribe(
        { pipeline: this.pipeline, modelId: this.modelId },
        audio,
        mergedOptions
      );

      const duration = Date.now() - startTime;

      // 更新統計
      this.updateStatistics(duration, audioLength, result.text.length);

      // 發射完成事件
      this.emit('transcriptionComplete', {
        text: result.text,
        duration,
        segments: result.segments,
        timestamp: Date.now()
      });

      return result;
    } catch (error) {
      this.emit('error', {
        error: error as Error,
        context: 'transcribeWithStreaming',
        timestamp: Date.now()
      });
      throw error;
    }
  }
  
  /**
   * 轉錄音訊並提供進度回調
   * @param audio 音訊資料
   * @param options 轉錄選項
   * @param onProgress 進度回調函數
   * @returns 轉錄結果
   */
  async transcribeWithProgress(
    audio: Float32Array,
    options?: WhisperOptions,
    onProgress?: (progress: number) => void
  ): Promise<WhisperResult> {
    if (!this.pipeline) {
      throw new Error('Whisper service not initialized');
    }
    
    // 將音訊分段以提供進度更新
    const chunks = chunkAudioForTranscription(audio);
    const results: string[] = [];
    const allSegments: any[] = [];
    
    const startTime = Date.now();
    const totalChunks = chunks.length;
    
    this.emit('transcriptionStart', {
      timestamp: startTime,
      audioLength: audio.length / this.config.audio.sampleRate * 1000
    });
    
    for (let i = 0; i < totalChunks; i++) {
      const progress = ((i + 1) / totalChunks) * 100;
      
      // 發射進度事件
      this.emit('transcriptionProgress', {
        progress,
        partialText: results.join(' '),
        timestamp: Date.now()
      });
      
      // 呼叫進度回調
      onProgress?.(progress);
      
      // 轉錄當前段
      const result = await this.transcribe(chunks[i], options);
      results.push(result.text);
      
      if (result.segments) {
        allSegments.push(...result.segments);
      }
    }
    
    const finalText = results.join(' ').trim();
    const duration = Date.now() - startTime;
    
    // 發射完成事件
    this.emit('transcriptionComplete', {
      text: finalText,
      duration,
      segments: allSegments.length > 0 ? allSegments : undefined,
      timestamp: Date.now()
    });
    
    return {
      text: finalText,
      segments: allSegments.length > 0 ? allSegments : undefined
    };
  }
  
  /**
   * 處理連續音訊流
   * @param ringBuffer 環形緩衝區
   * @param minAudioLength 最小音訊長度（毫秒）
   * @param options 轉錄選項
   * @returns 轉錄結果（如果音訊長度足夠）
   */
  async processStream(
    ringBuffer: AudioRingBuffer,
    minAudioLength?: number,
    options?: WhisperOptions
  ): Promise<WhisperResult | null> {
    // 使用服務選項或預設值
    const minLength = minAudioLength ?? this.options.minAudioLength ?? 1000;
    
    // 計算所需的最小樣本數
    const minSamples = Math.floor((minLength / 1000) * this.config.audio.sampleRate);
    
    // 檢查緩衝區是否有足夠的資料
    const available = ringBuffer.available();
    if (available < minSamples) {
      return null; // 資料不足
    }
    
    // 讀取音訊資料
    const audio = ringBuffer.read(available);
    if (!audio) return null;
    
    // 轉錄音訊
    return await this.transcribe(audio, options);
  }
  
  /**
   * 批次轉錄多個音訊片段
   * @param audioSegments 音訊片段陣列
   * @param options 轉錄選項
   * @returns 轉錄結果陣列
   */
  async transcribeBatch(
    audioSegments: Float32Array[],
    options?: WhisperOptions
  ): Promise<WhisperResult[]> {
    const results: WhisperResult[] = [];
    
    for (let i = 0; i < audioSegments.length; i++) {
      const progress = ((i + 1) / audioSegments.length) * 100;
      
      this.emit('transcriptionProgress', {
        progress,
        timestamp: Date.now()
      });
      
      const result = await this.transcribe(audioSegments[i], options);
      results.push(result);
    }
    
    return results;
  }
  
  /**
   * 獲取當前模型 ID
   * @returns 模型 ID
   */
  getModelId(): string {
    return this.modelId;
  }
  
  /**
   * 重置服務狀態
   */
  reset(): void {
    this.chunker?.reset();
    this.resetStatistics();
  }
  
  /**
   * 更新統計資料
   */
  private updateStatistics(
    transcriptionTime: number,
    audioLength: number,
    textLength: number
  ): void {
    this.stats.totalTranscriptions++;
    this.stats.totalTranscriptionTime += transcriptionTime;
    this.stats.totalAudioProcessed += audioLength;
    this.stats.charactersTranscribed += textLength;
    
    // 每 5 秒發射一次統計事件
    const now = Date.now();
    if (now - this.stats.lastStatsEmit > 5000) {
      this.emit('statistics', {
        totalTranscriptions: this.stats.totalTranscriptions,
        averageTranscriptionTime: this.stats.totalTranscriptionTime / this.stats.totalTranscriptions,
        totalAudioProcessed: this.stats.totalAudioProcessed,
        charactersTranscribed: this.stats.charactersTranscribed
      });
      this.stats.lastStatsEmit = now;
    }
  }
  
  /**
   * 重置統計資料
   */
  private resetStatistics(): void {
    this.stats = {
      totalTranscriptions: 0,
      totalTranscriptionTime: 0,
      totalAudioProcessed: 0,
      charactersTranscribed: 0,
      lastStatsEmit: Date.now()
    };
  }
  
  /**
   * 清理資源
   */
  dispose(): void {
    this.removeAllListeners();
    this.pipeline = null;
    this.modelId = '';
    this.chunker = null;
    this.resetStatistics();
  }
}

export default WhisperService;