/**
 * WebASRCore 服務事件枚舉定義
 *
 * 此文件定義了所有服務使用的事件常量，替代硬編碼的字符串
 * 提供類型安全和開發者友好的事件管理
 */

/**
 * 基礎通用事件
 * 所有服務都會使用的基本事件
 */
export enum BaseEvents {
  READY = 'ready',
  ERROR = 'error',
  STATISTICS = 'statistics'
}

/**
 * Speech Service 事件
 * 語音服務相關的所有事件
 */
export enum SpeechEvents {
  // 基礎事件
  READY = BaseEvents.READY,
  ERROR = BaseEvents.ERROR,

  // STT (Speech-to-Text) 事件
  STT_START = 'stt-start',
  STT_AUDIOSTART = 'stt-audiostart',
  STT_SPEECHSTART = 'stt-speechstart',
  STT_SPEECHEND = 'stt-speechend',
  STT_AUDIOEND = 'stt-audioend',
  STT_RESULT = 'stt-result',
  STT_NOMATCH = 'stt-nomatch',
  STT_END = 'stt-end',

  // TTS (Text-to-Speech) 事件
  TTS_START = 'tts-start',
  TTS_END = 'tts-end',
  TTS_PAUSE = 'tts-pause',
  TTS_RESUME = 'tts-resume',
  TTS_BOUNDARY = 'tts-boundary',
  TTS_MARK = 'tts-mark'
}

/**
 * Timer Service 事件
 * 計時器服務相關的所有事件
 */
export enum TimerEvents {
  // 基礎事件
  READY = BaseEvents.READY,
  ERROR = BaseEvents.ERROR,

  // 計時器控制事件
  START = 'start',
  PAUSE = 'pause',
  RESUME = 'resume',
  STOP = 'stop',
  RESET = 'reset',

  // 計時器狀態事件
  TICK = 'tick',
  TIMEOUT = 'timeout'
}

/**
 * VAD (Voice Activity Detection) Service 事件
 * 語音活動檢測服務相關的所有事件
 */
export enum VadEvents {
  // 基礎事件
  READY = BaseEvents.READY,
  ERROR = BaseEvents.ERROR,
  STATISTICS = BaseEvents.STATISTICS,

  // VAD 處理事件
  PROCESS = 'vadProcess',
  SPEECH_START = 'speechStart',
  SPEECH_END = 'speechEnd'
}

/**
 * Wakeword Service 事件
 * 喚醒詞檢測服務相關的所有事件
 */
export enum WakewordEvents {
  // 基礎事件
  READY = BaseEvents.READY,
  ERROR = BaseEvents.ERROR,
  STATISTICS = BaseEvents.STATISTICS,

  // 喚醒詞檢測事件
  PROCESS = 'wakewordProcess',
  WAKEWORD_DETECTED = 'wakewordDetected'
}

/**
 * Whisper Service 事件
 * Whisper 語音識別服務相關的所有事件
 */
export enum WhisperEvents {
  // 基礎事件
  READY = BaseEvents.READY,
  ERROR = BaseEvents.ERROR,
  STATISTICS = BaseEvents.STATISTICS,

  // 轉錄處理事件
  TRANSCRIPTION_START = 'transcriptionStart',
  TRANSCRIPTION_COMPLETE = 'transcriptionComplete',
  TRANSCRIPTION_PROGRESS = 'transcriptionProgress',

  // 流式處理事件
  STREAM_CHUNK_START = 'streamChunkStart',
  STREAM_PARTIAL = 'streamPartial',
  STREAM_CHUNK_END = 'streamChunkEnd',
  STREAM_FINALIZE = 'streamFinalize'
}

/**
 * 所有事件的聯合類型
 * 用於類型檢查和工具函數
 */
export type AllEvents =
  | SpeechEvents
  | TimerEvents
  | VadEvents
  | WakewordEvents
  | WhisperEvents;

/**
 * 事件數據接口定義
 * 定義每個事件攜帶的數據結構
 */
export interface EventDataMap {
  // 基礎事件數據
  [BaseEvents.READY]: {
    timestamp: number;
    service?: string;
  };
  [BaseEvents.ERROR]: {
    message: string;
    code?: string;
    timestamp: number;
    service?: string;
  };
  [BaseEvents.STATISTICS]: {
    [key: string]: any;
  };

