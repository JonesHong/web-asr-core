# WebASR 前端語音辨識管線完整規格書 v2.0

## 1. 專案概述

WebASR 是一個純前端、可透過 CDN 部署的語音辨識管線框架，支援完全離線運作。採用模組化設計，整合 Wake Word 偵測、VAD（語音活動偵測）、以及 Whisper 語音轉文字等功能。

### 核心特性
- 🌐 **純前端運作**：無需後端服務，可完全離線使用
- 📦 **CDN 友善**：支援 ESM/UMD/IIFE 多種載入方式
- 🚀 **硬體加速**：優先使用 WebGPU，自動降級至 WebGL/WASM
- 🔧 **模組化架構**：可彈性組合不同功能模組
- 📊 **診斷系統**：自動偵測環境並提供最佳配置建議

### ⚠️ 重要限制
- **SharedArrayBuffer 需要特殊環境**：必須設定 COOP/COEP HTTP Headers

## 2. 系統架構

```
┌─ WebASR (EventTarget + FSM)
│   .add(AudioQueue) .add(OpenWakeWord) .add(VAD) .add(Whisper)
│   .on('wake_activated' | 'vad_speech_detected' | 'transcribe_done' | ...)
│   .diagnosis()  // 環境偵測與配置建議
│
├─ AudioQueue   : getUserMedia + AudioWorklet (SharedArrayBuffer/RingBuffer)
├─ OpenWakeWord : onnxruntime-web (WebGPU/WebNN/WebGL/WASM)
├─ VAD          : onnxruntime-web + Silero VAD
├─ Whisper      : Transformers.js (支援 WebGPU/WASM)
├─ WebSpeech    : 瀏覽器原生 API
└─ Recorder     : MediaRecorder（循環緩衝最近 20 段）
```

## 3. 狀態機設計 (FSM)

### 狀態定義
```
States:
  idle              → 初始/待機狀態
  requesting_mic    → 請求麥克風權限
  listening         → 監聽中（等待喚醒詞）
  waking           → 喚醒詞觸發
  recording        → 錄音中
  transcribing     → 語音轉文字處理中
  webspeech        → Web Speech API 降級模式
  error            → 錯誤狀態
  paused           → 暫停狀態
  loading          → 模型載入中（來自實作經驗）
```

### 實作經驗：事件驅動狀態管理
```javascript
// 基於實際專案的 FSM 實作模式
class FiniteStateMachine extends EventTarget {
  constructor(initialState) {
    super();
    this.currentState = initialState;
    this.transitions = new Map();
    this.stateHandlers = new Map();
  }
  
  transition(event) {
    const key = `${this.currentState}:${event}`;
    const nextState = this.transitions.get(key);
    
    if (nextState) {
      const prevState = this.currentState;
      this.currentState = nextState;
      
      // 發送狀態變更事件
      this.dispatchEvent(new CustomEvent('state_changed', {
        detail: { from: prevState, to: nextState, event }
      }));
      
      // 執行進入狀態的處理器
      const handler = this.stateHandlers.get(nextState);
      if (handler) handler();
    }
  }
}
```

### 狀態轉換
```typescript
const transitions = {
  idle: {
    START: 'requesting_mic',
    RESET: 'idle'
  },
  requesting_mic: {
    MIC_GRANTED: 'listening',
    MIC_DENIED: 'error',
    MIC_REVOKED: 'requesting_mic'
  },
  listening: {
    WAKE_DETECTED: 'waking',
    PAUSE: 'paused',
    ERROR: 'error'
  },
  waking: {
    VAD_SPEECH: 'recording',
    WAKE_TIMEOUT: 'listening',
    ERROR: 'error'
  },
  recording: {
    VAD_SILENCE: 'transcribing',
    MAX_DURATION: 'transcribing',
    CANCEL: 'listening'
  },
  transcribing: {
    ASR_DONE: 'listening',
    ASR_ERROR: 'error',
    FALLBACK: 'webspeech'
  },
  webspeech: {
    RECOGNITION_DONE: 'listening',
    RECOGNITION_ERROR: 'error',
    CANCEL: 'listening'
  },
  error: {
    RETRY: 'requesting_mic',
    RESET: 'idle',
    DEGRADED_GPU: 'listening'
  },
  paused: {
    RESUME: 'listening',
    RESET: 'idle'
  }
};
```

## 4. API 設計

### 4.1 基礎用法

```javascript
// ESM 載入
import { WebASR, AudioQueue, OpenWakeWord, VAD, Whisper } from 'https://cdn.jsdelivr.net/npm/web-asr@2.0.0/dist/web-asr.esm.js';

// UMD 全域載入
<script src="https://cdn.jsdelivr.net/npm/web-asr@2.0.0/dist/web-asr.umd.js"></script>
```

### 4.2 初始化配置

