/**
 * VAD（語音活動檢測）服務
 * 
 * 提供無狀態的語音活動檢測服務，用於檢測音訊塊中的語音活動。
 * 使用 Silero VAD v6 模型進行高精度語音檢測。
 * 
 * @fileoverview VAD 語音活動檢測服務實現
 * @author WebASRCore Team
 */

import type { InferenceSession, Tensor } from 'onnxruntime-web';
import { createSession, createTensor, type InferenceSession as Session } from '../runtime/ort';
import type { VadState, VadParams, VadResult } from '../types';
import { ConfigManager } from '../utils/config-manager';
import { ortService } from './ort';

/**
 * 載入 VAD 模型會話
 * 
 * @description 從指定 URL 載入 Silero VAD v6 模型並建立 ONNX Runtime 會話
 * @param modelUrl - VAD 模型的 URL 路徑（可選，預設使用 ConfigManager 設定）
 * @param sessionOptions - 可選的會話配置選項
 * @param config - 可選的配置管理器實例
 * @returns Promise<InferenceSession> - ONNX Runtime 推理會話
 * @throws Error - 當模型載入失敗時拋出錯誤
 * 
 * @example
 * ```typescript
 * // 使用預設配置
 * const session = await loadVadSession();
 * 
 * // 使用自訂路徑
 * const session = await loadVadSession('./models/custom_vad.onnx');
 * 
 * // 使用自訂配置管理器
 * const config = new ConfigManager();
 * config.vad.modelPath = './models/my_vad.onnx';
 * const session = await loadVadSession(undefined, undefined, config);
 * ```
 */
export async function loadVadSession(
  modelUrl?: string,
  sessionOptions?: InferenceSession.SessionOptions,
  config?: ConfigManager
): Promise<InferenceSession> {
  const cfg = config || ConfigManager.getInstance();
  const url = modelUrl || cfg.vad.modelPath;
  
  // 初始化 ORT 服務
  await ortService.initialize();
  
  // 如果啟用 Web Worker，預載入模型
  if (cfg.onnx.useWebWorker) {
    await ortService.preloadModelInWorker('vad', url);
  }
  
  // 使用優化的 ORT 服務創建會話
  return await ortService.createSession(url, sessionOptions);
}

/**
 * 創建初始 VAD 狀態
 * 
 * @description 建立 VAD 處理所需的初始狀態，包括 LSTM 狀態和上下文樣本
 * @param config - 可選的配置管理器實例
 * @returns VadState - 初始化的 VAD 狀態物件
 * 
 * @example
 * ```typescript
 * // 使用預設配置
 * const vadState = createVadState();
 * console.log(vadState.isSpeechActive); // false
 * 
 * // 使用自訂配置
 * const config = new ConfigManager();
 * config.vad.contextSize = 128;
 * const vadState = createVadState(config);
 * ```
 */
export function createVadState(config?: ConfigManager): VadState {
  const cfg = config || new ConfigManager();
  
  // Silero VAD v6 的 LSTM 狀態維度：[2, 1, 128]
  // 第一個維度用於 h 和 c 狀態
  const stateSize = 2 * 1 * 128;
  
  return {
    state: new Float32Array(stateSize),                      // 零初始化
    contextSamples: new Float32Array(cfg.vad.contextSize),   // 上下文樣本
    hangoverCounter: 0,                                      // 延遲計數器
    isSpeechActive: false,                                   // 語音活動狀態
  };
}

/**
 * 透過 VAD 處理音訊塊
 * 
 * @description 使用 Silero VAD v6 模型處理單個音訊塊，檢測語音活動
 * @param session - VAD 模型的 ONNX Runtime 會話
 * @param prevState - 前一個 VAD 狀態
 * @param audio - 音訊塊（Float32Array）- 應為 16kHz 的樣本
 * @param params - VAD 參數配置
 * @param config - 可選的配置管理器實例
 * @returns Promise<VadResult> - 檢測結果和更新後的狀態
 * @throws Error - 當處理失敗時拋出錯誤
 * 
 * @example
 * ```typescript
 * const result = await processVad(session, vadState, audioChunk, vadParams);
 * console.log(`語音檢測: ${result.detected}, 分數: ${result.score}`);
 * vadState = result.state; // 更新狀態
 * ```
 */
