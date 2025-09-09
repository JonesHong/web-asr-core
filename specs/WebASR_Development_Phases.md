# WebASR 開發階段與任務清單

## 開發順序總覽

根據指定的開發順序，將專案分為以下主要階段：

1. **Phase 0**: 專案設置與介面定義
2. **Phase 1**: 基礎服務層（無狀態）
3. **Phase 2**: 音頻處理服務
4. **Phase 3**: AI 模型服務 
5. **Phase 4**: 語音辨識服務
6. **Phase 5**: 核心整合與狀態管理
7. **Phase 6**: 測試與優化

---

## Phase 0: 專案設置與介面定義 (2-3 天)

### 0.1 專案架構設置
- [ ] 建立專案目錄結構
  ```
  WebASRCore/
  ├── src/
  │   ├── interfaces/    # TypeScript 介面定義
  │   ├── services/      # 無狀態服務
  │   ├── core/          # 核心整合層
  │   ├── utils/         # 工具函數
  │   └── types/         # 類型定義
  ├── dist/             # 編譯輸出
  ├── tests/            # 測試檔案
  └── examples/         # 使用範例
  ```

- [ ] 設置 TypeScript 環境
  - tsconfig.json 配置
  - 建立編譯腳本
  - 設置 ESM/UMD/IIFE 輸出

- [ ] 設置開發工具
  - ESLint 配置
  - Prettier 配置
  - 建立 npm scripts

### 0.2 核心介面定義
- [ ] 定義 `IAudioQueue` 介面
  ```typescript
  interface IAudioQueue {
    start(): Promise<void>;
    stop(): void;
    pause(): void;
    resume(): void;
    getBuffer(): Float32Array;
    on(event: string, handler: Function): void;
    off(event: string, handler: Function): void;
  }
  ```

- [ ] 定義 `IBufferManager` 介面
  ```typescript
  interface IBufferManager {
    write(data: Float32Array): boolean;
    read(size: number): Float32Array | null;
    available(): number;
    clear(): void;
    isFull(): boolean;
  }
  ```

- [ ] 定義 `IWakeWordDetector` 介面
  ```typescript
  interface IWakeWordDetector {
    init(modelPath: string): Promise<void>;
    process(audioFrame: Float32Array): Promise<number>;
    dispose(): void;
    setThreshold(threshold: number): void;
  }
  ```

- [ ] 定義 `IVADDetector` 介面
  ```typescript
  interface IVADDetector {
    init(modelPath: string): Promise<void>;
    process(audioFrame: Float32Array): Promise<boolean>;
    dispose(): void;
    setThreshold(threshold: number): void;
  }
  ```

- [ ] 定義 `ISpeechRecognizer` 介面
  ```typescript
  interface ISpeechRecognizer {
    init(config: RecognizerConfig): Promise<void>;
    transcribe(audio: Float32Array): Promise<TranscriptionResult>;
    transcribeStreaming(audio: Float32Array): AsyncGenerator<string>;
    dispose(): void;
  }
  ```

- [ ] 定義 `IRecorder` 介面
  ```typescript
  interface IRecorder {
    start(stream: MediaStream): void;
    stop(): Blob;
    pause(): void;
    resume(): void;
    getClips(): Blob[];
    clearClips(): void;
  }
  ```

- [ ] 定義事件介面
  ```typescript
  interface WebASREvents {
    'state_changed': StateChangeEvent;
    'wake_activated': WakeWordEvent;
    'vad_speech_start': VADEvent;
    'vad_speech_end': VADEvent;
    'transcribe_partial': TranscriptionEvent;
    'transcribe_done': TranscriptionEvent;
    'error': ErrorEvent;
    'buffer_overflow': BufferEvent;
    'model_progress': ProgressEvent;
  }
  ```

### 0.3 配置與類型定義
- [ ] 定義配置介面 `WebASRConfig`
- [ ] 定義狀態機狀態類型
- [ ] 定義錯誤類型與代碼
- [ ] 定義診斷結果介面

---

## Phase 1: 基礎服務層 (3-4 天)

### 1.1 麥克風擷取服務 (MicrophoneService)
- [ ] 實作 getUserMedia 封裝
  - 處理權限請求
  - 處理瀏覽器相容性
  - 支援多種採樣率

- [ ] 實作音頻流管理
  - MediaStream 管理
  - 音軌控制（靜音/取消靜音）
  - 裝置切換支援

- [ ] 實作音頻預處理
  - 降噪處理 (noiseSuppression)
  - 回音消除 (echoCancellation)
  - 自動增益控制 (autoGainControl)

- [ ] 錯誤處理
  - 權限拒絕處理
  - 裝置不可用處理
  - 權限撤銷監聽

### 1.2 AudioQueueManager
- [ ] 實作 RingBuffer 核心
  ```typescript
  class RingBuffer {
    constructor(size: number);
    write(data: Float32Array): boolean;
    read(size: number): Float32Array | null;
    available(): number;
    clear(): void;
  }
  ```

