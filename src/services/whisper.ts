/**
 * Whisper 語音辨識服務
 * 
 * 提供無狀態的語音轉錄服務，使用 transformers.js 框架進行 Whisper 模型推論。
 * 支援本地和遠端模型載入，提供靈活的語音辨識解決方案。
 * 
 * @fileoverview Whisper 語音辨識服務實現
 * @author WebASRCore Team
 */

import type { WhisperResources, WhisperOptions, WhisperResult, WhisperLoadOptions } from '../types';
import { ConfigManager } from '../utils/config-manager';

/**
 * 使用 transformers.js 載入 Whisper 模型資源
 * 
 * @description 動態載入 Whisper 語音辨識模型，支援 CDN 和 npm 包兩種載入方式
 * @param modelPathOrId - Whisper 模型路徑或 HuggingFace 模型 ID（可選，預設使用 ConfigManager 設定）
 * @param opts - 可選的模型載入配置
 * @param config - 可選的配置管理器實例
 * @returns Promise<WhisperResources> - Whisper 語音辨識資源
 * @throws Error - 當模型載入失敗時拋出錯誤
 * 
 * @example
 * ```typescript
 * // 使用預設配置
 * const resources = await loadWhisperResources();
 * 
 * // 使用自訂模型
 * const resources = await loadWhisperResources('whisper-base', {
 *   quantized: true,
 *   localBasePath: './models/'
 * });
 * 
 * // 使用自訂配置管理器
 * const config = new ConfigManager();
 * config.whisper.modelPath = 'Xenova/whisper-large';
 * const resources = await loadWhisperResources(undefined, undefined, config);
 * ```
 */
export async function loadWhisperResources(
  modelPathOrId?: string,
  opts?: WhisperLoadOptions,
  config?: ConfigManager
): Promise<WhisperResources> {
  const cfg = config || new ConfigManager();
  const modelId = modelPathOrId || cfg.whisper.modelPath;
  
  try {
    let pipeline: any;
    let env: any;
    
    // 首先嘗試從全域 window 物件獲取 transformers（CDN 載入方式）
    if (typeof window !== 'undefined' && (window as any).transformers) {
      ({ pipeline, env } = (window as any).transformers);
    } else {
      // 備用方案：動態匯入 npm 套件
      try {
        ({ pipeline, env } = await import('@xenova/transformers'));
      } catch (importError) {
        // 最後手段：檢查是否以其他方式載入
        if (typeof window !== 'undefined' && (window as any).__transformers_module) {
          ({ pipeline, env } = (window as any).__transformers_module);
        } else {
          throw new Error('找不到 Transformers.js。請通過 CDN 載入或安裝 npm 套件。');
        }
      }
    }
    
    // 使用配置或選項設置環境
    const localBasePath = opts?.localBasePath || cfg.whisper.localBasePath;
    const wasmPaths = opts?.wasmPaths || cfg.whisper.wasmPaths;
    
    // 如果指定了本地模型路徑，配置環境
    if (localBasePath) {
      // 設置本地模型路徑
      env.localModelPath = localBasePath;
      // 禁用遠端模型載入
      env.allowRemoteModels = false;
      // 可選：如果提供了 WASM 路徑則設置
      if (wasmPaths) {
        env.backends.onnx.wasm.wasmPaths = wasmPaths;
      }
    }
    
    // 創建自動語音辨識管道
    // transformers.js 處理模型載入和配置
    const asr = await pipeline(
      'automatic-speech-recognition',
      modelId,
      {
        quantized: opts?.quantized ?? cfg.whisper.quantized,
        // 如果指定了本地路徑，強制僅使用本地檔案
        ...(localBasePath && { 
          local_files_only: true,
          cache_dir: localBasePath 
        })
      }
    );
    
    return {
      pipeline: asr,
      modelId: modelId,
    };
  } catch (error) {
    throw new Error(`載入 Whisper 模型 ${modelId} 失敗: ${error}`);
  }
}

/**
 * 使用 Whisper 進行語音轉錄
 * 
 * @description 將音訊資料轉錄為文字，支援多語言和時間戳片段
 * @param resources - Whisper 語音辨識資源（管道）
 * @param audio - 音訊資料，格式為 Float32Array（16kHz 單聲道）
 * @param options - 轉錄選項配置
 * @returns Promise<WhisperResult> - 轉錄結果，包含文字和可選的時間戳片段
 * @throws Error - 當轉錄失敗時拋出錯誤
 * 
 * @example
 * ```typescript
 * // 基本轉錄
 * const result = await transcribe(resources, audioData);
 * console.log('轉錄結果:', result.text);
 * 
 * // 帶時間戳的轉錄
 * const result = await transcribe(resources, audioData, {
 *   language: 'zh',
 *   returnSegments: true
 * });
 * ```
 */
