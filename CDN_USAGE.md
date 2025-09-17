# WebASRCore CDN 使用指南

## 統一版本 - 簡單、強大、一致

WebASRCore 現在只有**一個統一版本**，無論使用 CDN 或 NPM 都能獲得相同的完整功能。

## 🚀 快速開始

### CDN 載入

```html
<!DOCTYPE html>
<html>
<head>
    <title>WebASRCore 語音服務</title>
</head>
<body>
    <!-- 只需要這一行！自動設定所有 WASM 路徑 -->
    <script src="https://unpkg.com/web-asr-core@0.8.1/dist/web-asr-core.min.js"></script>

    <script>
        // 直接使用，無需任何設定！
        window.addEventListener('load', async () => {
            const { VadService, WakewordService, WhisperService } = window.WebASRCore;

            // VAD 服務
            const vadService = new VadService();
            await vadService.initialize();

            // 喚醒詞服務
            const wakewordService = new WakewordService();
            await wakewordService.initialize();
            await wakewordService.loadModel('hey-jarvis');

            // Whisper 服務
            const whisperService = new WhisperService({
                language: 'zh'
            });
            await whisperService.initialize('Xenova/whisper-tiny');

            console.log('所有服務已就緒！');
        });
    </script>
</body>
</html>
```

### NPM 安裝

```bash
npm install web-asr-core
```

```javascript
// ES Module
import * as WebASRCore from 'web-asr-core';

// 使用方式與 CDN 相同
const { VadService, WakewordService, WhisperService } = WebASRCore;
```

## ✨ 統一版本特點

### 一個版本，所有功能
- ✅ **完整的語音處理功能** - VAD、喚醒詞、Whisper
- ✅ **內建所有依賴** - onnxruntime-web 和 transformers.js
- ✅ **自動路徑設定** - 智能偵測並設定 WASM 路徑
- ✅ **跨平台一致性** - CDN 和 NPM 功能完全相同

### 自動化功能
1. **自動偵測載入位置** - 智能判斷是 CDN 或本地載入
2. **自動設定 WASM 路徑** - 無需手動配置任何路徑
3. **自動優化設定** - WebGPU、多線程等自動優化
4. **完整錯誤處理** - 自動 fallback 和錯誤恢復

## 📦 可用的服務

### 核心語音服務
```javascript
// VAD - 語音活動檢測
const vadService = new WebASRCore.VadService();
vadService.on('vadStart', () => console.log('開始說話'));
vadService.on('vadEnd', () => console.log('停止說話'));

// WakeWord - 喚醒詞檢測
const wakewordService = new WebASRCore.WakewordService();
wakewordService.on('wakewordDetected', ({ word, score }) => {
    console.log(`檢測到: ${word} (分數: ${score})`);
});

// Whisper - 語音識別
const whisperService = new WebASRCore.WhisperService();
const result = await whisperService.transcribe(audioData);
console.log('識別結果:', result.text);
```

### 瀏覽器 API 封裝
- **SpeechService** - Web Speech API 封裝（TTS/STT）
- **AudioCapture** - 麥克風音訊擷取
- **AudioResampler** - 音訊重採樣

### 工具類
- **AudioChunker** - 音訊分塊處理
- **AudioRingBuffer** - 環形緩衝區
- **TimerService** - 倒數計時器
- **SystemDiagnostics** - 系統診斷工具
- **ConfigManager** - 配置管理

## 🛠️ 進階配置

### 自訂配置
```javascript
const config = WebASRCore.defaultConfig;

// VAD 設定
config.vad.threshold = 0.6;
config.vad.windowSizeMs = 32;

// 喚醒詞設定
config.wakeword.thresholds = {
    'hey_jarvis': 0.6,
    'alexa': 0.5
};

// Whisper 設定
config.whisper.temperature = 0.0;
config.whisper.language = 'zh';

// ONNX Runtime 設定
config.onnx.webgpu.enabled = true;  // 啟用 WebGPU 加速
config.onnx.useWebWorker = true;    // 使用 Web Worker
```

### WebGPU 加速
```javascript
// 檢查並啟用 WebGPU
if ('gpu' in navigator) {
    WebASRCore.defaultConfig.onnx.webgpu.enabled = true;
    console.log('WebGPU 加速已啟用');
}
```

## 📊 模型選擇指南

### Whisper 模型大小
| 模型 | 大小 | 速度 | 準確度 | 建議用途 |
|------|------|------|--------|----------|
| tiny | ~39MB | 最快 | 較低 | 快速原型、即時回饋 |
| base | ~74MB | 快 | 中等 | 平衡選擇 |
| small | ~244MB | 中等 | 高 | 生產環境 |
| medium | ~769MB | 慢 | 很高 | 高精度需求 |
| large | ~1550MB | 最慢 | 最高 | 專業應用 |

### 效能最佳化建議
1. **使用量化模型** - 設定 `quantized: true`
2. **啟用 WebGPU** - 2-10x 加速（如果可用）
3. **預載模型** - 在需要前先初始化
4. **重用服務實例** - 避免重複創建

## 📚 檔案結構

```
dist/
├── web-asr-core.js           # 完整版（開發用）
├── web-asr-core.min.js       # 壓縮版（生產用，CDN 預設）
├── web-asr-core.bundle.js    # 相容性檔案
├── index.js                  # NPM 模組入口
├── index.d.ts                # TypeScript 型別定義
├── onnx-inference.worker.js  # Web Worker
└── *.wasm                    # WASM 檔案（自動載入）
```

## 🌐 CDN 選項

### 使用最新版本
```html
<!-- unpkg（推薦） -->
<script src="https://unpkg.com/web-asr-core/dist/web-asr-core.min.js"></script>

<!-- jsDelivr -->
<script src="https://cdn.jsdelivr.net/npm/web-asr-core/dist/web-asr-core.min.js"></script>
```

### 指定版本
```html
<!-- 指定版本（更穩定） -->
<script src="https://unpkg.com/web-asr-core@0.7.1/dist/web-asr-core.min.js"></script>

<!-- 或使用 jsDelivr -->
<script src="https://cdn.jsdelivr.net/npm/web-asr-core@0.7.1/dist/web-asr-core.min.js"></script>
```

## 🔧 自行託管

如果要自行託管，只需要複製這些檔案到同一個資料夾：
```
your-server/
├── web-asr-core.min.js
├── ort-wasm-simd-threaded.jsep.mjs
├── ort-wasm-simd-threaded.jsep.wasm
└── ort-wasm-simd-threaded.wasm
```

Bundle 會自動偵測並使用同資料夾的 WASM 檔案！

## ⚠️ 常見問題

### CORS 錯誤
確保伺服器設定正確的 CORS 標頭：
```
Access-Control-Allow-Origin: *
```

### WASM 載入失敗
統一版本會自動設定路徑，但如需手動設定：
```javascript
WebASRCore.ort.env.wasm.wasmPaths = '/custom/path/';
WebASRCore.transformers.env.backends.onnx.wasm.wasmPaths = '/custom/path/';
```

### 瀏覽器支援
- ✅ **Chrome/Edge 90+** - 完整支援（推薦）
- ✅ **Firefox 90+** - 部分功能限制
- ⚠️ **Safari 15+** - 實驗性支援

## 📄 授權

MIT License - 自由使用於商業和非商業專案

---

**WebASRCore 統一版本** - 一個版本，完整功能，簡單使用！