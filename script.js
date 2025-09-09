
// 導入 WebASRCore - 使用動態 import 因為我們在 script module 中
const WebASRCore = await import('./dist/web-asr-core.bundle.js');

// 全域變數
let audioContext = null;
let microphone = null;
let processor = null;

// 模型資源
let vadSession = null;
let vadState = null;
let wakewordResources = null;
let wakewordState = null;
let whisperResources = null;

// 測試狀態
let vadTesting = false;
let wakewordTesting = false;
let whisperRecording = false;
let recordedAudio = [];

// 工具函數 - 添加日誌樣式類別
function log(elementId, message, type = 'info') {
    const logEl = document.getElementById(elementId);
    const entry = document.createElement('div');

    // 根據類型設定樣式
    const typeStyles = {
        'info': 'text-blue-400',
        'success': 'text-green-400 font-semibold',
        'warning': 'text-yellow-400',
        'error': 'text-red-400 font-semibold'
    };

    entry.className = `log-entry ${typeStyles[type] || 'text-gray-400'}`;
    const time = new Date().toLocaleTimeString('zh-TW');
    entry.textContent = `[${time}] ${message}`;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;

    // 限制日誌條目數量
    while (logEl.children.length > 50) {
        logEl.removeChild(logEl.firstChild);
    }
}

// 音訊視覺化
function drawWaveform(canvasId, audioData) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#818cf8';
    ctx.lineWidth = 2;
    ctx.beginPath();

    const step = width / audioData.length;
    for (let i = 0; i < audioData.length; i++) {
        const x = i * step;
        const y = height / 2 + (audioData[i] * height * 0.4);
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();
}

// 重採樣函數
function resampleTo16kHz(audioData, fromSampleRate) {
    if (fromSampleRate === 16000) {
        return audioData;
    }

    const ratio = fromSampleRate / 16000;
    const newLength = Math.floor(audioData.length / ratio);
    const resampled = new Float32Array(newLength);

    for (let i = 0; i < newLength; i++) {
        const index = i * ratio;
        const indexFloor = Math.floor(index);
        const indexCeil = Math.min(indexFloor + 1, audioData.length - 1);
        const fraction = index - indexFloor;

        resampled[i] = audioData[indexFloor] * (1 - fraction) +
            audioData[indexCeil] * fraction;
    }

    return resampled;
}

