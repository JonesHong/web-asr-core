/**
 * 系統診斷工具
 * 
 * 提供瀏覽器能力檢測、效能評估和最佳配置建議
 * 
 * @fileoverview 系統診斷工具實現
 * @author WebASRCore Team
 */

/**
 * 系統診斷結果介面
 */
export interface SystemDiagnosis {
  /** 瀏覽器支援的功能 */
  supported: {
    /** 是否為安全上下文 (HTTPS/localhost) */
    secureContext: boolean;
    /** 是否支援 getUserMedia API */
    getUserMedia: boolean;
    /** 是否支援 AudioWorklet API */
    audioWorklet: boolean;
    /** 是否支援 SharedArrayBuffer */
    sharedArrayBuffer: boolean;
    /** 是否為跨源隔離環境 */
    crossOriginIsolated: boolean;
    /** 是否支援 WebGPU */
    webgpu: boolean;
    /** 是否支援 WebGL 2.0 */
    webgl: boolean;
    /** 是否支援 WebNN (Web Neural Network API) */
    webnn: boolean;
    /** Worker 中是否支援 WebGPU */
    webgpuInWorker: boolean;
    /** 是否支援 WASM 多執行緒 */
    wasmThreads: boolean;
    /** 是否支援 WASM SIMD */
    wasmSIMD: boolean;
    /** 是否支援 MediaRecorder API */
    mediaRecorder: boolean;
    /** 支援的 MediaRecorder MIME 類型 */
    mediaRecorderMimes: string[];
    /** 是否支援 Web Speech Recognition API */
    webSpeechRecognition: boolean;
    /** Web Speech API 是否支援離線模式 */
    webSpeechOffline: boolean;
    /** 是否支援 Cache API */
    cacheAPI: boolean;
    /** 是否支援 IndexedDB */
    indexedDB: boolean;
  };
  
  /** 系統效能指標 */
  performance: {
    /** GPU 效能等級 */
    gpuTier: 'high' | 'medium' | 'low' | 'unknown';
    /** 記憶體大小 (GB) */
    memoryGB: number;
    /** CPU 核心數 */
    cpuCores: number;
    /** 瀏覽器資訊 */
    browser: {
      name: string;
      version: string;
      engine: string;
    };
  };
  
  /** 最佳配置建議 */
  recommendation: {
    /** 建議的執行提供者優先順序 */
    executionProvider: ('webgpu' | 'webnn' | 'webgl' | 'wasm')[];
    /** 建議的 Whisper 後端 */
    whisperBackend: 'webgpu' | 'wasm';
    /** 建議的資料傳輸方式 */
    transport: 'sab' | 'messageport';
    /** 建議的音訊配置 */
    audioConfig: {
      /** 音訊塊大小 (毫秒) */
      chunkMs: number;
      /** 緩衝區大小 (幀數) */
      bufferSizeFrames: number;
    };
    /** 建議的模型大小 */
    modelSize: 'tiny' | 'base' | 'small';
    /** 建議的 MediaRecorder MIME 類型 */
    mediaRecorderMime: string;
    /** 需要的 HTTP 標頭（如果缺少功能） */
    headersNeeded?: {
      COOP?: string;
      COEP?: string;
    };
    /** 建議和提示 */
    notes: string[];
    /** 警告訊息 */
    warnings: string[];
  };
}

/**
 * 系統診斷工具類
 */
export class SystemDiagnostics {
  private static instance: SystemDiagnostics;
  private cachedDiagnosis: SystemDiagnosis | null = null;
  
  private constructor() {}
  
  /**
   * 取得系統診斷工具單例
   */
  public static getInstance(): SystemDiagnostics {
    if (!SystemDiagnostics.instance) {
      SystemDiagnostics.instance = new SystemDiagnostics();
    }
    return SystemDiagnostics.instance;
  }
  
