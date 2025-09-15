/**
 * ONNX Runtime Web Worker for Model Inference
 * 
 * 執行 VAD 和喚醒詞模型推理的 Web Worker，支援 WebGPU 加速
 */

// 檢查 Worker 模式和 WebGPU 支援
console.log('[Worker] Starting initialization...');

// 更準確的模式偵測
const isModuleWorker = (() => {
  try {
    // 在 module worker 中，importScripts 會拋出錯誤
    if (typeof importScripts === 'function') {
      // 嘗試載入一個空的 data URL 來測試
      importScripts('data:text/javascript,');
      return false; // 成功 = classic worker
    }
    return true; // 沒有 importScripts = module worker
  } catch (e) {
    // 如果拋出 "Module scripts don't support importScripts" 錯誤
    return String(e).includes("Module scripts don't support importScripts");
  }
})();

console.log('[Worker] Worker type check:', {
  isModuleWorker,
  hasImportScripts: typeof importScripts === 'function',
  hasWebGPU: !!(self.navigator as any)?.gpu,
  workerType: isModuleWorker ? 'MODULE' : 'CLASSIC'
});

// 在 Worker 中載入 ONNX Runtime
declare const importScripts: any;
declare namespace ort {
  class Tensor {
    constructor(type: string, data: any, shape: number[]);
    data: any;
  }
  class InferenceSession {
    static create(path: string, options: any): Promise<InferenceSession>;
    run(feeds: any): Promise<any>;
  }
  interface ExecutionProviderConfig {
    name: string;
    [key: string]: any;
  }
  const env: {
    wasm: {
      simd: boolean;
      numThreads: number;
      wasmPaths: string;
    };
    webgpu: {
      powerPreference: string;
    };
  };
}

// 載入 ONNX Runtime - 優先使用 node_modules，CDN 作為備案
// Worker 中的路徑是相對於 Worker 檔案位置 (dist/workers/)
try {
  // 嘗試從 node_modules 載入 (相對於根目錄)
  importScripts('../../node_modules/onnxruntime-web/dist/ort.min.js');
  console.log('[Worker] ONNX Runtime loaded from node_modules');
} catch (e) {
  // 如果 node_modules 載入失敗，使用 CDN 作為備案
  console.log('[Worker] Loading ONNX Runtime from CDN (node_modules not available)');
  importScripts('https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js');
}

interface ModelConfig {
  modelPath: string;
  executionProviders: string[];
  webgpuOptions?: {
    powerPreference?: 'default' | 'low-power' | 'high-performance';
  };
  wasmOptions?: {
    simd?: boolean;
    numThreads?: number;
  };
}

interface InferenceRequest {
  id: string;
  type: 'vad' | 'wakeword';
  modelName: string;
  inputData: Float32Array;
  config?: ModelConfig;
}

interface InferenceResponse {
  id: string;
  type: 'vad' | 'wakeword';
  result: any;
  error?: string;
  executionTime?: number;
  provider?: string;
}

/**
 * Worker 事件橋接器
 * 
 * @description 負責將 Worker 內部的事件轉發到主執行緒
 */
class WorkerEventBridge {
  /**
   * 發送事件到主執行緒
   */
  static emitEvent(eventType: string, detail: any): void {
    self.postMessage({
      type: 'event',
      event: eventType,
      detail: detail,
      timestamp: Date.now()
    });
  }
  
  /**
   * 發送處理錯誤事件
   */
  static emitError(error: Error, context: string): void {
    this.emitEvent('processing-error', {
      error: {
        message: error.message,
        stack: error.stack
      },
      context: `worker:${context}`
    });
  }
}

class ONNXInferenceWorker {
  private sessions: Map<string, ort.InferenceSession> = new Map();
  private vadStates: Map<string, Float32Array> = new Map();  // 保存 VAD LSTM 狀態
  private vadActiveStates: Map<string, boolean> = new Map();  // 保存 VAD 活動狀態
  private isWebGPUAvailable = false;

  constructor() {
    this.initialize();
  }

  private isVadActive(sessionKey: string): boolean {
    return this.vadActiveStates.get(sessionKey) || false;
  }

  private setVadActive(sessionKey: string, active: boolean): void {
    this.vadActiveStates.set(sessionKey, active);
  }

