/**
 * SpeechService - Web Speech API 事件驅動服務（Event Architecture v2）
 * 
 * @description 提供語音合成（TTS）和語音識別（STT）的事件驅動服務
 * 整合 Web Speech API 的純函數實作與事件系統
 * 
 * @module SpeechService
 */

import { EventEmitter } from '../core/EventEmitter';
import { ConfigManager } from '../utils/config-manager';
import { SpeechEvents } from '../types/events';
import {
    loadTTSResources,
    createTTSState,
    speak,
    pauseSpeech,
    resumeSpeech,
    stopSpeech,
    getAvailableVoices,
    loadSTTResources,
    createSTTState,
    startRecognition,
    stopRecognition,
    processRecognitionResult,
    processRecognitionError,
    checkBrowserSupport
} from './speech';

import type {
    TTSResources,
    TTSState,
    TTSParams,
    STTResources,
    STTState,
    STTParams
} from './speech';


/**
 * SpeechService - Web Speech API 事件驅動服務
 * 
 * @example
 * ```typescript
 * const speechService = new SpeechService();
 * 
 * // TTS 使用範例
 * speechService.on(SpeechEvents.TTS_START, ({ text }) => {
 *     console.log(`開始說話: ${text}`);
 * });
 * 
 * speechService.on(SpeechEvents.TTS_BOUNDARY, ({ word }) => {
 *     console.log(`當前單字: ${word}`);
 * });
 * 
 * await speechService.speak('你好，世界！', { 
 *     voice: 'zh-TW', 
 *     rate: 1.2 
 * });
 * 
 * // STT 使用範例
 * speechService.on(SpeechEvents.STT_RESULT, ({ transcript, isFinal }) => {
 *     console.log(`識別結果: ${transcript} (${isFinal ? '最終' : '暫時'})`);
 * });
 * 
 * await speechService.startListening({ 
 *     language: 'zh-TW',
 *     continuous: true 
 * });
 * ```
 */
export class SpeechService extends EventEmitter<any> {
    private config: ConfigManager;
    
    // TTS 資源和狀態
    private ttsResources: TTSResources | null = null;
    private ttsState: TTSState;
    private currentUtterance: SpeechSynthesisUtterance | null = null;
    private ttsStartTime: number = 0;
    
    // STT 資源和狀態
    private sttResources: STTResources | null = null;
    private sttState: STTState;
    private sttStartTime: number = 0;
    
    constructor(config?: ConfigManager) {
        super();
        this.config = config || ConfigManager.getInstance();
        this.ttsState = createTTSState(this.config);
        this.sttState = createSTTState(this.config);
        
        // 自動初始化
        this.initialize().catch(error => {
            this.emit(SpeechEvents.ERROR, {
                type: 'tts',
                error: error as Error,
                context: 'initialization',
                timestamp: Date.now()
            });
        });
    }
    
    /**
     * 初始化服務
     */
    async initialize(): Promise<void> {
        try {
            // 檢查瀏覽器支援
            const support = checkBrowserSupport();
            
            // 載入 TTS 資源
            if (support.tts) {
                this.ttsResources = await loadTTSResources();
            }
            
            // 載入 STT 資源
            if (support.stt) {
                this.sttResources = loadSTTResources();
                this.setupSTTEventHandlers();
            }
            
            // 發送 ready 事件
            this.emit(SpeechEvents.READY, {
                ttsSupported: support.tts,
                sttSupported: support.stt,
                voices: this.ttsResources ? 
                    getAvailableVoices(this.ttsResources).map(v => ({
                        name: v.name,
                        lang: v.lang
                    })) : [],
                timestamp: Date.now()
            });
        } catch (error) {
            this.emit(SpeechEvents.ERROR, {
                type: 'tts',
                error: error as Error,
                context: 'initialize',
                timestamp: Date.now()
            });
            throw error;
        }
    }
    
