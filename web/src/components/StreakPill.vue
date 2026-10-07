<script setup lang="ts">
import { useStreak } from '../composables/useStreak'
import type { Transaction } from '../types/transaction'

const props = withDefaults(
  defineProps<{
    /** รายการทั้งหมดของผู้ใช้ ใช้คำนวณวันติดต่อกัน */
    transactions: Transaction[]
    /** โหมดดูตัวอย่างจะไม่เขียนสถิติลง localStorage */
    persist?: boolean
  }>(),
  { persist: true },
)

const { currentStreak, longestStreak, level, icon, headline, hint, atRisk } = useStreak(
  () => props.transactions,
  { persist: () => props.persist },
)
</script>

<template>
  <div
    class="streak-pill"
    :class="[`streak-pill--${level}`, { 'streak-pill--at-risk': atRisk }]"
    role="status"
    :title="hint"
  >
    <span class="streak-pill__icon" aria-hidden="true">{{ icon }}</span>

    <span class="streak-pill__copy">
      <strong>{{ headline }}</strong>
      <small>{{ hint }}</small>
    </span>

    <span v-if="longestStreak > 0" class="streak-pill__best">
      สถิติ
      <b>{{ longestStreak }} วัน</b>
    </span>

    <span class="sr-only">
      {{
        currentStreak > 0 ? `บันทึกต่อเนื่อง ${currentStreak} วัน` : 'ยังไม่มีวันที่บันทึกต่อเนื่อง'
      }}
    </span>
  </div>
</template>

<style scoped>
.streak-pill {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 11px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--paper);
  box-shadow: 0 4px 13px rgba(25, 77, 59, 0.05);
  font-family: 'Noto Sans Thai', sans-serif;
}

.streak-pill__icon {
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  place-items: center;
  border-radius: 50%;
  background: #f1f5f2;
  font-size: 0.92rem;
  line-height: 1;
}

.streak-pill__copy {
  display: grid;
  min-width: 0;
  line-height: 1.2;
}

.streak-pill__copy strong {
  color: var(--ink);
  font-size: 0.7rem;
  font-weight: 800;
}

.streak-pill__copy small {
  overflow: hidden;
  color: var(--muted);
  font-size: 0.56rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.streak-pill__best {
  display: grid;
  margin-left: auto;
  padding: 3px 9px;
  border-radius: 999px;
  color: #61796e;
  background: #edf3ef;
  font-size: 0.5rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  line-height: 1.25;
  text-align: right;
  text-transform: uppercase;
  white-space: nowrap;
}

.streak-pill__best b {
  color: #20563e;
  font-size: 0.62rem;
  letter-spacing: 0;
  text-transform: none;
}

.streak-pill--idle {
  background: #f6f8f5;
}

.streak-pill--idle .streak-pill__icon {
  filter: grayscale(1);
  opacity: 0.55;
}

.streak-pill--idle .streak-pill__copy strong {
  color: var(--muted);
}

.streak-pill--starting .streak-pill__icon {
  background: var(--cheer-tint);
}

.streak-pill--hot {
  border-color: var(--cheer-line);
  background: linear-gradient(120deg, #fbfef6, var(--cheer-tint));
  animation: streak-glow 2.6s ease-in-out infinite;
}

.streak-pill--hot .streak-pill__icon {
  background: var(--cheer-line);
  animation: flame 1.5s ease-in-out infinite;
}

.streak-pill--diamond {
  border-color: #9ed3e6;
  background: linear-gradient(120deg, #f4fbfe, #e8f6fc);
  animation: streak-glow-cool 2.6s ease-in-out infinite;
}

.streak-pill--diamond .streak-pill__icon {
  background: #d5eef8;
  animation: flame 2s ease-in-out infinite;
}

.streak-pill--at-risk .streak-pill__copy strong {
  color: var(--cheer-text);
}

@keyframes flame {
  0%,
  100% {
    transform: scale(1) rotate(0deg);
  }
  35% {
    transform: scale(1.12) rotate(-5deg);
  }
  70% {
    transform: scale(1.04) rotate(4deg);
  }
}

@keyframes streak-glow {
  0%,
  100% {
    box-shadow: 0 4px 13px rgba(25, 77, 59, 0.05);
  }
  50% {
    box-shadow: 0 4px 18px rgba(143, 208, 106, 0.28);
  }
}

@keyframes streak-glow-cool {
  0%,
  100% {
    box-shadow: 0 4px 13px rgba(25, 77, 59, 0.05);
  }
  50% {
    box-shadow: 0 4px 18px rgba(62, 168, 213, 0.3);
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (max-width: 580px) {
  .streak-pill {
    border-radius: 13px;
  }

  .streak-pill__copy small {
    white-space: normal;
  }
}

@media (prefers-reduced-motion: reduce) {
  .streak-pill,
  .streak-pill__icon {
    animation: none;
  }
}
</style>
