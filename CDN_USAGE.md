# CDN 使用指南 - WebASRCore ULTIMATE 版本

## v0.7.1 - 真正的「一支 CDN script 就能用」（改進版）

現在 WebASRCore ULTIMATE 版本已經做到**完全自動化**，無需任何額外配置！

## 🚀 最簡單使用方式

```html
<!DOCTYPE html>
<html>
<head>
    <title>WebASRCore 語音服務</title>
</head>
<body>
    <!-- 只需要這一行！v0.7.0 自動設定所有 WASM 路徑 -->
    <script src="https://unpkg.com/web-asr-core@0.7.0/dist/web-asr-core.ultimate.min.js"></script>

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

            // Whisper 服務（全自動配置！）
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

## ✨ 新版本特點

### v0.7.1 改進內容
1. **改用字首字串設定** - 更穩定的 WASM 路徑配置方式
2. **移除路徑凍結** - 讓庫能在不同環境自適應
3. **同時設定兩層環境** - transformers.env 和 ort.env 都正確配置
4. **修復 about:blank 問題** - 徹底解決跨域載入錯誤

### v0.7.0 自動化功能
1. **自動偵測 Bundle 位置** - 智能判斷 script 來源
2. **自動設定 WASM 路徑** - 無需手動配置任何路徑
3. **凍結路徑設定** - 防止被其他程式碼覆寫
4. **完整錯誤處理** - 自動 fallback 到 CDN

### 包含的功能
- ✅ **Transformers.js** - 完整的 Whisper 支援
- ✅ **ONNX Runtime Web** - VAD 和 WakeWord 支援
- ✅ **所有 WASM 檔案** - 自動從同資料夾載入
- ✅ **WebGPU 加速** - 自動啟用（如果可用）

## 🛠️ 進階使用

### 使用特定版本
```html
<!-- 指定版本 -->
<script src="https://unpkg.com/web-asr-core@0.7.0/dist/web-asr-core.ultimate.min.js"></script>

<!-- 或使用 jsDelivr CDN -->
<script src="https://cdn.jsdelivr.net/npm/web-asr-core@0.7.0/dist/web-asr-core.ultimate.min.js"></script>

<!-- 永遠使用最新版 -->
<script src="https://unpkg.com/web-asr-core@latest/dist/web-asr-core.ultimate.min.js"></script>
```

### 自行託管
如果要自行託管，只需要複製這些檔案到同一個資料夾：
```
your-server/
├── web-asr-core.ultimate.min.js
├── ort-wasm-simd-threaded.jsep.mjs
├── ort-wasm-simd-threaded.jsep.wasm
└── ort-wasm-simd-threaded.wasm
```

Bundle 會自動偵測並使用同資料夾的 WASM 檔案！

## 📦 完整範例

### VAD（語音活動檢測）
```javascript
const { VadService } = window.WebASRCore;

// 初始化
const vadService = new VadService();
await vadService.initialize();

// 監聽事件
vadService.on('speech-start', () => console.log('開始說話'));
vadService.on('speech-end', () => console.log('停止說話'));

// 開始檢測（需要麥克風權限）
await vadService.start();
```

### Wake Word（喚醒詞檢測）
```javascript
const { WakewordService } = window.WebASRCore;

// 初始化
const wakewordService = new WakewordService();
await wakewordService.initialize();

// 載入模型（支援 'hey-jarvis', 'alexa', 'hey-mycroft'）
await wakewordService.loadModel('hey-jarvis');

// 監聽事件
wakewordService.on('wakeword', (data) => {
    console.log(`檢測到喚醒詞: ${data.wakeword}`);
});

// 開始檢測
await wakewordService.start();
```

### Whisper（語音轉文字）
```javascript
const { WhisperService } = window.WebASRCore;

// 初始化
const whisperService = new WhisperService({
    language: 'zh',      // 語言設定
    temperature: 0.8     // 創造性參數
});

// 載入模型
await whisperService.initialize('Xenova/whisper-tiny', {
    quantized: true,     // 使用量化模型（更小更快）
    device: 'wasm'       // 或 'webgpu'（如果可用）
});

// 轉譯音訊檔案
const result = await whisperService.transcribe(audioData);
console.log('轉譯結果:', result.text);

// 或從 URL 轉譯
const result2 = await whisperService.transcribe({ audioUrl: 'speech.mp3' });
console.log('轉譯結果:', result2.text);
```

## 🎯 與舊版本比較

### v0.6.0 之前（需要手動設定）
```javascript
// ❌ 舊版本需要複雜的設定
transformers.env.backends.onnx.wasm.wasmPaths = {
    'ort-wasm-simd-threaded.jsep.mjs': 'https://cdn.jsdelivr.net/...',
    'ort-wasm-simd-threaded.jsep.wasm': 'https://cdn.jsdelivr.net/...',
    // ... 更多路徑設定
};
```

### v0.7.0（全自動）
```javascript
// ✅ 新版本無需任何設定！
// Bundle 自動處理所有路徑
```

## 🔧 技術細節

### 自動路徑偵測機制
1. **Bundle 載入時立即執行** - 在任何 `pipeline()` 呼叫之前
2. **智能偵測 Script 位置** - 使用 `document.currentScript`
3. **設定絕對 URL** - 避免 `about:blank` 問題
4. **凍結設定** - 防止被後續程式碼覆寫

### 支援的環境
- ✅ Chrome/Edge 90+
- ✅ Firefox 90+
- ✅ Safari 15+（實驗性）
- ✅ 跨域載入（CORS）
- ✅ HTTPS/HTTP

## 📊 可用的服務

### 核心語音服務
- **VadService** - 語音活動檢測
- **WakewordService** - 喚醒詞檢測
- **WhisperService** - 語音轉文字（Whisper）

### 瀏覽器 API 封裝
- **SpeechService** - Web Speech API 封裝（TTS/STT）
- **AudioCapture** - 麥克風音訊擷取
- **AudioResampler** - 音訊重採樣

### 工具類
- **AudioChunker** - 音訊分塊處理
- **AudioRingBuffer** - 環形緩衝區
- **TimerService** - 倒數計時器
- **SystemDiagnostics** - 系統診斷工具

## 💡 使用提示

### 模型大小選擇
- **whisper-tiny** (~39MB) - 快速但準確度較低
- **whisper-base** (~74MB) - 平衡選擇
- **whisper-small** (~244MB) - 較高準確度
- **whisper-medium** (~769MB) - 高準確度
- **whisper-large** (~1550MB) - 最高準確度

### 效能最佳化
1. **使用量化模型** - 設定 `quantized: true`
2. **啟用 WebGPU** - 設定 `device: 'webgpu'`（如果可用）
3. **預載模型** - 在需要前先初始化
4. **重用服務實例** - 避免重複創建

## 📚 版本歷史

- **v0.7.0** (2024-01): 自動路徑偵測，真正的一支 script 就能用
- **v0.6.0** (2024-01): 終極修正版，徹底解決 WASM 載入問題
- **v0.5.0** (2024-01): 單一實例模式 + 絕對 CDN 路徑
- **v0.4.x** (2024-01): ULTIMATE 版本修正
- **v0.3.0** (2024-01): 首個 ULTIMATE 版本
- **v0.2.0** (2024-01): ALL-IN-ONE 版本
- **v0.1.0** (2024-01): 初始版本

## 🤝 問題回報

如果遇到任何問題，請在 [GitHub Issues](https://github.com/JonesHong/web-asr-core/issues) 回報。

## 📄 授權

MIT License - 自由使用於商業和非商業專案

---

**WebASRCore v0.7.0** - 一支 CDN script 搞定所有語音處理需求！