<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AchievementRow } from '../composables/useAchievements'

const props = defineProps<{
  open: boolean
  rows: AchievementRow[]
  unlockedCount: number
  totalCount: number
  progressPercent: number
  loading?: boolean
  readOnly?: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const dialog = ref<HTMLElement | null>(null)

const unlockedDateFormatter = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric',
  month: 'short',
  year: '2-digit',
})

const formatUnlockedAt = (value: string | null) => {
  if (!value) return ''
  const stamp = new Date(value)
  return Number.isNaN(stamp.getTime()) ? '' : unlockedDateFormatter.format(stamp)
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && props.open) emit('close')
}

watch(
  () => props.open,
  async (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
    if (open) {
      await nextTick()
      dialog.value?.focus()
    }
  },
)

onMounted(() => window.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="gallery">
      <div v-if="open" class="gallery-backdrop" @mousedown.self="emit('close')">
        <section
          ref="dialog"
          class="gallery-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="gallery-title"
          tabindex="-1"
        >
          <header class="gallery-header">
            <div>
              <span>Achievements</span>
              <h2 id="gallery-title">ตู้เก็บความสำเร็จ</h2>
            </div>
            <button type="button" aria-label="ปิดตู้ความสำเร็จ" @click="emit('close')">×</button>
          </header>

          <div class="gallery-progress">
            <div class="gallery-progress__copy">
              <strong>{{ unlockedCount }} / {{ totalCount }} ใบ</strong>
              <small>{{ progressPercent }}% ของทั้งหมด</small>
            </div>
            <div class="gallery-progress__track" role="presentation">
              <div class="gallery-progress__fill" :style="{ width: `${progressPercent}%` }"></div>
            </div>
          </div>

          <p v-if="readOnly" class="gallery-note">
            โหมดดูตัวอย่างแสดง badge สมมติไว้ให้ดู เข้าสู่ระบบเพื่อสะสมของจริง
          </p>

          <div class="gallery-body">
            <p v-if="loading" class="gallery-loading" role="status">กำลังโหลดความสำเร็จ…</p>

            <ul v-else class="gallery-grid">
              <li
                v-for="row in rows"
                :key="row.badge.id"
                class="badge-card"
                :class="{ 'badge-card--locked': !row.unlocked }"
              >
                <div class="badge-card__medal" aria-hidden="true">
                  {{ row.unlocked ? row.badge.emoji : '❓' }}
                </div>
                <strong>{{ row.unlocked ? row.badge.name : 'ยังไม่ปลดล็อค' }}</strong>
                <small>{{ row.badge.requirement }}</small>
                <em v-if="row.unlocked && formatUnlockedAt(row.unlockedAt)">
                  ปลดล็อค {{ formatUnlockedAt(row.unlockedAt) }}
                </em>
                <span class="sr-only">
                  {{
                    row.unlocked
                      ? `ปลดล็อคแล้ว: ${row.badge.name}`
                      : `ยังไม่ปลดล็อค: ${row.badge.requirement}`
                  }}
                </span>
              </li>
            </ul>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.gallery-backdrop {
  position: fixed;
  z-index: 120;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(10, 28, 21, 0.62);
  backdrop-filter: blur(6px);
}

.gallery-dialog {
  display: grid;
  width: min(620px, 100%);
  max-height: calc(100vh - 40px);
  grid-template-rows: auto auto auto minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.55);
  border-radius: 20px;
  outline: none;
  background: #f7f9f6;
  box-shadow: 0 30px 90px rgba(7, 28, 19, 0.34);
  font-family: 'Noto Sans Thai', sans-serif;
}

.gallery-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
  padding: 18px 20px;
  color: #fff;
  background: #194d3b;
}

.gallery-header span {
  color: var(--lime);
  font-size: 0.57rem;
  font-weight: 800;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}

.gallery-header h2 {
  margin: 2px 0 0;
  font-size: 1rem;
}

.gallery-header button {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 9px;
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
  font-size: 1.15rem;
}

.gallery-progress {
  display: grid;
  gap: 6px;
  padding: 13px 16px 11px;
  border-bottom: 1px solid var(--line);
  background: #fff;
}

.gallery-progress__copy {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.gallery-progress__copy strong {
  color: var(--ink);
  font-size: 0.78rem;
}

.gallery-progress__copy small {
  color: var(--muted);
  font-size: 0.58rem;
}

.gallery-progress__track {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: #e9efeb;
}

.gallery-progress__fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #239a3b, var(--lime));
  transition: width 0.35s ease;
}

.gallery-note {
  margin: 0;
  padding: 9px 16px;
  border-bottom: 1px solid var(--cheer-line);
  color: var(--cheer-text);
  background: var(--cheer-tint);
  font-size: 0.6rem;
}

.gallery-body {
  overflow-y: auto;
  padding: 14px;
}

.gallery-loading {
  margin: 0;
  padding: 26px 0;
  color: var(--muted);
  font-size: 0.66rem;
  text-align: center;
}

.gallery-grid {
  display: grid;
  margin: 0;
  padding: 0;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  list-style: none;
}

.badge-card {
  display: grid;
  justify-items: center;
  gap: 3px;
  padding: 13px 10px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 4px 14px rgba(23, 45, 36, 0.05);
  text-align: center;
}

.badge-card__medal {
  display: grid;
  width: 46px;
  height: 46px;
  margin-bottom: 4px;
  place-items: center;
  border-radius: 50%;
  background: radial-gradient(circle at 32% 28%, #f6ffe2, #c9f06c 62%, #8fd06a);
  font-size: 1.4rem;
  line-height: 1;
}

.badge-card strong {
  color: var(--ink);
  font-size: 0.7rem;
}

.badge-card small {
  color: var(--muted);
  font-size: 0.55rem;
  line-height: 1.4;
}

.badge-card em {
  margin-top: 3px;
  padding: 2px 7px;
  border-radius: 999px;
  color: #20563e;
  background: var(--green-light);
  font-size: 0.5rem;
  font-style: normal;
  font-weight: 700;
}

.badge-card--locked {
  background: #f4f6f1;
  box-shadow: none;
}

.badge-card--locked .badge-card__medal {
  background: #e4e8e2;
  filter: grayscale(1);
}

.badge-card--locked strong {
  color: var(--muted);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.gallery-enter-active,
.gallery-leave-active {
  transition: opacity 0.2s ease;
}

.gallery-enter-active .gallery-dialog,
.gallery-leave-active .gallery-dialog {
  transition:
    opacity 0.2s ease,
    transform 0.25s cubic-bezier(0.2, 0.9, 0.2, 1);
}

.gallery-enter-from,
.gallery-leave-to {
  opacity: 0;
}

.gallery-enter-from .gallery-dialog,
.gallery-leave-to .gallery-dialog {
  opacity: 0;
  transform: translateY(14px) scale(0.97);
}

@media (max-width: 580px) {
  .gallery-backdrop {
    align-items: end;
    padding: 0;
  }

  .gallery-dialog {
    width: 100%;
    max-height: 94vh;
    border-radius: 20px 20px 0 0;
  }

  .gallery-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .gallery-body {
    padding: 11px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .gallery-enter-active,
  .gallery-leave-active,
  .gallery-enter-active .gallery-dialog,
  .gallery-leave-active .gallery-dialog {
    transition: none;
  }

  .gallery-progress__fill {
    transition: none;
  }
}
</style>
