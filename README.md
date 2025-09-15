# WebASRCore

WebASRCore 是一套事件驅動的 TypeScript 語音處理服務集合，專為瀏覽器端設計。提供語音活動檢測（VAD）、喚醒詞檢測、語音識別（Whisper）和語音合成（TTS）等功能，完全在瀏覽器中運行。

## 🚀 功能特色

- **🎯 事件驅動架構 v2**：所有服務使用 EventEmitter 模式，解耦服務間依賴
- **🎤 VAD（語音活動檢測）**：使用 Silero VAD 模型，即時檢測語音活動
- **🔊 喚醒詞檢測**：支援多種喚醒詞（Hey Jarvis、Alexa 等）
- **✍️ 語音識別**：透過 transformers.js 使用 Whisper 模型，支援多語言
- **🗣️ 語音合成**：原生 Web Speech API 支援 TTS/STT
- **⏱️ 計時器服務**：統一的計時器管理，避免記憶體洩漏
- **🚀 瀏覽器優先**：使用 WebAssembly 和 ONNX Runtime Web，支援 WebGPU 加速
- **📦 TypeScript**：完整的型別定義，提供更好的開發體驗
- **🔧 配置管理**：集中式配置管理器，支援所有參數自訂

## 📦 安裝

### npm 安裝
```bash
npm install web-asr-core
```

### CDN 載入

#### 方法一：ULTIMATE 版本（最推薦）🚀
**只需一個 `<script>` 標籤，包含 Whisper 完整功能！**

```html
<!-- 包含 Transformers.js、ONNX Runtime 和所有功能 -->
<script src="https://unpkg.com/web-asr-core@latest/dist/web-asr-core.ultimate.min.js"></script>

<script>
  // 所有服務已自動載入並配置，包括 Whisper！
  const vadService = new WebASRCore.VadService();
  const whisperService = new WebASRCore.WhisperService();
  // Transformers.js 已自動配置 WASM 路徑
</script>
```

#### 方法二：ALL-IN-ONE 版本
包含 ONNX Runtime，但 Whisper 需額外載入 Transformers.js：

```html
<!-- 載入核心功能（VAD、喚醒詞） -->
<script src="https://unpkg.com/web-asr-core@latest/dist/web-asr-core.all.min.js"></script>

<!-- 如需 Whisper，額外載入 Transformers.js -->
<script type="module">
  import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.3';
  env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.3/dist/';
  window.transformers = { pipeline, env };
</script>
```

#### 方法三：輕量版本（需手動載入依賴）
適合已有 ONNX Runtime 的專案：

```html
<!-- 1. 先載入 ONNX Runtime -->
<script src="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.min.js"></script>

<!-- 2. 如需 Whisper 功能，載入 Transformers.js -->
<script type="module">
  import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.3';
  window.transformers = { pipeline, env };
</script>

<!-- 3. 載入 WebASRCore 輕量版 -->
<script src="https://unpkg.com/web-asr-core@latest/dist/web-asr-core.umd.min.js"></script>
```

## 🎮 快速開始

### ES Module 方式
```typescript
import {
  VadService,
  WakewordService,
  WhisperService,
  SpeechService,
  TimerService,
  EventEmitter,
  ConfigManager
} from 'web-asr-core';

// 初始化服務
const vadService = new VadService();
const wakewordService = new WakewordService();
const whisperService = new WhisperService();
```

### CDN 方式
```javascript
// 從全域變數取得服務
const {
  VadService,
  WakewordService,
  WhisperService,
  SpeechService,
  TimerService
} = window.WebASRCore;

// 初始化服務
const vadService = new VadService();
```

## 📖 使用範例

### VAD（語音活動檢測）

```javascript
// 建立 VAD 服務
const vadService = new VadService({
  threshold: 0.45,           // 檢測閾值
  minSilenceDuration: 800,   // 最小靜音持續時間（毫秒）
  minSpeechDuration: 50,     // 最小語音持續時間（毫秒）
  sampleRate: 16000          // 取樣率
});

// 訂閱事件
vadService.on('speech-start', () => {
  console.log('檢測到語音開始');
});

vadService.on('speech-end', () => {
  console.log('檢測到語音結束');
});

vadService.on('model-loaded', () => {
  console.log('VAD 模型載入完成');
});

vadService.on('error', (error) => {
  console.error('VAD 錯誤:', error);
});

// 載入模型並開始檢測
async function startVAD() {
  await vadService.loadModel();  // 載入模型
  await vadService.start();       // 開始錄音和檢測
}

// 停止檢測
function stopVAD() {
  vadService.stop();
}
```

