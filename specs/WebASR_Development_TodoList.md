# WebASR 開發待辦清單

## 快速檢查清單

### Phase 0: 介面定義 ✅
- [x] 建立 TypeScript 專案結構
- [x] 定義所有核心介面
- [x] 設置開發環境

### Phase 1: 基礎服務層 ✅
- [x] MicrophoneService 完成
- [x] AudioQueueManager 完成
- [x] BufferManager 完成

### Phase 2: 音頻處理 ✅
- [x] AudioResampler 完成
- [x] CountdownTimer 完成
- [x] RecorderService 完成

### Phase 3: AI 模型 ✅
- [x] OpenWakeWord 完成
- [x] VAD 完成

### Phase 4: 語音辨識 ✅
- [x] Whisper 完成
- [x] WebSpeech API 完成

### Phase 5: 核心整合 ⏳
- [ ] FSM 完成
- [ ] WebASR Core 完成
- [ ] 診斷系統完成

### Phase 6: 測試優化 ⏳
- [ ] 單元測試完成
- [ ] 整合測試完成
- [ ] 效能優化完成
- [ ] 文檔完成

---

## 詳細任務清單

### 📁 專案初始化

```bash
# 目錄結構
WebASRCore/
├── src/
│   ├── interfaces/       # 介面定義
│   │   ├── IAudioQueue.ts
│   │   ├── IBufferManager.ts
│   │   ├── IWakeWordDetector.ts
│   │   ├── IVADDetector.ts
│   │   ├── ISpeechRecognizer.ts
│   │   └── IRecorder.ts
│   ├── services/         # 無狀態服務
│   │   ├── audio/
│   │   │   ├── MicrophoneService.ts
│   │   │   ├── AudioQueueManager.ts
│   │   │   ├── BufferManager.ts
│   │   │   ├── AudioResampler.ts
│   │   │   └── RecorderService.ts
│   │   ├── detection/
│   │   │   ├── OpenWakeWordService.ts
│   │   │   └── VADService.ts
│   │   ├── recognition/
│   │   │   ├── WhisperService.ts
│   │   │   └── WebSpeechService.ts
│   │   └── utils/
│   │       └── CountdownTimer.ts
│   ├── core/
│   │   ├── FSM.ts
│   │   ├── WebASR.ts
│   │   └── Diagnosis.ts
│   ├── workers/
│   │   ├── inference.worker.ts
│   │   └── whisper.worker.ts
│   ├── worklets/
│   │   └── audio-processor.worklet.ts
│   ├── types/
│   │   ├── config.ts
│   │   ├── events.ts
│   │   └── states.ts
│   └── index.ts
├── dist/
├── tests/
├── examples/
└── package.json
```

---

### 🎯 Phase 0: 介面定義任務

#### 設置任務
- [x] 初始化 npm 專案
- [x] 安裝 TypeScript
- [x] 配置 tsconfig.json
- [x] 設置 ESLint
- [x] 設置 Prettier
- [x] 配置 Rollup/Vite

#### 介面定義任務
- [x] 建立 `interfaces/IAudioQueue.ts`
  ```typescript
  export interface IAudioQueue {
    start(): Promise<void>;
    stop(): void;
    pause(): void;
    resume(): void;
    getBuffer(): Float32Array;
    setOverflowPolicy(policy: OverflowPolicy): void;
    on(event: string, handler: Function): void;
    off(event: string, handler: Function): void;
  }
  ```

- [x] 建立 `interfaces/IBufferManager.ts`
  ```typescript
  export interface IBufferManager {
    write(data: Float32Array): boolean;
    read(size: number): Float32Array | null;
    available(): number;
    capacity(): number;
    clear(): void;
    isFull(): boolean;
    isEmpty(): boolean;
  }
  ```

- [x] 建立 `interfaces/IWakeWordDetector.ts`
- [x] 建立 `interfaces/IVADDetector.ts`
- [x] 建立 `interfaces/ISpeechRecognizer.ts`
- [x] 建立 `interfaces/IRecorder.ts`

#### 類型定義任務
- [x] 建立 `types/config.ts`
- [x] 建立 `types/events.ts`
- [x] 建立 `types/states.ts`

---

### 🎯 Phase 1: 基礎服務實作

