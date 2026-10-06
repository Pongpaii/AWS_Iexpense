import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  server: { port: 5173, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsDir: 'assets',
  },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
  },
});
