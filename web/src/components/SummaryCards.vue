<script setup lang="ts">
import { formatBaht, type Balance, type MonthlySummary } from '@money-flow/shared';
import { computed } from 'vue';
import { formatThaiMonth } from '../lib/date';

const props = defineProps<{
  balance: Balance | null;
  monthly: MonthlySummary | null;
  month: string;
  loading: boolean;
}>();

const cards = computed(() => [
  {
    key: 'balance',
    label: 'ยอดคงเหลือ',
    sub: 'ทั้งหมด',
    value: props.balance?.balance,
    cls: (props.balance?.balance ?? 0) < 0 ? 'amount-expense' : '',
  },
  {
    key: 'income',
    label: 'รายรับ',
    sub: formatThaiMonth(props.month),
    value: props.monthly?.income,
    cls: 'amount-income',
  },
  {
    key: 'expense',
    label: 'รายจ่าย',
    sub: formatThaiMonth(props.month),
    value: props.monthly?.expense,
    cls: 'amount-expense',
  },
]);
</script>

<template>
  <section aria-labelledby="summary-title" :aria-busy="loading">
    <h2 id="summary-title" class="visually-hidden">สรุปยอด</h2>
    <ul class="cards">
      <li v-for="c in cards" :key="c.key" class="card summary-card" :data-testid="`card-${c.key}`">
        <span class="label">{{ c.label }}</span>
        <span class="sub">{{ c.sub }}</span>
        <span v-if="loading || c.value === undefined" class="skeleton value-skeleton">
          <span class="visually-hidden">กำลังโหลด</span>
        </span>
        <strong v-else class="value" :class="c.cls">{{ formatBaht(c.value) }}</strong>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
}
.summary-card {
  display: grid;
  gap: 0.125rem;
}
.label {
  font-weight: 600;
}
.sub {
  color: var(--muted);
  font-size: 0.875rem;
}
.value {
  font-size: 1.5rem;
  font-variant-numeric: tabular-nums;
}
.value-skeleton {
  height: 2.25rem;
  width: 70%;
}
</style>
