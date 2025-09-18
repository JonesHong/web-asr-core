/**
 * BusEnabledEventEmitter - EventBus 整合的事件發射器
 *
 * 擴展基礎 EventEmitter，自動將所有事件同步到中央 EventBus
 * 保持向後兼容，同時提供事件流功能
 */

import { EventEmitter } from './EventEmitter';
import { EventBus, eventBus } from './EventBus';
import type { AllEvents, EventDataMap } from '../types/events';

/**
 * EventBus 整合配置
 */
export interface BusIntegrationOptions {
  /** 是否啟用 EventBus 整合 */
  enabled?: boolean;
  /** 服務名稱（用於事件來源標識） */
  serviceName?: string;
  /** 自定義 EventBus 實例 */
  eventBus?: EventBus;
  /** 是否轉發到 EventBus */
  forward?: boolean;
  /** 事件元數據 */
  metadata?: Record<string, any>;
}

/**
 * BusEnabledEventEmitter - 具有 EventBus 整合的事件發射器
 *
 * @example
 * ```typescript
 * class MyService extends BusEnabledEventEmitter<MyEvents> {
 *   constructor() {
 *     super({
 *       serviceName: 'MyService',
 *       enabled: true
 *     });
 *   }
 * }
 *
 * const service = new MyService();
 *
 * // 本地事件監聽
 * service.on('event', data => console.log(data));
 *
 * // 同時會自動發送到 EventBus
 * eventBus.events$
 *   .fromSource('MyService')
 *   .subscribe(event => console.log(event));
 * ```
 */
export class BusEnabledEventEmitter<T extends Record<string, any>> extends EventEmitter<T> {
  private busOptions: Required<BusIntegrationOptions>;
  private bus: EventBus;

  constructor(options: BusIntegrationOptions = {}) {
    super();

    this.busOptions = {
      enabled: true,
      serviceName: this.constructor.name,
      eventBus: eventBus,
      forward: true,
      metadata: {},
      ...options
    };

    this.bus = this.busOptions.eventBus!;
  }

  /**
   * 發射事件（覆寫以添加 EventBus 整合）
   */
  emit<K extends keyof T>(event: K, data: T[K]): this {
    // 先發射本地事件
    super.emit(event, data);

    // 如果啟用且配置為轉發，則發送到 EventBus
    if (this.busOptions.enabled && this.busOptions.forward) {
      this.forwardToBus(event as string, data);
    }

    return this;
  }

  /**
   * 轉發事件到 EventBus
   */
  private forwardToBus(event: string, data: any): void {
    try {
      this.bus.emit(
        event as AllEvents,
        data,
        this.busOptions.serviceName,
        this.busOptions.metadata
      );
    } catch (error) {
      // 如果事件類型不在 AllEvents 中，仍然發送但記錄警告
      console.warn(
        `Event "${event}" from ${this.busOptions.serviceName} is not a registered event type`,
        error
      );

      // 使用通用方式發送
      (this.bus as any).emit(
        event,
        data,
        this.busOptions.serviceName,
        this.busOptions.metadata
      );
    }
  }

  /**
   * 啟用 EventBus 整合
   */
  enableBusIntegration(): void {
    this.busOptions.enabled = true;
  }

  /**
   * 禁用 EventBus 整合
   */
  disableBusIntegration(): void {
    this.busOptions.enabled = false;
  }

  /**
   * 設置服務名稱
   */
  setServiceName(name: string): void {
    this.busOptions.serviceName = name;
  }

  /**
   * 設置元數據
   */
  setMetadata(metadata: Record<string, any>): void {
    this.busOptions.metadata = metadata;
  }

  /**
   * 更新元數據
   */
  updateMetadata(updates: Record<string, any>): void {
    this.busOptions.metadata = {
      ...this.busOptions.metadata,
      ...updates
    };
  }

  /**
   * 獲取 EventBus 實例
   */
  getBus(): EventBus {
    return this.bus;
  }

  /**
   * 創建過濾此服務事件的流
   */
  createServiceStream() {
    return this.bus.events$.fromSource(this.busOptions.serviceName);
  }
}