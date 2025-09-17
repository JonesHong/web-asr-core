# WebASRCore Event Architecture 

## 概述

本文件描述 WebASRCore 的事件系統架構。此版本不考慮向後相容性，採用服務類別包裝的設計模式，提供更優雅的事件訂閱 API，同時保持核心處理函數的無狀態特性。

## 核心設計原則

1. **服務類別包裝**: 每個服務提供一個類別作為事件發射器和 API 入口
2. **無狀態處理**: 核心處理邏輯保持純函數和無狀態設計
3. **統一事件模式**: 所有服務使用相同的事件訂閱/發射模式
4. **TypeScript 優先**: 完整的類型定義和智能提示支援
5. **Worker 整合**: 自動處理 Worker 事件橋接

## 架構設計

### 1. 基礎 EventEmitter 類別

```typescript
// src/core/EventEmitter.ts
export class EventEmitter<T extends Record<string, any>> {
  private events: Map<keyof T, Set<(data: any) => void>>;
  
  constructor() {
    this.events = new Map();
  }
  
  on<K extends keyof T>(event: K, handler: (data: T[K]) => void): this {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    this.events.get(event)!.add(handler);
    return this;
  }
  
  once<K extends keyof T>(event: K, handler: (data: T[K]) => void): this {
    const wrapper = (data: T[K]) => {
      this.off(event, wrapper);
      handler(data);
    };
    return this.on(event, wrapper);
  }
  
  off<K extends keyof T>(event: K, handler?: (data: T[K]) => void): this {
    if (!handler) {
      this.events.delete(event);
    } else {
      this.events.get(event)?.delete(handler);
    }
    return this;
  }
  
  emit<K extends keyof T>(event: K, data: T[K]): this {
    this.events.get(event)?.forEach(handler => handler(data));
    return this;
  }
  
  removeAllListeners(): this {
    this.events.clear();
    return this;
  }
}
```

### 2. 服務類別設計模式

每個服務都遵循以下模式：

```typescript
// 事件類型定義
export interface ServiceEvents {
  ready: { timestamp: number };
  error: { error: Error; context: string };
  // ... 其他事件
}

// 服務類別
export class Service extends EventEmitter<ServiceEvents> {
  private session: Session | null = null;
  
  constructor() {
    super();
  }
  
  // 初始化方法
  async initialize(config?: Config): Promise<void> {
    try {
      this.session = await loadSession(config);
      this.emit('ready', { timestamp: Date.now() });
    } catch (error) {
      this.emit('error', { error: error as Error, context: 'initialize' });
      throw error;
    }
  }
  
  // 處理方法（保持無狀態）
  async process(state: State, input: Input, params: Params): Promise<Result> {
    if (!this.session) {
      throw new Error('Service not initialized');
    }
    
    try {
      // 呼叫無狀態的核心處理函數
      const result = await coreProcess(this.session, state, input, params);
      
      // 發射相關事件
      this.emitProcessEvents(result);
      
      return result;
    } catch (error) {
      this.emit('error', { error: error as Error, context: 'process' });
      throw error;
    }
  }
  
  // 清理方法
  dispose(): void {
    this.removeAllListeners();
    this.session = null;
  }
}
```

## 具體服務實作

### 1. VAD Service