### 喚醒詞檢測

```javascript
// 建立喚醒詞服務
const wakewordService = new WakewordService({
  wakewords: [
    {
      model: 'hey_jarvis',
      threshold: 0.55,
      displayName: 'Hey Jarvis'
    },
    {
      model: 'alexa',
      threshold: 0.4,
      displayName: 'Alexa'
    }
  ],
  chunkSize: 1280,
  sampleRate: 16000
});

// 訂閱事件
wakewordService.on('detection', (data) => {
  console.log(`檢測到喚醒詞: ${data.wakeword}`, data.score);
});

wakewordService.on('models-loaded', () => {
  console.log('所有喚醒詞模型載入完成');
});

wakewordService.on('error', (error) => {
  console.error('喚醒詞錯誤:', error);
});

// 載入模型並開始檢測
async function startWakeword() {
  await wakewordService.loadModels();  // 載入所有配置的模型
  await wakewordService.start();        // 開始錄音和檢測
}

// 停止檢測
function stopWakeword() {
  wakewordService.stop();
}
```

### Whisper 語音識別

```javascript
// 建立 Whisper 服務
const whisperService = new WhisperService({
  language: 'zh',          // 語言設定
  temperature: 0.8,        // 生成溫度
  maxLength: 500,          // 最大長度
  minAudioLength: 500      // 最小音訊長度（毫秒）
});

// 訂閱事件
whisperService.on('transcription-start', () => {
  console.log('開始轉錄...');
});

whisperService.on('transcription-complete', (data) => {
  console.log('轉錄完成:', data.text);
  if (data.segments) {
    data.segments.forEach(segment => {
      console.log(`[${segment.start}-${segment.end}]: ${segment.text}`);
    });
  }
});

whisperService.on('model-loaded', () => {
  console.log('Whisper 模型載入完成');
});

whisperService.on('model-loading', (data) => {
  console.log('模型載入進度:', data.progress);
});

whisperService.on('error', (error) => {
  console.error('Whisper 錯誤:', error);
});

// 載入模型
async function loadWhisperModel() {
  // 本地模型
  await whisperService.loadModel('local', '/models/huggingface/Xenova/whisper-base');

  // 或遠端模型（從 HuggingFace）
  // await whisperService.loadModel('remote', 'Xenova/whisper-tiny');
}

// 轉錄音訊
async function transcribeAudio(audioData) {
  const result = await whisperService.transcribe(audioData);
  console.log('轉錄結果:', result.text);
}
```

### Speech API（TTS/STT）

```javascript
// 建立 Speech 服務
const speechService = new SpeechService();

// === TTS（文字轉語音）===
speechService.on('tts-start', () => {
  console.log('TTS 開始播放');
});

speechService.on('tts-end', () => {
  console.log('TTS 播放結束');
});

speechService.on('tts-error', (error) => {
  console.error('TTS 錯誤:', error);
});

// 播放語音
speechService.speak('你好，我是語音助手', {
  lang: 'zh-TW',
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0
});

// === STT（語音轉文字）===
speechService.on('stt-start', () => {
  console.log('STT 開始識別');
});

speechService.on('stt-result', (data) => {
  console.log('識別結果:', data.transcript);
  console.log('是否最終結果:', data.isFinal);
});

speechService.on('stt-end', () => {
  console.log('STT 結束識別');
});

// 開始語音識別
speechService.startRecognition({
  lang: 'zh-TW',
  continuous: true,
  interimResults: true
});

// 停止語音識別
speechService.stopRecognition();
```

## 🌐 測試頁面使用說明

### 本地開發
```bash
# 1. 啟動本地伺服器
python3 -m http.server 8000

# 2. 在瀏覽器開啟
http://localhost:8000/index.html
```

### 頁面功能

1. **初始化按鈕**：點擊載入所有模型和服務
2. **診斷按鈕**：檢查系統狀態和支援功能
3. **分頁導航**：使用左右箭頭切換不同服務頁面

### 服務頁面

