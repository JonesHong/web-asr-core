import { ConfigManager } from '../utils/config-manager';

/**
 * Timer 狀態
 */
export interface TimerState {
    /** 是否正在計時 */
    isRunning: boolean;
    /** 剩餘時間（毫秒） */
    remainingTime: number;
    /** 總計時時間（毫秒） */
    totalTime: number;
    /** 開始時間戳 */
    startTime?: number;
    /** 暫停時的剩餘時間 */
    pausedAt?: number;
}

/**
 * Timer 參數
 */
export interface TimerParams {
    /** 倒數時間（毫秒） */
    duration: number;
    /** 回調函數 - 計時結束時觸發 */
    onTimeout?: () => void;
    /** 回調函數 - 每次 tick 時觸發 */
    onTick?: (remainingTime: number) => void;
    /** Tick 間隔（毫秒） */
    tickInterval?: number;
}

/**
 * Timer - 無狀態倒數計時器
 * 
 * 用於 VAD 靜音檢測後的說話結束判斷
 * 採用無狀態設計，狀態由呼叫者維護
 */
export class Timer {
    private static getDefaultParams(config: ConfigManager = ConfigManager.getInstance()): TimerParams {
        return {
            duration: config.audio.timer.vadSilenceTimeout,
            tickInterval: config.audio.timer.tickInterval
        };
    }

    /**
     * 建立初始狀態
     * @param duration 倒數時間（毫秒）
     * @param config 配置管理器
     */
    static createState(duration?: number, config?: ConfigManager): TimerState {
        const defaultParams = this.getDefaultParams(config);
        const totalTime = duration ?? defaultParams.duration;
        return {
            isRunning: false,
            remainingTime: totalTime,
            totalTime: totalTime
        };
    }

    /**
     * 開始倒數
     * @param state 當前狀態
     * @param params 計時參數
     * @param config 配置管理器
     * @returns 新狀態
     */
    static start(state: TimerState, params?: Partial<TimerParams>, config?: ConfigManager): TimerState {
        const defaultParams = this.getDefaultParams(config);
        const finalParams = { ...defaultParams, ...params };
        
        // 如果已經在運行，直接返回
        if (state.isRunning) {
            return state;
        }

        const now = Date.now();
        
        return {
            isRunning: true,
            remainingTime: state.pausedAt ?? finalParams.duration,
            totalTime: finalParams.duration,
            startTime: now,
            pausedAt: undefined
        };
    }

    /**
     * 暫停倒數
     * @param state 當前狀態
     * @returns 新狀態
     */
    static pause(state: TimerState): TimerState {
        if (!state.isRunning || state.pausedAt !== undefined) {
            return state;
        }

        const now = Date.now();
        const elapsed = state.startTime ? now - state.startTime : 0;
        const remaining = Math.max(0, state.remainingTime - elapsed);

        return {
            ...state,
            isRunning: false,
            remainingTime: remaining,
            pausedAt: remaining
        };
    }

    /**
     * 重置倒數
     * @param state 當前狀態
     * @param duration 新的倒數時間（可選）
     * @returns 新狀態
     */
    static reset(state: TimerState, duration?: number): TimerState {
        const totalTime = duration ?? state.totalTime;
        
        return {
            isRunning: false,
            remainingTime: totalTime,
            totalTime: totalTime,
            startTime: undefined,
            pausedAt: undefined
        };
    }

    /**
     * 更新計時狀態（需要定期呼叫）
     * @param state 當前狀態
     * @returns 更新後的狀態和是否超時
     */
    static tick(state: TimerState): { state: TimerState; timeout: boolean } {
        if (!state.isRunning || !state.startTime) {
            return { state, timeout: false };
        }

        const now = Date.now();
        const elapsed = now - state.startTime;
        const remaining = Math.max(0, state.remainingTime - elapsed);

        const newState: TimerState = {
            ...state,
            remainingTime: remaining
        };

        // 檢查是否超時
        const timeout = remaining === 0;
        
        if (timeout) {
            // 超時時自動停止
            newState.isRunning = false;
            newState.startTime = undefined;
        }

        return { state: newState, timeout };
    }

    /**
     * 延長倒數時間
     * @param state 當前狀態
     * @param additionalTime 要增加的時間（毫秒）
     * @returns 新狀態
     */
    static extend(state: TimerState, additionalTime: number): TimerState {
        if (additionalTime <= 0) {
            return state;
        }

        return {
            ...state,
            remainingTime: state.remainingTime + additionalTime,
            totalTime: state.totalTime + additionalTime
        };
    }

    /**
     * 取得剩餘時間
     * @param state 當前狀態
     * @returns 剩餘時間（毫秒）
     */
    static getRemainingTime(state: TimerState): number {
        if (!state.isRunning || !state.startTime) {
            return state.pausedAt ?? state.remainingTime;
        }

        const now = Date.now();
        const elapsed = now - state.startTime;
        return Math.max(0, state.remainingTime - elapsed);
    }