// 初始化音訊
async function initAudio() {
    try {
        // 關閉所有音訊處理以獲得原始音訊
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                sampleRate: 16000,
                channelCount: 1,
                echoCancellation: false,  // 關閉回音消除
                noiseSuppression: false,  // 關閉降噪
                autoGainControl: false    // 關閉自動增益控制
            }
        });
        
        // 驗證實際生效的設定
        const audioTrack = stream.getAudioTracks()[0];
        const actualSettings = audioTrack.getSettings();
        console.log('音訊設定驗證:', {
            channelCount: actualSettings.channelCount,
            sampleRate: actualSettings.sampleRate,
            echoCancellation: actualSettings.echoCancellation,
            noiseSuppression: actualSettings.noiseSuppression,
            autoGainControl: actualSettings.autoGainControl
        });

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        microphone = audioContext.createMediaStreamSource(stream);

        // 使用 AudioWorkletNode 替代 ScriptProcessorNode
        try {
            // 先載入 worklet module
            await audioContext.audioWorklet.addModule('worklets/audio-processor.worklet.js');
            
            // 創建 AudioWorkletNode
            processor = new AudioWorkletNode(audioContext, 'audio-processor');
            
            // 配置處理器
            processor.port.postMessage({
                type: 'configure',
                vadChunkSize: 512, // 32ms at 16kHz for VAD
                wakewordChunkSize: 1280 // 80ms at 16kHz for WakeWord
            });
            
            // 處理來自 worklet 的訊息
            processor.port.onmessage = (event) => {
                if (event.data.type === 'vad') {
                    processVadChunk(event.data.data);
                } else if (event.data.type === 'wakeword') {
                    processWakewordChunk(event.data.data);
                }
            };
            
            console.log('✅ 使用 AudioWorkletNode (現代 API)');
        } catch (error) {
            console.warn('AudioWorkletNode 不支援，降級使用 ScriptProcessorNode:', error);
            
            // 降級方案：繼續使用 ScriptProcessorNode
            processor = audioContext.createScriptProcessor(2048, 1, 1);

            let vadBuffer = [];
            let wakewordBuffer = [];
            const vadChunkSize = 512; // 32ms at 16kHz for VAD
            const wakewordChunkSize = 1280; // 80ms at 16kHz for WakeWord

            processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                const resampled = resampleTo16kHz(inputData, audioContext.sampleRate);

                // 累積音訊數據到兩個 buffer
                for (let i = 0; i < resampled.length; i++) {
                    vadBuffer.push(resampled[i]);
                    wakewordBuffer.push(resampled[i]);
                }

                // 處理 VAD (需要 512 個樣本)
                while (vadBuffer.length >= vadChunkSize) {
                    const vadChunk = new Float32Array(vadBuffer.slice(0, vadChunkSize));
                    vadBuffer = vadBuffer.slice(vadChunkSize);
                    processVadChunk(vadChunk);
                }

                // 處理 WakeWord (需要 1280 個樣本)
                while (wakewordBuffer.length >= wakewordChunkSize) {
                    const wakewordChunk = new Float32Array(wakewordBuffer.slice(0, wakewordChunkSize));
                    wakewordBuffer = wakewordBuffer.slice(wakewordChunkSize);
                    processWakewordChunk(wakewordChunk);
                }
            };
            
            console.log('⚠️ 使用 ScriptProcessorNode (已棄用但仍可運作)');
        }

        return true;
    } catch (error) {
        console.error('音訊初始化失敗:', error);
        return false;
    }
}

// VAD 處理中標記
let vadProcessing = false;

// 處理 VAD 音訊塊 (512 samples)
async function processVadChunk(chunk) {
    if (vadTesting && vadSession && vadState && !vadProcessing) {
        vadProcessing = true;  // 標記處理中
        try {
            const result = await WebASRCore.processVad(
                vadSession,
                vadState,
                chunk,
                WebASRCore.DEFAULT_VAD_PARAMS
            );

            vadState = result.state;

            if (result.detected) {
                log('vadLog', `語音檢測到！分數: ${result.score.toFixed(3)}`, 'success');
                drawWaveform('vadCanvas', chunk);
            }
        } catch (error) {
            log('vadLog', `VAD 錯誤: ${error.message}`, 'error');
        } finally {
            vadProcessing = false;  // 處理完成
        }
    }
}

// 喚醒詞處理中標記
let wakewordProcessing = false;

// 喚醒詞配置 - 每個模型不同的閾值和參數
const WAKEWORD_CONFIG = {
    'hey-jarvis': { 
        threshold: 0.5,  // 使用官方建議的 0.5 起點
        minConsecutive: 1,  // 降低連續幀要求
        refractoryMs: 1000,
        useVad: true,  // VAD 作為二次確認
        minRms: 0.002  // 最小 RMS 值（過濾靜音）
    },
    'hey-mycroft': { 
        threshold: 0.6,  // mycroft 調整為 0.6（0.7 太高了）
        minConsecutive: 2,  // mycroft 需要連續 2 幀以減少誤觸發
        refractoryMs: 1500,  // 更長的冷卻時間（1.5秒）
        useVad: true,  // VAD 作為二次確認
        minRms: 0.002  // 最小 RMS 值（過濾靜音）
    },
    'alexa': { 
        threshold: 0.5,  // 使用官方建議的 0.5 起點
        minConsecutive: 1,  // 降低連續幀要求
        refractoryMs: 1000,
        useVad: true,  // VAD 作為二次確認
        minRms: 0.002  // 最小 RMS 值（過濾靜音）
    }
};