```typescript
// src/services/VadService.ts
export interface VadEvents {
  ready: { config: VadConfig };
  speechStart: { timestamp: number; score: number };
  speechEnd: { timestamp: number; duration: number };
  process: { detected: boolean; score: number };
  error: { error: Error; context: string };
}

export class VadService extends EventEmitter<VadEvents> {
  private session: InferenceSession | null = null;
  private lastSpeechStart: number | null = null;
  
  async initialize(modelUrl?: string, config?: VadConfig): Promise<void> {
    try {
      this.session = await loadVadSession(modelUrl, config);
      this.emit('ready', { config: config || getDefaultConfig() });
    } catch (error) {
      this.emit('error', { error: error as Error, context: 'initialize' });
      throw error;
    }
  }
  
  async process(state: VadState, audio: Float32Array, params: VadParams): Promise<VadResult> {
    if (!this.session) {
      throw new Error('VAD service not initialized');
    }
    
    try {
      // 呼叫核心無狀態處理函數
      const result = await processVad(this.session, state, audio, params);
      
      // 發射處理事件
      this.emit('process', { 
        detected: result.detected, 
        score: result.score 
      });
      
      // 檢測語音狀態變化
      if (!state.isSpeechActive && result.state.isSpeechActive) {
        this.lastSpeechStart = Date.now();
        this.emit('speechStart', { 
          timestamp: this.lastSpeechStart, 
          score: result.score 
        });
      } else if (state.isSpeechActive && !result.state.isSpeechActive) {
        const now = Date.now();
        const duration = this.lastSpeechStart ? now - this.lastSpeechStart : 0;
        this.emit('speechEnd', { 
          timestamp: now, 
          duration 
        });
        this.lastSpeechStart = null;
      }
      
      return result;
    } catch (error) {
      this.emit('error', { error: error as Error, context: 'process' });
      throw error;
    }
  }
  
  createState(config?: ConfigManager): VadState {
    return createVadState(config);
  }
  
  createParams(config?: ConfigManager): VadParams {
    return createDefaultVadParams(config);
  }
  
  dispose(): void {
    this.removeAllListeners();
    this.session = null;
    this.lastSpeechStart = null;
  }
}
```

### 2. Wake Word Service

```typescript
// src/services/WakewordService.ts
export interface WakewordEvents {
  ready: { models: string[] };
  wakewordDetected: { word: string; score: number; timestamp: number };
  process: { scores: number[]; maxScore: number };
  error: { error: Error; context: string };
}

export class WakewordService extends EventEmitter<WakewordEvents> {
  private sessions: Map<string, WakewordSession> = new Map();
  
  async initialize(models?: string[]): Promise<void> {
    try {
      // 載入模型
      for (const model of models || ['hey-jarvis']) {
        const session = await loadWakewordModel(model);
        this.sessions.set(model, session);
      }
      
      this.emit('ready', { models: Array.from(this.sessions.keys()) });
    } catch (error) {
      this.emit('error', { error: error as Error, context: 'initialize' });
      throw error;
    }
  }
  
  async process(
    state: WakewordState,
    audio: Float32Array,
    params: WakewordParams
  ): Promise<WakewordResult> {
    const session = this.sessions.get(params.wakeword);
    if (!session) {
      throw new Error(`Wake word model not loaded: ${params.wakeword}`);
    }
    
    try {
      // 呼叫核心處理函數
      const result = await processWakewordChunk(session, state, audio, params);
      
      // 發射處理事件
      this.emit('process', { 
        scores: result.scores, 
        maxScore: result.score 
      });
      
      // 檢測喚醒詞
      if (result.triggered) {
        this.emit('wakewordDetected', {
          word: params.wakeword,
          score: result.score,
          timestamp: Date.now()
        });
      }
      
      return result;
    } catch (error) {
      this.emit('error', { error: error as Error, context: 'process' });
      throw error;
    }
  }
  
  createState(config?: ConfigManager): WakewordState {
    return createWakewordState(config);
  }
  
  createParams(wakeword: string, config?: ConfigManager): WakewordParams {
    return createDefaultWakewordParams(wakeword, config);
  }
  
  dispose(): void {
    this.removeAllListeners();
    this.sessions.clear();
  }
}
```

### 3. Whisper Service

