/**
 * Whisper 語音辨識類型定義
 * 
 * 定義 Whisper 語音辨識服務相關的資源、選項和結果類型，使用 transformers.js 框架。
 * 
 * @fileoverview Whisper 語音辨識類型定義
 * @author WebASRCore Team
 */

/**
 * Whisper 模型資源
 * 
 * @description Whisper 語音辨識所需的模型資源
 * @interface WhisperResources
 */
export interface WhisperResources {
  /** Transformers.js 管線實例 */
  pipeline: any; // 等 @xenova/transformers 支援 TypeScript 時將正確輸入類型
  /** 模型識別符 */
  modelId: string;
}

/**
 * Whisper 串流回調介面
 *
 * @description WhisperTextStreamer 的回調函數介面
 * @interface WhisperStreamCallbacks
 */
export interface WhisperStreamCallbacks {
  /** 串流塊開始時觸發 */
  on_chunk_start?: () => void;
  /** 接收到部分文字時觸發 */
  callback_function?: (partial: string) => void;
  /** 接收到 token 時觸發 */
  token_callback_function?: (token: any) => void;
  /** 串流塊結束時觸發 */
  on_chunk_end?: () => void;
  /** 最終完成時觸發 */
  on_finalize?: (finalText: string) => void;
}

/**
 * Whisper 轉錄選項
 *
 * @description 配置 Whisper 轉錄行為的選項
 * @interface WhisperOptions
 */
export interface WhisperOptions {
  /** 語言代碼（例如 'en'、'zh'） */
  language?: string;
  /** 任務類型 */
  task?: 'transcribe' | 'translate';
  /** 是否返回時間戳片段 */
  returnSegments?: boolean;
  /** 是否啟用串流模式 */
  streaming?: boolean;
  /** 串流回調函數 */
  streamCallbacks?: WhisperStreamCallbacks;
  /** 串流塊長度（秒） */
  chunk_length_s?: number;
  /** 串流步長（秒） */
  stride_length_s?: number;
  /** 管線的其他選項 */
  [key: string]: any;
}

/**
 * Whisper 轉錄結果
 * 
 * @description Whisper 語音轉錄的結果
 * @interface WhisperResult
 */
export interface WhisperResult {
  /** 完整轉錄文本 */
  text: string;
  /** 時間戳片段（如果請求） */
  segments?: Array<{
    /** 片段文本 */
    text: string;
    /** 開始時間（秒） */
    start: number;
    /** 結束時間（秒） */
    end: number;
  }>;
}

/**
 * Whisper 模型載入選項
 * 
 * @description 配置 Whisper 模型載入的選項
 * @interface WhisperLoadOptions
 */
export interface WhisperLoadOptions {
  /** 是否使用量化模型 */
  quantized?: boolean;
  /** 模型的本地基礎路徑 */
  localBasePath?: string;
  /** ONNX runtime 的 WASM 檔案路徑 */
  wasmPaths?: string;
  /** 執行裝置：'webgpu' 使用 GPU、'wasm' 使用 CPU、'auto' 自動選擇 */
  device?: 'webgpu' | 'wasm' | 'auto';
  /** 資料類型：'fp32' 全精度、'fp16' 半精度、'q8' 8位量化、'q4' 4位量化 */
  dtype?: 'fp32' | 'fp16' | 'q8' | 'q4';
  /** 進度回調函數 */
  progress_callback?: (data: any) => void;
}