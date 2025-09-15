
// 等待 ONNX Runtime 載入完成
async function waitForOrt() {
    // 檢查 ort 是否已經存在
    if (typeof ort !== 'undefined') {
        return;
    }
    
    // 等待最多 5 秒
    const maxWaitTime = 5000;
    const checkInterval = 100;
    const startTime = Date.now();
    
    while (typeof ort === 'undefined') {
        if (Date.now() - startTime > maxWaitTime) {
            throw new Error('ONNX Runtime 載入超時');
        }
        await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
}

// 等待 ONNX Runtime 載入完成後再導入 WebASRCore
await waitForOrt();
console.log('[Script] ONNX Runtime 已準備就緒，載入 WebASRCore...');

// 導入 WebASRCore - 使用動態 import 因為我們在 script module 中
const WebASRCore = await import('./dist/web-asr-core.bundle.js');

// Whisper 模型狀態管理
const whisperState = {
    source: 'local',  // 'local' 或 'remote'
    localBasePath: '/models/huggingface/',
    localModelId: 'Xenova/whisper-base',  // 修正為包含 Xenova 路徑
    remoteModelId: 'Xenova/whisper-tiny',
    isLoading: false,
    currentPipeline: null
};


// 本地可用的 Whisper 模型列表
const AVAILABLE_LOCAL_MODELS = [
    { id: 'Xenova/whisper-tiny', label: 'Whisper Tiny 多語言 (39MB)', size: '39MB' },
    { id: 'Xenova/whisper-tiny.en', label: 'Whisper Tiny 英文 (39MB)', size: '39MB' },
    { id: 'Xenova/whisper-base', label: 'Whisper Base 多語言 (74MB)', size: '74MB' },
    { id: 'Xenova/whisper-base.en', label: 'Whisper Base 英文 (74MB)', size: '74MB' },
    { id: 'Xenova/whisper-small', label: 'Whisper Small 多語言 (244MB)', size: '244MB' },
    { id: 'Xenova/whisper-small.en', label: 'Whisper Small 英文 (244MB)', size: '244MB' },
    { id: 'Xenova/whisper-medium', label: 'Whisper Medium 多語言 (769MB)', size: '769MB' },
    { id: 'Xenova/whisper-medium.en', label: 'Whisper Medium 英文 (769MB)', size: '769MB' },
    { id: 'Xenova/whisper-large', label: 'Whisper Large 多語言 (1550MB)', size: '1550MB' },
    { id: 'Xenova/whisper-large-v2', label: 'Whisper Large v2 (1550MB)', size: '1550MB' },
    { id: 'Xenova/whisper-large-v3', label: 'Whisper Large v3 (1550MB)', size: '1550MB' }
];

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
    // 使用 Event Architecture v2 - 事件驅動處理
    if (vadTesting && vadService && !vadProcessing) {
        vadProcessing = true;  // 標記處理中
        try {
            // 確保有 VAD 狀態和參數
            if (!vadState) {
                vadState = vadService.createState();
            }
            const vadParams = vadService.createParams();
            
            // 處理音訊並更新狀態
            const result = await vadService.process(vadState, chunk, vadParams);
            vadState = result.state;  // 更新狀態以供下次使用
            
            // 視覺化波形（可選）
            drawWaveform('vadCanvas', chunk);
            
            // UI 更新已通過事件自動觸發，無需手動處理
        } catch (error) {
            log('vadLog', `VAD 處理錯誤: ${error.message}`, 'error');
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
    if (wakewordTesting && wakewordService && !wakewordProcessing) {
        wakewordProcessing = true;  // 標記處理中
        
        const wakewordName = document.getElementById('wakewordSelect').value;
        
        // 處理自訂模型
        const actualName = wakewordName === 'custom' ? customWakewordModel?.name : wakewordName;
        if (!actualName) {
            wakewordProcessing = false;
            return;
        }
        
        // 檢查是否在冷卻期內
        if (window.wakewordCooldown && window.wakewordCooldown[actualName]) {
            wakewordProcessing = false;
            return;  // 在冷卻期內，跳過處理
        }
        
        // 優先從 wakewordService.options.thresholds 讀取自訂閾值
        const serviceThreshold = wakewordService?.options?.thresholds?.[actualName];
        const cfg = WAKEWORD_CONFIG[actualName] || WAKEWORD_CONFIG[wakewordName] || { 
            threshold: serviceThreshold || 0.5,  // 使用服務中設定的閾值，或預設 0.5
            minConsecutive: 2, 
            refractoryMs: 1500,
            useVad: true 
        };
        
        // 如果服務中有自訂閾值，覆蓋 cfg 的閾值
        if (serviceThreshold !== undefined) {
            cfg.threshold = serviceThreshold;
        }
        
        let triggered = false;
        let score = 0;
        
        try {
            // 取得或創建該喚醒詞的狀態（使用實際名稱）
            if (!wakewordStates.has(actualName)) {
                const newState = wakewordService.createState(actualName);  // 傳遞名稱以使用正確的維度
                console.log(`[processWakewordChunk] 創建新狀態 for ${actualName}:`, newState);
                wakewordStates.set(actualName, newState);
            }
            let currentState = wakewordStates.get(actualName);
            
            const wakewordParams = wakewordService.createParams(actualName, {
                threshold: cfg.threshold
            });
            
            // 使用 Event Architecture v2 處理
            const result = await wakewordService.process(
                currentState,
                chunk,
                wakewordParams
            );

            // 更新狀態（使用實際名稱）
            wakewordStates.set(actualName, result.state);
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
                    
                    // 重置該喚醒詞的狀態 - 完全重新創建以清空所有緩衝區
                    const freshState = wakewordService.createState(actualName);  // 傳遞名稱以使用正確的維度
                    wakewordStates.set(actualName, freshState);  // 使用 actualName 而非 wakewordName
                    
                    // 對於 KMU 模型，增加一個額外的冷卻期來防止連續觸發
                    if (actualName.includes('kmu')) {
                        // 暫時禁用檢測 1000ms（增加冷卻時間）
                        const tempName = actualName;
                        wakewordStates.delete(tempName);
                        
                        // 設定一個標誌來阻止處理
                        if (!window.wakewordCooldown) {
                            window.wakewordCooldown = {};
                        }
                        window.wakewordCooldown[tempName] = true;
                        
                        setTimeout(() => {
                            const newState = wakewordService.createState(tempName);
                            wakewordStates.set(tempName, newState);
                            delete window.wakewordCooldown[tempName];
                        }, 1000);  // 增加到 1 秒冷卻期
                    }
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
            
            // 舊的檢測邏輯已移除 - 現在由 WakewordService 的 wakewordDetected 事件處理
            if (triggered) {
                // 只繪製波形，不再輸出日誌（避免重複）
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

// 載入本地模型列表
function loadLocalModelsList() {
    const select = document.getElementById('whisperLocalModel');
    select.innerHTML = '';

    AVAILABLE_LOCAL_MODELS.forEach(model => {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = `${model.label}`;
        if (model.id === whisperState.localModelId) {
            option.selected = true;
        }
        select.appendChild(option);
    });

    log('whisperLog', `載入 ${AVAILABLE_LOCAL_MODELS.length} 個本地模型選項`, 'info');
}

// 載入 Whisper 模型
async function loadWhisperModel(source, modelId) {
    if (whisperState.isLoading) {
        log('whisperLog', '模型正在載入中，請稍候...', 'warning');
        return;
    }

    whisperState.isLoading = true;
    updateStatus('whisperStatus', '正在載入模型...', 'active');

    // 顯示進度條
    document.getElementById('whisperLoadProgress').classList.remove('hidden');
    document.getElementById('whisperApplyModel').disabled = true;
    document.getElementById('whisperCancelLoad').classList.remove('hidden');

    try {
        // 配置 transformers.js 環境
        if (window.transformers) {
            const { env } = window.transformers;

            // 根據 source 參數決定使用本地還是遠端模式
            if (source === 'local') {
                // 本地模式設定
                env.allowLocalModels = true;
                env.localModelPath = './models/';  // 本地模型路徑
                env.allowRemoteModels = false;
                log('whisperLog', '配置為本地模型載入模式', 'info');
                log('whisperLog', `本地路徑: ${env.localModelPath}`, 'info');
            } else {
                // 遠端模式設定
                env.allowLocalModels = false;
                env.remoteHost = 'https://huggingface.co';
                env.remotePathTemplate = '{model}/resolve/{revision}/';
                env.allowRemoteModels = true;
                log('whisperLog', '配置為遠端模型下載模式', 'info');
            }

            log('whisperLog', `遠端主機: ${env.remoteHost}`, 'info');
            log('whisperLog', `路徑模板: ${env.remotePathTemplate}`, 'info');
            log('whisperLog', `allowLocalModels: ${env.allowLocalModels}`, 'info');
            log('whisperLog', `allowRemoteModels: ${env.allowRemoteModels}`, 'info');

            // 設定 WASM 路徑
            env.backends = env.backends || {};
            env.backends.onnx = env.backends.onnx || {};
            env.backends.onnx.wasm = env.backends.onnx.wasm || {};

            // 使用對映表指定 WASM 檔案路徑
            // 優先使用本地 public/ort 目錄的檔案
            try {
                const testResponse = await fetch('./public/ort/ort-wasm-simd-threaded.jsep.wasm', { method: 'HEAD' });
                if (testResponse.ok) {
                    // 使用物件對映方式指定每個檔案的路徑
                    env.backends.onnx.wasm.wasmPaths = {
                        'ort-wasm-simd-threaded.jsep.mjs':  './public/ort/ort-wasm-simd-threaded.jsep.mjs',
                        'ort-wasm-simd-threaded.jsep.wasm': './public/ort/ort-wasm-simd-threaded.jsep.wasm',

                        // 兼容舊檔名探測
                        'ort-wasm.wasm':                    './public/ort/ort-wasm-simd-threaded.jsep.wasm',
                        'ort-wasm-simd.wasm':               './public/ort/ort-wasm-simd-threaded.jsep.wasm',
                        'ort-wasm-simd-threaded.wasm':      './public/ort/ort-wasm-simd-threaded.wasm'
                    };
                    log('whisperLog', 'WASM 路徑已設定 (使用本地 public/ort)', 'info');
                } else {
                    throw new Error('Local WASM files not available in public/ort');
                }
            } catch (e) {
                // 使用 CDN 作為備案
                env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/';
                log('whisperLog', 'WASM 路徑已設定 (使用 CDN)', 'info');
            }
        }

        // 構建模型路徑
        const fullModelPath = source === 'local'
            ? modelId  // 本地模型只需要 ID
            : modelId; // 遠端模型使用完整 HuggingFace ID

        log('whisperLog', `開始載入模型: ${fullModelPath} (${source})`, 'info');

        // 初始化 WhisperService - 直接載入模型，不做額外檢查
        // 先嘗試 WASM，如果 WebGPU 有問題
        const useWebGPU = false; // 暫時停用 WebGPU，因為可能有相容性問題
        await whisperService.initialize(
            fullModelPath,
            {
                quantized: true,
                device: useWebGPU && navigator.gpu ? 'webgpu' : 'wasm',
                dtype: useWebGPU && navigator.gpu ? 'fp16' : 'q8',
                progress_callback: (data) => {
                    if (data?.status === 'downloading') {
                        const percent = data.total ? Math.round((data.loaded / data.total) * 100) : 0;
                        document.getElementById('whisperProgressBar').style.width = `${percent}%`;
                        log('whisperLog', `下載進度: ${percent}%`, 'info');
                    } else if (data?.status) {
                        log('whisperLog', `狀態: ${data.status}`, 'info');
                    } else if (data?.progress) {
                        const percent = Math.round(data.progress);
                        document.getElementById('whisperProgressBar').style.width = `${percent}%`;
                        log('whisperLog', `載入進度: ${percent}%`, 'info');
                    }
                }
            }
        );

        // 更新狀態
        whisperState.source = source;
        if (source === 'local') {
            whisperState.localModelId = modelId;
        } else {
            whisperState.remoteModelId = modelId;
        }

        // 儲存設定到 localStorage
        localStorage.setItem('whisperSettings', JSON.stringify({
            source: whisperState.source,
            localModelId: whisperState.localModelId,
            remoteModelId: whisperState.remoteModelId
        }));

        log('whisperLog', `模型載入成功: ${fullModelPath}`, 'success');
        updateStatus('whisperStatus', '模型已載入，準備就緒');

    } catch (error) {
        log('whisperLog', `模型載入失敗: ${error.message}`, 'error');
        updateStatus('whisperStatus', '模型載入失敗', 'error');

        // 提供錯誤處理建議
        if (error.message.includes('404') || error.message.includes('not found')) {
            const message = source === 'local'
                ? '找不到本地模型，請確認模型檔案是否存在於指定路徑'
                : '找不到遠端模型，請確認 HuggingFace 模型 ID 是否正確';
            log('whisperLog', message, 'warning');
        } else if (error.message.includes('CORS')) {
            log('whisperLog', 'CORS 錯誤：請確認伺服器設定允許跨域請求', 'warning');
        } else if (error.message.includes('network')) {
            log('whisperLog', '網路錯誤：請檢查網路連線', 'warning');
        }

    } finally {
        whisperState.isLoading = false;
        document.getElementById('whisperLoadProgress').classList.add('hidden');
        document.getElementById('whisperProgressBar').style.width = '0%';
        document.getElementById('whisperApplyModel').disabled = false;
        document.getElementById('whisperCancelLoad').classList.add('hidden');
    }
}

// 初始化 Whisper UI 事件
function initWhisperUI() {
    // 載入本地模型列表
    loadLocalModelsList();

    // 從 localStorage 載入設定
    const savedSettings = localStorage.getItem('whisperSettings');
    if (savedSettings) {
        try {
            const settings = JSON.parse(savedSettings);
            whisperState.source = settings.source || 'local';
            whisperState.localModelId = settings.localModelId || 'Xenova/whisper-base';
            whisperState.remoteModelId = settings.remoteModelId || 'Xenova/whisper-tiny';

            // 更新 UI
            document.querySelector(`input[name="whisperSource"][value="${whisperState.source}"]`).checked = true;
            document.getElementById('whisperLocalModel').value = whisperState.localModelId;
            document.getElementById('whisperRemoteModel').value = whisperState.remoteModelId;
        } catch (e) {
            console.error('無法載入儲存的設定:', e);
        }
    }

    // 顯示正確的設定區域
    document.getElementById('whisperLocalSettings').classList.toggle('hidden', whisperState.source !== 'local');
    document.getElementById('whisperRemoteSettings').classList.toggle('hidden', whisperState.source === 'local');

    // 模型來源切換
    document.querySelectorAll('input[name="whisperSource"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const source = e.target.value;
            document.getElementById('whisperLocalSettings').classList.toggle('hidden', source !== 'local');
            document.getElementById('whisperRemoteSettings').classList.toggle('hidden', source === 'local');
            log('whisperLog', `切換到${source === 'local' ? '本地' : '遠端'}模型模式`, 'info');
        });
    });

    // 重新整理本地模型列表
    document.getElementById('whisperRefreshLocal').addEventListener('click', () => {
        loadLocalModelsList();
    });

    // 套用模型按鈕
    document.getElementById('whisperApplyModel').addEventListener('click', async () => {
        const source = document.querySelector('input[name="whisperSource"]:checked').value;
        let modelId;

        if (source === 'local') {
            modelId = document.getElementById('whisperLocalModel').value;
            if (!modelId) {
                log('whisperLog', '請選擇本地模型', 'warning');
                return;
            }
        } else {
            modelId = document.getElementById('whisperRemoteModel').value.trim();
            if (!modelId) {
                log('whisperLog', '請輸入 HuggingFace 模型 ID', 'warning');
                return;
            }
        }

        await loadWhisperModel(source, modelId);
    });

    // 取消載入按鈕
    document.getElementById('whisperCancelLoad').addEventListener('click', () => {
        log('whisperLog', '使用者取消載入', 'info');
        // 注意：transformers.js 可能不支援真正的取消，這裡只是 UI 層面的取消
        whisperState.isLoading = false;
        document.getElementById('whisperLoadProgress').classList.add('hidden');
        document.getElementById('whisperProgressBar').style.width = '0%';
        document.getElementById('whisperApplyModel').disabled = false;
        document.getElementById('whisperCancelLoad').classList.add('hidden');
        updateStatus('whisperStatus', '載入已取消');
    });

    // 更新本地模型選擇
    document.getElementById('whisperLocalModel').addEventListener('change', (e) => {
        whisperState.localModelId = e.target.value;
    });

    // 更新遠端模型 ID
    document.getElementById('whisperRemoteModel').addEventListener('input', async (e) => {
        whisperState.remoteModelId = e.target.value;

        const indicator = document.getElementById('whisperCompatibilityIndicator');
        const message = document.getElementById('whisperCompatibilityMessage');
        const suggestedModels = document.getElementById('whisperSuggestedModels');

        // 如果輸入為空，清除指示器
        if (!e.target.value.trim()) {
            indicator.innerHTML = '';
            message.textContent = '將從 HuggingFace 下載並快取於瀏覽器';
            message.className = 'text-xs mt-1 block text-gray-500';
            suggestedModels.classList.add('hidden');
            return;
        }

        // 直接顯示準備載入狀態（不檢查相容性）
        indicator.innerHTML = '<i class="fas fa-info-circle text-blue-500"></i>';
        message.textContent = '準備載入模型';
        message.className = 'text-xs mt-1 block text-blue-600';
        suggestedModels.classList.add('hidden');
    });

    // 建議模型點擊事件
    document.querySelectorAll('#whisperSuggestedModels button[data-model]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modelId = e.target.getAttribute('data-model');
            document.getElementById('whisperRemoteModel').value = modelId;
            whisperState.remoteModelId = modelId;

            // 觸發 input 事件以更新相容性指示器
            document.getElementById('whisperRemoteModel').dispatchEvent(new Event('input'));
        });
    });
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
        // 硬編碼模型路徑配置 - 使用相對路徑
        const MODEL_PATHS = {
            vad: {
                modelUrl: 'models/github/snakers4/silero-vad/silero_vad_v6.onnx'
            },
            wakeword: {
                'hey-jarvis': {
                    detectorUrl: 'models/github/dscripka/openWakeWord/hey_jarvis_v0.1.onnx',
                    melspecUrl: 'models/github/dscripka/openWakeWord/melspectrogram.onnx',
                    embeddingUrl: 'models/github/dscripka/openWakeWord/embedding_model.onnx',
                    threshold: 0.5
                },
                'hey-mycroft': {
                    detectorUrl: 'models/github/dscripka/openWakeWord/hey_mycroft_v0.1.onnx',
                    melspecUrl: 'models/github/dscripka/openWakeWord/melspectrogram.onnx',
                    embeddingUrl: 'models/github/dscripka/openWakeWord/embedding_model.onnx',
                    threshold: 0.5
                },
                'alexa': {
                    detectorUrl: 'models/github/dscripka/openWakeWord/alexa_v0.1.onnx',
                    melspecUrl: 'models/github/dscripka/openWakeWord/melspectrogram.onnx',
                    embeddingUrl: 'models/github/dscripka/openWakeWord/embedding_model.onnx',
                    threshold: 0.5
                }
            },
            whisper: {
                // path: 'Xenova/whisper-base',  // 這個會用 transformers.js 從 HuggingFace 載入
                path: 'Xenova/whisper-base',  // 模型 ID，會從 localModelPath 載入
                quantized: true
            }
        };

        // 載入 VAD - 使用 Event Architecture v2
        log('vadLog', '初始化 VAD 服務...', 'info');
        
        // 創建 VadService 實例
        vadService = new WebASRCore.VadService({
            threshold: parseFloat(document.getElementById('vadThreshold')?.value || '0.5'),
            windowSize: 2048,
            minSpeechFrames: 5,
            speechEndFrames: 20
        });
        
        // 設置 VAD 事件監聽器
        vadService.on('speechStart', (event) => {
            document.getElementById('vadStatus').textContent = 'Speaking';
            document.getElementById('vadStatus').className = 'text-green-600 font-bold';
            log('vadLog', `語音開始 (時間: ${new Date(event.timestamp).toLocaleTimeString()})`, 'success');
        });
        
        vadService.on('speechEnd', (event) => {
            document.getElementById('vadStatus').textContent = 'Silence';
            document.getElementById('vadStatus').className = 'text-gray-600';
            log('vadLog', `語音結束 (持續: ${(event.duration / 1000).toFixed(2)}秒)`, 'info');
        });
        
        vadService.on('vadResult', (event) => {
            // 更新 VAD 分數顯示
            const scoreEl = document.getElementById('vadScore');
            if (scoreEl) {
                scoreEl.textContent = event.score.toFixed(4);
            }
            
            // 更新視覺化（如果有的話）
            if (event.isSpeech) {
                const canvas = document.getElementById('vadCanvas');
                if (canvas) {
                    canvas.style.borderColor = '#10b981'; // 綠色邊框表示語音
                }
            }
        });
        
        vadService.on('statistics', (event) => {
            // 更新統計信息
            const statsEl = document.getElementById('vadStats');
            if (statsEl) {
                statsEl.innerHTML = `
                    <div>總檢測次數: ${event.totalDetections}</div>
                    <div>平均處理時間: ${event.averageProcessingTime.toFixed(2)}ms</div>
                    <div>語音片段數: ${event.speechSegments}</div>
                `;
            }
        });
        
        vadService.on('error', (event) => {
            log('vadLog', `VAD 錯誤: ${event.error.message}`, 'error');
            console.error('VAD Error:', event.error);
        });
        
        // 初始化服務 - 傳入正確的模型路徑
        await vadService.initialize(MODEL_PATHS.vad.modelUrl);
        log('vadLog', 'VAD 服務初始化成功', 'success');
        
        // 創建初始 VAD 狀態
        vadState = vadService.createState();

        // 載入喚醒詞 - 使用 Event Architecture v2
        const wakewordId = document.getElementById('wakewordSelect').value;
        log('wakewordLog', `初始化 ${wakewordId} 喚醒詞服務...`, 'info');
        
        // 創建 WakewordService 實例
        wakewordService = new WebASRCore.WakewordService({
            thresholds: {
                'hey_jarvis': 0.6,
                'hey_mycroft': 0.5,
                'alexa': 0.5,
                'ok_google': 0.5
            },
            resetOnDetection: true
        });
        
        // 設置喚醒詞事件監聽器
        wakewordService.on('wakewordDetected', (event) => {
            const detectionSound = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSCBzvLZiTcIGlyx9u2QQAoUXrTp66hVFApGn+DyvmwhBTGS2OzMeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSCBzvLZiTcIGlyx9u2QQAoUXrTp66hVFApGn+DyvmwhBTGS2OzMeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSCBzvLZiTcIGlyx9u2QQAoUXrTp66hVFApGn+DyvmwhBTGS2OzMeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSCBzvLZiTcIGlyx9u2QQAoUXrTp66hVFApGn+DyvmwhBTGS2OzMeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSCBzvLZiTcIGlyx9u2QQAoUXrTp66hVFApGn+DyvmwhBTGS2OzMeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSCBzvLZiTcIGlyx9u2QQAoUXrTp66hVFApGn+DyvmwhBTGS2OzMeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSCBzvLZiTcIGlyx9u2QQAoUXrTp66hVFApGn+DyvmwhBTGS2OzMeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSCBzvLZiTcIGlyx9u2QQAoUXrTp66hVFApGn+DyvmwhBTGS2OzMeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSCBzvLZiTcIGlyx9u2QQAoUXrTp66hVFApGn+DyvmwhBTGS2OzMeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSCBzvLZiTcIGlyx9u2QQAoUXrTp66hVFApGn+DyvmwhBTGS2OzMeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSCBzvLZiTcIGlyx9u2QQAoUXrTp66hVFApGn+DyvmwhBQ==');
            detectionSound.play();
            
            log('wakewordLog', `🎯 喚醒詞檢測到: ${event.word} (分數: ${event.score.toFixed(3)})`, 'success');
            
            // 高亮顯示檢測結果
            const statusEl = document.getElementById('wakewordStatus');
            if (statusEl) {
                statusEl.textContent = `檢測到: ${event.word}`;
                statusEl.className = 'text-green-600 font-bold text-xl';
                setTimeout(() => {
                    statusEl.textContent = '監聽中...';
                    statusEl.className = 'text-gray-600';
                }, 2000);
            }
        });
        
        wakewordService.on('process', (event) => {
            // 更新檢測進度（每次處理音訊塊時觸發）
            const scoreEl = document.getElementById('wakewordScore');
            if (scoreEl && event.maxScore) {
                scoreEl.textContent = event.maxScore.toFixed(4);
            }
        });
        
        wakewordService.on('error', (event) => {
            log('wakewordLog', `喚醒詞錯誤: ${event.error.message}`, 'error');
            console.error('Wakeword Error:', event.error);
        });
        
        // 初始化服務 - 需要傳入陣列，使用原始 ID 格式
        await wakewordService.initialize([wakewordId]);
        log('wakewordLog', '喚醒詞服務初始化成功', 'success');
        
        // 清空並重新初始化所有喚醒詞狀態
        wakewordStates.clear();

        // 載入 Whisper - Event Architecture v2
        log('whisperLog', '初始化 WhisperService...', 'info');

        // 創建 WhisperService 實例
        whisperService = new WebASRCore.WhisperService({
            language: 'zh',
            temperature: 0.8,
            maxLength: 500,
            minAudioLength: 500  // 最小 500ms
        });

        // 設置 Whisper 事件監聽器
        whisperService.on('ready', (event) => {
            log('whisperLog', `WhisperService 已就緒 - 模型: ${event.modelId}`, 'success');
            updateStatus('whisperStatus', '準備就緒');
            // 啟用錄音按鈕
            document.getElementById('whisperRecordBtn').disabled = false;
        });

        whisperService.on('transcriptionStart', (event) => {
            log('whisperLog', `開始轉錄 - 音訊長度: ${(event.audioLength / 16000).toFixed(2)}秒`, 'info');
            updateStatus('whisperStatus', '正在轉錄...', 'active');
        });

        whisperService.on('transcriptionComplete', (event) => {
            log('whisperLog', `轉錄完成: "${event.text}" (耗時 ${event.duration}ms)`, 'success');

            // 顯示分段結果（如果有）
            if (event.segments && event.segments.length > 0) {
                event.segments.forEach(segment => {
                    log('whisperLog', `[${segment.start?.toFixed(1) || '0.0'}-${segment.end?.toFixed(1) || '0.0'}]: ${segment.text}`, 'info');
                });
            }

            updateStatus('whisperStatus', '轉錄完成');
        });

        whisperService.on('transcriptionProgress', (event) => {
            log('whisperLog', `轉錄進度: ${event.progress}%`, 'info');
            if (event.partialText) {
                log('whisperLog', `部分結果: "${event.partialText}"`, 'info');
            }
        });

        whisperService.on('error', (event) => {
            log('whisperLog', `錯誤: ${event.error.message} (${event.context})`, 'error');
            updateStatus('whisperStatus', '發生錯誤', 'error');
        });

        whisperService.on('statistics', (event) => {
            log('whisperLog', `統計 - 總轉錄數: ${event.totalTranscriptions}, 平均時間: ${event.averageTranscriptionTime.toFixed(0)}ms`, 'info');
        });

        // 串流事件處理
        whisperService.on('streamChunkStart', (event) => {
            log('whisperLog', '[串流] 開始處理音訊塊', 'info');
        });

        whisperService.on('streamPartial', (event) => {
            log('whisperLog', `[串流] 部分結果: "${event.partial}"`, 'info');
            if (event.committed) {
                log('whisperLog', `[串流] 已確認: "${event.committed}"`, 'success');
            }
        });

        whisperService.on('streamChunkEnd', (event) => {
            log('whisperLog', `[串流] 音訊塊處理完成: "${event.committed}"`, 'success');
        });

        whisperService.on('streamFinalize', (event) => {
            log('whisperLog', `[串流] 最終結果: "${event.text}"`, 'success');
        });

        // 初始化 Whisper UI 事件處理
        initWhisperUI();

        // 使用預設設定初始化 (先使用本地模型)
        await loadWhisperModel('local', 'Xenova/whisper-base');

        log('whisperLog', 'WhisperService 初始化成功', 'success');

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

// 儲存自訂模型資訊
let customWakewordModel = null;

// 初始化 WakewordService（如果尚未初始化）
async function initializeWakewordService() {
    if (wakewordService) {
        return; // 已經初始化
    }
    
    try {
        const { WakewordService } = WebASRCore;
        
        // 創建 WakewordService 實例
        wakewordService = new WakewordService({
            thresholds: {
                'hey_jarvis': 0.6,
                'hey_mycroft': 0.5,
                'alexa': 0.5,
                'ok_google': 0.5
            },
            resetOnDetection: true
        });
        
        // 設置喚醒詞事件監聽器
        wakewordService.on('wakewordDetected', ({ word, score }) => {
            const detectionSound = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSCBzvLZiTcIGlyx9u2QQAoUXrTp66hVFApGn+DyvmwhBTGS2OzMeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSCBzvLZiTcIGlyx9u2QQAoUXrTp66hVFApGn+DyvmwhBTGS2OzMeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSCBzvLZiTcIGlyx9u2QQAoUXrTp66hVFApGn+DyvmwhBTGS2OzMeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSCBzvLZiTcIGlyx9u2QQAoUXrTp66hVFApGn+DyvmwhBTGS2OzMeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSCBzvLZiTcIGlyx9u2QQAoUXrTp66hVFApGn+DyvmwhBTGS2OzMeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSCBzvLZiTcIGlyx9u2QQAoUXrTp66hVFApGn+DyvmwhBTGS2OzMeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSCBzvLZiTcIGlyx9u2QQAoUXrTp66hVFApGn+DyvmwhBTGS2OzMeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSCBzvLZiTcIGlyx9u2QQAoUXrTp66hVFApGn+DyvmwhBTGS2OzMeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSCBzvLZiTcIGlyx9u2QQAoUXrTp66hVFApGn+DyvmwhBTGS2OzMeSsFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSCBzvLZiTcIGlyx9u2QQAoUXrTp66hVFApGn+DyvmwhBQ==');
            detectionSound.play();
            log('wakewordLog', `🎯 喚醒詞檢測到: ${word} (分數: ${score.toFixed(3)})`, 'success');
            updateStatus('wakewordStatus', `檢測到 "${word}"！分數: ${score.toFixed(3)}`, 'success');
        });
        
        wakewordService.on('process', ({ word, maxScore }) => {
            // 可選：顯示即時分數
            if (maxScore > 0.3) {
                console.log(`[Wakeword] ${word}: ${maxScore.toFixed(3)}`);
            }
        });
        
        wakewordService.on('error', ({ error, context }) => {
            log('wakewordLog', `❌ 錯誤 [${context}]: ${error.message}`, 'error');
            
            // 嘗試從錯誤訊息中分析並自動修正
            if (error.message.includes('Invalid rank for input')) {
                handleCustomModelDimensionError(error.message);
            }
        });
        
        log('wakewordLog', 'WakewordService 初始化成功', 'success');
        return wakewordService;
    } catch (error) {
        console.error('初始化 WakewordService 失敗:', error);
        log('wakewordLog', `❌ 初始化失敗: ${error.message}`, 'error');
        throw error;
    }
}

// 處理自訂模型維度錯誤
function handleCustomModelDimensionError(errorMessage) {
    // 解析錯誤訊息：Got: 2 Expected: 3
    const match = errorMessage.match(/Got: (\d+) Expected: (\d+)/);
    if (match) {
        const got = parseInt(match[1]);
        const expected = parseInt(match[2]);
        
        log('wakewordLog', `⚠️ 模型輸入維度不匹配：收到 ${got}D，期望 ${expected}D`, 'warning');
        log('wakewordLog', `💡 嘗試調整輸入格式...`, 'info');
        
        // 儲存維度資訊供後續處理使用
        if (customWakewordModel) {
            customWakewordModel.expectedDimensions = expected;
            customWakewordModel.receivedDimensions = got;
        }
    }
}

// 自訂模型上傳處理
document.getElementById('uploadWakewordBtn').addEventListener('click', () => {
    document.getElementById('customWakewordInput').click();
});

document.getElementById('customWakewordInput').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!file.name.endsWith('.onnx')) {
        log('wakewordLog', '❌ 請選擇 .onnx 模型檔案', 'error');
        return;
    }
    
    try {
        // 讀取檔案為 ArrayBuffer
        const arrayBuffer = await file.arrayBuffer();
        
        // 儲存自訂模型資訊
        customWakewordModel = {
            name: file.name.replace('.onnx', ''),
            arrayBuffer: arrayBuffer,
            file: file
        };
        
        // 更新 UI
        document.getElementById('customModelInfo').classList.remove('hidden');
        document.getElementById('customModelName').textContent = `檔案: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`;
        document.getElementById('wakewordSelect').value = 'custom';
        
        log('wakewordLog', `✅ 已載入自訂模型: ${file.name}`, 'success');
        updateStatus('wakewordStatus', `自訂模型 "${customWakewordModel.name}" 已就緒`, 'success');
        
        // 如果 WakewordService 已初始化，預載模型
        if (wakewordService) {
            await preloadCustomWakewordModel();
            // 啟用開始按鈕
            document.getElementById('wakewordStartBtn').disabled = false;
        } else {
            // 如果服務尚未初始化，先初始化服務
            await initializeWakewordService();
            await preloadCustomWakewordModel();
            // 啟用開始按鈕
            document.getElementById('wakewordStartBtn').disabled = false;
        }
    } catch (error) {
        console.error('載入自訂模型失敗:', error);
        log('wakewordLog', `❌ 載入失敗: ${error.message}`, 'error');
    }
    
    // 清空 input 以允許重新選擇相同檔案
    event.target.value = '';
});

