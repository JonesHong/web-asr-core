/**
 * TimerService - 計時器服務類別（Event Architecture v2）
 * 
 * 提供事件驅動的計時器管理服務
 * 支援多個計時器的並行管理和事件通知
 */

import { EventEmitter } from '../core/EventEmitter';
import { Timer, type TimerState } from './timer';

/**
 * Timer 服務事件定義
 */
export interface TimerEvents {
  ready: {
    timestamp: number;
  };
  start: {
    id: string;
    duration: number;
    timestamp: number;
  };
  tick: {
    id: string;
    remaining: number;
    progress: number;
    elapsed: number;
    timestamp: number;
  };
  timeout: {
    id: string;
    duration: number;
    timestamp: number;
  };
  pause: {
    id: string;
    remaining: number;
    timestamp: number;
  };
  resume: {
    id: string;
    remaining: number;
    timestamp: number;
  };
  reset: {
    id: string;
    duration: number;
    timestamp: number;
  };
  stop: {
    id: string;
    elapsed: number;
    timestamp: number;
  };
  error: {
    error: Error;
    context: string;
    timerId?: string;
    timestamp: number;
  };
}

/**
 * 計時器配置
 */
interface TimerConfig {
  state: TimerState;
  interval?: number;
  tickInterval: number;
  onTimeout?: () => void;
}

/**
 * TimerService - 事件驅動的計時器服務
 * 
 * @example
 * ```typescript
 * const timerService = new TimerService();
 * 
 * // 訂閱事件
 * timerService.on('timeout', ({ id, duration }) => {
 *   console.log(`Timer ${id} timeout after ${duration}ms`);
 * });
 * 
 * timerService.on('tick', ({ id, remaining, progress }) => {
 *   console.log(`Timer ${id}: ${remaining}ms remaining (${progress}%)`);
 * });
 * 
 * // 創建並啟動計時器
 * timerService.createTimer('speech-timeout', 5000);
 * timerService.start('speech-timeout');
 * 
 * // 暫停和恢復
 * timerService.pause('speech-timeout');
 * timerService.resume('speech-timeout');
 * 
 * // 重置計時器
 * timerService.reset('speech-timeout', 10000);
 * ```
 */
export class TimerService extends EventEmitter<TimerEvents> {
  private timers: Map<string, TimerConfig> = new Map();
  
  constructor() {
    super();
    // 發射 ready 事件
    setTimeout(() => {
      this.emit('ready', { timestamp: Date.now() });
    }, 0);
  }
  
  /**
   * 創建新的計時器
   * @param id 計時器 ID
   * @param duration 持續時間（毫秒）
   * @param tickInterval tick 間隔（毫秒，預設 100）
   * @param onTimeout 超時回調函數（可選）
   */
  createTimer(
    id: string,
    duration: number,
    tickInterval: number = 100,
    onTimeout?: () => void
  ): void {
    try {
      // 如果計時器已存在，先停止它
      if (this.timers.has(id)) {
        this.stop(id);
      }
      
      // 創建新的計時器狀態
      const state = Timer.createState(duration);
      
      this.timers.set(id, {
        state,
        tickInterval,
        onTimeout
      });
    } catch (error) {
      this.emit('error', {
        error: error as Error,
        context: 'createTimer',
        timerId: id,
        timestamp: Date.now()
      });
      throw error;
    }
  }
  
  /**
   * 啟動計時器
   * @param id 計時器 ID
   */
  start(id: string): void {
    const timer = this.timers.get(id);
    if (!timer) {
      throw new Error(`Timer not found: ${id}`);
    }
    
    try {
      // 啟動計時器
      timer.state = Timer.start(timer.state);
      
      // 發射 start 事件
      this.emit('start', {
        id,
        duration: timer.state.totalTime,
        timestamp: Date.now()
      });
      
      // 清除舊的 interval（如果存在）
      if (timer.interval) {
        clearInterval(timer.interval);
      }
      
      // 設置新的 tick interval
      timer.interval = setInterval(() => {
        this.processTick(id);
      }, timer.tickInterval) as unknown as number;
      
    } catch (error) {
      this.emit('error', {
        error: error as Error,
        context: 'start',
        timerId: id,
        timestamp: Date.now()
      });
      throw error;
    }
  }
  
