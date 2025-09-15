# WebASRCore CDN 使用指南

## 快速開始

WebASRCore 提供了 CDN 版本，讓您無需 npm 安裝即可直接在網頁中使用。

## 版本說明

- **v0.3.0**: ULTIMATE 版本，只需一個 script 標籤，包含 Transformers.js 和所有功能
- **v0.2.0**: ALL-IN-ONE 版本，已包含 ONNX Runtime，但 Whisper 功能需要額外載入 Transformers.js

## 最簡單使用方式（ULTIMATE 版本）🚀

**只需要一個 `<script>` 標籤就能使用所有功能，包括 Whisper！**

```html
<!DOCTYPE html>
<html>
<head>
    <title>WebASRCore ULTIMATE</title>
</head>
<body>
    <!-- 只需要這一個 script 標籤！ -->
    <script src="https://unpkg.com/web-asr-core@0.3.0/dist/web-asr-core.ultimate.min.js"></script>

    <script>
        // 等待 WebASRCore 載入
        window.addEventListener('load', async () => {
            // 所有服務都已經可用，包括 Whisper！

            // VAD 服務
            const vadService = new WebASRCore.VadService();
            await vadService.initialize();

            // 喚醒詞服務
            const wakewordService = new WebASRCore.WakewordService();
            await wakewordService.initialize('hey-jarvis');

            // Whisper 服務（自動配置完成！）
            const whisperService = new WebASRCore.WhisperService({
                language: 'zh',
                temperature: 0.8
            });

            // 初始化 Whisper（首次會下載模型）
            await whisperService.initialize('Xenova/whisper-tiny', {
                quantized: true,
                device: 'wasm'
            });

            console.log('所有服務已就緒！');

            // 現在可以使用 whisperService.transcribe(audioData) 進行轉譯
        });
    </script>
</body>
</html>
```

## 基本使用（VAD 和喚醒詞）

如果您只需要使用 VAD（語音活動檢測）和喚醒詞功能：

```html
<!DOCTYPE html>
<html>
<head>
    <title>WebASRCore 基本功能</title>
</head>
<body>
    <!-- 載入 WebASRCore ALL-IN-ONE 版本 -->
    <script src="https://unpkg.com/web-asr-core@0.2.0/dist/web-asr-core.all.min.js"></script>

    <script>
        // 等待 WebASRCore 載入
        async function initBasicFeatures() {
            // VAD 服務
            const vadService = new WebASRCore.VadService();
            await vadService.initialize();

            // 喚醒詞服務
            const wakewordService = new WebASRCore.WakewordService();
            await wakewordService.initialize('hey-jarvis');

            console.log('服務已就緒！');
        }

        // 頁面載入後初始化
        window.addEventListener('load', initBasicFeatures);
    </script>
</body>
</html>
```

## 完整使用（包含 Whisper 語音轉文字）

如果您需要使用 Whisper 語音轉文字功能，需要額外載入 Transformers.js：

```html
<!DOCTYPE html>
<html>
<head>
    <title>WebASRCore 完整功能</title>
</head>
<body>
    <!-- 1. 載入 WebASRCore ALL-IN-ONE 版本 -->
    <script src="https://unpkg.com/web-asr-core@0.2.0/dist/web-asr-core.all.min.js"></script>

    <!-- 2. 載入 Transformers.js (用於 Whisper) -->
    <script type="module">
        import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.3';

        // 配置 Transformers.js
        env.allowLocalModels = false;  // 使用遠端模型
        env.remoteURL = 'https://huggingface.co/';

        // 設定 WASM 路徑
        env.backends.onnx.wasm = {
            wasmPaths: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.3/dist/'
        };

        // 暴露給全域
        window.transformers = { pipeline, env };
    </script>

    <!-- 3. 主程式 -->
    <script type="module">
        // 等待依賴載入
        async function waitForDependencies() {
            // 等待 WebASRCore
            while (!window.WebASRCore) {
                await new Promise(r => setTimeout(r, 100));
            }

            // 等待 Transformers.js
            while (!window.transformers) {
                await new Promise(r => setTimeout(r, 100));
            }

            console.log('所有依賴已載入');
        }

        async function initAllFeatures() {
            await waitForDependencies();

            // 創建 Whisper 服務
            const whisperService = new WebASRCore.WhisperService({
                language: 'zh',
                temperature: 0.8
            });

            // 監聽事件
            whisperService.on('ready', (event) => {
                console.log('Whisper 已就緒:', event.modelId);
            });

            whisperService.on('transcriptionComplete', (event) => {
                console.log('轉譯結果:', event.text);
            });

            // 初始化（首次會下載模型）
            await whisperService.initialize('Xenova/whisper-tiny', {
                quantized: true,
                device: 'wasm'
            });

            console.log('Whisper 服務已就緒！');

            // 現在可以使用 whisperService.transcribe(audioData) 進行轉譯
        }

        // 初始化
        initAllFeatures().catch(console.error);
    </script>
</body>
</html>
```

