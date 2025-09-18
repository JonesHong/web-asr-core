/**
 * EventBus - 融合 Web API 與 RxJS 風格的統一事件總線
 *
 * 結合兩種設計的優點：
 * 1. 充分利用原生 Web API (EventTarget, CustomEvent, AbortController)
 * 2. 提供 RxJS 風格的流式操作符
 * 3. 支援 ngrx action$ 的使用模式
 */

import type {
  AllEvents,
  EventDataMap,
  SpeechEvents,
  TimerEvents,
  VadEvents,
  WakewordEvents,
  WhisperEvents
} from '../types/events';

/**
 * 自定義事件類，擴展原生 CustomEvent
 */
export class BusEvent<T = any> extends CustomEvent<EventPayload<T>> {
  constructor(payload: EventPayload<T>) {
    super(payload.type, {
      detail: payload,
      bubbles: true,      // 支援事件冒泡
      cancelable: true,   // 支援事件取消
      composed: true      // 可穿透 Shadow DOM
    });
  }
}

/**
 * 事件載荷接口
 */
export interface EventPayload<T = any> {
  /** 事件類型 */
  type: string;
  /** 事件數據 */
  data: T;
  /** 事件來源服務 */
  source: string;
  /** 事件時間戳 */
  timestamp: number;
  /** 事件序列號 */
  sequence: number;
  /** 可選的元數據 */
  metadata?: Record<string, any>;
}

/**
 * 事件過濾器類型
 */
export type EventFilter<T = any> = (event: EventPayload<T>) => boolean;

/**
 * 事件映射器類型
 */
export type EventMapper<T = any, R = any> = (event: EventPayload<T>) => R;

/**
 * 訂閱選項
 */
export interface SubscriptionOptions extends AddEventListenerOptions {
  /** 是否接收歷史事件 */
  replay?: boolean;
  /** 重播的歷史事件數量 */
  replayCount?: number;
  /** 過濾器 */
  filter?: EventFilter;
}

/**
 * 訂閱對象 - 使用原生 AbortController
 */
export class Subscription {
  private controller: AbortController;

  constructor(controller: AbortController) {
    this.controller = controller;
  }

  /** 取消訂閱 */
  unsubscribe(): void {
    this.controller.abort();
  }

  /** 別名，為了兼容性 */
  dispose(): void {
    this.unsubscribe();
  }
}

/**
 * 事件流（RxJS 風格 + Web API）
 */
export class EventStream<T = any> {
  private bus: EventBus;
  private filters: EventFilter<T>[] = [];
  private controller?: AbortController;

  constructor(bus: EventBus, filters: EventFilter<T>[] = []) {
    this.bus = bus;
    this.filters = filters;
  }

  /**
   * 過濾事件
   */
  where(predicate: EventFilter<T>): EventStream<T> {
    return new EventStream<T>(this.bus, [...this.filters, predicate]);
  }

  /**
   * 按事件類型過濾
   */
  ofType(...types: AllEvents[]): EventStream<any> {
    return this.where(event => types.includes(event.type as AllEvents));
  }

  /**
   * 按來源服務過濾
   */
  fromSource(...sources: string[]): EventStream<T> {
    return this.where(event => sources.includes(event.source));
  }

  /**
   * 映射事件數據
   */
  map<R>(mapper: EventMapper<T, R>): EventStream<R> {
    const newStream = new EventStream<R>(this.bus, []);
    // 保留原有過濾器邏輯但映射數據
    newStream.filters = this.filters as any[];

    const originalSubscribe = this.subscribe.bind(this);
    newStream.subscribe = (callback: (event: EventPayload<R>) => void, options?: SubscriptionOptions) => {
      return originalSubscribe((event) => {
        const mappedPayload: EventPayload<R> = {
          ...event,
          data: mapper(event) as any
        };
        callback(mappedPayload);
      }, options);
    };

    return newStream;
  }

  /**
   * 僅獲取事件數據
   */
  pluck<K extends keyof EventPayload<T>>(key: K): EventStream<EventPayload<T>[K]> {
    return this.map(event => event[key]) as any;
  }

