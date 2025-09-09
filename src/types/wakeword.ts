/**
 * 喚醒詞檢測類型定義
 * 
 * 定義喚醒詞檢測服務相關的資源、狀態、參數和結果類型，使用 OpenWakeWord 模型。
 * 
 * @fileoverview 喚醒詞檢測類型定義
 * @author WebASRCore Team
 */

import type { InferenceSession } from 'onnxruntime-web';

/**
 * 喚醒詞模型資源
 * 
 * @description 喚醒詞檢測所需的三個 ONNX 模型會話
 * @interface WakewordResources
 */
export interface WakewordResources {
  /** 梅爾頻譜圖模型會話 */
  melspec: InferenceSession;
  /** 嵌入模型會話 */
  embedding: InferenceSession;
  /** 檢測器模型會話 */
  detector: InferenceSession;
  /** 模型維度 */
  dims: {
    /** 嵌入緩衝區大小 */
    embeddingBufferSize: number;
    /** 嵌入維度 */
    embeddingDimension: number;
  };
}

/**
 * 喚醒詞處理狀態
 * 
 * @description 維護喚醒詞檢測的緩衝狀態
 * @interface WakewordState
 */
export interface WakewordState {
  /** 梅爾頻譜圖幀緩衝區（每個 32 維） */
  melBuffer: Float32Array[];
  /** 嵌入幀緩衝區 */
  embeddingBuffer: Float32Array[];
}

/**
 * 喚醒詞處理參數
 * 
 * @description 配置喚醒詞檢測行為的參數
 * @interface WakewordParams
 */
export interface WakewordParams {
  /** 檢測閾值（0-1，通常為 0.5） */
  threshold: number;
  /** 每個音訊塊的梅爾幀數（預設 5） */
  melFramesPerChunk?: number;
  /** 嵌入所需的梅爾幀數（預設 76） */
  requiredMelFrames?: number;
  /** 滑動窗口的梅爾緩衝區步長（預設 8） */
  melStride?: number;
}

/**
 * 喚醒詞檢測結果
 * 
 * @description 喚醒詞檢測單個音訊塊後的結果
 * @interface WakewordResult
 */
export interface WakewordResult {
  /** 檢測分數（0-1） */
  score: number;
  /** 是否觸發喚醒詞 */
  triggered: boolean;
  /** 下一次迭代的更新狀態 */
  state: WakewordState;
}

/**
 * 預設喚醒詞參數
 * 
 * @description OpenWakeWord 模型的推薦參數配置
 * @constant
 */
export const DEFAULT_WAKEWORD_PARAMS: WakewordParams = {
  threshold: 0.5,           // 50% 檢測閾值
  melFramesPerChunk: 5,     // 每塊 5 個梅爾幀
  requiredMelFrames: 76,    // 需要 76 個梅爾幀進行嵌入
  melStride: 8              // 滑動窗口步長 8
};