## 可用的服務

### 1. VadService - 語音活動檢測
```javascript
const vadService = new WebASRCore.VadService();
await vadService.initialize();

// 處理音訊
const result = await vadService.processAudio(audioData);
console.log('是否有語音:', result.isSpeech);
```

### 2. WakewordService - 喚醒詞檢測
```javascript
const wakewordService = new WebASRCore.WakewordService();
await wakewordService.initialize('hey-jarvis'); // 或 'alexa', 'hey-mycroft'

// 處理音訊
const result = await wakewordService.processAudio(audioData);
console.log('檢測到喚醒詞:', result.detected);
```

### 3. WhisperService - 語音轉文字（需要 Transformers.js）
```javascript
const whisperService = new WebASRCore.WhisperService({
    language: 'zh',  // 語言設定
    temperature: 0.8  // 創造性參數
});

// 初始化模型
await whisperService.initialize('Xenova/whisper-tiny');

// 轉譯音訊
const result = await whisperService.transcribe(audioData);
console.log('轉譯結果:', result.text);
```

### 4. TimerService - 倒數計時器
```javascript
const timerService = new WebASRCore.TimerService();

// 監聽事件
timerService.on('tick', (event) => {
    console.log('剩餘時間:', event.remaining);
});

timerService.on('complete', () => {
    console.log('計時結束！');
});

// 開始計時
timerService.start(60); // 60 秒
```

### 5. SpeechService - Web Speech API 封裝
```javascript
const speechService = new WebASRCore.SpeechService();

// TTS 文字轉語音
await speechService.speak('你好，世界！', {
    lang: 'zh-TW',
    rate: 1.0,
    pitch: 1.0
});

// STT 語音轉文字（使用瀏覽器內建）
speechService.startRecognition({
    lang: 'zh-TW',
    continuous: true
});

speechService.on('result', (event) => {
    console.log('識別結果:', event.transcript);
});
```

## 音訊處理工具

### AudioChunker - 音訊分塊
```javascript
const chunker = new WebASRCore.AudioChunker(512); // 512 樣本per chunk

// 處理音訊
const chunks = chunker.processAudio(largeAudioData);
for (const chunk of chunks) {
    // 處理每個 chunk
}
```

### AudioRingBuffer - 環形緩衝區
```javascript
const buffer = new WebASRCore.AudioRingBuffer(16000); // 1 秒緩衝區 (16kHz)

// 寫入資料
buffer.write(audioData);

// 讀取資料
const data = buffer.read(8000); // 讀取 0.5 秒
```

## 注意事項

1. **首次載入**: Whisper 模型首次載入時需要從 HuggingFace 下載，可能需要一些時間
2. **瀏覽器支援**: 需要支援 WebAssembly 和 AudioWorklet 的現代瀏覽器
3. **HTTPS**: 麥克風權限需要 HTTPS 或 localhost
4. **模型大小**:
   - whisper-tiny: ~39MB
   - whisper-base: ~74MB
   - whisper-small: ~244MB

## 完整範例

請參考以下完整範例檔案：
- `index_cdn.html` - 完整測試介面
- `index_cdn_simple.html` - 簡化版範例
- `test_cdn_whisper.html` - Whisper 專門測試

## 疑難排解

### 問題：Whisper service not initialized
**解決方案**：確保已正確載入 Transformers.js 並等待其初始化完成

### 問題：ONNX Runtime WASM 載入失敗
**解決方案**：檢查網路連線，確保可以訪問 CDN

### 問題：模型下載緩慢
**解決方案**：使用較小的模型（如 whisper-tiny）或考慮自行託管模型

## 版本更新

- **v0.2.0** (2024-01): ALL-IN-ONE CDN 版本，包含 ONNX Runtime
- **v0.1.0** (2024-01): 初始版本

## 支援

如有問題，請在 GitHub Issues 回報：
https://github.com/your-repo/WebASRCore/issues