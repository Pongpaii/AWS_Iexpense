/* global self, caches */
// Kill-switch: แอปเลิกใช้ PWA แล้ว
// เบราว์เซอร์ที่เคยติดตั้ง service worker เดิมจะเช็ค /sw.js แล้วได้ไฟล์นี้แทน
// → ลบ cache ทั้งหมด, ถอนตัวเอง แล้วโหลดหน้าใหม่จากเซิร์ฟเวอร์
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
      await self.registration.unregister()
      const clients = await self.clients.matchAll({ type: 'window' })
      for (const client of clients) client.navigate(client.url)
    })(),
  )
})