// 移除自訂模型
document.getElementById('removeCustomModelBtn').addEventListener('click', () => {
    // 如果 WakewordService 存在，移除自訂模型
    if (wakewordService && customWakewordModel) {
        wakewordService.removeCustomModel(customWakewordModel.name);
    }
    
    customWakewordModel = null;
    document.getElementById('customModelInfo').classList.add('hidden');
    document.getElementById('wakewordSelect').value = 'hey-jarvis';
    
    // 確保按鈕狀態正確（如果有內建模型已載入）
    if (wakewordService) {
        document.getElementById('wakewordStartBtn').disabled = false;
    }
    
    log('wakewordLog', '已移除自訂模型', 'info');
    updateStatus('wakewordStatus', '自訂模型已移除', 'info');
});

// 預載自訂模型到 WakewordService
async function preloadCustomWakewordModel() {
    if (!customWakewordModel || !wakewordService) return;
    
    try {
        // 建立 Blob URL 供 ONNX Runtime 載入
        const blob = new Blob([customWakewordModel.arrayBuffer], { type: 'application/octet-stream' });
        const modelUrl = URL.createObjectURL(blob);
        
        // 註冊自訂模型到服務
        await wakewordService.registerCustomModel(customWakewordModel.name, modelUrl);
        
        // 為 KMU 模型設定更高的閾值和更長的冷卻期
        if (customWakewordModel.name.includes('kmu')) {
            wakewordService.options.thresholds[customWakewordModel.name] = 0.7;  // KMU 模型使用更高閾值
            wakewordService.setCooldownDuration(1500); // 1.5 秒冷卻期
            log('wakewordLog', `設定 KMU 模型閾值為 0.7，冷卻期為 1.5 秒`, 'info');
        } else {
            wakewordService.options.thresholds[customWakewordModel.name] = 0.6;  // 其他自訂模型的預設閾值
        }
        
        log('wakewordLog', `✅ 自訂模型已註冊到服務: ${customWakewordModel.name}`, 'success');
    } catch (error) {
        console.error('註冊自訂模型失敗:', error);
        log('wakewordLog', `❌ 註冊失敗: ${error.message}`, 'error');
    }
}