// 喚醒詞運行時狀態
let wwRuntime = {
    lastTriggerAt: 0,
    consecutiveFrames: 0
};

// 處理喚醒詞音訊塊 (1280 samples)
async function processWakewordChunk(chunk) {
    if (wakewordTesting && wakewordResources && wakewordState && !wakewordProcessing) {
        wakewordProcessing = true;  // 標記處理中
        
        const wakewordName = document.getElementById('wakewordSelect').value;
        const cfg = WAKEWORD_CONFIG[wakewordName] || { 
            threshold: 0.5, 
            minConsecutive: 2, 
            refractoryMs: 1500,
            useVad: true 
        };
        
        let triggered = false;
        let score = 0;
        
        try {
            // 根據參考文章：喚醒詞管線要連續跑，不要被 VAD 節流
            const result = await WebASRCore.processWakewordChunk(
                wakewordResources,
                wakewordState,
                chunk,
                { threshold: cfg.threshold }  // 使用模型特定的閾值
            );

            wakewordState = result.state;
            score = result.score;
            
            // 在與模型相同的 buffer 上計算音訊統計
            let sum = 0;
            let maxAbs = 0;
            let nonZeroCount = 0;
            
            for (let i = 0; i < chunk.length; i++) {
                const v = chunk[i];
                sum += v * v;
                const a = Math.abs(v);
                if (a > maxAbs) maxAbs = a;
                if (v !== 0) nonZeroCount++;
            }
            
            const rms = Math.sqrt(sum / chunk.length);
            const dbfs = 20 * Math.log10(Math.max(rms, 1e-9));
            const fillRate = (nonZeroCount / chunk.length * 100).toFixed(1);
            
            // 詳細診斷日誌
            if (score > 0.2 || maxAbs < 0.01) {
                console.log(`[${wakewordName}] 診斷:`, {
                    score: score.toFixed(3),
                    dBFS: dbfs.toFixed(1),
                    maxAbs: maxAbs.toFixed(6),
                    rms: rms.toFixed(6),
                    fillRate: fillRate + '%',
                    縮放問題: maxAbs < 0.005 ? '是' : '否'
                });
            }
            
            // 音訊健康檢查
            if (maxAbs < 0.005 && score > 0.5) {
                console.error(`[${wakewordName}] 嚴重：音訊被過度縮放！maxAbs=${maxAbs.toFixed(6)} (應該 > 0.01)`);
                console.error('請檢查音訊鏈路是否有重複的正規化或 /32768 操作');
            }
            
            // 檢查是否超過閾值
            if (result.score >= cfg.threshold) {
                wwRuntime.consecutiveFrames += 1;
            } else {
                wwRuntime.consecutiveFrames = 0;
            }
            
            // 檢查是否滿足觸發條件
            const now = performance.now();
            if (wwRuntime.consecutiveFrames >= cfg.minConsecutive && 
                (now - wwRuntime.lastTriggerAt) > cfg.refractoryMs) {
                
                // 如果啟用 VAD，這裡才做二次確認（不是門檻）
                if (cfg.useVad) {
                    // 使用 dBFS 作為二次確認（調整閾值以適應當前音訊縮放問題）
                    const rmsCheck = Math.sqrt(chunk.reduce((sum, val) => sum + val * val, 0) / chunk.length);
                    const dbfsCheck = 20 * Math.log10(Math.max(rmsCheck, 1e-9));
                    
                    // 暫時放寬到 -65 dBFS（因為音訊被壓縮）
                    // 正常修復後應該調回 -50 dBFS
                    const minDbfs = -65;  
                    
                    // 高分數時直接觸發，不管能量
                    if (score >= 0.6) {
                        triggered = true;
                        if (dbfsCheck < minDbfs) {
                            console.warn(`[${wakewordName}] 高分低能量觸發 - Score: ${score.toFixed(3)}, dBFS: ${dbfsCheck.toFixed(1)}`);
                        }
                    } else if (dbfsCheck < minDbfs) {
                        log('wakewordLog', `分數 ${score.toFixed(3)} 但音訊過於安靜 (dBFS: ${dbfsCheck.toFixed(1)} < ${minDbfs})`, 'info');
                        // 不要重置 consecutiveFrames，讓管線持續運行
                        // wwRuntime.consecutiveFrames = 0; 
                    } else {
                        triggered = true;
                    }
                } else {
                    triggered = true;
                }
                
                if (triggered) {
                    wwRuntime.lastTriggerAt = now;
                    wwRuntime.consecutiveFrames = 0;  // 觸發後重置
                    
                    // 重置喚醒詞狀態 - 完全重新創建以清空所有緩衝區
                    const dims = WebASRCore.detectWakewordDims(wakewordResources);
                    wakewordState = WebASRCore.createWakewordState(dims);
                }
            }
            
            // 顯示分數（用於調試）- 提供更詳細的診斷資訊
            if (result.score > 0.3 && !triggered) {
                const rms = Math.sqrt(chunk.reduce((sum, val) => sum + val * val, 0) / chunk.length);
                log('wakewordLog', 
                    `[${wakewordName}] 分數: ${result.score.toFixed(3)} | ` +
                    `連續: ${wwRuntime.consecutiveFrames}/${cfg.minConsecutive} | ` +
                    `RMS: ${rms.toFixed(4)} | ` +
                    `閾值: ${cfg.threshold}`, 
                    'info'
                );
            }
            
            if (triggered) {
                log('wakewordLog', `喚醒詞檢測到！"${wakewordName}" 分數: ${score.toFixed(3)}`, 'success');
                drawWaveform('wakewordCanvas', chunk);
            }
        } catch (error) {
            log('wakewordLog', `喚醒詞錯誤: ${error.message}`, 'error');
        } finally {
            wakewordProcessing = false;  // 處理完成
        }
    }

    // Whisper 錄音 (使用喚醒詞的塊大小)
    if (whisperRecording) {
        recordedAudio.push(...chunk);
        drawWaveform('whisperCanvas', chunk);
    }
}

