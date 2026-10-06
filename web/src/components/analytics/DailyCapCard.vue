<script setup lang="ts">
import { formatBaht } from '@money-flow/shared';
import { computed } from 'vue';
import type { DailyCapStatus } from '../../lib/analytics';

const props = defineProps<{ status: DailyCapStatus; excluded: readonly string[] }>();

const pct = computed(() =>
  props.status.cap ? Math.min(100, Math.round((props.status.counted / props.status.cap) * 100)) : 0,
);
</script>

<template>
  <section class="card cap" aria-labelledby="cap-title">
    <h2 id="cap-title">งบรายวัน (วันนี้)</h2>
    <p v-if="!status.enabled" class="muted">
      ยังไม่ได้เปิดใช้เพดานรายวัน — <RouterLink to="/settings#daily-cap">ตั้งค่า</RouterLink>
    </p>
    <template v-else>
      <p class="line" :class="{ over: status.over }" aria-live="polite">
        ใช้ไป <strong>{{ formatBaht(status.counted) }}</strong> จาก
        {{ formatBaht(status.cap ?? 0) }}
        ·
        <strong>
          {{
            status.over
              ? `เกิน ${formatBaht(-(status.remaining ?? 0))}`
              : `เหลือ ${formatBaht(status.remaining ?? 0)}`
          }}
        </strong>
      </p>
      <div
        class="bar"
        role="progressbar"
        aria-label="ใช้งบรายวัน"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="pct"
        :aria-valuetext="`${pct}%`"
      >
        <span class="fill" :class="{ over: status.over }" :style="{ width: `${pct}%` }" />
      </div>
      <ul v-if="status.subPlans.length" class="plans">
        <li v-for="p in status.subPlans" :key="p.category" :class="{ over: p.over }">
          <span>{{ p.category }}</span>
          <span>{{ formatBaht(p.spent) }} / {{ formatBaht(p.plan) }}</span>
        </li>
      </ul>
      <p v-if="excluded.length" class="muted">
        ไม่นับ: {{ excluded.join(', ') }}
        <span v-if="status.excludedSpent">({{ formatBaht(status.excludedSpent) }} วันนี้)</span>
      </p>
    </template>
  </section>
</template>

<style scoped>
.cap {
  display: grid;
  gap: 0.5rem;
}
.cap h2 {
  font-size: 1.0625rem;
  margin: 0;
}
.line {
  margin: 0;
}
.line.over strong {
  color: var(--expense);
}
.bar {
  height: 0.75rem;
  border-radius: 999px;
  background: #e5e7eb;
  overflow: hidden;
}
.fill {
  display: block;
  height: 100%;
  background: var(--primary);
}
.fill.over {
  background: var(--expense);
}
.plans {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.125rem;
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
}
.plans li {
  display: flex;
  justify-content: space-between;
}
.plans li.over {
  color: var(--expense);
  font-weight: 600;
}
.muted {
  margin: 0;
  color: var(--muted);
  font-size: 0.875rem;
}
</style>
