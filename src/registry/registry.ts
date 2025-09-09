/**
 * Model registry module for loading and resolving model configurations
 */

import type { Registry, WhisperModelInfo, WakewordInfo, VadInfo } from '../types';

/**
 * Load registry from JSON file
 */
export async function loadRegistry(url = './models/global_registry.json'): Promise<Registry> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load registry: ${response.status}`);
  }
  return await response.json();
}

/**
 * Resolve wake word model configuration
 */
export function resolveWakeword(registry: Registry, defaultId = 'hey-jarvis'): WakewordInfo {
  // Find wake word models
  const models = registry.models.filter(m => m.type === 'wakeword');
  
  if (models.length === 0) {
    throw new Error('No wake word models found in registry');
  }
  
  // Find the chosen model
  const chosen = models.find(m => m.id === defaultId) || models[0];
  
  // Get base path
  const base = 'models/' + chosen.local_path;
  
  // Determine directory (if base is .onnx file, get its directory)
  const dir = base.endsWith('.onnx') 
    ? base.substring(0, base.lastIndexOf('/')) 
    : base;
  
  // Find embedding and melspectrogram files
  const embeddingFile = chosen.files?.required?.find(f => f.includes('embedding'));
  const melFile = chosen.files?.required?.find(f => f.includes('melspectrogram'));
  
  if (!embeddingFile || !melFile) {
    throw new Error('Required embedding or melspectrogram files not found in wake word model');
  }
  
  return {
    id: chosen.id,
    detectorUrl: base,
    threshold: chosen.specs?.threshold ?? 0.5,
    embeddingUrl: `${dir}/${embeddingFile}`,
    melspecUrl: `${dir}/${melFile}`,
  };
}

/**
 * Resolve VAD model configuration
 */
export function resolveVad(registry: Registry): VadInfo {
  const vad = registry.models.find(m => m.type === 'vad');
  
  if (!vad) {
    throw new Error('No VAD model found in registry');
  }
  
  return { 
    id: vad.id, 
    modelUrl: 'models/' + vad.local_path 
  };
}

/**
 * Resolve Whisper model configuration
 */
export function resolveWhisper(registry: Registry, defaultId = 'whisper-base'): WhisperModelInfo {
  const asrs = registry.models.filter(m => m.type === 'asr');
  
  if (asrs.length === 0) {
    throw new Error('No ASR/Whisper models found in registry');
  }
  
  const chosen = asrs.find(m => m.id === defaultId) || asrs[0];
  
  return { 
    id: chosen.id, 
    path: 'models/' + chosen.local_path,
    quantized: chosen.specs?.quantized ?? true,
    name: chosen.name 
  };
}

/**
 * Get all available models of a specific type
 */
export function getAvailableModels(registry: Registry, type: 'vad' | 'wakeword' | 'asr'): Array<{ id: string; name?: string }> {
  return registry.models
    .filter(m => m.type === type)
    .map(m => ({ id: m.id, name: m.name }));
}