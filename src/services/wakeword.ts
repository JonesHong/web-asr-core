/**
 * 喚醒詞檢測服務
 * 
 * 提供無狀態的喚醒詞檢測服務，用於在音訊中檢測特定的喚醒詞。
 * 使用三階段處理流程：梅爾頻譜圖生成 → 嵌入向量提取 → 喚醒詞檢測
 * 
 * @fileoverview 喚醒詞檢測服務實現
 * @author WebASRCore Team
 */

import type { InferenceSession, Tensor } from 'onnxruntime-web';
import { createSessions, createTensor } from '../runtime/ort';
import type { WakewordResources, WakewordState, WakewordParams, WakewordResult } from '../types';
import { ConfigManager } from '../utils/config-manager';
import { ortService } from './ort';

/**
 * Wake Word 事件發射器
 * 
 * @description 用於發送喚醒詞相關事件，外部可以監聽這些事件進行相應處理
 * 事件類型：
 * - 'wakeword-detected': 檢測到喚醒詞 { word: string, score: number, timestamp: number }
 * - 'processing-error': 處理錯誤 { error: Error, context: string }
 */
export const wakewordEvents = new EventTarget();

/**
 * 載入所有喚醒詞模型資源
 * 
 * @description 並行載入三個 ONNX 模型：梅爾頻譜圖模型、嵌入模型和檢測器模型
 * @param wakewordName - 喚醒詞名稱（'hey_jarvis' | 'hey_mycroft' | 'alexa'）
 * @param config - 可選的配置管理器實例
 * @param customPaths - 可選的自訂模型路徑
 * @returns Promise<WakewordResources> - 完整的喚醒詞模型資源
 * @throws Error - 當任何模型載入失敗時拋出錯誤
 * 
 * @example
 * ```typescript
 * // 使用預設配置載入 Hey Jarvis
 * const resources = await loadWakewordResources('hey_jarvis');
 * 
 * // 使用自訂配置
 * const config = new ConfigManager();
 * config.wakeword.hey_jarvis.detectorPath = './my_models/detector.onnx';
 * const resources = await loadWakewordResources('hey_jarvis', config);
 * 
 * // 使用自訂路徑
 * const resources = await loadWakewordResources('hey_jarvis', undefined, {
 *   detectorUrl: './custom/detector.onnx',
 *   melspecUrl: './custom/melspec.onnx',
 *   embeddingUrl: './custom/embedding.onnx'
 * });
 * ```
 */