export async function transcribe(
  resources: WhisperResources,
  audio: Float32Array,
  options?: WhisperOptions
): Promise<WhisperResult> {
  try {
    // 準備管道選項
    const pipelineOptions: any = {
      // 語言規格
      ...(options?.language && { language: options.language }),
      
      // 任務類型（轉錄或翻譯）
      ...(options?.task && { task: options.task }),
      
      // 返回片段時間戳
      return_timestamps: options?.returnSegments ?? false,
      
      // 傳遞任何額外選項
      ...options,
    };
    
    // 執行語音辨識管道
    const output = await resources.pipeline(audio, pipelineOptions);
    
    // 格式化結果
    const result: WhisperResult = {
      text: output?.text || '',
    };
    
    // 如果請求且可用，添加時間戳片段
    if (options?.returnSegments && output?.chunks) {
      result.segments = output.chunks.map((chunk: any) => ({
        text: chunk.text || '',
        start: chunk.timestamp?.[0] ?? 0,
        end: chunk.timestamp?.[1] ?? 0,
      }));
    }
    
    return result;
  } catch (error) {
    throw new Error(`語音轉錄失敗: ${error}`);
  }
}

/**
 * 將音訊分塊以進行串流轉錄的輔助函數
 * 
 * @description 將長音訊分割成較小的重疊塊，以支援串流轉錄處理
 * @param audio - 原始音訊資料
 * @param chunkSizeSeconds - 每個塊的大小（秒）
 * @param overlapSeconds - 塊間重疊大小（秒）
 * @param sampleRate - 音訊採樣率
 * @param config - 可選的配置管理器實例
 * @returns Float32Array[] - 分割後的音訊塊陣列
 * 
 * @example
 * ```typescript
 * const chunks = chunkAudioForTranscription(longAudio);
 * console.log(`分割成 ${chunks.length} 個音訊塊`);
 * 
 * // 使用自訂參數
 * const chunks = chunkAudioForTranscription(longAudio, 20, 3, 16000);
 * ```
 * 
 * @remarks 這是未來增強功能，不屬於 MVP 範圍
 */
export function chunkAudioForTranscription(
  audio: Float32Array,
  chunkSizeSeconds?: number,
  overlapSeconds?: number,
  sampleRate?: number,
  config?: ConfigManager
): Float32Array[] {
  const cfg = config || new ConfigManager();
  const chunkSize = (chunkSizeSeconds ?? cfg.whisper.chunking.chunkSizeSeconds) * (sampleRate ?? cfg.audio.sampleRate);
  const overlapSize = (overlapSeconds ?? cfg.whisper.chunking.overlapSeconds) * (sampleRate ?? cfg.audio.sampleRate);
  const chunks: Float32Array[] = [];
  
  // 以重疊方式分割音訊
  for (let i = 0; i < audio.length; i += chunkSize - overlapSize) {
    const end = Math.min(i + chunkSize, audio.length);
    chunks.push(audio.slice(i, end));
    
    if (end >= audio.length) break;  // 已處理完所有音訊
  }
  
  return chunks;
}

/**
 * 處理多個音訊塊
 * 
 * @description 批次處理多個音訊塊。在 MVP 版本中，簡單地將所有塊串聯後作為一個整體進行轉錄
 * @param resources - Whisper 語音辨識資源
 * @param chunks - 音訊塊陣列
 * @param options - 轉錄選項
 * @returns Promise<WhisperResult> - 合併轉錄的結果
 * 
 * @example
 * ```typescript
 * const chunks = [chunk1, chunk2, chunk3];
 * const result = await transcribeChunks(resources, chunks, { language: 'zh' });
 * console.log('合併轉錄結果:', result.text);
 * ```
 * 
 * @remarks MVP 版本：將所有塊串聯為一個音訊進行轉錄
 */
export async function transcribeChunks(
  resources: WhisperResources,
  chunks: Float32Array[],
  options?: WhisperOptions
): Promise<WhisperResult> {
  // MVP 版本：串聯所有音訊塊
  let totalLength = 0;
  for (const chunk of chunks) {
    totalLength += chunk.length;
  }
  
  // 創建合併後的音訊陣列
  const combined = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  
  // 轉錄合併後的音訊
  return await transcribe(resources, combined, options);
}

/**
 * 創建預設的 Whisper 選項
 * 
 * @description 從 ConfigManager 創建預設的 Whisper 轉錄選項
 * @param config - 可選的配置管理器實例
 * @returns WhisperOptions - Whisper 轉錄選項配置
 * 
 * @example
 * ```typescript
 * // 使用預設配置
 * const options = createDefaultWhisperOptions();
 * 
 * // 使用自訂配置
 * const config = new ConfigManager();
 * config.whisper.language = 'en';
 * config.whisper.task = 'translate';
 * const options = createDefaultWhisperOptions(config);
 * ```
 */
export function createDefaultWhisperOptions(config?: ConfigManager): WhisperOptions {
  const cfg = config || new ConfigManager();
  
  return {
    language: cfg.whisper.language,
    task: cfg.whisper.task,
    returnSegments: cfg.whisper.returnSegments,
  };
}