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
 * Whisper 事件發射器
 * 
 * @description 用於發送語音識別相關事件，外部可以監聽這些事件進行相應處理
 * 事件類型：
 * - 'transcription-start': 轉錄開始 { timestamp: number }
 * - 'transcription-complete': 轉錄完成 { text: string, duration: number }
 * - 'processing-error': 處理錯誤 { error: Error, context: string }
 */
export const whisperEvents = new EventTarget();

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
        ({ pipeline, env } = await import('@huggingface/transformers'));
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
    const wasmPaths = opts?.wasmPaths || cfg.whisper.wasmPaths;

    // 初始化 backends 物件結構（避免 undefined 錯誤）
    env.backends = env.backends || {};
    env.backends.onnx = env.backends.onnx || {};
    env.backends.onnx.wasm = env.backends.onnx.wasm || {};

    // 根據配置決定使用本地還是遠端模式
    if (opts?.localBasePath || cfg.whisper.localBasePath) {
      // 有設定本地路徑，使用本地模式
      env.allowLocalModels = true;
      env.localModelPath = opts?.localBasePath || cfg.whisper.localBasePath;
      env.allowRemoteModels = false;
    } else {
      // 沒有設定本地路徑，使用遠端模式
      env.allowLocalModels = false;
      env.remoteHost = 'https://huggingface.co';
      env.remotePathTemplate = '{model}/resolve/{revision}/';
    env.allowRemoteModels = true;
    }

    // 設置 WASM 路徑 - 支援字串路徑或物件對映
    if (wasmPaths) {
      env.backends.onnx.wasm.wasmPaths = wasmPaths;
    } else {
      // 預設使用物件對映方式，優先使用本地檔案
      env.backends.onnx.wasm.wasmPaths = {
        'ort-wasm-simd-threaded.jsep.mjs':  './public/ort/ort-wasm-simd-threaded.jsep.mjs',
        'ort-wasm-simd-threaded.jsep.wasm': './public/ort/ort-wasm-simd-threaded.jsep.wasm',
        'ort-wasm.wasm':                    './public/ort/ort-wasm-simd-threaded.jsep.wasm',
        'ort-wasm-simd.wasm':               './public/ort/ort-wasm-simd-threaded.jsep.wasm',
        'ort-wasm-simd-threaded.wasm':      './public/ort/ort-wasm-simd-threaded.wasm'
      };
    }
    
    // 創建自動語音辨識管道
    // transformers.js 處理模型載入和配置
    const asr = await pipeline(
      'automatic-speech-recognition',
      modelId,
      {
        quantized: opts?.quantized ?? cfg.whisper.quantized,
        // WebGPU 加速設定
        device: opts?.device ?? cfg.whisper.device ?? 'wasm',
        dtype: opts?.dtype ?? cfg.whisper.dtype ?? 'q8',
        // 添加進度回調（如果提供）
        ...(opts?.progress_callback && {
          progress_callback: opts.progress_callback
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
  const startTime = Date.now();
  const config = new ConfigManager();

  try {
    // 發出轉錄開始事件
    whisperEvents.dispatchEvent(new CustomEvent('transcription-start', {
      detail: { timestamp: startTime }
    }));

    // 決定是否使用串流模式
    const useStreaming = options?.streaming ?? config.whisper.streaming.enabled;

    if (useStreaming) {
      // 串流模式
      return await transcribeWithStreaming(resources, audio, options, config, startTime);
    } else {
      // 一次性轉錄模式（原有邏輯）
      return await transcribeOneShot(resources, audio, options, startTime);
    }
  } catch (error) {
    // 發出處理錯誤事件
    whisperEvents.dispatchEvent(new CustomEvent('processing-error', {
      detail: {
        error: error as Error,
        context: 'transcribe'
      }
    }));
    throw new Error(`語音轉錄失敗: ${error}`);
  }
}

/**
 * 一次性轉錄（原有邏輯）
 * @private
 */
async function transcribeOneShot(
  resources: WhisperResources,
  audio: Float32Array,
  options?: WhisperOptions,
  startTime?: number
): Promise<WhisperResult> {
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

  // 發出轉錄完成事件
  const duration = startTime ? Date.now() - startTime : 0;
  whisperEvents.dispatchEvent(new CustomEvent('transcription-complete', {
    detail: {
      text: result.text,
      duration: duration
    }
  }));

  return result;
}

/**
 * 串流轉錄模式
 * @private
 */
async function transcribeWithStreaming(
  resources: WhisperResources,
  audio: Float32Array,
  options?: WhisperOptions,
  config?: ConfigManager,
  startTime?: number
): Promise<WhisperResult> {
  const cfg = config || new ConfigManager();

  // 動態載入 WhisperTextStreamer
  let WhisperTextStreamer: any;

  // 嘗試從全域載入（CDN 方式）
  if (typeof window !== 'undefined' && (window as any).transformers) {
    const transformersGlobal = (window as any).transformers;
    WhisperTextStreamer = transformersGlobal.WhisperTextStreamer;

    // 檢查是否成功載入
    if (!WhisperTextStreamer) {
      console.error('window.transformers 存在但沒有 WhisperTextStreamer:', Object.keys(transformersGlobal));
      throw new Error('WhisperTextStreamer 未在 window.transformers 中找到，請確保正確載入 transformers.js v3+');
    }
  } else {
    // 嘗試從 npm 套件載入
    try {
      const transformersModule = await import('@huggingface/transformers');
      WhisperTextStreamer = transformersModule.WhisperTextStreamer;

      if (!WhisperTextStreamer) {
        console.error('transformers 模組已載入但沒有 WhisperTextStreamer:', Object.keys(transformersModule));
        throw new Error('WhisperTextStreamer 未在 transformers 模組中找到');
      }
    } catch (error) {
      console.error('載入 WhisperTextStreamer 失敗:', error);
      throw new Error('無法載入 WhisperTextStreamer，請確保 transformers.js v3+ 已正確載入');
    }
  }

  // 收集串流結果
  let committedText = '';
  let currentPartial = '';
  let lastPartialLength = 0; // 記錄上一次 partial 的長度
  let currentDisplay = ''; // 當前顯示的文字
  let currentChunkText = ''; // 當前音訊塊的累積文字
  const allSegments: Array<{ text: string; start: number; end: number }> = [];

  // 創建串流器並設定回調
  const streamer = new WhisperTextStreamer(resources.pipeline.tokenizer, {
    // 總是執行內部邏輯，然後呼叫使用者的回調
    on_chunk_start: () => {
      currentPartial = '';
      currentDisplay = '';
      lastPartialLength = 0;
      currentChunkText = ''; // 重置當前塊的文字

      whisperEvents.dispatchEvent(new CustomEvent('stream-chunk-start', {
        detail: { timestamp: Date.now() }
      }));

      // 如果使用者提供了自訂的 on_chunk_start，也呼叫它
      if (options?.streamCallbacks?.on_chunk_start) {
        options.streamCallbacks.on_chunk_start();
      }
    },

    callback_function: (partial: string) => {
      const p = partial || '';

      // 使用長度比較策略判斷是累積還是新詞
      if (p.length > lastPartialLength) {
        // 累積模式 - partial 在增長（例如："測" → "測試"）
        currentDisplay = p;
      } else {
        // 新詞模式 - 先提交之前的文字到當前塊
        if (currentDisplay && currentDisplay.trim()) {
          // 在當前音訊塊內累積文字（不加空格）
          currentChunkText += currentDisplay.trim();
        }
        // 開始新詞
        currentDisplay = p;
      }

      lastPartialLength = p.length;

      // 發送當前的部分結果和已確認的文字
      // 已確認文字 = 之前的 committedText + 當前塊的累積文字
      const displayCommitted = committedText + currentChunkText;

      whisperEvents.dispatchEvent(new CustomEvent('stream-partial', {
        detail: {
          partial: currentDisplay,
          committed: displayCommitted
        }
      }));

      // 如果使用者提供了自訂的 callback_function，也呼叫它
      if (options?.streamCallbacks?.callback_function) {
        options.streamCallbacks.callback_function(partial);
      }
    },

    token_callback_function: options?.streamCallbacks?.token_callback_function,

    on_chunk_end: () => {
      // 提交最後的顯示文字到當前塊
      if (currentDisplay && currentDisplay.trim()) {
        currentChunkText += currentDisplay.trim();
      }

      // 將當前塊的文字加入到已確認文字（音訊塊之間加空格）
      if (currentChunkText) {
        if (committedText) {
          committedText += ' ' + currentChunkText;
        } else {
          committedText = currentChunkText;
        }
      }

      whisperEvents.dispatchEvent(new CustomEvent('stream-chunk-end', {
        detail: {
          committed: committedText,
          timestamp: Date.now()
        }
      }));

      // 如果使用者提供了自訂的 on_chunk_end，也呼叫它
      if (options?.streamCallbacks?.on_chunk_end) {
        options.streamCallbacks.on_chunk_end();
      }

      // 清空當前塊的文字和顯示
      currentChunkText = '';
      currentDisplay = '';
      lastPartialLength = 0;
    },

    on_finalize: (finalText: string | undefined) => {
      // 使用提供的最終文字或已累積的文字
      const finalResult = finalText || committedText || '';

      // 發送事件
      whisperEvents.dispatchEvent(new CustomEvent('stream-finalize', {
        detail: {
          text: finalResult,
          timestamp: Date.now()
        }
      }));

      // 如果使用者提供了自訂的 on_finalize，也呼叫它
      if (options?.streamCallbacks?.on_finalize) {
        options.streamCallbacks.on_finalize(finalResult);
      }
    }
  });

  // 準備管道選項
  const pipelineOptions: any = {
    // 語言規格
    ...(options?.language && { language: options.language }),

    // 任務類型（轉錄或翻譯）
    ...(options?.task && { task: options.task }),

    // 返回片段時間戳
    return_timestamps: options?.returnSegments ?? false,

    // 串流設定
    chunk_length_s: options?.chunk_length_s ?? cfg.whisper.streaming.chunkLengthSeconds,
    stride_length_s: options?.stride_length_s ?? cfg.whisper.streaming.strideLengthSeconds,
    streamer: streamer,

    // 傳遞任何額外選項
    ...options,
  };

  // 執行語音辨識管道（串流模式）
  const output = await resources.pipeline(audio, pipelineOptions);

  // 格式化結果
  const result: WhisperResult = {
    text: output?.text || committedText || '',
  };

  // 如果請求且可用，添加時間戳片段
  if (options?.returnSegments && output?.chunks) {
    result.segments = output.chunks.map((chunk: any) => ({
      text: chunk.text || '',
      start: chunk.timestamp?.[0] ?? 0,
      end: chunk.timestamp?.[1] ?? 0,
    }));
  }

  // 發出轉錄完成事件
  whisperEvents.dispatchEvent(new CustomEvent('transcription-complete', {
    detail: {
      text: result.text,
      duration: startTime ? Date.now() - startTime : 0
    }
  }));

  return result;
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