// 更新狀態樣式
function updateStatus(elementId, text, type = 'normal') {
    const element = document.getElementById(elementId);
    element.textContent = text;

    // 移除所有狀態類別
    element.className = element.className.replace(/border-l-4 border-\w+-400/g, '');
    element.className = element.className.replace(/bg-\w+-50/g, '');

    // 根據類型添加新類別
    const baseClasses = 'px-3 py-2 bg-white rounded-lg text-sm font-medium mb-2 border-l-4';
    if (type === 'active') {
        element.className = `${baseClasses} border-green-400 bg-green-50`;
    } else if (type === 'error') {
        element.className = `${baseClasses} border-red-400 bg-red-50`;
    } else {
        element.className = `${baseClasses} border-gray-400`;
    }
}

// 音訊健康檢查函數
function audioHealthCheck() {
    const testLength = 1280; // 80ms at 16kHz
    const testChunk = new Float32Array(testLength);
    const frequency = 1000; // 1kHz
    const amplitude = 0.2;
    
    for (let i = 0; i < testLength; i++) {
        testChunk[i] = amplitude * Math.sin(2 * Math.PI * frequency * i / 16000);
    }
    
    let sum = 0;
    let maxAbs = 0;
    for (let i = 0; i < testChunk.length; i++) {
        sum += testChunk[i] * testChunk[i];
        maxAbs = Math.max(maxAbs, Math.abs(testChunk[i]));
    }
    
    const rms = Math.sqrt(sum / testChunk.length);
    const dbfs = 20 * Math.log10(rms);
    const expectedDbfs = 20 * Math.log10(amplitude / Math.sqrt(2));
    
    console.log('=== 音訊健康檢查 ===');
    console.log(`測試訊號: 1kHz, 振幅=${amplitude}`);
    console.log(`實測 dBFS: ${dbfs.toFixed(1)}`);
    console.log(`預期 dBFS: ${expectedDbfs.toFixed(1)}`);
    console.log(`差異: ${(dbfs - expectedDbfs).toFixed(1)} dB`);
    
    if (Math.abs(dbfs - expectedDbfs) > 1) {
        console.error('⚠️ 檢測到音訊鏈路縮放問題！');
    }
    
    return testChunk;
}

