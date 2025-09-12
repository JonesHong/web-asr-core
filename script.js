
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
        // 硬編碼模型路徑配置 - 使用從根目錄開始的路徑
        const MODEL_PATHS = {
            vad: {
                modelUrl: '/models/github/snakers4/silero-vad/silero_vad_v6.onnx'
            },
            wakeword: {
                'hey-jarvis': {
                    detectorUrl: '/models/github/dscripka/openWakeWord/hey_jarvis_v0.1.onnx',
                    melspecUrl: '/models/github/dscripka/openWakeWord/melspectrogram.onnx',
                    embeddingUrl: '/models/github/dscripka/openWakeWord/embedding_model.onnx',
                    threshold: 0.5
                },
                'hey-mycroft': {
                    detectorUrl: '/models/github/dscripka/openWakeWord/hey_mycroft_v0.1.onnx',
                    melspecUrl: '/models/github/dscripka/openWakeWord/melspectrogram.onnx',
                    embeddingUrl: '/models/github/dscripka/openWakeWord/embedding_model.onnx',
                    threshold: 0.5
                },
                'alexa': {
                    detectorUrl: '/models/github/dscripka/openWakeWord/alexa_v0.1.onnx',
                    melspecUrl: '/models/github/dscripka/openWakeWord/melspectrogram.onnx',
                    embeddingUrl: '/models/github/dscripka/openWakeWord/embedding_model.onnx',
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
            env.localModelPath = '/models/huggingface/';
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
                localBasePath: '/models/huggingface/'  // 本地模型基礎路徑
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
                detectorUrl: '/models/github/dscripka/openWakeWord/hey_jarvis_v0.1.onnx',
                melspecUrl: '/models/github/dscripka/openWakeWord/melspectrogram.onnx',
                embeddingUrl: '/models/github/dscripka/openWakeWord/embedding_model.onnx'
            },
            'hey-mycroft': {
                detectorUrl: '/models/github/dscripka/openWakeWord/hey_mycroft_v0.1.onnx',
                melspecUrl: '/models/github/dscripka/openWakeWord/melspectrogram.onnx',
                embeddingUrl: '/models/github/dscripka/openWakeWord/embedding_model.onnx'
            },
            'alexa': {
                detectorUrl: '/models/github/dscripka/openWakeWord/alexa_v0.1.onnx',
                melspecUrl: '/models/github/dscripka/openWakeWord/melspectrogram.onnx',
                embeddingUrl: '/models/github/dscripka/openWakeWord/embedding_model.onnx'
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

// 分頁切換功能
function initTabSystem() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.getAttribute('data-tab');
            
            // 更新按鈕狀態
            tabButtons.forEach(btn => {
                btn.classList.remove('active', 'text-indigo-600', 'border-b-2', 'border-indigo-600', 'bg-indigo-50');
                btn.classList.add('text-gray-600');
            });
            
            button.classList.add('active', 'text-indigo-600', 'border-b-2', 'border-indigo-600', 'bg-indigo-50');
            button.classList.remove('text-gray-600');
            
            // 切換內容顯示
            tabContents.forEach(content => {
                if (content.id === `tab-${targetTab}`) {
                    content.classList.remove('hidden');
                    content.classList.add('flex');
                } else {
                    content.classList.add('hidden');
                    content.classList.remove('flex');
                }
            });
            
            // 記錄切換
            console.log(`切換到 ${targetTab} 分頁`);
        });
    });
}

// 初始化分頁系統
initTabSystem();

// 初始化日誌
log('vadLog', 'VAD 服務就緒', 'info');

// ========================================
// Buffer/Chunker 測試相關
// ========================================

// Buffer/Chunker 測試變數
let bufferTesting = false;
let audioRingBuffer = null;
let audioChunker = null;
let bufferStats = {
    totalSamplesWritten: 0,
    totalChunksProcessed: 0,
    totalSamplesProcessed: 0
};

// 初始化 Buffer/Chunker
function initBufferChunker() {
    // 創建 RingBuffer (容量 32000 = 2秒 @ 16kHz)
    audioRingBuffer = new WebASRCore.AudioRingBuffer(32000, false);
    
    // 創建 Chunker (預設 512 樣本)
    const chunkSize = parseInt(document.getElementById('chunkSizeSelect').value);
    audioChunker = new WebASRCore.AudioChunker(chunkSize, 0); // 無重疊
    
    // 重置統計
    bufferStats = {
        totalSamplesWritten: 0,
        totalChunksProcessed: 0,
        totalSamplesProcessed: 0
    };
    
    updateBufferUI();
    log('bufferLog', `工具初始化完成 - RingBuffer容量: 32000 樣本, Chunker大小: ${chunkSize} 樣本`, 'success');
}