  private async initialize() {
    // 檢查 WebGPU 支援
    try {
      const hasGPU = !!(self.navigator as any)?.gpu;
      if (hasGPU) {
        // Windows 平台不傳遞 powerPreference 以避免警告
        const isWin = (self.navigator as any).userAgent?.includes('Windows');
        const opts = isWin ? {} : { powerPreference: 'high-performance' as const };
        const adapter = await (self.navigator as any).gpu.requestAdapter(opts);
        if (adapter) {
          this.isWebGPUAvailable = true;
          console.log('[ONNX Worker] WebGPU is available:', (adapter as any)?.name || 'adapter');
        }
      }
    } catch (error) {
      console.log('[ONNX Worker] WebGPU not available:', error);
    }

    // 配置 ONNX Runtime
    ort.env.wasm.simd = true;
    ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;
    // Windows 平台不設置 powerPreference 以避免警告
    const isWin = (self.navigator as any).userAgent?.includes('Windows');
    if (!isWin) {
      ort.env.webgpu.powerPreference = 'high-performance';
    }
    
    // 設置 WASM 路徑 - 優先使用 node_modules
    // 檢查是否可以使用本地路徑
    try {
      // 嘗試檢查本地路徑是否可用
      const testFetch = await fetch('../../node_modules/onnxruntime-web/dist/ort-wasm.wasm', { method: 'HEAD' });
      if (testFetch.ok) {
        ort.env.wasm.wasmPaths = '../../node_modules/onnxruntime-web/dist/';
        console.log('[ONNX Worker] Using local WASM files from node_modules');
      } else {
        throw new Error('Local WASM not available');
      }
    } catch (e) {
      // 使用 CDN 作為備案
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
      console.log('[ONNX Worker] Using CDN for WASM files');
    }

    self.postMessage({ 
      type: 'initialized', 
      data: { webgpuAvailable: this.isWebGPUAvailable }
    });
  }

