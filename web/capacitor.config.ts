import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Android ผ่าน Capacitor — แอปโหลดไฟล์จาก dist/ ในเครื่อง (origin = https://localhost)
 * origin นี้อยู่ใน CORS ของ ApiStack แล้ว
 */
const config: CapacitorConfig = {
  appId: 'th.moneyflow.app',
  appName: 'Money Flow',
  webDir: 'dist',
  android: {
    // ไม่อนุญาต http ปน https ใน WebView
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    LocalNotifications: {
      iconColor: '#0f766e',
    },
  },
}

export default config
