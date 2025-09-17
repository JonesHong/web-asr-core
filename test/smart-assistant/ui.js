/**
 * UI 管理模組 - 處理所有使用者介面相關邏輯
 */
class UIManager extends EventTarget {
    constructor() {
        super();
        this.ui = {};
        this.canvasCtx = null;
        this.animationId = null;
        this.audioDataBuffer = null;
        this.audioDataBufferIndex = 0;
    }

    /**
     * 初始化 UI 元素和事件監聽器
     */
    initialize() {
        this.initializeElements();
        this.bindEvents();
        this.initAudioVisualization();
    }

    /**
     * 初始化所有 UI 元素參考
     */
    initializeElements() {
        this.ui = {
            // 狀態相關
            stateIndicator: document.getElementById('stateIndicator'),
            stateIcon: document.getElementById('stateIcon'),
            stateText: document.getElementById('stateText'),
            soundWave: document.getElementById('soundWave'),

            // 控制按鈕
            wakeBtn: document.getElementById('wakeBtn'),
            sleepBtn: document.getElementById('sleepBtn'),

            // 設定控制項
            vadThreshold: document.getElementById('vadThreshold'),
            vadThresholdValue: document.getElementById('vadThresholdValue'),
            wakewordThreshold: document.getElementById('wakewordThreshold'),
            wakewordThresholdValue: document.getElementById('wakewordThresholdValue'),
            silenceTimeout: document.getElementById('silenceTimeout'),
            silenceTimeoutValue: document.getElementById('silenceTimeoutValue'),
            wakewordModel: document.getElementById('wakewordModel'),
            customModelSection: document.getElementById('customModelSection'),
            customModelInput: document.getElementById('customModelInput'),
            uploadModelBtn: document.getElementById('uploadModelBtn'),

            // 識別結果
            interimTranscript: document.getElementById('interimTranscript'),
            finalTranscript: document.getElementById('finalTranscript'),

            // 計時器顯示
            silenceTimerDisplay: document.getElementById('silenceTimerDisplay'),
            silenceTimerProgress: document.getElementById('silenceTimerProgress'),
            maxTimerDisplay: document.getElementById('maxTimerDisplay'),
            maxTimerProgress: document.getElementById('maxTimerProgress'),

            // 服務狀態
            vadStatus: document.getElementById('vadStatus'),
            wakewordStatus: document.getElementById('wakewordStatus'),
            sttStatus: document.getElementById('sttStatus'),
            webgpuStatus: document.getElementById('webgpuStatus'),

            // 其他
            eventLog: document.getElementById('eventLog'),
            clearLogBtn: document.getElementById('clearLogBtn'),
            audioCanvas: document.getElementById('audioCanvas')
        };
    }

