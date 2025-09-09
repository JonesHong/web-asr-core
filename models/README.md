# 模型目錄

請將 `hi_kmu_0721.onnx` 喚醒詞模型放在此目錄中。

此模型是使用 openWakeWord 訓練的，用於偵測「嗨，高醫」喚醒詞。

## 獲取模型的方法

### 方法 1：從 Hugging Face 下載（需要 token）

如果您有 Hugging Face token，可以使用以下 Python 腳本下載：

```python
from huggingface_hub import hf_hub_download
import shutil

# 設定您的 HF token
hf_token = "YOUR_HF_TOKEN"

# 下載模型
model_path = hf_hub_download(
    repo_id="JTBTechnology/kmu_wakeword",
    filename="hi_kmu_0721.onnx",
    token=hf_token,
    repo_type="model"
)

# 複製到當前目錄
shutil.copy(model_path, "./hi_kmu_0721.onnx")
print(f"模型已下載到: ./hi_kmu_0721.onnx")
```

### 方法 2：使用 Hugging Face CLI

```bash
# 登入 Hugging Face
huggingface-cli login

# 下載模型
huggingface-cli download JTBTechnology/kmu_wakeword hi_kmu_0721.onnx --local-dir .
```

### 方法 3：手動下載

1. 前往 https://huggingface.co/JTBTechnology/kmu_wakeword
2. 登入您的 Hugging Face 帳號
3. 下載 `hi_kmu_0721.onnx` 檔案
4. 將檔案放置在此 `models/` 目錄中

## 測試模式

如果您暫時沒有模型檔案，應用程式會自動切換到**模擬模式**：
- 模擬模式會隨機產生喚醒詞偵測分數
- 約每 20 秒會模擬偵測到一次喚醒詞
- 您仍可測試 VAD 和語音識別功能

## 模型規格

- **輸入**: 1280 個 float32 音頻樣本（16kHz，80ms）
- **輸出**: 0-1 之間的偵測分數
- **閾值**: 0.5（分數大於 0.5 視為偵測到喚醒詞）

## 注意事項

- 模型檔案大小約為幾 MB
- 需要有效的 Hugging Face token 才能下載私有模型
- 確保模型檔案名稱為 `hi_kmu_0721.onnx`