```javascript
// 實作經驗：集中式配置管理
class ConfigManager {
  constructor() {
    this.config = this.loadConfig();
  }
  
  loadConfig() {
    // 環境偵測（來自 config.js 實作）
    const isGitHubPages = window.location.hostname.includes('github.io');
    const isLocalhost = window.location.hostname === 'localhost' || 
                       window.location.hostname === '127.0.0.1';
    
    return {
      environment: isGitHubPages ? 'github' : (isLocalhost ? 'local' : 'production'),
      modelRegistry: isGitHubPages ? '/models/global_registry_github.json' : 
                                    '/models/global_registry.json',
      // 其他配置...
    };
  }
}

const config = {
  audio: {
    sampleRate: 16000,
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
  wakeword: {
    threshold: 0.5,  // 0-1 範圍
    models: ['hey_jarvis'],
  },
  vad: {
    threshold: 0.6,
    silenceMs: 1500,
    speechMs: 250
  },
  whisper: {
    model: 'Xenova/whisper-tiny.en',
    device: 'auto',  // 'webgpu' | 'wasm' | 'auto'
    streaming: true,
    language: 'en',
    quantized: true  // WASM 使用量化版本
  },
  recorder: {
    maxClips: 20,
    format: 'auto'  // 自動偵測最佳格式
  },
  ringBuffer: {
    overflowPolicy: 'drop-oldest',  // 'drop-oldest' | 'block' | 'backpressure'
    size: 16384
  }
};

// 組裝管線
const asr = new WebASR(config)
  .add(new AudioQueue({ 
    sampleRate: 16000, 
    useSharedArrayBuffer: window.crossOriginIsolated 
  }))
  .add(new VAD({ 
    threshold: 0.6,
    modelPath: '/models/silero_vad.onnx'
  }))
  .add(new Whisper({ 
    model: 'Xenova/whisper-tiny.en',
    device: 'auto'
  }));

if (config.wakeword) {
  asr.add(new OpenWakeWord({ 
    threshold: 0.5,
    modelPath: '/models/hey_jarvis.onnx'
  }));
}
```

### 4.3 事件系統

```javascript
// 核心事件
asr.on('state_changed', (e) => {
  console.log(`State: ${e.detail.from} → ${e.detail.to}`);
});

asr.on('wake_activated', () => {
  console.log('喚醒詞觸發');
});

asr.on('vad_speech_start', () => {
  console.log('偵測到語音開始');
});

asr.on('vad_speech_end', () => {
  console.log('偵測到語音結束');
});

asr.on('transcribe_partial', (e) => {
  console.log('部分結果:', e.detail.text);
});

asr.on('transcribe_done', (e) => {
  console.log('完整結果:', e.detail.text, 'RT Factor:', e.detail.rtFactor);
});

// 效能與錯誤事件
asr.on('model_progress', (e) => {
  console.log(`模型載入進度: ${e.detail.loaded}/${e.detail.total}`);
});

asr.on('buffer_overflow', () => {
  console.warn('音訊緩衝區溢出');
});

asr.on('backpressure', (e) => {
  console.warn('背壓警告:', e.detail.pressure);
});

asr.on('ep_fallback', (e) => {
  console.warn(`執行提供者降級: ${e.detail.from} → ${e.detail.to}`);
});

asr.on('error', (e) => {
  console.error('錯誤:', e.detail.code, e.detail.message);
});
```

## 5. 診斷系統（增強版）

### 5.0 實作經驗：載入管理器
```javascript
// 來自 loading-manager.js 的全螢幕載入體驗
class LoadingManager {
  constructor() {
    this.overlay = null;
    this.loadingSteps = [];
    this.currentStep = 0;
  }
  
  show(message = 'Loading...') {
    if (!this.overlay) {
      this.overlay = document.createElement('div');
      this.overlay.className = 'loading-overlay';
      this.overlay.innerHTML = `
        <div class="loading-container">
          <div class="loading-spinner"></div>
          <div class="loading-message">${message}</div>
          <div class="loading-progress">
            <div class="loading-progress-bar"></div>
          </div>
        </div>
      `;
      document.body.appendChild(this.overlay);
    }
  }
  
  updateProgress(percent, message) {
    if (this.overlay) {
      const progressBar = this.overlay.querySelector('.loading-progress-bar');
      const messageEl = this.overlay.querySelector('.loading-message');
      progressBar.style.width = `${percent}%`;
      messageEl.textContent = message;
    }
  }
  
  hide() {
    if (this.overlay) {
      this.overlay.classList.add('fade-out');
      setTimeout(() => {
        this.overlay?.remove();
        this.overlay = null;
      }, 300);
    }
  }
}

// 模型預載入策略（來自 model-preloader.js）
class ModelPreloader {
  constructor() {
    this.preloadQueue = [];
    this.loadedModels = new Set();
  }
  
  async preloadModels(modelList) {
    // 使用 prefetch 提示瀏覽器預載入
    for (const model of modelList) {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.as = 'fetch';
      link.href = model.url;
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    }
    
    // 實際載入時使用 Cache API
    if ('caches' in window) {
      const cache = await caches.open('models-v1');
      for (const model of modelList) {
        if (!this.loadedModels.has(model.id)) {
          const response = await fetch(model.url);
          await cache.put(model.url, response.clone());
          this.loadedModels.add(model.id);
        }
      }
    }
  }
}
```

