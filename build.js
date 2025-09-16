import esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Globals shim plugin to replace external dependencies with global variable access
const globalsShimPlugin = {
  name: 'globals-shim',
  setup(build) {
    // 把對 onnxruntime-web 的匯入改寫成從全域 ort 取值
    build.onResolve({ filter: /^onnxruntime-web$/ }, (args) => {
      return { path: args.path, namespace: 'globals-shim' };
    });
    // 把對 @xenova/transformers 的匯入改寫成從全域 transformers 取值
    build.onResolve({ filter: /^@xenova\/transformers$/ }, (args) => {
      return { path: args.path, namespace: 'globals-shim' };
    });

    build.onLoad({ filter: /.*/, namespace: 'globals-shim' }, (args) => {
      if (args.path === 'onnxruntime-web') {
        const contents = `
          const ort = (globalThis && (globalThis.ort || (globalThis.window && window.ort))) || null;
          if (!ort) throw new Error('Global "ort" not found. Make sure to include ort.min.js before loading the bundle.');
          export default ort;
          export const env = ort.env;
          export const InferenceSession = ort.InferenceSession;
          export const Tensor = ort.Tensor;
          export const SessionOptions = ort.SessionOptions;
        `;
        return { contents, loader: 'js' };
      }
      if (args.path === '@xenova/transformers') {
        const contents = `
          const transformers = (globalThis && (globalThis.transformers || (globalThis.window && window.transformers))) || null;
          if (!transformers) throw new Error('Global "transformers" not found. Load it (pipeline, env) before the bundle.');
          export default transformers;
          export const pipeline = transformers.pipeline;
          export const env = transformers.env;
        `;
        return { contents, loader: 'js' };
      }
      return null;
    });
  }
};

// Build configuration for browser bundle
const buildOptions = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',  // ES module format for modern browsers
  platform: 'browser',
  target: 'es2020',
  outfile: 'dist/web-asr-core.bundle.js',
  sourcemap: true,
  minify: false,  // Don't minify for easier debugging
  loader: {
    '.ts': 'ts'
  },
  external: [
    // These libraries will be loaded separately via CDN or script tags
    'onnxruntime-web',
    '@xenova/transformers'
  ],
  define: {
    'process.env.NODE_ENV': '"production"'
  }
};

