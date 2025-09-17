# WebASRCore

瀏覽器端的語音處理完整解決方案 - VAD、喚醒詞、語音識別，全部在本地運行。

## 🚀 快速開始

### CDN 使用
```html
<script src="https://unpkg.com/web-asr-core@0.8.1/dist/web-asr-core.min.js"></script>
```

### NPM 安裝
```bash
npm install web-asr-core
```

```javascript
import * as WebASRCore from 'web-asr-core';
```

## 📦 核心服務使用指南

### 1. VAD Service（語音活動檢測）

檢測何時有人在說話。

```javascript
// 初始化服務
const vadService = new WebASRCore.VadService();
await vadService.initialize();

// 設定事件監聽
vadService.on('vadStart', () => {
    console.log('開始說話');
});

vadService.on('vadEnd', () => {
    console.log('停止說話');
});

// 開始處理音訊
await vadService.start();

// 輸入音訊資料（Float32Array, 16kHz）
vadService.processAudio(audioData);

// 停止服務
vadService.stop();
```

**參數設定**：
```javascript
const vadService = new WebASRCore.VadService({
    threshold: 0.5,           // 語音檢測閾值 (0-1)
    minSpeechFrames: 3,       // 最少語音幀數才觸發
    minSilenceFrames: 10,     // 最少靜音幀數才結束
    preSpeechPadFrames: 5     // 語音前緩衝幀數
});
```

### 2. WakeWord Service（喚醒詞檢測）

檢測特定的喚醒詞如 "Hey Jarvis"、"Alexa" 等。

```javascript
// 初始化服務
const wakewordService = new WebASRCore.WakewordService();
await wakewordService.initialize();

// 載入喚醒詞模型
await wakewordService.loadModel('hey-jarvis');

// 設定檢測事件
wakewordService.on('wakewordDetected', (data) => {
    console.log(`檢測到喚醒詞: ${data.word}, 信心度: ${data.score}`);
});

// 開始處理音訊
await wakewordService.start();

// 輸入音訊資料
wakewordService.processAudio(audioData);
```

**可用的喚醒詞模型**：
- `hey-jarvis` - "Hey Jarvis"
- `alexa` - "Alexa"
- `hey_rhasspy` - "Hey Rhasspy"
- `hey_mycroft` - "Hey Mycroft"

**調整檢測閾值**：
```javascript
const wakewordService = new WebASRCore.WakewordService({
    thresholds: {
        'hey-jarvis': 0.5,    // 降低會更容易觸發
        'alexa': 0.6
    }
});
```

### 3. Whisper Service（語音識別）

將語音轉換為文字，支援多種語言。

```javascript
// 初始化服務
const whisperService = new WebASRCore.WhisperService({
    language: 'zh'  // 中文
});

// 載入模型（第一次會自動下載）
await whisperService.initialize('Xenova/whisper-tiny');

// 轉錄音訊
const result = await whisperService.transcribe(audioData);
console.log('識別結果:', result.text);
```

**可用的 Whisper 模型**：
| 模型 | 大小 | 準確度 | 速度 |
|------|------|--------|------|
| `Xenova/whisper-tiny` | 39MB | 較低 | 最快 |
| `Xenova/whisper-base` | 74MB | 中等 | 快 |
| `Xenova/whisper-small` | 244MB | 高 | 中等 |
| `Xenova/whisper-medium` | 769MB | 很高 | 慢 |
| `Xenova/whisper-large-v3` | 1550MB | 最高 | 最慢 |

**語言設定**：
```javascript
// 多語言模型
const whisperService = new WebASRCore.WhisperService({
    language: 'zh'     // 中文
    // language: 'en'  // 英文
    // language: 'ja'  // 日文
});

// 純英文模型（速度更快）
await whisperService.initialize('Xenova/whisper-tiny.en');
```

## 🗂️ 模型配置指南

### 本地模型配置

如果你想使用本地模型以避免下載時間，請按照以下步驟：

#### 1. 下載模型檔案

**VAD 模型**：
從 https://github.com/snakers4/silero-vad 下載：
- `silero_vad.onnx`

**喚醒詞模型**：
從 https://github.com/dscripka/openWakeWord 下載對應的 ONNX 檔案：
- `hey_jarvis_v0.1.onnx`
- `alexa_v0.1.onnx`
- 等等...

