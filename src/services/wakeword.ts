/**
 * 喚醒詞檢測服務
 * 
 * 提供無狀態的喚醒詞檢測服務，用於在音訊中檢測特定的喚醒詞。
 * 使用三階段處理流程：梅爾頻譜圖生成 → 嵌入向量提取 → 喚醒詞檢測
 * 
 * @fileoverview 喚醒詞檢測服務實現
 * @author WebASRCore Team
 */

import type { InferenceSession, Tensor } from 'onnxruntime-web';
import { createSessions, createTensor } from '../runtime/ort';
import type { WakewordResources, WakewordState, WakewordParams, WakewordResult } from '../types';
import { ConfigManager } from '../utils/config-manager';
import { ortService } from './ort';

/**
 * 載入所有喚醒詞模型資源
 * 
 * @description 並行載入三個 ONNX 模型：梅爾頻譜圖模型、嵌入模型和檢測器模型
 * @param wakewordName - 喚醒詞名稱（'hey_jarvis' | 'hey_mycroft' | 'alexa'）
 * @param config - 可選的配置管理器實例
 * @param customPaths - 可選的自訂模型路徑
 * @returns Promise<WakewordResources> - 完整的喚醒詞模型資源
 * @throws Error - 當任何模型載入失敗時拋出錯誤
 * 
 * @example
 * ```typescript
 * // 使用預設配置載入 Hey Jarvis
 * const resources = await loadWakewordResources('hey_jarvis');
 * 
 * // 使用自訂配置
 * const config = new ConfigManager();
 * config.wakeword.hey_jarvis.detectorPath = './my_models/detector.onnx';
 * const resources = await loadWakewordResources('hey_jarvis', config);
 * 
 * // 使用自訂路徑
 * const resources = await loadWakewordResources('hey_jarvis', undefined, {
 *   detectorUrl: './custom/detector.onnx',
 *   melspecUrl: './custom/melspec.onnx',
 *   embeddingUrl: './custom/embedding.onnx'
 * });
 * ```
 */
export async function loadWakewordResources(
  wakewordName: 'hey_jarvis' | 'hey_mycroft' | 'alexa' = 'hey_jarvis',
  config?: ConfigManager,
  customPaths?: { 
    detectorUrl: string; 
    melspecUrl: string; 
    embeddingUrl: string;
  }
): Promise<WakewordResources> {
  const cfg = config || ConfigManager.getInstance();
  
  // 初始化 ORT 服務
  await ortService.initialize();
  
  // 使用自訂路徑或從配置取得
  const paths = customPaths || {
    detectorUrl: cfg.wakeword[wakewordName].detectorPath,
    melspecUrl: cfg.wakeword[wakewordName].melspecPath,
    embeddingUrl: cfg.wakeword[wakewordName].embeddingPath,
  };
  
  // 如果啟用 Web Worker，預載入模型，指定為 wakeword 類型以使用 WASM
  if (cfg.onnx.useWebWorker) {
    await Promise.all([
      ortService.preloadModelInWorker(`wakeword_detector_${wakewordName}`, paths.detectorUrl, 'wakeword'),
      ortService.preloadModelInWorker(`wakeword_melspec_${wakewordName}`, paths.melspecUrl, 'wakeword'),
      ortService.preloadModelInWorker(`wakeword_embedding_${wakewordName}`, paths.embeddingUrl, 'wakeword'),
    ]);
  }
  
  // 使用優化的 ORT 服務並行載入三個模型，指定為 wakeword 類型以使用 WASM
  const sessionPromises = [
    ortService.createSession(paths.detectorUrl, undefined, 'wakeword'),
    ortService.createSession(paths.melspecUrl, undefined, 'wakeword'),
    ortService.createSession(paths.embeddingUrl, undefined, 'wakeword'),
  ];
  
  const [detector, melspec, embedding] = await Promise.all(sessionPromises);
  
  // 建立初始資源物件，使用配置的維度
  const resources: WakewordResources = { 
    detector, 
    melspec, 
    embedding, 
    dims: { 
      embeddingBufferSize: cfg.wakeword.common.embeddingBufferSize,
      embeddingDimension: cfg.wakeword.common.embeddingDimension
    }
  };
  
  // 嘗試從模型資源自動偵測維度（如果可能）
  const dims = detectWakewordDims(resources, cfg);
  
  // 更新為檢測到的實際維度（或保留配置的預設值）
  resources.dims = dims;
  
  return resources;
}

/**
 * 從檢測器模型輸入形狀檢測喚醒詞模型維度
 * 
 * @description 分析檢測器模型的輸入形狀以確定嵌入緩衝區大小和維度
 * @param resources - 喚醒詞模型資源
 * @param config - 可選的配置管理器實例
 * @returns 模型維度配置
 * @returns.embeddingBufferSize - 嵌入緩衝區大小（時間步數）
 * @returns.embeddingDimension - 嵌入向量維度
 * 
 * @example
 * ```typescript
 * const dims = detectWakewordDims(resources);
 * console.log(`緩衝區大小: ${dims.embeddingBufferSize}, 維度: ${dims.embeddingDimension}`);
 * ```
 */
