import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// ไม่ใช้ PWA/service worker แล้ว — public/sw.js เป็นตัวล้าง SW เก่าบนเครื่องผู้ใช้เท่านั้น
export default defineConfig({
  plugins: [vue()],
  server: { port: 5173, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        // แยก aws-amplify ออกเป็น chunk ของตัวเอง (cache ได้นานเมื่อแอปเปลี่ยน)
        manualChunks: (id) => (id.includes('node_modules/@aws-amplify') ? 'amplify' : undefined),
      },
    },
  },
  test: {
    environment: 'happy-dom',
    globals: false,
    include: ['src/**/__tests__/**/*.spec.ts'],
    restoreMocks: true,
  },
})
