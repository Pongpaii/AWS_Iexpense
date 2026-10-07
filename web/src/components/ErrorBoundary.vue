<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    /** ข้อความหัวเรื่อง ปรับได้เผื่อใช้ครอบส่วนย่อย ไม่ใช่ทั้งแอป */
    title?: string
  }>(),
  { title: 'เกิดข้อผิดพลาดที่ไม่คาดคิด' },
)

const emit = defineEmits<{
  captured: [error: Error]
}>()

const error = ref<Error | null>(null)
/** เปลี่ยนค่าเพื่อบังคับให้ slot สร้าง component ใหม่หมด ไม่ใช่แค่ซ่อน error */
const resetKey = ref(0)
const detailsOpen = ref(false)

onErrorCaptured((err) => {
  const normalized = err instanceof Error ? err : new Error(String(err))
  error.value = normalized
  detailsOpen.value = false
  console.error('[ErrorBoundary]', normalized)
  emit('captured', normalized)
  // false = หยุดไม่ให้ error ลอยขึ้นไปทำให้ทั้งแอปตาย
  return false
})

const retry = () => {
  error.value = null
  resetKey.value += 1
}

const reload = () => {
  window.location.reload()
}
</script>

<template>
  <div v-if="error" class="error-boundary" role="alert">
    <div class="error-card">
      <div class="error-icon" aria-hidden="true">!</div>
      <h2>{{ props.title }}</h2>
      <p class="error-lead">
        ข้อมูลที่บันทึกไว้ยังอยู่ครบ ลองกดโหลดส่วนนี้ใหม่ ถ้ายังไม่หายให้รีเฟรชหน้าเว็บ
      </p>

      <div class="error-actions">
        <button class="error-primary" type="button" @click="retry">ลองใหม่</button>
        <button class="error-secondary" type="button" @click="reload">รีเฟรชหน้าเว็บ</button>
      </div>

      <button
        class="error-toggle"
        type="button"
        :aria-expanded="detailsOpen"
        @click="detailsOpen = !detailsOpen"
      >
        {{ detailsOpen ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียดทางเทคนิค' }}
      </button>

      <pre v-if="detailsOpen" class="error-details">{{ error.message }}</pre>
    </div>
  </div>

  <slot v-else :key="resetKey" />
</template>

<style scoped>
.error-boundary {
  display: grid;
  min-height: 100vh;
  min-height: 100dvh;
  place-items: center;
  padding: 24px;
  background: linear-gradient(145deg, #153d30, #1d5a43 58%, #286b4f);
  font-family: 'Noto Sans Thai', sans-serif;
}

.error-card {
  display: grid;
  width: min(420px, 100%);
  justify-items: center;
  gap: 10px;
  padding: 28px 24px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 18px;
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
  box-shadow: 0 24px 60px rgba(7, 28, 19, 0.28);
  text-align: center;
}

.error-icon {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 50%;
  color: var(--alert-ink);
  background: var(--alert-line);
  font-size: 1.2rem;
  font-weight: 800;
}

.error-card h2 {
  margin: 0;
  font-size: 0.95rem;
}

.error-lead {
  margin: 0;
  color: rgba(255, 255, 255, 0.68);
  font-size: 0.68rem;
  line-height: 1.6;
}

.error-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 4px;
}

.error-actions button {
  min-height: 38px;
  padding: 9px 16px;
  border-radius: 10px;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.7rem;
  font-weight: 700;
  cursor: pointer;
}

.error-primary {
  border: 0;
  color: #194d3b;
  background: #c9f06c;
}

.error-secondary {
  border: 1px solid rgba(255, 255, 255, 0.24);
  color: rgba(255, 255, 255, 0.86);
  background: rgba(255, 255, 255, 0.07);
}

.error-actions button:focus-visible,
.error-toggle:focus-visible {
  outline: 3px solid rgba(201, 240, 108, 0.5);
  outline-offset: 2px;
}

.error-toggle {
  border: 0;
  color: rgba(255, 255, 255, 0.55);
  background: none;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.62rem;
  font-weight: 600;
  text-decoration: underline;
  cursor: pointer;
}

.error-details {
  width: 100%;
  max-height: 160px;
  margin: 0;
  overflow: auto;
  padding: 10px;
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.75);
  background: rgba(0, 0, 0, 0.24);
  font-size: 0.6rem;
  text-align: left;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