- **Speech API**：Web Speech API 的 TTS/STT 功能
- **Whisper**：Whisper 模型語音識別
- **VAD 檢測**：語音活動檢測
- **喚醒詞**：喚醒詞檢測（Hey Jarvis、Alexa）
- **倒數計時**：計時器服務測試
- **音訊工具**：AudioRingBuffer 等工具測試

## 🏗️ 架構設計

### 事件驅動架構 v2

所有服務都繼承自 `EventEmitter`，提供統一的事件處理機制：

```javascript
class ServiceBase extends EventEmitter {
  // 服務實現
}
```

### 服務間通訊

服務之間透過事件進行解耦通訊：

```javascript
// VAD 服務檢測到語音結束時
vadService.on('speech-end', () => {
  // 觸發 Whisper 轉錄
  whisperService.transcribe(audioBuffer);
});

// Whisper 完成轉錄時
whisperService.on('transcription-complete', (data) => {
  // 使用 TTS 播放回應
  speechService.speak(generateResponse(data.text));
});
```

## 🛠️ 配置管理

使用 `ConfigManager` 集中管理所有配置：

```javascript
const config = new ConfigManager();

// 取得 VAD 配置
const vadConfig = config.getVadConfig();

// 取得 Wakeword 配置
const wakewordConfig = config.getWakewordConfig();

// 取得 Whisper 配置
const whisperConfig = config.getWhisperConfig();

// 取得 ONNX Runtime 配置
const onnxConfig = config.getOnnxConfig();
```

## 🚀 效能優化

### WebGPU 加速

當瀏覽器支援時，自動啟用 WebGPU 加速：

```javascript
const config = new ConfigManager();
config.onnx.webgpu.enabled = true;  // 啟用 WebGPU
```

### Web Worker

使用 Web Worker 執行模型推理，避免阻塞主執行緒：

```javascript
config.onnx.useWebWorker = true;  // 啟用 Web Worker
```

### 模型預載入

預先載入模型以減少首次推理延遲：

```javascript
// 在應用啟動時載入所有模型
async function preloadModels() {
  await vadService.loadModel();
  await wakewordService.loadModels();
  await whisperService.loadModel('local', modelPath);
}
```

## 📋 瀏覽器相容性

| 瀏覽器 | 支援度 | 備註 |
|--------|--------|------|
| Chrome 90+ | ✅ 完整支援 | 建議使用 |
| Edge 90+ | ✅ 完整支援 | 建議使用 |
| Firefox 89+ | ⚠️ 部分支援 | Web Speech API 有限制 |
| Safari 15+ | ⚠️ 實驗性支援 | 需要啟用實驗功能 |

### 必要 API

- WebAssembly
- AudioWorklet（優先）或 ScriptProcessorNode（備用）
- Web Worker
- MediaRecorder
- Web Speech API（選用，用於 TTS/STT）
- WebGPU（選用，用於加速）

## 🔧 開發

### 建構專案

```bash
# 安裝依賴
npm install

# TypeScript 編譯
npm run build

# 建立瀏覽器 bundle
npm run bundle

# 完整建構（編譯 + bundle）
npm run build:all

# 開發模式（監聽變更）
npm run dev
```

### 專案結構

```
WebASRCore/
├── src/
│   ├── services/        # 事件驅動服務
│   │   ├── VadService.ts
│   │   ├── WakewordService.ts
│   │   ├── WhisperService.ts
│   │   ├── SpeechService.ts
│   │   └── TimerService.ts
│   ├── core/           # 核心元件
│   │   └── EventEmitter.ts
│   ├── utils/          # 工具類
│   │   ├── AudioRingBuffer.ts
│   │   ├── AudioChunker.ts
│   │   └── config-manager.ts
│   └── workers/        # Web Worker
│       └── onnx-inference.worker.ts
├── dist/               # 編譯輸出
├── models/            # AI 模型檔案
└── public/            # 靜態資源
```

## 📄 授權

MIT License

## 🤝 貢獻

歡迎提交 Issue 和 Pull Request！

## 📚 相關資源

- [ONNX Runtime Web](https://github.com/microsoft/onnxruntime)
- [Transformers.js](https://github.com/xenova/transformers.js)
- [Silero VAD](https://github.com/snakers4/silero-vad)
- [OpenWakeWord](https://github.com/dscripka/openWakeWord)