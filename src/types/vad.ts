/**
 * VAD（語音活動檢測）類型定義
 * 
 * 定義 VAD 服務相關的狀態、參數和結果類型，使用 Silero VAD v6 模型。
 * 
 * @fileoverview VAD 語音活動檢測類型定義
 * @author WebASRCore Team
 */

/**
 * VAD 狀態，包含 LSTM 隱藏狀態和檢測狀態
 * 
 * @description 用於維護 VAD 處理的內部狀態，包括神經網路狀態和語音檢測邏輯
 * @interface VadState
 */
export interface VadState {
  /** LSTM 狀態 [2, 1, 128] - 合併的 h 和 c 狀態 */
  state: Float32Array;
  /** 前一個上下文樣本（前一塊的最後 64 個樣本） */
  contextSamples: Float32Array;
  /** 語音持續的延遲計數器 */
  hangoverCounter: number;
  /** 目前語音活動狀態 */
  isSpeechActive: boolean;
}

/**
 * VAD 處理參數
 * 
 * @description 配置 VAD 處理行為的參數
 * @interface VadParams
 */
export interface VadParams {
  /** 取樣率（應為 16000） */
  sampleRate: number;
  /** 檢測閾值（0-1，通常為 0.5） */
  threshold: number;
  /** 檢測結果下降後繼續語音的幀數 */
  hangoverFrames: number;
}

/**
 * VAD 處理結果
 * 
 * @description VAD 處理單個音訊塊後的結果
 * @interface VadResult
 */
export interface VadResult {
  /** 是否在此塊中檢測到語音 */
  detected: boolean;
  /** 原始 VAD 分數（0-1） */
  score: number;
  /** 下一次迭代的更新 VAD 狀態 */
  state: VadState;
}

/**
 * 預設 VAD 參數
 * 
 * @description Silero VAD v6 的推薦參數配置
 * @constant
 */
export const DEFAULT_VAD_PARAMS: VadParams = {
  sampleRate: 16000,      // 16kHz 取樣率
  threshold: 0.5,         // 50% 檢測閾值
  hangoverFrames: 12      // 12 幀延遲（約 750ms）
};