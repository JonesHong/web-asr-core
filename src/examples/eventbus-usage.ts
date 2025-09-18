/**
 * EventBus 使用範例
 *
 * 展示如何使用集中式 EventBus 處理所有服務事件
 * 類似 ngrx 的 action$ 流
 */

import { eventBus, events$, EventBusDevTools } from '../core/EventBus';
import {
  SpeechEvents,
  VadEvents,
  WakewordEvents,
  WhisperEvents,
  TimerEvents
} from '../types/events';

// ============================================
// 1. 基本使用 - 訂閱所有事件
// ============================================

console.log('=== EventBus 基本使用範例 ===\n');

// 訂閱所有事件（類似 ngrx 的 action$）
const allEventsSub = events$.subscribe(event => {
  console.log('[All Events]', event.type, event.data);
});

// ============================================
// 2. 過濾特定事件類型
// ============================================

console.log('=== 事件類型過濾 ===\n');

// 只監聽語音相關事件
events$
  .ofType(
    SpeechEvents.TTS_START,
    SpeechEvents.TTS_END,
    SpeechEvents.STT_START,
    SpeechEvents.STT_END
  )
  .subscribe(event => {
    console.log('[Speech Event]', event.type, event.data);
  });

// 只監聽 VAD 語音活動事件
events$
  .ofType(VadEvents.SPEECH_START, VadEvents.SPEECH_END)
  .subscribe(event => {
    if (event.type === VadEvents.SPEECH_START) {
      console.log('🎤 Speech detected!', event.data);
    } else {
      console.log('🔇 Speech ended!', event.data);
    }
  });

// ============================================
// 3. 按服務來源過濾
// ============================================

console.log('=== 服務來源過濾 ===\n');

// 只監聽來自 VadService 的事件
events$
  .fromSource('VadService')
  .subscribe(event => {
    console.log('[VadService]', event);
  });

// 監聽多個服務的事件
events$
  .fromSource('WhisperService', 'WakewordService')
  .subscribe(event => {
    console.log('[ASR Services]', event);
  });

// ============================================
// 4. 組合操作符 - 複雜事件流處理
// ============================================

console.log('=== 組合操作符範例 ===\n');

// 節流：每秒最多處理一次 VAD 事件
events$
  .fromSource('VadService')
  .throttle(1000)
  .subscribe(event => {
    console.log('[Throttled VAD]', event);
  });

// 防抖：延遲 500ms 處理轉錄完成事件
events$
  .ofType(WhisperEvents.TRANSCRIPTION_COMPLETE)
  .debounce(500)
  .subscribe(event => {
    console.log('[Debounced Transcription]', event.data);
  });

// 映射：只提取事件數據
events$
  .ofType(WakewordEvents.WAKEWORD_DETECTED)
  .map(event => ({
    word: event.data.word,
    score: event.data.score,
    time: new Date(event.timestamp).toLocaleTimeString()
  }))
  .subscribe(data => {
    console.log('🎯 Wake word:', data);
  });

// ============================================
// 5. 狀態機模式 - 追蹤會話狀態
// ============================================

console.log('=== 狀態機模式 ===\n');

interface SessionState {
  isListening: boolean;
  isSpeaking: boolean;
  isTranscribing: boolean;
  lastTranscript?: string;
}

let sessionState: SessionState = {
  isListening: false,
  isSpeaking: false,
  isTranscribing: false
};

// 監聽多個事件更新狀態
events$
  .ofType(
    VadEvents.SPEECH_START,
    VadEvents.SPEECH_END,
    WhisperEvents.TRANSCRIPTION_START,
    WhisperEvents.TRANSCRIPTION_COMPLETE,
    SpeechEvents.TTS_START,
    SpeechEvents.TTS_END
  )
  .subscribe(event => {
    switch (event.type) {
      case VadEvents.SPEECH_START:
        sessionState.isListening = true;
        break;
      case VadEvents.SPEECH_END:
        sessionState.isListening = false;
        break;
      case WhisperEvents.TRANSCRIPTION_START:
        sessionState.isTranscribing = true;
        break;
      case WhisperEvents.TRANSCRIPTION_COMPLETE:
        sessionState.isTranscribing = false;
        sessionState.lastTranscript = event.data.text;
        break;
      case SpeechEvents.TTS_START:
        sessionState.isSpeaking = true;
        break;
      case SpeechEvents.TTS_END:
        sessionState.isSpeaking = false;
        break;
    }
    console.log('Session State:', sessionState);
  });

// ============================================
// 6. 非同步處理 - Promise 和 async/await
// ============================================

console.log('=== 非同步處理 ===\n');

// 等待下一個喚醒詞
async function waitForWakeword(): Promise<string> {
  const event = await events$
    .ofType(WakewordEvents.WAKEWORD_DETECTED)
    .toPromise();

  return event.data.word;
}

// 收集多個事件
async function collectTranscriptions(count: number) {
  const events = await events$
    .ofType(WhisperEvents.TRANSCRIPTION_COMPLETE)
    .collect(count);

  return events.map(e => e.data.text);
}

// 使用範例
(async () => {
  console.log('Waiting for wake word...');
  const wakeword = await waitForWakeword();
  console.log(`Wake word detected: ${wakeword}`);

  console.log('Collecting 3 transcriptions...');
  const transcripts = await collectTranscriptions(3);
  console.log('Transcripts:', transcripts);
})();

// ============================================
// 7. 錯誤處理和重試
// ============================================

console.log('=== 錯誤處理 ===\n');