## 5. 診斷系統（增強版）

```typescript
interface Diagnosis {
  supported: {
    secureContext: boolean;
    getUserMedia: boolean;
    audioWorklet: boolean;
    sharedArrayBuffer: boolean;
    crossOriginIsolated: boolean;  // 新增
    webgpu: boolean;
    webgl: boolean;
    webnn: boolean;
    webgpuInWorker: boolean;  // 新增
    wasmThreads: boolean;
    wasmSIMD: boolean;
    mediaRecorder: boolean;
    mediaRecorderMimes: string[];  // 新增
    webSpeechRecognition: boolean;
    webSpeechOffline: boolean;  // 新增
    cacheAPI: boolean;
    indexedDB: boolean;
  };
  performance: {
    gpuTier: 'high' | 'medium' | 'low';
    memoryGB: number;
    cpuCores: number;
  };
  recommendation: {
    executionProvider: ('webgpu' | 'webnn' | 'webgl' | 'wasm')[];
    whisperBackend: 'webgpu' | 'wasm';
    transport: 'sab' | 'messageport';
    audioConfig: {
      chunkMs: number;
      bufferSizeFrames: number;
    };
    modelSize: 'tiny' | 'base' | 'small';
    mediaRecorderMime: string;  // 新增
    headersNeeded?: {
      COOP: string;
      COEP: string;
    };
    notes: string[];
    warnings: string[];  // 新增
  };
}
async function detectWasmFeatures() {
  const simd = WebAssembly.validate(
    new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,10,10,1,8,0,65,0,253,98,26,11])
  );
  let threads = false;
  try {
    // 嘗試建立 Shared Memory 以偵測 threads 可用（需 crossOriginIsolated）
    new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
    threads = true;
  } catch {}
  return { wasmSIMD: simd, wasmThreads: threads };
}
function pickAudioMime(): string {
  const candidates = [
    'audio/webm;codecs=opus', // Chromium/Firefox
    'audio/mp4',              // Safari (AAC)
    'audio/mp4;codecs=alac',  // 新的 Safari TP 可錄 ALAC（預覽版）
    'audio/wav'               // 最保守（部分瀏覽器不支援 MediaRecorder 的 wav）
  ];
  for (const m of candidates) {
    if ('MediaRecorder' in self && MediaRecorder.isTypeSupported(m)) return m;
  }
  throw new Error('No supported audio container/codec for MediaRecorder on this browser');
}
// main thread
async function detectWebGPUInWorker(): Promise<boolean> {
  return new Promise((resolve) => {
    const w = new Worker(new URL('./gpu-probe.worker.js', import.meta.url), { type: 'module' });
    const t = setTimeout(() => (w.terminate(), resolve(false)), 1000);
    w.onmessage = (e) => { clearTimeout(t); w.terminate(); resolve(!!e.data?.gpu); };
  });
}

// gpu-probe.worker.js
self.postMessage({ gpu: 'gpu' in self.navigator });

export async function diagnosis(): Promise<Diagnosis> {
  const httpsOK = location.protocol === 'https:' || location.hostname === 'localhost';
  const coiOK   = !!self.crossOriginIsolated;

  const hasSAB  = typeof SharedArrayBuffer !== 'undefined' && coiOK;
  const webgpu  = 'gpu' in navigator;
  const webgl   = !!document.createElement('canvas').getContext('webgl2');
  const webnn   = 'ml' in navigator; // 需安全上下文，主要 Chromium 系
  const webSpeech = ('webkitSpeechRecognition' in self) || ('SpeechRecognition' in self);

  // Worker 內檢查 WebGPU
  const webgpuInWorker = await detectWebGPUInWorker();

  // MediaRecorder mime 協商
  let mrOK = false, mrMime = '';
  try { mrMime = pickAudioMime(); mrOK = !!mrMime; } catch {}

  const { wasmSIMD, wasmThreads } = httpsOK && coiOK ? await detectWasmFeatures() : { wasmSIMD: false, wasmThreads: false };

  return {
    httpsOK,
    crossOriginIsolated: coiOK,
    webgpu, webgpuInWorker, webgl, webnn,
    sharedArrayBuffer: hasSAB,
    wasmSIMD, wasmThreads,
    mediaRecorder: mrOK, mediaRecorderMime: mrMime,
    webSpeechApi: webSpeech,
    // 推薦設定：
    recommended: {
      ep: webgpu ? 'webgpu' : 'wasm',
      dtype: webgpu ? 'fp16' : 'q8',
      useWorkers: true,
      recordMimeType: mrMime || 'audio/webm;codecs=opus',
      caution: !httpsOK ? '需要 HTTPS/localhost 才能用進階功能' :
               !coiOK   ? '請正確設置 COOP/COEP 回應標頭以啟用 SAB/wasm-threads' : ''
    }
  };
}

```

## 6. 核心模組實作

### 6.1 AudioQueue with RingBuffer 政策

