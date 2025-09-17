import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    open: true,
    cors: true,
    // 配置代理以訪問根目錄的模型檔案
    proxy: {
      '/models': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/worklets': {
        target: 'http://localhost:8000',
        changeOrigin: true
      },
      '/dist': {
        target: 'http://localhost:8000',
        changeOrigin: true
      }
    }
  },
  optimizeDeps: {
    include: ['web-asr-core', 'onnxruntime-web']
  }
});