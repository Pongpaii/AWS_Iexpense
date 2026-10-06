<script setup lang="ts">
import { formatBaht } from '@money-flow/shared';
import type { BudgetRow } from '../../lib/analytics';

defineProps<{ rows: readonly BudgetRow[] }>();

const STATUS = {
  ok: 'อยู่ในงบ',
  warning: 'ใกล้เต็มงบ',
  over: 'เกินงบ',
  unbudgeted: 'ไม่ได้ตั้งงบ',
} as const;

const pct = (r: BudgetRow) => Math.round((r.ratio ?? 0) * 100);
</script>

<template>
  <div class="bva">
    <p v-if="rows.length === 0" class="muted">
      ยังไม่มีงบหรือรายจ่าย —
      <RouterLink to="/settings#budgets">ตั้งงบรายหมวด</RouterLink>
    </p>
    <ul v-else class="rows">
      <li v-for="r in rows" :key="r.category" :class="`st-${r.status}`" data-testid="budget-row">
        <div class="head">
          <span class="cat">{{ r.category }}</span>
          <span class="status">{{ STATUS[r.status] }}</span>
        </div>
        <div
          v-if="r.budget !== null"
          class="bar"
          role="progressbar"
          :aria-label="`งบ${r.category}`"
          aria-valuemin="0"
          :aria-valuemax="r.budget"
          :aria-valuenow="Math.min(r.actual, r.budget)"
          :aria-valuetext="`ใช้ไป ${formatBaht(r.actual)} จาก ${formatBaht(r.budget)} (${pct(r)}%)`"
        >
          <span class="fill" :style="{ width: `${Math.min(100, pct(r))}%` }" />
        </div>
        <div class="nums">
          <span>จ่ายจริง {{ formatBaht(r.actual) }}</span>
          <span v-if="r.budget !== null">
            งบ {{ formatBaht(r.budget) }} ·
            <strong :class="{ neg: (r.remaining ?? 0) < 0 }">
              {{ (r.remaining ?? 0) < 0 ? 'เกิน' : 'เหลือ' }}
              {{ formatBaht(Math.abs(r.remaining ?? 0)) }}
            </strong>
          </span>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.875rem;
}
.head,
.nums {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.cat {
  font-weight: 700;
}
.status {
  font-size: 0.875rem;
  font-weight: 600;
}
.st-ok .status {
  color: var(--income);
}
.st-warning .status {
  color: #92400e;
}
.st-over .status,
.neg {
  color: var(--expense);
}
.st-unbudgeted .status {
  color: var(--muted);
}
.bar {
  height: 0.75rem;
  background: #e5e7eb;
  border-radius: 999px;
  overflow: hidden;
  margin-block: 0.25rem;
}
.fill {
  display: block;
  height: 100%;
  background: var(--income);
}
.st-warning .fill {
  background: #d97706;
}
.st-over .fill {
  background: var(--expense);
}
.nums {
  font-size: 0.875rem;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.muted {
  color: var(--muted);
}
</style>