#### 實作經驗：音頻管線整合
```javascript
// 來自 audio-pipeline-integration.js 的實戰經驗
class AudioPipelineIntegration {
  constructor() {
    this.audioContext = null;
    this.source = null;
    this.workletNode = null;
  }
  
  async initialize(stream) {
    // 處理瀏覽器相容性（來自 audio-compatibility-manager.js）
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.audioContext = new AudioContextClass({ sampleRate: 16000 });
    
    // 處理 Safari 的 AudioContext 限制
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
    
    // 載入 AudioWorklet
    try {
      await this.audioContext.audioWorklet.addModule('/js/worklets/audio-processor.worklet.js');
    } catch (error) {
      console.warn('AudioWorklet 載入失敗，降級至 ScriptProcessor');
      return this.fallbackToScriptProcessor(stream);
    }
    
    this.source = this.audioContext.createMediaStreamSource(stream);
    this.workletNode = new AudioWorkletNode(this.audioContext, 'audio-processor', {
      processorOptions: {
        bufferSize: 1280,  // 80ms at 16kHz
        targetSampleRate: 16000
      }
    });
    
    // 連接音頻圖
    this.source.connect(this.workletNode);
    
    // 處理來自 worklet 的資料
    this.workletNode.port.onmessage = (event) => {
      if (event.data.type === 'audio') {
        this.handleAudioData(event.data.buffer);
      }
    };
  }
  
  fallbackToScriptProcessor(stream) {
    // ScriptProcessor 降級方案（已棄用但相容性較好）
    const bufferSize = 4096;
    const processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
    
    processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      this.handleAudioData(inputData);
    };
    
    this.source = this.audioContext.createMediaStreamSource(stream);
    this.source.connect(processor);
    processor.connect(this.audioContext.destination);
  }
}
```

```javascript
class AudioQueue extends EventTarget {
  private ringBuffer?: RingBuffer;
  private overflowPolicy: 'drop-oldest' | 'block' | 'backpressure';
  
  constructor(options: AudioQueueOptions) {
    super();
    this.overflowPolicy = options.overflowPolicy || 'drop-oldest';
  }
  
  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 48000,  // 請求值
        echoCancellation: true,
        noiseSuppression: true
      }
    });
    
    const ctx = new AudioContext();
    const actualSampleRate = ctx.sampleRate;  // 實際值
    
    this.resampler.configure({ 
      from: actualSampleRate, 
      to: 16000 
    });
    
    if (window.crossOriginIsolated) {
      // SAB 路徑
      const sab = new SharedArrayBuffer(this.options.size || 16384);
      this.ringBuffer = new RingBuffer(sab, Float32Array);
    } else {
      // MessagePort 降級
      console.warn('SharedArrayBuffer 不可用，降級至 MessagePort');
    }
  }
  
  private handleOverflow(dataSize: number) {
    switch (this.overflowPolicy) {
      case 'drop-oldest':
        const framesToDrop = Math.ceil(dataSize / this.frameSize);
        this.ringBuffer.dropFrames(framesToDrop);
        this.emit('buffer_overflow', { dropped: framesToDrop });
        break;
        
      case 'block':
        // 等待空間釋放
        return false;
        
      case 'backpressure':
        // 發出背壓訊號
        this.emit('back_pressure', { 
          pressure: this.ringBuffer.usage(),
          recommendation: 'reduce_rate' 
        });
        break;
    }
    return true;
  }
}
```

### 6.2 OpenWakeWord with EP 回退

#### 實作經驗：Worker 整合模式
```javascript
// 來自 worker-integrated-wakeword.js 的實戰模式
class WorkerIntegratedWakeWord {
  constructor() {
    this.worker = null;
    this.modelLoaded = false;
  }
  
  async initialize() {
    // 建立 Worker
    this.worker = new Worker('/js/workers/ml-inference.worker.js', { type: 'module' });
    
    // Worker 訊息處理模式
    return new Promise((resolve, reject) => {
      const messageHandler = (event) => {
        const { type, data, error } = event.data;
        
        switch (type) {
          case 'model-loaded':
            this.modelLoaded = true;
            resolve();
            break;
            
          case 'inference-result':
            this.handleDetection(data);
            break;
            
          case 'error':
            console.error('Worker error:', error);
            reject(error);
            break;
        }
      };
      
      this.worker.addEventListener('message', messageHandler);
      
      // 載入模型
      this.worker.postMessage({
        type: 'load-model',
        modelPath: '/models/hey_jarvis_v0.1.onnx',
        options: {
          executionProvider: this.selectBestProvider()
        }
      });
    });
  }
  
  selectBestProvider() {
    // 實戰經驗：執行提供者選擇策略
    if ('gpu' in navigator) {
      // 檢查 WebGPU 支援
      return { name: 'webgpu', deviceType: 'gpu' };
    } else if (document.createElement('canvas').getContext('webgl2')) {
      // WebGL 降級
      return { name: 'webgl' };
    } else {
      // WASM 最終降級
      return { name: 'wasm', numThreads: navigator.hardwareConcurrency || 4 };
    }
  }
}
```