```typescript
// src/services/WhisperService.ts
export interface WhisperEvents {
  ready: { modelId: string };
  transcriptionStart: { timestamp: number };
  transcriptionComplete: { text: string; duration: number; segments?: any[] };
  transcriptionProgress: { progress: number };
  error: { error: Error; context: string };
}

export class WhisperService extends EventEmitter<WhisperEvents> {
  private pipeline: any = null;
  private modelId: string = '';
  
  async initialize(modelId?: string, options?: WhisperLoadOptions): Promise<void> {
    try {
      const resources = await loadWhisperResources(modelId, options);
      this.pipeline = resources.pipeline;
      this.modelId = resources.modelId;
      
      this.emit('ready', { modelId: this.modelId });
    } catch (error) {
      this.emit('error', { error: error as Error, context: 'initialize' });
      throw error;
    }
  }
  
  async transcribe(audio: Float32Array, options?: WhisperOptions): Promise<WhisperResult> {
    if (!this.pipeline) {
      throw new Error('Whisper service not initialized');
    }
    
    const startTime = Date.now();
    
    try {
      this.emit('transcriptionStart', { timestamp: startTime });
      
      // 呼叫核心轉錄函數
      const result = await transcribe(
        { pipeline: this.pipeline, modelId: this.modelId },
        audio,
        options
      );
      
      const duration = Date.now() - startTime;
      
      this.emit('transcriptionComplete', {
        text: result.text,
        duration,
        segments: result.segments
      });
      
      return result;
    } catch (error) {
      this.emit('error', { error: error as Error, context: 'transcribe' });
      throw error;
    }
  }
  
  async transcribeWithProgress(
    audio: Float32Array,
    options?: WhisperOptions,
    onProgress?: (progress: number) => void
  ): Promise<WhisperResult> {
    // 實作分段轉錄以提供進度
    const chunks = chunkAudioForTranscription(audio);
    const results: string[] = [];
    
    for (let i = 0; i < chunks.length; i++) {
      const progress = (i / chunks.length) * 100;
      this.emit('transcriptionProgress', { progress });
      onProgress?.(progress);
      
      const result = await this.transcribe(chunks[i], options);
      results.push(result.text);
    }
    
    return { text: results.join(' ') };
  }
  
  dispose(): void {
    this.removeAllListeners();
    this.pipeline = null;
  }
}
```

### 4. Timer Service

```typescript
// src/services/TimerService.ts
export interface TimerEvents {
  start: { id: string; duration: number };
  tick: { id: string; remaining: number; progress: number };
  timeout: { id: string; duration: number };
  pause: { id: string; remaining: number };
  resume: { id: string };
  reset: { id: string };
  error: { error: Error; context: string };
}

export class TimerService extends EventEmitter<TimerEvents> {
  private timers: Map<string, {
    state: TimerState;
    interval?: number;
  }> = new Map();
  
  createTimer(id: string, duration: number, tickInterval: number = 100): void {
    const state = Timer.createState(duration);
    this.timers.set(id, { state });
  }
  
  start(id: string): void {
    const timer = this.timers.get(id);
    if (!timer) {
      throw new Error(`Timer not found: ${id}`);
    }
    
    try {
      timer.state = Timer.start(timer.state);
      this.emit('start', { 
        id, 
        duration: timer.state.totalTime 
      });
      
      // 設置 tick interval
      if (timer.interval) {
        clearInterval(timer.interval);
      }
      
      timer.interval = window.setInterval(() => {
        const result = Timer.tick(timer.state);
        timer.state = result.state;
        
        this.emit('tick', {
          id,
          remaining: Timer.getRemainingTime(timer.state),
          progress: Timer.getProgress(timer.state)
        });
        
        if (result.timeout) {
          this.emit('timeout', {
            id,
            duration: timer.state.totalTime
          });
          this.stop(id);
        }
      }, 100);
      
    } catch (error) {
      this.emit('error', { error: error as Error, context: 'start' });
      throw error;
    }
  }
  
  pause(id: string): void {
    const timer = this.timers.get(id);
    if (!timer) return;
    
    timer.state = Timer.pause(timer.state);
    
    if (timer.interval) {
      clearInterval(timer.interval);
      timer.interval = undefined;
    }
    
    this.emit('pause', {
      id,
      remaining: Timer.getRemainingTime(timer.state)
    });
  }
  
  resume(id: string): void {
    const timer = this.timers.get(id);
    if (!timer) return;
    
    this.emit('resume', { id });
    this.start(id);
  }
  
  reset(id: string, duration?: number): void {
    const timer = this.timers.get(id);
    if (!timer) return;
    
    if (timer.interval) {
      clearInterval(timer.interval);
      timer.interval = undefined;
    }
    
    timer.state = Timer.reset(timer.state, duration);
    this.emit('reset', { id });
  }
  
  stop(id: string): void {
    const timer = this.timers.get(id);
    if (!timer) return;
    
    if (timer.interval) {
      clearInterval(timer.interval);
    }
    
    this.timers.delete(id);
  }
  
  dispose(): void {
    // 清理所有計時器
    for (const [id] of this.timers) {
      this.stop(id);
    }
    this.removeAllListeners();
  }
}
```

