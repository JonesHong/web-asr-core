/**
 * 智慧語音助手 - WebASRCore v0.8.1
 * 協調器模組 - 整合 UI 和 Assistant 核心
 */

class SmartVoiceAssistant {
    constructor() {
        this.uiManager = null;
        this.assistantCore = null;
        this.isInitialized = false;
    }

    /**
     * 初始化智慧語音助手
     */
    async initialize() {
        try {
            // 初始化 UI 管理器
            this.uiManager = new UIManager();
            this.uiManager.initialize();

            // 初始化助理核心
            this.assistantCore = new AssistantCore();

            // 設定 UI 和助理核心之間的事件橋接
            this.setupEventBridge();

            // 從 UI 取得初始配置
            const initialConfig = this.uiManager.getConfig();
            this.assistantCore.updateConfig(initialConfig);

            // 初始化助理核心
            await this.assistantCore.initialize();

            this.isInitialized = true;
            this.uiManager.log('✅ 智慧語音助手完全初始化成功', 'success');

        } catch (error) {
            this.uiManager.log(`❌ 初始化失敗: ${error.message}`, 'error');
            console.error('Initialization error:', error);

            // 禁用控制按鈕
            this.uiManager.setControlsEnabled(false);
        }
    }

    /**
     * 設定 UI 和助理核心之間的事件橋接
     */
    setupEventBridge() {
        // 助理核心 -> UI 的事件
        this.assistantCore.addEventListener('log', (e) => {
            // e.detail 包含 message 和 type
            const { message, type } = e.detail;
            this.uiManager.log(message, type || 'info');
        });

        this.assistantCore.addEventListener('state-change', (e) => {
            this.uiManager.updateState(e.detail);
        });

        this.assistantCore.addEventListener('service-status', (e) => {
            this.uiManager.updateServiceStatus(e.detail.service, e.detail.status);
        });

        this.assistantCore.addEventListener('timer-update', (e) => {
            this.uiManager.updateTimer(e.detail.type, e.detail.current, e.detail.max);
        });

        this.assistantCore.addEventListener('interim-transcript', (e) => {
            this.uiManager.updateInterimTranscript(e.detail);
        });

        this.assistantCore.addEventListener('final-transcript', (e) => {
            this.uiManager.addFinalTranscript(e.detail);
        });

        this.assistantCore.addEventListener('clear-interim-transcript', () => {
            this.uiManager.clearInterimTranscript();
        });

        this.assistantCore.addEventListener('play-sound', (e) => {
            this.uiManager.playSound(e.detail);
        });

        this.assistantCore.addEventListener('audio-data', (e) => {
            this.uiManager.updateAudioVisualization(e.detail);
        });

        this.assistantCore.addEventListener('initialized', () => {
            this.uiManager.setControlsEnabled(true);
        });

        this.assistantCore.addEventListener('tts-voices', (e) => {
            this.uiManager.populateTTSVoices(e.detail);
        });

        this.assistantCore.addEventListener('error', (e) => {
            this.uiManager.updateServiceStatus('vad', 'error');
            this.uiManager.updateServiceStatus('wakeword', 'error');
            this.uiManager.updateServiceStatus('stt', 'error');
            this.uiManager.setControlsEnabled(false);
        });

        // UI -> 助理核心的事件
        this.uiManager.addEventListener('manual-wake', () => {
            this.assistantCore.manualWakeUp();
        });

        this.uiManager.addEventListener('manual-sleep', () => {
            this.assistantCore.manualSleep();
        });

        this.uiManager.addEventListener('config-change', (e) => {
            const { type, value } = e.detail;
            const config = {};
            config[type] = value;
            this.assistantCore.updateConfig(config);
        });

        this.uiManager.addEventListener('model-change', (e) => {
            if (this.assistantCore.wakewordService && this.isInitialized) {
                this.assistantCore.wakewordService.loadModel(e.detail.model).then(() => {
                    this.uiManager.log(`切換到喚醒詞模型: ${e.detail.model}`, 'info');
                });
            }
        });

        this.uiManager.addEventListener('custom-model', (e) => {
            this.assistantCore.loadCustomModel(e.detail.file);
        });

        this.uiManager.addEventListener('tts-config-change', (e) => {
            const { type, value } = e.detail;
            const settings = {};
            settings[type] = value;
            this.assistantCore.updateTTSSettings(settings);
        });
    }

    /**
     * 清理資源
     */
    async destroy() {
        this.uiManager.log('🧹 開始清理資源...', 'info');

        if (this.assistantCore) {
            await this.assistantCore.destroy();
        }

        if (this.uiManager) {
            this.uiManager.destroy();
        }

        this.uiManager.log('👋 智慧語音助手已完全關閉', 'info');
    }
}

// 全域變數
let assistant = null;

// 頁面載入完成後初始化
window.addEventListener('DOMContentLoaded', async () => {
    console.log('WebASRCore Smart Assistant v0.8.1 (Modularized)');

    // 創建助手實例
    assistant = new SmartVoiceAssistant();

    // 自動初始化
    await assistant.initialize();

    // 頁面關閉時清理
    window.addEventListener('beforeunload', () => {
        if (assistant) {
            assistant.destroy();
        }
    });
});

// 輸出到全域以便偵錯
window.SmartVoiceAssistant = SmartVoiceAssistant;
window.assistant = assistant;