```javascript
class OpenWakeWord extends EventTarget {
  private session?: ort.InferenceSession;
  private currentEP?: string;
  
  async init() {
    const providers = this.selectProviders();
    
    for (const provider of providers) {
      try {
        this.session = await ort.InferenceSession.create(
          this.options.modelPath,
          {
            executionProviders: [provider],
            graphOptimizationLevel: 'all'
          }
        );
        this.currentEP = provider;
        console.log(`OpenWakeWord 使用 ${provider}`);
        break;
      } catch (err) {
        console.warn(`${provider} 初始化失敗，嘗試下一個`, err);
        this.emit('ep_fallback', { 
          from: provider, 
          to: providers[providers.indexOf(provider) + 1],
          reason: err.message 
        });
      }
    }
    
    if (!this.session) {
      throw new Error('所有執行提供者都失敗');
    }
  }
  
  private selectProviders(): string[] {
    const providers = [];
    
    // WebGPU
    if ((navigator as any).gpu) {
      providers.push('webgpu');
    }
    
    // WebNN (實驗性，容易失敗)
    if ('ml' in navigator) {
      providers.push('webnn');
    }
    
    // WebGL
    if (document.createElement('canvas').getContext('webgl2')) {
      providers.push('webgl');
    }
    
    // WASM (最後備援)
    providers.push('wasm');
    
    return providers;
  }
  
  dispose() {
    if (this.session && typeof this.session.release === 'function') {
      this.session.release();
    }
    this.session = null;
  }
}
```

### 6.3 Whisper 標準化配置

#### 實作經驗：雙引擎管理
```javascript
// 來自 speech-recognition-manager.js 的雙引擎模式
class SpeechRecognitionManager {
  constructor() {
    this.currentEngine = null;
    this.engines = new Map();
  }
  
  async initialize() {
    // 註冊可用引擎
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const WebSpeechEngine = (await import('/js/modules/engines/webspeech-engine.js')).default;
      this.engines.set('webspeech', new WebSpeechEngine());
    }
    
    // Whisper 引擎
    const WhisperEngine = (await import('/js/modules/engines/whisper-engine.js')).default;
    this.engines.set('whisper', new WhisperEngine());
    
    // 選擇最佳引擎
    this.selectEngine();
  }
  
  selectEngine() {
    // 實戰策略：根據環境選擇引擎
    const isOnline = navigator.onLine;
    const hasWebSpeech = this.engines.has('webspeech');
    
    if (isOnline && hasWebSpeech) {
      // 線上優先使用 Web Speech API（更快）
      this.currentEngine = this.engines.get('webspeech');
    } else {
      // 離線或無 Web Speech 使用 Whisper
      this.currentEngine = this.engines.get('whisper');
    }
    
    // 監聽線上狀態變化
    window.addEventListener('online', () => this.selectEngine());
    window.addEventListener('offline', () => this.selectEngine());
  }
  
  async transcribe(audioData) {
    try {
      return await this.currentEngine.transcribe(audioData);
    } catch (error) {
      // 引擎失敗時自動切換
      console.warn('Engine failed, switching...', error);
      this.switchEngine();
      return await this.currentEngine.transcribe(audioData);
    }
  }
  
  switchEngine() {
    const engines = Array.from(this.engines.values());
    const currentIndex = engines.indexOf(this.currentEngine);
    const nextIndex = (currentIndex + 1) % engines.length;
    this.currentEngine = engines[nextIndex];
  }
}
```

```javascript
class Whisper extends EventTarget {
  private pipeline?: any;
  
  async init() {
    const { pipeline, env } = await import('@xenova/transformers');
    
    // 啟用瀏覽器快取（File System / Cache API；依環境而定）
    env.useCache = true;
    
    // 可選：自訂 IndexedDB 快取（需實作 Cache API 介面）
    if (this.options.customCache) {
      env.useCustomCache = true;
      env.customCache = this.options.customCache;
    }
    // 裝置選擇
    const device = this.options.device === 'auto' ? 
      ((navigator as any).gpu ? 'webgpu' : 'wasm') : 
      this.options.device;
    // dtype 策略：
    // - WebGPU: 自動選擇（可能是 fp32/fp16 依裝置）
    // - WASM: 優先使用量化版本以提升效能
    const dtype = device === 'webgpu' ? 'fp16' : 'q8' || this.options.dtype;
    // 建立管線，根據裝置自動選擇最佳配置
    this.pipeline = await pipeline(
      'automatic-speech-recognition',
      this.options.model,
      {
        device: device,
        dtype: dtype,
        // 進度回調
        progress_callback: (progress) => {
          this.emit('model_progress', progress);
        }
        // 可傳 session_options 進 ORT
      }
    );
    
    // 串流器配置
    if (this.options.streaming) {
      const { WhisperTextStreamer } = await import('@xenova/transformers');
      this.streamer = new WhisperTextStreamer({
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (text) => {
          this.emit('transcribe_partial', { text });
        }
      });
    }
  }
  
  dispose() {
    // 使用官方提供的 dispose 方法
    this.pipeline?.dispose();
  }
}
```

## 7. 部署要求