// 更新 Buffer/Chunker UI
function updateBufferUI() {
    // 更新 RingBuffer 狀態
    if (audioRingBuffer) {
        const stats = audioRingBuffer.getStats();
        const bufferStatsEl = document.getElementById('bufferStats');
        bufferStatsEl.innerHTML = `
            <div>容量: <span class="font-bold">${stats.size} / ${stats.capacity}</span></div>
            <div>可用: <span class="font-bold">${stats.available}</span> 樣本</div>
            <div>寫入位置: <span class="font-bold">${stats.writePos}</span></div>
            <div>讀取位置: <span class="font-bold">${stats.readPos}</span></div>
        `;
    }
    
    // 更新 Chunker 狀態
    if (audioChunker) {
        const config = audioChunker.getConfig();
        const chunkerStatsEl = document.getElementById('chunkerStats');
        chunkerStatsEl.innerHTML = `
            <div>塊大小: <span class="font-bold">${config.chunkSize}</span></div>
            <div>已處理: <span class="font-bold">${bufferStats.totalChunksProcessed}</span> 塊</div>
            <div>剩餘: <span class="font-bold">${config.remainderSize}</span> 樣本</div>
            <div>總處理: <span class="font-bold">${bufferStats.totalSamplesProcessed}</span> 樣本</div>
        `;
    }
}

// 處理 Buffer/Chunker 音訊 - 只寫入不自動讀取
let bufferProcessing = false;
async function processBufferChunk(audioData) {
    // 如果不是測試模式且不是手動新增，則返回
    if (!bufferTesting && !audioRingBuffer) return;
    if (bufferProcessing) return;
    
    bufferProcessing = true;
    try {
        // 檢查音訊資料
        if (audioData.length === 0) {
            console.warn('收到空的音訊資料');
            return;
        }
        
        // 計算音訊強度以確認有資料
        let maxAbs = 0;
        for (let i = 0; i < audioData.length; i++) {
            maxAbs = Math.max(maxAbs, Math.abs(audioData[i]));
        }
        
        // 只有在有實際音訊時才記錄（避免靜音刷屏）
        if (maxAbs > 0.001) {
            console.log(`收到音訊資料: ${audioData.length} 樣本, 最大振幅: ${maxAbs.toFixed(4)}`);
        }
        
        // 只寫入 RingBuffer，不自動讀取處理
        const stats = audioRingBuffer.getStats();
        const wasFull = stats.size === stats.capacity;
        
        const written = audioRingBuffer.write(audioData);
        bufferStats.totalSamplesWritten += written;
        
        // 如果緩衝區滿了，提醒用戶
        if (wasFull && written > 0) {
            log('bufferLog', 
                `⚠️ 緩衝區已滿，覆蓋了 ${written} 個最舊的樣本`, 
                'warning'
            );
        }
        
        // 如果有顯著音訊，記錄到日誌
        if (maxAbs > 0.01 && !wasFull) {
            log('bufferLog', 
                `寫入 ${written} 樣本 (振幅: ${maxAbs.toFixed(3)})`, 
                'info'
            );
        }
        
        // 更新 UI
        updateBufferUI();
        
        // 定期記錄緩衝區狀態
        if (bufferStats.totalSamplesWritten % 16000 === 0 && bufferStats.totalSamplesWritten > 0) {
            const stats = audioRingBuffer.getStats();
            log('bufferLog', 
                `緩衝區: ${stats.available}/${stats.capacity} 樣本 (${((stats.available / stats.capacity) * 100).toFixed(1)}%)`, 
                'info'
            );
        }
        
    } catch (error) {
        log('bufferLog', `處理錯誤: ${error.message}`, 'error');
    } finally {
        bufferProcessing = false;
    }
}

// 初始化音訊工具專用的音訊系統
async function initAudioForTools() {
    try {
        // 如果已經初始化，直接返回
        if (audioContext && microphone && processor) {
            return true;
        }
        
        // 初始化音訊
        const success = await initAudio();
        if (success) {
            log('bufferLog', '音訊系統初始化成功', 'success');
            return true;
        }
        return false;
    } catch (error) {
        log('bufferLog', `音訊初始化失敗: ${error.message}`, 'error');
        return false;
    }
}

