import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      // register ผ่าน main.ts (virtual:pwa-register) → ไม่ต้องมี inline script (CSP เข้มได้)
      injectRegister: false,
      // ใช้ public/manifest.webmanifest ของหน้าจอเดิม
      manifest: false,
      workbox: {
        // app shell เท่านั้น — ข้อมูลการเงินไม่ cache ใน SW
        globPatterns: ['**/*.{html,js,css,svg,png,ico,webmanifest,woff2}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
      devOptions: { enabled: false },
    }),
  ],
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