  /**
   * 執行完整的系統診斷
   * @param force 是否強制重新診斷（忽略快取）
   * @returns 系統診斷結果
   */
  public async diagnose(force = false): Promise<SystemDiagnosis> {
    if (this.cachedDiagnosis && !force) {
      return this.cachedDiagnosis;
    }
    
    const supported = await this.checkFeatureSupport();
    const performance = await this.checkPerformance();
    const recommendation = this.generateRecommendations(supported, performance);
    
    this.cachedDiagnosis = {
      supported,
      performance,
      recommendation
    };
    
    return this.cachedDiagnosis;
  }
  
  /**
   * 檢測瀏覽器功能支援
   */
  private async checkFeatureSupport(): Promise<SystemDiagnosis['supported']> {
    const supported: SystemDiagnosis['supported'] = {
      secureContext: this.isSecureContext(),
      getUserMedia: this.hasGetUserMedia(),
      audioWorklet: await this.hasAudioWorklet(),
      sharedArrayBuffer: this.hasSharedArrayBuffer(),
      crossOriginIsolated: this.isCrossOriginIsolated(),
      webgpu: await this.hasWebGPU(),
      webgl: this.hasWebGL(),
      webnn: this.hasWebNN(),
      webgpuInWorker: await this.hasWebGPUInWorker(),
      wasmThreads: this.hasWasmThreads(),
      wasmSIMD: await this.hasWasmSIMD(),
      mediaRecorder: this.hasMediaRecorder(),
      mediaRecorderMimes: this.getSupportedMediaRecorderMimes(),
      webSpeechRecognition: this.hasWebSpeechRecognition(),
      webSpeechOffline: this.hasWebSpeechOffline(),
      cacheAPI: this.hasCacheAPI(),
      indexedDB: this.hasIndexedDB()
    };
    
    return supported;
  }
  
  /**
   * 檢測系統效能
   */
  private async checkPerformance(): Promise<SystemDiagnosis['performance']> {
    const gpuTier = await this.detectGPUTier();
    const memoryGB = this.getMemorySize();
    const cpuCores = navigator.hardwareConcurrency || 4;
    const browser = this.getBrowserInfo();
    
    return {
      gpuTier,
      memoryGB,
      cpuCores,
      browser
    };
  }
  
