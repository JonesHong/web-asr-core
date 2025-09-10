import esbuild from 'esbuild';

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
    
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();