// Buffer/Chunker 測試控制
document.getElementById('bufferStartBtn').addEventListener('click', async () => {
    // 自動初始化音訊（不需要載入模型）
    if (!audioContext || !microphone || !processor) {
        log('bufferLog', '正在初始化音訊系統...', 'info');
        const success = await initAudioForTools();
        if (!success) {
            log('bufferLog', '音訊初始化失敗，請檢查麥克風權限', 'error');
            return;
        }
    }
    
    // 初始化 Buffer/Chunker
    initBufferChunker();
    
    bufferTesting = true;
    
    // 連接音訊
    try {
        microphone.connect(processor);
        processor.connect(audioContext.destination);
    } catch (e) {
        // 已經連接，忽略錯誤
        console.log('音訊已連接');
    }
    
    // 為音訊工具設定專用的緩衝區
    let audioToolBuffer = [];
    
    // 設定音訊處理 (重用現有的處理器)
    if (processor && processor.port) {
        // AudioWorklet 模式 - 為音訊工具新增專門的處理
        processor.port.onmessage = (event) => {
            // 處理所有音訊資料類型
            if (bufferTesting) {
                if (event.data.type === 'vad') {
                    processBufferChunk(event.data.data);
                    if (vadTesting) processVadChunk(event.data.data);
                } else if (event.data.type === 'wakeword') {
                    processBufferChunk(event.data.data);
                    if (wakewordTesting) processWakewordChunk(event.data.data);
                }
            } else {
                // 原始的處理邏輯
                if (event.data.type === 'vad' && vadTesting) {
                    processVadChunk(event.data.data);
                } else if (event.data.type === 'wakeword' && wakewordTesting) {
                    processWakewordChunk(event.data.data);
                }
            }
        };
    } else if (processor) {
        // ScriptProcessor 模式 - 確保能接收音訊
        processor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);
            const resampled = resampleTo16kHz(inputData, audioContext.sampleRate);
            
            // 累積音訊到緩衝區
            if (bufferTesting && resampled.length > 0) {
                audioToolBuffer.push(...resampled);
                
                // 批次處理（每 2048 個樣本處理一次）
                const batchSize = 2048;
                while (audioToolBuffer.length >= batchSize) {
                    const batch = new Float32Array(audioToolBuffer.slice(0, batchSize));
                    audioToolBuffer = audioToolBuffer.slice(batchSize);
                    processBufferChunk(batch);
                }
            }
            
            // 保持原有的 VAD 和 WakeWord 功能
            if (!bufferTesting && processor._originalOnaudioprocess) {
                processor._originalOnaudioprocess(e);
            }
        };
    }
    
    document.getElementById('bufferStartBtn').disabled = true;
    document.getElementById('bufferStopBtn').disabled = false;
    
    log('bufferLog', '開始音訊工具測試 - 正在處理音訊流...', 'success');
});

document.getElementById('bufferStopBtn').addEventListener('click', () => {
    bufferTesting = false;
    
    // 只在沒有其他服務使用時才斷開連接
    if (!vadTesting && !wakewordTesting && !whisperRecording) {
        try {
            processor.disconnect();
            microphone.disconnect();
        } catch (e) {
            // 忽略斷開連接錯誤
        }
    }
    
    document.getElementById('bufferStartBtn').disabled = false;
    document.getElementById('bufferStopBtn').disabled = true;
    
    // 顯示最終統計
    if (audioRingBuffer) {
        const stats = audioRingBuffer.getStats();
        log('bufferLog', 
            `測試停止 - 總寫入: ${bufferStats.totalSamplesWritten} 樣本, ` +
            `總處理: ${bufferStats.totalChunksProcessed} 塊`, 
            'warning'
        );
    }
});

// 清空緩衝區按鈕
document.getElementById('bufferClearBtn').addEventListener('click', () => {
    if (audioRingBuffer) {
        audioRingBuffer.clear();
    }
    if (audioChunker) {
        audioChunker.reset();
    }
    
    bufferStats = {
        totalSamplesWritten: 0,
        totalChunksProcessed: 0,
        totalSamplesProcessed: 0
    };
    
    updateBufferUI();
    log('bufferLog', '緩衝區已清空', 'info');
});

// Chunk Size 選擇改變
document.getElementById('chunkSizeSelect').addEventListener('change', (e) => {
    const newSize = parseInt(e.target.value);
    
    if (audioChunker) {
        audioChunker.setChunkSize(newSize, true); // 保留剩餘資料
        log('bufferLog', `Chunk 大小改為: ${newSize}`, 'info');
        updateBufferUI();
    }
});

// 手動新增樣本按鈕
document.getElementById('addSamplesBtn').addEventListener('click', () => {
    // 確保已初始化
    if (!audioRingBuffer || !audioChunker) {
        initBufferChunker();
    }
    
    const samplesCount = parseInt(document.getElementById('manualSamplesInput').value) || 1000;
    
    // 生成測試音訊資料（正弦波）
    const frequency = 440; // A4 音符
    const amplitude = 0.3;
    const sampleRate = 16000;
    const testData = new Float32Array(samplesCount);
    
    for (let i = 0; i < samplesCount; i++) {
        // 生成正弦波
        testData[i] = amplitude * Math.sin(2 * Math.PI * frequency * i / sampleRate);
        // 加入一些雜訊讓它更真實
        testData[i] += (Math.random() - 0.5) * 0.01;
    }
    
    // 處理資料
    processBufferChunk(testData);
    
    log('bufferLog', `手動新增 ${samplesCount} 個測試樣本 (440Hz 正弦波)`, 'info');
});

// 三倍寫入按鈕
document.getElementById('tripleWriteBtn').addEventListener('click', () => {
    // 確保已初始化
    if (!audioRingBuffer || !audioChunker) {
        initBufferChunker();
    }
    
    const samplesCount = parseInt(document.getElementById('manualSamplesInput').value) || 1000;
    
    // 生成測試音訊資料
    const frequency = 880; // A5 音符（較高音）
    const amplitude = 0.3;
    const sampleRate = 16000;
    const testData = new Float32Array(samplesCount);
    
    for (let i = 0; i < samplesCount; i++) {
        testData[i] = amplitude * Math.sin(2 * Math.PI * frequency * i / sampleRate);
        testData[i] += (Math.random() - 0.5) * 0.01;
    }
    
    // 寫入三次
    for (let j = 0; j < 3; j++) {
        processBufferChunk(testData);
    }
    
    log('bufferLog', `三倍寫入：${samplesCount} x 3 = ${samplesCount * 3} 個樣本 (880Hz)`, 'warning');
});

