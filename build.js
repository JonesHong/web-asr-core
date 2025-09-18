import esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function build() {
  console.log('\n🚀 建構 WebASRCore 統一版本...\n');

  // 確保 dist 目錄存在
  const distPath = join(__dirname, 'dist');
  if (!existsSync(distPath)) {
    mkdirSync(distPath, { recursive: true });
  }

  // 複製必要的 WASM 檔案
  console.log('📦 複製 WASM 檔案...');
  const wasmFiles = [
    // 從 @huggingface/transformers 複製
    {
      source: 'node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs',
      dest: 'dist/ort-wasm-simd-threaded.jsep.mjs'
    },
    {
      source: 'node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm',
      dest: 'dist/ort-wasm-simd-threaded.jsep.wasm'
    },
    // 從 onnxruntime-web 複製備用檔案
    {
      source: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
      dest: 'dist/ort-wasm-simd-threaded.wasm'
    },
    {
      source: 'node_modules/onnxruntime-web/dist/ort-wasm-simd.wasm',
      dest: 'dist/ort-wasm-simd.wasm'
    },
    {
      source: 'node_modules/onnxruntime-web/dist/ort-wasm.wasm',
      dest: 'dist/ort-wasm.wasm'
    }
  ];

  for (const file of wasmFiles) {
    const sourcePath = join(__dirname, file.source);
    const destPath = join(__dirname, file.dest);

    if (existsSync(sourcePath)) {
      const destDir = dirname(destPath);
      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true });
      }
      copyFileSync(sourcePath, destPath);
      console.log(`  ✓ 複製 ${file.dest}`);
    } else {
      console.warn(`  ⚠ 找不到來源檔案: ${file.source}`);
    }
  }

  // 創建統一入口檔案內容（包含自動設定 WASM 路徑功能）
  const entryContent = `
// WebASRCore 統一版本 - 包含所有依賴和自動設定
import * as transformersMod from '@huggingface/transformers';
import * as ortMod from 'onnxruntime-web';

// 重新匯出主要 API
export * from './index.js';
import * as WebASRCoreAPI from './index.js';

// ===== 自動設定 WASM 路徑（在 bundle 載入時立即執行）=====
(() => {
  try {
    const g = globalThis || (typeof window !== 'undefined' ? window : global);

    // 1) 自動偵測 bundle 的位置
    let baseUrl = '';

    // 嘗試從 script 標籤取得路徑
    if (typeof document !== 'undefined') {
      const scriptTags = document.querySelectorAll('script[src*="web-asr-core"]');
      for (const script of scriptTags) {
        const src = script.src;
        if (src) {
          // 提取基礎路徑（移除檔名）
          baseUrl = src.substring(0, src.lastIndexOf('/') + 1);
          if (baseUrl.includes('unpkg.com') || baseUrl.includes('jsdelivr.net') || baseUrl.includes('cdn')) {
            console.log('[WebASRCore] 自動偵測 CDN 位置:', baseUrl);
          } else {
            console.log('[WebASRCore] 自動偵測本地位置:', baseUrl);
          }
          break;
        }
      }
    }

    // 如果沒找到，使用預設值
    if (!baseUrl) {
      baseUrl = '/dist/';
      console.log('[WebASRCore] 使用預設路徑:', baseUrl);
    }

    // 2) 確保路徑以 / 結尾
    if (!baseUrl.endsWith('/')) {
      baseUrl += '/';
    }

    // 3) 設定 Transformers.js 環境
    if (transformersMod && transformersMod.env) {
      const env = transformersMod.env;

      env.remoteHost = 'https://huggingface.co';
      env.remotePathTemplate = '{model}/resolve/{revision}/';
      env.allowLocalModels = true;
      env.localModelPath = '/models/';
      env.backends.onnx = env.backends.onnx || {};
      env.backends.onnx.wasm = env.backends.onnx.wasm || {};
      env.backends.onnx.wasm.wasmPaths = baseUrl;
      env.backends.onnx.wasm.simd = true;

      const numThreads = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency)
        ? navigator.hardwareConcurrency : 4;
      env.backends.onnx.wasm.numThreads = numThreads;

      // WebGPU 設定
      if (env.backends.onnx.webgpu) {
        const isWindows = (typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent));
        if (!isWindows) {
          env.backends.onnx.webgpu.powerPreference = 'high-performance';
        }
      }
    }

    // 4) 設定 ORT（VAD/WakeWord 使用）
    if (ortMod && ortMod.env && ortMod.env.wasm) {
      ortMod.env.wasm.wasmPaths = baseUrl;
      ortMod.env.wasm.simd = true;
      ortMod.env.wasm.numThreads =
        (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 4;

      if (ortMod.env.webgpu) {
        const isWindows = (typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent));
        if (!isWindows) ortMod.env.webgpu.powerPreference = 'high-performance';
      }
    }

    // 5) 設定全域 WebASRCore 內的實例
    if (g.WebASRCore) {
      if (g.WebASRCore.transformers && g.WebASRCore.transformers.env) {
        g.WebASRCore.transformers.env.backends = g.WebASRCore.transformers.env.backends || {};
        g.WebASRCore.transformers.env.backends.onnx = g.WebASRCore.transformers.env.backends.onnx || {};
        g.WebASRCore.transformers.env.backends.onnx.wasm = g.WebASRCore.transformers.env.backends.onnx.wasm || {};
        g.WebASRCore.transformers.env.backends.onnx.wasm.wasmPaths = baseUrl;
      }

      if (g.WebASRCore.ort && g.WebASRCore.ort.env) {
        g.WebASRCore.ort.env.wasm = g.WebASRCore.ort.env.wasm || {};
        g.WebASRCore.ort.env.wasm.wasmPaths = baseUrl;
      }
    }

    console.log('[WebASRCore] ✅ 載入完成 - WASM 路徑已自動設定');
  } catch (e) {
    console.error('[WebASRCore] 自動設定 WASM 路徑時發生錯誤:', e);
  }
})();

// 統一使用的單一實例
const g = globalThis || (typeof window !== 'undefined' ? window : global);
const transformers = (g.WebASRCore && g.WebASRCore.transformers) || g.transformers || transformersMod;
const ort = (g.WebASRCore && g.WebASRCore.ort) || g.ort || ortMod;

// 暴露到全域
g.WebASRCore = g.WebASRCore || {};
g.WebASRCore.transformers = transformers;
g.WebASRCore.ort = ort;
// 將所有 API 合併到 WebASRCore
Object.assign(g.WebASRCore, WebASRCoreAPI);
g.transformers = transformers;
g.ort = ort;

// 重新匯出單一實例和所有 API
export { transformers, ort };
export * from './index.js';
`;

  // 寫入臨時入口檔案
  const tempEntryPath = join(__dirname, 'src', 'entry.ts');
  writeFileSync(tempEntryPath, entryContent);

  // 建立 Worker bundle (不包含依賴)
  console.log('\n📦 建構 Worker...');
  await esbuild.build({
    entryPoints: ['src/workers/onnx-inference.worker.ts'],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    outfile: 'dist/onnx-inference.worker.js',
    loader: {
      '.ts': 'ts'
    },
    external: [],  // Worker 需要包含所有依賴
    plugins: [],
    define: {
      'process.env.NODE_ENV': '"production"'
    }
  });
  console.log('  ✓ 建立 onnx-inference.worker.js');

  try {
    // 建立主要 bundle
    console.log('\n📦 建構主要 Bundle...');
    await esbuild.build({
      entryPoints: [tempEntryPath],
      bundle: true,
      format: 'iife',
      globalName: 'WebASRCore',
      platform: 'browser',
      target: 'es2020',
      outfile: 'dist/web-asr-core.js',
      external: [],  // 包含所有依賴
      define: {
        'process.env.NODE_ENV': '"production"',
        'import.meta.url': 'undefined'
      },
      loader: {
        '.wasm': 'file'
      },
      plugins: [],
    });
    console.log('  ✓ 建立 web-asr-core.js');

    // 建立壓縮版本
    await esbuild.build({
      entryPoints: [tempEntryPath],
      bundle: true,
      format: 'iife',
      globalName: 'WebASRCore',
      platform: 'browser',
      target: 'es2020',
      outfile: 'dist/web-asr-core.min.js',
      external: [],
      minify: true,
      define: {
        'process.env.NODE_ENV': '"production"',
        'import.meta.url': 'undefined'
      },
      loader: {
        '.wasm': 'file'
      },
      plugins: [],
    });
    console.log('  ✓ 建立 web-asr-core.min.js');

    // 為了相容性，也創建 bundle.js（指向主要版本）
    await esbuild.build({
      entryPoints: [tempEntryPath],
      bundle: true,
      format: 'iife',
      globalName: 'WebASRCore',
      platform: 'browser',
      target: 'es2020',
      outfile: 'dist/web-asr-core.bundle.js',
      external: [],
      define: {
        'process.env.NODE_ENV': '"production"',
        'import.meta.url': 'undefined'
      },
      loader: {
        '.wasm': 'file'
      },
      plugins: [],
    });
    console.log('  ✓ 建立 web-asr-core.bundle.js（相容性）');

  } finally {
    // 清理臨時檔案
    try {
      unlinkSync(tempEntryPath);
    } catch (e) {
      // 忽略錯誤
    }
  }

  console.log('\n✅ 建構完成！\n');
  console.log('📦 產生的檔案：');
  console.log('  - dist/web-asr-core.js         (完整版)');
  console.log('  - dist/web-asr-core.min.js     (壓縮版)');
  console.log('  - dist/web-asr-core.bundle.js  (相容性)');
  console.log('  - dist/onnx-inference.worker.js');
  console.log('  - dist/*.wasm (WASM 檔案)');
  console.log('\n使用方式：');
  console.log('  CDN: <script src="https://unpkg.com/web-asr-core/dist/web-asr-core.min.js"></script>');
  console.log('  NPM: import * as WebASRCore from "web-asr-core"');
  console.log('\n');
}

build();