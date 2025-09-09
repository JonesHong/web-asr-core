import esbuild from 'esbuild';

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
    await esbuild.build(buildOptions);
    console.log('✅ Bundle created at dist/web-asr-core.bundle.js');
    
    // Also build a standalone version with dependencies included (larger file)
    console.log('\nBuilding standalone bundle with dependencies...');
    await esbuild.build({
      ...buildOptions,
      outfile: 'dist/web-asr-core.standalone.js',
      external: [], // Include all dependencies
      minify: true  // Minify the standalone version
    });
    console.log('✅ Standalone bundle created at dist/web-asr-core.standalone.js');
    
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();