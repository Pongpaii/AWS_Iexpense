import { onBeforeUnmount, ref } from 'vue'

const SUCCESS_TIMEOUT_MS = 3000

/**
 * ที่เดียวสำหรับข้อความแจ้งผู้ใช้
 *
 * แยกออกมาเพราะทุก composable ที่คุยกับเซิร์ฟเวอร์ต้องรายงานผลให้ผู้ใช้เห็น
 * ถ้าไม่มีตัวกลางนี้ แต่ละตัวจะต้องรู้จัก state ของ App.vue โดยตรง
 */
export const useAppMessages = () => {
  const errorMessage = ref('')
  const successMessage = ref('')
  let successTimer: ReturnType<typeof setTimeout> | undefined

  const showMessage = (message: string) => {
    successMessage.value = message
    clearTimeout(successTimer)
    successTimer = setTimeout(() => {
      if (successMessage.value === message) successMessage.value = ''
    }, SUCCESS_TIMEOUT_MS)
  }

  const showError = (message: string) => {
    errorMessage.value = message
  }

  const clearError = () => {
    errorMessage.value = ''
  }

  const clearAll = () => {
    clearTimeout(successTimer)
    successTimer = undefined
    errorMessage.value = ''
    successMessage.value = ''
  }

  onBeforeUnmount(() => clearTimeout(successTimer))

  return { errorMessage, successMessage, showMessage, showError, clearError, clearAll }
}

export type AppMessages = ReturnType<typeof useAppMessages>