    /**
     * 取得進度百分比
     * @param state 當前狀態
     * @returns 進度百分比 (0-100)
     */
    static getProgress(state: TimerState): number {
        const remaining = this.getRemainingTime(state);
        const progress = ((state.totalTime - remaining) / state.totalTime) * 100;
        return Math.min(100, Math.max(0, progress));
    }

    /**
     * 檢查是否正在運行
     * @param state 當前狀態
     */
    static isRunning(state: TimerState): boolean {
        return state.isRunning;
    }
}

/**
 * TimerManager - 管理多個計時器的輔助類
 * 
 * 提供自動 tick 和回調管理
 */
export class TimerManager {
    private timers: Map<string, {
        state: TimerState;
        params: TimerParams;
        intervalId?: number;
    }> = new Map();

    private config: ConfigManager;

    constructor(config: ConfigManager = ConfigManager.getInstance()) {
        this.config = config;
    }

    /**
     * 建立並註冊計時器
     * @param id 計時器 ID
     * @param params 計時參數
     */
    createTimer(id: string, params: TimerParams): void {
        if (this.timers.has(id)) {
            this.stopTimer(id);
        }

        const state = Timer.createState(params.duration);
        this.timers.set(id, { state, params });
    }

    /**
     * 開始計時器
     * @param id 計時器 ID
     */
    startTimer(id: string): void {
        const timer = this.timers.get(id);
        if (!timer) return;

        timer.state = Timer.start(timer.state, timer.params);

        // 設定自動 tick
        if (timer.intervalId) {
            clearInterval(timer.intervalId);
        }

        const tickInterval = timer.params.tickInterval ?? 100;
        timer.intervalId = window.setInterval(() => {
            const result = Timer.tick(timer.state);
            timer.state = result.state;

            // 觸發 tick 回調
            if (timer.params.onTick) {
                timer.params.onTick(Timer.getRemainingTime(timer.state));
            }

            // 觸發超時回調
            if (result.timeout) {
                if (timer.params.onTimeout) {
                    timer.params.onTimeout();
                }
                this.stopTimer(id);
            }
        }, tickInterval);
    }

    /**
     * 暫停計時器
     * @param id 計時器 ID
     */
    pauseTimer(id: string): void {
        const timer = this.timers.get(id);
        if (!timer) return;

        timer.state = Timer.pause(timer.state);
        
        if (timer.intervalId) {
            clearInterval(timer.intervalId);
            timer.intervalId = undefined;
        }
    }

    /**
     * 重置計時器
     * @param id 計時器 ID
     * @param duration 新的倒數時間（可選）
     */
    resetTimer(id: string, duration?: number): void {
        const timer = this.timers.get(id);
        if (!timer) return;

        if (timer.intervalId) {
            clearInterval(timer.intervalId);
            timer.intervalId = undefined;
        }

        timer.state = Timer.reset(timer.state, duration);
        
        if (duration) {
            timer.params.duration = duration;
        }
    }

    /**
     * 停止並移除計時器
     * @param id 計時器 ID
     */
    stopTimer(id: string): void {
        const timer = this.timers.get(id);
        if (!timer) return;

        if (timer.intervalId) {
            clearInterval(timer.intervalId);
        }

        this.timers.delete(id);
    }

    /**
     * 延長計時器時間
     * @param id 計時器 ID
     * @param additionalTime 要增加的時間（毫秒）
     */
    extendTimer(id: string, additionalTime: number): void {
        const timer = this.timers.get(id);
        if (!timer) return;

        timer.state = Timer.extend(timer.state, additionalTime);
    }

    /**
     * 取得計時器狀態
     * @param id 計時器 ID
     */
    getTimerState(id: string): TimerState | undefined {
        return this.timers.get(id)?.state;
    }

    /**
     * 取得計時器剩餘時間
     * @param id 計時器 ID
     */
    getRemainingTime(id: string): number {
        const timer = this.timers.get(id);
        if (!timer) return 0;
        
        return Timer.getRemainingTime(timer.state);
    }

    /**
     * 取得計時器進度
     * @param id 計時器 ID
     */
    getProgress(id: string): number {
        const timer = this.timers.get(id);
        if (!timer) return 0;
        
        return Timer.getProgress(timer.state);
    }

    /**
     * 清理所有計時器
     */
    clearAll(): void {
        for (const [id] of this.timers) {
            this.stopTimer(id);
        }
    }

    /**
     * 取得所有計時器狀態
     */
    getAllTimers(): Map<string, TimerState> {
        const result = new Map<string, TimerState>();
        
        for (const [id, timer] of this.timers) {
            result.set(id, { ...timer.state });
        }
        
        return result;
    }
}

export default Timer;