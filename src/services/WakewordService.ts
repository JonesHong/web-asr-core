/**
 * WakewordService - Wake Word 服務類別（Event Architecture v2）
 * 
 * 提供事件驅動的喚醒詞檢測服務
 * 支援多個喚醒詞模型的並行檢測
 */

import { EventEmitter } from '../core/EventEmitter';
import { AudioChunker } from '../utils/AudioChunker';
import { AudioRingBuffer } from '../utils/AudioRingBuffer';
import { ConfigManager } from '../utils/config-manager';
import * as ortService from '../runtime/ort';
import type { WakewordResources, WakewordState, WakewordParams, WakewordResult } from '../types';
import {
  loadWakewordResources,
  createWakewordState,
  createDefaultWakewordParams,
  processWakewordChunk
} from './wakeword';

/**
 * Wake Word 服務特定選項
 */
export interface WakewordServiceOptions {
  /** 每個喚醒詞的自訂闾值 */
  thresholds?: Record<string, number>;
  /** 檢測到後是否自動重置 */
  resetOnDetection?: boolean;
}

/**
 * Wake Word 服務事件定義
 */
export interface WakewordEvents {
  ready: { 
    models: string[];
    config: {
      sampleRate: number;
      chunkSize: number;
    };
    timestamp: number;
  };
  wakewordDetected: { 
    word: string;
    score: number;
    timestamp: number;
  };
  process: { 
    word: string;
    scores: number[];
    maxScore: number;
    timestamp: number;
  };
  statistics: {
    chunksProcessed: Map<string, number>;
    averageProcessingTime: Map<string, number>;
    detectionCounts: Map<string, number>;
  };
  error: { 
    error: Error;
    context: string;
    wakeword?: string;
    timestamp: number;
  };
}

/**
 * WakewordService - 事件驅動的喚醒詞檢測服務
 * 
 * @example
 * ```typescript
 * const wakeword = new WakewordService();
 * // 或使用自訂選項
 * const wakeword = new WakewordService({
 *   thresholds: { 'hey-jarvis': 0.6 }
 * });
 * 
 * // 訂閱事件
 * wakeword.on('wakewordDetected', ({ word, score }) => {
 *   console.log(`Wake word detected: ${word} (score: ${score})`);
 * });
 * 
 * // 初始化多個喚醒詞
 * await wakeword.initialize(['hey-jarvis', 'alexa']);
 * 
 * // 處理音訊
 * let state = wakeword.createState();
 * const params = wakeword.createParams('hey-jarvis');
 * 
 * const result = await wakeword.process(state, audioChunk, params);
 * state = result.state;
 * ```
 */
export class WakewordService extends EventEmitter<WakewordEvents> {
  private sessions: Map<string, WakewordResources> = new Map();
  private chunkers: Map<string, AudioChunker> = new Map();
  private config = ConfigManager.getInstance();
  private options: WakewordServiceOptions;
  private customModels: Map<string, string> = new Map(); // name -> modelUrl
  
  // 統計資料（每個喚醒詞分別統計）
  private stats = {
    chunksProcessed: new Map<string, number>(),
    totalProcessingTime: new Map<string, number>(),
    detectionCounts: new Map<string, number>(),
    lastStatsEmit: Date.now()
  };

  // 冷卻期管理（每個喚醒詞獨立）
  private cooldownTimers: Map<string, number> = new Map();
  private cooldownDuration = 1000; // 預設 1 秒冷卻期
  
  constructor(options?: WakewordServiceOptions) {
    super();
    this.options = options || {};
  }
  
