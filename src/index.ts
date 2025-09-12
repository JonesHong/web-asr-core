/**
 * WebASRCore - VAD、喚醒詞和 Whisper 的無狀態 TypeScript 服務
 * 
 * 為基於瀏覽器的語音處理提供純淨、無狀態服務的集合：
 * - VAD（語音活動檢測）使用 Silero VAD
 * - 使用 OpenWakeWord 模型進行喚醒詞檢測
 * - 通過 transformers.js 使用 Whisper 模型進行語音辨識
 * 
 * 所有服務都採用無狀態的函數式設計，狀態由呼叫者維護並在函數呼叫間傳遞。
 * 
 * @author WebASRCore Team
 * @version 0.1.0
 * @license MIT
 */

// 匯出所有類型定義
export * from './types';

// 匯出註冊表函數
export {
  loadRegistry,
  resolveWakeword,
  resolveVad,
  resolveWhisper,
  getAvailableModels,
} from './registry/registry';

// 匯出 ONNX Runtime 工具函數
export {
  initializeOrt,
  loadOnnxFromUrl,
  createSession,
  createSessions,
  getSessionMetadata,
  createTensor,
} from './runtime/ort';

// 匯出 ORT 優化服務
export {
  ORTService,
  ortService,
} from './services/ort';

// 匯出 VAD 服務
export {
  loadVadSession,
  createVadState,
  processVad,
  processVadChunks,
  createDefaultVadParams,
} from './services/vad';

// 匯出喚醒詞服務
export {
  loadWakewordResources,
  detectWakewordDims,
  createWakewordState,
  processWakewordChunk,
  resetWakewordState,
  createDefaultWakewordParams,
} from './services/wakeword';

// 匯出 Whisper 服務
export {
  loadWhisperResources,
  transcribe,
  chunkAudioForTranscription,
  transcribeChunks,
  createDefaultWhisperOptions,
} from './services/whisper';

// 匯出配置管理器
export {
  ConfigManager,
  defaultConfig,
} from './utils/config-manager';

// 匯出系統診斷工具
export {
  SystemDiagnostics,
  systemDiagnostics,
  type SystemDiagnosis,
} from './utils/system-diagnostics';

// 匯出音訊工具
export {
  AudioRingBuffer,
} from './utils/AudioRingBuffer';

export {
  AudioChunker,
  MultiChannelAudioChunker,
} from './utils/AudioChunker';

// 匯出計時器服務
export {
  Timer,
  TimerManager,
  type TimerState,
  type TimerParams,
} from './services/timer';

// 匯出音訊重採樣服務
export {
  AudioResampler,
  ResamplingAlgorithm,
  ResamplerPresets,
  getResampler,
  resampleAudio,
  resampleTo16kHz,
  type ResamplingOptions,
} from './services/audio-resampler';

// 匯出音訊擷取服務
export {
  AudioCapture,
  getAudioCapture,
  startAudioCapture,
  listMicrophones,
  type AudioDeviceInfo,
  type AudioCaptureOptions,
  type AudioDataCallback,
  type CaptureState,
} from './services/audio-capture';

// 為方便起見重新匯出 onnxruntime-web 類型
export type { InferenceSession, Tensor } from 'onnxruntime-web';

/** 版本號 */
export const VERSION = '0.1.0';

// 預設設定
export { DEFAULT_VAD_PARAMS } from './types/vad';
export { DEFAULT_WAKEWORD_PARAMS } from './types/wakeword';
export { STANDARD_AUDIO_CONFIG, STANDARD_CHUNK_SIZE } from './types/audio';