// 查看按鈕（非破壞性）
document.getElementById('peekBtn').addEventListener('click', () => {
    if (!audioRingBuffer) {
        log('bufferLog', '請先初始化緩衝區', 'error');
        return;
    }
    
    const peekSize = parseInt(document.getElementById('peekSizeInput').value) || 100;
    const stats = audioRingBuffer.getStats();
    const peekedData = audioRingBuffer.peek(peekSize);  // 非破壞性查看！
    
    if (peekedData) {
        // 計算統計資訊
        let min = Infinity, max = -Infinity, sum = 0;
        for (let i = 0; i < peekedData.length; i++) {
            min = Math.min(min, peekedData[i]);
            max = Math.max(max, peekedData[i]);
            sum += Math.abs(peekedData[i]);
        }
        const avg = sum / peekedData.length;
        
        log('bufferLog', 
            `👁️ 查看 ${peekedData.length} 個樣本（非破壞性，資料仍在緩衝區）- ` +
            `最小: ${min.toFixed(4)}, 最大: ${max.toFixed(4)}, 平均振幅: ${avg.toFixed(4)}`,
            'info'
        );
        
        // 視覺化查看的資料
        drawWaveform('bufferCanvas', peekedData);
    } else {
        log('bufferLog', 
            `❌ 資料不足：緩衝區只有 ${stats.available} 個樣本，無法查看 ${peekSize} 個`, 
            'warning'
        );
    }
});

// 跳過按鈕（破壞性，丟棄資料）
document.getElementById('skipBtn').addEventListener('click', () => {
    if (!audioRingBuffer) {
        log('bufferLog', '請先初始化緩衝區', 'error');
        return;
    }
    
    const skipSize = parseInt(document.getElementById('skipSizeInput').value) || 512;
    const beforeStats = audioRingBuffer.getStats();
    const actualSkipped = audioRingBuffer.skip(skipSize);
    const afterStats = audioRingBuffer.getStats();
    
    if (actualSkipped > 0) {
        log('bufferLog', 
            `⏭️ 跳過（丟棄）${actualSkipped} 個樣本 ` +
            `(剩餘: ${afterStats.available}/${afterStats.capacity})`, 
            'warning'
        );
    } else {
        log('bufferLog', 
            `❌ 無法跳過：緩衝區只有 ${beforeStats.available} 個樣本`, 
            'warning'
        );
    }
    updateBufferUI();
});

// 手動 Chunk 按鈕
document.getElementById('manualChunkBtn').addEventListener('click', () => {
    if (!audioRingBuffer) {
        log('bufferLog', '請先初始化緩衝區', 'error');
        return;
    }
    
    const chunkSize = parseInt(document.getElementById('manualChunkSizeInput').value) || 512;
    const beforeStats = audioRingBuffer.getStats();
    const chunkData = audioRingBuffer.read(chunkSize);  // 破壞性讀取！
    
    if (chunkData) {
        const afterStats = audioRingBuffer.getStats();
        
        // 使用 Chunker 處理（如果有剩餘資料的話）
        if (audioChunker) {
            const chunks = audioChunker.chunk(chunkData);
            if (chunks.length > 0) {
                log('bufferLog', 
                    `📤 手動 Chunk：從緩衝區移除 ${chunkSize} 個樣本，產生 ${chunks.length} 個塊 ` +
                    `(剩餘: ${afterStats.available}/${afterStats.capacity})`,
                    'success'
                );
                
                // 更新統計
                bufferStats.totalChunksProcessed += chunks.length;
                bufferStats.totalSamplesProcessed += chunkSize;
                
                // 視覺化最後一個 chunk
                drawWaveform('bufferCanvas', chunks[chunks.length - 1]);
            } else {
                log('bufferLog', 
                    `📤 手動 Chunk：從緩衝區移除 ${chunkSize} 個樣本（累積在 Chunker 剩餘）` +
                    `(剩餘: ${afterStats.available}/${afterStats.capacity})`, 
                    'info'
                );
            }
        } else {
            log('bufferLog', 
                `📤 手動讀取：從緩衝區移除 ${chunkSize} 個樣本 ` +
                `(剩餘: ${afterStats.available}/${afterStats.capacity})`, 
                'success'
            );
            drawWaveform('bufferCanvas', chunkData);
        }
        
        updateBufferUI();
    } else {
        const available = beforeStats.available;
        log('bufferLog', 
            `❌ 資料不足：緩衝區只有 ${available} 個樣本，無法讀取 ${chunkSize} 個`, 
            'warning'
        );
    }
});