  private async loadModel(modelName: string, config: ModelConfig): Promise<ort.InferenceSession> {
    const cacheKey = `${modelName}_${JSON.stringify(config.executionProviders)}`;
    
    // 檢查快取
    if (this.sessions.has(cacheKey)) {
      return this.sessions.get(cacheKey)!;
    }

    console.log(`[ONNX Worker] Loading model: ${modelName}`);
    
    // 準備執行提供者選項
    const executionProviders: ort.ExecutionProviderConfig[] = [];
    
    console.log(`[ONNX Worker] WebGPU available: ${this.isWebGPUAvailable}, Requested providers:`, config.executionProviders);
    
    for (const provider of config.executionProviders) {
      if (provider === 'webgpu' && this.isWebGPUAvailable) {
        console.log('[ONNX Worker] Adding WebGPU provider');
        executionProviders.push({
          name: 'webgpu',
          ...config.webgpuOptions
        });
      } else if (provider === 'wasm') {
        console.log('[ONNX Worker] Adding WASM provider');
        executionProviders.push({
          name: 'wasm',
          ...config.wasmOptions
        });
      }
    }

    // 如果沒有可用的提供者，使用預設 WASM
    if (executionProviders.length === 0) {
      executionProviders.push({ name: 'wasm' });
    }

    try {
      // 先嘗試直接載入，如果失敗則使用 ArrayBuffer
      let session: ort.InferenceSession;
      
      // 修正路徑 - Worker 在 /dist/workers/ 下執行，需要調整相對路徑
      let modelUrl = config.modelPath;
      
      // 如果是相對路徑，需要調整為從根目錄開始
      if (modelUrl.startsWith('models/') || modelUrl.startsWith('./models/')) {
        // 去掉 ./ 前綴（如果有）
        modelUrl = modelUrl.replace(/^\.\//, '');
        // 添加 /../../ 來從 /dist/workers/ 返回到根目錄
        modelUrl = `/../../${modelUrl}`;
      }
      
      try {
        // 嘗試直接從路徑載入
        session = await ort.InferenceSession.create(
          modelUrl,
          { executionProviders }
        );
      } catch (pathError: any) {
        // 如果是外部數據文件錯誤，嘗試使用 ArrayBuffer
        if (pathError.message?.includes('external data file')) {
          console.log(`[ONNX Worker] Path loading failed, trying ArrayBuffer for ${modelName}`);
          const response = await fetch(modelUrl);
          if (!response.ok) {
            throw new Error(`Failed to fetch model: ${response.status}`);
          }
          const modelBuffer = await response.arrayBuffer();
          // ONNX Runtime accepts ArrayBuffer directly for binary model data
          session = await ort.InferenceSession.create(
            modelBuffer as any,  // Type assertion needed as ONNX Runtime types may be incomplete
            { executionProviders }
          );
        } else {
          throw pathError;
        }
      }
      
      this.sessions.set(cacheKey, session);
      console.log(`[ONNX Worker] Model loaded successfully: ${modelName}`);
      
      return session;
    } catch (error) {
      console.error(`[ONNX Worker] Failed to load model:`, error);
      throw error;
    }
  }

  private async runVADInference(
    session: ort.InferenceSession,
    inputData: Float32Array,
    sessionKey: string = 'default'
  ): Promise<any> {
    // Silero VAD v6 模型需要三個輸入：
    // 1. input: [1, 576] - 音訊數據（64 context + 512 new samples）
    // 2. state: [2, 1, 128] - LSTM 狀態
    // 3. sr: [1] - 採樣率 (16000)
    
    // 獲取或創建 LSTM 狀態
    let stateData = this.vadStates.get(sessionKey);
    const wasActive = stateData ? this.isVadActive(sessionKey) : false;
    
    if (!stateData) {
      stateData = new Float32Array(2 * 1 * 128);  // 零初始化
      this.vadStates.set(sessionKey, stateData);
    }
    
    const state = new ort.Tensor('float32', stateData, [2, 1, 128]);
    
    // 創建採樣率張量
    const sr = new ort.Tensor('int64', BigInt64Array.from([16000n]), [1]);
    
    const feeds: Record<string, ort.Tensor> = {
      'input': new ort.Tensor('float32', inputData, [1, inputData.length]),
      'state': state,
      'sr': sr
    };

    const results = await session.run(feeds);
    
    // 調試：列出所有輸出鍵
    // console.log(`[ONNX Worker] VAD model outputs:`, Object.keys(results));
    
    // 更新 LSTM 狀態供下次使用
    const newState = results['state_out'] || results['stateN'] || results['state'];
    if (newState && newState.data) {
      const newStateData = new Float32Array(newState.data as Float32Array);
      this.vadStates.set(sessionKey, newStateData);
    }
    
    // 提取輸出 - Silero VAD 的輸出鍵可能是 'output' 或其他
    const output = results['output'] || results['21'] || results[Object.keys(results)[0]];
    if (!output || !output.data) {
      console.error('[ONNX Worker] No valid output from VAD model');
      return { isSpeech: false, probability: 0 };
    }
    
    const probability = output.data[0] as number;
    
    const threshold = 0.15;  // 進一步降低閾值
    const isSpeech = probability > threshold;
    
    // 發出語音狀態變更事件
    if (!wasActive && isSpeech) {
      WorkerEventBridge.emitEvent('speech-start', {
        timestamp: Date.now(),
        probability: probability
      });
    } else if (wasActive && !isSpeech) {
      WorkerEventBridge.emitEvent('speech-end', {
        timestamp: Date.now(),
        probability: probability
      });
    }
    
    // 保存當前狀態供下次比較
    this.setVadActive(sessionKey, isSpeech);
    
    // 總是輸出調試資訊以便觀察
    // console.log(`[ONNX Worker] VAD: probability=${probability.toFixed(4)}, threshold=${threshold}, isSpeech=${isSpeech}, inputLength=${inputData.length}`);
    
    // 檢查輸入數據的統計信息
    const maxVal = Math.max(...inputData);
    const minVal = Math.min(...inputData);
    const avgVal = inputData.reduce((a, b) => a + Math.abs(b), 0) / inputData.length;
    
    if (avgVal > 0.001) {  // 只在有音訊時輸出
      // console.log(`[ONNX Worker] Audio stats: max=${maxVal.toFixed(4)}, min=${minVal.toFixed(4)}, avg=${avgVal.toFixed(6)}`);
    }
    
    return {
      isSpeech: isSpeech,
      probability: probability
    };
  }

  private async runWakeWordInference(
    session: ort.InferenceSession,
    inputData: Float32Array,
    modelName: string = 'unknown'
  ): Promise<any> {
    // 判斷輸入數據的格式
    // 如果 inputData 長度是 96 的倍數，則可能是 embedding tensor [T, D]
    // 否則可能是原始音訊數據
    let feeds: Record<string, ort.Tensor>;
    
    const embeddingDim = 96;
    const isEmbeddingTensor = inputData.length % embeddingDim === 0 && inputData.length >= embeddingDim;
    
    if (isEmbeddingTensor) {
      // 這是 embedding tensor，shape 應該是 [1, T, D]
      const timeSteps = inputData.length / embeddingDim;
      console.log(`[ONNX Worker] Detected embedding tensor: T=${timeSteps}, D=${embeddingDim}`);
      feeds = {
        'input': new ort.Tensor('float32', inputData, [1, timeSteps, embeddingDim])
      };
    } else {
      // 這是原始音訊數據，shape 應該是 [1, 1, audio_length]
      console.log(`[ONNX Worker] Detected raw audio tensor: length=${inputData.length}`);
      feeds = {
        'input': new ort.Tensor('float32', inputData, [1, 1, inputData.length])
      };
    }

    const results = await session.run(feeds);
    
    // 提取輸出
    const output = results['output'] || results[Object.keys(results)[0]];
    const scores = Array.from(output.data as Float32Array);
    
    // 找出最高分數的喚醒詞
    let maxScore = 0;
    let detectedWord = null;
    
    scores.forEach((score, index) => {
      if (score > maxScore) {
        maxScore = score;
        detectedWord = index;
      }
    });
    
    const isDetected = maxScore > 0.5;
    
    // 發出喚醒詞檢測事件
    if (isDetected) {
      WorkerEventBridge.emitEvent('wakeword-detected', {
        word: modelName,
        wordIndex: detectedWord,
        confidence: maxScore,
        timestamp: Date.now()
      });
    }
    
    return {
      detected: isDetected,
      confidence: maxScore,
      wordIndex: detectedWord
    };
  }

  public async processInference(request: InferenceRequest): Promise<InferenceResponse> {
    const startTime = performance.now();
    
    try {
      // 載入或取得模型
      const session = await this.loadModel(request.modelName, request.config!);
      
      // 執行推理
      let result;
      if (request.type === 'vad') {
        result = await this.runVADInference(session, request.inputData, request.id);
      } else {
        result = await this.runWakeWordInference(session, request.inputData, request.modelName);
      }
      
      const executionTime = performance.now() - startTime;
      
      return {
        id: request.id,
        type: request.type,
        result,
        executionTime,
        provider: 'unknown' // ONNX Runtime Web 不公開 provider 資訊
      };
    } catch (error) {
      console.error(`[ONNX Worker] Inference failed for ${request.type}:`, error);
      
      // 發出錯誤事件
      WorkerEventBridge.emitError(error as Error, `processInference-${request.type}`);
      
      return {
        id: request.id,
        type: request.type,
        result: null,
        error: error instanceof Error ? error.message : String(error),
        executionTime: performance.now() - startTime
      };
    }
  }

  public async preloadModel(modelName: string, config: ModelConfig): Promise<void> {
    await this.loadModel(modelName, config);
    console.log(`[ONNX Worker] Preloaded model: ${modelName}`);
  }

  public clearCache(): void {
    this.sessions.clear();
    this.vadStates.clear();
    this.vadActiveStates.clear();
    console.log('[ONNX Worker] Model cache and states cleared');
  }
}

// Worker 實例
const worker = new ONNXInferenceWorker();

// 處理訊息
self.addEventListener('message', async (event: MessageEvent) => {
  const { type, data } = event.data;
  
  switch (type) {
    case 'inference':
      const response = await worker.processInference(data as InferenceRequest);
      self.postMessage({ type: 'inference-result', data: response });
      break;
      
    case 'preload':
      await worker.preloadModel(data.modelName, data.config);
      self.postMessage({ type: 'preload-complete', data: { modelName: data.modelName } });
      break;
      
    case 'clear-cache':
      worker.clearCache();
      self.postMessage({ type: 'cache-cleared', data: {} });
      break;
      
    default:
      console.warn(`[ONNX Worker] Unknown message type: ${type}`);
  }
});

// 注意：移除 export 語句以確保 Worker 是 classic script
// 類型定義應該放在單獨的 .d.ts 檔案中