### 7.0 實作經驗：模型註冊系統
```javascript
// 來自 global_registry.json 的動態模型管理
class ModelRegistry {
  constructor() {
    this.registry = null;
    this.modelCache = new Map();
  }
  
  async loadRegistry() {
    // 根據環境載入不同的註冊表
    const isGitHubPages = window.location.hostname.includes('github.io');
    const registryPath = isGitHubPages ? 
      '/models/global_registry_github.json' : 
      '/models/global_registry.json';
    
    const response = await fetch(registryPath);
    this.registry = await response.json();
    
    return this.registry;
  }
  
  getModelConfig(modelType, modelName) {
    // 從註冊表獲取模型配置
    const models = this.registry[modelType];
    if (!models) throw new Error(`Unknown model type: ${modelType}`);
    
    const config = models[modelName];
    if (!config) throw new Error(`Unknown model: ${modelName}`);
    
    // 處理不同來源
    switch (config.source) {
      case 'huggingface':
        return {
          ...config,
          url: `https://huggingface.co/${config.repo}/resolve/main/${config.file}`
        };
        
      case 'github':
        return {
          ...config,
          url: config.url  // 直接使用 GitHub 託管的 URL
        };
        
      case 'local':
        return {
          ...config,
          url: `/models/${config.file}`
        };
        
      default:
        return config;
    }
  }
  
  async downloadModel(modelType, modelName, progressCallback) {
    const config = this.getModelConfig(modelType, modelName);
    
    // 檢查快取
    if (this.modelCache.has(config.url)) {
      return this.modelCache.get(config.url);
    }
    
    // 下載模型
    const response = await fetch(config.url);
    const contentLength = response.headers.get('content-length');
    
    if (contentLength && progressCallback) {
      // 支援進度回調
      const reader = response.body.getReader();
      const chunks = [];
      let receivedLength = 0;
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        chunks.push(value);
        receivedLength += value.length;
        
        progressCallback({
          loaded: receivedLength,
          total: parseInt(contentLength),
          percent: (receivedLength / parseInt(contentLength)) * 100
        });
      }
      
      const blob = new Blob(chunks);
      const arrayBuffer = await blob.arrayBuffer();
      
      // 快取模型
      this.modelCache.set(config.url, arrayBuffer);
      
      return arrayBuffer;
    } else {
      // 簡單下載
      const arrayBuffer = await response.arrayBuffer();
      this.modelCache.set(config.url, arrayBuffer);
      return arrayBuffer;
    }
  }
}
```

## 7. 部署要求

### 7.1 HTTP 標頭配置（各平台指南）

#### Nginx
```nginx
# 必須在 HTTP Response 設定，meta tags 無效！
add_header Cross-Origin-Opener-Policy "same-origin";
add_header Cross-Origin-Embedder-Policy "require-corp";
add_header Cross-Origin-Resource-Policy "cross-origin";
```

#### Apache
```apache
Header set Cross-Origin-Opener-Policy "same-origin"
Header set Cross-Origin-Embedder-Policy "require-corp" 
Header set Cross-Origin-Resource-Policy "cross-origin"
```

#### Cloudflare Workers
```javascript
export default {
  async fetch(request, env) {
    const response = await fetch(request);
    const newHeaders = new Headers(response.headers);
    
    newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
    newHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
    
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    });
  }
};
```

#### Vercel
```javascript
// vercel.json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Cross-Origin-Opener-Policy",
          "value": "same-origin"
        },
        {
          "key": "Cross-Origin-Embedder-Policy",
          "value": "require-corp"
        }
      ]
    }
  ]
}
```

#### Netlify
```toml
# netlify.toml
[[headers]]
  for = "/*"
  [headers.values]
    Cross-Origin-Opener-Policy = "same-origin"
    Cross-Origin-Embedder-Policy = "require-corp"
```

### 7.2 MediaRecorder 格式偵測

```javascript
class Recorder {
  private getMimeType(): string {
    const formats = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus'
    ];
    
    for (const format of formats) {
      if (MediaRecorder.isTypeSupported(format)) {
        return format;
      }
    }
    
    // 無支援格式（如 iOS Safari < 14.3）
    console.warn('MediaRecorder 不支援標準格式，使用 PCM fallback');
    return '';
  }
  
  start(stream: MediaStream) {
    const mimeType = this.getMimeType();
    
    if (!mimeType) {
      // 使用 AudioWorklet 直接錄製 PCM
      this.usePCMFallback(stream);
      return;
    }
    
    this.recorder = new MediaRecorder(stream, { mimeType });
  }
}
```

## 8. 記憶體管理

```javascript
class MemoryManager {
  private readonly MAX_BUFFER_AGE = 5 * 60 * 1000;  // 5 分鐘
  private readonly CHECK_INTERVAL = 60 * 1000;      // 每分鐘
  
  start() {
    setInterval(() => this.cleanup(), this.CHECK_INTERVAL);
  }
  
