/**
 * VadService - VAD 服務類別（Event Architecture v2）
 * 
 * 提供事件驅動的語音活動檢測服務
 * 包裝無狀態的 VAD 處理函數並提供事件發射功能
 */

import { EventEmitter } from '../core/EventEmitter';
import { AudioChunker } from '../utils/AudioChunker';
import { AudioRingBuffer } from '../utils/AudioRingBuffer';
import { ConfigManager } from '../utils/config-manager';
import type { InferenceSession } from 'onnxruntime-web';
import type { VadState, VadParams, VadResult } from '../types';
import {
  loadVadSession,
  createVadState,
  createDefaultVadParams,
  processVad
} from './vad';

/**
 * VAD 服務事件定義
 */
export interface VadEvents {
  ready: { 
    config: {
      sampleRate: number;
      windowSize: number;
      threshold: number;
    };
    timestamp: number;
  };
  speechStart: { 
    timestamp: number; 
    score: number;
  };
  speechEnd: { 
    timestamp: number; 
    duration: number;
  };
  process: { 
    result: {
      detected: boolean; 
      score: number;
    };
    timestamp: number;
  };
  statistics: {
    chunksProcessed: number;
    averageProcessingTime: number;
    speechDuration: number;
    silenceDuration: number;
  };
  error: { 
    error: Error; 
    context: string;
    timestamp: number;
  };
}

/**
 * VAD 服務特定選項
 */
export interface VadServiceOptions {
  threshold?: number;
  windowSize?: number;
  minSpeechFrames?: number;
  speechEndFrames?: number;
}

/**
 * VadService - 事件驅動的 VAD 服務
 * 
 * @example
 * ```typescript
 * const vad = new VadService();
 * // 或使用自訂選項
 * const vad = new VadService({ threshold: 0.6 });
 * 
 * // 訂閱事件
 * vad.on('speechStart', ({ timestamp, score }) => {
 *   console.log('Speech started:', timestamp, score);
 * });
 * 
 * vad.on('speechEnd', ({ duration }) => {
 *   console.log('Speech duration:', duration);
 * });
 * 
 * // 初始化
 * await vad.initialize();
 * 
 * // 處理音訊
 * let state = vad.createState();
 * const params = vad.createParams();
 * 
 * const result = await vad.process(state, audioChunk, params);
 * state = result.state;
 * ```
 */
export class VadService extends EventEmitter<VadEvents> {
  private session: InferenceSession | null = null;
  private chunker: AudioChunker | null = null;
  private lastSpeechStart: number | null = null;
  private config = ConfigManager.getInstance();
  private options: VadServiceOptions;
  
  // 統計資料
  private stats = {
    chunksProcessed: 0,
    totalProcessingTime: 0,
    speechDuration: 0,
    silenceDuration: 0,
    lastStatsEmit: Date.now()
  };
  
  constructor(options?: VadServiceOptions) {
    super();
    this.options = options || {};
  }
  