// 初始化按鈕事件
document.getElementById('initBtn').addEventListener('click', async () => {
    const btn = document.getElementById('initBtn');
    const status = document.getElementById('initStatus');
    const loading = document.getElementById('initLoading');

    btn.disabled = true;
    loading.classList.remove('hidden');
    status.textContent = '正在載入模型...';

    try {
        // 硬編碼模型路徑配置
        const MODEL_PATHS = {
            vad: {
                modelUrl: '../models/github/snakers4/silero-vad/silero_vad_v6.onnx'
            },
            wakeword: {
                'hey-jarvis': {
                    detectorUrl: '../models/github/dscripka/openWakeWord/hey_jarvis_v0.1.onnx',
                    melspecUrl: '../models/github/dscripka/openWakeWord/melspectrogram.onnx',
                    embeddingUrl: '../models/github/dscripka/openWakeWord/embedding_model.onnx',
                    threshold: 0.5
                },
                'hey-mycroft': {
                    detectorUrl: '../models/github/dscripka/openWakeWord/hey_mycroft_v0.1.onnx',
                    melspecUrl: '../models/github/dscripka/openWakeWord/melspectrogram.onnx',
                    embeddingUrl: '../models/github/dscripka/openWakeWord/embedding_model.onnx',
                    threshold: 0.5
                },
                'alexa': {
                    detectorUrl: '../models/github/dscripka/openWakeWord/alexa_v0.1.onnx',
                    melspecUrl: '../models/github/dscripka/openWakeWord/melspectrogram.onnx',
                    embeddingUrl: '../models/github/dscripka/openWakeWord/embedding_model.onnx',
                    threshold: 0.5
                }
            },
            whisper: {
                // path: 'Xenova/whisper-base',  // 這個會用 transformers.js 從 HuggingFace 載入
                path: 'Xenova/whisper-base',  // 模型 ID，會從 localModelPath 載入
                quantized: true
            }
        };

        // 載入 VAD
        log('vadLog', '載入 VAD 模型...', 'info');
        vadSession = await WebASRCore.loadVadSession(MODEL_PATHS.vad.modelUrl);
        vadState = WebASRCore.createVadState();
        log('vadLog', 'VAD 模型載入成功', 'success');

        // 載入喚醒詞
        const wakewordId = document.getElementById('wakewordSelect').value;
        log('wakewordLog', `載入 ${wakewordId} 喚醒詞模型...`, 'info');
        const wwPaths = MODEL_PATHS.wakeword[wakewordId];
        
        // 創建配置管理器並設定路徑
        const config = new WebASRCore.ConfigManager();
        const wakewordName = wakewordId.replace('-', '_'); // hey-jarvis -> hey_jarvis
        config.wakeword[wakewordName].detectorPath = wwPaths.detectorUrl;
        config.wakeword[wakewordName].melspecPath = wwPaths.melspecUrl;
        config.wakeword[wakewordName].embeddingPath = wwPaths.embeddingUrl;
        
        // 使用新的 API
        wakewordResources = await WebASRCore.loadWakewordResources(wakewordName, config);
        const dims = WebASRCore.detectWakewordDims(wakewordResources);
        wakewordState = WebASRCore.createWakewordState(dims);
        log('wakewordLog', '喚醒詞模型載入成功', 'success');

        // 載入 Whisper (使用本地模型)
        log('whisperLog', '載入 Whisper 模型 (本地)...', 'info');
        
        // 確保 transformers.js 已經載入並配置
        if (window.transformers) {
            const { env } = window.transformers;
            // 設定本地模型路徑 - 重要：這裡設定基礎路徑
            env.localModelPath = '../models/huggingface/';
            env.allowLocalModels = true;
            env.allowRemoteModels = false;
            // 設定 WASM 路徑
            env.backends = env.backends || {};
            env.backends.onnx = env.backends.onnx || {};
            env.backends.onnx.wasm = env.backends.onnx.wasm || {};
            env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/';
            log('whisperLog', 'Transformers.js 環境已配置', 'info');
        }
        
        // 使用模型 ID，會自動從 localModelPath + modelId 載入
        whisperResources = await WebASRCore.loadWhisperResources(
            MODEL_PATHS.whisper.path,  // 'Xenova/whisper-base'
            { 
                quantized: MODEL_PATHS.whisper.quantized,
                localBasePath: '../models/huggingface/'  // 本地模型基礎路徑
            }
        );
        log('whisperLog', 'Whisper 模型載入成功', 'success');

        // 初始化音訊
        if (await initAudio()) {
            status.textContent = '✅ 所有模型載入成功！可以開始測試了';
            status.className = 'mt-3 p-3 bg-green-100 rounded-lg text-green-800 font-medium';

            // 啟用測試按鈕
            document.getElementById('vadStartBtn').disabled = false;
            document.getElementById('wakewordStartBtn').disabled = false;
            document.getElementById('wakewordSelect').disabled = false;
            document.getElementById('whisperRecordBtn').disabled = false;

            // 更新狀態
            updateStatus('vadStatus', '準備就緒');
            updateStatus('wakewordStatus', '準備就緒');
            updateStatus('whisperStatus', '準備就緒');
        } else {
            throw new Error('音訊初始化失敗');
        }

    } catch (error) {
        log('vadLog', `初始化失敗: ${error.message}`, 'error');
        log('wakewordLog', `初始化失敗: ${error.message}`, 'error');
        log('whisperLog', `初始化失敗: ${error.message}`, 'error');
        status.textContent = `❌ 初始化失敗: ${error.message}`;
        status.className = 'mt-3 p-3 bg-red-100 rounded-lg text-red-800 font-medium';
    } finally {
        loading.classList.add('hidden');
    }
});

