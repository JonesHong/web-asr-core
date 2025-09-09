# WebASRCore

WebASRCore 是一套無狀態的 TypeScript 服務集合，專為瀏覽器端語音處理設計。提供語音活動檢測（VAD）、喚醒詞檢測和語音識別（Whisper）的純函數實現，完全在瀏覽器中運行。

## 功能特色

- **🎯 無狀態設計**：所有服務都是純函數，沒有內部狀態
- **🎤 VAD（語音活動檢測）**：使用 Silero VAD 模型
- **🔊 喚醒詞檢測**：OpenWakeWord 模型（Hey Jarvis、Hey Mycroft、Alexa）
- **✍️ 語音識別**：透過 transformers.js 使用 Whisper 模型
- **🚀 瀏覽器優先**：使用 WebAssembly 完全在瀏覽器中運行
- **📦 TypeScript**：完整的型別定義，提供更好的開發體驗
- **🔧 配置管理**：集中式配置管理器，支援所有參數自訂

## 安裝

```bash
npm install web-asr-core
```

## 快速開始

```typescript
import {
  // 註冊表函數
  loadRegistry,
  resolveVad,
  resolveWakeword,
  resolveWhisper,
  
  // VAD 函數
  loadVadSession,
  createVadState,
  processVad,
  
  // 喚醒詞函數
  loadWakewordResources,
  createWakewordState,
  processWakewordChunk,
  
  // Whisper 函數
  loadWhisperResources,
  transcribe,
  
  // 配置管理
  ConfigManager,
  
  // 型別
  DEFAULT_VAD_PARAMS,
  DEFAULT_WAKEWORD_PARAMS,
} from 'web-asr-core';

// 載入模型註冊表
const registry = await loadRegistry('./models/global_registry.json');

// 初始化服務...
```

## 使用範例

### VAD（語音活動檢測）

```typescript
// 1. 載入 VAD 模型
const vadInfo = resolveVad(registry);
const vadSession = await loadVadSession(vadInfo.modelUrl);

// 2. 建立初始狀態
let vadState = createVadState();

// 3. 處理音訊塊（16kHz，Float32Array）
const audioChunk = new Float32Array(512); // 32ms at 16kHz
const vadResult = await processVad(
  vadSession,
  vadState,
  audioChunk,
  DEFAULT_VAD_PARAMS
);

// 4. 更新狀態以供下次迭代
vadState = vadResult.state;

// 5. 檢查是否檢測到語音
if (vadResult.detected) {
  console.log('檢測到語音！', vadResult.score);
}
```

### 喚醒詞檢測

```typescript
// 1. 載入喚醒詞模型（使用新的 API）
const config = new ConfigManager();
const wwResources = await loadWakewordResources('hey_jarvis', config);

// 2. 建立初始狀態
let wwState = createWakewordState(wwResources.dims);

// 3. 處理音訊塊（16kHz，Float32Array）
const audioChunk = new Float32Array(1280); // 80ms at 16kHz
const wwResult = await processWakewordChunk(
  wwResources,
  wwState,
  audioChunk,
  { threshold: config.wakeword.hey_jarvis.threshold }
);

// 4. 更新狀態以供下次迭代
wwState = wwResult.state;

// 5. 檢查是否檢測到喚醒詞
if (wwResult.triggered) {
  console.log('檢測到喚醒詞！', wwResult.score);
  // 檢測後重設狀態
  wwState = resetWakewordState(wwResources.dims);
}
```

### Whisper 語音識別

```typescript
// 1. 載入 Whisper 模型
const whisperInfo = resolveWhisper(registry, 'whisper-base');
const whisperResources = await loadWhisperResources(
  whisperInfo.path,
  { quantized: whisperInfo.quantized }
);

// 2. 轉錄音訊（16kHz，Float32Array）
const audioData = new Float32Array(16000 * 5); // 5 秒音訊
const result = await transcribe(
  whisperResources,
  audioData,
  {
    language: 'zh',  // 支援中文
    task: 'transcribe',
    returnSegments: true,
  }
);

console.log('轉錄結果：', result.text);
if (result.segments) {
  result.segments.forEach(segment => {
    console.log(`[${segment.start}-${segment.end}]: ${segment.text}`);
  });
}
```