- [ ] 實作 SharedArrayBuffer 支援
  - 檢測 crossOriginIsolated
  - 實作 SAB 版本 RingBuffer
  - 實作 MessagePort 降級方案

- [ ] 實作溢出策略
  - drop-oldest: 丟棄最舊資料
  - block: 阻塞寫入
  - backpressure: 背壓通知

- [ ] 實作 AudioWorklet 整合
  - AudioWorklet 載入與初始化
  - 處理 worklet 訊息
  - ScriptProcessor 降級方案

### 1.3 BufferManager
- [ ] 實作多緩衝區管理
  - 循環緩衝區池
  - 緩衝區狀態追蹤
  - 自動擴展策略

- [ ] 實作記憶體管理
  - 緩衝區生命週期管理
  - 自動清理過期緩衝區
  - 記憶體壓力監控

- [ ] 實作資料流控制
  - 流量控制機制
  - 背壓處理
  - 緩衝區同步

---

## Phase 2: 音頻處理服務 (3-4 天)

### 2.1 音頻重採樣服務 (AudioResampler)
- [ ] 實作採樣率轉換
  - 線性插值演算法
  - 多階段重採樣
  - 品質與效能平衡

- [ ] 實作批次處理
  - 區塊式處理
  - 串流式處理
  - 延遲優化

### 2.2 倒數計時器服務 (CountdownTimer)
- [ ] 實作計時器核心
  - 高精度計時 (performance.now)
  - 可暫停/恢復
  - 多計時器管理

- [ ] 實作事件系統
  - 進度事件
  - 完成事件
  - 取消事件

- [ ] 實作閾值觸發
  - 語音超時計時
  - 靜音超時計時
  - 最大錄音時長

### 2.3 錄音服務 (RecorderService)
- [ ] 實作 MediaRecorder 封裝
  - MIME 類型自動偵測
  - 格式協商機制
  - PCM fallback 方案

- [ ] 實作循環錄音
  - 固定大小片段
  - 自動輪替策略
  - 最近 N 段保存

- [ ] 實作音頻編碼
  - WebM/Opus (Chrome/Firefox)
  - MP4/AAC (Safari)
  - WAV/PCM (fallback)

---

## Phase 3: AI 模型服務 (4-5 天)

### 3.1 OpenWakeWord 服務
- [ ] 實作模型載入
  - ONNX Runtime Web 整合
  - 模型快取機制
  - 進度回調

- [ ] 實作執行提供者管理
  - WebGPU 優先
  - WebGL 降級
  - WASM 最終降級
  - 自動選擇策略

- [ ] 實作推理管線
  - 音頻前處理（特徵提取）
  - 批次推理優化
  - 結果後處理

- [ ] 實作 Worker 整合
  - Web Worker 載入
  - 訊息協議設計
  - 主線程降級

### 3.2 VAD 服務
- [ ] 實作 Silero VAD 整合
  - 模型載入與初始化
  - ONNX Runtime 配置
  - 記憶體管理

- [ ] 實作語音偵測邏輯
  - 幀級別偵測
  - 多幀確認機制
  - 防抖動處理

- [ ] 實作狀態管理
  - 語音開始/結束事件
  - 最小語音長度
  - 最大靜音長度

- [ ] 實作自適應閾值
  - 環境噪音評估
  - 動態閾值調整
  - 敏感度控制

---

## Phase 4: 語音辨識服務 (4-5 天)

### 4.1 Whisper 服務
- [ ] 實作 Transformers.js 整合
  - Pipeline 建立
  - 模型載入策略
  - 裝置選擇 (WebGPU/WASM)

- [ ] 實作量化支援
  - 量化模型偵測
  - dtype 自動選擇
  - 效能優化

- [ ] 實作串流辨識
  - WhisperTextStreamer 整合
  - 部分結果回調
  - 緩衝區管理

- [ ] 實作批次辨識
  - 音頻分段策略
  - 平行處理
  - 結果合併

### 4.2 WebSpeech API 服務
- [ ] 實作 SpeechRecognition 封裝
  - 瀏覽器相容性處理
  - 連續辨識模式
  - 中斷處理

- [ ] 實作語言支援
  - 多語言設定
  - 自動語言偵測
  - 備選語言

- [ ] 實作結果處理
  - 信心度評分
  - 替代結果
  - 最終結果確認

- [ ] 實作降級邏輯
  - 線上/離線偵測
  - 自動切換機制
  - 錯誤恢復

---

## Phase 5: 核心整合與狀態管理 (5-6 天)

### 5.1 狀態機實作 (FSM)
- [ ] 實作 FiniteStateMachine 類
  ```typescript
  class FiniteStateMachine extends EventTarget {
    constructor(initialState: State);
    addTransition(from: State, event: Event, to: State): void;
    addStateHandler(state: State, handler: Function): void;
    transition(event: Event): void;
    getCurrentState(): State;
  }
  ```