export async function processVad(
  session: InferenceSession,
  prevState: VadState,
  audio: Float32Array,
  params: VadParams,
  config?: ConfigManager
): Promise<VadResult> {
  const cfg = config || ConfigManager.getInstance();
  
  // 如果啟用 Web Worker，使用 Worker 執行推理
  if (cfg.onnx.useWebWorker) {
    try {
      const result = await ortService.runInferenceInWorker(
        'vad',
        'vad',
        cfg.vad.modelPath,
        audio
      );
      
      // 更新狀態
      const newContextSamples = new Float32Array(cfg.vad.contextSize);
      const startIdx = cfg.vad.windowSize - cfg.vad.contextSize;
      newContextSamples.set(audio.slice(startIdx, startIdx + cfg.vad.contextSize));
      
      let isSpeechActive = prevState.isSpeechActive;
      let hangoverCounter = prevState.hangoverCounter;
      
      if (result.result.isSpeech) {
        isSpeechActive = true;
        hangoverCounter = params.hangoverFrames;
      } else if (isSpeechActive) {
        hangoverCounter -= 1;
        if (hangoverCounter <= 0) {
          isSpeechActive = false;
        }
      }
      
      const state: VadState = {
        state: prevState.state, // Worker 內部管理狀態
        contextSamples: newContextSamples,
        hangoverCounter,
        isSpeechActive
      };
      
      return {
        detected: result.result.isSpeech,
        score: result.result.probability,
        state
      };
    } catch (error) {
      console.warn('[VAD] Worker inference failed, falling back to main thread:', error);
      // 如果 Worker 失敗，繼續使用主執行緒
    }
  }
  
  // Silero VAD v6 模型輸入規格：
  // - input: [1, 576] (64 個上下文樣本 + 512 個新樣本)
  // - state: [2, 1, 128] (LSTM 狀態)
  // - sr: [1] (採樣率，int64 格式)
  
  const windowSize = cfg.vad.windowSize;    // 時間視窗（預設 512 = 32ms @ 16kHz）
  const contextSize = cfg.vad.contextSize;  // 上下文視窗（預設 64 = 4ms）
  const effectiveWindowSize = windowSize + contextSize;  // 總計樣本數
  
  // 準備模型輸入：組合上下文樣本與當前音訊塊
  const inputData = new Float32Array(effectiveWindowSize);
  inputData.set(prevState.contextSamples, 0);  // 設置前 64 個上下文樣本
  inputData.set(audio.slice(0, windowSize), contextSize);  // 設置當前 512 個音訊樣本
  
  // 建立輸入張量 "input": [1, 576] (float32)
  const inputTensor = createTensor('float32', inputData, [1, effectiveWindowSize]);
  
  // 建立狀態張量 "state": [2, 1, 128] (float32)
  const stateTensor = createTensor('float32', prevState.state, [2, 1, 128]);
  
  // 建立採樣率張量 "sr": [1] (int64) - 使用 BigInt64Array
  const srTensor = createTensor('int64', new BigInt64Array([BigInt(params.sampleRate)]), [1]);
  
  // 組織模型輸入參數
  const feeds: Record<string, Tensor> = {
    input: inputTensor,
    state: stateTensor,
    sr: srTensor,
  };
  
  // 執行 ONNX 模型推論
  const results = await session.run(feeds);
  
  // 提取語音檢測分數輸出
  const outputData = results.output as Tensor;
  const score = outputData.data[0] as number;
  
  // 提取更新後的 LSTM 狀態 (stateN)
  const stateN = results.stateN as Tensor;
  const newState = new Float32Array(stateN.data as Float32Array);
  
  // 保存音訊塊尾部 64 個樣本作為下次處理的上下文
  const newContextSamples = new Float32Array(contextSize);
  const startIdx = windowSize - contextSize;  // 計算起始索引：512 - 64 = 448
  newContextSamples.set(audio.slice(startIdx, startIdx + contextSize));
  
  // 判斷語音活動狀態
  let isSpeechActive = prevState.isSpeechActive;
  let hangoverCounter = prevState.hangoverCounter;
  const vadDetected = score > params.threshold;
  
  if (vadDetected) {
    // 檢測到語音 - 激活狀態並重置延遲計數器
    isSpeechActive = true;
    hangoverCounter = params.hangoverFrames;
  } else if (isSpeechActive) {
    // 未檢測到語音但仍處於活動狀態 - 遞減延遲計數器
    hangoverCounter -= 1;
    if (hangoverCounter <= 0) {
      isSpeechActive = false;
    }
  }
  
  // 返回檢測結果與更新的狀態
  const state: VadState = { 
    state: newState,
    contextSamples: newContextSamples,
    hangoverCounter, 
    isSpeechActive 
  };
  
  return { 
    detected: vadDetected, 
    score, 
    state 
  };
}

/**
 * 批次處理多個音訊塊的輔助函數
 * 
 * @description 依序處理多個音訊塊，並維護狀態的連續性
 * @param session - VAD 模型的 ONNX Runtime 會話
 * @param chunks - 要處理的音訊塊陣列
 * @param initialState - 初始 VAD 狀態
 * @param params - VAD 參數配置
 * @param config - 可選的配置管理器實例
 * @returns Promise<VadResult[]> - 每個音訊塊對應的檢測結果陣列
 * 
 * @example
 * ```typescript
 * const chunks = [chunk1, chunk2, chunk3];
 * const results = await processVadChunks(session, chunks, vadState, vadParams);
 * console.log(`處理了 ${results.length} 個音訊塊`);
 * ```
 */
export async function processVadChunks(
  session: InferenceSession,
  chunks: Float32Array[],
  initialState: VadState,
  params: VadParams,
  config?: ConfigManager
): Promise<VadResult[]> {
  const results: VadResult[] = [];
  let state = initialState;
  
  // 依序處理每個音訊塊，保持狀態連續性
  for (const chunk of chunks) {
    const result = await processVad(session, state, chunk, params, config);
    results.push(result);
    state = result.state;  // 更新狀態以供下一個塊使用
  }
  
  return results;
}

/**
 * 創建預設的 VAD 參數
 * 
 * @description 從 ConfigManager 創建預設的 VAD 參數配置
 * @param config - 可選的配置管理器實例
 * @returns VadParams - VAD 參數配置
 * 
 * @example
 * ```typescript
 * // 使用預設配置
 * const params = createDefaultVadParams();
 * 
 * // 使用自訂配置
 * const config = new ConfigManager();
 * config.vad.threshold = 0.6;
 * const params = createDefaultVadParams(config);
 * ```
 */
export function createDefaultVadParams(config?: ConfigManager): VadParams {
  const cfg = config || new ConfigManager();
  
  return {
    threshold: cfg.vad.threshold,
    hangoverFrames: cfg.vad.hangoverFrames,
    sampleRate: cfg.vad.sampleRate,
  };
}