// 喚醒詞測試控制
document.getElementById('wakewordStartBtn').addEventListener('click', async () => {
    wakewordTesting = true;
    
    // 如果選擇自訂模型且尚未載入
    const wakewordName = document.getElementById('wakewordSelect').value;
    if (wakewordName === 'custom') {
        if (!customWakewordModel) {
            log('wakewordLog', '請先上傳自訂 ONNX 模型', 'warning');
            wakewordTesting = false;
            return;
        }
        
        // 確保自訂模型已註冊
        if (wakewordService) {
            await preloadCustomWakewordModel();
        }
    }
    
    // 確保音訊已初始化
    if (!audioContext || !microphone || !processor) {
        const ok = await initAudio();
        if (!ok) {
            log('wakewordLog', '音訊初始化失敗，請檢查麥克風權限', 'error');
            wakewordTesting = false;
            return;
        }
    }
    
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
    document.getElementById('uploadWakewordBtn').disabled = true;

    const displayName = wakewordName === 'custom' ? customWakewordModel.name : wakewordName;
    updateStatus('wakewordStatus', `正在聆聽 "${displayName}"...`, 'active');
    log('wakewordLog', `開始喚醒詞測試: ${displayName}`, 'success');
});

document.getElementById('wakewordStopBtn').addEventListener('click', () => {
    wakewordTesting = false;
    
    // 清理該喚醒詞的狀態
    const wakewordName = document.getElementById('wakewordSelect').value;
    const actualName = wakewordName === 'custom' ? customWakewordModel?.name : wakewordName;
    if (actualName && wakewordStates.has(actualName)) {
        wakewordStates.delete(actualName);
        console.log(`[wakewordStop] 清理 ${actualName} 狀態`);
    }
    
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
    document.getElementById('uploadWakewordBtn').disabled = false;
    updateStatus('wakewordStatus', '測試已停止');
    log('wakewordLog', '停止喚醒詞測試', 'warning');
});

