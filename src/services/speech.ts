/**
 * Web Speech API 純函數服務
 * 
 * @description 提供語音合成（TTS）和語音識別（STT）的無狀態純函數實作
 * 
 * 架構設計：
 * 1. Resources: SpeechSynthesis/SpeechRecognition 實例（重複使用）
 * 2. State: 語音狀態（由呼叫者維護）
 * 3. Processing: 純函數處理（無副作用）
 * 
 * @module speech
 */

import { ConfigManager } from '../utils/config-manager';

/**
 * TTS（文字轉語音）資源
 */
export interface TTSResources {
    /** 語音合成器實例 */
    synth: SpeechSynthesis;
    /** 可用的語音列表 */
    voices: SpeechSynthesisVoice[];
    /** 是否支援語音合成 */
    isSupported: boolean;
}

/**
 * STT（語音轉文字）資源
 */
export interface STTResources {
    /** 語音識別器實例 */
    recognition: any | null;  // SpeechRecognition 型別不一定存在
    /** 是否支援語音識別 */
    isSupported: boolean;
    /** 支援的語言列表 */
    supportedLanguages: string[];
}

/**
 * TTS 狀態
 */
export interface TTSState {
    /** 是否正在說話 */
    isSpeaking: boolean;
    /** 是否暫停 */
    isPaused: boolean;
    /** 當前文字 */
    currentText: string;
    /** 當前語音 */
    currentVoice: string | null;
    /** 語速（0.1-10） */
    rate: number;
    /** 音調（0-2） */
    pitch: number;
    /** 音量（0-1） */
    volume: number;
    /** 佇列中的文字 */
    queue: string[];
}

/**
 * STT 狀態
 */
export interface STTState {
    /** 是否正在監聽 */
    isListening: boolean;
    /** 是否連續識別 */
    continuous: boolean;
    /** 識別語言 */
    language: string;
    /** 暫時結果 */
    interimTranscript: string;
    /** 最終結果 */
    finalTranscript: string;
    /** 置信度分數 */
    confidence: number;
    /** 錯誤訊息 */
    error: string | null;
    /** 無語音超時計數器 */
    noSpeechCounter: number;
}

/**
 * TTS 參數
 */
export interface TTSParams {
    /** 要說的文字 */
    text: string;
    /** 語音名稱或語言代碼 */
    voice?: string;
    /** 語速（0.1-10，預設 1） */
    rate?: number;
    /** 音調（0-2，預設 1） */
    pitch?: number;
    /** 音量（0-1，預設 1） */
    volume?: number;
    /** 是否加入佇列（預設 false，會中斷當前語音） */
    queue?: boolean;
}

/**
 * STT 參數
 */
export interface STTParams {
    /** 識別語言（預設 'zh-TW'） */
    language?: string;
    /** 是否連續識別（預設 false） */
    continuous?: boolean;
    /** 是否返回暫時結果（預設 true） */
    interimResults?: boolean;
    /** 最大替代結果數（預設 1） */
    maxAlternatives?: number;
}

/**
 * TTS 結果
 */
export interface TTSResult {
    /** 更新後的狀態 */
    state: TTSState;
    /** 是否成功開始說話 */
    started: boolean;
    /** 錯誤訊息 */
    error?: string;
}

/**
 * STT 結果
 */
export interface STTResult {
    /** 更新後的狀態 */
    state: STTState;
    /** 識別的文字 */
    transcript: string;
    /** 是否為最終結果 */
    isFinal: boolean;
    /** 置信度（0-1） */
    confidence: number;
    /** 替代結果 */
    alternatives?: Array<{
        transcript: string;
        confidence: number;
    }>;
}

/**
 * 載入 TTS 資源
 * 
 * @returns TTS 資源物件
 */
export async function loadTTSResources(): Promise<TTSResources> {
    const isSupported = 'speechSynthesis' in window;
    
    if (!isSupported) {
        return {
            synth: null as any,
            voices: [],
            isSupported: false
        };
    }
    
    const synth = window.speechSynthesis;
    
    // 等待語音列表載入
    let voices = synth.getVoices();
    if (voices.length === 0) {
        // 某些瀏覽器需要先觸發 speak 才會載入語音列表
        // 使用一個靜默的語音來觸發載入
        const silentUtterance = new SpeechSynthesisUtterance(' ');
        silentUtterance.volume = 0;
        silentUtterance.rate = 10; // 最快速度
        
        // 設定事件監聽器
        const voicesLoadedPromise = new Promise<void>(resolve => {
            const handleVoicesChanged = () => {
                if (synth.getVoices().length > 0) {
                    resolve();
                }
            };
            
            synth.addEventListener('voiceschanged', handleVoicesChanged);
            
            // 設定超時以防止無限等待
            setTimeout(() => {
                synth.removeEventListener('voiceschanged', handleVoicesChanged);
                resolve();
            }, 2000);
        });
        
        // 觸發靜音語音
        synth.speak(silentUtterance);
        
        // 等待語音載入或超時
        await voicesLoadedPromise;
        
        // 取消靜音語音
        synth.cancel();
        
        // 再次獲取語音列表
        voices = synth.getVoices();
    }
    
    return {
        synth,
        voices,
        isSupported: true
    };
}

