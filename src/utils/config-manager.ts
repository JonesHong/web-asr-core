/**
 * 配置管理器
 * 
 * 集中管理 WebASRCore 所有服務的配置參數，提供統一的配置介面。
 * 所有配置項都使用公開屬性，方便直接存取和修改。
 * 
 * @fileoverview 配置管理器實現
 * @author WebASRCore Team
 */

/**
 * 配置管理器類
 * 
 * @description 提供 VAD、喚醒詞和 Whisper 服務的集中配置管理
 * @class ConfigManager
 * 
 * @example
 * ```typescript
 * // 創建配置管理器實例
 * const config = new ConfigManager();
 * 
 * // 修改 VAD 配置
 * config.vad.threshold = 0.6;
 * config.vad.hangoverFrames = 15;
 * 
 * // 修改喚醒詞配置
 * config.wakeword.hey_jarvis.threshold = 0.6;
 * 
 * // 修改 Whisper 配置
 * config.whisper.language = 'zh';
 * ```
 */
export class ConfigManager {
  /**
   * 單例實例（如需全域共用，請使用 ConfigManager.getInstance()）
   *
   * 使用 null 初始值以清楚表示尚未建立實例
   */
  private static _instance: ConfigManager | null = null;

  /**
   * 取得或建立單例配置管理器
   * @param overrides - 選擇性的覆蓋配置（只在首次建立時應用，或傳入時會合併到現有實例）
   */
  public static getInstance(overrides?: Partial<ConfigManager>): ConfigManager {
    if (!ConfigManager._instance) {
      ConfigManager._instance = new ConfigManager(overrides);
    } else if (overrides) {
      // 若已存在實例且提供 overrides，合併覆蓋到現有單例
      ConfigManager._instance.applyOverrides(overrides);
    }
    return ConfigManager._instance;
  }

  /**
   * VAD（語音活動檢測）配置
   * 
   * @description Silero VAD v6 模型的配置參數
   */
  public vad = {
    /**
     * VAD 模型檔案路徑
     * @default './models/silero_vad_v6.onnx'
     */
    modelPath: './models/silero_vad_v6.onnx',
    
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
    sampleRate: 16000,
    
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
    contextSize: 64,
  };

  /**
   * 喚醒詞檢測配置
   * 
   * @description OpenWakeWord 模型的配置參數，支援多個喚醒詞
   */
  public wakeword = {
    /**
     * Hey Jarvis 喚醒詞配置
     */
    hey_jarvis: {
      /**
       * 檢測器模型路徑
       * @default './models/hey_jarvis_v0.1.onnx'
       */
      detectorPath: './models/hey_jarvis_v0.1.onnx',
      
      /**
       * 梅爾頻譜圖模型路徑
       * @default './models/melspectrogram.onnx'
       */
      melspecPath: './models/melspectrogram.onnx',
      
      /**
       * 嵌入模型路徑
       * @default './models/embedding_model.onnx'
       */
      embeddingPath: './models/embedding_model.onnx',
      
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
      enabled: true,
    },
    
    /**
     * Hey Mycroft 喚醒詞配置
     */
    hey_mycroft: {
      /**
       * 檢測器模型路徑
       * @default './models/hey_mycroft_v0.1.onnx'
       */
      detectorPath: './models/hey_mycroft_v0.1.onnx',
      
      /**
       * 梅爾頻譜圖模型路徑（共用）
       * @default './models/melspectrogram.onnx'
       */
      melspecPath: './models/melspectrogram.onnx',
      
      /**
       * 嵌入模型路徑（共用）
       * @default './models/embedding_model.onnx'
       */
      embeddingPath: './models/embedding_model.onnx',
      
      /**
       * 喚醒詞觸發閾值（0-1）
       * @default 0.5
       */
      threshold: 0.5,
      
      /**
       * 是否啟用此喚醒詞
       * @default false
       */
      enabled: false,
    },
    
    /**
     * Alexa 喚醒詞配置
     */
    alexa: {
      /**
       * 檢測器模型路徑
       * @default './models/alexa_v0.1.onnx'
       */
      detectorPath: './models/alexa_v0.1.onnx',
      
      /**
       * 梅爾頻譜圖模型路徑（共用）
       * @default './models/melspectrogram.onnx'
       */
      melspecPath: './models/melspectrogram.onnx',
      
      /**
       * 嵌入模型路徑（共用）
       * @default './models/embedding_model.onnx'
       */
      embeddingPath: './models/embedding_model.onnx',
      
      /**
       * 喚醒詞觸發閾值（0-1）
       * @default 0.5
       */
      threshold: 0.5,
      
      /**
       * 是否啟用此喚醒詞
       * @default false
       */
      enabled: false,
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
      embeddingDimension: 96,
    },
  };

