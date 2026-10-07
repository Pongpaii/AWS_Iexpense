<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import type { BadgeDefinition } from '../types/achievement'

const props = defineProps<{
  /** badge ใบที่กำลังฉลอง (null = ไม่แสดงอะไร) */
  badge: BadgeDefinition | null
  /** เวลาแสดงต่อใบ (มิลลิวินาที) */
  duration?: number
}>()

const emit = defineEmits<{ done: [] }>()

let hideTimer: number | undefined

const clearTimer = () => {
  if (hideTimer !== undefined) window.clearTimeout(hideTimer)
  hideTimer = undefined
}

watch(
  () => props.badge?.id ?? null,
  (badgeId) => {
    clearTimer()
    if (!badgeId) return
    hideTimer = window.setTimeout(() => {
      hideTimer = undefined
      emit('done')
    }, props.duration ?? 3000)
  },
  { immediate: true },
)

onBeforeUnmount(clearTimer)
</script>

<template>
  <Teleport to="body">
    <Transition name="badge-toast">
      <div v-if="badge" class="badge-toast" role="status" aria-live="polite">
        <div class="badge-toast__medal" aria-hidden="true">
          <span>{{ badge.emoji }}</span>
        </div>

        <div class="badge-toast__copy">
          <small>ปลดล็อคความสำเร็จใหม่</small>
          <strong>{{ badge.emoji }} {{ badge.name }}</strong>
          <p>{{ badge.celebration }}</p>
        </div>

        <button type="button" aria-label="ปิดข้อความ" @click="emit('done')">×</button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.badge-toast {
  position: fixed;
  z-index: 140;
  bottom: 26px;
  left: 50%;
  display: grid;
  width: min(360px, calc(100% - 24px));
  grid-template-columns: 54px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 13px 14px;
  border: 1px solid rgba(201, 240, 108, 0.4);
  border-radius: 16px;
  color: #fff;
  background: linear-gradient(135deg, #17402f, #23604a);
  box-shadow:
    0 20px 55px rgba(7, 28, 19, 0.38),
    0 0 0 1px rgba(143, 208, 106, 0.16);
  font-family: 'Noto Sans Thai', sans-serif;
  transform: translateX(-50%);
}

.badge-toast__medal {
  display: grid;
  width: 54px;
  height: 54px;
  place-items: center;
  border-radius: 50%;
  background: radial-gradient(circle at 32% 28%, #f6ffe2, #c9f06c 62%, #8fd06a);
  box-shadow: 0 0 0 4px rgba(143, 208, 106, 0.18);
  animation:
    badge-unlock 0.72s cubic-bezier(0.2, 0.9, 0.2, 1) both,
    badge-glow 1.9s ease-in-out 0.72s infinite;
}

.badge-toast__medal span {
  font-size: 1.6rem;
  line-height: 1;
}

.badge-toast__copy {
  display: grid;
  min-width: 0;
  gap: 1px;
}

.badge-toast__copy small {
  color: var(--lime);
  font-size: 0.5rem;
  font-weight: 800;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}

.badge-toast__copy strong {
  overflow: hidden;
  font-size: 0.82rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge-toast__copy p {
  margin: 1px 0 0;
  color: rgba(255, 255, 255, 0.66);
  font-size: 0.6rem;
  line-height: 1.4;
}

.badge-toast button {
  align-self: start;
  padding: 2px 5px;
  border: 0;
  color: rgba(255, 255, 255, 0.5);
  background: transparent;
  font-size: 1.05rem;
}

.badge-toast button:hover {
  color: #fff;
}

@keyframes badge-unlock {
  0% {
    opacity: 0;
    transform: scale(0) rotate(-25deg);
  }
  62% {
    opacity: 1;
    transform: scale(1.2) rotate(6deg);
  }
  100% {
    opacity: 1;
    transform: scale(1) rotate(0deg);
  }
}

@keyframes badge-glow {
  0%,
  100% {
    box-shadow: 0 0 0 4px rgba(143, 208, 106, 0.18);
  }
  50% {
    box-shadow:
      0 0 0 9px rgba(143, 208, 106, 0.05),
      0 0 22px rgba(143, 208, 106, 0.5);
  }
}

.badge-toast-enter-active,
.badge-toast-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.32s cubic-bezier(0.2, 0.9, 0.2, 1);
}

.badge-toast-enter-from,
.badge-toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 22px) scale(0.95);
}

@media (max-width: 580px) {
  .badge-toast {
    bottom: 14px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .badge-toast__medal {
    animation: none;
  }
  .badge-toast-enter-active,
  .badge-toast-leave-active {
    transition: none;
  }
}
</style>
