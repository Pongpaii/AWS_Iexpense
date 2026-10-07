import type { App } from 'vue'

/**
 * จุดรวมการรายงาน error
 *
 * เวอร์ชัน AWS ยังไม่ส่ง error ออกไปภายนอก (CSP จำกัด connect-src ไว้ที่ API ของเราเอง)
 * error ฝั่ง client ถูก log ใน console; ฝั่ง API ดูได้จาก CloudWatch Logs
 * ถ้าจะเพิ่มบริการ monitoring ภายหลัง ให้แทนที่ report ตรงนี้ที่เดียว
 */

export const isMonitoringEnabled = false

let report: (error: unknown, context?: Record<string, unknown>) => void = () => {}

/** ส่ง error ที่ดักไว้เองไปยังระบบ monitoring (ตอนนี้ยังไม่ทำอะไร) */
export const reportError = (error: unknown, context?: Record<string, unknown>) => {
  report(error, context)
}

/** ให้เทสต์หรือบริการภายหลังเปลี่ยนตัวรายงานได้ */
export const setErrorReporter = (
  reporter: (error: unknown, context?: Record<string, unknown>) => void,
) => {
  report = reporter
}

export const initMonitoring = async (_app: App) => {}
