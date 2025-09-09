/**
 * ONNX Runtime Web Service
 * 
 * 管理 ONNX Runtime Web 的初始化和配置，支援 WebGPU 加速
 */

import * as ort from 'onnxruntime-web';
import { ConfigManager } from '../utils/config-manager';

export class ORTService {
  private static instance: ORTService;
  private initialized = false;
  private webgpuAvailable = false;
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, (value: any) => void>();
  private requestCounter = 0;

  private constructor() {}

  public static getInstance(): ORTService {
    if (!ORTService.instance) {
      ORTService.instance = new ORTService();
    }
    return ORTService.instance;
  }

  /**
   * 初始化 ONNX Runtime
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const config = ConfigManager.getInstance();
    
    // 檢查 WebGPU 支援
    this.webgpuAvailable = await this.checkWebGPUSupport();
    
    // 配置 ONNX Runtime 環境
    this.configureEnvironment(config);
    
    // 初始化 Web Worker（如果啟用）
    if (config.onnx.useWebWorker) {
      await this.initializeWorker();
    }
    
    this.initialized = true;
    console.log('[ORT Service] Initialized with WebGPU:', this.webgpuAvailable);
  }

  /**
   * 檢查 WebGPU 支援
   */
  private async checkWebGPUSupport(): Promise<boolean> {
    const config = ConfigManager.getInstance();
    
    // 如果強制使用後備方案，直接返回 false
    if (config.onnx.webgpu.forceFallback) {
      return false;
    }
    
    try {
      if (!('gpu' in navigator)) {
        return false;
      }
      
      const adapter = await (navigator as any).gpu.requestAdapter({
        powerPreference: config.onnx.webgpu.powerPreference
      });
      
      if (!adapter) {
        return false;
      }
      
      const device = await adapter.requestDevice();
      if (!device) {
        return false;
      }
      
      // 測試是否真的可以使用 WebGPU
      const testTensor = new Float32Array([1, 2, 3, 4]);
      const tensor = new ort.Tensor('float32', testTensor, [2, 2]);
      
      // 如果能創建 tensor，WebGPU 應該是可用的
      return true;
    } catch (error) {
      console.warn('[ORT Service] WebGPU check failed:', error);
      return false;
    }
  }

  /**
   * 配置 ONNX Runtime 環境
   */
  private configureEnvironment(config: ConfigManager): void {
    // 配置 WASM
    ort.env.wasm.simd = config.onnx.wasm.simd;
    ort.env.wasm.numThreads = config.onnx.wasm.numThreads || navigator.hardwareConcurrency || 4;
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
    
    // 配置 WebGPU（如果可用）
    if (this.webgpuAvailable && config.onnx.webgpu.enabled) {
      ort.env.webgpu.powerPreference = config.onnx.webgpu.powerPreference;
    }
    
    // 配置日誌級別
    ort.env.logLevel = 'warning';
  }

