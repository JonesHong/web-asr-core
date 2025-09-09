/**
 * Audio Worklet Processor for real-time audio processing
 * Replaces the deprecated ScriptProcessorNode with AudioWorkletNode
 */

class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        
        // Initialize buffers
        this.vadBuffer = [];
        this.wakewordBuffer = [];
        this.vadChunkSize = 512; // 32ms at 16kHz for VAD
        this.wakewordChunkSize = 1280; // 80ms at 16kHz for WakeWord
        
        // Handle messages from main thread
        this.port.onmessage = (event) => {
            if (event.data.type === 'configure') {
                if (event.data.vadChunkSize) {
                    this.vadChunkSize = event.data.vadChunkSize;
                }
                if (event.data.wakewordChunkSize) {
                    this.wakewordChunkSize = event.data.wakewordChunkSize;
                }
            }
        };
    }
    
    /**
     * Simple downsampling function to resample audio to 16kHz
     */
    resampleTo16kHz(inputData, inputSampleRate) {
        if (inputSampleRate === 16000) {
            return inputData;
        }
        
        const ratio = inputSampleRate / 16000;
        const outputLength = Math.floor(inputData.length / ratio);
        const result = new Float32Array(outputLength);
        
        for (let i = 0; i < outputLength; i++) {
            const index = Math.floor(i * ratio);
            result[i] = inputData[index];
        }
        
        return result;
    }
    
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        
        // 不要將音訊傳遞到輸出以避免回音
        // 只處理輸入音訊，不輸出任何聲音
        if (input.length > 0) {
            const inputChannel = input[0];
            
            // 如果需要監聽，可以選擇性地啟用 passthrough
            // 但預設關閉以避免回音
            const enablePassthrough = false;
            
            if (enablePassthrough && outputs[0].length > 0) {
                const outputChannel = outputs[0][0];
                for (let i = 0; i < inputChannel.length; i++) {
                    outputChannel[i] = inputChannel[i] * 0.1; // 降低音量避免回授
                }
            }
            
            // Resample to 16kHz
            const resampled = this.resampleTo16kHz(inputChannel, sampleRate);
            
            // Accumulate audio data to both buffers
            for (let i = 0; i < resampled.length; i++) {
                this.vadBuffer.push(resampled[i]);
                this.wakewordBuffer.push(resampled[i]);
            }
            
            // Process VAD chunks (512 samples)
            while (this.vadBuffer.length >= this.vadChunkSize) {
                const vadChunk = new Float32Array(this.vadBuffer.slice(0, this.vadChunkSize));
                this.vadBuffer = this.vadBuffer.slice(this.vadChunkSize);
                
                // Send VAD chunk to main thread
                this.port.postMessage({
                    type: 'vad',
                    data: vadChunk
                });
            }
            
            // Process Wakeword chunks (1280 samples)
            while (this.wakewordBuffer.length >= this.wakewordChunkSize) {
                const wakewordChunk = new Float32Array(this.wakewordBuffer.slice(0, this.wakewordChunkSize));
                this.wakewordBuffer = this.wakewordBuffer.slice(this.wakewordChunkSize);
                
                // Send wakeword chunk to main thread
                this.port.postMessage({
                    type: 'wakeword',
                    data: wakewordChunk
                });
            }
        }
        
        // Keep processor alive
        return true;
    }
}

// Register the processor
registerProcessor('audio-processor', AudioProcessor);