  /**
   * 處理計時器 tick
   * @param id 計時器 ID
   */
  private processTick(id: string): void {
    const timer = this.timers.get(id);
    if (!timer || !timer.state.isRunning) {
      return;
    }
    
    try {
      // 更新計時器狀態
      const result = Timer.tick(timer.state);
      timer.state = result.state;
      
      // 計算相關數值
      const remaining = Timer.getRemainingTime(timer.state);
      const progress = Timer.getProgress(timer.state);
      const elapsed = timer.state.totalTime - remaining;
      
      // 發射 tick 事件
      this.emit('tick', {
        id,
        remaining,
        progress,
        elapsed,
        timestamp: Date.now()
      });
      
      // 檢查是否超時
      if (result.timeout) {
        this.emit('timeout', {
          id,
          duration: timer.state.totalTime,
          timestamp: Date.now()
        });
        
        // 呼叫超時回調
        timer.onTimeout?.();
        
        // 停止計時器
        this.stop(id);
      }
    } catch (error) {
      this.emit('error', {
        error: error as Error,
        context: 'tick',
        timerId: id,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * 暫停計時器
   * @param id 計時器 ID
   */
  pause(id: string): void {
    const timer = this.timers.get(id);
    if (!timer) {
      return;
    }
    
    try {
      // 暫停計時器
      timer.state = Timer.pause(timer.state);
      
      // 清除 interval
      if (timer.interval) {
        clearInterval(timer.interval);
        timer.interval = undefined;
      }
      
      // 發射 pause 事件
      this.emit('pause', {
        id,
        remaining: Timer.getRemainingTime(timer.state),
        timestamp: Date.now()
      });
    } catch (error) {
      this.emit('error', {
        error: error as Error,
        context: 'pause',
        timerId: id,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * 恢復計時器
   * @param id 計時器 ID
   */
  resume(id: string): void {
    const timer = this.timers.get(id);
    if (!timer) {
      return;
    }
    
    try {
      // 發射 resume 事件
      this.emit('resume', {
        id,
        remaining: Timer.getRemainingTime(timer.state),
        timestamp: Date.now()
      });
      
      // 重新啟動計時器
      this.start(id);
    } catch (error) {
      this.emit('error', {
        error: error as Error,
        context: 'resume',
        timerId: id,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * 重置計時器
   * @param id 計時器 ID
   * @param duration 新的持續時間（可選）
   */
  reset(id: string, duration?: number): void {
    const timer = this.timers.get(id);
    if (!timer) {
      return;
    }
    
    try {
      // 清除 interval
      if (timer.interval) {
        clearInterval(timer.interval);
        timer.interval = undefined;
      }
      
      // 重置計時器狀態
      timer.state = Timer.reset(timer.state, duration);
      
      // 發射 reset 事件
      this.emit('reset', {
        id,
        duration: timer.state.totalTime,
        timestamp: Date.now()
      });
    } catch (error) {
      this.emit('error', {
        error: error as Error,
        context: 'reset',
        timerId: id,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * 停止並移除計時器
   * @param id 計時器 ID
   */
  stop(id: string): void {
    const timer = this.timers.get(id);
    if (!timer) {
      return;
    }
    
    try {
      // 清除 interval
      if (timer.interval) {
        clearInterval(timer.interval);
      }
      
      // 發射 stop 事件
      const elapsed = timer.state.totalTime - Timer.getRemainingTime(timer.state);
      this.emit('stop', {
        id,
        elapsed,
        timestamp: Date.now()
      });
      
      // 移除計時器
      this.timers.delete(id);
    } catch (error) {
      this.emit('error', {
        error: error as Error,
        context: 'stop',
        timerId: id,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * 獲取計時器狀態
   * @param id 計時器 ID
   * @returns 計時器狀態或 undefined
   */
  getTimerState(id: string): TimerState | undefined {
    return this.timers.get(id)?.state;
  }
  
  /**
   * 獲取計時器剩餘時間
   * @param id 計時器 ID
   * @returns 剩餘時間（毫秒）或 undefined
   */
  getRemainingTime(id: string): number | undefined {
    const timer = this.timers.get(id);
    if (!timer) return undefined;
    return Timer.getRemainingTime(timer.state);
  }
  
  /**
   * 獲取計時器進度
   * @param id 計時器 ID
   * @returns 進度（0-100）或 undefined
   */
  getProgress(id: string): number | undefined {
    const timer = this.timers.get(id);
    if (!timer) return undefined;
    return Timer.getProgress(timer.state);
  }
  
  /**
   * 檢查計時器是否活動
   * @param id 計時器 ID
   * @returns 是否活動
   */
  isActive(id: string): boolean {
    const timer = this.timers.get(id);
    return timer ? timer.state.isRunning : false;
  }
  
  /**
   * 檢查計時器是否暫停
   * @param id 計時器 ID
   * @returns 是否暫停
   */
  isPaused(id: string): boolean {
    const timer = this.timers.get(id);
    return timer ? (timer.state.pausedAt !== undefined) : false;
  }
  
  /**
   * 獲取所有計時器 ID
   * @returns 計時器 ID 陣列
   */
  getAllTimerIds(): string[] {
    return Array.from(this.timers.keys());
  }
  
  /**
   * 停止所有計時器
   */
  stopAll(): void {
    for (const id of this.timers.keys()) {
      this.stop(id);
    }
  }
  
  /**
   * 清理資源
   */
  dispose(): void {
    // 停止所有計時器
    this.stopAll();
    
    // 清除所有監聽器
    this.removeAllListeners();
  }
}

export default TimerService;