  private cleanup() {
    const now = Date.now();
    
    // 清理過期緩衝區
    this.buffers.forEach((buffer, id) => {
      if (now - buffer.timestamp > this.MAX_BUFFER_AGE) {
        this.buffers.delete(id);
      }
    });
    
    // 釋放 Blob URLs
    this.blobUrls.forEach(url => {
      if (now - url.timestamp > this.MAX_BUFFER_AGE) {
        URL.revokeObjectURL(url.url);
      }
    });
    
    // 檢查記憶體壓力（Chrome only）
    if ((performance as any).memory?.usedJSHeapSize > 500 * 1024 * 1024) {
      console.warn('記憶體使用過高，執行緊急清理');
      this.emergencyCleanup();
    }
  }
}
```

## 9. 完整使用範例

### 9.0 實作經驗：批次模式處理
```javascript
// 來自實際專案的雙模式支援
class DualModeProcessor {
  constructor() {
    this.mode = 'streaming';  // 'streaming' | 'batch'
    this.batchQueue = [];
  }
  
  setMode(mode) {
    this.mode = mode;
    this.emit('mode_changed', { mode });
  }
  
  // 串流模式：即時處理
  processStreaming(audioChunk) {
    // 立即處理每個音頻塊
    this.wakewordDetector.process(audioChunk);
    this.vadDetector.process(audioChunk);
    
    if (this.isRecording) {
      this.audioBuffer.push(audioChunk);
    }
  }
  
  // 批次模式：檔案上傳或錄音
  async processBatch(audioFile) {
    // 解碼音頻檔案
    const audioBuffer = await this.decodeAudioFile(audioFile);
    
    // 分割成塊進行處理
    const chunkSize = 16000 * 30;  // 30 秒塊
    const chunks = this.splitAudioBuffer(audioBuffer, chunkSize);
    
    const results = [];
    for (const chunk of chunks) {
      const result = await this.transcribeChunk(chunk);
      results.push(result);
      
      // 更新進度
      this.emit('batch_progress', {
        current: results.length,
        total: chunks.length,
        percent: (results.length / chunks.length) * 100
      });
    }
    
    return this.mergeResults(results);
  }
  
  async decodeAudioFile(file) {
    // 使用 Web Audio API 解碼
    const arrayBuffer = await file.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    // 轉換為 16kHz 單聲道
    const targetSampleRate = 16000;
    const resampled = this.resampleAudioBuffer(audioBuffer, targetSampleRate);
    
    return resampled;
  }
}
```

## 9. 完整使用範例

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>WebASR Demo</title>
  <!-- 
    重要：COOP/COEP 必須由 HTTP Response Headers 設定
    不能使用 meta tags！請在伺服器端設定：
    
    # 強隔離（最嚴）
    Cross-Origin-Opener-Policy: same-origin
    Cross-Origin-Embedder-Policy: require-corp

    # 或：credentialless 變體（對不帶憑證的跨域資源較寬鬆）
    Cross-Origin-Opener-Policy: same-origin
    Cross-Origin-Embedder-Policy: credentialless
  -->
</head>
<body>
  <div id="status">檢測環境中...</div>
  <button id="start" disabled>開始</button>
  <div id="result"></div>
  
  <script type="module">
    import { WebASR, AudioQueue, VAD, Whisper } from './web-asr.esm.js';
    
    // 診斷環境
    const diagnosis = await WebASR.diagnosis();
    
    if (!diagnosis.supported.secureContext) {
      document.getElementById('status').textContent = '需要 HTTPS';
      throw new Error('需要 HTTPS');
    }
    if (!self.crossOriginIsolated) {
      throw new Error('SharedArrayBuffer/wasm-threads 不可用：請正確設置 COOP/COEP 回應標頭');
    }
    
    // 配置
    const config = {
      audio: {
        sampleRate: 16000,
        useSharedArrayBuffer: diagnosis.supported.sharedArrayBuffer,
        overflowPolicy: 'backpressure'
      },
      vad: {
        threshold: 0.6
      },
      whisper: {
        device: diagnosis.recommendation.whisperBackend,
        model: 'Xenova/whisper-tiny.en',
        streaming: true,
        quantized: diagnosis.recommendation.whisperBackend === 'wasm'
      }
    };
    
    // 建立管線
    const asr = new WebASR(config)
      .add(new AudioQueue(config.audio))
      .add(new VAD(config.vad))
      .add(new Whisper(config.whisper));
    
    // 事件處理
    asr.on('state_changed', (e) => {
      document.getElementById('status').textContent = `狀態: ${e.detail.to}`;
    });
    
    asr.on('vad_speech_start', () => {
      document.getElementById('status').textContent = '聆聽中...';
    });
    
    asr.on('transcribe_partial', (e) => {
      document.getElementById('result').textContent = e.detail.text + '...';
    });
    
    asr.on('transcribe_done', (e) => {
      document.getElementById('result').textContent = e.detail.text;
      console.log('RT Factor:', e.detail.rtFactor);
    });
    
    asr.on('backpressure', (e) => {
      console.warn('背壓警告:', e.detail);
    });
    
    asr.on('ep_fallback', (e) => {
      console.log(`執行提供者降級: ${e.detail.from} → ${e.detail.to}`);
    });
    
    asr.on('error', (e) => {
      console.error('錯誤:', e.detail);
      document.getElementById('status').textContent = `錯誤: ${e.detail.message}`;
    });
    
    // 啟動
    document.getElementById('start').onclick = async () => {
      await asr.start();
    };
    
    // 環境就緒
    document.getElementById('start').disabled = false;
    document.getElementById('status').textContent = '準備就緒';
  </script>
</body>
</html>
```