**Whisper 模型**：
從 HuggingFace 下載，例如 https://huggingface.co/Xenova/whisper-tiny：
- `onnx/encoder_model_quantized.onnx`
- `onnx/decoder_model_merged_quantized.onnx`
- `config.json`
- `tokenizer.json`
- 等等...

#### 2. 放置模型檔案

建議的目錄結構（遵循 平台/作者/模型 的組織方式）：
```
your-project/
├── models/
│   ├── github/
│   │   ├── snakers4/
│   │   │   └── silero-vad/
│   │   │       └── silero_vad_v6.onnx
│   │   └── dscripka/
│   │       └── openWakeWord/
│   │           ├── hey_jarvis_v0.1.onnx
│   │           ├── alexa_v0.1.onnx
│   │           ├── hey_mycroft_v0.1.onnx
│   │           ├── hey_rhasspy_v0.1.onnx
│   │           ├── melspectrogram.onnx
│   │           └── embedding_model.onnx
│   └── huggingface/
│       └── Xenova/
│           └── whisper-tiny/
│               ├── onnx/
│               │   ├── encoder_model_quantized.onnx
│               │   └── decoder_model_merged_quantized.onnx
│               ├── config.json
│               └── tokenizer.json
```

#### 3. 配置本地路徑

```javascript
// 配置管理器
const config = WebASRCore.defaultConfig;

// VAD 本地模型（符合預設路徑結構）
config.vad.modelPath = './models/github/snakers4/silero-vad/silero_vad_v6.onnx';

// 喚醒詞本地模型（每個喚醒詞都有獨立的配置）
config.wakeword.hey_jarvis.detectorPath = './models/github/dscripka/openWakeWord/hey_jarvis_v0.1.onnx';
config.wakeword.hey_jarvis.melspecPath = './models/github/dscripka/openWakeWord/melspectrogram.onnx';
config.wakeword.hey_jarvis.embeddingPath = './models/github/dscripka/openWakeWord/embedding_model.onnx';

// 或者使用其他喚醒詞
config.wakeword.alexa.detectorPath = './models/github/dscripka/openWakeWord/alexa_v0.1.onnx';
config.wakeword.alexa.melspecPath = './models/github/dscripka/openWakeWord/melspectrogram.onnx';
config.wakeword.alexa.embeddingPath = './models/github/dscripka/openWakeWord/embedding_model.onnx';
config.wakeword.alexa.enabled = true;  // 啟用 Alexa 喚醒詞

// Whisper 本地模型
// 對於 Whisper，設定 transformers.js 的本地路徑
WebASRCore.transformers.env.localURL = './models/huggingface/';
WebASRCore.transformers.env.allowLocalModels = true;
WebASRCore.transformers.env.allowRemoteModels = false; // 只使用本地

// 初始化服務時會使用這些配置
const vadService = new WebASRCore.VadService();
const wakewordService = new WebASRCore.WakewordService();
const whisperService = new WebASRCore.WhisperService();

// 注意：如果你的模型檔案位置與預設不同，請確保更新對應的路徑配置
```

### 遠端模型配置

**重要**：VAD 和喚醒詞使用 `onnxruntime-web`，需要提供完整的模型 URL。只有 Whisper（使用 transformers.js）會自動從 HuggingFace 下載。

```javascript
// VAD - 需要提供完整 URL
const config = WebASRCore.defaultConfig;
config.vad.modelPath = 'https://github.com/snakers4/silero-vad/raw/main/files/silero_vad.onnx';

const vadService = new WebASRCore.VadService();
await vadService.initialize();

// 喚醒詞 - 需要提供完整 URL
config.wakeword.hey_jarvis.detectorPath = 'https://github.com/dscripka/openWakeWord/raw/main/openwakeword/resources/models/hey_jarvis_v0.1.onnx';
config.wakeword.hey_jarvis.melspecPath = 'https://github.com/dscripka/openWakeWord/raw/main/openwakeword/resources/models/melspectrogram.onnx';
config.wakeword.hey_jarvis.embeddingPath = 'https://github.com/dscripka/openWakeWord/raw/main/openwakeword/resources/models/embedding_model.onnx';

const wakewordService = new WebASRCore.WakewordService();
await wakewordService.initialize();
await wakewordService.loadModel('hey-jarvis');

// Whisper - 自動從 HuggingFace 下載（transformers.js 的功能）
const whisperService = new WebASRCore.WhisperService();
await whisperService.initialize('Xenova/whisper-tiny'); // 真的會自動下載！
```