  /**
   * 初始化 VAD 服務
   * @param modelUrl VAD 模型 URL（可選）
   * @returns Promise<void>
   */
  async initialize(modelUrl?: string): Promise<void> {
    try {
      // 載入模型
      this.session = await loadVadSession(modelUrl);
      
      // 創建 chunker
      this.chunker = AudioChunker.forVAD();
      
      // 發射 ready 事件
      this.emit('ready', {
        config: {
          sampleRate: this.config.audio.sampleRate,
          windowSize: this.options.windowSize ?? this.config.vad.windowSize,
          threshold: this.options.threshold ?? this.config.vad.threshold
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
   * 處理單個音訊塊
   * @param state VAD 狀態
   * @param audio 音訊資料（512 樣本 @ 16kHz）
   * @param params VAD 參數
   * @returns VAD 結果
   */
  async process(
    state: VadState, 
    audio: Float32Array, 
    params: VadParams
  ): Promise<VadResult> {
    if (!this.session) {
      throw new Error('VAD service not initialized. Call initialize() first.');
    }
    
    const startTime = performance.now();
    
    try {
      // 呼叫核心無狀態處理函數
      const result = await processVad(this.session, state, audio, params);
      
      // 更新統計
      const processingTime = performance.now() - startTime;
      this.updateStatistics(processingTime, result.detected);
      
      // 發射處理事件
      this.emit('process', { 
        result: {
          detected: result.detected, 
          score: result.score
        },
        timestamp: Date.now()
      });
      
      // 檢測語音狀態變化
      if (!state.isSpeechActive && result.state.isSpeechActive) {
        // 語音開始
        this.lastSpeechStart = Date.now();
        this.emit('speechStart', { 
          timestamp: this.lastSpeechStart, 
          score: result.score 
        });
      } else if (state.isSpeechActive && !result.state.isSpeechActive) {
        // 語音結束
        const now = Date.now();
        const duration = this.lastSpeechStart ? now - this.lastSpeechStart : 0;
        this.emit('speechEnd', { 
          timestamp: now, 
          duration 
        });
        this.lastSpeechStart = null;
      }
      
      return result;
    } catch (error) {
      this.emit('error', { 
        error: error as Error, 
        context: 'process',
        timestamp: Date.now()
      });
      throw error;
    }
  }
  
  /**
   * 處理連續音訊流
   * @param ringBuffer 環形緩衝區
   * @param state VAD 狀態
   * @param params VAD 參數
   * @returns 更新後的狀態
   */
  async processStream(
    ringBuffer: AudioRingBuffer,
    state: VadState,
    params: VadParams
  ): Promise<VadState> {
    if (!this.chunker) {
      throw new Error('VAD service not initialized');
    }
    
    // 從環形緩衝區讀取可用資料
    const available = ringBuffer.available();
    if (available < 512) {
      return state; // 資料不足，返回原狀態
    }
    
    const audio = ringBuffer.read(available);
    if (!audio) return state;
    
    // 使用 chunker 切割成適當大小
    const chunks = this.chunker.chunk(audio);
    
    let currentState = state;
    for (const chunk of chunks) {
      const result = await this.process(currentState, chunk, params);
      currentState = result.state;
    }
    
    return currentState;
  }
  
  /**
   * 創建 VAD 狀態
   * @returns 新的 VAD 狀態
   */
  createState(): VadState {
    return createVadState();
  }
  
  /**
   * 創建 VAD 參數
   * @param overrides 參數覆蓋
   * @returns VAD 參數
   */
  createParams(overrides?: Partial<VadParams>): VadParams {
    const defaults = createDefaultVadParams();
    // 應用服務選項覆蓋
    if (this.options.threshold !== undefined) {
      defaults.threshold = this.options.threshold;
    }
    // Note: minSpeechFrames and speechEndFrames are service-level options,
    // not part of the core VadParams that go to the stateless function
    return { ...defaults, ...overrides };
  }
  
  /**
   * 重置服務狀態
   */
  reset(): void {
    this.lastSpeechStart = null;
    this.chunker?.reset();
    this.resetStatistics();
  }
  
  /**
   * 更新統計資料
   */
  private updateStatistics(processingTime: number, detected: boolean): void {
    this.stats.chunksProcessed++;
    this.stats.totalProcessingTime += processingTime;
    
    const chunkDuration = 32; // 512 samples @ 16kHz = 32ms
    if (detected) {
      this.stats.speechDuration += chunkDuration;
    } else {
      this.stats.silenceDuration += chunkDuration;
    }
    
    // 每秒發射一次統計事件
    const now = Date.now();
    if (now - this.stats.lastStatsEmit > 1000) {
      this.emit('statistics', {
        chunksProcessed: this.stats.chunksProcessed,
        averageProcessingTime: this.stats.totalProcessingTime / this.stats.chunksProcessed,
        speechDuration: this.stats.speechDuration,
        silenceDuration: this.stats.silenceDuration
      });
      this.stats.lastStatsEmit = now;
    }
  }
  
  /**
   * 重置統計資料
   */
  private resetStatistics(): void {
    this.stats = {
      chunksProcessed: 0,
      totalProcessingTime: 0,
      speechDuration: 0,
      silenceDuration: 0,
      lastStatsEmit: Date.now()
    };
  }
  
  /**
   * 清理資源
   */
  dispose(): void {
    this.removeAllListeners();
    this.session = null;
    this.chunker = null;
    this.lastSpeechStart = null;
    this.resetStatistics();
  }
}

export default VadService;