#### MicrophoneService (麥克風擷取)
- [x] 建立 `services/audio/MicrophoneService.ts`
- [x] 實作 getUserMedia 封裝
  - [x] 處理權限請求邏輯
  - [x] 實作瀏覽器相容性檢查
  - [x] 支援採樣率設定
- [ ] 實作音頻流管理
  - [ ] MediaStream 生命週期管理
  - [ ] 音軌控制方法
  - [ ] 裝置切換功能
- [ ] 實作音頻預處理選項
  - [ ] echoCancellation 設定
  - [ ] noiseSuppression 設定
  - [ ] autoGainControl 設定
- [ ] 錯誤處理
  - [ ] NotAllowedError 處理
  - [ ] NotFoundError 處理
  - [ ] 權限變更監聽
- [ ] 單元測試
  - [ ] 測試權限請求
  - [ ] 測試裝置切換
  - [ ] 測試錯誤處理

#### AudioQueueManager
- [ ] 建立 `services/audio/AudioQueueManager.ts`
- [ ] 實作 RingBuffer 核心
  - [ ] 建立 RingBuffer 類
  - [ ] 實作讀寫指標管理
  - [ ] 實作循環邏輯
- [ ] SharedArrayBuffer 支援
  - [ ] 檢測 crossOriginIsolated
  - [ ] 實作 SAB 版本
  - [ ] 實作 Int32Array 控制結構
- [ ] MessagePort 降級方案
  - [ ] 實作 MessageChannel
  - [ ] 實作訊息協議
  - [ ] 實作緩衝策略
- [ ] 溢出策略實作
  - [ ] drop-oldest 策略
  - [ ] block 策略
  - [ ] backpressure 策略
- [ ] AudioWorklet 整合
  - [ ] 載入 worklet 模組
  - [ ] 實作訊息處理
  - [ ] ScriptProcessor 降級
- [ ] 單元測試
  - [ ] 測試 RingBuffer 操作
  - [ ] 測試溢出處理
  - [ ] 測試 Worker 通訊

#### BufferManager
- [ ] 建立 `services/audio/BufferManager.ts`
- [ ] 多緩衝區管理
  - [ ] 緩衝區池實作
  - [ ] 狀態追蹤機制
  - [ ] 自動擴展邏輯
- [ ] 記憶體管理
  - [ ] 生命週期控制
  - [ ] 定期清理機制
  - [ ] 記憶體監控
- [ ] 資料流控制
  - [ ] 流量控制實作
  - [ ] 背壓通知機制
  - [ ] 同步控制
- [ ] 單元測試
  - [ ] 測試緩衝區分配
  - [ ] 測試記憶體清理
  - [ ] 測試流量控制

---

### 🎯 Phase 2: 音頻處理服務

#### AudioResampler
- [x] 建立 `services/audio/AudioResampler.ts`
- [x] 採樣率轉換
  - [x] 線性插值實作
  - [ ] Sinc 插值實作（可選）
  - [x] 多階段處理
- [x] 批次處理
  - [x] 區塊處理邏輯
  - [x] 串流處理支援
  - [x] 延遲優化
- [ ] 單元測試
  - [ ] 測試重採樣精度
  - [ ] 測試效能
  - [ ] 測試邊界條件

#### CountdownTimer
- [x] 建立 `services/utils/CountdownTimer.ts`
- [x] 計時器核心
  - [x] performance.now 使用
  - [x] 暫停/恢復邏輯
  - [x] 多實例管理
- [x] 事件系統
  - [x] tick 事件
  - [x] complete 事件
  - [x] cancel 事件
- [x] 閾值功能
  - [x] 語音超時
  - [x] 靜音超時
  - [x] 最大時長
- [ ] 單元測試
  - [ ] 測試計時精度
  - [ ] 測試暫停恢復
  - [ ] 測試事件觸發

#### RecorderService
- [x] 建立 `services/audio/RecorderService.ts`
- [ ] MediaRecorder 封裝
  - [ ] MIME 類型偵測
  - [ ] 格式協商
  - [ ] 錯誤處理
- [ ] PCM fallback
  - [ ] AudioWorklet 錄製
  - [ ] WAV 編碼
  - [ ] 緩衝管理