  /**
   * 節流（使用原生 Web API）
   */
  throttle(ms: number): EventStream<T> {
    const throttledStream = new EventStream<T>(this.bus, this.filters);

    const originalSubscribe = this.subscribe.bind(this);
    throttledStream.subscribe = (callback: (event: EventPayload<T>) => void, options?: SubscriptionOptions) => {
      let lastTime = 0;
      return originalSubscribe((event) => {
        const now = Date.now();
        if (now - lastTime >= ms) {
          lastTime = now;
          callback(event);
        }
      }, options);
    };

    return throttledStream;
  }

  /**
   * 防抖（使用原生 Web API）
   */
  debounce(ms: number): EventStream<T> {
    const debouncedStream = new EventStream<T>(this.bus, this.filters);

    const originalSubscribe = this.subscribe.bind(this);
    debouncedStream.subscribe = (callback: (event: EventPayload<T>) => void, options?: SubscriptionOptions) => {
      let timeout: NodeJS.Timeout;
      return originalSubscribe((event) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          callback(event);
        }, ms);
      }, options);
    };

    return debouncedStream;
  }

  /**
   * 取前 n 個事件
   */
  take(count: number): EventStream<T> {
    const limitedStream = new EventStream<T>(this.bus, this.filters);

    const originalSubscribe = this.subscribe.bind(this);
    limitedStream.subscribe = (callback: (event: EventPayload<T>) => void, options?: SubscriptionOptions) => {
      let taken = 0;
      const subscription = originalSubscribe((event) => {
        if (++taken <= count) {
          callback(event);
          if (taken === count) {
            subscription.dispose();
          }
        }
      }, options);
      return subscription;
    };

    return limitedStream;
  }

  /**
   * 跳過前 n 個事件
   */
  skip(count: number): EventStream<T> {
    let skipped = 0;
    return this.where(() => ++skipped > count);
  }

  /**
   * 訂閱事件流（使用原生 addEventListener）
   */
  subscribe(
    callback: (event: EventPayload<T>) => void,
    options: SubscriptionOptions = {}
  ): Subscription {
    const controller = new AbortController();
    const { replay = false, replayCount = 10, filter, ...listenerOptions } = options;

    // 合併所有過濾器
    const combinedFilter = (event: EventPayload<T>) => {
      // 檢查流的過濾器
      for (const f of this.filters) {
        if (!f(event)) return false;
      }
      // 檢查選項的過濾器
      if (filter && !filter(event)) return false;
      return true;
    };

    // 使用原生 addEventListener
    const listener = (event: Event) => {
      if (event instanceof CustomEvent && event.detail) {
        const payload = event.detail;
        if (combinedFilter(payload)) {
          callback(payload);
        }
      }
    };

    // 監聽通用事件
    this.bus.addEventListener('eventbus:all', listener, {
      ...listenerOptions,
      signal: controller.signal
    });

    // 重播歷史事件
    if (replay) {
      const history = this.bus.getHistory(replayCount);
      history.forEach(payload => {
        if (combinedFilter(payload)) {
          callback(payload);
        }
      });
    }

    return new Subscription(controller);
  }

  /**
   * 轉換為 Promise（等待第一個匹配的事件）
   */
  toPromise(): Promise<EventPayload<T>> {
    return new Promise(resolve => {
      const sub = this.subscribe(event => {
        sub.dispose();
        resolve(event);
      });
    });
  }

  /**
   * 收集事件到數組
   */
  async collect(count: number): Promise<EventPayload<T>[]> {
    const events: EventPayload<T>[] = [];
    return new Promise(resolve => {
      const sub = this.subscribe(event => {
        events.push(event);
        if (events.length >= count) {
          sub.dispose();
          resolve(events);
        }
      });
    });
  }

  /**
   * 轉換為原生 ReadableStream
   */
  toReadableStream(): ReadableStream<EventPayload<T>> {
    return new ReadableStream({
      start: (controller) => {
        const subscription = this.subscribe(event => {
          controller.enqueue(event);
        });

        // 清理函數
        return () => subscription.dispose();
      }
    });
  }
}

/**
 * EventBus - 統一事件總線（融合版）
 */
export class EventBus extends EventTarget {
  private static instance: EventBus;
  private sequence = 0;
  private eventHistory: EventPayload[] = [];
  private maxHistorySize = 100;

  /**
   * 主事件流（類似 ngrx 的 action$）
   */
  public readonly events$: EventStream;

  private constructor() {
    super();
    this.events$ = new EventStream(this);
    this.setupGlobalListener();
  }