## 完整範例：語音助手

```typescript
import * as WebASRCore from 'web-asr-core';

async function createVoiceAssistant() {
  // 載入註冊表和模型
  const registry = await WebASRCore.loadRegistry('./models/global_registry.json');
  const config = new WebASRCore.ConfigManager();
  
  // 初始化 VAD
  const vadInfo = WebASRCore.resolveVad(registry);
  const vadSession = await WebASRCore.loadVadSession(vadInfo.modelUrl);
  let vadState = WebASRCore.createVadState();
  
  // 初始化喚醒詞
  const wwResources = await WebASRCore.loadWakewordResources('hey_jarvis', config);
  let wwState = WebASRCore.createWakewordState(wwResources.dims);
  
  // 初始化 Whisper
  const whisperInfo = WebASRCore.resolveWhisper(registry, 'whisper-base');
  const whisperResources = await WebASRCore.loadWhisperResources(
    whisperInfo.path,
    { quantized: true }
  );
  
  // 音訊收集緩衝區
  const audioBuffer: Float32Array[] = [];
  let isListening = false;
  
  // 處理音訊流（每 80ms 處理新的音訊塊）
  async function processAudioChunk(chunk: Float32Array) {
    // 未監聽時檢查喚醒詞
    if (!isListening) {
      const wwResult = await WebASRCore.processWakewordChunk(
        wwResources,
        wwState,
        chunk,
        { threshold: config.wakeword.hey_jarvis.threshold }
      );
      wwState = wwResult.state;
      
      if (wwResult.triggered) {
        console.log('檢測到喚醒詞！開始監聽...');
        isListening = true;
        audioBuffer.length = 0;
        wwState = WebASRCore.resetWakewordState(wwResources.dims);
      }
      return;
    }
    
    // 使用 VAD 檢測語音
    const vadResult = await WebASRCore.processVad(
      vadSession,
      vadState,
      chunk,
      WebASRCore.DEFAULT_VAD_PARAMS
    );
    vadState = vadResult.state;
    
    // 語音活動時收集音訊
    if (vadResult.detected || vadState.isSpeechActive) {
      audioBuffer.push(chunk);
    }
    
    // 語音結束時進行轉錄
    if (!vadState.isSpeechActive && audioBuffer.length > 0) {
      // 合併音訊塊
      const totalLength = audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
      const combinedAudio = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of audioBuffer) {
        combinedAudio.set(chunk, offset);
        offset += chunk.length;
      }
      
      // 轉錄
      const result = await WebASRCore.transcribe(
        whisperResources,
        combinedAudio,
        { language: 'zh' }
      );
      
      console.log('您說：', result.text);
      
      // 重設以進行下次互動
      audioBuffer.length = 0;
      isListening = false;
    }
  }
  
  return { processAudioChunk };
}

// 與 Web Audio API 配合使用
async function startRecording() {
  const assistant = await createVoiceAssistant();
  
  // 取得麥克風權限（關閉音訊處理以獲得原始音訊）
  const stream = await navigator.mediaDevices.getUserMedia({ 
    audio: {
      channelCount: 1,
      sampleRate: 16000,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  });
  
  const audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(stream);
  
  // 建立處理器處理 80ms 塊
  const processor = audioContext.createScriptProcessor(1280, 1, 1);
  
  processor.onaudioprocess = async (e) => {
    const inputData = e.inputBuffer.getChannelData(0);
    await assistant.processAudioChunk(new Float32Array(inputData));
  };
  
  source.connect(processor);
  processor.connect(audioContext.destination);
}
```

## API 參考

### 註冊表函數

- `loadRegistry(url)`: 從 JSON 載入模型註冊表
- `resolveVad(registry)`: 取得 VAD 模型配置
- `resolveWakeword(registry, id?)`: 取得喚醒詞模型配置
- `resolveWhisper(registry, id?)`: 取得 Whisper 模型配置
- `getAvailableModels(registry, type)`: 列出可用模型

### VAD 服務

