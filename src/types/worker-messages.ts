/**
 * Worker message types definition
 * 這些類型定義用於主執行緒和 Worker 之間的通訊
 */

export interface ModelConfig {
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

export interface InferenceRequest {
  id: string;
  type: 'vad' | 'wakeword';
  modelName: string;
  inputData: Float32Array;
  config?: ModelConfig;
}

export interface InferenceResponse {
  id: string;
  type: 'vad' | 'wakeword';
  result: any;
  error?: string;
  executionTime?: number;
  provider?: string;
}