  /**
   * 設置全局監聽器來捕獲所有事件
   */
  private setupGlobalListener(): void {
    // 使用捕獲階段攔截所有事件
    this.addEventListener('eventbus:all', (event) => {
      if (event instanceof CustomEvent && event.detail) {
        this.addToHistory(event.detail);
      }
    }, { capture: true });
  }

  /**
   * 獲取單例實例
   */
  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  /**
   * 發送事件到總線（使用原生 dispatchEvent）
   */
  emit(
    type: AllEvents,
    data: any,
    source: string,
    metadata?: Record<string, any>
  ): boolean {
    const payload: EventPayload = {
      type,
      data,
      source,
      timestamp: Date.now(),
      sequence: ++this.sequence,
      metadata
    };

    // 發送具體類型的事件
    const specificEvent = new CustomEvent(type, {
      detail: payload,
      bubbles: true,
      cancelable: true,
      composed: true
    });
    this.dispatchEvent(specificEvent);

    // 同時發送通用事件供全局監聽（使用 'eventbus:all' 作為事件類型）
    const allEvent = new CustomEvent('eventbus:all', {
      detail: payload,
      bubbles: true,
      cancelable: true,
      composed: true
    });

    return this.dispatchEvent(allEvent);
  }

  /**
   * 訂閱事件（原生 addEventListener 包裝）
   */
  on<T = any>(
    type: AllEvents | 'eventbus:all',
    callback: (event: EventPayload<T>) => void,
    options?: AddEventListenerOptions
  ): Subscription {
    const controller = new AbortController();

    const listener = (event: Event) => {
      if (event instanceof CustomEvent && event.detail) {
        callback(event.detail);
      }
    };

    this.addEventListener(type, listener, {
      ...options,
      signal: controller.signal
    });

    return new Subscription(controller);
  }

  /**
   * 一次性訂閱（使用原生 once）
   */
  once<T = any>(
    type: AllEvents | 'eventbus:all',
    callback: (event: EventPayload<T>) => void
  ): void {
    this.on(type, callback, { once: true });
  }

  /**
   * 訂閱所有事件
   */
  onAll<T = any>(
    callback: (event: EventPayload<T>) => void,
    options?: AddEventListenerOptions
  ): Subscription {
    return this.on('eventbus:all', callback, options);
  }

  /**
   * 等待特定事件（Promise 方式）
   */
  waitFor<T = any>(
    type: AllEvents,
    predicate?: (event: EventPayload<T>) => boolean
  ): Promise<EventPayload<T>> {
    return new Promise(resolve => {
      const controller = new AbortController();

      const listener = (event: Event) => {
        if (event instanceof CustomEvent && event.detail) {
          const payload = event.detail;
          if (!predicate || predicate(payload)) {
            controller.abort();
            resolve(payload);
          }
        }
      };

      this.addEventListener(type, listener, {
        signal: controller.signal
      });
    });
  }

