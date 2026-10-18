import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 依赖隔离：前端独立构建，产物输出到后端静态目录。
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../src/web/dist',
    emptyOutDir: true,
  },
  server: {
    port: 5518,
    proxy: {
      '/api': 'http://localhost:9178',
    },
  },
});
