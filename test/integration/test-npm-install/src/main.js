/**
 * WebASRCore NPM 測試 (Vite 版本)
 * 基於 script_cdn.js 修改
 *
 * NPM 版本使用注意事項：
 * - 需要使用 ES Module import 語法
 * - Whisper 需要額外安裝 @huggingface/transformers
 * - Vite 會自動處理 WASM 檔案路徑
 */

// 從 NPM 套件載入 WebASRCore
import * as WebASRCore from 'web-asr-core';

// 如果需要使用 Whisper，必須額外安裝並載入 transformers.js
// npm install @huggingface/transformers
let transformers = null;
try {
    // 嘗試載入 transformers（如果已安裝）
    const transformersModule = await import('@huggingface/transformers');
    transformers = transformersModule;
    console.log('[Vite Test] Transformers.js 已載入');
} catch (error) {
    console.warn('[Vite Test] Transformers.js 未安裝，Whisper 功能將無法使用');
    console.log('[Vite Test] 若需使用 Whisper，請執行: npm install @huggingface/transformers');
}

// Whisper 模型狀態管理
const whisperState = {
    source: 'remote',  // NPM 版本預設使用遠端模型
    remoteModelId: 'Xenova/whisper-tiny',
    isLoading: false,
    currentPipeline: null
};

// 全域變數
let audioContext = null;
let microphone = null;
let processor = null;

// Event Architecture v2 服務實例
let vadService = null;
let wakewordService = null;
let whisperService = null;
let timerService = null;

// 非事件驅動類實例
let audioCapture = null;
let audioResampler = null;
let audioChunker = null;
let audioRingBuffer = null;

// 服務狀態 (Event Architecture v2)
let vadState = null;
let wakewordStates = new Map(); // 每個喚醒詞一個狀態

// 測試狀態
let vadTesting = false;
let wakewordTesting = false;
let whisperRecording = false;
let recordedAudio = [];

