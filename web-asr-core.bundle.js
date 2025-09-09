var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/types/audio.ts
var STANDARD_AUDIO_CONFIG = {
  sampleRate: 16e3,
  // 16kHz 取樣率
  channels: 1
  // 單聲道
};
var STANDARD_CHUNK_SIZE = 1280;

// src/types/vad.ts
var DEFAULT_VAD_PARAMS = {
  sampleRate: 16e3,
  // 16kHz 取樣率
  threshold: 0.5,
  // 50% 檢測閾值
  hangoverFrames: 12
  // 12 幀延遲（約 750ms）
};

// src/types/wakeword.ts
var DEFAULT_WAKEWORD_PARAMS = {
  threshold: 0.5,
  // 50% 檢測閾值
  melFramesPerChunk: 5,
  // 每塊 5 個梅爾幀
  requiredMelFrames: 76,
  // 需要 76 個梅爾幀進行嵌入
  melStride: 8
  // 滑動窗口步長 8
};

// src/registry/registry.ts
async function loadRegistry(url = "./models/global_registry.json") {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load registry: ${response.status}`);
  }
  return await response.json();
}
function resolveWakeword(registry, defaultId = "hey-jarvis") {
  const models = registry.models.filter((m) => m.type === "wakeword");
  if (models.length === 0) {
    throw new Error("No wake word models found in registry");
  }
  const chosen = models.find((m) => m.id === defaultId) || models[0];
  const base = "models/" + chosen.local_path;
  const dir = base.endsWith(".onnx") ? base.substring(0, base.lastIndexOf("/")) : base;
  const embeddingFile = chosen.files?.required?.find((f) => f.includes("embedding"));
  const melFile = chosen.files?.required?.find((f) => f.includes("melspectrogram"));
  if (!embeddingFile || !melFile) {
    throw new Error("Required embedding or melspectrogram files not found in wake word model");
  }
  return {
    id: chosen.id,
    detectorUrl: base,
    threshold: chosen.specs?.threshold ?? 0.5,
    embeddingUrl: `${dir}/${embeddingFile}`,
    melspecUrl: `${dir}/${melFile}`
  };
}
function resolveVad(registry) {
  const vad = registry.models.find((m) => m.type === "vad");
  if (!vad) {
    throw new Error("No VAD model found in registry");
  }
  return {
    id: vad.id,
    modelUrl: "models/" + vad.local_path
  };
}
function resolveWhisper(registry, defaultId = "whisper-base") {
  const asrs = registry.models.filter((m) => m.type === "asr");
  if (asrs.length === 0) {
    throw new Error("No ASR/Whisper models found in registry");
  }
  const chosen = asrs.find((m) => m.id === defaultId) || asrs[0];
  return {
    id: chosen.id,
    path: "models/" + chosen.local_path,
    quantized: chosen.specs?.quantized ?? true,
    name: chosen.name
  };
}
function getAvailableModels(registry, type) {
  return registry.models.filter((m) => m.type === type).map((m) => ({ id: m.id, name: m.name }));
}

// src/runtime/ort.ts
var ortInstance = null;
async function getOrt() {
  if (ortInstance) {
    return ortInstance;
  }
  if (typeof window !== "undefined" && window.ort) {
    ortInstance = window.ort;
    return ortInstance;
  }
  try {
    ortInstance = await import("onnxruntime-web");
    return ortInstance;
  } catch (e) {
    if (typeof window !== "undefined" && window.ort) {
      ortInstance = window.ort;
      return ortInstance;
    }
    throw new Error(
      '\u627E\u4E0D\u5230 ONNX Runtime Web\u3002\u8ACB\u9078\u64C7\u4EE5\u4E0B\u65B9\u5F0F\u4E4B\u4E00\uFF1A\n1. \u901A\u904E CDN \u8F09\u5165: <script src="https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js"><\/script>\n2. \u5B89\u88DD npm \u5957\u4EF6: npm install onnxruntime-web'
    );
  }
}
async function initializeOrt() {
  await getOrt();
}
function getOrtSync() {
  if (!ortInstance) {
    if (typeof window !== "undefined" && window.ort) {
      ortInstance = window.ort;
      return ortInstance;
    }
    throw new Error("ONNX Runtime \u672A\u521D\u59CB\u5316\u3002\u8ACB\u5148\u547C\u53EB initializeOrt() \u6216\u901A\u904E CDN \u8F09\u5165\u3002");
  }
  return ortInstance;
}
function createTensor(type, data, dims) {
  const ort = getOrtSync();
  return new ort.Tensor(type, data, dims);
}
async function loadOnnxFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`\u5F9E ${url} \u8F09\u5165\u6A21\u578B\u5931\u6557: ${response.status}`);
  }
  return await response.arrayBuffer();
}
async function createSession(modelUrl, sessionOptions) {
  try {
    const ort = await getOrt();
    const modelData = await loadOnnxFromUrl(modelUrl);
    const options = sessionOptions || {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all"
    };
    return await ort.InferenceSession.create(modelData, options);
  } catch (error) {
    throw new Error(`\u70BA ${modelUrl} \u5275\u5EFA\u6703\u8A71\u5931\u6557: ${error}`);
  }
}
async function createSessions(modelUrls, sessionOptions) {
  return await Promise.all(
    modelUrls.map((url) => createSession(url, sessionOptions))
  );
}
function getSessionMetadata(session) {
  const inputNames = session.inputNames;
  const outputNames = session.outputNames;
  const inputShapes = inputNames.map(() => void 0);
  const outputShapes = outputNames.map(() => void 0);
  return {
    inputNames: [...inputNames],
    outputNames: [...outputNames],
    inputShapes,
    outputShapes
  };
}

// src/utils/config-manager.ts
var ConfigManager = class _ConfigManager {
  /**
   * 建構函數
   * 
   * @description 創建配置管理器實例，可選擇性覆蓋預設配置
   * @param overrides - 要覆蓋的配置項
   * 
   * @example
   * ```typescript
   * // 使用預設配置
   * const config = new ConfigManager();
   * 
   * // 覆蓋部分配置
   * const config = new ConfigManager({
   *   vad: { threshold: 0.6 },
   *   whisper: { language: 'en' }
   * });
   * ```
   */
  constructor(overrides) {
    /**
     * VAD（語音活動檢測）配置
     * 
     * @description Silero VAD v6 模型的配置參數
     */
    __publicField(this, "vad", {
      /**
       * VAD 模型檔案路徑
       * @default './models/silero_vad_v6.onnx'
       */
      modelPath: "./models/silero_vad_v6.onnx",
      /**
       * 語音檢測閾值（0-1）
       * @description 高於此值判定為語音，低於此值判定為靜音
       * @default 0.5
       */
      threshold: 0.5,
      /**
       * 語音結束後的延遲幀數
       * @description 檢測到靜音後繼續保持活動狀態的幀數，防止語音過早截斷
       * @default 12
       */
      hangoverFrames: 12,
      /**
       * 音訊採樣率（Hz）
       * @description VAD 模型預期的輸入音訊採樣率
       * @default 16000
       */
      sampleRate: 16e3,
      /**
       * 每個音訊塊的樣本數
       * @description 對應 32ms 的音訊（16kHz * 0.032）
       * @default 512
       */
      windowSize: 512,
      /**
       * 上下文樣本數
       * @description 前一塊的尾部樣本數，用於平滑處理
       * @default 64
       */
      contextSize: 64
    });
    /**
     * 喚醒詞檢測配置
     * 
     * @description OpenWakeWord 模型的配置參數，支援多個喚醒詞
     */
    __publicField(this, "wakeword", {
      /**
       * Hey Jarvis 喚醒詞配置
       */
      hey_jarvis: {
        /**
         * 檢測器模型路徑
         * @default './models/hey_jarvis_v0.1.onnx'
         */
        detectorPath: "./models/hey_jarvis_v0.1.onnx",
        /**
         * 梅爾頻譜圖模型路徑
         * @default './models/melspectrogram.onnx'
         */
        melspecPath: "./models/melspectrogram.onnx",
        /**
         * 嵌入模型路徑
         * @default './models/embedding_model.onnx'
         */
        embeddingPath: "./models/embedding_model.onnx",
        /**
         * 喚醒詞觸發閾值（0-1）
         * @description 高於此值觸發喚醒詞檢測
         * @default 0.5
         */
        threshold: 0.5,
        /**
         * 是否啟用此喚醒詞
         * @default true
         */
        enabled: true
      },
      /**
       * Hey Mycroft 喚醒詞配置
       */
      hey_mycroft: {
        /**
         * 檢測器模型路徑
         * @default './models/hey_mycroft_v0.1.onnx'
         */
        detectorPath: "./models/hey_mycroft_v0.1.onnx",
        /**
         * 梅爾頻譜圖模型路徑（共用）
         * @default './models/melspectrogram.onnx'
         */
        melspecPath: "./models/melspectrogram.onnx",
        /**
         * 嵌入模型路徑（共用）
         * @default './models/embedding_model.onnx'
         */
        embeddingPath: "./models/embedding_model.onnx",
        /**
         * 喚醒詞觸發閾值（0-1）
         * @default 0.5
         */
        threshold: 0.5,
        /**
         * 是否啟用此喚醒詞
         * @default false
         */
        enabled: false
      },
      /**
       * Alexa 喚醒詞配置
       */
      alexa: {
        /**
         * 檢測器模型路徑
         * @default './models/alexa_v0.1.onnx'
         */
        detectorPath: "./models/alexa_v0.1.onnx",
        /**
         * 梅爾頻譜圖模型路徑（共用）
         * @default './models/melspectrogram.onnx'
         */
        melspecPath: "./models/melspectrogram.onnx",
        /**
         * 嵌入模型路徑（共用）
         * @default './models/embedding_model.onnx'
         */
        embeddingPath: "./models/embedding_model.onnx",
        /**
         * 喚醒詞觸發閾值（0-1）
         * @default 0.5
         */
        threshold: 0.5,
        /**
         * 是否啟用此喚醒詞
         * @default false
         */
        enabled: false
      },
      /**
       * 通用喚醒詞處理參數
       */
      common: {
        /**
         * 每個音訊塊的梅爾幀數
         * @description 每個 80ms 音訊塊產生的梅爾頻譜圖幀數
         * @default 5
         */
        melFramesPerChunk: 5,
        /**
         * 嵌入所需的梅爾幀數
         * @description 進行嵌入計算所需的最小梅爾幀數
         * @default 76
         */
        requiredMelFrames: 76,
        /**
         * 滑動窗口步長
         * @description 梅爾緩衝區的滑動步長
         * @default 8
         */
        melStride: 8,
        /**
         * 音訊塊大小（樣本數）
         * @description 對應 80ms 的音訊（16kHz * 0.08）
         * @default 1280
         */
        chunkSize: 1280,
        /**
         * 嵌入緩衝區大小
         * @description 嵌入向量的時間步數
         * @default 16
         */
        embeddingBufferSize: 16,
        /**
         * 嵌入向量維度
         * @description 每個嵌入向量的特徵維度
         * @default 96
         */
        embeddingDimension: 96
      }
    });
    /**
     * Whisper 語音辨識配置
     * 
     * @description Whisper 模型的配置參數，使用 transformers.js
     */
    __publicField(this, "whisper", {
      /**
       * 模型識別符或路徑
       * @description HuggingFace 模型 ID 或本地模型路徑
       * @default 'Xenova/whisper-tiny'
       */
      modelPath: "Xenova/whisper-tiny",
      /**
       * 是否使用量化模型
       * @description 量化模型檔案較小但精度略低
       * @default true
       */
      quantized: true,
      /**
       * 預設語言代碼
       * @description ISO 639-1 語言代碼，如 'en', 'zh', 'ja'
       * @default 'zh'
       */
      language: "zh",
      /**
       * 預設任務類型
       * @description 'transcribe' 轉錄原語言，'translate' 翻譯成英文
       * @default 'transcribe'
       */
      task: "transcribe",
      /**
       * 是否返回時間戳片段
       * @description 啟用後返回每個片段的開始和結束時間
       * @default false
       */
      returnSegments: false,
      /**
       * 本地模型基礎路徑
       * @description 如果使用本地模型，指定模型檔案的基礎路徑
       * @default undefined
       */
      localBasePath: void 0,
      /**
       * ONNX Runtime WASM 檔案路徑
       * @description 可選的 WASM 檔案路徑配置
       * @default undefined
       */
      wasmPaths: void 0,
      /**
       * 音訊分塊設定
       */
      chunking: {
        /**
         * 每個音訊塊的長度（秒）
         * @description 用於長音訊的分塊處理
         * @default 30
         */
        chunkSizeSeconds: 30,
        /**
         * 塊間重疊長度（秒）
         * @description 防止邊界處的語音被截斷
         * @default 5
         */
        overlapSeconds: 5
      }
    });
    /**
     * 全域音訊處理配置
     * 
     * @description 適用於所有服務的通用音訊參數
     */
    __publicField(this, "audio", {
      /**
       * 全域採樣率（Hz）
       * @description 所有音訊處理的標準採樣率
       * @default 16000
       */
      sampleRate: 16e3,
      /**
       * 音訊通道數
       * @description 1 為單聲道，2 為立體聲
       * @default 1
       */
      channels: 1,
      /**
       * 音訊位元深度
       * @description 每個樣本的位元數
       * @default 32
       */
      bitDepth: 32
    });
    /**
     * 效能與資源配置
     * 
     * @description 控制資源使用和效能優化的參數
     */
    __publicField(this, "performance", {
      /**
       * 是否啟用 WebWorker
       * @description 在背景執行緒執行推論以避免阻塞主執行緒
       * @default true
       */
      useWebWorker: true,
      /**
       * 最大並行推論數
       * @description 同時執行的最大推論任務數
       * @default 2
       */
      maxConcurrentInferences: 2,
      /**
       * 是否啟用模型快取
       * @description 快取載入的模型以加快後續使用
       * @default true
       */
      enableModelCaching: true,
      /**
       * ONNX Runtime 執行提供者
       * @description 優先順序列表，如 ['wasm', 'webgl']
       * @default ['wasm']
       */
      executionProviders: ["wasm"],
      /**
       * 圖優化級別
       * @description ONNX Runtime 圖優化級別：'disabled', 'basic', 'extended', 'all'
       * @default 'all'
       */
      graphOptimizationLevel: "all"
    });
    if (overrides) {
      this.applyOverrides(overrides);
    }
  }
  /**
   * 應用配置覆蓋
   * 
   * @description 深度合併覆蓋配置到當前配置
   * @param overrides - 要覆蓋的配置項
   * @private
   */
  applyOverrides(overrides) {
    if (overrides.vad) {
      Object.assign(this.vad, overrides.vad);
    }
    if (overrides.wakeword) {
      if (overrides.wakeword.hey_jarvis) {
        Object.assign(this.wakeword.hey_jarvis, overrides.wakeword.hey_jarvis);
      }
      if (overrides.wakeword.hey_mycroft) {
        Object.assign(this.wakeword.hey_mycroft, overrides.wakeword.hey_mycroft);
      }
      if (overrides.wakeword.alexa) {
        Object.assign(this.wakeword.alexa, overrides.wakeword.alexa);
      }
      if (overrides.wakeword.common) {
        Object.assign(this.wakeword.common, overrides.wakeword.common);
      }
    }
    if (overrides.whisper) {
      Object.assign(this.whisper, overrides.whisper);
      if (overrides.whisper.chunking) {
        Object.assign(this.whisper.chunking, overrides.whisper.chunking);
      }
    }
    if (overrides.audio) {
      Object.assign(this.audio, overrides.audio);
    }
    if (overrides.performance) {
      Object.assign(this.performance, overrides.performance);
    }
  }
  /**
   * 獲取當前配置的 JSON 表示
   * 
   * @description 將配置對象轉換為 JSON 字符串，便於儲存或傳輸
   * @returns 配置的 JSON 字符串
   * 
   * @example
   * ```typescript
   * const config = new ConfigManager();
   * const json = config.toJSON();
   * console.log(json);
   * ```
   */
  toJSON() {
    return JSON.stringify({
      vad: this.vad,
      wakeword: this.wakeword,
      whisper: this.whisper,
      audio: this.audio,
      performance: this.performance
    }, null, 2);
  }
  /**
   * 從 JSON 載入配置
   * 
   * @description 從 JSON 字符串載入配置並覆蓋當前設定
   * @param json - 配置的 JSON 字符串
   * 
   * @example
   * ```typescript
   * const config = new ConfigManager();
   * const savedConfig = localStorage.getItem('webASRConfig');
   * if (savedConfig) {
   *   config.fromJSON(savedConfig);
   * }
   * ```
   */
  fromJSON(json) {
    try {
      const parsed = JSON.parse(json);
      this.applyOverrides(parsed);
    } catch (error) {
      console.error("\u7121\u6CD5\u89E3\u6790\u914D\u7F6E JSON:", error);
    }
  }
  /**
   * 重設為預設配置
   * 
   * @description 將所有配置項重設為預設值
   * 
   * @example
   * ```typescript
   * const config = new ConfigManager();
   * config.vad.threshold = 0.8;  // 修改配置
   * config.reset();  // 重設為預設值
   * console.log(config.vad.threshold);  // 0.5
   * ```
   */
  reset() {
    const defaultConfig2 = new _ConfigManager();
    this.vad = defaultConfig2.vad;
    this.wakeword = defaultConfig2.wakeword;
    this.whisper = defaultConfig2.whisper;
    this.audio = defaultConfig2.audio;
    this.performance = defaultConfig2.performance;
  }
};
var defaultConfig = new ConfigManager();

// src/services/vad.ts
async function loadVadSession(modelUrl, sessionOptions, config) {
  const cfg = config || new ConfigManager();
  const url = modelUrl || cfg.vad.modelPath;
  const options = sessionOptions || {
    executionProviders: cfg.performance.executionProviders,
    graphOptimizationLevel: cfg.performance.graphOptimizationLevel
  };
  return await createSession(url, options);
}
function createVadState(config) {
  const cfg = config || new ConfigManager();
  const stateSize = 2 * 1 * 128;
  return {
    state: new Float32Array(stateSize),
    // 零初始化
    contextSamples: new Float32Array(cfg.vad.contextSize),
    // 上下文樣本
    hangoverCounter: 0,
    // 延遲計數器
    isSpeechActive: false
    // 語音活動狀態
  };
}
async function processVad(session, prevState, audio, params, config) {
  const cfg = config || new ConfigManager();
  const windowSize = cfg.vad.windowSize;
  const contextSize = cfg.vad.contextSize;
  const effectiveWindowSize = windowSize + contextSize;
  const inputData = new Float32Array(effectiveWindowSize);
  inputData.set(prevState.contextSamples, 0);
  inputData.set(audio.slice(0, windowSize), contextSize);
  const inputTensor = createTensor("float32", inputData, [1, effectiveWindowSize]);
  const stateTensor = createTensor("float32", prevState.state, [2, 1, 128]);
  const srTensor = createTensor("int64", new BigInt64Array([BigInt(params.sampleRate)]), [1]);
  const feeds = {
    input: inputTensor,
    state: stateTensor,
    sr: srTensor
  };
  const results = await session.run(feeds);
  const outputData = results.output;
  const score = outputData.data[0];
  const stateN = results.stateN;
  const newState = new Float32Array(stateN.data);
  const newContextSamples = new Float32Array(contextSize);
  const startIdx = windowSize - contextSize;
  newContextSamples.set(audio.slice(startIdx, startIdx + contextSize));
  let isSpeechActive = prevState.isSpeechActive;
  let hangoverCounter = prevState.hangoverCounter;
  const vadDetected = score > params.threshold;
  if (vadDetected) {
    isSpeechActive = true;
    hangoverCounter = params.hangoverFrames;
  } else if (isSpeechActive) {
    hangoverCounter -= 1;
    if (hangoverCounter <= 0) {
      isSpeechActive = false;
    }
  }
  const state = {
    state: newState,
    contextSamples: newContextSamples,
    hangoverCounter,
    isSpeechActive
  };
  return {
    detected: vadDetected,
    score,
    state
  };
}
async function processVadChunks(session, chunks, initialState, params, config) {
  const results = [];
  let state = initialState;
  for (const chunk of chunks) {
    const result = await processVad(session, state, chunk, params, config);
    results.push(result);
    state = result.state;
  }
  return results;
}
function createDefaultVadParams(config) {
  const cfg = config || new ConfigManager();
  return {
    threshold: cfg.vad.threshold,
    hangoverFrames: cfg.vad.hangoverFrames,
    sampleRate: cfg.vad.sampleRate
  };
}

// src/services/wakeword.ts
async function loadWakewordResources(wakewordName = "hey_jarvis", config, customPaths) {
  const cfg = config || new ConfigManager();
  const paths = customPaths || {
    detectorUrl: cfg.wakeword[wakewordName].detectorPath,
    melspecUrl: cfg.wakeword[wakewordName].melspecPath,
    embeddingUrl: cfg.wakeword[wakewordName].embeddingPath
  };
  const [detector, melspec, embedding] = await createSessions([
    paths.detectorUrl,
    paths.melspecUrl,
    paths.embeddingUrl
  ]);
  const resources = {
    detector,
    melspec,
    embedding,
    dims: {
      embeddingBufferSize: cfg.wakeword.common.embeddingBufferSize,
      embeddingDimension: cfg.wakeword.common.embeddingDimension
    }
  };
  const dims = detectWakewordDims(resources, cfg);
  resources.dims = dims;
  return resources;
}
function detectWakewordDims(resources, config) {
  const cfg = config || new ConfigManager();
  const inputNames = resources.detector.inputNames;
  let embeddingBufferSize = cfg.wakeword.common.embeddingBufferSize;
  let embeddingDimension = cfg.wakeword.common.embeddingDimension;
  try {
    const inputName = inputNames[0];
  } catch (error) {
    console.warn("\u7121\u6CD5\u6AA2\u6E2C\u7DAD\u5EA6\uFF0C\u4F7F\u7528\u9810\u8A2D\u503C:", error);
  }
  return { embeddingBufferSize, embeddingDimension };
}
function createWakewordState(dims) {
  const embeddingBuffer = [];
  for (let i = 0; i < dims.embeddingBufferSize; i++) {
    embeddingBuffer.push(new Float32Array(dims.embeddingDimension));
  }
  return {
    melBuffer: [],
    // 梅爾頻譜幀緩衝區（每幀 32 維）
    embeddingBuffer
    // 嵌入向量緩衝區
  };
}
async function processWakewordChunk(resources, prevState, audio, params, config) {
  const cfg = config || new ConfigManager();
  const melFramesPerChunk = params.melFramesPerChunk ?? cfg.wakeword.common.melFramesPerChunk;
  const requiredMelFrames = params.requiredMelFrames ?? cfg.wakeword.common.requiredMelFrames;
  const melStride = params.melStride ?? cfg.wakeword.common.melStride;
  const melBuffer = prevState.melBuffer.map((frame) => new Float32Array(frame));
  let embeddingBuffer = prevState.embeddingBuffer.map((embedding) => new Float32Array(embedding));
  let score = 0;
  const audioTensor = createTensor("float32", audio, [1, audio.length]);
  const melOut = await resources.melspec.run({
    [resources.melspec.inputNames[0]]: audioTensor
  });
  const melData = melOut[resources.melspec.outputNames[0]].data;
  const scaledMel = new Float32Array(melData.length);
  for (let j = 0; j < melData.length; j++) {
    scaledMel[j] = melData[j] / 10 + 2;
  }
  const melDim = 32;
  for (let j = 0; j < melFramesPerChunk; j++) {
    const frame = new Float32Array(scaledMel.slice(j * melDim, (j + 1) * melDim));
    melBuffer.push(frame);
  }
  if (melBuffer.length >= requiredMelFrames) {
    const windowFrames = melBuffer.slice(0, requiredMelFrames);
    const flatMel = new Float32Array(requiredMelFrames * melDim);
    for (let i = 0; i < windowFrames.length; i++) {
      flatMel.set(windowFrames[i], i * melDim);
    }
    const melTensor = createTensor("float32", flatMel, [1, requiredMelFrames, melDim, 1]);
    const embOut = await resources.embedding.run({
      [resources.embedding.inputNames[0]]: melTensor
    });
    const newEmbedding = embOut[resources.embedding.outputNames[0]].data;
    embeddingBuffer = embeddingBuffer.slice(1);
    embeddingBuffer.push(new Float32Array(newEmbedding));
    const flatEmb = new Float32Array(
      resources.dims.embeddingBufferSize * resources.dims.embeddingDimension
    );
    for (let i = 0; i < embeddingBuffer.length; i++) {
      flatEmb.set(embeddingBuffer[i], i * resources.dims.embeddingDimension);
    }
    const finalTensor = createTensor(
      "float32",
      flatEmb,
      [1, resources.dims.embeddingBufferSize, resources.dims.embeddingDimension]
    );
    const detOut = await resources.detector.run({
      [resources.detector.inputNames[0]]: finalTensor
    });
    score = detOut[resources.detector.outputNames[0]].data[0];
    melBuffer.splice(0, melStride);
  }
  const triggered = score > params.threshold;
  const state = {
    melBuffer,
    embeddingBuffer
  };
  return {
    score,
    triggered,
    state
  };
}
function resetWakewordState(dims) {
  return createWakewordState(dims);
}
function createDefaultWakewordParams(wakewordName = "hey_jarvis", config) {
  const cfg = config || new ConfigManager();
  return {
    threshold: cfg.wakeword[wakewordName].threshold,
    melFramesPerChunk: cfg.wakeword.common.melFramesPerChunk,
    requiredMelFrames: cfg.wakeword.common.requiredMelFrames,
    melStride: cfg.wakeword.common.melStride
  };
}

// src/services/whisper.ts
async function loadWhisperResources(modelPathOrId, opts, config) {
  const cfg = config || new ConfigManager();
  const modelId = modelPathOrId || cfg.whisper.modelPath;
  try {
    let pipeline;
    let env;
    if (typeof window !== "undefined" && window.transformers) {
      ({ pipeline, env } = window.transformers);
    } else {
      try {
        ({ pipeline, env } = await import("@xenova/transformers"));
      } catch (importError) {
        if (typeof window !== "undefined" && window.__transformers_module) {
          ({ pipeline, env } = window.__transformers_module);
        } else {
          throw new Error("\u627E\u4E0D\u5230 Transformers.js\u3002\u8ACB\u901A\u904E CDN \u8F09\u5165\u6216\u5B89\u88DD npm \u5957\u4EF6\u3002");
        }
      }
    }
    const localBasePath = opts?.localBasePath || cfg.whisper.localBasePath;
    const wasmPaths = opts?.wasmPaths || cfg.whisper.wasmPaths;
    if (localBasePath) {
      env.localModelPath = localBasePath;
      env.allowRemoteModels = false;
      if (wasmPaths) {
        env.backends.onnx.wasm.wasmPaths = wasmPaths;
      }
    }
    const asr = await pipeline(
      "automatic-speech-recognition",
      modelId,
      {
        quantized: opts?.quantized ?? cfg.whisper.quantized,
        // 如果指定了本地路徑，強制僅使用本地檔案
        ...localBasePath && {
          local_files_only: true,
          cache_dir: localBasePath
        }
      }
    );
    return {
      pipeline: asr,
      modelId
    };
  } catch (error) {
    throw new Error(`\u8F09\u5165 Whisper \u6A21\u578B ${modelId} \u5931\u6557: ${error}`);
  }
}
async function transcribe(resources, audio, options) {
  try {
    const pipelineOptions = {
      // 語言規格
      ...options?.language && { language: options.language },
      // 任務類型（轉錄或翻譯）
      ...options?.task && { task: options.task },
      // 返回片段時間戳
      return_timestamps: options?.returnSegments ?? false,
      // 傳遞任何額外選項
      ...options
    };
    const output = await resources.pipeline(audio, pipelineOptions);
    const result = {
      text: output?.text || ""
    };
    if (options?.returnSegments && output?.chunks) {
      result.segments = output.chunks.map((chunk) => ({
        text: chunk.text || "",
        start: chunk.timestamp?.[0] ?? 0,
        end: chunk.timestamp?.[1] ?? 0
      }));
    }
    return result;
  } catch (error) {
    throw new Error(`\u8A9E\u97F3\u8F49\u9304\u5931\u6557: ${error}`);
  }
}
function chunkAudioForTranscription(audio, chunkSizeSeconds, overlapSeconds, sampleRate, config) {
  const cfg = config || new ConfigManager();
  const chunkSize = (chunkSizeSeconds ?? cfg.whisper.chunking.chunkSizeSeconds) * (sampleRate ?? cfg.audio.sampleRate);
  const overlapSize = (overlapSeconds ?? cfg.whisper.chunking.overlapSeconds) * (sampleRate ?? cfg.audio.sampleRate);
  const chunks = [];
  for (let i = 0; i < audio.length; i += chunkSize - overlapSize) {
    const end = Math.min(i + chunkSize, audio.length);
    chunks.push(audio.slice(i, end));
    if (end >= audio.length) break;
  }
  return chunks;
}
async function transcribeChunks(resources, chunks, options) {
  let totalLength = 0;
  for (const chunk of chunks) {
    totalLength += chunk.length;
  }
  const combined = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return await transcribe(resources, combined, options);
}
function createDefaultWhisperOptions(config) {
  const cfg = config || new ConfigManager();
  return {
    language: cfg.whisper.language,
    task: cfg.whisper.task,
    returnSegments: cfg.whisper.returnSegments
  };
}

// src/index.ts
var VERSION = "0.1.0";
export {
  ConfigManager,
  DEFAULT_VAD_PARAMS,
  DEFAULT_WAKEWORD_PARAMS,
  STANDARD_AUDIO_CONFIG,
  STANDARD_CHUNK_SIZE,
  VERSION,
  chunkAudioForTranscription,
  createDefaultVadParams,
  createDefaultWakewordParams,
  createDefaultWhisperOptions,
  createSession,
  createSessions,
  createTensor,
  createVadState,
  createWakewordState,
  defaultConfig,
  detectWakewordDims,
  getAvailableModels,
  getSessionMetadata,
  initializeOrt,
  loadOnnxFromUrl,
  loadRegistry,
  loadVadSession,
  loadWakewordResources,
  loadWhisperResources,
  processVad,
  processVadChunks,
  processWakewordChunk,
  resetWakewordState,
  resolveVad,
  resolveWakeword,
  resolveWhisper,
  transcribe,
  transcribeChunks
};
/**
 * WebASRCore - VAD、喚醒詞和 Whisper 的無狀態 TypeScript 服務
 * 
 * 為基於瀏覽器的語音處理提供純淨、無狀態服務的集合：
 * - VAD（語音活動檢測）使用 Silero VAD
 * - 使用 OpenWakeWord 模型進行喚醒詞檢測
 * - 通過 transformers.js 使用 Whisper 模型進行語音辨識
 * 
 * 所有服務都採用無狀態的函數式設計，狀態由呼叫者維護並在函數呼叫間傳遞。
 * 
 * @author WebASRCore Team
 * @version 0.1.0
 * @license MIT
 */
//# sourceMappingURL=web-asr-core.bundle.js.map