  /**
   * 初始化 Web Worker
   */
  private async initializeWorker(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.worker = new Worker(
          new URL('../workers/onnx-inference.worker.ts', import.meta.url),
          { type: 'module' }
        );
        
        this.worker.addEventListener('message', (event) => {
          this.handleWorkerMessage(event);
        });
        
        this.worker.addEventListener('error', (error) => {
          console.error('[ORT Service] Worker error:', error);
          reject(error);
        });
        
        // 等待 worker 初始化完成
        const initHandler = (event: MessageEvent) => {
          if (event.data.type === 'initialized') {
            this.worker?.removeEventListener('message', initHandler);
            console.log('[ORT Service] Worker initialized');
            resolve();
          }
        };
        
        this.worker.addEventListener('message', initHandler);
      } catch (error) {
        console.error('[ORT Service] Failed to initialize worker:', error);
        reject(error);
      }
    });
  }

  /**
   * 處理 Worker 訊息
   */
  private handleWorkerMessage(event: MessageEvent): void {
    const { type, data } = event.data;
    
    switch (type) {
      case 'inference-result':
        const callback = this.pendingRequests.get(data.id);
        if (callback) {
          callback(data);
          this.pendingRequests.delete(data.id);
        }
        break;
        
      case 'preload-complete':
        console.log(`[ORT Service] Model preloaded: ${data.modelName}`);
        break;
        
      default:
        // 其他訊息類型
        break;
    }
  }

  /**
   * 創建推理會話
   */
  public async createSession(
    modelPath: string,
    options?: ort.InferenceSession.SessionOptions
  ): Promise<ort.InferenceSession> {
    const config = ConfigManager.getInstance();
    
    // 準備執行提供者
    const executionProviders: ort.InferenceSession.ExecutionProviderConfig[] = [];
    
    // 根據配置和可用性添加執行提供者
    for (const provider of config.onnx.executionProviders) {
      if (provider === 'webgpu' && this.webgpuAvailable && config.onnx.webgpu.enabled) {
        executionProviders.push({
          name: 'webgpu',
          powerPreference: config.onnx.webgpu.powerPreference
        });
      } else if (provider === 'wasm') {
        executionProviders.push({
          name: 'wasm',
          simd: config.onnx.wasm.simd,
          numThreads: config.onnx.wasm.numThreads
        });
      }
    }
    
    // 如果沒有可用的提供者，使用預設 WASM
    if (executionProviders.length === 0) {
      executionProviders.push({ name: 'wasm' });
    }
    
    const sessionOptions: ort.InferenceSession.SessionOptions = {
      ...options,
      executionProviders
    };
    
    console.log(`[ORT Service] Creating session with providers:`, executionProviders.map(p => p.name));
    
    return await ort.InferenceSession.create(modelPath, sessionOptions);
  }

  /**
   * 在 Worker 中執行推理（如果可用）
   */
  public async runInferenceInWorker(
    type: 'vad' | 'wakeword',
    modelName: string,
    modelPath: string,
    inputData: Float32Array
  ): Promise<any> {
    if (!this.worker) {
      throw new Error('Worker not initialized');
    }
    
    const config = ConfigManager.getInstance();
    const requestId = `${type}_${++this.requestCounter}`;
    
    return new Promise((resolve) => {
      this.pendingRequests.set(requestId, resolve);
      
      this.worker!.postMessage({
        type: 'inference',
        data: {
          id: requestId,
          type,
          modelName,
          inputData,
          config: {
            modelPath,
            executionProviders: config.onnx.executionProviders,
            webgpuOptions: config.onnx.webgpu.enabled ? {
              powerPreference: config.onnx.webgpu.powerPreference
            } : undefined,
            wasmOptions: {
              simd: config.onnx.wasm.simd,
              numThreads: config.onnx.wasm.numThreads
            }
          }
        }
      });
    });
  }

  /**
   * 預載入模型到 Worker
   */
  public async preloadModelInWorker(
    modelName: string,
    modelPath: string
  ): Promise<void> {
    if (!this.worker) {
      return;
    }
    
    const config = ConfigManager.getInstance();
    
    this.worker.postMessage({
      type: 'preload',
      data: {
        modelName,
        config: {
          modelPath,
          executionProviders: config.onnx.executionProviders,
          webgpuOptions: config.onnx.webgpu.enabled ? {
            powerPreference: config.onnx.webgpu.powerPreference
          } : undefined,
          wasmOptions: {
            simd: config.onnx.wasm.simd,
            numThreads: config.onnx.wasm.numThreads
          }
        }
      }
    });
  }

  /**
   * 清除 Worker 快取
   */
  public clearWorkerCache(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'clear-cache' });
    }
  }

  /**
   * 取得執行提供者資訊
   */
  public getExecutionProviderInfo(): {
    webgpuAvailable: boolean;
    activeProviders: string[];
    useWorker: boolean;
  } {
    const config = ConfigManager.getInstance();
    const activeProviders: string[] = [];
    
    if (this.webgpuAvailable && config.onnx.webgpu.enabled) {
      activeProviders.push('webgpu');
    }
    activeProviders.push('wasm');
    
    return {
      webgpuAvailable: this.webgpuAvailable,
      activeProviders,
      useWorker: config.onnx.useWebWorker && this.worker !== null
    };
  }

  /**
   * 清理資源
   */
  public dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingRequests.clear();
    this.initialized = false;
  }
}

// 匯出單例
export const ortService = ORTService.getInstance();