import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      // register ผ่าน main.ts (virtual:pwa-register) → ไม่ต้องมี inline script (CSP เข้มได้)
      injectRegister: false,
      includeAssets: ['icons/favicon-32.png', 'icons/apple-touch-icon-180.png'],
      manifest: {
        name: 'Money Flow — บันทึกรายรับรายจ่าย',
        short_name: 'Money Flow',
        description: 'บันทึกรายรับรายจ่าย ดูยอดคงเหลือ และวิเคราะห์การใช้เงิน',
        lang: 'th',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f6f7f9',
        theme_color: '#0f766e',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // app shell เท่านั้น — ข้อมูลการเงินไม่ cache ใน SW (ใช้ outbox ใน IndexedDB แทน)
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
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
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
  },
});
