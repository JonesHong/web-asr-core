/**
 * 智慧語音助手核心模組 - 處理所有助理邏輯
 */
class AssistantCore extends EventTarget {
    constructor() {
        super();

        // 服務實例
        this.vadService = null;
        this.wakewordService = null;
        this.speechService = null;
        this.timerService = null;
        this.audioCapture = null;

        // 狀態管理
        this.state = 'idle'; // 'idle' | 'listening' | 'processing'
        this.isAwake = false;
        this.isInitialized = false;

        // 處理狀態標記
        this.processingAudio = false;
        this.vadProcessing = false;
        this.wakewordProcessing = false;

        // VAD 和喚醒詞狀態
        this.vadState = null;
        this.vadParams = null;
        this.vadBuffer = null;
        this.vadBufferIndex = 0;

        this.wakewordState = null;
        this.wakewordParams = null;
        this.wakewordBuffer = null;
        this.wakewordBufferIndex = 0;

        // 計時器標記
        this.silenceTimerActive = false;

        // 配置參數
        this.config = {
            vadThreshold: 0.5,
            vadDebounce: 1000,
            wakewordThreshold: 0.6,
            wakewordModel: 'hey-jarvis',
            silenceTimeout: 5000,
            maxListeningTime: 30000,
            sttLanguage: 'zh-TW',
            sttContinuous: true,
            sttInterimResults: true
        };

        // 自訂模型
        this.customModel = null;

        // 計時器設定
        this.timers = {
            silence: { max: 5 },
            maxListening: { max: 30 }
        };
    }