// VAD 測試控制
document.getElementById('vadStartBtn').addEventListener('click', () => {
    vadTesting = true;
    
    // 只在尚未連接時才連接
    try {
        microphone.connect(processor);
        processor.connect(audioContext.destination);
    } catch (e) {
        // 已經連接，忽略錯誤
    }

    document.getElementById('vadStartBtn').disabled = true;
    document.getElementById('vadStopBtn').disabled = false;
    updateStatus('vadStatus', '正在檢測語音活動...', 'active');
    log('vadLog', '開始 VAD 測試', 'success');
});

document.getElementById('vadStopBtn').addEventListener('click', () => {
    vadTesting = false;
    
    // 只在沒有其他服務使用時才斷開連接
    if (!wakewordTesting && !whisperRecording) {
        try {
            processor.disconnect();
            microphone.disconnect();
        } catch (e) {
            // 忽略斷開連接錯誤
        }
    }

    document.getElementById('vadStartBtn').disabled = false;
    document.getElementById('vadStopBtn').disabled = true;
    updateStatus('vadStatus', '測試已停止');
    log('vadLog', '停止 VAD 測試', 'warning');
});

// 喚醒詞測試控制
document.getElementById('wakewordStartBtn').addEventListener('click', () => {
    wakewordTesting = true;
    
    // 只在尚未連接時才連接
    try {
        microphone.connect(processor);
        processor.connect(audioContext.destination);
    } catch (e) {
        // 已經連接，忽略錯誤
    }

    document.getElementById('wakewordStartBtn').disabled = true;
    document.getElementById('wakewordStopBtn').disabled = false;
    document.getElementById('wakewordSelect').disabled = true;

    const wakewordName = document.getElementById('wakewordSelect').value;
    updateStatus('wakewordStatus', `正在聆聽 "${wakewordName}"...`, 'active');
    log('wakewordLog', `開始喚醒詞測試: ${wakewordName}`, 'success');
});