export function detectWakewordDims(
  resources: WakewordResources,
  config?: ConfigManager
): { embeddingBufferSize: number; embeddingDimension: number } {
  const cfg = config || new ConfigManager();
  
  // 獲取輸入元數據
  const inputNames = resources.detector.inputNames;
  
  // 使用配置的預設維度，實際生產環境可能需要更仔細的模型檢查
  let embeddingBufferSize = cfg.wakeword.common.embeddingBufferSize;
  let embeddingDimension = cfg.wakeword.common.embeddingDimension;
  
  try {
    // 嘗試從會話獲取輸入形狀
    // 注意：這可能無法適用於所有 ONNX 模型
    const inputName = inputNames[0];
    // 目前使用預設值，因為元數據檢查較為複雜
    // 實際模型使用：[1, 16, 96] 或 [1, 28, 96] 作為檢測器輸入
  } catch (error) {
    console.warn('無法檢測維度，使用預設值:', error);
  }
  
  return { embeddingBufferSize, embeddingDimension };
}

/**
 * 創建初始喚醒詞狀態
 * 
 * @description 建立喚醒詞處理所需的初始狀態，包括梅爾頻譜緩衝區和嵌入緩衝區
 * @param dims - 模型維度配置
 * @param dims.embeddingBufferSize - 嵌入緩衝區大小
 * @param dims.embeddingDimension - 嵌入向量維度
 * @returns WakewordState - 初始化的喚醒詞狀態物件
 * 
 * @example
 * ```typescript
 * const dims = { embeddingBufferSize: 16, embeddingDimension: 96 };
 * const wakewordState = createWakewordState(dims);
 * console.log(`初始化 ${wakewordState.embeddingBuffer.length} 個嵌入緩衝區`);
 * ```
 */
export function createWakewordState(
  dims: { embeddingBufferSize: number; embeddingDimension: number }
): WakewordState {
  // 使用零值初始化嵌入緩衝區
  const embeddingBuffer: Float32Array[] = [];
  for (let i = 0; i < dims.embeddingBufferSize; i++) {
    embeddingBuffer.push(new Float32Array(dims.embeddingDimension));
  }
  
  return {
    melBuffer: [],           // 梅爾頻譜幀緩衝區（每幀 32 維）
    embeddingBuffer,         // 嵌入向量緩衝區
  };
}

/**
 * 處理音訊塊進行喚醒詞檢測
 * 
 * @description 使用三階段流程處理音訊塊：梅爾頻譜圖 → 嵌入提取 → 喚醒詞檢測
 * @param resources - 喚醒詞模型資源
 * @param prevState - 前一個喚醒詞狀態
 * @param audio - 音訊塊（Float32Array）- 應為 16kHz 的樣本
 * @param params - 喚醒詞參數配置
 * @param config - 可選的配置管理器實例
 * @returns Promise<WakewordResult> - 檢測結果和更新後的狀態
 * @throws Error - 當處理失敗時拋出錯誤
 * 
 * @example
 * ```typescript
 * const result = await processWakewordChunk(resources, wakewordState, audioChunk, params);
 * console.log(`喚醒詞檢測: ${result.triggered}, 分數: ${result.score}`);
 * wakewordState = result.state; // 更新狀態
 * ```
 */