/**
 * 載入 STT 資源
 * 
 * @returns STT 資源物件
 */
export function loadSTTResources(): STTResources {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const isSupported = !!SpeechRecognition;
    
    if (!isSupported) {
        return {
            recognition: null,
            isSupported: false,
            supportedLanguages: []
        };
    }
    
    const recognition = new SpeechRecognition();
    
    // 常見支援的語言
    const supportedLanguages = [
        'zh-TW', 'zh-CN', 'en-US', 'en-GB',
        'ja-JP', 'ko-KR', 'es-ES', 'fr-FR',
        'de-DE', 'it-IT', 'pt-BR', 'ru-RU'
    ];
    
    return {
        recognition,
        isSupported: true,
        supportedLanguages
    };
}

/**
 * 創建初始 TTS 狀態
 * 
 * @param config 配置管理器
 * @returns 初始 TTS 狀態
 */
export function createTTSState(config?: ConfigManager): TTSState {
    const cfg = config || ConfigManager.getInstance();
    const speechConfig = cfg.speech?.tts || {
        defaultRate: 1,
        defaultPitch: 1,
        defaultVolume: 1,
        defaultVoice: null
    };
    
    return {
        isSpeaking: false,
        isPaused: false,
        currentText: '',
        currentVoice: speechConfig.defaultVoice,
        rate: speechConfig.defaultRate,
        pitch: speechConfig.defaultPitch,
        volume: speechConfig.defaultVolume,
        queue: []
    };
}

/**
 * 創建初始 STT 狀態
 * 
 * @param config 配置管理器
 * @returns 初始 STT 狀態
 */
export function createSTTState(config?: ConfigManager): STTState {
    const cfg = config || ConfigManager.getInstance();
    const speechConfig = cfg.speech?.stt || {
        defaultLanguage: 'zh-TW',
        continuous: false
    };
    
    return {
        isListening: false,
        continuous: speechConfig.continuous,
        language: speechConfig.defaultLanguage,
        interimTranscript: '',
        finalTranscript: '',
        confidence: 0,
        error: null,
        noSpeechCounter: 0
    };
}

/**
 * 開始說話（TTS）
 * 
 * @param resources TTS 資源
 * @param state 當前狀態
 * @param params 說話參數
 * @returns 更新後的結果
 */
export function speak(
    resources: TTSResources,
    state: TTSState,
    params: TTSParams
): TTSResult {
    if (!resources.isSupported) {
        return {
            state,
            started: false,
            error: 'TTS not supported'
        };
    }
    
    const { text, voice, rate = 1, pitch = 1, volume = 1, queue = false } = params;
    
    // 如果不是佇列模式，先取消當前語音
    if (!queue && state.isSpeaking) {
        resources.synth.cancel();
    }
    
    // 創建語音實例
    const utterance = new SpeechSynthesisUtterance(text);
    
    // 設定語音參數
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.volume = volume;
    
    // 設定語音
    if (voice) {
        const selectedVoice = resources.voices.find(v => 
            v.name === voice || v.lang === voice
        );
        if (selectedVoice) {
            utterance.voice = selectedVoice;
        }
    }
    
    // 更新狀態
    const newState: TTSState = {
        ...state,
        isSpeaking: true,
        isPaused: false,
        currentText: text,
        currentVoice: voice || state.currentVoice,
        rate,
        pitch,
        volume,
        queue: queue ? [...state.queue, text] : []
    };
    
    // 開始說話
    resources.synth.speak(utterance);
    
    return {
        state: newState,
        started: true
    };
}

/**
 * 暫停說話
 * 
 * @param resources TTS 資源
 * @param state 當前狀態
 * @returns 更新後的狀態
 */
export function pauseSpeech(
    resources: TTSResources,
    state: TTSState
): TTSState {
    if (!resources.isSupported || !state.isSpeaking) {
        return state;
    }
    
    resources.synth.pause();
    
    return {
        ...state,
        isPaused: true
    };
}

/**
 * 恢復說話
 * 
 * @param resources TTS 資源
 * @param state 當前狀態
 * @returns 更新後的狀態
 */
export function resumeSpeech(
    resources: TTSResources,
    state: TTSState
): TTSState {
    if (!resources.isSupported || !state.isPaused) {
        return state;
    }
    
    resources.synth.resume();
    
    return {
        ...state,
        isPaused: false
    };
}

/**
 * 停止說話
 * 
 * @param resources TTS 資源
 * @param state 當前狀態
 * @returns 更新後的狀態
 */
export function stopSpeech(
    resources: TTSResources,
    state: TTSState
): TTSState {
    if (!resources.isSupported) {
        return state;
    }
    
    resources.synth.cancel();
    
    return {
        ...state,
        isSpeaking: false,
        isPaused: false,
        currentText: '',
        queue: []
    };
}

/**
 * 開始語音識別（STT）
 * 
 * @param resources STT 資源
 * @param state 當前狀態
 * @param params 識別參數
 * @returns 更新後的狀態
 */