  // Speech Service 事件數據
  [SpeechEvents.STT_START]: { timestamp: number };
  [SpeechEvents.STT_AUDIOSTART]: { timestamp: number };
  [SpeechEvents.STT_SPEECHSTART]: { timestamp: number };
  [SpeechEvents.STT_SPEECHEND]: { timestamp: number };
  [SpeechEvents.STT_AUDIOEND]: { timestamp: number };
  [SpeechEvents.STT_RESULT]: {
    transcript: string;
    isFinal: boolean;
    confidence?: number;
    timestamp: number;
  };
  [SpeechEvents.STT_NOMATCH]: { timestamp: number };
  [SpeechEvents.STT_END]: { timestamp: number };
  [SpeechEvents.TTS_START]: {
    text: string;
    voice?: string;
    timestamp: number;
  };
  [SpeechEvents.TTS_END]: {
    text: string;
    duration?: number;
    timestamp: number;
  };
  [SpeechEvents.TTS_PAUSE]: { timestamp: number };
  [SpeechEvents.TTS_RESUME]: { timestamp: number };
  [SpeechEvents.TTS_BOUNDARY]: {
    word: string;
    charIndex: number;
    timestamp: number;
  };
  [SpeechEvents.TTS_MARK]: {
    name: string;
    timestamp: number;
  };

  // Timer Service 事件數據
  [TimerEvents.START]: {
    id: string;
    duration: number;
    timestamp: number;
  };
  [TimerEvents.PAUSE]: {
    id: string;
    remaining: number;
    timestamp: number;
  };
  [TimerEvents.RESUME]: {
    id: string;
    remaining: number;
    timestamp: number;
  };
  [TimerEvents.STOP]: {
    id: string;
    timestamp: number;
  };
  [TimerEvents.RESET]: {
    id: string;
    timestamp: number;
  };
  [TimerEvents.TICK]: {
    id: string;
    remaining: number;
    progress: number;
    timestamp: number;
  };
  [TimerEvents.TIMEOUT]: {
    id: string;
    duration: number;
    timestamp: number;
  };

  // VAD Service 事件數據
  [VadEvents.PROCESS]: {
    score: number;
    isSpeech: boolean;
    timestamp: number;
  };
  [VadEvents.SPEECH_START]: {
    score: number;
    timestamp: number;
  };
  [VadEvents.SPEECH_END]: {
    duration: number;
    timestamp: number;
  };

  // Wakeword Service 事件數據
  [WakewordEvents.PROCESS]: {
    scores: Record<string, number>;
    timestamp: number;
  };
  [WakewordEvents.WAKEWORD_DETECTED]: {
    word: string;
    score: number;
    timestamp: number;
  };

  // Whisper Service 事件數據
  [WhisperEvents.TRANSCRIPTION_START]: {
    duration?: number;
    timestamp: number;
  };
  [WhisperEvents.TRANSCRIPTION_COMPLETE]: {
    text: string;
    duration: number;
    timestamp: number;
  };
  [WhisperEvents.TRANSCRIPTION_PROGRESS]: {
    progress: number;
    timestamp: number;
  };
  [WhisperEvents.STREAM_CHUNK_START]: {
    timestamp: number;
  };
  [WhisperEvents.STREAM_PARTIAL]: {
    text: string;
    timestamp: number;
  };
  [WhisperEvents.STREAM_CHUNK_END]: {
    timestamp: number;
  };
  [WhisperEvents.STREAM_FINALIZE]: {
    text: string;
    timestamp: number;
  };
}

/**
 * 工具函數：獲取服務的所有事件
 */
export const getServiceEvents = {
  speech: () => Object.values(SpeechEvents),
  timer: () => Object.values(TimerEvents),
  vad: () => Object.values(VadEvents),
  wakeword: () => Object.values(WakewordEvents),
  whisper: () => Object.values(WhisperEvents)
};

/**
 * 工具函數：檢查事件是否屬於特定服務
 */
export const isServiceEvent = {
  speech: (event: string): event is SpeechEvents =>
    Object.values(SpeechEvents).includes(event as SpeechEvents),
  timer: (event: string): event is TimerEvents =>
    Object.values(TimerEvents).includes(event as TimerEvents),
  vad: (event: string): event is VadEvents =>
    Object.values(VadEvents).includes(event as VadEvents),
  wakeword: (event: string): event is WakewordEvents =>
    Object.values(WakewordEvents).includes(event as WakewordEvents),
  whisper: (event: string): event is WhisperEvents =>
    Object.values(WhisperEvents).includes(event as WhisperEvents)
};