  /**
   * 生成配置建議
   */
  private generateRecommendations(
    supported: SystemDiagnosis['supported'],
    performance: SystemDiagnosis['performance']
  ): SystemDiagnosis['recommendation'] {
    const executionProvider: ('webgpu' | 'webnn' | 'webgl' | 'wasm')[] = [];
    const notes: string[] = [];
    const warnings: string[] = [];
    let headersNeeded: SystemDiagnosis['recommendation']['headersNeeded'] | undefined;
    
    // 決定執行提供者優先順序
    if (supported.webgpu) {
      executionProvider.push('webgpu');
      notes.push('✅ WebGPU 可用，將獲得最佳效能');
      
      // 檢查 Worker 中的 WebGPU
      if (!supported.webgpuInWorker) {
        warnings.push('⚠️ Worker 中 WebGPU 不可用，部分功能可能受限');
        notes.push('💡 請確認 Worker 環境有正確的 WebGPU 支援');
      }
    } else {
      warnings.push('⚠️ WebGPU 不可用，將使用 WASM 作為後備方案');
      notes.push('💡 執行 WebGPU 診斷查看詳細設定步驟（見 Console）');
    }
    
    if (supported.webnn) {
      executionProvider.push('webnn');
      notes.push('✅ WebNN 可用，可使用神經網路加速');
    }
    if (supported.webgl) {
      executionProvider.push('webgl');
    }
    executionProvider.push('wasm'); // 總是添加 WASM 作為後備
    
    // Whisper 後端建議
    const whisperBackend = supported.webgpu ? 'webgpu' : 'wasm';
    
    // 資料傳輸方式建議
    const transport = supported.sharedArrayBuffer ? 'sab' : 'messageport';
    if (!supported.sharedArrayBuffer) {
      warnings.push('⚠️ SharedArrayBuffer 不可用，可能影響效能');
      if (!supported.crossOriginIsolated) {
        headersNeeded = {
          COOP: 'same-origin',
          COEP: 'require-corp'
        };
        notes.push('💡 需要設置 COOP 和 COEP 標頭以啟用 SharedArrayBuffer');
      }
    }
    
    // 音訊配置建議
    const audioConfig = {
      chunkMs: supported.audioWorklet ? 80 : 100,
      bufferSizeFrames: performance.cpuCores >= 8 ? 2048 : 4096
    };
    
    // 模型大小建議
    let modelSize: 'tiny' | 'base' | 'small';
    if (performance.memoryGB >= 8 && performance.gpuTier === 'high') {
      modelSize = 'small';
      notes.push('💪 系統效能優秀，可使用 small 模型');
    } else if (performance.memoryGB >= 4 && performance.gpuTier !== 'low') {
      modelSize = 'base';
      notes.push('👍 系統效能良好，建議使用 base 模型');
    } else {
      modelSize = 'tiny';
      notes.push('💡 建議使用 tiny 模型以確保流暢運行');
    }
    
    // MediaRecorder MIME 類型建議
    const mediaRecorderMime = this.recommendMediaRecorderMime(supported.mediaRecorderMimes);
    
    // 額外檢查和警告
    if (!supported.secureContext) {
      warnings.push('🔒 需要 HTTPS 或 localhost 才能使用麥克風');
    }
    
    if (!supported.getUserMedia) {
      warnings.push('🎤 瀏覽器不支援 getUserMedia，無法訪問麥克風');
    }
    
    if (!supported.audioWorklet) {
      warnings.push('🔊 AudioWorklet 不可用，將使用舊版 ScriptProcessorNode');
    }
    
    if (!supported.wasmSIMD) {
      warnings.push('⚡ WASM SIMD 不可用，WASM 效能將受限');
    }
    
    if (performance.cpuCores < 4) {
      warnings.push('⚠️ CPU 核心數較少，可能影響即時處理效能');
    }
    
    if (performance.memoryGB < 4) {
      warnings.push('⚠️ 記憶體較少，建議使用較小的模型');
    }
    
    // 瀏覽器特定建議
    if (performance.browser.name === 'Safari') {
      warnings.push('🌐 Safari 的某些功能支援有限，建議使用 Chrome 或 Edge');
    }
    
    if (supported.webSpeechRecognition && !supported.webSpeechOffline) {
      notes.push('☁️ Web Speech API 需要網路連線');
    }
    
    return {
      executionProvider,
      whisperBackend,
      transport,
      audioConfig,
      modelSize,
      mediaRecorderMime,
      headersNeeded,
      notes,
      warnings
    };
  }
  
  // === 功能檢測方法 ===
  
  private isSecureContext(): boolean {
    return window.isSecureContext === true;
  }
  
  private hasGetUserMedia(): boolean {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }
  