- [ ] 循環錄音
  - [ ] 片段管理
  - [ ] 自動輪替
  - [ ] 儲存策略
- [ ] 單元測試
  - [ ] 測試格式偵測
  - [ ] 測試錄音功能
  - [ ] 測試循環機制

---

### 🎯 Phase 3: AI 模型服務

#### OpenWakeWordService
- [x] 建立 `services/detection/OpenWakeWordService.ts`
- [x] 模型載入
  - [x] ONNX Runtime 初始化
  - [x] 模型檔案載入
  - [x] 快取機制
- [x] 執行提供者
  - [ ] WebGPU 偵測與配置
  - [ ] WebGL 降級配置
  - [x] WASM 最終降級
- [x] 推理管線
  - [x] 音頻特徵提取
  - [x] 批次處理
  - [x] 結果處理
- [ ] Worker 整合
  - [ ] Worker 載入
  - [ ] 訊息協議
  - [ ] 主線程降級
- [ ] 單元測試
  - [ ] 測試模型載入
  - [ ] 測試推理準確度
  - [ ] 測試降級機制

#### VADService
- [x] 建立 `services/detection/VADService.ts`
- [x] Silero VAD 整合
  - [x] 模型載入
  - [x] ONNX 配置
  - [x] 狀態管理
- [x] 偵測邏輯
  - [x] 幀級偵測
  - [x] 多幀確認
  - [x] 防抖處理
- [x] 自適應閾值
  - [ ] 噪音評估
  - [ ] 動態調整
  - [x] 敏感度控制
- [ ] 單元測試
  - [ ] 測試偵測準確度
  - [ ] 測試狀態轉換
  - [ ] 測試閾值調整

---

### 🎯 Phase 4: 語音辨識服務

#### WhisperService
- [x] 建立 `services/recognition/WhisperService.ts`
- [x] Transformers.js 整合
  - [x] Pipeline 建立
  - [x] 模型載入
  - [x] 裝置選擇
- [x] 量化支援
  - [x] 量化模型偵測
  - [x] dtype 選擇
  - [x] 效能優化
- [x] 串流辨識
  - [x] TextStreamer 整合
  - [x] 部分結果處理
  - [x] 緩衝管理
- [x] 批次辨識
  - [x] 音頻分段
  - [x] 平行處理
  - [x] 結果合併
- [ ] 單元測試
  - [ ] 測試辨識準確度
  - [ ] 測試串流功能
  - [ ] 測試效能

#### WebSpeechService
- [x] 建立 `services/recognition/WebSpeechService.ts`
- [x] SpeechRecognition 封裝
  - [x] API 初始化
  - [x] 瀏覽器相容性
  - [x] 連續模式設定
- [x] 語言支援
  - [x] 多語言配置
  - [x] 語言偵測
  - [x] 備選處理
- [x] 結果處理
  - [x] 信心度評分
  - [x] 替代結果
  - [x] 最終確認
- [x] 降級邏輯
  - [x] 線上偵測
  - [x] 自動切換
  - [x] 錯誤恢復
- [ ] 單元測試
  - [ ] 測試 API 功能
  - [ ] 測試語言切換
  - [ ] 測試降級機制

---

### 🎯 Phase 5: 核心整合

#### FSM 實作
- [ ] 建立 `core/FSM.ts`
- [ ] FiniteStateMachine 類
  - [ ] 狀態管理
  - [ ] 轉換規則
  - [ ] 事件處理
- [ ] 狀態定義
  - [ ] 所有狀態列舉
  - [ ] 轉換矩陣
  - [ ] 處理器註冊
- [ ] 狀態處理器
  - [ ] idle 處理器
  - [ ] listening 處理器
  - [ ] recording 處理器
  - [ ] transcribing 處理器
  - [ ] error 處理器
- [ ] 單元測試
  - [ ] 測試狀態轉換
  - [ ] 測試事件觸發
  - [ ] 測試錯誤處理

#### WebASR Core
- [ ] 建立 `core/WebASR.ts`
- [ ] 模組架構
  - [ ] 模組註冊機制
  - [ ] 生命週期管理
  - [ ] 依賴注入
- [ ] 模組協調
  - [ ] 事件匯流排
  - [ ] 訊息傳遞
  - [ ] 狀態同步