// 調整緩衝區大小按鈕
document.getElementById('resizeBufferBtn').addEventListener('click', () => {
    const newSize = parseInt(document.getElementById('bufferSizeInput').value) || 32000;
    
    // 重新建立 RingBuffer
    audioRingBuffer = new WebASRCore.AudioRingBuffer(newSize, false);
    
    // 重置統計
    bufferStats.totalSamplesWritten = 0;
    
    log('bufferLog', `緩衝區容量調整為: ${newSize} 樣本`, 'success');
    updateBufferUI();
});

// 系統診斷按鈕事件
document.getElementById('diagnosticBtn').addEventListener('click', async () => {
    const btn = document.getElementById('diagnosticBtn');
    const resultDiv = document.getElementById('diagnosticResult');
    
    btn.disabled = true;
    resultDiv.innerHTML = '<div class="text-gray-200 text-base font-medium">正在執行診斷...</div>';
    
    try {
        // 動態導入系統診斷工具
        const { SystemDiagnostics } = await import('./dist/utils/system-diagnostics.js');
        const diagnostics = SystemDiagnostics.getInstance();
        const report = await diagnostics.diagnose();
        
        // 格式化診斷結果為 HTML - 使用適應性佈局
        let html = '<div class="grid grid-cols-1 lg:grid-cols-2 gap-2">';
        
        // 左側欄
        html += '<div class="space-y-2">';
        
        // 音訊功能
        html += '<div class="bg-gray-800/50 rounded-lg p-2">';
        html += '<h3 class="text-white font-bold text-base mb-1">🎵 音訊功能</h3>';
        html += `<div class="text-gray-200 text-sm ml-1">安全上下文: ${report.supported.secureContext ? '✅ 是' : '❌ 否'}</div>`;
        html += `<div class="text-gray-200 text-sm ml-1">getUserMedia: ${report.supported.getUserMedia ? '✅ 支援' : '❌ 不支援'}</div>`;
        html += `<div class="text-gray-200 text-sm ml-1">AudioWorklet: ${report.supported.audioWorklet ? '✅ 支援' : '❌ 不支援'}</div>`;
        html += `<div class="text-gray-200 text-sm ml-1">MediaRecorder: ${report.supported.mediaRecorder ? '✅ 支援' : '❌ 不支援'}</div>`;
        html += `<div class="text-gray-200 text-sm ml-1">Web Speech API: ${report.supported.webSpeechRecognition ? '✅ 支援' : '❌ 不支援'}</div>`;
        if (report.supported.webSpeechOffline) {
            html += `<div class="text-gray-200 text-sm ml-4">離線模式: ✅ 支援</div>`;
        }
        html += '</div>';
        
        // 運算功能
        html += '<div class="bg-gray-800/50 rounded-lg p-2">';
        html += '<h3 class="text-white font-bold text-base mb-1">⚙️ 運算功能</h3>';
        html += `<div class="text-gray-200 text-sm ml-1">WebGPU: ${report.supported.webgpu ? '✅ 支援' : '❌ 不支援'}</div>`;
        html += `<div class="text-gray-200 text-sm ml-1">WebGL 2.0: ${report.supported.webgl ? '✅ 支援' : '❌ 不支援'}</div>`;
        html += `<div class="text-gray-200 text-sm ml-1">WebNN: ${report.supported.webnn ? '✅ 支援' : '❌ 不支援'}</div>`;
        html += `<div class="text-gray-200 text-sm ml-1">WASM SIMD: ${report.supported.wasmSIMD ? '✅ 支援' : '❌ 不支援'}</div>`;
        html += `<div class="text-gray-200 text-sm ml-1">WASM Threads: ${report.supported.wasmThreads ? '✅ 支援' : '❌ 不支援'}</div>`;
        html += `<div class="text-gray-200 text-sm ml-1">SharedArrayBuffer: ${report.supported.sharedArrayBuffer ? '✅ 支援' : '❌ 不支援'}</div>`;
        html += '</div>';
        
        // 模型狀態
        html += '<div class="bg-gray-800/50 rounded-lg p-3">';
        html += '<h3 class="text-white font-bold text-lg mb-2">📦 模型狀態</h3>';
        html += `<div class="text-gray-200 text-sm ml-1">VAD: ${vadSession ? '<span class="text-green-400 font-semibold">✅ 已載入</span>' : '<span class="text-yellow-400">⏳ 未載入</span>'}</div>`;
        html += `<div class="text-gray-200 text-sm ml-1">喚醒詞: ${wakewordResources ? '<span class="text-green-400 font-semibold">✅ 已載入</span>' : '<span class="text-yellow-400">⏳ 未載入</span>'}</div>`;
        html += `<div class="text-gray-200 text-sm ml-1">Whisper: ${whisperResources ? '<span class="text-green-400 font-semibold">✅ 已載入</span>' : '<span class="text-yellow-400">⏳ 未載入</span>'}</div>`;
        html += '</div>';
        
        html += '</div>'; // 結束左側欄
        
        // 右側欄
        html += '<div class="space-y-2">';
        
        // 效能指標
        html += '<div class="bg-gray-800/50 rounded-lg p-2">';
        html += '<h3 class="text-white font-bold text-base mb-1">📊 效能指標</h3>';
        html += `<div class="text-gray-200 text-sm ml-1">GPU 名稱: <span class="text-cyan-400">${report.performance.gpuName || 'N/A'}</span></div>`;
        html += `<div class="text-gray-200 text-sm ml-1">CPU 核心數: <span class="text-cyan-400">${report.performance.cpuCores}</span></div>`;
        html += `<div class="text-gray-200 text-sm ml-1">記憶體: <span class="text-cyan-400">${report.performance.memory ? `${(report.performance.memory / 1024 / 1024 / 1024).toFixed(1)} GB` : 'N/A'}</span></div>`;
        html += `<div class="text-gray-200 text-sm ml-1">裝置類型: <span class="text-cyan-400">${report.performance.deviceType}</span></div>`;
        html += '</div>';
        
        // 建議配置
        html += '<div class="bg-gray-800/50 rounded-lg p-2">';
        html += '<h3 class="text-white font-bold text-base mb-1">💡 建議配置</h3>';
        html += `<div class="text-gray-200 text-sm ml-1">執行提供者: <span class="text-green-400 font-semibold">${report.recommendation.executionProvider.join(' > ')}</span></div>`;
        html += `<div class="text-gray-200 text-sm ml-1">Whisper 後端: <span class="text-green-400 font-semibold">${report.recommendation.whisperBackend}</span></div>`;
        html += `<div class="text-gray-200 text-sm ml-1">資料傳輸: <span class="text-green-400 font-semibold">${report.recommendation.transport === 'sab' ? 'SharedArrayBuffer' : 'MessagePort'}</span></div>`;
        html += `<div class="text-gray-200 text-sm ml-1">模型大小: <span class="text-green-400 font-semibold">${report.recommendation.modelSize}</span></div>`;
        html += `<div class="text-gray-200 text-sm ml-1">音訊塊: <span class="text-green-400 font-semibold">${report.recommendation.audioConfig.chunkMs}ms</span></div>`;
        html += '</div>';
        
        // 警告和提示
        if (report.recommendation.warnings && report.recommendation.warnings.length > 0) {
            html += '<div class="bg-yellow-900/30 border border-yellow-600/50 rounded-lg p-2">';
            html += '<h3 class="text-yellow-400 font-bold text-base mb-1">⚠️ 警告</h3>';
            report.recommendation.warnings.forEach(warning => {
                html += `<div class="text-yellow-300 ml-2 text-sm">• ${warning}</div>`;
            });
            html += '</div>';
        }
        
        if (report.recommendation.notes && report.recommendation.notes.length > 0) {
            html += '<div class="bg-blue-900/30 border border-blue-600/50 rounded-lg p-2">';
            html += '<h3 class="text-blue-400 font-bold text-base mb-1">ℹ️ 提示</h3>';
            report.recommendation.notes.forEach(note => {
                html += `<div class="text-blue-300 ml-2 text-sm">• ${note}</div>`;
            });
            html += '</div>';
        }
        
        html += '</div>'; // 結束右側欄
        
        html += '</div>'; // 結束網格佈局
        
        resultDiv.innerHTML = html;
    } catch (error) {
        resultDiv.innerHTML = `<div class="text-red-400 text-base font-medium">診斷失敗: ${error.message}</div>`;
    } finally {
        btn.disabled = false;
    }
});