    /**
     * 初始化助理服務
     */
    async initialize() {
        try {
            this.emit('log', '🚀 開始初始化智慧語音助手...', 'info');

            // 檢查瀏覽器支援
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('瀏覽器不支援麥克風存取');
            }

            // 請求麥克風權限
            this.emit('log', '📢 正在請求麥克風權限...', 'info');
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false,
                        sampleRate: 16000
                    }
                });
                stream.getTracks().forEach(track => track.stop());
                this.emit('log', '✅ 麥克風權限已獲得', 'success');
            } catch (err) {
                this.emit('log', '❌ 無法取得麥克風權限', 'error');
                throw new Error('麥克風權限被拒絕');
            }

            // 檢測 WebGPU
            await this.checkWebGPU();

            // 設定本地自定義模型路徑
            const customConfig = {
                vad: {
                    modelPath: '../../models/github/snakers4/silero-vad/silero_vad_v6.onnx',
                    threshold: this.config.vadThreshold
                },
                wakeword: {
                    hey_jarvis: {
                        detectorPath: '../../models/github/dscripka/openWakeWord/hey_jarvis_v0.1.onnx',
                        melspecPath: '../../models/github/dscripka/openWakeWord/melspectrogram.onnx',
                        embeddingPath: '../../models/github/dscripka/openWakeWord/embedding_model.onnx',
                        threshold: this.config.wakewordThreshold
                    }
                }
            };

            // 套用自定義配置
            const configManager = WebASRCore.ConfigManager.getInstance(customConfig);

            // 初始化各服務
            await this.initializeVAD(customConfig);
            await this.initializeWakeword(customConfig);
            await this.initializeSpeechService();
            this.initializeTimerService();
            await this.initializeAudioCapture();

            // 設定事件監聽器
            this.setupEventListeners();

            this.isInitialized = true;
            this.emit('log', '✅ 智慧語音助手初始化完成！', 'success');
            this.emit('initialized');

            // 進入閒置狀態
            await this.enterIdleState();

        } catch (error) {
            this.emit('log', `❌ 初始化失敗: ${error.message}`, 'error');
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * 初始化 VAD 服務
     */
    async initializeVAD(customConfig) {
        try {
            this.emit('log', '初始化 VAD 服務（使用本地模型）...', 'info');
            this.emit('log', `VAD 模型路徑: ${customConfig.vad.modelPath}`, 'info');

            this.vadService = new WebASRCore.VadService({
                modelPath: customConfig.vad.modelPath,
                threshold: this.config.vadThreshold,
                debounceTime: this.config.vadDebounce
            });

            await this.vadService.initialize();
            this.emit('service-status', { service: 'vad', status: 'ready' });
            this.emit('log', '✅ VAD 服務初始化成功', 'success');
        } catch (err) {
            this.emit('log', `❌ VAD 初始化失敗: ${err.message}`, 'error');
            this.emit('log', '提示：請確認模型檔案存在於 models/github/snakers4/silero-vad/', 'warning');
            this.emit('service-status', { service: 'vad', status: 'error' });
            throw err;
        }
    }

    /**
     * 初始化喚醒詞服務
     */
    async initializeWakeword(customConfig) {
        try {
            this.emit('log', '初始化喚醒詞服務（使用本地模型）...', 'info');
            this.emit('log', `檢測器路徑: ${customConfig.wakeword.hey_jarvis.detectorPath}`, 'info');

            this.wakewordService = new WebASRCore.WakewordService({
                thresholds: {
                    'hey-jarvis': this.config.wakewordThreshold
                }
            });

            await this.wakewordService.initialize(['hey-jarvis']);
            this.emit('service-status', { service: 'wakeword', status: 'ready' });
            this.emit('log', '✅ 喚醒詞服務初始化成功', 'success');
        } catch (err) {
            this.emit('log', `❌ 喚醒詞初始化失敗: ${err.message}`, 'error');
            this.emit('log', '提示：請確認模型檔案存在於 models/github/dscripka/openWakeWord/', 'warning');
            this.emit('service-status', { service: 'wakeword', status: 'error' });
            throw err;
        }
    }

    /**
     * 初始化 Speech Service
     */
    async initializeSpeechService() {
        this.emit('log', '初始化 Speech Service...', 'info');
        this.speechService = new WebASRCore.SpeechService();

        await new Promise((resolve) => {
            this.speechService.once('ready', (data) => {
                this.emit('log', `✅ Speech API 初始化成功`, 'success');
                this.emit('log', `TTS 支援: ${data.ttsSupported}, STT 支援: ${data.sttSupported}`, 'info');
                this.emit('service-status', { service: 'stt', status: 'ready' });
                resolve();
            });
        });
    }

    /**
     * 初始化計時器服務
     */
    initializeTimerService() {
        this.emit('log', '初始化計時器服務...', 'info');
        this.timerService = new WebASRCore.TimerService();
    }

    /**
     * 初始化音訊擷取
     */
    async initializeAudioCapture() {
        this.emit('log', '初始化音訊擷取...', 'info');
        this.audioCapture = new WebASRCore.AudioCapture();

        this.audioCapture.onAudioData((audioData) => {
            this.processAudioData(audioData);
        });
    }

    /**
     * 檢查 WebGPU 支援
     */
    async checkWebGPU() {
        try {
            if (navigator.gpu) {
                const adapter = await navigator.gpu.requestAdapter();
                if (adapter) {
                    this.emit('service-status', { service: 'webgpu', status: 'ready' });
                    this.emit('log', '✅ WebGPU 可用', 'success');
                    return true;
                }
            }
        } catch (e) {
            console.log('WebGPU check failed:', e);
        }
        this.emit('service-status', { service: 'webgpu', status: 'unavailable' });
        this.emit('log', '⚠️ WebGPU 不可用，使用 WASM', 'warning');
        return false;
    }

    /**
     * 設定事件監聽器
     */
    setupEventListeners() {
        // 喚醒詞檢測
        this.wakewordService.on('wakewordDetected', (data) => {
            this.emit('log', `🎯 檢測到喚醒詞 "${data.word}" (信心度: ${data.score.toFixed(2)})`, 'success');
            if (this.state === 'idle') {
                this.wakeUp();
            }
        });

        // VAD 事件
        this.vadService.on('speechStart', (event) => {
            if (this.isAwake) {
                this.emit('log', '🎤 檢測到語音活動', 'info');
                this.emit('service-status', { service: 'vad', status: 'active' });

                if (this.timerService.getTimerState('silenceTimer')) {
                    this.timerService.pause('silenceTimer');
                    this.timerService.reset('silenceTimer');
                    this.emit('timer-update', { type: 'silence', current: 0, max: this.timers.silence.max });
                    this.silenceTimerActive = false;
                }
            }
        });

        this.vadService.on('speechEnd', (event) => {
            if (this.isAwake) {
                this.emit('log', '🔇 語音活動結束', 'info');
                this.emit('service-status', { service: 'vad', status: 'ready' });
                this.startSilenceTimer();
            }
        });

        // Speech STT 事件
        this.speechService.on('stt-result', (data) => {
            if (data.transcript) {
                if (data.isFinal) {
                    this.emit('log', `💬 最終識別: "${data.transcript}"`, 'success');
                    this.emit('final-transcript', data.transcript);
                    this.processCommand(data.transcript);
                } else {
                    this.emit('interim-transcript', data.transcript);
                }
            }
        });

        this.speechService.on('stt-start', (data) => {
            this.emit('log', `🎤 開始語音識別 (語言: ${data.language})`, 'info');
            this.emit('service-status', { service: 'stt', status: 'listening' });
        });

        this.speechService.on('stt-end', (data) => {
            this.emit('log', '✅ STT 服務已停止', 'info');
            this.emit('service-status', { service: 'stt', status: 'ready' });
        });

        // TTS 事件
        this.speechService.on('tts-start', () => {
            this.emit('log', '🔊 開始播放語音', 'info');
        });

        this.speechService.on('tts-end', () => {
            this.emit('log', '🔇 語音播放完成', 'info');
        });

        this.speechService.on('error', (data) => {
            const errorMessage = data?.error || JSON.stringify(data);
            this.emit('log', `❌ ${data.type?.toUpperCase() || 'Speech'} 錯誤: ${errorMessage}`, 'error');
            if (data.type === 'stt') {
                this.emit('service-status', { service: 'stt', status: 'error' });
            }
        });

        // 計時器事件
        this.timerService.on('tick', (data) => {
            if (data.id === 'silenceTimer') {
                const elapsed = (this.config.silenceTimeout - data.remaining) / 1000;
                this.emit('timer-update', { type: 'silence', current: elapsed, max: this.timers.silence.max });
            } else if (data.id === 'maxListeningTimer') {
                const elapsed = (this.config.maxListeningTime - data.remaining) / 1000;
                this.emit('timer-update', { type: 'maxListening', current: elapsed, max: this.timers.maxListening.max });
            }
        });

        this.timerService.on('timeout', (data) => {
            if (data.id === 'silenceTimer') {
                this.emit('log', '⏰ 靜音超時，返回閒置狀態', 'warning');
                this.sleep();
            } else if (data.id === 'maxListeningTimer') {
                this.emit('log', '⏰ 達到最大聆聽時間，返回閒置狀態', 'warning');
                this.sleep();
            }
        });
    }

    /**
     * 處理音訊資料
     */
    async processAudioData(audioData) {
        if (this.processingAudio) return;
        this.processingAudio = true;

        try {
            // 發送音訊資料給 UI 視覺化
            this.emit('audio-data', audioData);

            // 在閒置狀態處理喚醒詞
            if (this.state === 'idle') {
                await this.processWakeword(audioData);
            }

            // 在喚醒狀態處理 VAD
            if (this.isAwake) {
                await this.processVAD(audioData);
            }
        } finally {
            this.processingAudio = false;
        }
    }

    /**
     * 處理喚醒詞檢測
     */
    async processWakeword(audioData) {
        if (!this.wakewordService || this.wakewordProcessing) return;
        this.wakewordProcessing = true;

        try {
            this.wakewordBuffer = this.wakewordBuffer || new Float32Array(1280);
            this.wakewordBufferIndex = this.wakewordBufferIndex || 0;

            if (!this.wakewordState) {
                this.wakewordState = this.wakewordService.createState();
            }
            if (!this.wakewordParams) {
                this.wakewordParams = this.wakewordService.createParams('hey-jarvis');
            }

            const remainingSpace = this.wakewordBuffer.length - this.wakewordBufferIndex;
            const copyLength = Math.min(audioData.length, remainingSpace);

            this.wakewordBuffer.set(audioData.slice(0, copyLength), this.wakewordBufferIndex);
            this.wakewordBufferIndex += copyLength;

            if (this.wakewordBufferIndex >= this.wakewordBuffer.length) {
                const result = await this.wakewordService.process(
                    this.wakewordState,
                    this.wakewordBuffer,
                    this.wakewordParams
                );
                this.wakewordState = result.state;
                this.wakewordBufferIndex = 0;
            }
        } catch (error) {
            console.error('喚醒詞處理錯誤:', error);
        } finally {
            this.wakewordProcessing = false;
        }
    }

    /**
     * 處理 VAD
     */
    async processVAD(audioData) {
        if (!this.vadService || this.vadProcessing) return;
        this.vadProcessing = true;

        try {
            this.vadBuffer = this.vadBuffer || new Float32Array(512);
            this.vadBufferIndex = this.vadBufferIndex || 0;

            if (!this.vadState) {
                this.vadState = this.vadService.createState();
            }
            if (!this.vadParams) {
                this.vadParams = this.vadService.createParams();
            }

            const remainingSpace = this.vadBuffer.length - this.vadBufferIndex;
            const copyLength = Math.min(audioData.length, remainingSpace);

            this.vadBuffer.set(audioData.slice(0, copyLength), this.vadBufferIndex);
            this.vadBufferIndex += copyLength;

            if (this.vadBufferIndex >= this.vadBuffer.length) {
                const result = await this.vadService.process(
                    this.vadState,
                    this.vadBuffer,
                    this.vadParams
                );
                this.vadState = result.state;
                this.vadBufferIndex = 0;
            }
        } catch (error) {
            console.error('VAD 處理錯誤:', error);
        } finally {
            this.vadProcessing = false;
        }
    }

    /**
     * 進入閒置狀態
     */
    async enterIdleState() {
        this.emit('log', '😴 進入閒置狀態，等待喚醒...', 'info');
        this.state = 'idle';
        this.isAwake = false;

        this.emit('state-change', 'idle');

        // 停止 STT
        if (this.speechService) {
            try {
                const sttState = this.speechService.getSTTState();
                if (sttState?.isListening) {
                    this.speechService.stopListening();
                    this.emit('service-status', { service: 'stt', status: 'ready' });
                }
            } catch (error) {
                console.error('停止 STT 時發生錯誤:', error);
            }
        }

        // 重置 VAD 狀態
        if (this.vadService) {
            this.vadService.reset();
            this.vadState = null;
            this.vadBuffer = null;
            this.vadBufferIndex = 0;
        }

        // 清除計時器
        if (this.timerService) {
            this.timerService.stop('silenceTimer');
            this.timerService.stop('maxListeningTimer');
        }
        this.emit('timer-update', { type: 'silence', current: 0, max: this.timers.silence.max });
        this.emit('timer-update', { type: 'maxListening', current: 0, max: this.timers.maxListening.max });
        this.silenceTimerActive = false;

        // 開始音訊擷取以監聽喚醒詞
        if (this.audioCapture && this.wakewordService) {
            const captureState = this.audioCapture.getState();
            if (!captureState.isCapturing) {
                await this.audioCapture.startCapture({
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                });
            }
            this.emit('service-status', { service: 'wakeword', status: 'listening' });
        }
    }

    /**
     * 喚醒助理
     */
    async wakeUp() {
        this.emit('log', '🎉 助手已喚醒，開始聆聽...', 'success');
        this.state = 'listening';
        this.isAwake = true;

        this.emit('play-sound', 'wake');
        this.emit('state-change', 'listening');
        this.emit('clear-interim-transcript');

        // 重置喚醒詞服務
        if (this.wakewordService) {
            this.wakewordService.reset();
            this.emit('service-status', { service: 'wakeword', status: 'ready' });
        }

        // 重置 VAD
        if (this.vadService) {
            this.vadService.reset();
            this.vadState = this.vadService.createState();
            this.vadParams = this.vadService.createParams();
            this.vadBuffer = new Float32Array(512);
            this.vadBufferIndex = 0;
            this.emit('service-status', { service: 'vad', status: 'listening' });
        }

        // 啟動 STT
        if (this.speechService) {
            try {
                const sttState = this.speechService.getSTTState();
                if (sttState?.isListening) {
                    this.speechService.stopListening();
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                await this.speechService.startListening({
                    language: this.config.sttLanguage,
                    continuous: this.config.sttContinuous,
                    interimResults: this.config.sttInterimResults
                });
                this.emit('service-status', { service: 'stt', status: 'listening' });
                this.emit('log', '✅ STT 已啟動', 'success');
            } catch (error) {
                this.emit('log', `❌ 無法啟動 STT: ${error.message}`, 'error');
            }
        }

        // 設定最大聆聽時間計時器
        if (this.timerService) {
            this.timerService.createTimer('maxListeningTimer',
                this.config.maxListeningTime,
                100,
                () => {
                    this.emit('log', '⏰ 最大聆聽時間到達', 'warning');
                    this.sleep();
                }
            );
            this.timerService.start('maxListeningTimer');
        }

        // 初始靜音計時
        this.startSilenceTimer();
    }

    /**
     * 返回閒置狀態
     */
    async sleep() {
        this.emit('log', '😴 返回閒置狀態', 'info');
        this.emit('play-sound', 'sleep');
        await this.enterIdleState();
    }

    /**
     * 開始靜音計時器
     */
    startSilenceTimer() {
        this.emit('log', '⏱️ 開始靜音計時', 'info');

        if (!this.timerService) return;

        if (this.silenceTimerActive) {
            if (this.timerService.getTimerState('silenceTimer')) {
                this.timerService.reset('silenceTimer', this.config.silenceTimeout);
                this.timerService.start('silenceTimer');
            }
            return;
        }

        this.silenceTimerActive = true;

        if (this.timerService.getTimerState('silenceTimer')) {
            this.timerService.reset('silenceTimer', this.config.silenceTimeout);
        } else {
            this.timerService.createTimer('silenceTimer',
                this.config.silenceTimeout,
                100,
                () => {
                    this.emit('log', '⏰ 靜音超時，返回閒置狀態', 'info');
                    this.silenceTimerActive = false;
                    this.sleep();
                }
            );
        }

        this.timerService.start('silenceTimer');
    }

    /**
     * 處理語音指令
     */
    async processCommand(command) {
        this.emit('log', `🤖 處理指令: "${command}"`, 'info');
        this.state = 'processing';
        this.emit('state-change', 'processing');

        if (this.timerService && this.timerService.getTimerState('silenceTimer')) {
            this.timerService.pause('silenceTimer');
        }

        // 檢查停止指令
        if (command.includes('停止') || command.includes('結束') || command.includes('休眠')) {
            this.emit('log', '👋 收到停止指令', 'info');
            await this.sleep();
            return;
        }

        // 處理其他指令並等待語音播放完成
        let response = '';
        if (command.includes('時間')) {
            response = this.getTimeResponse();
        } else if (command.includes('天氣')) {
            response = this.getWeatherResponse();
        } else if (command.includes('音樂')) {
            response = this.getMusicResponse();
        } else if (command.includes('你好')) {
            response = '你好！有什麼可以幫助你的嗎？';
        } else {
            response = '抱歉，我不太明白你的意思。';
        }

        // 播放回應並等待完成
        await this.speakAndWait(response);

        // TTS 播放完成後，恢復到聆聽狀態
        if (this.isAwake) {
            this.state = 'listening';
            this.emit('state-change', 'listening');
            this.emit('clear-interim-transcript');
            this.startSilenceTimer();
        }
    }

    /**
     * 取得時間回應
     */
    getTimeResponse() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('zh-TW');
        const message = `現在時間是 ${timeStr}`;
        this.emit('log', `🕐 ${message}`, 'info');
        return message;
    }

    /**
     * 取得天氣回應
     */
    getWeatherResponse() {
        const message = '今天天氣晴朗，溫度約 25 度';
        this.emit('log', `☀️ ${message}`, 'info');
        return message;
    }

    /**
     * 取得音樂回應
     */
    getMusicResponse() {
        const message = '正在為您播放音樂';
        this.emit('log', `🎵 ${message}`, 'info');
        return message;
    }

    /**
     * 語音合成
     */
    speak(text) {
        if (this.speechService) {
            this.speechService.speak(text, {
                lang: 'zh-TW',
                rate: 1.8,
                pitch: 0.2
            });
        }
    }

    /**
     * 語音合成並等待播放完成
     */
    async speakAndWait(text) {
        if (!this.speechService) {
            return;
        }

        return new Promise((resolve) => {
            // 設定 TTS 完成的監聽器
            const handleTTSEnd = () => {
                this.speechService.off('tts-end', handleTTSEnd);
                // 給一點額外的時間確保音頻完全播放完畢
                setTimeout(resolve, 500);
            };

            // 監聽 TTS 結束事件
            this.speechService.on('tts-end', handleTTSEnd);

            // 開始播放 TTS
            this.speechService.speak(text, {
                lang: 'zh-TW',
                rate: 1.8,
                pitch: 0.2
            });

            // 設定超時保護，避免永遠等待
            setTimeout(() => {
                this.speechService.off('tts-end', handleTTSEnd);
                resolve();
            }, 10000); // 10 秒超時
        });
    }

    /**
     * 更新配置
     */
    updateConfig(config) {
        Object.assign(this.config, config);
        this.timers.silence.max = this.config.silenceTimeout / 1000;
        this.timers.maxListening.max = this.config.maxListeningTime / 1000;

        // 更新服務配置
        if (config.vadThreshold && this.vadService) {
            this.vadService.updateConfig({ threshold: config.vadThreshold });
        }

        if (config.wakewordThreshold && this.wakewordService) {
            this.wakewordService.updateConfig({
                thresholds: { [this.config.wakewordModel]: config.wakewordThreshold }
            });
        }
    }

    /**
     * 載入自訂模型
     */
    async loadCustomModel(file) {
        try {
            this.emit('log', `📁 載入自訂模型: ${file.name}`, 'info');

            const arrayBuffer = await file.arrayBuffer();
            const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);

            if (this.wakewordService) {
                await this.wakewordService.loadCustomModel('custom', url);
                this.customModel = url;
                this.config.wakewordModel = 'custom';
                this.emit('log', '✅ 自訂模型載入成功', 'success');
            }
        } catch (error) {
            this.emit('log', `❌ 載入自訂模型失敗: ${error.message}`, 'error');
        }
    }

    /**
     * 手動喚醒
     */
    async manualWakeUp() {
        if (!this.isInitialized) {
            this.emit('log', '⚠️ 請先初始化助手', 'warning');
            return;
        }

        if (this.state === 'idle') {
            this.emit('log', '🎮 手動喚醒助手', 'info');
            await this.wakeUp();
        } else {
            this.emit('log', '助手已經在聆聽中', 'info');
        }
    }

    /**
     * 手動休眠
     */
    async manualSleep() {
        if (!this.isInitialized) {
            this.emit('log', '⚠️ 請先初始化助手', 'warning');
            return;
        }

        if (this.isAwake) {
            this.emit('log', '🎮 手動休眠助手', 'info');
            await this.sleep();
        } else {
            this.emit('log', '助手已經在閒置狀態', 'info');
        }
    }

    /**
     * 發送事件
     */
    emit(type, data, dataType) {
        // 特別處理 log 事件
        if (type === 'log' && dataType) {
            this.dispatchEvent(new CustomEvent('log', {
                detail: { message: data, type: dataType }
            }));
        } else {
            this.dispatchEvent(new CustomEvent(type, { detail: data }));
        }
    }

    /**
     * 清理資源
     */
    async destroy() {
        this.emit('log', '🧹 清理資源...', 'info');

        if (this.speechService) this.speechService.stopListening();
        if (this.audioCapture) this.audioCapture.stopCapture();

        if (this.timerService) {
            if (this.timerService.getTimerState('silenceTimer')) {
                this.timerService.stop('silenceTimer');
            }
            if (this.timerService.getTimerState('maxListeningTimer')) {
                this.timerService.stop('maxListeningTimer');
            }
        }

        if (this.customModel) {
            URL.revokeObjectURL(this.customModel);
        }

        this.emit('log', '👋 智慧語音助手已關閉', 'info');
    }
}

// 導出給其他模組使用
window.AssistantCore = AssistantCore;