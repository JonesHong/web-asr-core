import { ConfigManager } from '../utils/config-manager';
import { AudioResampler, ResamplingAlgorithm } from './audio-resampler';

/**
 * 音訊裝置資訊
 */
export interface AudioDeviceInfo {
    /** 裝置 ID */
    deviceId: string;
    /** 裝置標籤（名稱） */
    label: string;
    /** 裝置類型 */
    kind: 'audioinput' | 'audiooutput';
    /** 群組 ID（相同物理裝置的不同端口） */
    groupId: string;
    /** 是否為預設裝置 */
    isDefault?: boolean;
}

/**
 * 音訊擷取選項
 */
export interface AudioCaptureOptions {
    /** 裝置 ID（可選，不指定則使用預設） */
    deviceId?: string;
    /** 目標採樣率 */
    sampleRate?: number;
    /** 聲道數 */
    channelCount?: number;
    /** 是否關閉回音消除 */
    echoCancellation?: boolean;
    /** 是否關閉噪音抑制 */
    noiseSuppression?: boolean;
    /** 是否關閉自動增益控制 */
    autoGainControl?: boolean;
    /** 緩衝區大小（ScriptProcessor 用） */
    bufferSize?: number;
    /** 是否使用 AudioWorklet（優先） */
    useAudioWorklet?: boolean;
}

/**
 * 音訊資料回調函數
 */
export type AudioDataCallback = (audioData: Float32Array, timestamp: number) => void;

/**
 * 音訊擷取狀態
 */
export interface CaptureState {
    /** 是否正在擷取 */
    isCapturing: boolean;
    /** 當前裝置 ID */
    currentDeviceId?: string;
    /** 實際採樣率 */
    actualSampleRate?: number;
    /** 實際聲道數 */
    actualChannelCount?: number;
    /** 已擷取的樣本總數 */
    totalSamples: number;
    /** 開始時間 */
    startTime?: number;
}

/**
 * AudioCapture - 麥克風音訊擷取服務
 * 
 * 提供完整的麥克風管理功能：
 * - 列舉所有音訊輸入裝置
 * - 選擇特定麥克風
 * - 擷取原始音訊資料
 * - 自動重採樣到目標採樣率
 * - 支援 AudioWorklet 和 ScriptProcessor
 */
export class AudioCapture {
    private config: ConfigManager;
    private audioContext?: AudioContext;
    private mediaStream?: MediaStream;
    private sourceNode?: MediaStreamAudioSourceNode;
    private processorNode?: AudioWorkletNode | ScriptProcessorNode;
    private resampler: AudioResampler;
    private callbacks: Set<AudioDataCallback> = new Set();
    private state: CaptureState = {
        isCapturing: false,
        totalSamples: 0
    };
    private audioWorkletLoaded: boolean = false;
    
    constructor(config: ConfigManager = ConfigManager.getInstance()) {
        this.config = config;
        this.resampler = new AudioResampler(config);
    }
    
    /**
     * 獲取所有音訊輸入裝置列表
     * @returns 音訊裝置資訊陣列
     */
    async getAudioDevices(): Promise<AudioDeviceInfo[]> {
        // 先請求權限（必要，否則 label 會是空的）
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
            console.warn('無法獲取麥克風權限:', e);
        }
        
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices
            .filter(device => device.kind === 'audioinput')
            .map(device => ({
                deviceId: device.deviceId,
                label: device.label || `麥克風 ${device.deviceId.substring(0, 8)}`,
                kind: device.kind as 'audioinput',
                groupId: device.groupId,
                isDefault: device.deviceId === 'default'
            }));
        