- [ ] 管線控制
  - [ ] 啟動序列
  - [ ] 停止序列
  - [ ] 暫停/恢復
- [ ] 錯誤處理
  - [ ] 錯誤傳播
  - [ ] 恢復策略
  - [ ] 降級機制
- [ ] 整合測試
  - [ ] 測試完整流程
  - [ ] 測試模組協調
  - [ ] 測試錯誤恢復

#### 診斷系統
- [ ] 建立 `core/Diagnosis.ts`
- [ ] 環境偵測
  - [ ] API 可用性
  - [ ] 瀏覽器能力
  - [ ] 效能評估
- [ ] 自動配置
  - [ ] 最佳配置選擇
  - [ ] 降級建議
  - [ ] 警告生成
- [ ] 健康檢查
  - [ ] 模組監控
  - [ ] 資源追蹤
  - [ ] 指標收集
- [ ] 單元測試
  - [ ] 測試偵測準確性
  - [ ] 測試配置生成
  - [ ] 測試監控功能

---

### 🎯 Phase 6: 測試與發布

#### 測試任務
- [ ] 單元測試覆蓋率 > 80%
- [ ] 整合測試完成
- [ ] E2E 測試完成
- [ ] 效能測試達標
- [ ] 瀏覽器相容性測試

#### 優化任務
- [ ] 記憶體洩漏檢查
- [ ] Bundle size 優化
- [ ] 載入時間優化
- [ ] 執行效能優化

#### 文檔任務
- [ ] API 文檔完成
- [ ] 使用指南完成
- [ ] 部署指南完成
- [ ] 範例程式完成

#### 發布任務
- [ ] 版本號設定
- [ ] CHANGELOG 更新
- [ ] NPM 發布準備
- [ ] CDN 部署測試

---

## 開發檢查點

### Checkpoint 1: 基礎架構完成
- [ ] 所有介面定義完成
- [ ] 專案結構建立
- [ ] 開發環境配置完成

### Checkpoint 2: 音頻管線完成
- [ ] 麥克風擷取工作
- [ ] 音頻緩衝正常
- [ ] 重採樣功能正常

### Checkpoint 3: AI 模型整合完成
- [ ] Wake Word 偵測工作
- [ ] VAD 偵測工作
- [ ] 模型載入優化

### Checkpoint 4: 語音辨識完成
- [ ] Whisper 辨識工作
- [ ] WebSpeech 降級工作
- [ ] 雙引擎切換正常

### Checkpoint 5: 核心整合完成
- [ ] 狀態機運作正常
- [ ] 事件系統工作
- [ ] 錯誤處理完善

### Checkpoint 6: 發布就緒
- [ ] 所有測試通過
- [ ] 效能達標
- [ ] 文檔完整
- [ ] 範例可運行

---

## 技術債務追蹤

### 需要優化的項目
- [ ] RingBuffer 效能優化
- [ ] Worker 通訊延遲優化
- [ ] 模型載入速度優化
- [ ] 記憶體使用優化

### 需要重構的項目
- [ ] 事件系統統一化
- [ ] 錯誤處理標準化
- [ ] 配置系統簡化

### 需要補充的功能
- [ ] 更多語言支援
- [ ] 更多 Wake Word 模型
- [ ] 自訂模型支援
- [ ] 模型動態載入

---

## 每日開發流程

### 開始工作
1. 查看 TodoList
2. 選擇當日任務
3. 更新任務狀態

### 開發中
1. 實作功能
2. 撰寫測試
3. 更新文檔

### 結束工作
1. 提交程式碼
2. 更新 TodoList
3. 記錄問題

---

## 緊急修復清單

### 常見問題快速修復
- [ ] SharedArrayBuffer 不可用 → 檢查 COOP/COEP
- [ ] 模型載入失敗 → 檢查路徑與 CORS
- [ ] 音頻無輸入 → 檢查權限與 AudioContext
- [ ] Wake Word 不觸發 → 檢查閾值與音量
- [ ] 辨識無結果 → 檢查網路與模型

### 降級方案啟用
- [ ] WebGPU → WebGL → WASM
- [ ] SharedArrayBuffer → MessagePort
- [ ] AudioWorklet → ScriptProcessor
- [ ] Whisper → WebSpeech API
- [ ] MediaRecorder → PCM 直錄