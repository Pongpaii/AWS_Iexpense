import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * เหตุการณ์ beforeinstallprompt ยังไม่อยู่ใน lib.dom มาตรฐาน
 * จึงต้องประกาศรูปร่างเท่าที่ใช้เอง
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** ผู้ใช้กดปิดคำเชิญแล้ว ไม่ต้องทวงอีกภายในกี่วัน */
const DISMISS_KEY = 'moneyflow.install-dismissed-at'
const DISMISS_DAYS = 30

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches === true ||
  // Safari บน iOS ใช้ property นอกมาตรฐานตัวนี้
  (navigator as Navigator & { standalone?: boolean }).standalone === true

const dismissedRecently = () => {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return false
    const at = Number(raw)
    if (!Number.isFinite(at)) return false
    return Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000
  } catch {
    return false
  }
}

/**
 * คำเชิญติดตั้งแอป (PWA)
 *
 * แสดงเฉพาะเมื่อเบราว์เซอร์บอกเองว่าติดตั้งได้ (ยิง beforeinstallprompt)
 * ไม่เดาเอง และไม่ขึ้นซ้ำถ้าผู้ใช้เคยกดปิดไปแล้ว
 */
export const useInstallPrompt = () => {
  const canInstall = ref(false)
  const installing = ref(false)
  let deferredPrompt: BeforeInstallPromptEvent | null = null

  const handleBeforeInstallPrompt = (event: Event) => {
    // ต้องกันค่าเริ่มต้นไว้ ไม่งั้นเบราว์เซอร์จะขึ้น mini-infobar ของตัวเอง
    event.preventDefault()
    if (isStandalone() || dismissedRecently()) return

    deferredPrompt = event as BeforeInstallPromptEvent
    canInstall.value = true
  }

  const handleInstalled = () => {
    canInstall.value = false
    deferredPrompt = null
  }

  const install = async () => {
    if (!deferredPrompt || installing.value) return

    installing.value = true
    try {
      await deferredPrompt.prompt()
      const { outcome } = await deferredPrompt.userChoice
      // prompt ใช้ได้ครั้งเดียวต่อ event ไม่ว่าผลจะเป็นอะไร
      deferredPrompt = null
      canInstall.value = false
      if (outcome === 'dismissed') dismiss(false)
    } catch {
      canInstall.value = false
      deferredPrompt = null
    } finally {
      installing.value = false
    }
  }

  const dismiss = (hide = true) => {
    if (hide) canInstall.value = false
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      // จำไม่ได้ก็ไม่เป็นไร แค่จะถามใหม่รอบหน้า
    }
  }

  onMounted(() => {
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.removeEventListener('appinstalled', handleInstalled)
  })

  return { canInstall, installing, install, dismiss }
}