// 更新錄音時間顯示
function updateRecordingTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const timeStr = `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    const recordingTimeEl = document.getElementById('recordingTime');
    if (recordingTimeEl) {
        recordingTimeEl.textContent = timeStr;
    }
}

// 等待 DOM 載入完成
document.addEventListener('DOMContentLoaded', () => {
    console.log('[Vite Test] DOM 已載入，開始初始化...');

    // 綁定分頁切換
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.dataset.tab;

            // 更新按鈕狀態
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            // 更新內容顯示
            tabContents.forEach(content => {
                if (content.id === `${targetTab}-tab`) {
                    content.classList.remove('hidden');
                } else {
                    content.classList.add('hidden');
                }
            });
        });
    });

    // 綁定按鈕事件
    document.getElementById('initBtn').addEventListener('click', initializeServices);
    document.getElementById('startBtn').addEventListener('click', startTesting);
    document.getElementById('stopBtn').addEventListener('click', stopTesting);
    document.getElementById('clearBtn').addEventListener('click', clearResults);
    document.getElementById('diagnosticBtn').addEventListener('click', runDiagnostics);

    // 音訊檔案處理
    const audioFileInput = document.getElementById('audioFile');
    if (audioFileInput) {
        audioFileInput.addEventListener('change', handleAudioFile);
    }

    const processAudioBtn = document.getElementById('processAudioBtn');
    if (processAudioBtn) {
        processAudioBtn.addEventListener('click', processUploadedAudio);
    }
});

// 初始化服務
async function initializeServices() {
    const initBtn = document.getElementById('initBtn');
    const initStatus = document.getElementById('initStatus');
    const initLoading = document.getElementById('initLoading');

    initBtn.disabled = true;
    initLoading.classList.remove('hidden');
    initStatus.textContent = '正在初始化服務...';

    try {
        // 初始化 VAD 服務
        await initVAD();
        addLog('✓ VAD 服務已初始化', 'success');

        // 初始化 WakeWord 服務
        await initWakeWord();
        addLog('✓ WakeWord 服務已初始化', 'success');

        // 初始化 Whisper 服務（如果 transformers 可用）
        if (transformers) {
            await initWhisper();
            addLog('✓ Whisper 服務已初始化', 'success');
        } else {
            addLog('⚠ Whisper 服務未初始化（需要安裝 transformers）', 'warning');
        }

        // 初始化 Timer 服務
        initTimer();
        addLog('✓ Timer 服務已初始化', 'success');

        initStatus.textContent = '所有服務已就緒';
        initStatus.className = 'p-2 bg-green-500/20 backdrop-blur-sm rounded-lg text-white text-sm';

        // 啟用測試按鈕
        document.getElementById('startBtn').disabled = false;

    } catch (error) {
        console.error('初始化失敗:', error);
        initStatus.textContent = `初始化失敗: ${error.message}`;
        initStatus.className = 'p-2 bg-red-500/20 backdrop-blur-sm rounded-lg text-white text-sm';
        addLog(`✗ 初始化失敗: ${error.message}`, 'error');
    } finally {
        initLoading.classList.add('hidden');
    }
}

// 初始化 VAD 服務
async function initVAD() {
    console.log('[Vite Test] 初始化 VAD 服務...');

    // 使用 Event Architecture v2
    vadService = new WebASRCore.VadService({
        threshold: 0.5,
        minSpeechFrames: 5,
        preSpeechPadFrames: 10,
        postSpeechPadFrames: 10
    });

    await vadService.initialize();
    vadState = vadService.createState();

    console.log('[Vite Test] VAD 服務初始化完成');
}

// 初始化 WakeWord 服務
async function initWakeWord() {
    console.log('[Vite Test] 初始化 WakeWord 服務...');

    wakewordService = new WebASRCore.WakewordService();
    await wakewordService.initialize();

    // 載入喚醒詞模型
    const wakewords = ['hey-jarvis', 'alexa'];
    for (const word of wakewords) {
        await wakewordService.loadModel(word);
        wakewordStates.set(word, wakewordService.createState(word));
    }

    console.log('[Vite Test] WakeWord 服務初始化完成');
}

// 初始化 Whisper 服務
async function initWhisper() {
    if (!transformers) {
        throw new Error('Transformers.js 未載入');
    }

    console.log('[Vite Test] 初始化 Whisper 服務...');

    whisperService = new WebASRCore.WhisperService({
        transformers: transformers,  // 傳入 transformers 實例
        language: 'zh',
        temperature: 0.8
    });

    // 使用較小的模型以加快載入速度
    await whisperService.initialize('Xenova/whisper-tiny', {
        quantized: true,
        device: 'wasm'
    });

    console.log('[Vite Test] Whisper 服務初始化完成');
}

// 初始化 Timer 服務
function initTimer() {
    console.log('[Vite Test] 初始化 Timer 服務...');

    timerService = new WebASRCore.TimerService();

    // 監聽計時器事件
    timerService.on('tick', (data) => {
        updateRecordingTime(data.elapsed);
    });

    timerService.on('stopped', (data) => {
        console.log(`[Timer] 停止，總時長: ${data.elapsed}秒`);
    });

    console.log('[Vite Test] Timer 服務初始化完成');
}

// 開始測試
async function startTesting() {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');

    startBtn.disabled = true;
    stopBtn.disabled = false;

    try {
        // 請求麥克風權限
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: 16000,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });

        microphone = stream;

        // 創建音訊處理鏈
        audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: 16000
        });

        const source = audioContext.createMediaStreamSource(stream);

        // 使用 ScriptProcessorNode（為了簡化測試）
        processor = audioContext.createScriptProcessor(512, 1, 1);

        // 初始化音訊工具
        audioCapture = new WebASRCore.AudioCapture();
        audioResampler = new WebASRCore.AudioResampler(audioContext.sampleRate, 16000);
        audioChunker = new WebASRCore.AudioChunker(512);
        audioRingBuffer = new WebASRCore.AudioRingBuffer(16000 * 30);

        // 開始計時
        if (timerService) {
            timerService.start();
        }

        // 設定測試狀態
        vadTesting = true;
        wakewordTesting = true;
        whisperRecording = true;
        recordedAudio = [];

        // 處理音訊
        processor.onaudioprocess = async (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            const float32Array = new Float32Array(inputData);

            // 計算音量
            const maxAbs = Math.max(...float32Array.map(Math.abs));
            const dBFS = maxAbs > 0 ? 20 * Math.log10(maxAbs) : -100;
            document.getElementById('volumeLevel').textContent = dBFS.toFixed(1);

            // 重採樣到 16kHz
            const resampled = audioResampler.resample(float32Array);

            // 處理音訊塊
            audioChunker.process(resampled, async (chunk) => {
                // VAD 處理
                if (vadTesting && vadService) {
                    const vadResult = await vadService.process(vadState, chunk, vadService.createParams());
                    vadState = vadResult.state;

                    if (vadResult.detected) {
                        document.getElementById('vadStatus').textContent = '檢測到語音';
                        document.getElementById('vadStatus').className = 'text-sm font-semibold text-green-600';
                    } else {
                        document.getElementById('vadStatus').textContent = '靜音';
                        document.getElementById('vadStatus').className = 'text-sm font-semibold text-gray-600';
                    }
                }

                // WakeWord 處理
                if (wakewordTesting && wakewordService) {
                    for (const [word, state] of wakewordStates) {
                        const wakeResult = await wakewordService.process(
                            state,
                            chunk,
                            wakewordService.createParams(word)
                        );
                        wakewordStates.set(word, wakeResult.state);

                        if (wakeResult.detected) {
                            document.getElementById('wakeStatus').textContent = `檢測到: ${word}`;
                            document.getElementById('wakeStatus').className = 'text-sm font-semibold text-purple-600';
                            addResult(`🎯 喚醒詞檢測: ${word} (分數: ${wakeResult.score.toFixed(3)})`);
                        }
                    }
                }

                // 錄音緩衝（用於 Whisper）
                if (whisperRecording) {
                    audioRingBuffer.write(chunk);
                    recordedAudio.push(...chunk);
                }
            });
        };

        source.connect(processor);
        processor.connect(audioContext.destination);

        addLog('✓ 開始語音測試', 'success');

    } catch (error) {
        console.error('開始測試失敗:', error);
        addLog(`✗ 開始測試失敗: ${error.message}`, 'error');
        startBtn.disabled = false;
        stopBtn.disabled = true;
    }
}

// 停止測試
async function stopTesting() {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');

    // 停止計時
    if (timerService) {
        timerService.stop();
    }

    // 停止音訊處理
    if (processor) {
        processor.disconnect();
        processor = null;
    }

    if (microphone) {
        microphone.getTracks().forEach(track => track.stop());
        microphone = null;
    }

    if (audioContext) {
        await audioContext.close();
        audioContext = null;
    }

    // 處理錄音（Whisper）
    if (whisperRecording && recordedAudio.length > 0 && whisperService) {
        document.getElementById('whisperStatus').textContent = '處理中...';

        try {
            const audioData = new Float32Array(recordedAudio);
            const result = await whisperService.transcribe(audioData);

            if (result && result.text) {
                document.getElementById('whisperStatus').textContent = '完成';
                addResult(`🎤 語音轉文字: ${result.text}`);
            } else {
                document.getElementById('whisperStatus').textContent = '無結果';
            }
        } catch (error) {
            console.error('Whisper 處理失敗:', error);
            document.getElementById('whisperStatus').textContent = '失敗';
            addLog(`✗ Whisper 處理失敗: ${error.message}`, 'error');
        }
    }

    // 重置狀態
    vadTesting = false;
    wakewordTesting = false;
    whisperRecording = false;
    recordedAudio = [];

    startBtn.disabled = false;
    stopBtn.disabled = true;

    addLog('✓ 停止語音測試', 'info');
}

// 清除結果
function clearResults() {
    document.getElementById('results').innerHTML = '<div class="text-gray-500 text-sm">測試結果將顯示在這裡...</div>';
    document.getElementById('systemLog').innerHTML = '<div class="text-green-400">[系統] 日誌已清除</div>';
    document.getElementById('audioResults').innerHTML = '<div class="text-gray-500 text-sm">音訊處理結果將顯示在這裡...</div>';
}

// 執行系統診斷
async function runDiagnostics() {
    const diagnosticResult = document.getElementById('diagnosticResult');
    diagnosticResult.innerHTML = '<div class="text-cyan-400 text-xs">正在執行診斷...</div>';

    const results = [];

    // 檢查 WebASRCore
    results.push('<div class="text-green-400">✓ WebASRCore 已載入 (NPM)</div>');
    results.push(`<div class="text-gray-400">  版本: 0.7.1</div>`);
    results.push(`<div class="text-gray-400">  服務: ${Object.keys(WebASRCore).join(', ')}</div>`);

    // 檢查 Transformers.js
    if (transformers) {
        results.push('<div class="text-green-400">✓ Transformers.js 已安裝</div>');
    } else {
        results.push('<div class="text-yellow-400">⚠ Transformers.js 未安裝</div>');
        results.push('<div class="text-gray-400">  執行: npm install @huggingface/transformers</div>');
    }

    // 檢查 Vite 環境
    if (import.meta.env) {
        results.push('<div class="text-green-400">✓ Vite 環境檢測</div>');
        results.push(`<div class="text-gray-400">  模式: ${import.meta.env.MODE}</div>`);
        results.push(`<div class="text-gray-400">  開發: ${import.meta.env.DEV}</div>`);
    }

    // 檢查瀏覽器功能
    results.push('<div class="text-cyan-400">瀏覽器功能:</div>');
    results.push(`<div class="text-gray-400">  WebAssembly: ${typeof WebAssembly !== 'undefined' ? '✓' : '✗'}</div>`);
    results.push(`<div class="text-gray-400">  AudioWorklet: ${typeof AudioWorkletNode !== 'undefined' ? '✓' : '✗'}</div>`);
    results.push(`<div class="text-gray-400">  Web Worker: ${typeof Worker !== 'undefined' ? '✓' : '✗'}</div>`);
    results.push(`<div class="text-gray-400">  WebGPU: ${navigator.gpu ? '✓' : '✗'}</div>`);

    // 檢查服務狀態
    results.push('<div class="text-cyan-400">服務狀態:</div>');
    results.push(`<div class="text-gray-400">  VAD: ${vadService ? '已初始化' : '未初始化'}</div>`);
    results.push(`<div class="text-gray-400">  WakeWord: ${wakewordService ? '已初始化' : '未初始化'}</div>`);
    results.push(`<div class="text-gray-400">  Whisper: ${whisperService ? '已初始化' : '未初始化'}</div>`);
    results.push(`<div class="text-gray-400">  Timer: ${timerService ? '已初始化' : '未初始化'}</div>`);

    diagnosticResult.innerHTML = results.join('\n');
}

// 處理音訊檔案
async function handleAudioFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const processBtn = document.getElementById('processAudioBtn');
    const downloadBtn = document.getElementById('downloadAudioBtn');

    processBtn.disabled = false;
    downloadBtn.disabled = false;

    addLog(`✓ 已選擇檔案: ${file.name}`, 'info');
}

// 處理上傳的音訊
async function processUploadedAudio() {
    const fileInput = document.getElementById('audioFile');
    const file = fileInput.files[0];
    if (!file) return;

    const audioResults = document.getElementById('audioResults');
    audioResults.innerHTML = '<div class="text-blue-500">正在處理音訊...</div>';

    try {
        // 讀取音訊檔案
        const arrayBuffer = await file.arrayBuffer();
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // 轉換為 16kHz 單聲道
        const resampler = new WebASRCore.AudioResampler(audioBuffer.sampleRate, 16000);
        const channelData = audioBuffer.getChannelData(0);
        const resampled = resampler.resample(channelData);

        // 執行 VAD 分析
        if (vadService) {
            let state = vadService.createState();
            const chunkSize = 512;
            let speechFrames = 0;

            for (let i = 0; i < resampled.length - chunkSize; i += chunkSize) {
                const chunk = resampled.slice(i, i + chunkSize);
                const result = await vadService.process(state, chunk, vadService.createParams());
                state = result.state;
                if (result.detected) speechFrames++;
            }

            const speechRatio = speechFrames / Math.floor(resampled.length / chunkSize);
            audioResults.innerHTML += `<div class="text-green-400">VAD 分析: ${(speechRatio * 100).toFixed(1)}% 語音內容</div>`;
        }

        // 執行 Whisper 轉錄
        if (whisperService) {
            audioResults.innerHTML += '<div class="text-blue-400">正在執行語音轉文字...</div>';
            const result = await whisperService.transcribe(resampled);
            if (result && result.text) {
                audioResults.innerHTML += `<div class="text-green-400">轉錄結果: ${result.text}</div>`;
            }
        }

    } catch (error) {
        console.error('處理音訊失敗:', error);
        audioResults.innerHTML = `<div class="text-red-500">處理失敗: ${error.message}</div>`;
    }
}

// 新增結果到顯示區
function addResult(text) {
    const results = document.getElementById('results');
    const time = new Date().toLocaleTimeString('zh-TW');
    const entry = document.createElement('div');
    entry.className = 'bg-white rounded-lg p-3 shadow-sm animate-slide-in';
    entry.innerHTML = `
        <div class="text-xs text-gray-500">${time}</div>
        <div class="text-sm text-gray-800 mt-1">${text}</div>
    `;
    results.appendChild(entry);
    results.scrollTop = results.scrollHeight;
}

// 新增日誌
function addLog(message, type = 'info') {
    const systemLog = document.getElementById('systemLog');
    const time = new Date().toLocaleTimeString('zh-TW');
    const colorClass = {
        'success': 'text-green-400',
        'error': 'text-red-400',
        'warning': 'text-yellow-400',
        'info': 'text-cyan-400'
    }[type] || 'text-gray-400';

    const entry = document.createElement('div');
    entry.className = `${colorClass} log-entry`;
    entry.textContent = `[${time}] ${message}`;
    systemLog.appendChild(entry);
    systemLog.scrollTop = systemLog.scrollHeight;

    console.log(`[${type.toUpperCase()}] ${message}`);
}