## 10. 效能基準

| 模型         | 裝置               | 後端   | RT Factor | 延遲  | 備註   |
| ------------ | ------------------ | ------ | --------- | ----- | ------ |
| Whisper Tiny | Desktop (RTX 3060) | WebGPU | 0.05      | 50ms  | 最佳   |
| Whisper Tiny | Desktop (i7-12700) | WASM   | 0.3       | 300ms | 量化版 |
| Whisper Base | Mobile (SD 888)    | WASM   | 0.8       | 800ms | 可接受 |
| Silero VAD   | All                | WASM   | 0.01      | 10ms  | 極快   |
| OpenWakeWord | Desktop            | WebGPU | 0.03      | 30ms  | 極快 |

## 11. 已知限制與解決方案

| 問題                     | 影響                       | 解決方案                              |
| ------------------------ | -------------------------- | ------------------------------------- |
| COOP/COEP 配置           | 無法使用 SharedArrayBuffer | 必須設定 HTTP Headers（非 meta tags） |
| iOS Safari MediaRecorder | 錄音功能受限               | 使用 PCM fallback 或 polyfill         |
| Firefox WebGPU           | 需手動開啟                 | 自動降級至 WebGL/WASM                 |

## 12. FAQ

### 實作經驗補充問答

### Q: 如何處理不同瀏覽器的 AudioContext 採樣率差異？
**A:** 實作經驗顯示需要動態重採樣：
```javascript
// 來自實際專案
class AudioResampler {
  resample(inputBuffer, targetRate) {
    const inputRate = inputBuffer.sampleRate;
    if (inputRate === targetRate) return inputBuffer;
    
    const ratio = targetRate / inputRate;
    const outputLength = Math.round(inputBuffer.length * ratio);
    const output = new Float32Array(outputLength);
    
    // 線性插值重採樣
    for (let i = 0; i < outputLength; i++) {
      const inputIndex = i / ratio;
      const index = Math.floor(inputIndex);
      const fraction = inputIndex - index;
      
      if (index + 1 < inputBuffer.length) {
        output[i] = inputBuffer[index] * (1 - fraction) + 
                   inputBuffer[index + 1] * fraction;
      } else {
        output[i] = inputBuffer[index];
      }
    }
    
    return output;
  }
}
```

### Q: 如何優化模型載入速度？
**A:** 使用多層快取策略：
1. **Prefetch**: 在頁面載入時預取模型
2. **Cache API**: 持久化儲存模型
3. **IndexedDB**: 大型模型的備用儲存
4. **量化模型**: GitHub Pages 使用量化版本

### Q: 如何處理 VAD 的誤觸發？
**A:** 實作經驗建議使用多重驗證：
```javascript
// 來自 vad.js 的實戰策略
class EnhancedVAD {
  constructor() {
    this.speechFrames = 0;
    this.silenceFrames = 0;
    this.minSpeechFrames = 3;  // 最少 3 幀才確認語音
    this.maxSilenceFrames = 12;  // 12 幀靜音才結束
  }
  
  process(audioFrame) {
    const isSpeech = this.detector.detect(audioFrame);
    
    if (isSpeech) {
      this.speechFrames++;
      this.silenceFrames = 0;
      
      if (this.speechFrames >= this.minSpeechFrames && !this.isSpeaking) {
        this.isSpeaking = true;
        this.emit('speech_start');
      }
    } else {
      this.silenceFrames++;
      
      if (this.silenceFrames >= this.maxSilenceFrames && this.isSpeaking) {
        this.isSpeaking = false;
        this.speechFrames = 0;
        this.emit('speech_end');
      }
    }
  }
}
```

## 12. FAQ

### Q: 為什麼 SharedArrayBuffer 不可用？
**A:** 需要在 HTTP Response Headers 設定 COOP/COEP，meta tags 無效。參考 7.1 節各平台設定。

### Q: 如何選擇 Whisper 模型大小？
**A:** 
- **Tiny (39MB)**: 行動裝置、即時應用
- **Base (74MB)**: 桌面、較高精度需求
- **Small (244MB)**: 高精度、非即時應用

### Q: MediaRecorder 在 Safari 不支援怎麼辦？
**A:** 使用 `getMimeType()` 自動偵測，降級至 PCM 直接錄製或使用 polyfill。

## 13. 授權

MIT License

## 參考資料

- [ONNX Runtime Web](https://onnxruntime.ai/docs/get-started/with-javascript.html)
- [Transformers.js](https://huggingface.co/docs/transformers.js)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [SharedArrayBuffer & Cross-Origin Isolation](https://web.dev/cross-origin-isolation-guide/)
- [OpenWakeWord (原始 Python 版)](https://github.com/dscripka/openWakeWord)