**或者使用自己的 CDN**：
```javascript
// 如果你把模型放在自己的 CDN
config.vad.modelPath = 'https://your-cdn.com/models/vad/silero_vad.onnx';
config.wakeword.hey_jarvis.detectorPath = 'https://your-cdn.com/models/wakeword/hey_jarvis.onnx';
// 記得設定正確的 CORS headers！
```

### 混合模式（推薦）

你可以混合使用本地和遠端模型：

```javascript
const config = WebASRCore.defaultConfig;

// VAD - 使用本地模型
config.vad.modelPath = './models/github/snakers4/silero-vad/silero_vad_v6.onnx';

// 喚醒詞 - 使用遠端 URL（完整路徑）
config.wakeword.hey_jarvis.detectorPath = 'https://github.com/dscripka/openWakeWord/raw/main/openwakeword/resources/models/hey_jarvis_v0.1.onnx';
config.wakeword.hey_jarvis.melspecPath = 'https://github.com/dscripka/openWakeWord/raw/main/openwakeword/resources/models/melspectrogram.onnx';
config.wakeword.hey_jarvis.embeddingPath = 'https://github.com/dscripka/openWakeWord/raw/main/openwakeword/resources/models/embedding_model.onnx';

// Whisper - 讓 transformers.js 自動處理（可以本地或遠端）
WebASRCore.transformers.env.allowLocalModels = true;  // 允許使用本地模型
WebASRCore.transformers.env.allowRemoteModels = true; // 允許從 HuggingFace 下載

// 初始化服務
const vadService = new WebASRCore.VadService();        // 使用本地 VAD
const wakewordService = new WebASRCore.WakewordService(); // 從 GitHub 載入
const whisperService = new WebASRCore.WhisperService();   // 自動處理

await vadService.initialize();
await wakewordService.initialize();
await whisperService.initialize('Xenova/whisper-tiny'); // 優先本地，沒有則下載
```

**注意事項**：
- **VAD/喚醒詞**：使用 `onnxruntime-web`，必須提供完整路徑（本地相對路徑或完整 URL）
- **Whisper**：使用 `transformers.js`，可以只給模型名稱（如 'Xenova/whisper-tiny'），會自動從 HuggingFace 下載
- **CORS**：使用遠端 URL 時，確保伺服器有正確的 CORS 設定

## 🎯 完整使用範例

### 即時語音轉文字系統

```javascript
// 完整的語音轉文字系統
class VoiceToText {
    constructor() {
        this.vadService = null;
        this.whisperService = null;
        this.audioChunks = [];
        this.isRecording = false;
    }

    async initialize() {
        // 初始化 VAD
        this.vadService = new WebASRCore.VadService({
            threshold: 0.5,
            minSpeechFrames: 3
        });
        await this.vadService.initialize();

        // 初始化 Whisper
        this.whisperService = new WebASRCore.WhisperService({
            language: 'zh'
        });
        await this.whisperService.initialize('Xenova/whisper-tiny');

        // 設定 VAD 事件
        this.vadService.on('vadStart', () => {
            console.log('開始錄音...');
            this.isRecording = true;
            this.audioChunks = [];
        });

        this.vadService.on('vadEnd', async () => {
            console.log('錄音結束，開始轉錄...');
            this.isRecording = false;

            // 合併音訊並轉錄
            const audioData = this.mergeAudioChunks(this.audioChunks);
            const result = await this.whisperService.transcribe(audioData);
            console.log('識別結果:', result.text);
        });
    }

    async startListening() {
        // 獲取麥克風
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                sampleRate: 16000,
                channelCount: 1
            }
        });

        // 建立音訊處理
        const audioContext = new AudioContext({ sampleRate: 16000 });
        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(512, 1, 1);

        processor.onaudioprocess = (e) => {
            const audioData = e.inputBuffer.getChannelData(0);

            // VAD 處理
            this.vadService.processAudio(audioData);

            // 儲存音訊片段
            if (this.isRecording) {
                this.audioChunks.push(new Float32Array(audioData));
            }
        };

        source.connect(processor);
        processor.connect(audioContext.destination);

        await this.vadService.start();
    }

    mergeAudioChunks(chunks) {
        const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
        const merged = new Float32Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
        }
        return merged;
    }
}

// 使用
const voiceToText = new VoiceToText();
await voiceToText.initialize();
await voiceToText.startListening();
```