// 切換喚醒詞模型
document.getElementById('wakewordSelect').addEventListener('change', async (e) => {
    const wakewordId = e.target.value;
    log('wakewordLog', `切換到 ${wakewordId} 模型`, 'info');

    // 如果正在測試，清理該喚醒詞的狀態
    if (wakewordTesting) {
        // 清理舊喚醒詞的狀態
        const oldWakewords = wakewordStates.keys();
        for (const key of oldWakewords) {
            if (key !== wakewordId) {
                wakewordStates.delete(key);
                console.log(`[wakewordSelect] 清理 ${key} 狀態`);
            }
        }
    }
    
    // 重置運行時狀態
    wwRuntime.lastTriggerAt = -Infinity;
    wwRuntime.consecutiveFrames = 0;
    
    // 如果是自訂模型，確保服務已初始化
    if (wakewordId === 'custom') {
        if (!wakewordService) {
            await initializeWakewordService();
        }
        if (customWakewordModel) {
            await preloadCustomWakewordModel();
        }
        return;
    }
    
    // 確保服務已初始化
    if (!wakewordService) {
        await initializeWakewordService();
    }
    
    // 重新初始化喚醒詞服務（如果需要）
    if (!wakewordService.getLoadedModels().includes(wakewordId)) {
        try {
            await wakewordService.initialize([wakewordId]);
            log('wakewordLog', `${wakewordId} 模型初始化成功`, 'success');
        } catch (error) {
            log('wakewordLog', `初始化失敗: ${error.message}`, 'error');
        }
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

// Whisper 串流模式切換
document.getElementById('whisperStreamingToggle').addEventListener('change', (e) => {
    const isStreaming = e.target.checked;
    const label = document.getElementById('whisperStreamingLabel');
    label.textContent = isStreaming ? '啟用' : '停用';
    log('whisperLog', `串流模式已${isStreaming ? '啟用' : '停用'}`, 'info');
});

// Whisper 轉譯 - Event Architecture v2
document.getElementById('whisperTranscribeBtn').addEventListener('click', async () => {
    if (recordedAudio.length === 0) {
        log('whisperLog', '沒有錄音數據', 'error');
        return;
    }

    document.getElementById('whisperTranscribeBtn').disabled = true;

    try {
        const audioData = new Float32Array(recordedAudio);
        const useStreaming = document.getElementById('whisperStreamingToggle').checked;

        log('whisperLog', `使用${useStreaming ? '串流' : '一次性'}模式轉錄`, 'info');

        // 根據串流模式選擇不同的方法
        let result;
        if (useStreaming) {
            // 檢查方法是否存在
            if (typeof whisperService.transcribeWithStreaming !== 'function') {
                log('whisperLog', '警告: transcribeWithStreaming 方法不存在，降級使用一般 transcribe 方法', 'warning');
                result = await whisperService.transcribe(audioData, {
                    language: 'zh',
                    task: 'transcribe',
                    returnSegments: true,
                    streaming: true  // 嘗試通過選項啟用串流
                });
            } else {
                // 使用串流模式
                result = await whisperService.transcribeWithStreaming(audioData, {
                language: 'zh',
                task: 'transcribe',
                returnSegments: true,
                streamCallbacks: {
                    // on_chunk_start: () => {
                    //     log('whisperLog', '[回調] 串流塊開始', 'info');
                    // },
                    // callback_function: (partial) => {
                    //     if (partial && partial.trim()) {
                    //         log('whisperLog', `[回調] 串流部分: "${partial}"`, 'info');
                    //     }
                    // },
                    // on_chunk_end: () => {
                    //     log('whisperLog', '[回調] 串流塊結束', 'info');
                    // },
                    // on_finalize: (finalText) => {
                    //     // finalText 可能是 undefined，使用預設值
                    //     const text = finalText || '(串流完成，但無最終文字)';
                    //     log('whisperLog', `[回調] 串流完成: "${text}"`, 'success');
                    // }
                }
            });
            }
        } else {
            // 使用一次性模式
            result = await whisperService.transcribe(audioData, {
                language: 'zh',
                task: 'transcribe',
                returnSegments: true
            });
        }

        // transcriptionComplete 事件會自動處理結果顯示
        // 這裡可以額外處理結果（如果需要）

    } catch (error) {
        log('whisperLog', `轉譯失敗: ${error.message}`, 'error');
        updateStatus('whisperStatus', '轉譯失敗', 'error');
    } finally {
        document.getElementById('whisperTranscribeBtn').disabled = false;
    }
});

// 分頁切換功能
let currentPage = 1;

// 分頁配置
const pageConfig = {
    1: ['speech', 'whisper', 'vad', 'wakeword'],
    2: ['timer', 'buffer']
};

function initTabSystem() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const pageIndicator = document.getElementById('pageIndicator');
    const page1Tabs = document.getElementById('page1-tabs');
    const page2Tabs = document.getElementById('page2-tabs');
    
    // 更新分頁顯示
    function updatePageDisplay() {
        // 更新分頁標籤顯示
        if (currentPage === 1) {
            page1Tabs.classList.remove('hidden');
            page2Tabs.classList.add('hidden');
            prevPageBtn.disabled = true;
            nextPageBtn.disabled = false;
        } else {
            page1Tabs.classList.add('hidden');
            page2Tabs.classList.remove('hidden');
            prevPageBtn.disabled = false;
            nextPageBtn.disabled = true;
        }
        
        // 更新頁碼指示器
        pageIndicator.textContent = `${currentPage} / 2`;
        
        // 顯示當前頁的第一個分頁內容
        const firstTabOfPage = pageConfig[currentPage][0];
        showTab(firstTabOfPage);
    }
    
    // 切換到指定分頁
    function showTab(tabName) {
        // 更新按鈕狀態
        tabButtons.forEach(btn => {
            const btnTab = btn.getAttribute('data-tab');
            if (btnTab === tabName) {
                btn.classList.add('active', 'text-indigo-600', 'border-b-2', 'border-indigo-600', 'bg-indigo-50');
                btn.classList.remove('text-gray-600');
            } else {
                btn.classList.remove('active', 'text-indigo-600', 'border-b-2', 'border-indigo-600', 'bg-indigo-50');
                btn.classList.add('text-gray-600');
            }
        });
        
        // 切換內容顯示
        tabContents.forEach(content => {
            if (content.id === `tab-${tabName}`) {
                content.classList.remove('hidden');
                content.classList.add('flex');
            } else {
                content.classList.add('hidden');
                content.classList.remove('flex');
            }
        });
        
        // 特殊處理不同分頁的初始化
        if (tabName === 'whisper') {
            // Whisper 模型資訊更新 (如果函數存在)
            if (typeof updateWhisperModelInfo === 'function') {
                updateWhisperModelInfo();
            }
        } else if (tabName === 'timer') {
            // 初始化計時器顯示 (如果函數存在)
            if (typeof updateTimerDisplay === 'function') {
                updateTimerDisplay();  // 不需要參數，使用全域 currentTimerId
            }
        }
        
        // 記錄切換
        console.log(`切換到 ${tabName} 分頁`);
    }
    
    // 分頁按鈕事件
    prevPageBtn.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            updatePageDisplay();
        }
    });
    
    nextPageBtn.addEventListener('click', () => {
        if (currentPage < 2) {
            currentPage++;
            updatePageDisplay();
        }
    });
    
    // 分頁標籤按鈕事件
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.getAttribute('data-tab');
            showTab(targetTab);
        });
    });
    
    // 初始化顯示第一頁
    updatePageDisplay();
}

