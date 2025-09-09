/**
 * 音訊類型定義
 * 
 * 定義音訊處理相關的基礎類型和設定，包括音訊塊格式、參數和標準配置。
 * 
 * @fileoverview 音訊處理基礎類型定義
 * @author WebASRCore Team
 */

/**
 * 音訊塊格式 - 單聲道 16kHz PCM
 * 
 * @description 用於所有音訊處理服務的標準音訊塊格式
 * @example
 * ```typescript
 * const audioChunk: AudioChunk = new Float32Array(1280);
 * ```
 */
export type AudioChunk = Float32Array;

/**
 * 音訊參數介面
 * 
 * @description 定義音訊的基本參數，包括取樣率和聲道數
 */
export interface AudioParams {
  /** 取樣率（Hz） */
  sampleRate: number;
  /** 聲道數 */
  channels: number;
}

/**
 * 所有服務的標準音訊配置
 * 
 * @description 統一的音訊配置，確保所有服務使用相同的音訊格式
 * @constant
 */
export const STANDARD_AUDIO_CONFIG: AudioParams = {
  sampleRate: 16000,  // 16kHz 取樣率
  channels: 1         // 單聲道
};

/**
 * 標準處理塊大小（16kHz 下的 80ms）
 * 
 * @description 標準的音訊塊大小，相當於 16kHz 取樣率下 80 毫秒的音訊資料
 * @constant
 */
export const STANDARD_CHUNK_SIZE = 1280;