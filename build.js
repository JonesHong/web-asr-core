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
  // 創建特殊的入口點，包含 Transformers.js 並自動設定路徑
  const ultimateEntryContent = `
// WebASRCore Ultimate Edition - 包含所有依賴
import * as transformers from '@huggingface/transformers';

// 匯出原始的 WebASRCore
export * from './index.ts';

// 在瀏覽器環境中設定 transformers
if (typeof window !== 'undefined') {
  // 暴露 transformers 到全域
  window.transformers = transformers;

  // 自動設定 WASM 路徑
  function resolveBaseURL() {
    // 優先從 currentScript 取得
    const scriptSrc = document.currentScript?.src;
    if (scriptSrc) {
      return scriptSrc.substring(0, scriptSrc.lastIndexOf('/') + 1);
    }

    // 備用：從 import.meta.url（ESM）
    if (typeof import.meta !== 'undefined' && import.meta.url) {
      return new URL('./', import.meta.url).href;
    }

    // 最後備用：使用當前網址
    return window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
  }

  // 設定 transformers.js 環境
  const baseURL = resolveBaseURL();

  // 設定 ONNX Runtime WASM 路徑
  transformers.env.backends = transformers.env.backends || {};
  transformers.env.backends.onnx = transformers.env.backends.onnx || {};
  transformers.env.backends.onnx.wasm = transformers.env.backends.onnx.wasm || {};
  transformers.env.backends.onnx.wasm.wasmPaths = baseURL;

  // 設定其他環境變數
  transformers.env.allowLocalModels = false;
  transformers.env.allowRemoteModels = true;
  transformers.env.remoteURL = 'https://huggingface.co/';
  transformers.env.remoteHost = 'https://huggingface.co';
  transformers.env.remotePathTemplate = '{model}/resolve/{revision}/';

  console.log('[WebASRCore Ultimate] 已載入，WASM 路徑:', baseURL);
  console.log('[WebASRCore Ultimate] Transformers.js 已自動配置');
}
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
        '.wasm': 'file',
        '.mjs': 'js',
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
        '.wasm': 'file',
        '.mjs': 'js',
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