### 喚醒詞 + 語音助理

```javascript
// 語音助理系統
class VoiceAssistant {
    constructor() {
        this.wakewordService = null;
        this.whisperService = null;
        this.isListening = false;
    }

    async initialize() {
        // 初始化喚醒詞
        this.wakewordService = new WebASRCore.WakewordService({
            thresholds: {
                'hey-jarvis': 0.5
            }
        });
        await this.wakewordService.initialize();
        await this.wakewordService.loadModel('hey-jarvis');

        // 初始化 Whisper
        this.whisperService = new WebASRCore.WhisperService({
            language: 'zh'
        });
        await this.whisperService.initialize('Xenova/whisper-base');

        // 喚醒詞事件
        this.wakewordService.on('wakewordDetected', async (data) => {
            console.log(`喚醒詞檢測到: ${data.word}`);
            await this.startListeningForCommand();
        });
    }

    async startListeningForCommand() {
        console.log('請說出你的指令...');
        this.isListening = true;

        // 錄音 3 秒
        const audioData = await this.recordAudio(3000);

        // 轉錄
        const result = await this.whisperService.transcribe(audioData);
        console.log('指令:', result.text);

        // 處理指令
        await this.processCommand(result.text);

        this.isListening = false;
    }

    async processCommand(command) {
        // 這裡處理各種指令
        if (command.includes('天氣')) {
            console.log('正在查詢天氣...');
        } else if (command.includes('音樂')) {
            console.log('正在播放音樂...');
        }
    }

    async recordAudio(duration) {
        // 實現錄音邏輯
        // 返回 Float32Array 格式的音訊資料
    }
}

// 使用
const assistant = new VoiceAssistant();
await assistant.initialize();
```

### 完整智慧語音助手（含 VAD、自動超時、手動控制）