// 初始化分頁系統
initTabSystem();

// Timer 相關變數 (暫時定義以避免錯誤)
let timerStates = {};

// Whisper 模型資訊更新函數 (placeholder)
function updateWhisperModelInfo() {
    // 這個函數會在 Whisper 服務初始化後被實作
    console.log('Whisper model info will be updated when service is initialized');
}

// 初始化日誌
log('vadLog', 'VAD 服務就緒', 'info');

// ========================================
// Buffer/Chunker 測試相關
// ========================================

// Buffer/Chunker 測試變數
let bufferTesting = false;
// audioRingBuffer 已在頂部宣告 (line 20)
// audioChunker 已在頂部宣告 (line 19)
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
        html += `<div class="text-gray-200 text-sm ml-1">VAD: ${vadService ? '<span class="text-green-400 font-semibold">✅ 已載入</span>' : '<span class="text-yellow-400">⏳ 未載入</span>'}</div>`;
        html += `<div class="text-gray-200 text-sm ml-1">喚醒詞: ${wakewordService ? '<span class="text-green-400 font-semibold">✅ 已載入</span>' : '<span class="text-yellow-400">⏳ 未載入</span>'}</div>`;
        html += `<div class="text-gray-200 text-sm ml-1">Whisper: ${whisperService ? '<span class="text-green-400 font-semibold">✅ 已載入</span>' : '<span class="text-yellow-400">⏳ 未載入</span>'}</div>`;
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