- [ ] 定義狀態轉換規則
  - 所有狀態定義
  - 合法轉換路徑
  - 狀態進入/離開處理

- [ ] 實作狀態處理器
  - idle 狀態處理
  - listening 狀態處理
  - recording 狀態處理
  - transcribing 狀態處理
  - error 狀態處理

### 5.2 WebASR 核心類
- [ ] 實作模組化架構
  ```typescript
  class WebASR extends EventTarget {
    add(module: IModule): WebASR;
    remove(module: IModule): WebASR;
    start(): Promise<void>;
    stop(): void;
    pause(): void;
    resume(): void;
  }
  ```

- [ ] 實作模組協調
  - 模組生命週期管理
  - 模組間通訊
  - 事件轉發機制

- [ ] 實作管線控制
  - 啟動序列
  - 停止序列
  - 錯誤處理鏈

### 5.3 診斷系統
- [ ] 實作環境偵測
  - 瀏覽器能力檢測
  - API 可用性檢查
  - 效能評估

- [ ] 實作自動配置
  - 根據環境選擇最佳配置
  - 降級策略建議
  - 警告與提示

- [ ] 實作健康檢查
  - 模組狀態監控
  - 資源使用追蹤
  - 效能指標收集

---

## Phase 6: 測試與優化 (3-4 天)

### 6.1 單元測試
- [ ] 測試 AudioQueueManager
  - RingBuffer 功能測試
  - 溢出策略測試
  - 併發存取測試

- [ ] 測試 BufferManager
  - 記憶體管理測試
  - 生命週期測試
  - 壓力測試

- [ ] 測試模型服務
  - 模型載入測試
  - 推理準確度測試
  - 降級機制測試

### 6.2 整合測試
- [ ] 測試完整管線
  - 端到端流程測試
  - 狀態轉換測試
  - 錯誤恢復測試

- [ ] 測試瀏覽器相容性
  - Chrome/Edge 測試
  - Firefox 測試
  - Safari 測試

- [ ] 測試降級機制
  - 無 SharedArrayBuffer 環境
  - 無 WebGPU 環境
  - 無 MediaRecorder 環境

### 6.3 效能優化
- [ ] 記憶體優化
  - 緩衝區大小調整
  - 垃圾回收優化
  - 記憶體洩漏檢查

- [ ] 延遲優化
  - 音頻管線延遲
  - 模型推理延遲
  - 事件傳遞延遲

- [ ] CPU 優化
  - Worker 負載平衡
  - 批次處理優化
  - 空閒時間利用

### 6.4 文檔與範例
- [ ] API 文檔
  - 介面說明
  - 使用指南
  - 配置說明

- [ ] 使用範例
  - 基礎範例
  - 進階範例
  - 整合範例

- [ ] 部署指南
  - CDN 部署
  - HTTP Headers 配置
  - 故障排除

---

## 時程估計

- **總時程**: 約 21-27 工作天
- **Phase 0**: 2-3 天
- **Phase 1**: 3-4 天
- **Phase 2**: 3-4 天
- **Phase 3**: 4-5 天
- **Phase 4**: 4-5 天
- **Phase 5**: 5-6 天
- **Phase 6**: 3-4 天

## 開發原則

1. **模組化設計**: 每個服務都是獨立的模組，可單獨測試
2. **漸進增強**: 優先使用最佳技術，自動降級到相容方案
3. **錯誤恢復**: 所有模組都要有錯誤處理和恢復機制
4. **效能優先**: 注重即時性和資源使用效率
5. **測試驅動**: 每個模組都要有對應的單元測試

## 技術棧

- **語言**: TypeScript
- **模組系統**: ESM (主要) / UMD / IIFE
- **音頻處理**: Web Audio API, AudioWorklet
- **AI 推理**: ONNX Runtime Web, Transformers.js
- **並行處理**: Web Workers, SharedArrayBuffer
- **測試框架**: Jest / Vitest
- **打包工具**: Rollup / Vite

## 注意事項

1. **COOP/COEP 配置**: SharedArrayBuffer 需要正確的 HTTP Headers
2. **瀏覽器相容性**: 需要處理各瀏覽器的差異
3. **降級方案**: 每個功能都要有備用方案
4. **記憶體管理**: 注意長時間運行的記憶體洩漏
5. **安全性**: 處理麥克風權限和跨域資源

## 里程碑

- **M1**: 完成介面定義與基礎服務 (Phase 0-1)
- **M2**: 完成音頻處理管線 (Phase 2)
- **M3**: 完成 AI 模型整合 (Phase 3)
- **M4**: 完成語音辨識服務 (Phase 4)
- **M5**: 完成核心整合 (Phase 5)
- **M6**: 發布第一個版本 (Phase 6)