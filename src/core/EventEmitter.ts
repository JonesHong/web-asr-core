/**
 * EventEmitter - 基礎事件發射器類別
 * 
 * 提供類型安全的事件訂閱和發射功能
 * 支援 on、once、off 方法和鏈式調用
 */
export class EventEmitter<T extends Record<string, any>> {
  private events: Map<keyof T, Set<(data: any) => void>>;
  
  constructor() {
    this.events = new Map();
  }
  
  /**
   * 訂閱事件
   * @param event 事件名稱
   * @param handler 事件處理函數
   * @returns this 用於鏈式調用
   */
  on<K extends keyof T>(event: K, handler: (data: T[K]) => void): this {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    this.events.get(event)!.add(handler);
    return this;
  }
  
  /**
   * 訂閱事件（只觸發一次）
   * @param event 事件名稱
   * @param handler 事件處理函數
   * @returns this 用於鏈式調用
   */
  once<K extends keyof T>(event: K, handler: (data: T[K]) => void): this {
    const wrapper = (data: T[K]) => {
      this.off(event, wrapper);
      handler(data);
    };
    return this.on(event, wrapper);
  }
  
  /**
   * 取消訂閱事件
   * @param event 事件名稱
   * @param handler 事件處理函數（可選，不提供則移除所有處理函數）
   * @returns this 用於鏈式調用
   */
  off<K extends keyof T>(event: K, handler?: (data: T[K]) => void): this {
    if (!handler) {
      this.events.delete(event);
    } else {
      this.events.get(event)?.delete(handler);
    }
    return this;
  }
  
  /**
   * 發射事件
   * @param event 事件名稱
   * @param data 事件資料
   * @returns this 用於鏈式調用
   */
  emit<K extends keyof T>(event: K, data: T[K]): this {
    this.events.get(event)?.forEach(handler => {
      try {
        handler(data);
      } catch (error) {
        console.error(`Error in event handler for ${String(event)}:`, error);
      }
    });
    return this;
  }
  
  /**
   * 移除所有事件監聽器
   * @returns this 用於鏈式調用
   */
  removeAllListeners(): this {
    this.events.clear();
    return this;
  }
  
  /**
   * 獲取事件的監聽器數量
   * @param event 事件名稱
   * @returns 監聽器數量
   */
  listenerCount<K extends keyof T>(event: K): number {
    return this.events.get(event)?.size ?? 0;
  }
  
  /**
   * 獲取所有事件名稱
   * @returns 事件名稱陣列
   */
  eventNames(): (keyof T)[] {
    return Array.from(this.events.keys());
  }
}

/**
 * 創建 EventEmitter 實例的輔助函數
 */
export function createEventEmitter<T extends Record<string, any>>(): EventEmitter<T> {
  return new EventEmitter<T>();
}

export default EventEmitter;