// ========================================
// 倒數計時器測試相關
// ========================================

// 計時器管理器實例
let timerManager = null;
let currentTimerId = 'timer1';
let updateInterval = null;

// 初始化計時器管理器
function initTimerManager() {
    if (!timerManager) {
        timerManager = new WebASRCore.TimerManager();
        log('timerLog', '計時器管理器初始化完成', 'success');
    }
}

// 格式化時間顯示
function formatTime(milliseconds) {
    const totalSeconds = Math.ceil(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// 格式化時間（帶毫秒）
function formatTimeWithMs(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const ms = Math.floor((milliseconds % 1000) / 10); // 顯示兩位毫秒
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}

// 更新計時器顯示
function updateTimerDisplay() {
    if (!timerManager) return;
    
    const state = timerManager.getTimerState(currentTimerId);
    if (!state) return;
    
    // 更新時間顯示
    const remaining = timerManager.getRemainingTime(currentTimerId);
    document.getElementById('timerDisplay').textContent = formatTime(remaining);
    
    // 更新進度條
    const progress = timerManager.getProgress(currentTimerId);
    document.getElementById('timerProgressBar').style.width = `${progress}%`;
    
    // 更新狀態文字
    let stateText = '停止';
    if (state.isRunning) {
        stateText = '運行中';
    } else if (state.pausedAt !== undefined) {
        stateText = '暫停';
    } else if (remaining === 0) {
        stateText = '已結束';
    }
    document.getElementById('timerStateText').textContent = stateText;
    
    // 更新總時間
    document.getElementById('timerTotalText').textContent = `${Math.ceil(state.totalTime / 1000)}秒`;
    
    // 如果時間到了，變成紅色閃爍
    if (remaining === 0 && state.isRunning === false) {
        document.getElementById('timerDisplay').classList.add('text-red-500', 'animate-pulse');
    } else {
        document.getElementById('timerDisplay').classList.remove('text-red-500', 'animate-pulse');
    }
}

// 更新所有計時器列表
function updateAllTimersList() {
    if (!timerManager) return;
    
    const allTimers = timerManager.getAllTimers();
    const listEl = document.getElementById('allTimersList');
    
    if (allTimers.size === 0) {
        listEl.innerHTML = '<div class="text-gray-500 text-sm">尚無計時器</div>';
        return;
    }
    
    let html = '';
    for (const [id, state] of allTimers) {
        const remaining = WebASRCore.Timer.getRemainingTime(state);
        const progress = WebASRCore.Timer.getProgress(state);
        const isActive = id === currentTimerId;
        
        html += `
            <div class="bg-gray-700 rounded p-2 ${isActive ? 'ring-2 ring-cyan-500' : ''}">
                <div class="flex justify-between items-center mb-1">
                    <span class="text-white font-medium text-sm">${id}</span>
                    <span class="text-gray-400 text-xs">${formatTime(remaining)}</span>
                </div>
                <div class="w-full bg-gray-600 rounded-full h-2">
                    <div class="bg-cyan-500 h-2 rounded-full transition-all" style="width: ${progress}%"></div>
                </div>
                <div class="flex justify-between mt-1">
                    <span class="text-gray-400 text-xs">
                        ${state.isRunning ? '運行中' : state.pausedAt !== undefined ? '暫停' : '停止'}
                    </span>
                    ${!isActive ? `
                        <button onclick="switchToTimer('${id}')" 
                                class="text-cyan-400 hover:text-cyan-300 text-xs">
                            切換
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }
    
    listEl.innerHTML = html;
}

// 切換到指定計時器
window.switchToTimer = function(timerId) {
    currentTimerId = timerId;
    document.getElementById('timerIdInput').value = timerId;
    updateTimerDisplay();
    updateAllTimersList();
    log('timerLog', `切換到計時器: ${timerId}`, 'info');
};

// log 函數已在前面定義，這裡不需要重複定義

// 預設時間按鈕
document.querySelectorAll('.timer-preset').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const seconds = parseInt(e.target.dataset.seconds);
        const milliseconds = seconds * 1000;
        
        initTimerManager();
        
        // 創建新計時器
        timerManager.createTimer(currentTimerId, {
            duration: milliseconds,
            onTimeout: () => {
                log('timerLog', `⏰ 計時器 ${currentTimerId} 時間到！`, 'warning');
                updateTimerDisplay();
                updateAllTimersList();
                
                // 播放提示音（可選）
                const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQ==');
                audio.play().catch(() => {});
            },
            onTick: (remaining) => {
                // Tick 回調已在 TimerManager 內部處理
            },
            tickInterval: 100
        });
        
        updateTimerDisplay();
        updateAllTimersList();
        log('timerLog', `設定計時器 ${currentTimerId}: ${seconds}秒`, 'info');
    });
});