```javascript
// 完整的智慧語音助手系統
// 功能：
// - 喚醒詞啟動或手動喚醒
// - 即時語音轉文字 (STT)
// - VAD 靜音檢測
// - 自動超時返回閒置
// - 可配置的敏感度和超時設定

class SmartVoiceAssistant {
    constructor() {
        // 服務實例
        this.vadService = null;
        this.wakewordService = null;
        this.speechService = null;
        this.timerService = null;
        this.audioCapture = null;

        // 狀態管理
        this.state = 'idle'; // 'idle' | 'listening' | 'processing'
        this.isAwake = false;

        // 配置參數
        this.config = {
            // 自訂喚醒詞模型路徑
            customWakewordModel: '/models/custom/my-assistant.onnx',

            // VAD 設定
            vadThreshold: 0.5,        // VAD 敏感度 (0.1-0.9，越低越敏感)
            vadDebounce: 1000,         // VAD 去抖動時間 (ms)

            // 喚醒詞設定
            wakewordThreshold: 0.6,   // 喚醒詞敏感度 (0.1-0.9，越低越敏感)

            // 計時器設定
            silenceTimeout: 5000,      // 靜音超時時間 (ms)
            maxListeningTime: 30000,   // 最大聆聽時間 (ms)

            // STT 設定
            sttLanguage: 'zh-TW',      // 語言設定
            sttContinuous: true,       // 連續識別
            sttInterimResults: true    // 顯示即時結果
        };
    }

    async initialize() {
        console.log('🚀 初始化智慧語音助手...');

        // 1. 初始化 VAD
        this.vadService = new WebASRCore.VadService({
            threshold: this.config.vadThreshold,
            debounceTime: this.config.vadDebounce
        });
        await this.vadService.initialize();

        // 2. 初始化喚醒詞
        this.wakewordService = new WebASRCore.WakewordService({
            thresholds: {
                'custom': this.config.wakewordThreshold
            }
        });
        await this.wakewordService.initialize();

        // 載入自訂喚醒詞模型
        await this.wakewordService.loadCustomModel(
            'custom',
            this.config.customWakewordModel
        );

        // 3. 初始化 Speech Service (Web Speech API)
        this.speechService = new WebASRCore.SpeechService();

        // 4. 初始化計時器
        this.timerService = new WebASRCore.TimerService();

        // 5. 初始化音訊擷取
        this.audioCapture = new WebASRCore.AudioCapture({
            sampleRate: 16000,
            echoCancellation: false,
            noiseSuppression: false
        });

        // 設定事件監聽器
        this.setupEventListeners();

        console.log('✅ 智慧語音助手初始化完成');

        // 開始閒置狀態
        await this.enterIdleState();
    }

    setupEventListeners() {
        // 喚醒詞檢測
        this.wakewordService.on('wakewordDetected', (data) => {
            console.log(`🎯 檢測到喚醒詞 (信心度: ${data.score})`);
            if (this.state === 'idle') {
                this.wakeUp();
            }
        });

        // VAD 語音活動檢測
        this.vadService.on('vadStart', () => {
            if (this.isAwake) {
                console.log('🎤 檢測到語音活動');
                // 停止並重置靜音計時器
                this.timerService.pause('silenceTimer');
                this.timerService.reset('silenceTimer');
            }
        });

        this.vadService.on('vadEnd', () => {
            if (this.isAwake) {
                console.log('🔇 語音活動結束');
                // 開始靜音倒數計時
                this.startSilenceTimer();
            }
        });

        // Speech STT 結果
        this.speechService.on('result', (event) => {
            if (event.results && event.results.length > 0) {
                const result = event.results[event.results.length - 1];
                const transcript = result[0].transcript;

                if (result.isFinal) {
                    console.log('💬 最終識別:', transcript);
                    this.processCommand(transcript);
                } else {
                    console.log('💭 即時識別:', transcript);
                }
            }
        });

        // 計時器完成事件
        this.timerService.on('complete', (timerId) => {
            if (timerId === 'silenceTimer') {
                console.log('⏰ 靜音超時，返回閒置');
                this.sleep();
            } else if (timerId === 'maxListeningTimer') {
                console.log('⏰ 達到最大聆聽時間');
                this.sleep();
            }
        });
    }

    // 進入閒置狀態
    async enterIdleState() {
        console.log('😴 進入閒置狀態...');
        this.state = 'idle';
        this.isAwake = false;

        // 停止 STT 和 VAD
        this.speechService.stop();
        await this.vadService.stop();

        // 清除計時器
        this.timerService.clear('silenceTimer');
        this.timerService.clear('maxListeningTimer');

        // 開始監聽喚醒詞
        await this.audioCapture.start();
        await this.wakewordService.start();
    }

    // 喚醒助手
    async wakeUp() {
        console.log('🎉 助手已喚醒！');
        this.state = 'listening';
        this.isAwake = true;

        // 停止喚醒詞檢測
        await this.wakewordService.stop();

        // 播放喚醒提示音
        this.playSound('wake');

        // 開始 VAD 和 STT
        await this.vadService.start();
        this.speechService.start({
            language: this.config.sttLanguage,
            continuous: this.config.sttContinuous,
            interimResults: this.config.sttInterimResults
        });

        // 設定最大聆聽時間計時器
        this.timerService.create('maxListeningTimer', {
            duration: this.config.maxListeningTime,
            autoStart: true
        });

        // 初始靜音檢測
        this.startSilenceTimer();
    }

    // 返回閒置
    async sleep() {
        console.log('😴 返回閒置狀態');

        // 播放休眠提示音
        this.playSound('sleep');

        await this.enterIdleState();
    }

    // 開始靜音計時器
    startSilenceTimer() {
        // 創建或重置靜音計時器
        if (this.timerService.exists('silenceTimer')) {
            this.timerService.reset('silenceTimer');
        } else {
            this.timerService.create('silenceTimer', {
                duration: this.config.silenceTimeout,
                autoStart: false
            });
        }

        this.timerService.start('silenceTimer');
    }

    // 處理語音指令
    async processCommand(command) {
        console.log('🤖 處理指令:', command);
        this.state = 'processing';

        // 暫停計時器
        this.timerService.pause('silenceTimer');

        // 檢查停止指令
        if (command.includes('停止') || command.includes('結束')) {
            await this.sleep();
            return;
        }

        // 處理其他指令...
        // 這裡加入您的指令處理邏輯

        // 繼續聆聽
        this.state = 'listening';
        this.startSilenceTimer();
    }

    // 手動控制方法
    async manualWakeUp() {
        if (this.state === 'idle') {
            console.log('🎮 手動喚醒助手');
            await this.wakeUp();
        }
    }

    async manualSleep() {
        if (this.isAwake) {
            console.log('🎮 手動休眠助手');
            await this.sleep();
        }
    }

    // 播放提示音
    playSound(type) {
        const audio = new Audio(`/sounds/${type}.mp3`);
        audio.play().catch(e => console.log('音效播放失敗'));
    }

    // 清理資源
    async destroy() {
        await this.vadService?.stop();
        await this.wakewordService?.stop();
        this.speechService?.stop();
        await this.audioCapture?.stop();
        this.timerService?.clearAll();
    }
}

// 使用範例
async function startAssistant() {
    const assistant = new SmartVoiceAssistant();

    // 初始化
    await assistant.initialize();

    // 綁定手動控制按鈕
    document.getElementById('wakeBtn')?.addEventListener('click', () => {
        assistant.manualWakeUp();
    });

    document.getElementById('sleepBtn')?.addEventListener('click', () => {
        assistant.manualSleep();
    });

    // 頁面關閉時清理
    window.addEventListener('beforeunload', () => {
        assistant.destroy();
    });
}

// 啟動助手
startAssistant().catch(console.error);
```