// 監控所有錯誤事件
events$
  .where(event => event.type.includes('error'))
  .subscribe(event => {
    console.error('❌ Error Event:', {
      source: event.source,
      error: event.data,
      timestamp: new Date(event.timestamp).toISOString()
    });
  });

// 重試邏輯
let retryCount = 0;
const maxRetries = 3;

events$
  .ofType(WhisperEvents.ERROR)
  .subscribe(event => {
    if (retryCount < maxRetries) {
      retryCount++;
      console.log(`Retrying transcription (${retryCount}/${maxRetries})...`);
      // 觸發重試邏輯
    } else {
      console.error('Max retries reached for transcription');
      retryCount = 0;
    }
  });

// ============================================
// 8. 性能監控
// ============================================

console.log('=== 性能監控 ===\n');

// 計算事件處理延遲
const performanceMonitor = events$.subscribe(event => {
  const delay = Date.now() - event.timestamp;
  if (delay > 100) {
    console.warn(`⚠️ High event delay: ${delay}ms for ${event.type}`);
  }
});

// 統計事件頻率
const eventCounts = new Map<string, number>();

events$.subscribe(event => {
  const count = eventCounts.get(event.type) || 0;
  eventCounts.set(event.type, count + 1);
});

// 定期輸出統計
setInterval(() => {
  console.log('📊 Event Statistics:', Object.fromEntries(eventCounts));
}, 5000);

// ============================================
// 9. 事件聚合和批處理
// ============================================

console.log('=== 事件聚合 ===\n');

// 批量處理轉錄結果
const transcriptBuffer: string[] = [];

events$
  .ofType(WhisperEvents.TRANSCRIPTION_COMPLETE)
  .subscribe(event => {
    transcriptBuffer.push(event.data.text);

    // 每 5 個轉錄結果批量處理
    if (transcriptBuffer.length >= 5) {
      const batch = transcriptBuffer.splice(0, 5);
      console.log('Processing transcript batch:', batch);
      // 執行批量處理邏輯
    }
  });

// ============================================
// 10. DevTools 整合
// ============================================

console.log('=== DevTools 整合 ===\n');

// 啟用 DevTools（開發環境）
if (process.env.NODE_ENV === 'development') {
  const devTools = new EventBusDevTools(eventBus);
  devTools.enable();

  // 現在可以在控制台使用：
  // __eventBus__ - 訪問 EventBus 實例
  // __eventBusStats__() - 查看統計信息
  // __eventBusHistory__(10) - 查看最近 10 個事件
}

// ============================================
// 11. 複雜業務邏輯範例 - 對話管理
// ============================================

console.log('=== 對話管理範例 ===\n');

class ConversationManager {
  private isWakewordActive = false;
  private conversationTimeout?: NodeJS.Timeout;

  constructor() {
    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // 喚醒詞啟動對話
    events$
      .ofType(WakewordEvents.WAKEWORD_DETECTED)
      .subscribe(event => {
        console.log(`🗣️ Conversation started with "${event.data.word}"`);
        this.startConversation();
      });

    // VAD 檢測到語音
    events$
      .ofType(VadEvents.SPEECH_START)
      .where(() => this.isWakewordActive)
      .subscribe(() => {
        console.log('👂 Listening...');
        this.resetTimeout();
      });

    // 轉錄完成處理
    events$
      .ofType(WhisperEvents.TRANSCRIPTION_COMPLETE)
      .where(() => this.isWakewordActive)
      .subscribe(event => {
        console.log(`💬 User said: "${event.data.text}"`);
        this.processUserInput(event.data.text);
      });

    // TTS 回應
    events$
      .ofType(SpeechEvents.TTS_END)
      .where(() => this.isWakewordActive)
      .subscribe(() => {
        console.log('🔄 Ready for next input');
        this.resetTimeout();
      });
  }

  private startConversation() {
    this.isWakewordActive = true;
    this.resetTimeout();
  }

  private endConversation() {
    console.log('👋 Conversation ended');
    this.isWakewordActive = false;
    if (this.conversationTimeout) {
      clearTimeout(this.conversationTimeout);
    }
  }

  private resetTimeout() {
    if (this.conversationTimeout) {
      clearTimeout(this.conversationTimeout);
    }

    // 30 秒無活動結束對話
    this.conversationTimeout = setTimeout(() => {
      this.endConversation();
    }, 30000);
  }

  private processUserInput(text: string) {
    // 處理用戶輸入的業務邏輯
    if (text.toLowerCase().includes('goodbye')) {
      this.endConversation();
    } else {
      // 觸發回應
      console.log('🤖 Processing response...');
    }
  }
}

// 創建對話管理器實例
const conversationManager = new ConversationManager();

// ============================================
// 12. 事件重播和時間旅行調試
// ============================================

console.log('=== 事件重播 ===\n');

// 訂閱並重播最近 10 個事件
const replaySub = events$.subscribe(
  event => {
    console.log('[Replayed]', event);
  },
  {
    replay: true,
    replayCount: 10
  }
);

// 獲取事件歷史進行分析
const history = eventBus.getHistory(50);
const errorEvents = history.filter(e => e.type.includes('error'));
console.log(`Found ${errorEvents.length} error events in history`);

// ============================================
// 清理資源
// ============================================

// 記得在不需要時取消訂閱
setTimeout(() => {
  console.log('\n=== Cleaning up subscriptions ===');
  allEventsSub.dispose();
  performanceMonitor.dispose();
  replaySub.dispose();
}, 60000);

// 導出給其他模組使用
export { ConversationManager };