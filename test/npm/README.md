# NPM 安裝測試

此目錄用於測試透過 npm 安裝 `web-asr-core` 套件的功能。

## 測試步驟

### 1. 安裝依賴
```bash
cd test/npm-install
npm install
```

### 2. 啟動開發伺服器

#### 選項 A：使用 Vite（推薦）
```bash
npm run dev
```
Vite 會自動開啟瀏覽器並提供熱重載功能。

#### 選項 B：使用 http-server
```bash
npm start
```
然後開啟 http://localhost:8080

### 3. 測試功能
- VAD（語音活動檢測）
- 喚醒詞檢測
- Whisper 語音辨識

## 檔案說明

- `package.json` - NPM 套件配置，包含 web-asr-core 依賴
- `vite.config.js` - Vite 開發伺服器配置
- `index.html` - 測試頁面（簡化版）
- `script.js` - 使用 ES 模組方式導入 web-asr-core
- `style.css` - 樣式檔案

## 注意事項

1. 需要先在根目錄執行 `python serve.py` 以提供模型檔案服務
2. Vite 配置了代理，會將 `/models` 和 `/worklets` 請求轉發到 `http://localhost:8000`
3. 此測試使用 ES 模組語法，需要現代瀏覽器支援

## 與其他測試的差異

- **local 測試**：使用本地編譯的 dist 檔案
- **cdn 測試**：使用 CDN 載入 ULTIMATE 版本
- **npm 測試**：使用 npm install 安裝模組並透過打包工具運行