    /**
     * 設定 STT 事件處理器
     */
    private setupSTTEventHandlers(): void {
        if (!this.sttResources?.recognition) return;
        
        const recognition = this.sttResources.recognition;
        
        // 開始事件
        recognition.onstart = () => {
            this.emit(SpeechEvents.STT_AUDIOSTART, { timestamp: Date.now() });
        };
        
        // 語音開始
        recognition.onspeechstart = () => {
            this.emit(SpeechEvents.STT_SPEECHSTART, { timestamp: Date.now() });
        };
        
        // 語音結束
        recognition.onspeechend = () => {
            this.emit(SpeechEvents.STT_SPEECHEND, { timestamp: Date.now() });
        };
        
        // 音訊結束
        recognition.onaudioend = () => {
            this.emit(SpeechEvents.STT_AUDIOEND, { timestamp: Date.now() });
        };
        
        // 識別結果
        recognition.onresult = (event: any) => {
            const result = processRecognitionResult(this.sttState, event);
            this.sttState = result.state;
            
            this.emit(SpeechEvents.STT_RESULT, {
                transcript: result.transcript,
                isFinal: result.isFinal,
                confidence: result.confidence,
                alternatives: result.alternatives,
                timestamp: Date.now()
            });
        };
        
        // 無匹配
        recognition.onnomatch = () => {
            this.emit(SpeechEvents.STT_NOMATCH, { timestamp: Date.now() });
        };
        
        // 錯誤處理
        recognition.onerror = (event: any) => {
            this.sttState = processRecognitionError(this.sttState, event);
            
            this.emit(SpeechEvents.ERROR, {
                type: 'stt',
                error: this.sttState.error || event.error,
                context: 'recognition',
                timestamp: Date.now()
            });
        };
        
        // 結束事件
        recognition.onend = () => {
            const duration = Date.now() - this.sttStartTime;
            
            this.emit(SpeechEvents.STT_END, {
                finalTranscript: this.sttState.finalTranscript,
                duration,
                timestamp: Date.now()
            });
            
            // 如果是連續模式且還在監聽，自動重啟
            if (this.sttState.continuous && this.sttState.isListening) {
                setTimeout(() => {
                    if (this.sttState.isListening) {
                        recognition.start();
                    }
                }, 100);
            }
        };
    }
    