document.getElementById('wakewordStopBtn').addEventListener('click', () => {
    wakewordTesting = false;
    
    // 只在沒有其他服務使用時才斷開連接
    if (!vadTesting && !whisperRecording) {
        try {
            processor.disconnect();
            microphone.disconnect();
        } catch (e) {
            // 忽略斷開連接錯誤
        }
    }

    document.getElementById('wakewordStartBtn').disabled = false;
    document.getElementById('wakewordStopBtn').disabled = true;
    document.getElementById('wakewordSelect').disabled = false;
    updateStatus('wakewordStatus', '測試已停止');
    log('wakewordLog', '停止喚醒詞測試', 'warning');
});

// 切換喚醒詞模型
document.getElementById('wakewordSelect').addEventListener('change', async (e) => {
    const wakewordId = e.target.value;
    log('wakewordLog', `切換到 ${wakewordId} 模型...`, 'info');

    try {
        // 硬重置所有狀態（根據建議）
        // 1. 重置運行時狀態
        wwRuntime.lastTriggerAt = -Infinity;  // 重置觸發時間
        wwRuntime.consecutiveFrames = 0;      // 重置連續幀計數
        
        // 2. 如果正在測試，先停止
        if (wakewordTesting) {
            wakewordTesting = false;
            if (processor) {
                processor.disconnect();
            }
            if (microphone) {
                microphone.disconnect();
            }
            document.getElementById('wakewordStartBtn').textContent = '開始測試';
            document.getElementById('wakewordStartBtn').classList.remove('bg-red-600');
            document.getElementById('wakewordStartBtn').classList.add('bg-indigo-600');
            log('wakewordLog', '停止當前測試以切換模型', 'warning');
        }
        
        // 使用硬編碼的模型路徑
        const MODEL_PATHS = {
            'hey-jarvis': {
                detectorUrl: '../models/github/dscripka/openWakeWord/hey_jarvis_v0.1.onnx',
                melspecUrl: '../models/github/dscripka/openWakeWord/melspectrogram.onnx',
                embeddingUrl: '../models/github/dscripka/openWakeWord/embedding_model.onnx'
            },
            'hey-mycroft': {
                detectorUrl: '../models/github/dscripka/openWakeWord/hey_mycroft_v0.1.onnx',
                melspecUrl: '../models/github/dscripka/openWakeWord/melspectrogram.onnx',
                embeddingUrl: '../models/github/dscripka/openWakeWord/embedding_model.onnx'
            },
            'alexa': {
                detectorUrl: '../models/github/dscripka/openWakeWord/alexa_v0.1.onnx',
                melspecUrl: '../models/github/dscripka/openWakeWord/melspectrogram.onnx',
                embeddingUrl: '../models/github/dscripka/openWakeWord/embedding_model.onnx'
            }
        };

        const wwPaths = MODEL_PATHS[wakewordId];
        
        // 創建配置管理器並設定路徑
        const config = new WebASRCore.ConfigManager();
        const wakewordName = wakewordId.replace('-', '_'); // hey-jarvis -> hey_jarvis
        config.wakeword[wakewordName].detectorPath = wwPaths.detectorUrl;
        config.wakeword[wakewordName].melspecPath = wwPaths.melspecUrl;
        config.wakeword[wakewordName].embeddingPath = wwPaths.embeddingUrl;
        
        // 3. 清理舊資源
        wakewordResources = null;
        wakewordState = null;
        
        // 4. 載入新模型
        wakewordResources = await WebASRCore.loadWakewordResources(wakewordName, config);
        const dims = WebASRCore.detectWakewordDims(wakewordResources);
        
        // 5. 創建全新的狀態（這會清空所有 mel buffer 和 embedding buffer）
        wakewordState = WebASRCore.createWakewordState(dims);
        
        log('wakewordLog', `${wakewordId} 模型載入成功，所有狀態已重置`, 'success');
    } catch (error) {
        log('wakewordLog', `載入失敗: ${error.message}`, 'error');
    }
});