export function startRecognition(
    resources: STTResources,
    state: STTState,
    params: STTParams = {}
): STTState {
    if (!resources.isSupported || !resources.recognition) {
        return {
            ...state,
            error: 'STT not supported'
        };
    }
    
    const {
        language = 'zh-TW',
        continuous = false,
        interimResults = true,
        maxAlternatives = 1
    } = params;
    
    // 設定識別參數
    resources.recognition.lang = language;
    resources.recognition.continuous = continuous;
    resources.recognition.interimResults = interimResults;
    resources.recognition.maxAlternatives = maxAlternatives;
    
    // 開始識別
    try {
        resources.recognition.start();
        
        return {
            ...state,
            isListening: true,
            continuous,
            language,
            error: null,
            noSpeechCounter: 0
        };
    } catch (error) {
        return {
            ...state,
            isListening: false,
            error: error instanceof Error ? error.message : 'Failed to start recognition'
        };
    }
}

/**
 * 停止語音識別
 * 
 * @param resources STT 資源
 * @param state 當前狀態
 * @returns 更新後的狀態
 */
export function stopRecognition(
    resources: STTResources,
    state: STTState
): STTState {
    if (!resources.isSupported || !resources.recognition) {
        return state;
    }
    
    try {
        resources.recognition.stop();
        
        return {
            ...state,
            isListening: false
        };
    } catch (error) {
        return {
            ...state,
            isListening: false,
            error: error instanceof Error ? error.message : 'Failed to stop recognition'
        };
    }
}

/**
 * 處理識別結果
 * 
 * @param state 當前狀態
 * @param event 識別事件
 * @returns 更新後的結果
 */
export function processRecognitionResult(
    state: STTState,
    event: any  // SpeechRecognitionEvent 型別不一定存在
): STTResult {
    let interimTranscript = '';
    let finalTranscript = '';
    let confidence = 0;
    const alternatives: Array<{ transcript: string; confidence: number }> = [];
    
    // 處理所有結果
    for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        
        if (result.isFinal) {
            finalTranscript += transcript;
            confidence = result[0].confidence || 0;
            
            // 收集替代結果
            for (let j = 0; j < result.length; j++) {
                alternatives.push({
                    transcript: result[j].transcript,
                    confidence: result[j].confidence || 0
                });
            }
        } else {
            interimTranscript += transcript;
        }
    }
    
    // 更新狀態
    const newState: STTState = {
        ...state,
        interimTranscript,
        finalTranscript: state.finalTranscript + finalTranscript,
        confidence,
        noSpeechCounter: 0  // 重置無語音計數器
    };
    
    return {
        state: newState,
        transcript: finalTranscript || interimTranscript,
        isFinal: !!finalTranscript,
        confidence,
        alternatives: alternatives.length > 1 ? alternatives : undefined
    };
}

/**
 * 處理識別錯誤
 * 
 * @param state 當前狀態
 * @param error 錯誤事件
 * @returns 更新後的狀態
 */
export function processRecognitionError(
    state: STTState,
    error: any  // SpeechRecognitionErrorEvent 型別不一定存在
): STTState {
    let errorMessage = error.error;
    let newState = { ...state };
    
    switch (error.error) {
        case 'no-speech':
            newState.noSpeechCounter++;
            errorMessage = '未檢測到語音';
            break;
        case 'audio-capture':
            errorMessage = '無法擷取音訊';
            break;
        case 'not-allowed':
            errorMessage = '麥克風權限被拒絕';
            break;
        case 'network':
            errorMessage = '網路錯誤';
            break;
        case 'aborted':
            errorMessage = '識別被中止';
            break;
        default:
            errorMessage = `識別錯誤: ${error.error}`;
    }
    
    return {
        ...newState,
        error: errorMessage,
        isListening: false
    };
}

/**
 * 取得可用語音列表
 * 
 * @param resources TTS 資源
 * @param language 語言篩選（可選）
 * @returns 語音列表
 */
export function getAvailableVoices(
    resources: TTSResources,
    language?: string
): Array<{ name: string; lang: string; localService: boolean }> {
    if (!resources.isSupported) {
        return [];
    }
    
    let voices = resources.voices;
    
    // 篩選語言
    if (language) {
        voices = voices.filter(v => v.lang.startsWith(language));
    }
    
    return voices.map(v => ({
        name: v.name,
        lang: v.lang,
        localService: v.localService
    }));
}

/**
 * 檢查瀏覽器支援
 * 
 * @returns 支援狀態
 */
export function checkBrowserSupport(): {
    tts: boolean;
    stt: boolean;
    details: {
        hasSpeechSynthesis: boolean;
        hasSpeechRecognition: boolean;
        hasWebkitSpeechRecognition: boolean;
    };
} {
    return {
        tts: 'speechSynthesis' in window,
        stt: 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window,
        details: {
            hasSpeechSynthesis: 'speechSynthesis' in window,
            hasSpeechRecognition: 'SpeechRecognition' in window,
            hasWebkitSpeechRecognition: 'webkitSpeechRecognition' in window
        }
    };
}

// TypeScript 宣告擴充
declare global {
    interface Window {
        SpeechRecognition: any;
        webkitSpeechRecognition: any;
    }
}