// 自訂時間設定
document.getElementById('setCustomTimeBtn').addEventListener('click', () => {
    const seconds = parseInt(document.getElementById('customTimeInput').value);
    if (isNaN(seconds) || seconds <= 0) {
        log('timerLog', '請輸入有效的秒數', 'error');
        return;
    }
    
    const milliseconds = seconds * 1000;
    initTimerManager();
    
    timerManager.createTimer(currentTimerId, {
        duration: milliseconds,
        onTimeout: () => {
            log('timerLog', `⏰ 計時器 ${currentTimerId} 時間到！`, 'warning');
            updateTimerDisplay();
            updateAllTimersList();
        },
        tickInterval: 100
    });
    
    updateTimerDisplay();
    updateAllTimersList();
    log('timerLog', `設定計時器 ${currentTimerId}: ${seconds}秒`, 'info');
});

// 開始按鈕
document.getElementById('timerStartBtn').addEventListener('click', () => {
    initTimerManager();
    
    // 如果當前計時器不存在，先創建一個預設 30 秒的
    if (!timerManager.getTimerState(currentTimerId)) {
        timerManager.createTimer(currentTimerId, {
            duration: 30000,
            onTimeout: () => {
                log('timerLog', `⏰ 計時器 ${currentTimerId} 時間到！`, 'warning');
                updateTimerDisplay();
                updateAllTimersList();
            },
            tickInterval: 100
        });
    }
    
    timerManager.startTimer(currentTimerId);
    
    // 開始更新顯示
    if (updateInterval) clearInterval(updateInterval);
    updateInterval = setInterval(() => {
        updateTimerDisplay();
        updateAllTimersList();
    }, 100);
    
    // 更新按鈕狀態
    document.getElementById('timerStartBtn').disabled = true;
    document.getElementById('timerPauseBtn').disabled = false;
    document.getElementById('timerResumeBtn').classList.add('hidden');
    
    log('timerLog', `▶️ 開始計時器 ${currentTimerId}`, 'success');
});