    /**
     * 綁定 UI 事件
     */
    bindEvents() {
        // 控制按鈕
        if (this.ui.wakeBtn) {
            this.ui.wakeBtn.addEventListener('click', () => {
                this.dispatchEvent(new CustomEvent('manual-wake'));
            });
        }

        if (this.ui.sleepBtn) {
            this.ui.sleepBtn.addEventListener('click', () => {
                this.dispatchEvent(new CustomEvent('manual-sleep'));
            });
        }

        if (this.ui.clearLogBtn) {
            this.ui.clearLogBtn.addEventListener('click', () => this.clearLog());
        }

        // VAD 閾值調整
        if (this.ui.vadThreshold) {
            this.ui.vadThreshold.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                this.ui.vadThresholdValue.textContent = value.toFixed(1);
                this.dispatchEvent(new CustomEvent('config-change', {
                    detail: { type: 'vadThreshold', value }
                }));
            });
        }

        // 喚醒詞閾值調整
        if (this.ui.wakewordThreshold) {
            this.ui.wakewordThreshold.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                this.ui.wakewordThresholdValue.textContent = value.toFixed(1);
                this.dispatchEvent(new CustomEvent('config-change', {
                    detail: { type: 'wakewordThreshold', value }
                }));
            });
        }

        // 靜音超時調整
        if (this.ui.silenceTimeout) {
            this.ui.silenceTimeout.addEventListener('input', (e) => {
                const value = parseInt(e.target.value);
                this.ui.silenceTimeoutValue.textContent = value;
                this.dispatchEvent(new CustomEvent('config-change', {
                    detail: { type: 'silenceTimeout', value: value * 1000 }
                }));
            });
        }

        // 喚醒詞模型選擇
        if (this.ui.wakewordModel) {
            this.ui.wakewordModel.addEventListener('change', (e) => {
                const model = e.target.value;
                if (model === 'custom') {
                    this.ui.customModelSection.classList.remove('hidden');
                } else {
                    this.ui.customModelSection.classList.add('hidden');
                    this.dispatchEvent(new CustomEvent('model-change', {
                        detail: { model }
                    }));
                }
            });
        }

        // 自訂模型上傳
        if (this.ui.uploadModelBtn) {
            this.ui.uploadModelBtn.addEventListener('click', () => {
                this.ui.customModelInput.click();
            });
        }

        if (this.ui.customModelInput) {
            this.ui.customModelInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    this.dispatchEvent(new CustomEvent('custom-model', {
                        detail: { file }
                    }));
                }
            });
        }
    }

    /**
     * 取得當前配置值
     */
    getConfig() {
        return {
            vadThreshold: parseFloat(this.ui.vadThreshold?.value || 0.5),
            wakewordThreshold: parseFloat(this.ui.wakewordThreshold?.value || 0.6),
            silenceTimeout: parseInt(this.ui.silenceTimeout?.value || 5) * 1000,
            wakewordModel: this.ui.wakewordModel?.value || 'hey-jarvis'
        };
    }

    /**
     * 更新狀態 UI
     */
    updateState(state) {
        const indicator = this.ui.stateIndicator;
        const icon = this.ui.stateIcon;
        const text = this.ui.stateText;
        const soundWave = this.ui.soundWave;

        if (!indicator || !icon || !text) return;

        // 移除所有狀態類別
        indicator.classList.remove('state-idle', 'state-listening', 'state-processing', 'listening-animation');

        switch (state) {
            case 'idle':
                indicator.classList.add('state-idle');
                icon.className = 'fas fa-bed text-3xl mb-2';
                text.textContent = '閒置中';
                if (soundWave) soundWave.classList.add('hidden');
                break;
            case 'listening':
                indicator.classList.add('state-listening', 'listening-animation');
                icon.className = 'fas fa-microphone text-3xl mb-2';
                text.textContent = '聆聽中';
                if (soundWave) soundWave.classList.remove('hidden');
                break;
            case 'processing':
                indicator.classList.add('state-processing');
                icon.className = 'fas fa-brain text-3xl mb-2';
                text.textContent = '處理中';
                if (soundWave) soundWave.classList.add('hidden');
                break;
        }
    }

    /**
     * 更新服務狀態顯示
     */
    updateServiceStatus(service, status) {
        let element;
        switch (service) {
            case 'vad':
                element = this.ui.vadStatus;
                break;
            case 'wakeword':
                element = this.ui.wakewordStatus;
                break;
            case 'stt':
                element = this.ui.sttStatus;
                break;
            case 'webgpu':
                element = this.ui.webgpuStatus;
                break;
            default:
                return;
        }

        if (!element) return;

        let icon = '';
        let color = '';

        switch (status) {
            case 'ready':
                icon = 'fas fa-circle text-green-500';
                color = 'text-green-700';
                break;
            case 'active':
            case 'listening':
                icon = 'fas fa-circle text-blue-500';
                color = 'text-blue-700';
                break;
            case 'error':
                icon = 'fas fa-circle text-red-500';
                color = 'text-red-700';
                break;
            case 'unavailable':
                icon = 'fas fa-circle text-gray-400';
                color = 'text-gray-500';
                break;
            default:
                icon = 'fas fa-circle text-gray-400';
                color = 'text-gray-700';
        }

        const statusText = this.getStatusText(status);
        element.innerHTML = `<i class="${icon} mr-1"></i>${statusText}`;
        element.className = `text-sm font-semibold ${color}`;
    }

    /**
     * 取得狀態文字
     */
    getStatusText(status) {
        const statusMap = {
            'ready': '就緒',
            'active': '活動中',
            'listening': '聆聽中',
            'error': '錯誤',
            'unavailable': '不可用'
        };
        return statusMap[status] || status;
    }

    /**
     * 更新計時器顯示
     */
    updateTimer(type, current, max) {
        if (type === 'silence') {
            const remaining = max - current;
            if (this.ui.silenceTimerDisplay) {
                this.ui.silenceTimerDisplay.textContent = `${remaining.toFixed(1)}s`;
            }
            if (this.ui.silenceTimerProgress) {
                const progress = (current / max) * 100;
                this.ui.silenceTimerProgress.style.width = `${Math.min(progress, 100)}%`;
            }
        } else if (type === 'maxListening') {
            if (this.ui.maxTimerDisplay) {
                this.ui.maxTimerDisplay.textContent = `${current.toFixed(1)}s`;
            }
            if (this.ui.maxTimerProgress) {
                const progress = (current / 30) * 100;
                this.ui.maxTimerProgress.style.width = `${Math.min(progress, 100)}%`;
            }
        }
    }

    /**
     * 更新臨時轉錄文字
     */
    updateInterimTranscript(text) {
        if (this.ui.interimTranscript) {
            this.ui.interimTranscript.textContent = text;
        }
    }

    /**
     * 新增最終轉錄文字
     */
    addFinalTranscript(text) {
        if (this.ui.finalTranscript) {
            this.ui.finalTranscript.innerHTML += `<div class="mb-2 p-2 bg-white rounded">${text}</div>`;
        }
    }

    /**
     * 清空臨時轉錄
     */
    clearInterimTranscript() {
        if (this.ui.interimTranscript) {
            this.ui.interimTranscript.textContent = '等待語音輸入...';
        }
    }

    /**
     * 啟用/禁用控制按鈕
     */
    setControlsEnabled(enabled) {
        if (this.ui.wakeBtn) this.ui.wakeBtn.disabled = !enabled;
        if (this.ui.sleepBtn) this.ui.sleepBtn.disabled = !enabled;
    }

    /**
     * 記錄日誌
     */
    log(message, type = 'info') {
        if (!this.ui.eventLog) {
            console.log(`[${type.toUpperCase()}] ${message}`);
            return;
        }

        const timestamp = new Date().toLocaleTimeString('zh-TW');
        const logEntry = document.createElement('div');
        logEntry.className = `p-2 rounded text-sm ${this.getLogClass(type)}`;
        logEntry.innerHTML = `<span class="text-xs text-gray-500">[${timestamp}]</span> ${message}`;

        this.ui.eventLog.appendChild(logEntry);
        this.ui.eventLog.scrollTop = this.ui.eventLog.scrollHeight;
    }

    /**
     * 取得日誌樣式
     */
    getLogClass(type) {
        const classes = {
            'info': 'bg-blue-50 text-blue-800',
            'success': 'bg-green-50 text-green-800',
            'warning': 'bg-yellow-50 text-yellow-800',
            'error': 'bg-red-50 text-red-800'
        };
        return classes[type] || classes['info'];
    }

    /**
     * 清除日誌
     */
    clearLog() {
        if (this.ui.eventLog) {
            this.ui.eventLog.innerHTML = '';
            this.log('日誌已清除', 'info');
        }
    }

    /**
     * 初始化音訊視覺化
     */
    initAudioVisualization() {
        try {
            if (!this.ui.audioCanvas) return;

            this.canvasCtx = this.ui.audioCanvas.getContext('2d');
            this.audioDataBuffer = new Float32Array(256);
            this.audioDataBufferIndex = 0;
            this.drawVisualization();
        } catch (error) {
            console.log('無法初始化音訊視覺化:', error);
        }
    }

    /**
     * 更新音訊視覺化資料
     */
    updateAudioVisualization(audioData) {
        if (!this.audioDataBuffer) return;

        const copyLength = Math.min(audioData.length, this.audioDataBuffer.length);

        if (copyLength < this.audioDataBuffer.length) {
            this.audioDataBuffer.copyWithin(0, copyLength);
            this.audioDataBuffer.set(audioData.slice(0, copyLength), this.audioDataBuffer.length - copyLength);
        } else {
            this.audioDataBuffer.set(audioData.slice(audioData.length - this.audioDataBuffer.length));
        }
    }

    /**
     * 繪製音訊視覺化
     */
    drawVisualization() {
        if (!this.canvasCtx) return;

        const draw = () => {
            this.animationId = requestAnimationFrame(draw);

            const dataArray = this.audioDataBuffer || new Float32Array(256);
            const canvas = this.ui.audioCanvas;
            const width = canvas.width = canvas.offsetWidth;
            const height = canvas.height = canvas.offsetHeight;

            this.canvasCtx.fillStyle = 'rgb(17, 24, 39)';
            this.canvasCtx.fillRect(0, 0, width, height);

            const barCount = dataArray.length / 4;
            const barWidth = width / barCount;
            let barHeight;
            let x = 0;

            for (let i = 0; i < barCount; i++) {
                let sum = 0;
                const groupSize = 4;
                for (let j = 0; j < groupSize; j++) {
                    const idx = i * groupSize + j;
                    if (idx < dataArray.length) {
                        sum += Math.abs(dataArray[idx]);
                    }
                }
                barHeight = (sum / groupSize) * height * 5;

                const gradient = this.canvasCtx.createLinearGradient(0, height, 0, height - barHeight);
                gradient.addColorStop(0, 'rgb(99, 102, 241)');
                gradient.addColorStop(1, 'rgb(139, 92, 246)');

                this.canvasCtx.fillStyle = gradient;
                this.canvasCtx.fillRect(x, height - barHeight, barWidth, barHeight);

                x += barWidth + 1;
            }
        };

        draw();
    }

    /**
     * 播放音效
     */
    playSound(type) {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            if (type === 'wake') {
                oscillator.frequency.value = 800;
                gainNode.gain.value = 0.1;
            } else if (type === 'sleep') {
                oscillator.frequency.value = 400;
                gainNode.gain.value = 0.1;
            }

            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.1);
        } catch (e) {
            console.log('無法播放音效:', e);
        }
    }

    /**
     * 清理資源
     */
    destroy() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }
}

// 導出給其他模組使用
window.UIManager = UIManager;