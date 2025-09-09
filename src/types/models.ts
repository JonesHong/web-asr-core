/**
 * 模型註冊表和配置類型定義
 * 
 * 定義模型註冊表系統相關的類型，用於管理 VAD、喚醒詞和 Whisper 模型。
 * 
 * @fileoverview 模型註冊表類型定義
 * @author WebASRCore Team
 */

/**
 * 模型資訊介面
 * 
 * @description 描述單個模型的詳細資訊
 * @interface ModelInfo
 */
export interface ModelInfo {
  /** 模型唯一識別符 */
  id: string;
  /** 模型名稱 */
  name?: string;
  /** 模型類型 */
  type: 'vad' | 'wakeword' | 'asr';
  /** 本地路徑 */
  local_path: string;
  /** 模型描述 */
  description?: string;
  /** 模型規格 */
  specs?: {
    /** 是否為量化模型 */
    quantized?: boolean;
    /** 檢測闾值 */
    threshold?: number;
    /** 支援語言 */
    language?: string;
    /** 其他扩展屬性 */
    [key: string]: any;
  };
  /** 模型檔案 */
  files?: {
    /** 必需檔案 */
    required?: string[];
    /** 可選檔案 */
    optional?: string[];
  };
}

/**
 * 模型註冊表介面
 * 
 * @description 完整的模型註冊表結構
 * @interface Registry
 */
export interface Registry {
  /** 註冊表版本 */
  version: string;
  /** 模型清單 */
  models: ModelInfo[];
  /** 全局配置 */
  configs?: {
    [key: string]: any;
  };
}

/**
 * Whisper 模型資訊
 * 
 * @description Whisper 模型的簡化資訊
 * @interface WhisperModelInfo
 */
export interface WhisperModelInfo {
  /** 模型 ID */
  id: string;
  /** 模型路徑 */
  path: string;
  /** 是否為量化模型 */
  quantized?: boolean;
  /** 模型名稱 */
  name?: string;
}

/**
 * 喚醒詞模型資訊
 * 
 * @description 喚醒詞模型的配置資訊
 * @interface WakewordInfo
 */
export interface WakewordInfo {
  /** 模型 ID */
  id: string;
  /** 檢測器模型 URL */
  detectorUrl: string;
  /** 檢測闾值 */
  threshold: number;
  /** 嵌入模型 URL */
  embeddingUrl: string;
  /** 梅爾頻譜模型 URL */
  melspecUrl: string;
}

/**
 * VAD 模型資訊
 * 
 * @description VAD 模型的配置資訊
 * @interface VadInfo
 */
export interface VadInfo {
  /** 模型 ID */
  id: string;
  /** 模型 URL */
  modelUrl: string;
}