  /**
   * Whisper 語音辨識配置
   * 
   * @description Whisper 模型的配置參數，使用 transformers.js
   */
  public whisper = {
    /**
     * 模型識別符或路徑
     * @description HuggingFace 模型 ID 或本地模型路徑
     * @default 'Xenova/whisper-tiny'
     */
    modelPath: 'Xenova/whisper-tiny',
    
    /**
     * 是否使用量化模型
     * @description 量化模型檔案較小但精度略低
     * @default true
     */
    quantized: true,
    
    /**
     * 執行裝置
     * @description 選擇模型執行的裝置
     * @default 'auto'
     * @options 'webgpu' - 使用 GPU 加速（需要瀏覽器支援 WebGPU）
     * @options 'wasm' - 使用 CPU（通過 WebAssembly）
     * @options 'auto' - 自動選擇最佳可用裝置
     */
    device: 'auto' as 'webgpu' | 'wasm' | 'auto',
    
    /**
     * 資料類型（量化程度）
     * @description 控制模型精度和大小的權衡
     * @default 'q8'
     * @options 'fp32' - 32位浮點數（最高精度，WebGPU 預設）
     * @options 'fp16' - 16位浮點數（中等精度）
     * @options 'q8' - 8位量化（平衡精度和大小，WASM 預設）
     * @options 'q4' - 4位量化（最小檔案大小）
     */
    dtype: 'q8' as 'fp32' | 'fp16' | 'q8' | 'q4',
    
    /**
     * 預設語言代碼
     * @description ISO 639-1 語言代碼，如 'en', 'zh', 'ja'
     * @default 'zh'
     */
    language: 'zh',
    
    /**
     * 預設任務類型
     * @description 'transcribe' 轉錄原語言，'translate' 翻譯成英文
     * @default 'transcribe'
     */
    task: 'transcribe' as 'transcribe' | 'translate',
    
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
    localBasePath: undefined as string | undefined,
    
    /**
     * ONNX Runtime WASM 檔案路徑
     * @description 可選的 WASM 檔案路徑配置
     * @default undefined
     */
    wasmPaths: undefined as string | undefined,
    
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
      overlapSeconds: 5,
    },
  };

  /**
   * ONNX Runtime 配置
   * 
   * @description ONNX Runtime Web 的執行配置
   */
  public onnx = {
    /**
     * 執行提供者優先順序
     * @description 按優先順序嘗試的執行提供者
     * @default ['webgpu', 'wasm']
     */
    executionProviders: ['webgpu', 'wasm'] as Array<'webgpu' | 'wasm' | 'webgl' | 'cpu'>,
    
    /**
     * 是否使用 Web Worker
     * @description 在 Web Worker 中執行模型推論以避免阻塞主執行緒
     * @default true
     */
    useWebWorker: true,
    
    /**
     * WebGPU 配置
     */
    webgpu: {
      /**
       * 是否啟用 WebGPU
       * @description 當瀏覽器支援時使用 GPU 加速
       * @default true
       */
      enabled: true,
      
      /**
       * 裝置偏好
       * @description 'high-performance' 或 'low-power'
       * @default 'high-performance'
       */
      powerPreference: 'high-performance' as 'high-performance' | 'low-power',
      
      /**
       * 強制使用回退
       * @description 當 WebGPU 不可用時是否強制使用 WASM
       * @default true
       */
      forceFallback: true,
    },
    
    /**
     * WASM 配置
     */
    wasm: {
      /**
       * SIMD 支援
       * @description 使用 SIMD 指令集加速（如果支援）
       * @default true
       */
      simd: true,
      
      /**
       * 執行緒數
       * @description Web Worker 執行緒數（0 = 自動）
       * @default 0
       */
      numThreads: 0,
      
      /**
       * WASM 檔案路徑
       * @description 自訂 WASM 檔案位置
       * @default undefined
       */
      wasmPaths: undefined as string | undefined,
    },
    
    /**
     * 圖優化選項
     */
    graphOptimization: {
      /**
       * 優化等級
       * @description 'disabled' | 'basic' | 'extended' | 'all'
       * @default 'all'
       */
      level: 'all' as 'disabled' | 'basic' | 'extended' | 'all',
      
      /**
       * 是否啟用記憶體模式優化
       * @description 減少記憶體使用但可能影響速度
       * @default false
       */
      enableMemPattern: false,
      
      /**
       * 是否啟用 CPU 記憶體區域
       * @description 在 CPU 和 GPU 之間共享記憶體
       * @default false
       */
      enableCpuMemArena: false,
    },
    
    /**
     * 模型快取配置
     */
    modelCache: {
      /**
       * 是否啟用模型快取
       * @description 快取已載入的模型以加快後續載入
       * @default true
       */
      enabled: true,
      
      /**
       * 快取大小限制（MB）
       * @description 最大快取大小
       * @default 100
       */
      maxSize: 100,
    },
  };

  /**
   * 全域音訊處理配置
   * 
   * @description 適用於所有服務的通用音訊參數
   */
  public audio = {
    /**
     * 全域採樣率（Hz）
     * @description 所有音訊處理的標準採樣率
     * @default 16000
     */
    sampleRate: 16000,
    
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
    bitDepth: 32,
  };

  /**
   * 效能與資源配置
   * 
   * @description 控制資源使用和效能優化的參數
   */
  public performance = {
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
    executionProviders: ['wasm'],
    
    /**
     * 圖優化級別
     * @description ONNX Runtime 圖優化級別：'disabled', 'basic', 'extended', 'all'
     * @default 'all'
     */
    graphOptimizationLevel: 'all' as 'disabled' | 'basic' | 'extended' | 'all',
  };

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
  constructor(overrides?: Partial<ConfigManager>) {
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
  private applyOverrides(overrides: Partial<ConfigManager>): void {
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
  public toJSON(): string {
    return JSON.stringify({
      vad: this.vad,
      wakeword: this.wakeword,
      whisper: this.whisper,
      audio: this.audio,
      performance: this.performance,
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
  public fromJSON(json: string): void {
    try {
      const parsed = JSON.parse(json);
      this.applyOverrides(parsed);
    } catch (error) {
      console.error('無法解析配置 JSON:', error);
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
  public reset(): void {
    const defaultConfig = new ConfigManager();
    this.vad = defaultConfig.vad;
    this.wakeword = defaultConfig.wakeword;
    this.whisper = defaultConfig.whisper;
    this.audio = defaultConfig.audio;
    this.performance = defaultConfig.performance;
  }
}

/**
 * 預設配置管理器實例
 * 
 * @description 提供一個全域共用的預設配置實例
 * @example
 * ```typescript
 * import { defaultConfig } from './config-manager';
 * 
 * // 使用預設配置
 * const threshold = defaultConfig.vad.threshold;
 * ```
 */
export const defaultConfig = ConfigManager.getInstance();