## Worker 事件橋接

### Worker 端實作

```typescript
// src/workers/onnx-inference.worker.ts
class WorkerEventBridge {
  static emit(event: string, data: any): void {
    self.postMessage({
      type: 'event',
      event,
      data,
      timestamp: Date.now()
    });
  }
}

// 在 Worker 處理中發射事件
if (!wasActive && isSpeech) {
  WorkerEventBridge.emit('speechStart', { score: probability });
}
```

### 主執行緒端實作

```typescript
// src/services/OrtService.ts
export class OrtService extends EventEmitter<OrtEvents> {
  private worker: Worker | null = null;
  
  async initialize(): Promise<void> {
    this.worker = new Worker('./workers/onnx-inference.worker.js');
    
    // 橋接 Worker 事件
    this.worker.addEventListener('message', (e) => {
      if (e.data.type === 'event') {
        // 轉發 Worker 事件
        this.emit(e.data.event, e.data.data);
      }
    });
  }
}
```

## 使用範例

### 基本使用

```typescript
import { VadService, WakewordService, WhisperService } from 'webasrcore';

// 初始化服務
const vad = new VadService();
const wakeword = new WakewordService();
const whisper = new WhisperService();

// 訂閱事件
vad.on('speechStart', () => {
  console.log('Speech started!');
});

vad.on('speechEnd', ({ duration }) => {
  console.log(`Speech ended, duration: ${duration}ms`);
});

wakeword.on('wakewordDetected', ({ word, score }) => {
  console.log(`Wake word detected: ${word} (score: ${score})`);
});

whisper.on('transcriptionComplete', ({ text }) => {
  console.log(`Transcription: ${text}`);
});

// 初始化
await vad.initialize();
await wakeword.initialize(['hey-jarvis', 'alexa']);
await whisper.initialize('whisper-base');

// 處理音訊
let vadState = vad.createState();
const vadParams = vad.createParams();

// 處理循環
for (const audioChunk of audioStream) {
  const vadResult = await vad.process(vadState, audioChunk, vadParams);
  vadState = vadResult.state;
  
  if (vadResult.detected) {
    // 處理語音...
  }
}
```

### 進階使用 - 鏈式調用

```typescript
const vad = new VadService()
  .on('ready', () => console.log('VAD ready'))
  .on('speechStart', () => console.log('Speaking...'))
  .on('speechEnd', () => console.log('Stopped'))
  .on('error', (e) => console.error('Error:', e));

await vad.initialize();
```

### 錯誤處理

```typescript
vad.on('error', ({ error, context }) => {
  console.error(`Error in ${context}:`, error);
  // 自動恢復邏輯
  if (context === 'process') {
    vadState = vad.createState(); // 重置狀態
  }
});
```

## 遷移指南

從舊 API 遷移到新 API：

### 舊 API (v1)
```typescript
import { vadEvents, processVad } from 'webasrcore';

vadEvents.addEventListener('speech-start', handler);
const result = await processVad(session, state, audio, params);
```

### 新 API (v2)
```typescript
import { VadService } from 'webasrcore';

const vad = new VadService();
vad.on('speechStart', handler);
await vad.initialize();
const result = await vad.process(state, audio, params);
```

## 優點

1. **更直觀的 API**: 服務實例提供清晰的方法和事件
2. **更好的 TypeScript 支援**: 完整的事件類型定義
3. **生命週期管理**: 明確的初始化和清理方法
4. **錯誤處理**: 統一的錯誤事件和上下文
5. **可測試性**: 易於模擬和測試的服務類別
6. **保持無狀態**: 核心處理邏輯仍然是純函數

## 音訊流處理架構

### AudioRingBuffer 與 AudioChunker 整合

WebASRCore 使用 AudioRingBuffer 和 AudioChunker 來管理音訊資料流，確保各服務能獲得適當大小的音訊塊進行處理。

