/**
 * ONNX Runtime Web Worker for Model Inference
 * 
 * 執行 VAD 和喚醒詞模型推理的 Web Worker，支援 WebGPU 加速
 */

import * as ort from 'onnxruntime-web';

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

class ONNXInferenceWorker {
  private sessions: Map<string, ort.InferenceSession> = new Map();
  private isWebGPUAvailable = false;

  constructor() {
    this.initialize();
  }

  private async initialize() {
    // 檢查 WebGPU 支援
    try {
      if ('gpu' in navigator) {
        const adapter = await (navigator as any).gpu.requestAdapter();
        if (adapter) {
          this.isWebGPUAvailable = true;
          console.log('[ONNX Worker] WebGPU is available');
        }
      }
    } catch (error) {
      console.log('[ONNX Worker] WebGPU not available:', error);
    }

    // 配置 ONNX Runtime
    ort.env.wasm.simd = true;
    ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;
    ort.env.webgpu.powerPreference = 'high-performance';
    
    // 設置 WASM 路徑
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';

    self.postMessage({ 
      type: 'initialized', 
      webgpuAvailable: this.isWebGPUAvailable 
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
    const executionProviders: ort.InferenceSession.ExecutionProviderConfig[] = [];
    
    for (const provider of config.executionProviders) {
      if (provider === 'webgpu' && this.isWebGPUAvailable) {
        executionProviders.push({
          name: 'webgpu',
          ...config.webgpuOptions
        });
      } else if (provider === 'wasm') {
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
      const session = await ort.InferenceSession.create(
        config.modelPath,
        { executionProviders }
      );
      
      this.sessions.set(cacheKey, session);
      console.log(`[ONNX Worker] Model loaded with provider: ${session.handler.name}`);
      
      return session;
    } catch (error) {
      console.error(`[ONNX Worker] Failed to load model:`, error);
      throw error;
    }
  }

  private async runVADInference(
    session: ort.InferenceSession,
    inputData: Float32Array
  ): Promise<any> {
    // VAD 模型輸入格式
    const feeds: Record<string, ort.Tensor> = {
      'input': new ort.Tensor('float32', inputData, [1, inputData.length])
    };

    const results = await session.run(feeds);
    
    // 提取輸出
    const output = results['output'] || results[Object.keys(results)[0]];
    const probability = output.data[0] as number;
    
    return {
      isSpeech: probability > 0.5,
      probability: probability
    };
  }

  private async runWakeWordInference(
    session: ort.InferenceSession,
    inputData: Float32Array
  ): Promise<any> {
    // 喚醒詞模型輸入格式
    const feeds: Record<string, ort.Tensor> = {
      'input': new ort.Tensor('float32', inputData, [1, 1, inputData.length])
    };

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
    
    return {
      detected: maxScore > 0.5,
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
        result = await this.runVADInference(session, request.inputData);
      } else {
        result = await this.runWakeWordInference(session, request.inputData);
      }
      
      const executionTime = performance.now() - startTime;
      
      return {
        id: request.id,
        type: request.type,
        result,
        executionTime,
        provider: session.handler.name
      };
    } catch (error) {
      return {
        id: request.id,
        type: request.type,
        result: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  public async preloadModel(modelName: string, config: ModelConfig): Promise<void> {
    await this.loadModel(modelName, config);
    console.log(`[ONNX Worker] Preloaded model: ${modelName}`);
  }

  public clearCache(): void {
    this.sessions.clear();
    console.log('[ONNX Worker] Model cache cleared');
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
      self.postMessage({ type: 'preload-complete', modelName: data.modelName });
      break;
      
    case 'clear-cache':
      worker.clearCache();
      self.postMessage({ type: 'cache-cleared' });
      break;
      
    default:
      console.warn(`[ONNX Worker] Unknown message type: ${type}`);
  }
});

// 匯出類型供主執行緒使用
export type { InferenceRequest, InferenceResponse, ModelConfig };