// Build the bundle
async function build() {
  try {
    console.log('Building browser bundle...');
    await esbuild.build({
      ...buildOptions,
      // 關鍵：這個 bundle 透過 shim 使用全域，不能把依賴 external 留成裸匯入
      external: [],
      plugins: [globalsShimPlugin],
    });
    console.log('✅ Bundle created at dist/web-asr-core.bundle.js');

    // Build the worker with bundled dependencies
    console.log('\nBuilding worker bundle...');
    await esbuild.build({
      entryPoints: ['src/workers/onnx-inference.worker.ts'],
      bundle: true,
      format: 'iife',  // 改為 IIFE 格式，確保是 classic script
      platform: 'browser',
      target: 'es2022',
      outfile: 'dist/workers/onnx-inference.worker.js',
      sourcemap: true,
      define: {
        'process.env.NODE_ENV': '"production"'
      },
      // 關鍵：Worker 不使用 globals shim，直接 bundle ONNX Runtime
      external: [],
      plugins: [], // 移除 globalsShimPlugin，讓 Worker 直接 bundle onnxruntime-web
    });
    console.log('✅ Worker bundle created at dist/workers/onnx-inference.worker.js');

    // Also build a standalone version with dependencies included (larger file)
    console.log('\nBuilding standalone bundle with dependencies...');
    await esbuild.build({
      ...buildOptions,
      outfile: 'dist/web-asr-core.standalone.js',
      external: [], // Include all dependencies
      minify: true, // Minify the standalone version
      plugins: [],  // 關鍵：不要用 globalsShimPlugin
    });
    console.log('✅ Standalone bundle created at dist/web-asr-core.standalone.js');

    // Build UMD version for CDN usage (requires external dependencies)
    console.log('\nBuilding UMD bundle for CDN (requires external deps)...');
    await esbuild.build({
      entryPoints: ['src/index.ts'],
      bundle: true,
      format: 'iife',  // IIFE for browser global
      globalName: 'WebASRCore',  // Global variable name
      platform: 'browser',
      target: 'es2020',
      outfile: 'dist/web-asr-core.umd.js',
      sourcemap: true,
      minify: false,
      external: [],  // Bundle all dependencies for CDN
      plugins: [globalsShimPlugin],  // Use globals shim for smaller size
      define: {
        'process.env.NODE_ENV': '"production"'
      },
      footer: {
        js: `// UMD wrapper\nif (typeof module === 'object' && typeof module.exports === 'object') {\n  module.exports = WebASRCore;\n} else if (typeof define === 'function' && define.amd) {\n  define([], function() { return WebASRCore; });\n}`
      }
    });
    console.log('✅ UMD bundle created at dist/web-asr-core.umd.js');

    // Build minified UMD version (requires external dependencies)
    console.log('\nBuilding minified UMD bundle (requires external deps)...');
    await esbuild.build({
      entryPoints: ['src/index.ts'],
      bundle: true,
      format: 'iife',
      globalName: 'WebASRCore',
      platform: 'browser',
      target: 'es2020',
      outfile: 'dist/web-asr-core.umd.min.js',
      sourcemap: true,
      minify: true,  // Minified version
      external: [],
      plugins: [globalsShimPlugin],  // Use globals shim for smaller size
      define: {
        'process.env.NODE_ENV': '"production"'
      },
      footer: {
        js: `// UMD wrapper\nif (typeof module === 'object' && typeof module.exports === 'object') {\n  module.exports = WebASRCore;\n} else if (typeof define === 'function' && define.amd) {\n  define([], function() { return WebASRCore; });\n}`
      }
    });
    console.log('✅ Minified UMD bundle created at dist/web-asr-core.umd.min.js');

    // Build ALL-IN-ONE CDN version with dependencies included
    console.log('\nBuilding ALL-IN-ONE CDN bundle with all dependencies...');
    await esbuild.build({
      entryPoints: ['src/index.ts'],
      bundle: true,
      format: 'iife',
      globalName: 'WebASRCore',
      platform: 'browser',
      target: 'es2020',
      outfile: 'dist/web-asr-core.all.js',
      sourcemap: true,
      minify: false,
      external: [],  // Include ALL dependencies
      plugins: [],   // NO globals shim - bundle everything
      define: {
        'process.env.NODE_ENV': '"production"'
      },
      footer: {
        js: `// ALL-IN-ONE bundle - includes onnxruntime-web and transformers\nif (typeof module === 'object' && typeof module.exports === 'object') {\n  module.exports = WebASRCore;\n} else if (typeof define === 'function' && define.amd) {\n  define([], function() { return WebASRCore; });\n}`
      }
    });
    console.log('✅ ALL-IN-ONE CDN bundle created at dist/web-asr-core.all.js');

    // Build minified ALL-IN-ONE CDN version
    console.log('\nBuilding minified ALL-IN-ONE CDN bundle...');
    await esbuild.build({
      entryPoints: ['src/index.ts'],
      bundle: true,
      format: 'iife',
      globalName: 'WebASRCore',
      platform: 'browser',
      target: 'es2020',
      outfile: 'dist/web-asr-core.all.min.js',
      sourcemap: true,
      minify: true,
      external: [],  // Include ALL dependencies
      plugins: [],   // NO globals shim - bundle everything
      define: {
        'process.env.NODE_ENV': '"production"'
      },
      footer: {
        js: `// ALL-IN-ONE bundle - includes onnxruntime-web and transformers\nif (typeof module === 'object' && typeof module.exports === 'object') {\n  module.exports = WebASRCore;\n} else if (typeof define === 'function' && define.amd) {\n  define([], function() { return WebASRCore; });\n}`
      }
    });
    console.log('✅ Minified ALL-IN-ONE CDN bundle created at dist/web-asr-core.all.min.js');

    // 複製 ONNX Runtime sidecar 檔案
    console.log('\n複製 ONNX Runtime sidecar 檔案...');
    copyORTFiles();

    // 建立 ULTIMATE 版本 - 包含 Transformers.js
    console.log('\n建立 ULTIMATE 版本（包含 Transformers.js）...');
    await buildUltimateVersion();

  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

// 複製 ONNX Runtime sidecar 檔案到 dist/
function copyORTFiles() {
  // 確保 dist 目錄存在
  if (!existsSync('dist')) {
    mkdirSync('dist', { recursive: true });
  }

  const ortFiles = [
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

  for (const file of ortFiles) {
    const sourcePath = join(__dirname, file.source);
    const destPath = join(__dirname, file.dest);

    if (existsSync(sourcePath)) {
      try {
        copyFileSync(sourcePath, destPath);
        console.log(`  ✓ 複製 ${file.dest.split('/').pop()}`);
      } catch (err) {
        console.warn(`  ⚠ 無法複製 ${file.source}:`, err.message);
      }
    }
  }
}

// 建立 ULTIMATE 版本
async function buildUltimateVersion() {
  // 創建特殊的入口點，包含 Transformers.js 和 ONNX Runtime 並自動設定路徑
  const ultimateEntryContent = `
// WebASRCore Ultimate Edition - 自動設定 WASM 路徑版本
import * as transformersMod from '@huggingface/transformers';
import * as ortMod from 'onnxruntime-web';

// 重新匯出主要 API
export * from './index.ts';

// ===== 自動設定 WASM 路徑（在 bundle 載入時立即執行）=====
(function bootstrapWasmPaths() {
  try {
    // 1) 計算本 bundle 所在的絕對資料夾 URL
    let baseUrl = '';
    try {
      // 嘗試從 currentScript 取得
      if (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) {
        const scriptUrl = document.currentScript.src;
        baseUrl = scriptUrl.substring(0, scriptUrl.lastIndexOf('/') + 1);
      } else if (typeof location !== 'undefined') {
        // 使用頁面位置作為備用
        baseUrl = location.origin + location.pathname.substring(0, location.pathname.lastIndexOf('/') + 1);
      }
    } catch (e) {
      // 預設使用 CDN
      baseUrl = 'https://unpkg.com/web-asr-core@latest/dist/';
    }

    // 如果沒有取得 baseUrl，使用 CDN 作為備用
    if (!baseUrl) {
      baseUrl = 'https://unpkg.com/web-asr-core@latest/dist/';
    }

    console.log('[WebASRCore Ultimate] 自動偵測 Bundle 位置:', baseUrl);

    // 2) 取得全域實例
    const g = typeof globalThis !== 'undefined'
      ? globalThis
      : (typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : {}));

    // 3) 設定 Transformers.js 環境
    if (transformersMod && transformersMod.env) {
      const env = transformersMod.env;

      env.remoteHost = 'https://huggingface.co';
      env.remotePathTemplate = '{model}/resolve/{revision}/';
      env.allowLocalModels = false;
      env.allowRemoteModels = true;

      // 初始化巢狀結構
      env.backends = env.backends || {};
      env.backends.onnx = env.backends.onnx || {};
      env.backends.onnx.wasm = env.backends.onnx.wasm || {};

      // 🎯 使用「字首字串」而非物件對應 - ONNX 官方推薦做法
      // 這樣 ONNX 會自動附加檔名，最穩定
      env.backends.onnx.wasm.wasmPaths = baseUrl;

      // 設定其他 ONNX 參數
      env.backends.onnx.wasm.numThreads =
        (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 4;
      env.backends.onnx.wasm.simd = true;

      // ⚠️ 不要凍結路徑！讓庫能在不同環境自行調整
    }

    // 4) 設定 ORT（VAD/WakeWord 使用）- 同樣使用字首字串
    if (ortMod && ortMod.env && ortMod.env.wasm) {
      ortMod.env.wasm.wasmPaths = baseUrl; // 使用相同的字首字串
      ortMod.env.wasm.simd = true;
      ortMod.env.wasm.numThreads =
        (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 4;

      if (ortMod.env.webgpu) {
        const isWindows = (typeof navigator !== 'undefined' && /Windows/.test(navigator.userAgent));
        if (!isWindows) ortMod.env.webgpu.powerPreference = 'high-performance';
      }
    }

    // 5) 🎯 重要！同時設定全域 WebASRCore 內的兩個實例
    // 確保 WebASRCore.transformers 和 WebASRCore.ort 都使用正確路徑
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

    console.log('[WebASRCore Ultimate] ✅ 已載入 - 自動設定 WASM 路徑完成');
    console.log('[WebASRCore Ultimate] 📍 WASM 檔案位置:', baseUrl);

  } catch (e) {
    console.warn('[WebASRCore Ultimate] WASM 路徑設定警告:', e);
  }
})();

// 優先使用已存在的全域實例，避免雙重實例問題
const g = typeof globalThis !== 'undefined'
  ? globalThis
  : (typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : {}));

// 統一使用的單一實例（優先使用已存在的全域實例）
const transformers = (g.WebASRCore && g.WebASRCore.transformers) || g.transformers || transformersMod;
const ort = (g.WebASRCore && g.WebASRCore.ort) || g.ort || ortMod;

// 暴露到全域，確保外部頁面不會再載入另一份
g.WebASRCore = g.WebASRCore || {};
g.WebASRCore.transformers = transformers;
g.WebASRCore.ort = ort;
g.transformers = transformers;
g.ort = ort;

// 檢測是否有不同版本的實例（可選的警告）
if (g.transformers && transformersMod && g.transformers !== transformersMod) {
  try { console.warn('[WebASRCore Ultimate] 偵測到不同的 transformers 模組實例；使用全域單一實例。'); } catch {}
}
if (g.ort && ortMod && g.ort !== ortMod) {
  try { console.warn('[WebASRCore Ultimate] 偵測到不同的 onnxruntime-web 模組實例；使用全域單一實例。'); } catch {}
}

// 重新匯出解析後的單一實例
export { transformers, ort };
`;

  // 寫入臨時入口檔案
  const tempEntryPath = join(__dirname, 'src', 'ultimate-entry.ts');
  writeFileSync(tempEntryPath, ultimateEntryContent);

  try {
    // 建立 ULTIMATE IIFE 版本
    await esbuild.build({
      entryPoints: [tempEntryPath],
      bundle: true,
      format: 'iife',
      globalName: 'WebASRCore',
      platform: 'browser',
      target: 'es2020',
      outfile: 'dist/web-asr-core.ultimate.js',
      external: [],  // 不設定任何 external，全部打包
      define: {
        'process.env.NODE_ENV': '"production"',
        'import.meta.url': 'undefined'  // 避免 import.meta 錯誤
      },
      loader: {
        '.wasm': 'file'
      },
      plugins: [],
    });
    console.log('  ✓ 建立 web-asr-core.ultimate.js');

    // 建立壓縮版本
    await esbuild.build({
      entryPoints: [tempEntryPath],
      bundle: true,
      format: 'iife',
      globalName: 'WebASRCore',
      platform: 'browser',
      target: 'es2020',
      outfile: 'dist/web-asr-core.ultimate.min.js',
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
    console.log('  ✓ 建立 web-asr-core.ultimate.min.js');

  } finally {
    // 清理臨時檔案
    try {
      unlinkSync(tempEntryPath);
    } catch (e) {
      // 忽略錯誤
    }
  }
}

build();