#### 資料流架構

```
麥克風 → AudioRingBuffer → 各服務 → AudioChunker → 處理函數
```

1. **麥克風擷取**: 從瀏覽器 MediaStream 獲取連續音訊流
2. **AudioRingBuffer**: 環形緩衝區儲存連續音訊流，避免資料遺失
3. **各服務讀取**: 每個服務從緩衝區讀取所需的音訊資料
4. **AudioChunker**: 將音訊切割成服務所需的固定大小塊
5. **處理函數**: 使用適當大小的音訊塊進行推理

#### AudioChunker 特性

**非破壞式切割**：
- AudioChunker **不會丟失任何音訊資料**
- 維護內部 `remainder` 緩衝區，保存不足一個完整塊的樣本
- 下次呼叫 `chunk()` 時，剩餘樣本會與新輸入合併
- 支援重疊（overlap）以保持音訊連續性

```typescript
// AudioChunker 內部運作
class AudioChunker {
  private remainder: Float32Array;  // 保存剩餘樣本
  
  chunk(input: Float32Array): Float32Array[] {
    // 1. 合併剩餘資料和新輸入
    const combined = concat(this.remainder, input);
    
    // 2. 切割成固定大小的塊
    const chunks = [];
    while (combined.length >= this.chunkSize) {
      chunks.push(combined.slice(0, this.chunkSize));
      combined = combined.slice(this.chunkSize - this.overlap);
    }
    
    // 3. 保存剩餘樣本供下次使用
    this.remainder = combined;
    
    return chunks;
  }
}
```

#### 服務特定的 Chunk 大小

每個服務需要不同大小的音訊塊：

| 服務 | Chunk 大小 | 時長 @ 16kHz | 用途 |
|------|------------|--------------|------|
| VAD | 512 樣本 | 32ms | 快速語音活動檢測 |
| WakeWord | 1280 樣本 | 80ms | 喚醒詞特徵提取 |
| Whisper | 可變 | 可變 | 完整語音轉錄 |

### 服務整合模式

#### 1. 連續流處理（Stream Processing）

```typescript
export class VadService extends EventEmitter<VadEvents> {
  private chunker: AudioChunker;
  
  constructor() {
    super();
    // 使用 VAD 專用的 chunker 配置
    this.chunker = AudioChunker.forVAD();
  }
  
  async processStream(
    ringBuffer: AudioRingBuffer,
    state: VadState,
    params: VadParams
  ): Promise<VadState> {
    // 從環形緩衝區讀取可用資料
    const available = ringBuffer.available();
    if (available < 512) {
      return state; // 資料不足，返回原狀態
    }
    
    const audio = ringBuffer.read(available);
    if (!audio) return state;
    
    // 使用 chunker 切割成適當大小
    const chunks = this.chunker.chunk(audio);
    
    let currentState = state;
    for (const chunk of chunks) {
      const result = await this.process(currentState, chunk, params);
      currentState = result.state;
      
      // 發射相關事件
      if (result.detected && !state.isSpeechActive) {
        this.emit('speechStart', { timestamp: Date.now() });
      }
    }
    
    return currentState;
  }
}
```

#### 2. 多服務並行處理

使用 `MultiChannelAudioChunker` 實現多個服務的並行處理：

```typescript
export class AudioProcessor extends EventEmitter<AudioProcessorEvents> {
  private multiChunker: MultiChannelAudioChunker;
  private vadService: VadService;
  private wakewordService: WakewordService;
  
  constructor() {
    super();
    
    // 註冊各服務的 chunker
    this.multiChunker = new MultiChannelAudioChunker();
    this.multiChunker.registerServiceChannel('vad');        // 512 樣本
    this.multiChunker.registerServiceChannel('wakeword');   // 1280 樣本
    
    this.vadService = new VadService();
    this.wakewordService = new WakewordService();
  }
  
  async processAudio(audio: Float32Array): Promise<void> {
    // 一次輸入，多個輸出
    const chunksMap = this.multiChunker.process(audio);
    
    // 並行處理各服務
    const promises = [];
    
    // 處理 VAD
    const vadChunks = chunksMap.get('vad');
    if (vadChunks && vadChunks.length > 0) {
      promises.push(this.processVadChunks(vadChunks));
    }
    
    // 處理 WakeWord
    const wakewordChunks = chunksMap.get('wakeword');
    if (wakewordChunks && wakewordChunks.length > 0) {
      promises.push(this.processWakewordChunks(wakewordChunks));
    }
    
    await Promise.all(promises);
  }
}
```