  /**
   * 初始化喚醒詞服務
   * @param models 要載入的喚醒詞模型列表
   * @returns Promise<void>
   */
  async initialize(models?: string[]): Promise<void> {
    try {
      const modelsToLoad = models || ['hey-jarvis'];
      
      // 載入所有模型
      const loadPromises = modelsToLoad.map(async (model) => {
        // 轉換模型名稱格式：hey-jarvis -> hey_jarvis
        const modelKey = model.replace(/-/g, '_') as 'hey_jarvis' | 'hey_mycroft' | 'alexa';
        const resources = await loadWakewordResources(modelKey);
        this.sessions.set(model, resources);
        
        // 為每個模型創建專用的 chunker
        const chunker = AudioChunker.forWakeWord();
        this.chunkers.set(model, chunker);
        
        // 初始化統計
        this.stats.chunksProcessed.set(model, 0);
        this.stats.totalProcessingTime.set(model, 0);
        this.stats.detectionCounts.set(model, 0);
      });
      
      await Promise.all(loadPromises);
      
      // 發射 ready 事件
      this.emit('ready', {
        models: Array.from(this.sessions.keys()),
        config: {
          sampleRate: this.config.audio.sampleRate,
          chunkSize: this.config.audio.chunker.wakeword.chunkSize
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
   * @param state Wake word 狀態
   * @param audio 音訊資料（1280 樣本 @ 16kHz）
   * @param params Wake word 參數
   * @returns Wake word 結果
   */
  async process(
    state: WakewordState,
    audio: Float32Array,
    params: WakewordParams & { wakeword: string }
  ): Promise<WakewordResult> {
    const resources = this.sessions.get(params.wakeword);
    if (!resources) {
      throw new Error(`Wake word model not loaded: ${params.wakeword}`);
    }
    
    const startTime = performance.now();
    
    try {
      // 檢查是否為自訂模型並添加標記
      const isCustomModel = this.customModels.has(params.wakeword);
      const processParams = { ...params, isCustomModel };
      
      // 呼叫核心無狀態處理函數
      const result = await processWakewordChunk(resources, state, audio, processParams);
      
      // 更新統計
      const processingTime = performance.now() - startTime;
      this.updateStatistics(params.wakeword, processingTime, result.triggered);
      
      // 發射處理事件
      this.emit('process', {
        word: params.wakeword,
        scores: [result.score], // Wrap single score in array
        maxScore: result.score,
        timestamp: Date.now()
      });
      
      // 檢測喚醒詞（帶冷卻期保護）
      if (result.triggered) {
        const now = Date.now();
        const lastTrigger = this.cooldownTimers.get(params.wakeword) || 0;

        // 檢查是否在冷卻期內
        if (now - lastTrigger >= this.cooldownDuration) {
          // 更新冷卻期計時器
          this.cooldownTimers.set(params.wakeword, now);

          // 發射事件
          this.emit('wakewordDetected', {
            word: params.wakeword,
            score: result.score,
            timestamp: now
          });
        } else {
          // 在冷卻期內，忽略此次觸發
          console.log(`[WakewordService] ${params.wakeword} 在冷卻期內，忽略觸發 (剩餘 ${this.cooldownDuration - (now - lastTrigger)}ms)`);
        }
      }
      
      return result;
    } catch (error) {
      this.emit('error', {
        error: error as Error,
        context: 'process',
        wakeword: params.wakeword,
        timestamp: Date.now()
      });
      throw error;
    }
  }
  
  /**
   * 處理連續音訊流（單一喚醒詞）
   * @param ringBuffer 環形緩衝區
   * @param state Wake word 狀態
   * @param params Wake word 參數
   * @returns 更新後的狀態
   */
  async processStream(
    ringBuffer: AudioRingBuffer,
    state: WakewordState,
    params: WakewordParams & { wakeword: string }
  ): Promise<WakewordState> {
    const chunker = this.chunkers.get(params.wakeword);
    if (!chunker) {
      throw new Error(`Wake word service not initialized for: ${params.wakeword}`);
    }
    
    // 從環形緩衝區讀取可用資料
    const available = ringBuffer.available();
    if (available < 1280) {
      return state; // 資料不足，返回原狀態
    }
    
    const audio = ringBuffer.read(available);
    if (!audio) return state;
    
    // 使用 chunker 切割成適當大小
    const chunks = chunker.chunk(audio);
    
    let currentState = state;
    for (const chunk of chunks) {
      const result = await this.process(currentState, chunk, params);
      currentState = result.state;
      
      // 如果檢測到喚醒詞，可能需要重置狀態
      if (result.triggered && this.options.resetOnDetection) {
        currentState = this.createState();
      }
    }
    
    return currentState;
  }
  
  /**
   * 處理多個喚醒詞的並行檢測
   * @param audio 音訊資料
   * @param states 各喚醒詞的狀態對映
   * @param paramsList 各喚醒詞的參數列表
   * @returns 更新後的狀態對映和檢測結果
   */
  async processMultiple(
    audio: Float32Array,
    states: Map<string, WakewordState>,
    paramsList: (WakewordParams & { wakeword: string })[]
  ): Promise<{
    states: Map<string, WakewordState>;
    detections: Array<{ word: string; score: number }>;
  }> {
    const newStates = new Map<string, WakewordState>();
    const detections: Array<{ word: string; score: number }> = [];
    
    // 並行處理所有喚醒詞
    const promises = paramsList.map(async (params) => {
      const state = states.get(params.wakeword) || this.createState();
      const chunker = this.chunkers.get(params.wakeword);
      
      if (!chunker) {
        throw new Error(`Wake word not initialized: ${params.wakeword}`);
      }
      
      // 使用各自的 chunker 處理音訊
      const chunks = chunker.chunk(audio);
      let currentState = state;
      
      for (const chunk of chunks) {
        const result = await this.process(currentState, chunk, params);
        currentState = result.state;
        
        if (result.triggered) {
          detections.push({ word: params.wakeword, score: result.score });
          if (this.options.resetOnDetection) {
            currentState = this.createState();
          }
        }
      }
      
      newStates.set(params.wakeword, currentState);
    });
    
    await Promise.all(promises);
    
    return { states: newStates, detections };
  }
  
  /**
   * 創建 Wake word 狀態
   * @param wakewordName 喚醒詞名稱（可選，用於自訂模型）
   * @returns 新的 Wake word 狀態
   */
  createState(wakewordName?: string): WakewordState {
    // 使用配置管理器的維度設定
    let dims = { 
      embeddingBufferSize: this.config.wakeword.common.embeddingBufferSize,
      embeddingDimension: this.config.wakeword.common.embeddingDimension
    };
    
    // 如果是自訂模型，使用其特定的維度
    if (wakewordName && this.sessions.has(wakewordName)) {
      const resources = this.sessions.get(wakewordName);
      if (resources?.dims) {
        dims = resources.dims;
      }
    }
    
    const state = createWakewordState(dims);
    console.log('[WakewordService.createState] Created state:', {
      wakewordName,
      melBufferLength: state.melBuffer?.length,
      embeddingBufferLength: state.embeddingBuffer?.length,
      dims,
      isArrayMelBuffer: Array.isArray(state.melBuffer),
      isArrayEmbeddingBuffer: Array.isArray(state.embeddingBuffer)
    });
    return state;
  }
  
  /**
   * 創建 Wake word 參數
   * @param wakeword 喚醒詞名稱
   * @param overrides 參數覆蓋
   * @returns Wake word 參數
   */
  createParams(wakeword: string, overrides?: Partial<WakewordParams>): WakewordParams & { wakeword: string } {
    const defaults = createDefaultWakewordParams();
    
    // 應用服務選項覆蓋
    if (this.options.thresholds?.[wakeword] !== undefined) {
      defaults.threshold = this.options.thresholds[wakeword];
    }
    
    return { ...defaults, ...overrides, wakeword };
  }
  
  /**
   * 創建喚醒詞參數（內部使用）
   */
  private createWakewordParams(wakeword: string): WakewordParams & { wakeword: string } {
    return this.createParams(wakeword);
  }
  
  /**
   * 註冊自訂喚醒詞模型
   * @param name 自訂模型名稱
   * @param modelUrl Blob URL 或模型路徑
   * @returns Promise<void>
   */
  async registerCustomModel(name: string, modelUrl: string): Promise<void> {
    try {
      // 儲存自訂模型 URL
      this.customModels.set(name, modelUrl);
      
      // 載入自訂模型資源 - 只覆蓋 detector，保留標準 melspec/embedding
      // 使用 hey_jarvis 作為基準來取得預設的 melspec/embedding 路徑
      const cfg = this.config;
      
      // 首先載入自訂 detector 來偵測其輸入維度
      const detectorSession = await ortService.createSession(modelUrl);
      
      // 根據模型名稱推測需要的 embedding buffer size
      // hi_kmu 系列模型需要 28 個時間步長，而不是預設的 16
      let embeddingBufferSize = cfg.wakeword.common.embeddingBufferSize;
      if (name.includes('kmu') || name.includes('28')) {
        embeddingBufferSize = 28;
        console.log(`[WakewordService] Detected KMU model, using embeddingBufferSize: ${embeddingBufferSize}`);
      }
      
      // 載入標準的 melspec 和 embedding 模型
      const melspecSession = await ortService.createSession(
        cfg.wakeword.hey_jarvis.melspecPath
      );
      const embeddingSession = await ortService.createSession(
        cfg.wakeword.hey_jarvis.embeddingPath
      );
      
      const resources: WakewordResources = {
        detector: detectorSession,
        melspec: melspecSession,
        embedding: embeddingSession,
        dims: {
          embeddingDimension: cfg.wakeword.common.embeddingDimension,
          embeddingBufferSize: embeddingBufferSize  // 使用動態偵測的大小
        }
      };
      
      this.sessions.set(name, resources);
      
      // 為自訂模型創建專用的 chunker
      const chunker = AudioChunker.forWakeWord();
      this.chunkers.set(name, chunker);
      
      // 初始化統計
      this.stats.chunksProcessed.set(name, 0);
      this.stats.totalProcessingTime.set(name, 0);
      this.stats.detectionCounts.set(name, 0);
      
      // 發射 ready 事件更新
      this.emit('ready', {
        models: Array.from(this.sessions.keys()),
        config: {
          sampleRate: this.config.audio.sampleRate,
          chunkSize: this.config.audio.chunker.wakeword.chunkSize
        },
        timestamp: Date.now()
      });
      
      console.log(`[WakewordService] Custom model registered: ${name}`);
    } catch (error) {
      this.emit('error', { 
        error: error as Error,
        context: 'registerCustomModel',
        wakeword: name,
        timestamp: Date.now()
      });
      throw error;
    }
  }
  
  /**
   * 移除自訂喚醒詞模型
   * @param name 自訂模型名稱
   */
  removeCustomModel(name: string): void {
    if (this.customModels.has(name)) {
      // 清理資源
      this.sessions.delete(name);
      this.chunkers.delete(name);
      this.customModels.delete(name);
      
      // 清理統計
      this.stats.chunksProcessed.delete(name);
      this.stats.totalProcessingTime.delete(name);
      this.stats.detectionCounts.delete(name);
      
      console.log(`[WakewordService] Custom model removed: ${name}`);
    }
  }
  
  /**
   * 獲取已載入的喚醒詞列表
   * @returns 喚醒詞名稱陣列
   */
  getLoadedModels(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * 設置冷卻期時長
   * @param duration 冷卻期時長（毫秒）
   */
  setCooldownDuration(duration: number): void {
    this.cooldownDuration = Math.max(0, duration);
    console.log(`[WakewordService] 冷卻期設置為 ${this.cooldownDuration}ms`);
  }
  
  /**
   * 重置服務狀態
   * @param wakeword 指定要重置的喚醒詞（可選，不指定則重置所有）
   */
  reset(wakeword?: string): void {
    if (wakeword) {
      this.chunkers.get(wakeword)?.reset();
      this.cooldownTimers.delete(wakeword);
    } else {
      this.chunkers.forEach(chunker => chunker.reset());
      this.cooldownTimers.clear();
    }
    this.resetStatistics(wakeword);
  }
  
  /**
   * 更新統計資料
   */
  private updateStatistics(wakeword: string, processingTime: number, triggered: boolean): void {
    const chunks = (this.stats.chunksProcessed.get(wakeword) || 0) + 1;
    const totalTime = (this.stats.totalProcessingTime.get(wakeword) || 0) + processingTime;
    const detections = (this.stats.detectionCounts.get(wakeword) || 0) + (triggered ? 1 : 0);
    
    this.stats.chunksProcessed.set(wakeword, chunks);
    this.stats.totalProcessingTime.set(wakeword, totalTime);
    this.stats.detectionCounts.set(wakeword, detections);
    
    // 每秒發射一次統計事件
    const now = Date.now();
    if (now - this.stats.lastStatsEmit > 1000) {
      const avgProcessingTime = new Map<string, number>();
      this.stats.chunksProcessed.forEach((chunks, word) => {
        const totalTime = this.stats.totalProcessingTime.get(word) || 0;
        avgProcessingTime.set(word, totalTime / chunks);
      });
      
      this.emit('statistics', {
        chunksProcessed: new Map(this.stats.chunksProcessed),
        averageProcessingTime: avgProcessingTime,
        detectionCounts: new Map(this.stats.detectionCounts)
      });
      this.stats.lastStatsEmit = now;
    }
  }
  
  /**
   * 重置統計資料
   */
  private resetStatistics(wakeword?: string): void {
    if (wakeword) {
      this.stats.chunksProcessed.set(wakeword, 0);
      this.stats.totalProcessingTime.set(wakeword, 0);
      this.stats.detectionCounts.set(wakeword, 0);
    } else {
      this.stats.chunksProcessed.clear();
      this.stats.totalProcessingTime.clear();
      this.stats.detectionCounts.clear();
      this.stats.lastStatsEmit = Date.now();
    }
  }
  
  /**
   * 清理資源
   */
  dispose(): void {
    this.removeAllListeners();
    this.sessions.clear();
    this.chunkers.clear();
    this.resetStatistics();
  }
}

export default WakewordService;