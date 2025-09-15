/**
 * ONNX Runtime Web 工具程序
 * 
 * 提供用於載入和管理 ONNX 模型推論會話的工具程序。
 * 支援 npm 套件和 CDN 兩種載入方式，提供靈活的部署選項。
 * 
 * @fileoverview ONNX Runtime 運行時工具程序
 * @author WebASRCore Team
 */

// 類型定義 - 這些僅在編譯時使用，不會產生 import 語句
import type { InferenceSession, Tensor as OrtTensor } from 'onnxruntime-web';

// 重新匯出類型供其他模組使用
export type { InferenceSession, OrtTensor };

// 動態獲取 ONNX Runtime 實例
let ortInstance: typeof import('onnxruntime-web') | null = null;

/**
 * 獲取 ONNX Runtime 實例
 * 
 * @description 支援多種載入方式的 ONNX Runtime 實例獲取函數
 * @returns Promise<typeof import('onnxruntime-web')> - ONNX Runtime 實例
 * @throws Error - 當無法找到 ONNX Runtime 時拋出錯誤
 * 
 * 支援的載入方式：
 * 1. 全域 window.ort (CDN 載入)
 * 2. 動態 import (npm 套件)
 * 3. 預先載入的實例
 * 
 * @example
 * ```typescript
 * const ort = await getOrt();
 * const session = await ort.InferenceSession.create(modelData);
 * ```
 */
async function getOrt(): Promise<typeof import('onnxruntime-web')> {
  // 如果已經有實例，直接返回
  if (ortInstance) {
    return ortInstance;
  }

  // 方法 1：檢查全域 window.ort (CDN 載入)
  if (typeof window !== 'undefined' && (window as any).ort) {
    ortInstance = (window as any).ort;
    return ortInstance!;
  }

  // 方法 2：嘗試動態 import (npm 套件)
  try {
    ortInstance = await import('onnxruntime-web');
    return ortInstance;
  } catch (e) {
    // 如果動態 import 失敗，再檢查一次全域變數
    if (typeof window !== 'undefined' && (window as any).ort) {
      ortInstance = (window as any).ort;
      return ortInstance!;
    }
    
    throw new Error(
      '找不到 ONNX Runtime Web。請選擇以下方式之一：\n' +
      '1. 通過 CDN 載入: <script src="https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js"></script>\n' +
      '2. 安裝 npm 套件: npm install onnxruntime-web'
    );
  }
}

/**
 * 初始化 ONNX Runtime
 * 
 * @description 初始化 ONNX Runtime 實例。必須在使用其他功能前呼叫此函數
 * @returns Promise<void> - 初始化完成的 Promise
 * @throws Error - 當初始化失敗時拋出錯誤
 * 
 * @example
 * ```typescript
 * await initializeOrt();
 * // 現在可以使用其他 ONNX Runtime 功能
 * const session = await createSession('./model.onnx');
 * ```
 */
export async function initializeOrt(): Promise<void> {
  const ort = await getOrt();
  
  // 設置正確的 WASM 路徑
  if (ort.env && ort.env.wasm) {
    if (typeof window !== 'undefined') {
      // 在瀏覽器環境中，使用相對路徑
      ort.env.wasm.wasmPaths = '/node_modules/onnxruntime-web/dist/';
      // 啟用 SIMD 和多線程
      ort.env.wasm.simd = true;
      ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;
    }
  }
}

/**
 * 同步獲取 ONNX Runtime 實例
 * 
 * @description 同步方式獲取已初始化的 ONNX Runtime 實例。必須先呼叫 initializeOrt()
 * @returns typeof import('onnxruntime-web') - ONNX Runtime 實例
 * @throws Error - 當實例未初始化時拋出錯誤
 * 
 * @example
 * ```typescript
 * await initializeOrt(); // 必須先初始化
 * const ort = getOrtSync();
 * const tensor = new ort.Tensor('float32', data, dims);
 * ```
 */
function getOrtSync(): typeof import('onnxruntime-web') {
  if (!ortInstance) {
    // 嘗試從全域變數獲取
    if (typeof window !== 'undefined' && (window as any).ort) {
      ortInstance = (window as any).ort;
      return ortInstance!;
    }
    throw new Error('ONNX Runtime 未初始化。請先呼叫 initializeOrt() 或通過 CDN 載入。');
  }
  return ortInstance;
}

/**
 * 創建 Tensor - 同步版本
 * 
 * @description 創建 ONNX Runtime Tensor 物件，用於模型推論的輸入和輸出
 * @param type - 資料類型（'float32' 或 'int64'）
 * @param data - 張量資料
 * @param dims - 張量維度（可選）
 * @returns OrtTensor - ONNX Runtime Tensor 物件
 * @throws Error - 當 ONNX Runtime 未初始化時拋出錯誤
 * 
 * @example
 * ```typescript
 * // 創建 float32 張量
 * const inputTensor = createTensor('float32', new Float32Array(576), [1, 576]);
 * 
 * // 創建 int64 張量
 * const srTensor = createTensor('int64', new BigInt64Array([BigInt(16000)]), [1]);
 * ```
 */