- `loadVadSession(modelUrl, options?)`: 載入 VAD 模型
- `createVadState()`: 建立初始 VAD 狀態
- `processVad(session, state, audio, params)`: 處理音訊進行 VAD
- `processVadChunks(session, chunks, state, params)`: 處理多個音訊塊

### 喚醒詞服務

- `loadWakewordResources(wakewordName, config?, customPaths?)`: 載入所有喚醒詞模型
- `detectWakewordDims(resources, config?)`: 檢測模型維度
- `createWakewordState(dims)`: 建立初始狀態
- `processWakewordChunk(resources, state, audio, params, config?)`: 處理音訊
- `resetWakewordState(dims)`: 檢測後重設狀態
- `createDefaultWakewordParams(wakewordName, config?)`: 建立預設參數

### Whisper 服務

- `loadWhisperResources(modelPath, options?)`: 載入 Whisper 模型
- `transcribe(resources, audio, options?)`: 轉錄音訊
- `transcribeChunks(resources, chunks, options?)`: 轉錄多個音訊塊

### 配置管理

```typescript
import { ConfigManager } from 'web-asr-core';

const config = new ConfigManager();

// 自訂 VAD 參數
config.vad.threshold = 0.6;
config.vad.minSilenceDuration = 1000;

// 自訂喚醒詞參數
config.wakeword.hey_jarvis.threshold = 0.5;
config.wakeword.common.melFramesPerChunk = 5;

// 自訂 Whisper 參數
config.whisper.temperature = 0.2;
config.whisper.maxLength = 448;
```

## 模型配置

模型透過 `global_registry.json` 配置。註冊表定義可用模型及其路徑：

```json
{
  "version": "1.0.0",
  "models": [
    {
      "id": "silero-vad",
      "type": "vad",
      "local_path": "silero_vad.onnx"
    },
    {
      "id": "hey-jarvis",
      "type": "wakeword",
      "local_path": "hey_jarvis_v0.1.onnx",
      "files": {
        "required": [
          "melspectrogram.onnx",
          "embedding_model.onnx"
        ]
      }
    },
    {
      "id": "whisper-base",
      "type": "asr",
      "local_path": "huggingface/Xenova/whisper-base"
    }
  ]
}
```

## 系統需求

- 支援 WebAssembly 的現代瀏覽器
- ONNX Runtime Web 用於模型推理
- transformers.js 用於 Whisper 模型
- 16kHz 取樣率的音訊輸入

## 架構設計

所有服務遵循無狀態、函數式設計：

1. **資源（Resources）**：模型會話/管線載入一次並重複使用
2. **狀態（State）**：由呼叫者維護，在函數呼叫之間傳遞
3. **處理（Processing）**：純函數 (resources, state, input) → (result, newState)
4. **無副作用**：沒有全域狀態或內部變更

## 效能

- **VAD**：每 80ms 塊約 5ms
- **喚醒詞**：每 80ms 塊約 20-30ms
- **Whisper**：10 秒音訊約 1-3 秒（視模型大小而定）

## 瀏覽器相容性

- Chrome/Edge：完全支援（建議使用）
- Firefox：完全支援
- Safari：實驗性支援（某些功能可能受限）

## 已知問題與解決方案

### 音訊縮放問題

如果遇到喚醒詞在靜音時誤觸發（高分數但低 RMS），通常是音訊縮放問題：

1. **關閉瀏覽器音訊處理**：
```javascript
getUserMedia({
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
  }
})
```

2. **驗證實際設定**：
```javascript
const settings = audioTrack.getSettings();
console.log('音訊設定：', settings);
```

3. **檢查音訊健康狀態**：
正常說話時 maxAbs 應該 > 0.01，dBFS 應該在 -40 到 -20 之間。

## 授權

MIT

## 貢獻

歡迎貢獻！請隨時提交問題或拉取請求。

## 致謝

- [Silero VAD](https://github.com/snakers4/silero-vad) 提供 VAD 模型
- [OpenWakeWord](https://github.com/dscripka/openWakeWord) 提供喚醒詞模型
- [Whisper](https://github.com/openai/whisper) 和 [transformers.js](https://github.com/xenova/transformers.js) 提供語音識別