export async function loadWakewordResources(
  wakewordName: 'hey_jarvis' | 'hey_mycroft' | 'alexa' | string = 'hey_jarvis',
  isCustomModel: boolean = false,
  config?: ConfigManager,
  customPaths?: { 
    detectorUrl: string; 
    melspecUrl: string; 
    embeddingUrl: string;
  }
): Promise<WakewordResources> {
  const cfg = config || ConfigManager.getInstance();
  
  // 初始化 ORT 服務
  await ortService.initialize();
  
  // 處理自訂模型
  if (isCustomModel && typeof wakewordName === 'string') {
    // 對於自訂模型，假設單一 ONNX 檔案包含所有三個模型
    // 或使用相同的模型 URL（Blob URL）
    const modelUrl = wakewordName; // wakewordName 在自訂模型時是 URL
    
    // 創建單一模型的資源（簡化版本）
    const session = await ortService.createSession(modelUrl, undefined, 'wakeword');
    
    // 返回簡化的資源（三個階段使用同一個模型）
    return {
      detector: session,
      melspec: session,
      embedding: session,
      dims: {
        embeddingBufferSize: cfg.wakeword.common.embeddingBufferSize,
        embeddingDimension: cfg.wakeword.common.embeddingDimension
      }
    };
  }
  
  // 使用自訂路徑或從配置取得（內建模型）
  const wakewordKey = wakewordName as 'hey_jarvis' | 'hey_mycroft' | 'alexa';
  const paths = customPaths || {
    detectorUrl: cfg.wakeword[wakewordKey].detectorPath,
    melspecUrl: cfg.wakeword[wakewordKey].melspecPath,
    embeddingUrl: cfg.wakeword[wakewordKey].embeddingPath,
  };
  
  // 如果啟用 Web Worker，預載入模型，指定為 wakeword 類型以使用 WASM
  if (cfg.onnx.useWebWorker) {
    await Promise.all([
      ortService.preloadModelInWorker(`wakeword_detector_${wakewordName}`, paths.detectorUrl, 'wakeword'),
      ortService.preloadModelInWorker(`wakeword_melspec_${wakewordName}`, paths.melspecUrl, 'wakeword'),
      ortService.preloadModelInWorker(`wakeword_embedding_${wakewordName}`, paths.embeddingUrl, 'wakeword'),
    ]);
  }
  
  // 使用優化的 ORT 服務並行載入三個模型，指定為 wakeword 類型以使用 WASM
  const sessionPromises = [
    ortService.createSession(paths.detectorUrl, undefined, 'wakeword'),
    ortService.createSession(paths.melspecUrl, undefined, 'wakeword'),
    ortService.createSession(paths.embeddingUrl, undefined, 'wakeword'),
  ];
  
  const [detector, melspec, embedding] = await Promise.all(sessionPromises);
  
  // 建立初始資源物件，使用配置的維度
  const resources: WakewordResources = { 
    detector, 
    melspec, 
    embedding, 
    dims: { 
      embeddingBufferSize: cfg.wakeword.common.embeddingBufferSize,
      embeddingDimension: cfg.wakeword.common.embeddingDimension
    }
  };
  
  // 嘗試從模型資源自動偵測維度（如果可能）
  const dims = await detectWakewordDims(resources, cfg);

  // 更新為檢測到的實際維度（或保留配置的預設值）
  resources.dims = dims;
  
  return resources;
}

/**
 * 從檢測器模型輸入形狀檢測喚醒詞模型維度
 *
 * @description 動態偵測模型維度（無硬編碼），使用多層 fallback 策略
 * 優先順序：
 * 1) detector.inputMetadata（若維度是固定數字直接取用）
 * 2) embedding.outputMetadata（補齊 embeddingDimension）
 * 3) 以常見 buf 候選值做試跑（16/20/24/28/32...）
 * 4) 解析錯誤訊息中的 shape（若 ORT 提示期望形狀）
 * 5) 終極 fallback：使用設定預設值
 *
 * @param resources - 喚醒詞模型資源
 * @param config - 可選的配置管理器實例
 * @returns Promise<模型維度配置>
 * @returns.embeddingBufferSize - 嵌入緩衝區大小（時間步數）
 * @returns.embeddingDimension - 嵌入向量維度
 *
 * @example
 * ```typescript
 * const dims = await detectWakewordDims(resources);
 * console.log(`緩衝區大小: ${dims.embeddingBufferSize}, 維度: ${dims.embeddingDimension}`);
 * ```
 */
