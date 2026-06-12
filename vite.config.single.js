import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 단일 HTML 산출물 — 서버 없이 파일을 더블클릭해 바로 실행 가능
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist-single',
    chunkSizeWarningLimit: 2000
  }
});
