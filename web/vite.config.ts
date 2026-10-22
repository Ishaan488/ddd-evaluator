import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:4000' } },
  build: { outDir: 'dist', sourcemap: false },
  test: { include: ['src/**/*.test.ts'] },
});