  /**
   * 事件攔截器（在捕獲階段）
   */
  intercept<T = any>(
    type: AllEvents,
    interceptor: (event: EventPayload<T>) => boolean | void
  ): Subscription {
    const controller = new AbortController();

    const listener = (event: Event) => {
      if (event instanceof CustomEvent && event.detail) {
        const shouldContinue = interceptor(event.detail);
        if (shouldContinue === false && event.cancelable) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    };

    this.addEventListener(type, listener, {
      capture: true, // 在捕獲階段攔截
      signal: controller.signal
    });

    return new Subscription(controller);
  }

  /**
   * 批量發送事件
   */
  emitBatch(events: Array<{
    type: AllEvents;
    data: any;
    source: string;
    metadata?: Record<string, any>;
  }>): void {
    const batchPayload = events.map(e => ({
      ...e,
      sequence: ++this.sequence,
      timestamp: Date.now()
    }));

    // 發送批量事件
    const batchEvent = new CustomEvent('eventbus:batch', {
      detail: batchPayload,
      bubbles: true
    });
    this.dispatchEvent(batchEvent);

    // 同時發送個別事件
    events.forEach(({ type, data, source, metadata }) => {
      this.emit(type, data, source, metadata);
    });
  }

  /**
   * 創建事件流
   */
  createStream<T = any>(filter?: EventFilter<T>): EventStream<T> {
    return filter ? new EventStream<T>(this, [filter]) : new EventStream<T>(this);
  }

  /**
   * 添加到歷史記錄
   */
  private addToHistory(payload: EventPayload): void {
    this.eventHistory.push(payload);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
  }

  /**
   * 獲取事件歷史
   */
  getHistory(count?: number): EventPayload[] {
    return count
      ? this.eventHistory.slice(-count)
      : [...this.eventHistory];
  }

  /**
   * 清空事件歷史
   */
  clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * 重播歷史事件
   */
  replay(count: number = 10): void {
    const eventsToReplay = this.eventHistory.slice(-count);
    eventsToReplay.forEach(payload => {
      const replayEvent = new CustomEvent('eventbus:all', {
        detail: {
          ...payload,
          metadata: { ...payload.metadata, replayed: true }
        },
        bubbles: true,
        cancelable: true,
        composed: true
      });
      this.dispatchEvent(replayEvent);
    });
  }

  /**
   * 設置歷史記錄最大大小
   */
  setMaxHistorySize(size: number): void {
    this.maxHistorySize = size;
    if (this.eventHistory.length > size) {
      this.eventHistory = this.eventHistory.slice(-size);
    }
  }

  /**
   * 獲取統計信息
   */
  getStats(): {
    totalEvents: number;
    historySize: number;
    eventTypes: string[];
  } {
    const eventTypes = new Set<string>();
    this.eventHistory.forEach(e => eventTypes.add(e.type));

    return {
      totalEvents: this.sequence,
      historySize: this.eventHistory.length,
      eventTypes: Array.from(eventTypes)
    };
  }

  /**
   * 創建作用域事件總線
   */
  createScope(scopeName: string): EventTarget {
    const scopedTarget = new EventTarget();

    // 設置事件代理
    scopedTarget.addEventListener('eventbus:all', (event) => {
      if (event instanceof CustomEvent && event.detail) {
        const scopedPayload = {
          ...event.detail,
          source: `${scopeName}:${event.detail.source}`,
          metadata: { ...event.detail.metadata, scope: scopeName }
        };
        this.emit(
          event.detail.type as AllEvents,
          scopedPayload.data,
          scopedPayload.source,
          scopedPayload.metadata
        );
      }
    });

    return scopedTarget;
  }
}

/**
 * DevTools 整合
 */
export class EventBusDevTools {
  private bus: EventBus;
  private enabled = false;
  private subscription?: Subscription;

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  /**
   * 啟用 DevTools
   */
  enable(): void {
    if (this.enabled) return;

    this.enabled = true;

    // 監聽所有事件並輸出到控制台
    this.subscription = this.bus.events$.subscribe(event => {
      console.group(
        `%c[EventBus] ${event.type}`,
        'color: #4CAF50; font-weight: bold'
      );
      console.log('Source:', event.source);
      console.log('Data:', event.data);
      console.log('Timestamp:', new Date(event.timestamp).toISOString());
      console.log('Sequence:', event.sequence);
      if (event.metadata) {
        console.log('Metadata:', event.metadata);
      }
      console.groupEnd();
    });

    // 掛載到 window 以便調試
    if (typeof window !== 'undefined') {
      (window as any).__eventBus__ = this.bus;
      (window as any).__eventBusStats__ = () => this.bus.getStats();
      (window as any).__eventBusHistory__ = (count?: number) => this.bus.getHistory(count);

      console.log('%c[EventBus DevTools] Enabled', 'color: #2196F3; font-weight: bold');
      console.log('Available commands:');
      console.log('  __eventBus__ - Access EventBus instance');
      console.log('  __eventBusStats__() - View statistics');
      console.log('  __eventBusHistory__(count?) - View event history');
    }

    // 為每個事件創建性能標記
    this.bus.onAll((event) => {
      if (typeof performance !== 'undefined') {
        performance.mark(`event-${event.type}-${event.source}`);
      }
    });
  }

  /**
   * 禁用 DevTools
   */
  disable(): void {
    this.enabled = false;

    if (this.subscription) {
      this.subscription.dispose();
      this.subscription = undefined;
    }

    if (typeof window !== 'undefined') {
      delete (window as any).__eventBus__;
      delete (window as any).__eventBusStats__;
      delete (window as any).__eventBusHistory__;
    }
  }
}

// 導出便捷訪問
export const eventBus = EventBus.getInstance();
export const events$ = eventBus.events$;