export function createTensor(
  type: 'float32' | 'int64',
  data: Float32Array | BigInt64Array | number[],
  dims?: readonly number[]
): OrtTensor {
  const ort = getOrtSync();
  return new ort.Tensor(type, data, dims);
}

/**
 * 從 URL 載入 ONNX 模型
 * 
 * @description 從指定的 URL 載入 ONNX 模型檔案並返回 ArrayBuffer
 * @param url - ONNX 模型檔案的 URL
 * @returns Promise<ArrayBuffer> - 模型檔案的二進位資料
 * @throws Error - 當載入失敗時拋出錯誤
 * 
 * @example
 * ```typescript
 * const modelData = await loadOnnxFromUrl('./models/vad_model.onnx');
 * const session = await ort.InferenceSession.create(modelData);
 * ```
 */
export async function loadOnnxFromUrl(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`從 ${url} 載入模型失敗: ${response.status}`);
  }
  return await response.arrayBuffer();
}

/**
 * 從模型 URL 創建 ONNX Runtime 推論會話
 * 
 * @description 從指定的模型 URL 創建 ONNX Runtime 推論會話，包含模型載入和會話初始化
 * @param modelUrl - ONNX 模型檔案的 URL
 * @param sessionOptions - 可選的會話配置選項
 * @returns Promise<InferenceSession> - ONNX Runtime 推論會話
 * @throws Error - 當會話創建失敗時拋出錯誤
 * 
 * @example
 * ```typescript
 * // 使用預設選項創建會話
 * const session = await createSession('./models/vad_model.onnx');
 * 
 * // 使用自定義選項創建會話
 * const session = await createSession('./models/vad_model.onnx', {
 *   executionProviders: ['wasm'],
 *   graphOptimizationLevel: 'all'
 * });
 * ```
 */
export async function createSession(
  modelUrl: string, 
  sessionOptions?: InferenceSession.SessionOptions
): Promise<InferenceSession> {
  try {
    // 獲取 ONNX Runtime 實例
    const ort = await getOrt();
    
    // 設置正確的 WASM 路徑
    if (ort.env && ort.env.wasm) {
      // 確保 WASM 路徑正確設置
      if (typeof window !== 'undefined') {
        // 在瀏覽器環境中，使用相對路徑
        ort.env.wasm.wasmPaths = '/node_modules/onnxruntime-web/dist/';
      }
    }
    
    // 載入模型資料
    const modelData = await loadOnnxFromUrl(modelUrl);
    
    // WebAssembly 執行的預設會話選項
    const options: InferenceSession.SessionOptions = sessionOptions || {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    };
    
    // 創建並返回推論會話
    return await ort.InferenceSession.create(modelData, options);
  } catch (error) {
    throw new Error(`為 ${modelUrl} 創建會話失敗: ${error}`);
  }
}

/**
 * 並行創建多個推論會話
 * 
 * @description 並行載入多個 ONNX 模型並創建對應的推論會話，提高載入效率
 * @param modelUrls - ONNX 模型檔案 URL 陣列
 * @param sessionOptions - 可選的會話配置選項（應用於所有會話）
 * @returns Promise<InferenceSession[]> - ONNX Runtime 推論會話陣列
 * @throws Error - 當任何會話創建失敗時拋出錯誤
 * 
 * @example
 * ```typescript
 * const [melspecSession, embeddingSession, detectorSession] = await createSessions([
 *   './models/melspec.onnx',
 *   './models/embedding.onnx', 
 *   './models/detector.onnx'
 * ]);
 * ```
 */
export async function createSessions(
  modelUrls: string[],
  sessionOptions?: InferenceSession.SessionOptions
): Promise<InferenceSession[]> {
  return await Promise.all(
    modelUrls.map(url => createSession(url, sessionOptions))
  );
}

/**
 * 從推論會話獲取輸入/輸出元數據
 * 
 * @description 提取 ONNX 模型的輸入和輸出名稱及形狀資訊
 * @param session - ONNX Runtime 推論會話
 * @returns 包含輸入/輸出元數據的物件
 * @returns.inputNames - 輸入張量名稱陣列
 * @returns.outputNames - 輸出張量名稱陣列  
 * @returns.inputShapes - 輸入張量形狀陣列（可能為 undefined）
 * @returns.outputShapes - 輸出張量形狀陣列（可能為 undefined）
 * 
 * @example
 * ```typescript
 * const metadata = getSessionMetadata(session);
 * console.log('輸入名稱:', metadata.inputNames);
 * console.log('輸出名稱:', metadata.outputNames);
 * ```
 * 
 * @remarks 形狀資訊可能要到運行時才可用
 */
export function getSessionMetadata(session: InferenceSession): {
  inputNames: string[];
  outputNames: string[];
  inputShapes: (readonly number[] | undefined)[];
  outputShapes: (readonly number[] | undefined)[];
} {
  const inputNames = session.inputNames;
  const outputNames = session.outputNames;
  
  // 注意：形狀資訊可能要到運行時才可用
  const inputShapes = inputNames.map(() => undefined);
  const outputShapes = outputNames.map(() => undefined);
  
  return {
    inputNames: [...inputNames],
    outputNames: [...outputNames],
    inputShapes,
    outputShapes,
  };
}