// Whisper 錄音控制
let recordingStartTime = null;
let recordingInterval = null;

document.getElementById('whisperRecordBtn').addEventListener('click', () => {
    whisperRecording = true;
    recordedAudio = [];
    recordingStartTime = Date.now();
    microphone.connect(processor);
    processor.connect(audioContext.destination);

    // 更新按鈕狀態
    document.getElementById('whisperRecordBtn').disabled = true;
    document.getElementById('whisperRecordBtn').classList.add('hidden');
    document.getElementById('whisperStopBtn').classList.remove('hidden');
    document.getElementById('whisperStopBtn').disabled = false;
    document.getElementById('whisperTranscribeBtn').disabled = true;
    
    updateStatus('whisperStatus', '正在錄音...', 'active');
    log('whisperLog', '開始錄音', 'success');
    
    // 更新錄音時長顯示
    recordingInterval = setInterval(() => {
        if (!whisperRecording) {
            clearInterval(recordingInterval);
            return;
        }
        const duration = ((Date.now() - recordingStartTime) / 1000).toFixed(1);
        updateStatus('whisperStatus', `正在錄音... (${duration}秒)`, 'active');
    }, 100);
});

// Whisper 停止錄音
document.getElementById('whisperStopBtn').addEventListener('click', () => {
    whisperRecording = false;
    const recordingDuration = ((Date.now() - recordingStartTime) / 1000).toFixed(1);
    
    // 清除計時器
    if (recordingInterval) {
        clearInterval(recordingInterval);
        recordingInterval = null;
    }
    
    // 斷開音訊連接
    if (processor) {
        processor.disconnect();
    }
    if (microphone) {
        microphone.disconnect();
    }

    // 更新按鈕狀態
    document.getElementById('whisperStopBtn').disabled = true;
    document.getElementById('whisperStopBtn').classList.add('hidden');
    document.getElementById('whisperRecordBtn').classList.remove('hidden');
    document.getElementById('whisperRecordBtn').disabled = false;
    document.getElementById('whisperTranscribeBtn').disabled = false;
    
    updateStatus('whisperStatus', `錄音完成 (${recordingDuration}秒)，可以轉譯`);
    log('whisperLog', `錄音完成，時長 ${recordingDuration} 秒，共 ${recordedAudio.length} 個樣本`, 'success');
});

// Whisper 轉譯
document.getElementById('whisperTranscribeBtn').addEventListener('click', async () => {
    if (recordedAudio.length === 0) {
        log('whisperLog', '沒有錄音數據', 'error');
        return;
    }

    document.getElementById('whisperTranscribeBtn').disabled = true;
    updateStatus('whisperStatus', '正在轉譯...', 'active');
    log('whisperLog', '開始轉譯...', 'info');

    try {
        const audioData = new Float32Array(recordedAudio);
        const result = await WebASRCore.transcribe(
            whisperResources,
            audioData,
            {
                language: 'zh',
                task: 'transcribe',
                returnSegments: true
            }
        );

        log('whisperLog', `轉譯結果: "${result.text}"`, 'success');

        if (result.segments) {
            result.segments.forEach(segment => {
                log('whisperLog', `[${segment.start?.toFixed(1) || '0.0'}-${segment.end?.toFixed(1) || '0.0'}]: ${segment.text}`, 'info');
            });
        }

        updateStatus('whisperStatus', '轉譯完成');
    } catch (error) {
        log('whisperLog', `轉譯失敗: ${error.message}`, 'error');
        updateStatus('whisperStatus', '轉譯失敗', 'error');
    } finally {
        document.getElementById('whisperTranscribeBtn').disabled = false;
    }
});

// 初始化日誌
log('vadLog', 'VAD 服務就緒', 'info');
log('wakewordLog', '喚醒詞服務就緒', 'info');
log('whisperLog', 'Whisper 服務就緒', 'info');