// 暫停按鈕
document.getElementById('timerPauseBtn').addEventListener('click', () => {
    if (!timerManager) return;
    
    timerManager.pauseTimer(currentTimerId);
    
    // 停止更新
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
    
    // 更新按鈕狀態
    document.getElementById('timerPauseBtn').classList.add('hidden');
    document.getElementById('timerPauseBtn').disabled = true;
    document.getElementById('timerResumeBtn').classList.remove('hidden');
    document.getElementById('timerResumeBtn').disabled = false;
    
    updateTimerDisplay();
    updateAllTimersList();
    log('timerLog', `⏸️ 暫停計時器 ${currentTimerId}`, 'warning');
});

// 繼續按鈕
document.getElementById('timerResumeBtn').addEventListener('click', () => {
    if (!timerManager) return;
    
    timerManager.startTimer(currentTimerId);
    
    // 重新開始更新
    if (updateInterval) clearInterval(updateInterval);
    updateInterval = setInterval(() => {
        updateTimerDisplay();
        updateAllTimersList();
    }, 100);
    
    // 更新按鈕狀態
    document.getElementById('timerResumeBtn').classList.add('hidden');
    document.getElementById('timerResumeBtn').disabled = true;
    document.getElementById('timerPauseBtn').classList.remove('hidden');
    document.getElementById('timerPauseBtn').disabled = false;
    
    log('timerLog', `▶️ 繼續計時器 ${currentTimerId}`, 'success');
});

// 重置按鈕
document.getElementById('timerResetBtn').addEventListener('click', () => {
    if (!timerManager) return;
    
    timerManager.resetTimer(currentTimerId);
    
    // 停止更新
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
    
    // 重置按鈕狀態
    document.getElementById('timerStartBtn').disabled = false;
    document.getElementById('timerPauseBtn').disabled = true;
    document.getElementById('timerPauseBtn').classList.remove('hidden');
    document.getElementById('timerResumeBtn').classList.add('hidden');
    
    updateTimerDisplay();
    updateAllTimersList();
    log('timerLog', `🔄 重置計時器 ${currentTimerId}`, 'info');
});

// 延長時間按鈕
document.getElementById('timerExtendBtn').addEventListener('click', () => {
    if (!timerManager) return;
    
    const state = timerManager.getTimerState(currentTimerId);
    if (!state) {
        log('timerLog', '請先創建計時器', 'error');
        return;
    }
    
    timerManager.extendTimer(currentTimerId, 10000); // 延長 10 秒
    
    updateTimerDisplay();
    updateAllTimersList();
    log('timerLog', `➕ 計時器 ${currentTimerId} 延長 10 秒`, 'info');
});

// 創建新計時器
document.getElementById('createTimerBtn').addEventListener('click', () => {
    const timerId = document.getElementById('timerIdInput').value.trim();
    if (!timerId) {
        log('timerLog', '請輸入計時器 ID', 'error');
        return;
    }
    
    initTimerManager();
    
    // 檢查是否已存在
    if (timerManager.getTimerState(timerId)) {
        log('timerLog', `計時器 ${timerId} 已存在`, 'warning');
        currentTimerId = timerId;
        updateTimerDisplay();
        updateAllTimersList();
        return;
    }
    
    // 創建新計時器（預設 30 秒）
    timerManager.createTimer(timerId, {
        duration: 30000,
        onTimeout: () => {
            log('timerLog', `⏰ 計時器 ${timerId} 時間到！`, 'warning');
            if (timerId === currentTimerId) {
                updateTimerDisplay();
            }
            updateAllTimersList();
        },
        tickInterval: 100
    });
    
    currentTimerId = timerId;
    updateTimerDisplay();
    updateAllTimersList();
    log('timerLog', `✨ 創建計時器: ${timerId}`, 'success');
});

// 切換計時器
document.getElementById('switchTimerBtn').addEventListener('click', () => {
    const timerId = document.getElementById('timerIdInput').value.trim();
    if (!timerId) {
        log('timerLog', '請輸入計時器 ID', 'error');
        return;
    }
    
    if (!timerManager || !timerManager.getTimerState(timerId)) {
        log('timerLog', `計時器 ${timerId} 不存在`, 'error');
        return;
    }
    
    // 停止當前計時器的更新（如果有的話）
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
    
    currentTimerId = timerId;
    
    // 如果新計時器正在運行，開始更新
    const state = timerManager.getTimerState(timerId);
    if (state && state.isRunning) {
        updateInterval = setInterval(() => {
            updateTimerDisplay();
            updateAllTimersList();
        }, 100);
    }
    
    updateTimerDisplay();
    updateAllTimersList();
    log('timerLog', `🔄 切換到計時器: ${timerId}`, 'info');
});

// 初始化計時器顯示
log('timerLog', '倒數計時器測試就緒', 'info');