        return audioInputs;
    }
    
    /**
     * 獲取預設麥克風
     */
    async getDefaultDevice(): Promise<AudioDeviceInfo | null> {
        const devices = await this.getAudioDevices();
        return devices.find(d => d.isDefault || d.deviceId === 'default') || devices[0] || null;
    }
    
    /**
     * 開始音訊擷取
     * @param options 擷取選項
     */
    async startCapture(options: AudioCaptureOptions = {}): Promise<void> {
        if (this.state.isCapturing) {
            console.warn('音訊擷取已在進行中');
            return;
        }
        
        // 設定預設選項
        const finalOptions: AudioCaptureOptions = {
            sampleRate: 16000,
            channelCount: 1,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            bufferSize: 2048,
            useAudioWorklet: true,
            ...options
        };
        
        try {
            // 建立音訊約束
            const constraints: MediaStreamConstraints = {
                audio: {
                    deviceId: finalOptions.deviceId ? { exact: finalOptions.deviceId } : undefined,
                    sampleRate: finalOptions.sampleRate,
                    channelCount: finalOptions.channelCount,
                    echoCancellation: finalOptions.echoCancellation,
                    noiseSuppression: finalOptions.noiseSuppression,
                    autoGainControl: finalOptions.autoGainControl
                }
            };
            
            // 獲取媒體串流
            this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
            
            // 創建或重用 AudioContext
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            }
            
            // 如果 AudioContext 被暫停，恢復它
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            
            // 創建音訊源節點
            this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
            
            // 獲取實際的音訊設定
            const audioTrack = this.mediaStream.getAudioTracks()[0];
            const actualSettings = audioTrack.getSettings();
            
            // 更新狀態
            this.state = {
                isCapturing: true,
                currentDeviceId: actualSettings.deviceId || finalOptions.deviceId,
                actualSampleRate: actualSettings.sampleRate || this.audioContext.sampleRate,
                actualChannelCount: actualSettings.channelCount || 1,
                totalSamples: 0,
                startTime: Date.now()
            };
            
            // 創建處理節點
            if (finalOptions.useAudioWorklet && this.audioContext.audioWorklet) {
                await this.createAudioWorkletProcessor(finalOptions);
            } else {
                this.createScriptProcessor(finalOptions);
            }
            
            // 連接節點
            this.sourceNode.connect(this.processorNode!);
            // 注意：不連接到 destination，避免回音
            // this.processorNode!.connect(this.audioContext.destination);
            
        } catch (error) {
            this.state.isCapturing = false;
            throw new Error(`無法開始音訊擷取: ${error}`);
        }
    }
    
    /**
     * 創建 AudioWorklet 處理器
     */
    private async createAudioWorkletProcessor(options: AudioCaptureOptions): Promise<void> {
        if (!this.audioContext) return;
        
        // 載入 AudioWorklet（如果尚未載入）
        if (!this.audioWorkletLoaded) {
            const workletCode = `
                class AudioCaptureProcessor extends AudioWorkletProcessor {
                    constructor() {
                        super();
                        this.bufferSize = 128; // AudioWorklet 固定大小
                    }
                    
                    process(inputs, outputs, parameters) {
                        const input = inputs[0];
                        if (input && input.length > 0) {
                            const channelData = input[0];
                            // 發送資料到主線程
                            this.port.postMessage({
                                type: 'audio-data',
                                data: channelData,
                                timestamp: currentTime
                            });
                        }
                        return true; // 保持處理器活躍
                    }
                }
                
                registerProcessor('audio-capture-processor', AudioCaptureProcessor);
            `;
            
            const blob = new Blob([workletCode], { type: 'application/javascript' });
            const workletUrl = URL.createObjectURL(blob);
            await this.audioContext.audioWorklet.addModule(workletUrl);
            URL.revokeObjectURL(workletUrl);
            this.audioWorkletLoaded = true;
        }
        
        // 創建 AudioWorkletNode
        const workletNode = new AudioWorkletNode(
            this.audioContext,
            'audio-capture-processor'
        );
        
        // 設定訊息處理
        workletNode.port.onmessage = (event) => {
            if (event.data.type === 'audio-data') {
                this.processAudioData(
                    new Float32Array(event.data.data),
                    event.data.timestamp
                );
            }
        };
        
        this.processorNode = workletNode;
    }
    
    /**
     * 創建 ScriptProcessor（降級方案）
     */
    private createScriptProcessor(options: AudioCaptureOptions): void {
        if (!this.audioContext) return;
        
        const processor = this.audioContext.createScriptProcessor(
            options.bufferSize || 2048,
            1, // 輸入聲道
            1  // 輸出聲道
        );
        
        processor.onaudioprocess = (event) => {
            const inputData = event.inputBuffer.getChannelData(0);
            const timestamp = event.timeStamp;
            this.processAudioData(inputData, timestamp);
        };
        
        this.processorNode = processor;
    }
    
    /**
     * 處理音訊資料
     */
    private async processAudioData(audioData: Float32Array, timestamp: number): Promise<void> {
        if (!this.state.isCapturing) return;
        
        // 更新統計
        this.state.totalSamples += audioData.length;
        
        // 重採樣到目標採樣率（如果需要）
        let processedData = audioData;
        if (this.state.actualSampleRate && this.state.actualSampleRate !== 16000) {
            processedData = this.resampler.resampleTo16kHz(
                audioData,
                this.state.actualSampleRate
            );
        }
        
        // 觸發所有回調
        this.callbacks.forEach(callback => {
            try {
                callback(processedData, timestamp);
            } catch (error) {
                console.error('音訊回調錯誤:', error);
            }
        });
    }
    
    /**
     * 停止音訊擷取
     */
    stopCapture(): void {
        if (!this.state.isCapturing) return;
        
        // 斷開連接
        if (this.processorNode) {
            this.processorNode.disconnect();
            this.processorNode = undefined;
        }
        
        if (this.sourceNode) {
            this.sourceNode.disconnect();
            this.sourceNode = undefined;
        }
        
        // 停止媒體串流
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = undefined;
        }
        
        // 更新狀態
        this.state.isCapturing = false;
    }
    
    /**
     * 暫停音訊擷取（保持連接但停止處理）
     */
    pause(): void {
        if (!this.state.isCapturing) return;
        
        if (this.sourceNode && this.processorNode) {
            try {
                this.sourceNode.disconnect(this.processorNode);
            } catch (e) {
                // 忽略斷開錯誤
            }
        }
        
        this.state.isCapturing = false;
    }
    
    /**
     * 恢復音訊擷取
     */
    resume(): void {
        if (this.state.isCapturing) return;
        
        if (this.sourceNode && this.processorNode) {
            this.sourceNode.connect(this.processorNode);
            this.state.isCapturing = true;
        }
    }
    
    /**
     * 註冊音訊資料回調
     * @param callback 回調函數
     */
    onAudioData(callback: AudioDataCallback): void {
        this.callbacks.add(callback);
    }
    
    /**
     * 移除音訊資料回調
     * @param callback 回調函數
     */
    offAudioData(callback: AudioDataCallback): void {
        this.callbacks.delete(callback);
    }
    
    /**
     * 清除所有回調
     */
    clearCallbacks(): void {
        this.callbacks.clear();
    }
    
    /**
     * 獲取當前擷取狀態
     */
    getState(): CaptureState {
        return { ...this.state };
    }
    
    /**
     * 獲取擷取統計資訊
     */
    getStats(): {
        isCapturing: boolean;
        duration: number;
        totalSamples: number;
        sampleRate?: number;
        deviceLabel?: string;
    } {
        const duration = this.state.startTime 
            ? (Date.now() - this.state.startTime) / 1000 
            : 0;
        
        return {
            isCapturing: this.state.isCapturing,
            duration,
            totalSamples: this.state.totalSamples,
            sampleRate: this.state.actualSampleRate,
            deviceLabel: this.state.currentDeviceId
        };
    }
    
    /**
     * 切換麥克風裝置
     * @param deviceId 新裝置 ID
     */
    async switchDevice(deviceId: string): Promise<void> {
        const wasCapturing = this.state.isCapturing;
        
        if (wasCapturing) {
            this.stopCapture();
        }
        
        await this.startCapture({ deviceId });
    }
    
    /**
     * 監聽裝置變更
     */
    onDeviceChange(callback: (devices: AudioDeviceInfo[]) => void): void {
        navigator.mediaDevices.addEventListener('devicechange', async () => {
            const devices = await this.getAudioDevices();
            callback(devices);
        });
    }
    
    /**
     * 釋放所有資源
     */
    dispose(): void {
        this.stopCapture();
        this.clearCallbacks();
        
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = undefined;
        }
        
        this.audioWorkletLoaded = false;
    }
    
    /**
     * 檢查瀏覽器相容性
     */
    static checkBrowserSupport(): {
        getUserMedia: boolean;
        audioContext: boolean;
        audioWorklet: boolean;
        mediaRecorder: boolean;
    } {
        return {
            getUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
            audioContext: !!(window.AudioContext || (window as any).webkitAudioContext),
            audioWorklet: !!(window.AudioContext && AudioContext.prototype.audioWorklet),
            mediaRecorder: !!(window.MediaRecorder)
        };
    }
}

/**
 * 單例實例
 */
let captureInstance: AudioCapture | null = null;

/**
 * 獲取全域音訊擷取實例
 */
export function getAudioCapture(): AudioCapture {
    if (!captureInstance) {
        captureInstance = new AudioCapture();
    }
    return captureInstance;
}

/**
 * 便利函數：快速開始擷取
 */
export async function startAudioCapture(
    callback: AudioDataCallback,
    options?: AudioCaptureOptions
): Promise<AudioCapture> {
    const capture = getAudioCapture();
    capture.onAudioData(callback);
    await capture.startCapture(options);
    return capture;
}

/**
 * 便利函數：列出所有麥克風
 */
export async function listMicrophones(): Promise<AudioDeviceInfo[]> {
    const capture = getAudioCapture();
    return capture.getAudioDevices();
}

export default AudioCapture;