#### 3. 完整的音訊管道範例

```typescript
// 完整的音訊處理管道
class AudioPipeline {
  private ringBuffer: AudioRingBuffer;
  private processor: AudioProcessor;
  private mediaStream?: MediaStream;
  private audioContext?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private processor?: ScriptProcessorNode | AudioWorkletNode;
  
  constructor() {
    // 16000 樣本容量的環形緩衝區（1秒 @ 16kHz）
    this.ringBuffer = new AudioRingBuffer(16000);
    this.processor = new AudioProcessor();
  }
  
  async start(): Promise<void> {
    // 1. 獲取麥克風權限
    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });
    
    // 2. 設置 Web Audio API
    this.audioContext = new AudioContext({ sampleRate: 16000 });
    this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
    
    // 3. 使用 AudioWorklet 或 ScriptProcessor
    if (this.audioContext.audioWorklet) {
      // 使用 AudioWorklet（推薦）
      const workletNode = await this.ringBuffer.connectToAudioNode(
        this.audioContext,
        true // useWorklet
      );
      this.source.connect(workletNode);
      workletNode.connect(this.audioContext.destination);
    } else {
      // 降級到 ScriptProcessor
      const scriptNode = await this.ringBuffer.connectToAudioNode(
        this.audioContext,
        false // useWorklet
      );
      this.source.connect(scriptNode);
      scriptNode.connect(this.audioContext.destination);
    }
    
    // 4. 開始處理循環
    this.processLoop();
  }
  
  private async processLoop(): Promise<void> {
    while (this.isRunning) {
      // 檢查緩衝區是否有足夠的資料
      const available = this.ringBuffer.available();
      
      if (available >= 512) { // 最小處理單位（VAD chunk size）
        const audio = this.ringBuffer.read(available);
        if (audio) {
          await this.processor.processAudio(audio);
        }
      }
      
      // 短暫等待避免 CPU 過載
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
}
```

### 事件流程圖

```
使用者說話
    ↓
麥克風擷取 (MediaStream API)
    ↓
AudioContext 處理 (16kHz 單聲道)
    ↓
AudioWorklet/ScriptProcessor
    ↓
AudioRingBuffer 寫入
    ↓
主處理循環讀取
    ↓
MultiChannelAudioChunker 分發
    ↙        ↓        ↘
VAD(512)  WakeWord(1280)  [Buffer for Whisper]
    ↓         ↓              ↓
[Events]  [Events]      [Accumulate]
    ↓         ↓              ↓
speechStart  wakewordDetected  transcriptionComplete
```

### 最佳實踐

1. **緩衝區大小**: 根據最大的 chunk size 設定緩衝區容量（建議至少 1 秒的音訊）
2. **處理頻率**: 主循環處理間隔 10-20ms，平衡延遲和 CPU 使用
3. **並行處理**: 使用 `MultiChannelAudioChunker` 避免重複處理相同音訊
4. **事件去抖動**: 對頻繁的事件（如 VAD process）進行節流處理
5. **資源管理**: 確保在 `dispose()` 時清理所有音訊資源

## 注意事項

1. 服務類別本身可能包含少量狀態（如 session、配置），但處理邏輯保持無狀態
2. 所有服務都應該實作 `dispose()` 方法來清理資源
3. Worker 事件會自動橋接到主執行緒
4. 事件名稱使用 camelCase（如 `speechStart` 而非 `speech-start`）
5. 錯誤既會通過事件發射，也會通過 Promise 拒絕
6. AudioChunker 是非破壞式的，不會丟失任何音訊資料
7. 每個服務可以有自己的 AudioChunker 實例，使用不同的 chunk 大小