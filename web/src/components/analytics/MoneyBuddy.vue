<script setup lang="ts">
import { formatBaht } from '@money-flow/shared';
import type { Forecast, Insight } from '../../lib/analytics';
import { formatThaiMonth } from '../../lib/date';

defineProps<{ insights: readonly Insight[]; forecast: Forecast }>();

const ICON = { good: '👍', info: '💡', warning: '⚠️' } as const;
const LABEL = { good: 'ดี', info: 'ข้อมูล', warning: 'คำเตือน' } as const;
</script>

<template>
  <div class="buddy">
    <dl class="forecast">
      <div>
        <dt>ใช้ไปแล้ว ({{ forecast.daysElapsed }}/{{ forecast.daysInMonth }} วัน)</dt>
        <dd>{{ formatBaht(forecast.spentSoFar) }}</dd>
      </div>
      <div>
        <dt>คาดว่าทั้ง{{ formatThaiMonth(forecast.month) }}จะใช้</dt>
        <dd>{{ formatBaht(forecast.projectedExpense) }}</dd>
      </div>
      <div>
        <dt>คาดว่าสิ้นเดือนจะเหลือ</dt>
        <dd :class="forecast.projectedBalance < 0 ? 'amount-expense' : 'amount-income'">
          {{ formatBaht(forecast.projectedBalance) }}
        </dd>
      </div>
    </dl>
    <ul class="insights">
      <li v-for="i in insights" :key="i.id" :class="`tone-${i.tone}`">
        <span aria-hidden="true">{{ ICON[i.tone] }}</span>
        <span class="visually-hidden">{{ LABEL[i.tone] }}:</span>
        {{ i.text }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.buddy {
  display: grid;
  gap: 0.75rem;
}
.forecast {
  margin: 0;
  display: grid;
  gap: 0.5rem;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
}
.forecast div {
  background: #f9fafb;
  border-radius: 0.5rem;
  padding: 0.5rem 0.75rem;
}
dt {
  font-size: 0.8125rem;
  color: var(--muted);
}
dd {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.insights {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.375rem;
}
.insights li {
  display: flex;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  background: #f0f9ff;
}
.tone-good {
  background: #f0fdf4 !important;
}
.tone-warning {
  background: var(--warning-bg) !important;
  color: var(--warning-text);
}
</style>