export async function processWakewordChunk(
  resources: WakewordResources,
  prevState: WakewordState,
  audio: Float32Array,
  params: WakewordParams,
  config?: ConfigManager
): Promise<WakewordResult> {
  const cfg = config || new ConfigManager();
  
  const melFramesPerChunk = params.melFramesPerChunk ?? cfg.wakeword.common.melFramesPerChunk;
  const requiredMelFrames = params.requiredMelFrames ?? cfg.wakeword.common.requiredMelFrames;
  const melStride = params.melStride ?? cfg.wakeword.common.melStride;
  
  // 深拷貝狀態以避免 ONNX Runtime 記憶體重用問題
  // melBuffer 需要深拷貝每個 Float32Array
  const melBuffer = prevState.melBuffer.map(frame => new Float32Array(frame));
  // embeddingBuffer 也需要深拷貝每個 Float32Array
  let embeddingBuffer = prevState.embeddingBuffer.map(embedding => new Float32Array(embedding));
  let score = 0;
  
  // 階段 1：音訊 → 梅爾頻譜圖（32 頻段 x 5 幀）
  const audioTensor = createTensor('float32', audio, [1, audio.length]);
  const melOut = await resources.melspec.run({
    [resources.melspec.inputNames[0]]: audioTensor
  });
  
  const melData = (melOut[resources.melspec.outputNames[0]] as Tensor).data as Float32Array;
  
  // 縮放梅爾特徵：(x/10) + 2
  const scaledMel = new Float32Array(melData.length);
  for (let j = 0; j < melData.length; j++) {
    scaledMel[j] = (melData[j] / 10.0) + 2.0;
  }
  
  // 將 5 個幀添加到緩衝區（每個幀為 32 維）
  const melDim = 32;
  for (let j = 0; j < melFramesPerChunk; j++) {
    // 使用深拷貝避免視圖重用問題
    const frame = new Float32Array(scaledMel.slice(j * melDim, (j + 1) * melDim));
    melBuffer.push(frame);
  }
  
  // 階段 2 & 3：如果幀數足夠，計算嵌入向量並進行檢測
  if (melBuffer.length >= requiredMelFrames) {
    // 取前 76 個幀進行嵌入計算
    const windowFrames = melBuffer.slice(0, requiredMelFrames);
    
    // 為嵌入模型展平梅爾幀
    const flatMel = new Float32Array(requiredMelFrames * melDim);
    for (let i = 0; i < windowFrames.length; i++) {
      flatMel.set(windowFrames[i], i * melDim);
    }
    
    // 創建形狀為 [1, 76, 32, 1] 的張量
    const melTensor = createTensor('float32', flatMel, [1, requiredMelFrames, melDim, 1]);
    
    // 執行嵌入模型
    const embOut = await resources.embedding.run({
      [resources.embedding.inputNames[0]]: melTensor
    });
    
    const newEmbedding = (embOut[resources.embedding.outputNames[0]] as Tensor).data as Float32Array;
    
    // 更新嵌入緩衝區（滑動窗口）
    embeddingBuffer = embeddingBuffer.slice(1);
    embeddingBuffer.push(new Float32Array(newEmbedding));
    
    // 為檢測器展平嵌入向量
    const flatEmb = new Float32Array(
      resources.dims.embeddingBufferSize * resources.dims.embeddingDimension
    );
    for (let i = 0; i < embeddingBuffer.length; i++) {
      flatEmb.set(embeddingBuffer[i], i * resources.dims.embeddingDimension);
    }
    
    // 為檢測器創建張量
    const finalTensor = createTensor(
      'float32', 
      flatEmb, 
      [1, resources.dims.embeddingBufferSize, resources.dims.embeddingDimension]
    );
    
    // 執行檢測器模型
    const detOut = await resources.detector.run({
      [resources.detector.inputNames[0]]: finalTensor
    });
    
    score = (detOut[resources.detector.outputNames[0]] as Tensor).data[0] as number;
    
    // 調試輸出
    if (score > 0.05 || Math.random() < 0.01) {  // 偶爾輸出或當分數較高時
      console.log(`[Wakeword] Detection score: ${score.toFixed(4)}, threshold: ${params.threshold}`);
    }
    
    // 按步長滑動梅爾緩衝區
    melBuffer.splice(0, melStride);
  }
  
  // 檢查是否觸發喚醒詞
  const triggered = score > params.threshold;
  
  if (triggered) {
    console.log(`[Wakeword] TRIGGERED! Score: ${score.toFixed(4)} > ${params.threshold}`);
  }
  
  // 返回檢測結果與更新的狀態
  const state: WakewordState = { 
    melBuffer, 
    embeddingBuffer 
  };
  
  return { 
    score, 
    triggered, 
    state 
  };
}

/**
 * 重設喚醒詞狀態
 * 
 * @description 在檢測到喚醒詞後重設狀態，清空所有緩衝區
 * @param dims - 模型維度配置
 * @param dims.embeddingBufferSize - 嵌入緩衝區大小
 * @param dims.embeddingDimension - 嵌入向量維度
 * @returns WakewordState - 重設後的喚醒詞狀態
 * 
 * @example
 * ```typescript
 * if (result.triggered) {
 *   // 檢測到喚醒詞後重設狀態
 *   wakewordState = resetWakewordState(resources.dims);
 * }
 * ```
 */
export function resetWakewordState(
  dims: { embeddingBufferSize: number; embeddingDimension: number }
): WakewordState {
  return createWakewordState(dims);
}

/**
 * 創建預設的喚醒詞參數
 * 
 * @description 從 ConfigManager 創建預設的喚醒詞參數配置
 * @param wakewordName - 喚醒詞名稱（'hey_jarvis' | 'hey_mycroft' | 'alexa'）
 * @param config - 可選的配置管理器實例
 * @returns WakewordParams - 喚醒詞參數配置
 * 
 * @example
 * ```typescript
 * // 使用預設配置
 * const params = createDefaultWakewordParams('hey_jarvis');
 * 
 * // 使用自訂配置
 * const config = new ConfigManager();
 * config.wakeword.hey_jarvis.threshold = 0.6;
 * const params = createDefaultWakewordParams('hey_jarvis', config);
 * ```
 */
export function createDefaultWakewordParams(
  wakewordName: 'hey_jarvis' | 'hey_mycroft' | 'alexa' = 'hey_jarvis',
  config?: ConfigManager
): WakewordParams {
  const cfg = config || new ConfigManager();
  
  return {
    threshold: cfg.wakeword[wakewordName].threshold,
    melFramesPerChunk: cfg.wakeword.common.melFramesPerChunk,
    requiredMelFrames: cfg.wakeword.common.requiredMelFrames,
    melStride: cfg.wakeword.common.melStride,
  };
}