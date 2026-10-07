import { createApp, h } from 'vue'
import App from './App.vue'
import ErrorBoundary from './components/ErrorBoundary.vue'
import { initializeAccentTone } from './composables/useAccentTone'
import { initMonitoring, reportError } from './lib/monitoring'
import '@fontsource/manrope/400.css'
import '@fontsource/manrope/500.css'
import '@fontsource/manrope/600.css'
import '@fontsource/manrope/700.css'
import '@fontsource/manrope/800.css'
import '@fontsource/noto-sans-thai/400.css'
import '@fontsource/noto-sans-thai/500.css'
import '@fontsource/noto-sans-thai/600.css'
import '@fontsource/noto-sans-thai/700.css'
import './style.css'

// ทาสีที่ผู้ใช้เลือกไว้ก่อน Vue render เพื่อไม่ให้เห็นสีเริ่มต้นแวบหนึ่ง
initializeAccentTone()

// ครอบ App ด้วย ErrorBoundary ที่ระดับ root: ถ้า component ไหนพังกลางทาง
// ผู้ใช้จะเห็นการ์ดบอกวิธีแก้ ไม่ใช่หน้าจอขาวเปล่า ๆ
const app = createApp({
  name: 'MoneyFlowRoot',
  render: () => h(ErrorBoundary, null, { default: () => h(App) }),
})

// onErrorCaptured จับได้แค่ error ที่เกิดในลูกของ boundary
// errorHandler จับที่เหลือของ Vue
app.config.errorHandler = (error, _instance, info) => {
  console.error('[vue:error]', info, error)
  reportError(error, { source: 'vue:errorHandler', info })
}

app.config.warnHandler = (message, _instance, trace) => {
  if (import.meta.env.DEV) console.warn('[vue:warn]', message, trace)
}

// Promise ที่ reject ทิ้งไว้ไม่ผ่าน Vue จึงต้องดักแยก
window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandledrejection]', event.reason)
  reportError(event.reason, { source: 'unhandledrejection' })
})

window.addEventListener('error', (event) => {
  reportError(event.error ?? event.message, { source: 'window:error' })
})

// ไม่ await: monitoring เป็นของเสริม อย่าให้การแสดงหน้าจอต้องรอ network
void initMonitoring(app)

app.mount('#app')

// เลิกใช้ PWA: ถอน service worker เก่าที่เคยติดตั้งไว้ และล้าง cache ของมัน
// เพื่อให้ผู้ใช้เดิมได้ UI ล่าสุดจากเซิร์ฟเวอร์ทุกครั้ง
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
    .catch(() => undefined)
}
if ('caches' in window) {
  void caches
    .keys()
    .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
    .catch(() => undefined)
}