  private async hasAudioWorklet(): Promise<boolean> {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const hasWorklet = 'audioWorklet' in audioContext;
      audioContext.close();
      return hasWorklet;
    } catch {
      return false;
    }
  }
  
  private hasSharedArrayBuffer(): boolean {
    return typeof SharedArrayBuffer !== 'undefined';
  }
  
  private isCrossOriginIsolated(): boolean {
    return (window as any).crossOriginIsolated === true;
  }
  
  private async hasWebGPU(): Promise<boolean> {
    try {
      if (!('gpu' in navigator)) {
        console.warn('[WebGPU] ❌ navigator.gpu 不存在');
        this.logWebGPUSetupGuide();
        return false;
      }
      const adapter = await (navigator as any).gpu.requestAdapter();
      if (adapter === null) {
        console.warn('[WebGPU] ❌ requestAdapter() 返回 null');
        this.logWebGPUSetupGuide();
        return false;
      }
      console.log('[WebGPU] ✅ WebGPU 可用', adapter.name || '');
      return true;
    } catch (error) {
      console.error('[WebGPU] ❌ 檢測失敗:', error);
      this.logWebGPUSetupGuide();
      return false;
    }
  }
  
  /**
   * 輸出 WebGPU 設定指南到 console
   */
  private logWebGPUSetupGuide(): void {
    console.group('🔧 WebGPU 設定指南');
    
    console.log('%c請按照以下步驟啟用 WebGPU:', 'font-weight: bold; color: #ff6b6b');
    
    console.log('\n%c1️⃣ 檢查安全環境', 'font-weight: bold; color: #4ecdc4');
    console.log('   WebGPU 只在安全環境提供:');
    console.log('   ✅ https:// 網站');
    console.log('   ✅ http://localhost 或 http://127.0.0.1');
    console.log('   ❌ file:// 協議不支援');
    console.log('   當前環境:', window.location.protocol);
    
    console.log('\n%c2️⃣ 開啟硬體加速', 'font-weight: bold; color: #4ecdc4');
    console.log('   1. 前往 chrome://settings/system 或 edge://settings/system');
    console.log('   2. 開啟「在可用時使用圖形加速」');
    console.log('   3. 完全重啟瀏覽器');
    
    console.log('\n%c3️⃣ 檢查 GPU 狀態', 'font-weight: bold; color: #4ecdc4');
    console.log('   1. 前往 chrome://gpu 或 edge://gpu');
    console.log('   2. 尋找「WebGPU: Hardware accelerated」');
    console.log('   3. 如果顯示 disabled 或 blocklist，繼續步驟 4');
    
    console.log('\n%c4️⃣ 啟用 Unsafe WebGPU (開發用)', 'font-weight: bold; color: #4ecdc4');
    console.log('   1. 前往 chrome://flags/#enable-unsafe-webgpu');
    console.log('   2. 設為 Enabled');
    console.log('   3. 重啟瀏覽器');
    console.log('   ⚠️ 注意：這會停用 GPU 封鎖清單，僅建議開發時使用');
    
    console.log('\n%c5️⃣ Windows 多 GPU 設定 (如適用)', 'font-weight: bold; color: #4ecdc4');
    console.log('   如果有獨立顯示卡但 WebGPU 使用內顯:');
    console.log('   1. 前往 chrome://flags/#force-high-performance-gpu');
    console.log('   2. 設為 Enabled');
    console.log('   3. 重啟瀏覽器');
    
    console.log('\n%c📋 快速診斷腳本', 'font-weight: bold; color: #45b7d1');
    console.log('複製以下代碼到 Console 執行:');
    console.log(`%c
(async () => {
  console.log('🔍 WebGPU 診斷開始...');
  console.log('主執行緒 navigator.gpu:', !!navigator.gpu);
  
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      console.log('✅ 主執行緒 adapter:', adapter?.name || '取得成功');
    } catch (e) {
      console.error('❌ 主執行緒 adapter 失敗:', e);
    }
  }
  
  // 測試 Worker 中的 WebGPU
  const workerCode = \`
    (async () => {
      const hasGPU = !!self.navigator?.gpu;
      console.log('[Worker] navigator.gpu:', hasGPU);
      
      if (hasGPU) {
        try {
          const adapter = await self.navigator.gpu.requestAdapter();
          postMessage({ok: true, name: adapter?.name || '取得成功'});
        } catch(e) {
          postMessage({ok: false, err: String(e)});
        }
      } else {
        postMessage({ok: false, err: 'Worker 中沒有 navigator.gpu'});
      }
    })();
  \`;
  
  const worker = new Worker(URL.createObjectURL(
    new Blob([workerCode], {type: 'text/javascript'})
  ));
  
  worker.onmessage = (e) => {
    if (e.data.ok) {
      console.log('✅ Worker adapter:', e.data.name);
    } else {
      console.error('❌ Worker 失敗:', e.data.err);
    }
    worker.terminate();
  };
})();
    `, 'background: #f0f0f0; padding: 10px; font-family: monospace; font-size: 12px');
    
    console.log('\n%c🔗 參考資料', 'font-weight: bold; color: #95a5a6');
    console.log('Chrome WebGPU 疑難排解: https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips');
    console.log('WebGPU 支援狀態: https://caniuse.com/webgpu');
    
    console.groupEnd();
  }
  
  private hasWebGL(): boolean {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      return gl !== null;
    } catch {
      return false;
    }
  }
  
  private hasWebNN(): boolean {
    return 'ml' in navigator;
  }
  
  private async hasWebGPUInWorker(): Promise<boolean> {
    try {
      const workerCode = `
        (async () => {
          const hasGPU = !!self.navigator?.gpu;
          let adapterName = null;
          try {
            const adapter = hasGPU ? await self.navigator.gpu.requestAdapter() : null;
            adapterName = adapter?.name ?? null;
          } catch (e) {
            // swallow, will report as null
          }
          self.postMessage({ hasGPU, adapterName });
        })();
      `;
      
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const worker = new Worker(URL.createObjectURL(blob));
      
      return new Promise<boolean>((resolve) => {
        let resolved = false;
        worker.onmessage = (e) => {
          if (resolved) return;
          resolved = true;
          worker.terminate();
          const { hasGPU, adapterName } = e.data;
          
          if (hasGPU && adapterName) {
            console.log('[WebGPU Worker] ✅ Worker 中 WebGPU 可用:', adapterName);
          } else if (hasGPU && !adapterName) {
            console.warn('[WebGPU Worker] ⚠️ Worker 有 navigator.gpu 但無法取得 adapter');
          } else {
            console.warn('[WebGPU Worker] ❌ Worker 中沒有 WebGPU 支援');
          }
          
          resolve(!!hasGPU && !!adapterName);
        };
        worker.onerror = () => {
          if (resolved) return;
          resolved = true;
          worker.terminate();
          console.error('[WebGPU Worker] ❌ Worker 創建失敗');
          resolve(false);
        };
        
        // Timeout after 2 seconds
        setTimeout(() => {
          if (resolved) return;
          resolved = true;
          worker.terminate();
          console.warn('[WebGPU Worker] ⏱️ 檢測超時');
          resolve(false);
        }, 2000);
      });
    } catch (error) {
      console.error('[WebGPU Worker] ❌ 檢測失敗:', error);
      return false;
    }
  }
  
  private hasWasmThreads(): boolean {
    return this.hasSharedArrayBuffer() && this.isCrossOriginIsolated();
  }
  
  private async hasWasmSIMD(): Promise<boolean> {
    try {
      // SIMD 測試字節碼
      const simdBytes = new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 9, 1, 7, 0, 65, 0, 253, 15, 11
      ]);
      const result = await WebAssembly.validate(simdBytes);
      return result;
    } catch {
      return false;
    }
  }
  
  private hasMediaRecorder(): boolean {
    return typeof MediaRecorder !== 'undefined';
  }
  
  private getSupportedMediaRecorderMimes(): string[] {
    if (!this.hasMediaRecorder()) {
      return [];
    }
    
    const mimes = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
      'audio/mp4',
      'audio/mpeg',
      'audio/wav'
    ];
    
    return mimes.filter(mime => MediaRecorder.isTypeSupported(mime));
  }
  
  private hasWebSpeechRecognition(): boolean {
    return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  }
  
  private hasWebSpeechOffline(): boolean {
    // 目前沒有瀏覽器支援離線 Web Speech API
    return false;
  }
  
  private hasCacheAPI(): boolean {
    return 'caches' in window;
  }
  
  private hasIndexedDB(): boolean {
    return 'indexedDB' in window;
  }
  
  // === 效能檢測方法 ===
  
  private async detectGPUTier(): Promise<'high' | 'medium' | 'low' | 'unknown'> {
    try {
      if (!('gpu' in navigator)) {
        return 'unknown';
      }
      
      const adapter = await (navigator as any).gpu.requestAdapter();
      if (!adapter) {
        return 'unknown';
      }
      
      // 簡單的效能評估（實際應該更複雜）
      const info = await adapter.requestAdapterInfo?.();
      if (info) {
        // 根據 GPU 廠商和架構簡單分類
        const vendor = info.vendor?.toLowerCase() || '';
        if (vendor.includes('nvidia') || vendor.includes('amd')) {
          return 'high';
        } else if (vendor.includes('intel')) {
          return 'medium';
        }
      }
      
      return 'medium'; // 預設中等
    } catch {
      return 'unknown';
    }
  }
  
  private getMemorySize(): number {
    // 使用 deviceMemory API（如果可用）
    if ('deviceMemory' in navigator) {
      return (navigator as any).deviceMemory;
    }
    
    // 使用 performance.memory（Chrome only）
    if ('memory' in performance) {
      const memory = (performance as any).memory;
      if (memory.jsHeapSizeLimit) {
        // 粗略估計系統記憶體
        return Math.round(memory.jsHeapSizeLimit / 1024 / 1024 / 1024);
      }
    }
    
    // 預設值
    return 4;
  }
  
  private getBrowserInfo(): SystemDiagnosis['performance']['browser'] {
    const ua = navigator.userAgent;
    let name = 'Unknown';
    let version = 'Unknown';
    let engine = 'Unknown';
    
    // 檢測瀏覽器
    if (ua.includes('Firefox')) {
      name = 'Firefox';
      version = ua.match(/Firefox\/(\d+\.\d+)/)?.[1] || 'Unknown';
      engine = 'Gecko';
    } else if (ua.includes('Edg')) {
      name = 'Edge';
      version = ua.match(/Edg\/(\d+\.\d+)/)?.[1] || 'Unknown';
      engine = 'Chromium';
    } else if (ua.includes('Chrome')) {
      name = 'Chrome';
      version = ua.match(/Chrome\/(\d+\.\d+)/)?.[1] || 'Unknown';
      engine = 'Chromium';
    } else if (ua.includes('Safari')) {
      name = 'Safari';
      version = ua.match(/Version\/(\d+\.\d+)/)?.[1] || 'Unknown';
      engine = 'WebKit';
    }
    
    return { name, version, engine };
  }
  
  private recommendMediaRecorderMime(supportedMimes: string[]): string {
    // 優先順序：Opus > 其他
    const priority = [
      'audio/webm;codecs=opus',
      'audio/ogg;codecs=opus',
      'audio/webm',
      'audio/ogg',
      'audio/mp4',
      'audio/mpeg',
      'audio/wav'
    ];
    
    for (const mime of priority) {
      if (supportedMimes.includes(mime)) {
        return mime;
      }
    }
    
    return supportedMimes[0] || 'audio/webm';
  }
  
  /**
   * 執行 WebGPU 診斷並輸出指南
   */
  public async diagnoseWebGPU(): Promise<{
    mainThread: boolean;
    worker: boolean;
    adapterName?: string;
  }> {
    console.group('🔍 WebGPU 診斷');
    
    // 檢查主執行緒
    const mainThreadSupport = await this.hasWebGPU();
    
    // 檢查 Worker
    const workerSupport = await this.hasWebGPUInWorker();
    
    // 取得 adapter 資訊
    let adapterName: string | undefined;
    if (mainThreadSupport) {
      try {
        const adapter = await (navigator as any).gpu.requestAdapter();
        adapterName = adapter?.name;
      } catch {}
    }
    
    // 輸出結果摘要
    console.log('\n📊 診斷結果:');
    console.log(`主執行緒 WebGPU: ${mainThreadSupport ? '✅' : '❌'}`);
    console.log(`Worker WebGPU: ${workerSupport ? '✅' : '❌'}`);
    if (adapterName) {
      console.log(`GPU Adapter: ${adapterName}`);
    }
    
    // 如果有問題，自動顯示設定指南
    if (!mainThreadSupport || !workerSupport) {
      console.log('\n⚠️ WebGPU 未完全啟用，請參考上方設定指南');
    } else {
      console.log('\n🎉 WebGPU 已完全啟用！');
    }
    
    console.groupEnd();
    
    return {
      mainThread: mainThreadSupport,
      worker: workerSupport,
      adapterName
    };
  }
  
  /**
   * 生成診斷報告字串
   */
  public async generateReport(): Promise<string> {
    const diagnosis = await this.diagnose();
    const lines: string[] = [];
    
    lines.push('=== 系統診斷報告 ===\n');
    
    // 瀏覽器資訊
    lines.push('📊 瀏覽器資訊:');
    lines.push(`  • ${diagnosis.performance.browser.name} ${diagnosis.performance.browser.version}`);
    lines.push(`  • 引擎: ${diagnosis.performance.browser.engine}`);
    lines.push('');
    
    // 系統效能
    lines.push('💻 系統效能:');
    lines.push(`  • GPU: ${diagnosis.performance.gpuTier}`);
    lines.push(`  • 記憶體: ${diagnosis.performance.memoryGB} GB`);
    lines.push(`  • CPU 核心: ${diagnosis.performance.cpuCores}`);
    lines.push('');
    
    // 功能支援
    lines.push('✨ 功能支援:');
    const supportedFeatures = Object.entries(diagnosis.supported)
      .filter(([key, value]) => value === true && key !== 'mediaRecorderMimes')
      .map(([key]) => key);
    supportedFeatures.forEach(feature => {
      lines.push(`  ✅ ${feature}`);
    });
    
    const unsupportedFeatures = Object.entries(diagnosis.supported)
      .filter(([key, value]) => value === false && key !== 'mediaRecorderMimes')
      .map(([key]) => key);
    if (unsupportedFeatures.length > 0) {
      lines.push('\n  不支援:');
      unsupportedFeatures.forEach(feature => {
        lines.push(`  ❌ ${feature}`);
      });
    }
    lines.push('');
    
    // 建議配置
    lines.push('🎯 建議配置:');
    lines.push(`  • 執行提供者: ${diagnosis.recommendation.executionProvider.join(' > ')}`);
    lines.push(`  • Whisper 後端: ${diagnosis.recommendation.whisperBackend}`);
    lines.push(`  • 模型大小: ${diagnosis.recommendation.modelSize}`);
    lines.push(`  • 音訊塊: ${diagnosis.recommendation.audioConfig.chunkMs}ms`);
    lines.push('');
    
    // 警告
    if (diagnosis.recommendation.warnings.length > 0) {
      lines.push('⚠️ 警告:');
      diagnosis.recommendation.warnings.forEach(warning => {
        lines.push(`  ${warning}`);
      });
      lines.push('');
    }
    
    // 提示
    if (diagnosis.recommendation.notes.length > 0) {
      lines.push('💡 提示:');
      diagnosis.recommendation.notes.forEach(note => {
        lines.push(`  ${note}`);
      });
      lines.push('');
    }
    
    // HTTP 標頭需求
    if (diagnosis.recommendation.headersNeeded) {
      lines.push('🔧 需要設置的 HTTP 標頭:');
      Object.entries(diagnosis.recommendation.headersNeeded).forEach(([header, value]) => {
        lines.push(`  ${header}: ${value}`);
      });
    }
    
    return lines.join('\n');
  }
}

// 匯出單例
export const systemDiagnostics = SystemDiagnostics.getInstance();