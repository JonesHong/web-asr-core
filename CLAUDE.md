# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WebASRCore is a stateless TypeScript library providing browser-based speech processing services including VAD (Voice Activity Detection), wake word detection, and speech recognition using Whisper. The entire processing runs in the browser using WebAssembly and ONNX Runtime.

## Development Commands

### Build & Development
```bash
# TypeScript compilation
npm run build          # Compile TypeScript to JavaScript
npm run dev           # Watch mode for development
npm run clean         # Clean build artifacts

# Bundle creation
npm run bundle        # Create browser bundle using esbuild
npm run build:all     # Build TypeScript + create bundle

# Local development server (no build process needed for testing)
python3 -m http.server 8000   # Serve static files for testing
```

### Testing & Validation
No automated tests are currently configured. Manual testing is done through HTML test pages:
- `test-audioworklet.html` - AudioWorklet vs ScriptProcessor comparison
- `test-webgpu.html` - WebGPU acceleration testing  
- `test-onnx-performance.html` - ONNX Runtime performance benchmarking

## Architecture & Core Concepts

### Stateless Functional Design
All services follow a pure functional pattern:
1. **Resources**: Model sessions loaded once and reused (e.g., `InferenceSession`, `Pipeline`)
2. **State**: Maintained by caller, passed between function calls (e.g., `VadState`, `WakewordState`)
3. **Processing**: Pure functions with signature `(resources, state, input, params) → { result, newState }`
4. **No side effects**: No global state or internal mutations

### Service Layer Organization

```
src/
├── services/           # Core processing services
│   ├── vad.ts         # Voice Activity Detection using Silero VAD
│   ├── wakeword.ts    # Wake word detection (Hey Jarvis, Alexa, etc.)
│   ├── whisper.ts     # Speech recognition via transformers.js
│   └── ort.ts         # ONNX Runtime optimization service
├── runtime/           
│   └── ort.ts         # ONNX Runtime Web wrapper
├── workers/
│   └── onnx-inference.worker.ts  # Web Worker for model inference
├── registry/
│   └── registry.ts    # Model registry management
├── types/             # TypeScript type definitions
└── utils/
    └── config-manager.ts  # Centralized configuration
```

### Model Processing Pipeline

#### VAD Processing
- **Input**: 512 samples @ 16kHz (32ms chunks)
- **Context**: Maintains 64 samples from previous chunk
- **State**: LSTM state [2, 1, 128] + context samples + hangover counter
- **Output**: Speech detection score and updated state

#### Wake Word Processing  
- **Input**: 1280 samples @ 16kHz (80ms chunks)
- **Three-stage pipeline**: Melspectrogram → Embedding → Detection
- **State**: Embedding buffer (32 frames x 96 dims) with rolling updates
- **Output**: Detection score per wake word and updated state

#### Whisper Processing
- **Input**: Variable length audio @ 16kHz
- **Uses**: transformers.js with automatic-speech-recognition pipeline
- **Supports**: Multiple languages, quantized models, WebGPU acceleration

### Performance Optimization Features

#### ONNX Runtime Optimizations
- **WebGPU Support**: Automatically enabled when available (2-10x speedup)
- **Web Worker Execution**: Offloads inference to background thread
- **Model Preloading**: Reduces first inference latency
- **Execution Provider Priority**: WebGPU → WASM SIMD → WASM

#### Audio Processing
- **AudioWorklet**: Low-latency audio processing (replaces deprecated ScriptProcessorNode)
- **Sample Rate**: Fixed at 16kHz throughout pipeline
- **Chunk Sizes**: Optimized for model requirements (512 for VAD, 1280 for wake word)

### Configuration Management

The `ConfigManager` class provides centralized configuration:
- VAD parameters (threshold, window size, hangover frames)
- Wake word settings (per-model thresholds, embedding dimensions)
- Whisper options (temperature, max length, quantization)
- ONNX Runtime settings (execution providers, WebGPU options, Web Worker usage)

### Model Registry System

Models are managed through `global_registry.json`:
- Defines available models and their paths
- Supports multiple sources (HuggingFace, GitHub, local)
- Handles model resolution and path construction
- Separate registry for GitHub Pages deployment (`global_registry_github.json`)

## Critical Implementation Details

### Audio Input Requirements
- **Sample Rate**: Must be 16kHz
- **Format**: Float32Array, mono channel
- **Browser Settings**: Disable echo cancellation, noise suppression, and auto gain control for raw audio

### State Management Pattern
```typescript
// 1. Load resources once
const resources = await loadResources();

// 2. Create initial state
let state = createInitialState();

// 3. Process in loop
while (processing) {
  const result = await process(resources, state, input, params);
  state = result.state;  // Update state for next iteration
  // Use result.detected, result.score, etc.
}
```

### Web Worker Integration
When `config.onnx.useWebWorker` is enabled:
1. Models are preloaded in worker during initialization
2. Inference requests are queued and processed asynchronously
3. Automatic fallback to main thread on worker failure
4. Supports parallel processing of multiple requests

### Browser Compatibility Considerations
- **Chrome/Edge**: Full support including Web Speech API
- **Firefox**: Limited Web Speech API, Whisper works
- **Safari**: Experimental support, some features may be limited
- **Required APIs**: WebAssembly, AudioWorklet, Web Worker, MediaRecorder

## Common Issues & Solutions

### Audio Scaling Issues
If wake word triggers on silence with high scores:
1. Verify browser audio processing is disabled
2. Check audio levels (normal speech should have maxAbs > 0.01)
3. Validate dBFS is between -40 and -20 during speech

### Model Loading Failures
- Check CORS headers if loading from external sources
- Verify model files exist at specified paths
- Ensure `global_registry.json` is properly configured
- For GitHub Pages, use `global_registry_github.json` with quantized models

### Performance Issues
- Enable WebGPU if available (`config.onnx.webgpu.enabled = true`)
- Use Web Workers (`config.onnx.useWebWorker = true`)
- Consider using quantized models for faster loading
- Reduce Whisper model size if transcription is slow