## 🔧 進階配置

### WebGPU 加速

```javascript
// 啟用 WebGPU 加速（如果可用）
if ('gpu' in navigator) {
    WebASRCore.defaultConfig.onnx.webgpu.enabled = true;
    console.log('WebGPU 加速已啟用');
}
```

### Web Worker 執行

```javascript
// 在 Web Worker 中執行推理
WebASRCore.defaultConfig.onnx.useWebWorker = true;
```

### 自訂音訊處理

```javascript
// 使用內建的音訊工具
const audioCapture = WebASRCore.getAudioCapture();
const audioResampler = new WebASRCore.AudioResampler();
const audioChunker = new WebASRCore.AudioChunker();

// 音訊重採樣到 16kHz
const resampled = await audioResampler.resample(audioData, originalSampleRate, 16000);
```

## 📊 效能優化建議

1. **選擇適當的模型大小**
   - 開發測試：使用 `tiny` 模型
   - 生產環境：根據準確度需求選擇
   - 行動裝置：建議 `tiny` 或 `base`

2. **使用量化模型**
   ```javascript
   // Whisper 使用量化模型（預設）
   await whisperService.initialize('Xenova/whisper-tiny', {
       quantized: true  // 預設就是 true
   });
   ```

3. **預載模型**
   ```javascript
   // 在應用啟動時預載所有模型
   async function preloadModels() {
       const vad = new WebASRCore.VadService();
       const wakeword = new WebASRCore.WakewordService();
       const whisper = new WebASRCore.WhisperService();

       await Promise.all([
           vad.initialize(),
           wakeword.initialize(),
           whisper.initialize('Xenova/whisper-tiny')
       ]);
   }
   ```

4. **重用服務實例**
   - 不要重複創建服務實例
   - 全域共享一個實例

## 🌐 瀏覽器支援

- **Chrome/Edge 90+**：完整支援
- **Firefox 90+**：完整支援
- **Safari 15+**：實驗性支援

必要的瀏覽器 API：
- WebAssembly
- AudioWorklet 或 ScriptProcessorNode
- Web Workers
- MediaDevices (getUserMedia)

## 📝 授權

MIT License

## 🔗 相關資源

- [Silero VAD](https://github.com/snakers4/silero-vad) - VAD 模型
- [OpenWakeWord](https://github.com/dscripka/openWakeWord) - 喚醒詞模型
- [Transformers.js](https://github.com/xenova/transformers.js) - Whisper 實現
- [測試範例](test/cdn/) - 完整的測試範例