    /**
     * 開始說話（TTS）
     * 
     * @param text 要說的文字
     * @param params TTS 參數
     */
    async speak(text: string, params: Partial<TTSParams> = {}): Promise<void> {
        if (!this.ttsResources) {
            throw new Error('TTS not supported or not initialized');
        }
        
        try {
            const fullParams: TTSParams = {
                text,
                ...params
            };
            
            // 先停止當前的說話（如果有）
            if (this.ttsState.isSpeaking && !params.queue) {
                this.ttsResources.synth.cancel();
            }
            
            // 創建並設定語音實例事件（不使用 speak 純函數，因為它會直接執行）
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = params.rate || this.ttsState.rate;
            utterance.pitch = params.pitch || this.ttsState.pitch;
            utterance.volume = params.volume || this.ttsState.volume;
            
            // 設定語音
            if (params.voice) {
                const voice = this.ttsResources.voices.find(v =>
                    v.name === params.voice || v.lang === params.voice
                );
                if (voice) {
                    utterance.voice = voice;
                }
            }
            
            // 更新狀態
            this.ttsState = {
                ...this.ttsState,
                isSpeaking: true,
                isPaused: false,
                currentText: text,
                currentVoice: params.voice || this.ttsState.currentVoice,
                rate: params.rate || this.ttsState.rate,
                pitch: params.pitch || this.ttsState.pitch,
                volume: params.volume || this.ttsState.volume
            };
            
            // 設定事件處理器
            this.currentUtterance = utterance;
            this.ttsStartTime = Date.now();
            
            utterance.onstart = () => {
                this.emit(SpeechEvents.TTS_START, {
                    text,
                    voice: this.ttsState.currentVoice,
                    rate: this.ttsState.rate,
                    pitch: this.ttsState.pitch,
                    volume: this.ttsState.volume,
                    timestamp: Date.now()
                });
            };
            
            utterance.onend = () => {
                const duration = Date.now() - this.ttsStartTime;
                this.ttsState = {
                    ...this.ttsState,
                    isSpeaking: false,
                    currentText: ''
                };
                
                this.emit(SpeechEvents.TTS_END, {
                    text,
                    duration,
                    timestamp: Date.now()
                });
                
                // 處理佇列
                if (this.ttsState.queue.length > 0) {
                    const nextText = this.ttsState.queue.shift()!;
                    this.speak(nextText, params);
                }
            };
            
            utterance.onpause = () => {
                this.emit(SpeechEvents.TTS_PAUSE, {
                    text,
                    position: 0,  // elapsedTime not available in standard API
                    timestamp: Date.now()
                });
            };
            
            utterance.onresume = () => {
                this.emit(SpeechEvents.TTS_RESUME, {
                    text,
                    position: 0,  // elapsedTime not available in standard API
                    timestamp: Date.now()
                });
            };
            
            utterance.onboundary = (event: SpeechSynthesisEvent) => {
                const word = text.substring(
                    event.charIndex,
                    event.charIndex + event.charLength
                );
                
                this.emit(SpeechEvents.TTS_BOUNDARY, {
                    text,
                    charIndex: event.charIndex,
                    charLength: event.charLength,
                    word,
                    timestamp: Date.now()
                });
            };
            
            utterance.onmark = (event: SpeechSynthesisEvent) => {
                this.emit(SpeechEvents.TTS_MARK, {
                    text,
                    mark: event.name,
                    timestamp: Date.now()
                });
            };
            
            utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
                // 忽略 'interrupted' 錯誤（這是正常的打斷行為）
                if (event.error === 'interrupted') {
                    return;
                }
                
                this.emit(SpeechEvents.ERROR, {
                    type: 'tts',
                    error: event.error,
                    context: 'speak',
                    timestamp: Date.now()
                });
            };
            
            // 執行說話
            this.ttsResources.synth.speak(utterance);
            
        } catch (error) {
            this.emit(SpeechEvents.ERROR, {
                type: 'tts',
                error: error as Error,
                context: 'speak',
                timestamp: Date.now()
            });
            throw error;
        }
    }
    
    /**
     * 暫停說話
     */
    pause(): void {
        if (!this.ttsResources) return;
        
        this.ttsState = pauseSpeech(this.ttsResources, this.ttsState);
    }
    
    /**
     * 恢復說話
     */
    resume(): void {
        if (!this.ttsResources) return;
        
        this.ttsState = resumeSpeech(this.ttsResources, this.ttsState);
    }
    
    /**
     * 停止說話
     */
    stop(): void {
        if (!this.ttsResources) return;
        
        this.ttsState = stopSpeech(this.ttsResources, this.ttsState);
        this.currentUtterance = null;
    }
    
    /**
     * 開始語音識別
     * 
     * @param params STT 參數
     */
    async startListening(params: STTParams = {}): Promise<void> {
        if (!this.sttResources) {
            throw new Error('STT not supported or not initialized');
        }
        
        try {
            this.sttStartTime = Date.now();
            this.sttState = startRecognition(this.sttResources, this.sttState, params);
            
            if (this.sttState.error) {
                throw new Error(this.sttState.error);
            }
            
            this.emit(SpeechEvents.STT_START, {
                language: this.sttState.language,
                continuous: this.sttState.continuous,
                timestamp: Date.now()
            });
            
        } catch (error) {
            this.emit(SpeechEvents.ERROR, {
                type: 'stt',
                error: error as Error,
                context: 'startListening',
                timestamp: Date.now()
            });
            throw error;
        }
    }
    
    /**
     * 停止語音識別
     */
    stopListening(): void {
        if (!this.sttResources) return;
        
        this.sttState = stopRecognition(this.sttResources, this.sttState);
    }
    
    /**
     * 取得可用語音列表
     * 
     * @param language 語言篩選
     * @returns 語音列表
     */
    getVoices(language?: string): Array<{ name: string; lang: string; localService: boolean }> {
        if (!this.ttsResources) return [];
        
        return getAvailableVoices(this.ttsResources, language);
    }
    
    /**
     * 設定預設語音
     * 
     * @param voice 語音名稱或語言代碼
     */
    setDefaultVoice(voice: string): void {
        this.ttsState.currentVoice = voice;
    }
    
    /**
     * 設定預設語言（STT）
     * 
     * @param language 語言代碼
     */
    setDefaultLanguage(language: string): void {
        this.sttState.language = language;
    }
    
    /**
     * 取得 TTS 狀態
     */
    getTTSState(): TTSState {
        return { ...this.ttsState };
    }
    
    /**
     * 取得 STT 狀態
     */
    getSTTState(): STTState {
        return { ...this.sttState };
    }
    
    /**
     * 檢查支援狀態
     */
    getSupport(): {
        tts: boolean;
        stt: boolean;
        details: any;
    } {
        return checkBrowserSupport();
    }
    
    /**
     * 清理資源
     */
    dispose(): void {
        // 停止所有活動
        this.stop();
        this.stopListening();
        
        // 清理事件監聽器
        if (this.sttResources?.recognition) {
            const recognition = this.sttResources.recognition;
            recognition.onstart = null;
            recognition.onspeechstart = null;
            recognition.onspeechend = null;
            recognition.onaudiostart = null;
            recognition.onaudioend = null;
            recognition.onresult = null;
            recognition.onnomatch = null;
            recognition.onerror = null;
            recognition.onend = null;
        }
        
        // 清理資源
        this.ttsResources = null;
        this.sttResources = null;
        this.currentUtterance = null;
        
        // 移除所有事件監聽器
        this.removeAllListeners();
    }
}

export default SpeechService;