export async function detectWakewordDims(
  resources: WakewordResources,
  config?: ConfigManager
): Promise<{ embeddingBufferSize: number; embeddingDimension: number }> {
  const cfg = config || new ConfigManager();

  // 預設（最後一層 fallback）
  let embeddingBufferSize: number | undefined = cfg.wakeword.common.embeddingBufferSize;
  let embeddingDimension: number | undefined = cfg.wakeword.common.embeddingDimension;

  // 常見時間步長候選值
  const timeStepCandidates = [16, 20, 24, 28, 32];

  // 輔助函數：檢查值是否為有效數字
  type DimVal = number | string | undefined | null;
  const isNumeric = (v: DimVal): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0;

  // 輔助函數：轉換為陣列
  const toArray = <T,>(v: T | T[] | undefined): T[] | undefined =>
    Array.isArray(v) ? v : v !== undefined ? [v] : undefined;

  // 提取 ONNX Runtime metadata 的維度資訊
  const getIODims = (session: any, io: 'input' | 'output', name: string): DimVal[] | undefined => {
    const md = io === 'input' ? session.inputMetadata : session.outputMetadata;
    if (!md) return undefined;

    // 處理不同的 metadata 結構（物件或 Map）
    const entry =
      (typeof md.get === 'function' ? md.get(name) : undefined) ??
      (md[name] ?? undefined);
    if (!entry) return undefined;

    // 嘗試常見的欄位名稱
    const dims = entry.dimensions ?? entry.shape ?? entry.dims;
    if (Array.isArray(dims)) return dims as DimVal[];

    // 某些 ORT 版本有 TypeInfo 結構
    const typeInfo = entry.type ?? entry.tensorTypeAndShapeInfo ?? entry.tensorTypeAndShape ??
      entry.valueType ?? entry.typeInfo;
    const shape =
      typeInfo?.shape ??
      typeInfo?.dimensions ??
      typeInfo?.tensorShape ??
      undefined;
    if (Array.isArray(shape)) return shape as DimVal[];

    return undefined;
  };

  // 選擇最可能的檢測器輸入（rank-3: [1, T, D]）
  const pickDetectorInput = (session: any): { name: string; dims?: DimVal[] } => {
    const names: string[] = toArray(session.inputNames) || [];
    let best: { name: string; dims?: DimVal[] } | undefined;

    for (const n of names) {
      const dims = getIODims(session, 'input', n);
      if (dims && dims.length === 3) {
        // 優先選擇 rank-3 張量
        return { name: n, dims };
      }
      // 記住第一個輸入作為備選
      if (!best) best = { name: n, dims };
    }
    return best || { name: names[0] };
  };

  // 從錯誤訊息中解析形狀
  const parseShapesFromError = (msg: string): number[][] => {
    const shapes: number[][] = [];

    // 捕獲像 [1, 28, 96] 或 (1,28,96) 或 1x28x96 的序列
    // 1) 括號列表
    const bracketRegex = /[\[\(]\s*([0-9\s,;xX×]+)\s*[\]\)]/g;
    let m: RegExpExecArray | null;
    while ((m = bracketRegex.exec(msg)) !== null) {
      const body = m[1] || '';
      const parts = body
        .split(/[,;xX×\s]+/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(n => parseInt(n, 10))
        .filter(n => Number.isFinite(n) && n > 0);
      if (parts.length >= 2) {
        shapes.push(parts);
      }
    }

    // 2) 無括號的 1x28x96 格式
    const bareRegex = /(\d+\s*[xX×]\s*\d+(?:\s*[xX×]\s*\d+)+)/g;
    while ((m = bareRegex.exec(msg)) !== null) {
      const body = m[1] || '';
      const parts = body
        .split(/[xX×]/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(n => parseInt(n, 10))
        .filter(n => Number.isFinite(n) && n > 0);
      if (parts.length >= 2) {
        shapes.push(parts);
      }
    }

    // 優先選擇 3D 形狀
    const rank3 = shapes.filter(s => s.length === 3);
    return rank3.length ? rank3 : shapes;
  };

  const chooseExpectedDetectorShape = (msg: string): { time?: number; dim?: number } => {
    const shapes = parseShapesFromError(msg);

    // 啟發式：優先選擇 [1, T, D] 格式
    for (const s of shapes) {
      if (s.length === 3 && s[0] === 1) {
        return { time: s[1], dim: s[2] };
      }
    }

    // 備選：任何 3D 形狀
    for (const s of shapes) {
      if (s.length === 3) return { time: s[1], dim: s[2] };
    }

    return {};
  };

  // 步驟 1：從 embedding 輸出 metadata 獲取 embeddingDimension
  try {
    const embOutName = resources.embedding.outputNames?.[0];
    if (embOutName) {
      const embOutDims = getIODims(resources.embedding as any, 'output', embOutName);
      // 使用最後一個數字維度作為 embedding dimension
      if (embOutDims && embOutDims.length >= 1) {
        const numericDims = embOutDims.filter(isNumeric) as number[];
        if (numericDims.length >= 1) {
          const cand = numericDims[numericDims.length - 1];
          if (isNumeric(cand)) {
            embeddingDimension = cand;
            console.log(`[detectWakewordDims] 從 embedding 輸出偵測到維度: ${embeddingDimension}`);
          }
        }
      }
    }
  } catch {
    // 忽略錯誤，繼續下一步
  }

  // 步驟 2：從 detector 輸入 metadata 獲取維度
  let detInputName = resources.detector.inputNames?.[0] as string | undefined;
  let detInputDims: DimVal[] | undefined;
  try {
    const picked = pickDetectorInput(resources.detector as any);
    detInputName = picked?.name ?? detInputName;
    detInputDims = picked?.dims;
    if (detInputDims && detInputDims.length === 3) {
      const [, t, d] = detInputDims;
      if (isNumeric(t)) {
        embeddingBufferSize = t;
        console.log(`[detectWakewordDims] 從 detector 輸入偵測到 bufferSize: ${embeddingBufferSize}`);
      }
      if (isNumeric(d)) {
        embeddingDimension = d;
        console.log(`[detectWakewordDims] 從 detector 輸入偵測到 dimension: ${embeddingDimension}`);
      }
    }
  } catch {
    // 忽略錯誤，繼續下一步
  }

  // 步驟 3：如果時間步長未知，使用常見候選值進行試跑
  const needTimeProbe = !Number.isFinite(embeddingBufferSize) || embeddingBufferSize <= 0 ||
    detInputDims === undefined ||
    (Array.isArray(detInputDims) && detInputDims.length === 3 && !isNumeric(detInputDims[1]));

  if (needTimeProbe && detInputName && embeddingDimension) {
    console.log('[detectWakewordDims] 開始探測時間步長...');

    for (const t of timeStepCandidates) {
      try {
        const testTensor = createTensor(
          'float32',
          new Float32Array(t * embeddingDimension),
          [1, t, embeddingDimension]
        );

        // 嘗試執行檢測器
        await resources.detector.run({
          [detInputName]: testTensor
        });

        // 如果執行成功，接受這個時間步長
        embeddingBufferSize = t;
        console.log(`[detectWakewordDims] 探測成功，時間步長為: ${t}`);
        break;
      } catch (e: any) {
        // 從錯誤訊息中解析期望的形狀
        const msg = (e && (e.message || e.toString())) || '';
        const expected = chooseExpectedDetectorShape(msg);

        if (expected.time && Number.isFinite(expected.time)) {
          embeddingBufferSize = expected.time;
          console.log(`[detectWakewordDims] 從錯誤訊息解析出時間步長: ${expected.time}`);
        }
        if (expected.dim && Number.isFinite(expected.dim)) {
          embeddingDimension = expected.dim;
          console.log(`[detectWakewordDims] 從錯誤訊息解析出維度: ${expected.dim}`);
        }

        // 如果從錯誤中獲得了兩個維度，停止探測
        if (expected.time && expected.dim) break;
      }
    }
  }

  // 最終 fallback：確保有有效的正數值
  if (!Number.isFinite(embeddingBufferSize) || embeddingBufferSize <= 0) {
    console.log(`[detectWakewordDims] 使用預設 bufferSize: ${cfg.wakeword.common.embeddingBufferSize}`);
    embeddingBufferSize = cfg.wakeword.common.embeddingBufferSize;
  }

  if (!Number.isFinite(embeddingDimension) || embeddingDimension <= 0) {
    console.log(`[detectWakewordDims] 使用預設 dimension: ${cfg.wakeword.common.embeddingDimension}`);
    embeddingDimension = cfg.wakeword.common.embeddingDimension;
  }

  console.log(`[detectWakewordDims] 最終維度 - bufferSize: ${embeddingBufferSize}, dimension: ${embeddingDimension}`);

  return { embeddingBufferSize, embeddingDimension };
}

/**
 * 創建初始喚醒詞狀態
 * 
 * @description 建立喚醒詞處理所需的初始狀態，包括梅爾頻譜緩衝區和嵌入緩衝區
 * @param dims - 模型維度配置
 * @param dims.embeddingBufferSize - 嵌入緩衝區大小
 * @param dims.embeddingDimension - 嵌入向量維度
 * @returns WakewordState - 初始化的喚醒詞狀態物件
 * 
 * @example
 * ```typescript
 * const dims = { embeddingBufferSize: 16, embeddingDimension: 96 };
 * const wakewordState = createWakewordState(dims);
 * console.log(`初始化 ${wakewordState.embeddingBuffer.length} 個嵌入緩衝區`);
 * ```
 */
export function createWakewordState(
  dims: { embeddingBufferSize: number; embeddingDimension: number }
): WakewordState {
  // 使用零值初始化嵌入緩衝區
  const embeddingBuffer: Float32Array[] = [];
  for (let i = 0; i < dims.embeddingBufferSize; i++) {
    embeddingBuffer.push(new Float32Array(dims.embeddingDimension));
  }
  
  return {
    melBuffer: [],           // 梅爾頻譜幀緩衝區（每幀 32 維）
    embeddingBuffer,         // 嵌入向量緩衝區
  };
}

/**
 * 處理音訊塊進行喚醒詞檢測
 * 
 * @description 使用三階段流程處理音訊塊：梅爾頻譜圖 → 嵌入提取 → 喚醒詞檢測
 * @param resources - 喚醒詞模型資源
 * @param prevState - 前一個喚醒詞狀態
 * @param audio - 音訊塊（Float32Array）- 應為 16kHz 的樣本
 * @param params - 喚醒詞參數配置
 * @param config - 可選的配置管理器實例
 * @returns Promise<WakewordResult> - 檢測結果和更新後的狀態
 * @throws Error - 當處理失敗時拋出錯誤
 * 
 * @example
 * ```typescript
 * const result = await processWakewordChunk(resources, wakewordState, audioChunk, params);
 * console.log(`喚醒詞檢測: ${result.triggered}, 分數: ${result.score}`);
 * wakewordState = result.state; // 更新狀態
 * ```
 */
export async function processWakewordChunk(
  resources: WakewordResources,
  prevState: WakewordState,
  audio: Float32Array,
  params: WakewordParams & { isCustomModel?: boolean },
  config?: ConfigManager
): Promise<WakewordResult> {
  const cfg = config || new ConfigManager();
  
  try {
  
  // 檢查是否為單一 session 的 raw-audio 模型（罕見情況）
  const singleSessionAllStages = 
    resources.melspec === resources.detector && 
    resources.embedding === resources.detector;
  
  // 僅在三個資源是同一個 session 時，才視為 raw-audio 單檔模型的 fallback
  if (params.isCustomModel && singleSessionAllStages) {
    // 僅嘗試 3D [1,1,N]，如果失敗則回到標準三階段
    try {
      const audioTensor = createTensor('float32', audio, [1, 1, audio.length]);
      const result = await resources.detector.run({
        [resources.detector.inputNames[0]]: audioTensor
      });
      
      const output = result[resources.detector.outputNames[0]] as Tensor;
      const scores = output.data as Float32Array;
      
      let maxScore = 0;
      for (let i = 0; i < scores.length; i++) {
        maxScore = Math.max(maxScore, scores[i]);
      }
      
      const triggered = maxScore >= params.threshold;
      return {
        score: maxScore,
        triggered,
        state: prevState
      };
    } catch (e) {
      // fallback 失敗，繼續用標準三階段
      console.warn('[processWakewordChunk] Raw-audio fallback failed, using 3-stage pipeline instead');
      // 不要拋出錯誤，讓程式繼續執行標準三階段
    }
  }
  
  const melFramesPerChunk = params.melFramesPerChunk ?? cfg.wakeword.common.melFramesPerChunk;
  const requiredMelFrames = params.requiredMelFrames ?? cfg.wakeword.common.requiredMelFrames;
  const melStride = params.melStride ?? cfg.wakeword.common.melStride;
  
  // 驗證狀態結構
  if (!prevState.melBuffer || !Array.isArray(prevState.melBuffer)) {
    console.error('[processWakewordChunk] Invalid state - melBuffer is not an array:', prevState);
    throw new Error('Invalid wakeword state: melBuffer must be an array');
  }
  if (!prevState.embeddingBuffer || !Array.isArray(prevState.embeddingBuffer)) {
    console.error('[processWakewordChunk] Invalid state - embeddingBuffer is not an array:', prevState);
    throw new Error('Invalid wakeword state: embeddingBuffer must be an array');
  }

  // 深拷貝狀態以避免 ONNX Runtime 記憶體重用問題
  // melBuffer 需要深拷貝每個 Float32Array
  const melBuffer = prevState.melBuffer.map(frame => new Float32Array(frame));
  // embeddingBuffer 也需要深拷貝每個 Float32Array
  let embeddingBuffer = prevState.embeddingBuffer.map(embedding => new Float32Array(embedding));
  let score = 0;
  
  // 階段 1：音訊 → 梅爾頻譜圖（32 頻段 x 5 幀）
  const audioTensor = createTensor('float32', audio, [1, audio.length]);
  const melOut = await resources.melspec.run({
    [resources.melspec.inputNames[0]]: audioTensor
  });
  
  const melData = (melOut[resources.melspec.outputNames[0]] as Tensor).data as Float32Array;
  
  // 縮放梅爾特徵：(x/10) + 2
  const scaledMel = new Float32Array(melData.length);
  for (let j = 0; j < melData.length; j++) {
    scaledMel[j] = (melData[j] / 10.0) + 2.0;
  }
  
  // 將 5 個幀添加到緩衝區（每個幀為 32 維）
  const melDim = 32;
  for (let j = 0; j < melFramesPerChunk; j++) {
    // 使用深拷貝避免視圖重用問題
    const frame = new Float32Array(scaledMel.slice(j * melDim, (j + 1) * melDim));
    melBuffer.push(frame);
  }
  
  // 階段 2 & 3：如果幀數足夠，計算嵌入向量並進行檢測
  if (melBuffer.length >= requiredMelFrames) {
    // 取前 76 個幀進行嵌入計算
    const windowFrames = melBuffer.slice(0, requiredMelFrames);
    
    // 為嵌入模型展平梅爾幀
    const flatMel = new Float32Array(requiredMelFrames * melDim);
    for (let i = 0; i < windowFrames.length; i++) {
      const offset = i * melDim;
      const frame = windowFrames[i];
      
      // 檢查邊界
      if (offset + frame.length > flatMel.length) {
        console.error('[processWakewordChunk] Mel offset out of bounds:', {
          offset,
          frameLength: frame.length,
          flatMelLength: flatMel.length,
          frameIndex: i,
          requiredMelFrames,
          melDim,
          windowFramesLength: windowFrames.length
        });
        throw new Error('mel offset is out of bounds');
      }
      
      flatMel.set(frame, offset);
    }
    
    // 創建形狀為 [1, 76, 32, 1] 的張量
    const melTensor = createTensor('float32', flatMel, [1, requiredMelFrames, melDim, 1]);
    
    // 執行嵌入模型
    const embOut = await resources.embedding.run({
      [resources.embedding.inputNames[0]]: melTensor
    });
    
    const newEmbedding = (embOut[resources.embedding.outputNames[0]] as Tensor).data as Float32Array;
    
    // 更新嵌入緩衝區（滑動窗口）
    embeddingBuffer = embeddingBuffer.slice(1);
    embeddingBuffer.push(new Float32Array(newEmbedding));
    
    // 為檢測器展平嵌入向量
    const flatEmb = new Float32Array(
      resources.dims.embeddingBufferSize * resources.dims.embeddingDimension
    );
    for (let i = 0; i < embeddingBuffer.length; i++) {
      const offset = i * resources.dims.embeddingDimension;
      const embedding = embeddingBuffer[i];
      
      // 檢查邊界
      if (offset + embedding.length > flatEmb.length) {
        console.error('[processWakewordChunk] Offset out of bounds:', {
          offset,
          embeddingLength: embedding.length,
          flatEmbLength: flatEmb.length,
          bufferIndex: i,
          embeddingBufferSize: resources.dims.embeddingBufferSize,
          embeddingDimension: resources.dims.embeddingDimension
        });
        throw new Error('offset is out of bounds');
      }
      
      flatEmb.set(embedding, offset);
    }
    
    // 為檢測器創建張量
    const finalTensor = createTensor(
      'float32', 
      flatEmb, 
      [1, resources.dims.embeddingBufferSize, resources.dims.embeddingDimension]
    );
    
    // 執行檢測器模型
    const detOut = await resources.detector.run({
      [resources.detector.inputNames[0]]: finalTensor
    });
    
    score = (detOut[resources.detector.outputNames[0]] as Tensor).data[0] as number;
    
    // 調試輸出
    if (score > 0.05 || Math.random() < 0.01) {  // 偶爾輸出或當分數較高時
      console.log(`[Wakeword] Detection score: ${score.toFixed(4)}, threshold: ${params.threshold}`);
    }
    
    // 按步長滑動梅爾緩衝區
    melBuffer.splice(0, melStride);
  }
  
  // 檢查是否觸發喚醒詞
  const triggered = score > params.threshold;
  
  if (triggered) {
    console.log(`[Wakeword] TRIGGERED! Score: ${score.toFixed(4)} > ${params.threshold}`);
    
    // 發出喚醒詞檢測事件
    wakewordEvents.dispatchEvent(new CustomEvent('wakeword-detected', {
      detail: { 
        word: 'detected', // Word name should be provided by the caller context
        score: score,
        timestamp: Date.now()
      }
    }));
  }
  
  // 返回檢測結果與更新的狀態
  const state: WakewordState = { 
    melBuffer, 
    embeddingBuffer 
  };
  
  return { 
    score, 
    triggered, 
    state 
  };
  
  } catch (error) {
    // 發出處理錯誤事件
    wakewordEvents.dispatchEvent(new CustomEvent('processing-error', {
      detail: { 
        error: error as Error, 
        context: 'processWakewordChunk' 
      }
    }));
    throw error; // 重新拋出錯誤以保持原有行為
  }
}

/**
 * 重設喚醒詞狀態
 * 
 * @description 在檢測到喚醒詞後重設狀態，清空所有緩衝區
 * @param dims - 模型維度配置
 * @param dims.embeddingBufferSize - 嵌入緩衝區大小
 * @param dims.embeddingDimension - 嵌入向量維度
 * @returns WakewordState - 重設後的喚醒詞狀態
 * 
 * @example
 * ```typescript
 * if (result.triggered) {
 *   // 檢測到喚醒詞後重設狀態
 *   wakewordState = resetWakewordState(resources.dims);
 * }
 * ```
 */
export function resetWakewordState(
  dims: { embeddingBufferSize: number; embeddingDimension: number }
): WakewordState {
  return createWakewordState(dims);
}

/**
 * 創建預設的喚醒詞參數
 * 
 * @description 從 ConfigManager 創建預設的喚醒詞參數配置
 * @param wakewordName - 喚醒詞名稱（'hey_jarvis' | 'hey_mycroft' | 'alexa'）
 * @param config - 可選的配置管理器實例
 * @returns WakewordParams - 喚醒詞參數配置
 * 
 * @example
 * ```typescript
 * // 使用預設配置
 * const params = createDefaultWakewordParams('hey_jarvis');
 * 
 * // 使用自訂配置
 * const config = new ConfigManager();
 * config.wakeword.hey_jarvis.threshold = 0.6;
 * const params = createDefaultWakewordParams('hey_jarvis', config);
 * ```
 */
export function createDefaultWakewordParams(
  wakewordName: 'hey_jarvis' | 'hey_mycroft' | 'alexa' = 'hey_jarvis',
  config?: ConfigManager
): WakewordParams {
  const cfg = config || new ConfigManager();
  
  return {
    threshold: cfg.wakeword[wakewordName].threshold,
    melFramesPerChunk: cfg.wakeword.common.melFramesPerChunk,
    requiredMelFrames: cfg.wakeword.common.requiredMelFrames,
    melStride: cfg.wakeword.common.melStride,
  };
}