// 計時器管理器實例 - Event Architecture v2
// timerService 已在第 14 行宣告
let currentTimerId = 'timer1';
let updateInterval = null;

// 初始化計時器服務 - Event Architecture v2
function initTimerService() {
    if (!timerService) {
        // 使用 TimerService 替代 TimerManager
        timerService = new WebASRCore.TimerService();
        
        // 設置事件監聽器
        timerService.on('ready', (event) => {
            log('timerLog', 'TimerService 已就緒', 'success');
        });
        
        timerService.on('start', (event) => {
            log('timerLog', `▶️ 計時器 ${event.id} 已啟動 (${event.duration}ms)`, 'success');
            updateTimerDisplay();
            updateAllTimersList();
        });
        
        timerService.on('tick', (event) => {
            // 自動更新顯示（如果是當前計時器）
            if (event.id === currentTimerId) {
                const remaining = event.remaining;
                document.getElementById('timerDisplay').textContent = formatTime(remaining);
                document.getElementById('timerProgressBar').style.width = `${event.progress}%`;
            }
        });
        
        timerService.on('timeout', (event) => {
            log('timerLog', `⏰ 計時器 ${event.id} 時間到！`, 'warning');
            if (event.id === currentTimerId) {
                updateTimerDisplay();
            }
            updateAllTimersList();
            
            // 播放提示音（可選）
            // playAlertSound();
        });
        
        timerService.on('pause', (event) => {
            log('timerLog', `⏸️ 計時器 ${event.id} 已暫停`, 'warning');
            updateTimerDisplay();
            updateAllTimersList();
        });
        
        timerService.on('resume', (event) => {
            log('timerLog', `▶️ 計時器 ${event.id} 已恢復`, 'success');
            updateTimerDisplay();
            updateAllTimersList();
        });
        
        timerService.on('reset', (event) => {
            log('timerLog', `🔄 計時器 ${event.id} 已重置`, 'info');
            updateTimerDisplay();
            updateAllTimersList();
        });
        
        timerService.on('error', (event) => {
            log('timerLog', `錯誤: ${event.error.message} (${event.context})`, 'error');
        });
        
        
        log('timerLog', 'TimerService 初始化完成', 'success');
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

// 更新計時器顯示 - Event Architecture v2
function updateTimerDisplay() {
    if (!timerService) return;
    
    const state = timerService.getTimerState(currentTimerId);
    if (!state) return;
    
    // 更新時間顯示
    const remaining = timerService.getRemainingTime(currentTimerId);
    document.getElementById('timerDisplay').textContent = formatTime(remaining);
    
    // 更新進度條
    const progress = timerService.getProgress(currentTimerId);
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

// 更新所有計時器列表 - Event Architecture v2
function updateAllTimersList() {
    if (!timerService) return;
    
    const allTimerIds = timerService.getAllTimerIds();
    const listEl = document.getElementById('allTimersList');
    
    if (allTimerIds.length === 0) {
        listEl.innerHTML = '<div class="text-gray-500 text-sm">尚無計時器</div>';
        return;
    }
    
    let html = '';
    for (const id of allTimerIds) {
        const state = timerService.getTimerState(id);
        if (!state) continue;
        
        const remaining = timerService.getRemainingTime(id);
        const progress = timerService.getProgress(id);
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
        
        initTimerService();
        
        // 創建新計時器 - Event Architecture v2
        timerService.createTimer(
            currentTimerId,
            milliseconds,
            100  // tickInterval
        );
        
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
    initTimerService();
    
    // 使用 TimerService 創建計時器
    timerService.createTimer(
        currentTimerId,
        milliseconds,
        100  // tickInterval
    );
    
    updateTimerDisplay();
    updateAllTimersList();
    log('timerLog', `設定計時器 ${currentTimerId}: ${seconds}秒`, 'info');
});

// 開始按鈕
document.getElementById('timerStartBtn').addEventListener('click', () => {
    initTimerService();
    
    // 如果當前計時器不存在，先創建一個預設 30 秒的
    if (!timerService.getTimerState(currentTimerId)) {
        timerService.createTimer(
            currentTimerId,
            30000,
            100  // tickInterval
        );
    }
    
    timerService.start(currentTimerId);
    
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
    if (!timerService) return;
    
    timerService.pause(currentTimerId);
    
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
    if (!timerService) return;
    
    timerService.start(currentTimerId);
    
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
    if (!timerService) return;
    
    timerService.reset(currentTimerId);
    
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
    if (!timerService) return;
    
    const state = timerService.getTimerState(currentTimerId);
    if (!state) {
        log('timerLog', '請先創建計時器', 'error');
        return;
    }
    
    // TimerService 使用 reset 方法來修改時間
    const currentTime = timerService.getRemainingTime(currentTimerId) || 0;
    timerService.reset(currentTimerId, currentTime + 10000); // 延長 10 秒
    
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
    
    initTimerService();
    
    // 檢查是否已存在
    if (timerService.getTimerState(timerId)) {
        log('timerLog', `計時器 ${timerId} 已存在`, 'warning');
        currentTimerId = timerId;
        updateTimerDisplay();
        updateAllTimersList();
        return;
    }
    
    // 創建新計時器（預設 30 秒）
    timerService.createTimer(
        timerId,
        30000,
        100  // tickInterval
    );
    
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
    
    if (!timerService || !timerService.getTimerState(timerId)) {
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
    const state = timerService.getTimerState(timerId);
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

// ========================================
// Speech API 測試功能
// ========================================

// Speech API 服務實例
let speechService = null;

// TTS 狀態
let isSpeaking = false;
let isPaused = false;

// STT 狀態
let isListening = false;
let finalTranscript = '';
let interimTranscript = '';

// 初始化 Speech API 服務
async function initSpeechService() {
    try {
        const { SpeechService } = WebASRCore;
        speechService = new SpeechService();
        
        // SpeechService 的 constructor 會自動調用 initialize()
        // 只需等待初始化完成
        await new Promise((resolve) => {
            speechService.once('ready', (data) => {
                log('speechLog', `✅ Speech API 初始化成功`, 'success');
                log('speechLog', `TTS 支援: ${data.ttsSupported}, STT 支援: ${data.sttSupported}`, 'info');
                
                // 填充語音選項
                const voiceSelect = document.getElementById('ttsVoiceSelect');
                voiceSelect.innerHTML = '<option value="">預設</option>';
                data.voices.forEach(voice => {
                    const option = document.createElement('option');
                    option.value = voice.name;
                    option.textContent = `${voice.name} (${voice.lang})`;
                    voiceSelect.appendChild(option);
                });
                
                resolve();
            });
        });
        
        // 設定 TTS 事件監聽器
        speechService.on('tts-start', (data) => {
            log('speechLog', `🔊 開始說話: "${data.text}"`, 'info');
            document.getElementById('ttsStatus').innerHTML = 
                '<div class="text-blue-800 font-medium text-sm">TTS 狀態：說話中...</div>';
            document.getElementById('ttsPauseBtn').disabled = false;
            document.getElementById('ttsStopBtn').disabled = false;
            isSpeaking = true;
            isPaused = false;
        });
        
        speechService.on('tts-end', (data) => {
            log('speechLog', `✅ 說話結束 (耗時: ${(data.duration/1000).toFixed(2)}秒)`, 'success');
            document.getElementById('ttsStatus').innerHTML = 
                '<div class="text-blue-800 font-medium text-sm">TTS 狀態：就緒</div>';
            document.getElementById('ttsPauseBtn').disabled = true;
            document.getElementById('ttsStopBtn').disabled = true;
            isSpeaking = false;
            isPaused = false;
        });
        
        speechService.on('tts-pause', (data) => {
            log('speechLog', `⏸️ 暫停說話`, 'warning');
            document.getElementById('ttsStatus').innerHTML = 
                '<div class="text-yellow-800 font-medium text-sm">TTS 狀態：已暫停</div>';
            document.getElementById('ttsPauseBtn').textContent = '繼續';
            document.getElementById('ttsPauseBtn').innerHTML = '<i class="fas fa-play mr-2"></i>繼續';
            isPaused = true;
        });
        
        speechService.on('tts-resume', (data) => {
            log('speechLog', `▶️ 繼續說話`, 'info');
            document.getElementById('ttsStatus').innerHTML = 
                '<div class="text-blue-800 font-medium text-sm">TTS 狀態：說話中...</div>';
            document.getElementById('ttsPauseBtn').innerHTML = '<i class="fas fa-pause mr-2"></i>暫停';
            isPaused = false;
        });
        
        speechService.on('tts-boundary', (data) => {
            // 可選：顯示當前說的單字
            // log('speechLog', `當前單字: ${data.word}`, 'info');
        });
        
        // 設定 STT 事件監聽器
        speechService.on('stt-start', (data) => {
            log('speechLog', `🎤 開始語音識別 (語言: ${data.language})`, 'info');
            document.getElementById('sttStatus').innerHTML = 
                '<div class="text-green-800 font-medium text-sm">STT 狀態：識別中...</div>';
            document.getElementById('sttStartBtn').disabled = true;
            document.getElementById('sttStopBtn').disabled = false;
            isListening = true;
            finalTranscript = '';
            interimTranscript = '';
        });
        
        speechService.on('stt-result', (data) => {
            if (data.isFinal) {
                finalTranscript += data.transcript + ' ';
                log('speechLog', `📝 最終結果: ${data.transcript}`, 'success');
            } else {
                interimTranscript = data.transcript;
            }
            
            // 更新顯示
            const showInterim = document.getElementById('sttInterimCheck').checked;
            const resultDiv = document.getElementById('sttResult');
            
            if (showInterim && interimTranscript) {
                resultDiv.innerHTML = `
                    <span class="text-gray-800">${finalTranscript}</span>
                    <span class="text-gray-400 italic">${interimTranscript}</span>
                `;
            } else {
                resultDiv.innerHTML = `<span class="text-gray-800">${finalTranscript}</span>`;
            }
        });
        
        speechService.on('stt-end', (data) => {
            log('speechLog', `✅ 語音識別結束`, 'success');
            document.getElementById('sttStatus').innerHTML = 
                '<div class="text-green-800 font-medium text-sm">STT 狀態：就緒</div>';
            document.getElementById('sttStartBtn').disabled = false;
            document.getElementById('sttStopBtn').disabled = true;
            isListening = false;
        });
        
        speechService.on('stt-speechstart', () => {
            log('speechLog', `🗣️ 檢測到語音開始`, 'info');
        });
        
        speechService.on('stt-speechend', () => {
            log('speechLog', `🔇 語音結束`, 'info');
        });
        
        speechService.on('stt-nomatch', () => {
            log('speechLog', `❓ 無法識別語音`, 'warning');
        });
        
        speechService.on('error', (data) => {
            log('speechLog', `❌ ${data.type.toUpperCase()} 錯誤: ${data.error}`, 'error');
            
            if (data.type === 'tts') {
                document.getElementById('ttsStatus').innerHTML = 
                    '<div class="text-red-800 font-medium text-sm">TTS 錯誤</div>';
                document.getElementById('ttsPauseBtn').disabled = true;
                document.getElementById('ttsStopBtn').disabled = true;
                isSpeaking = false;
                isPaused = false;
            } else if (data.type === 'stt') {
                document.getElementById('sttStatus').innerHTML = 
                    '<div class="text-red-800 font-medium text-sm">STT 錯誤</div>';
                document.getElementById('sttStartBtn').disabled = false;
                document.getElementById('sttStopBtn').disabled = true;
                isListening = false;
            }
        });
        
    } catch (error) {
        console.error('Speech API 初始化失敗:', error);
        log('speechLog', `❌ Speech API 初始化失敗: ${error.message}`, 'error');
    }
}

// TTS 控制功能
document.getElementById('ttsSpeakBtn')?.addEventListener('click', async () => {
    if (!speechService) {
        await initSpeechService();
    }
    
    const text = document.getElementById('ttsTextInput').value.trim();
    if (!text) {
        log('speechLog', '請輸入要說的文字', 'warning');
        return;
    }
    
    const voice = document.getElementById('ttsVoiceSelect').value;
    const rate = parseFloat(document.getElementById('ttsRateSlider').value);
    const pitch = parseFloat(document.getElementById('ttsPitchSlider').value);
    const volume = parseFloat(document.getElementById('ttsVolumeSlider').value);
    
    try {
        await speechService.speak(text, {
            voice: voice || undefined,
            rate,
            pitch,
            volume
        });
    } catch (error) {
        log('speechLog', `❌ TTS 錯誤: ${error.message}`, 'error');
    }
});

document.getElementById('ttsPauseBtn')?.addEventListener('click', () => {
    if (!speechService) return;
    
    if (isPaused) {
        speechService.resume();
    } else {
        speechService.pause();
    }
});

document.getElementById('ttsStopBtn')?.addEventListener('click', () => {
    if (!speechService) return;
    
    speechService.stop();
    log('speechLog', '⏹️ 停止說話', 'info');
    document.getElementById('ttsStatus').innerHTML = 
        '<div class="text-blue-800 font-medium text-sm">TTS 狀態：就緒</div>';
    document.getElementById('ttsPauseBtn').disabled = true;
    document.getElementById('ttsStopBtn').disabled = true;
    isSpeaking = false;
    isPaused = false;
});

// TTS 滑動條更新
document.getElementById('ttsRateSlider')?.addEventListener('input', (e) => {
    document.getElementById('ttsRateValue').textContent = e.target.value;
});

document.getElementById('ttsPitchSlider')?.addEventListener('input', (e) => {
    document.getElementById('ttsPitchValue').textContent = e.target.value;
});

document.getElementById('ttsVolumeSlider')?.addEventListener('input', (e) => {
    document.getElementById('ttsVolumeValue').textContent = e.target.value;
});

// STT 控制功能
document.getElementById('sttStartBtn')?.addEventListener('click', async () => {
    if (!speechService) {
        await initSpeechService();
    }
    
    const language = document.getElementById('sttLangSelect').value;
    const continuous = document.getElementById('sttContinuousCheck').checked;
    const interimResults = document.getElementById('sttInterimCheck').checked;
    
    try {
        await speechService.startListening({
            language,
            continuous,
            interimResults
        });
    } catch (error) {
        log('speechLog', `❌ STT 錯誤: ${error.message}`, 'error');
    }
});

document.getElementById('sttStopBtn')?.addEventListener('click', () => {
    if (!speechService) return;
    
    speechService.stopListening();
    log('speechLog', '⏹️ 停止語音識別', 'info');
});

// 初始化 Speech API 測試
log('speechLog', 'Speech API 測試就緒', 'info');

// 自動初始化 Speech Service 以載入語音列表
initSpeechService().catch(error => {
    console.error('Failed to initialize Speech Service:', error);
    log('speechLog', `⚠️ 自動初始化失敗: ${error.message}`, 'warning');
});