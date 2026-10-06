<script setup lang="ts">
import { formatBaht } from '@money-flow/shared';
import { computed, useId } from 'vue';
import type { DayFlow } from '../../lib/analytics';
import { formatThaiDate } from '../../lib/date';

const props = defineProps<{ flows: readonly DayFlow[] }>();
const uid = useId();

const W = 640;
const H = 220;
const PAD = { top: 12, right: 8, bottom: 22, left: 8 };

const geo = computed(() => {
  const f = props.flows;
  const maxBar = Math.max(1, ...f.map((d) => Math.max(d.income, d.expense)));
  const cum = f.map((d) => d.cumulative);
  const maxAbs = Math.max(1, ...cum.map(Math.abs));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const mid = PAD.top + innerH / 2;
  const step = innerW / Math.max(1, f.length);
  const barW = Math.max(2, step * 0.38);
  const bars = f.map((d, i) => {
    const x = PAD.left + i * step + step / 2;
    return {
      date: d.date,
      x,
      income: (d.income / maxBar) * (innerH / 2),
      expense: (d.expense / maxBar) * (innerH / 2),
    };
  });
  const line = f
    .map((d, i) => {
      const x = PAD.left + i * step + step / 2;
      const y = mid - (d.cumulative / maxAbs) * (innerH / 2 - 4);
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const ticks = f
    .map((d, i) => ({ i, day: Number(d.date.slice(8)), x: PAD.left + i * step + step / 2 }))
    .filter((t) => t.day === 1 || t.day % 5 === 0);
  return { bars, line, mid, barW, ticks };
});

const totals = computed(() => {
  const income = props.flows.reduce((s, d) => s + d.income, 0);
  const expense = props.flows.reduce((s, d) => s + d.expense, 0);
  return { income, expense, end: props.flows.at(-1)?.cumulative ?? 0 };
});
const activeDays = computed(() => props.flows.filter((d) => d.income || d.expense));
</script>

<template>
  <figure class="chart">
    <svg
      :viewBox="`0 0 ${W} ${H}`"
      role="img"
      :aria-labelledby="`${uid}-t ${uid}-d`"
      preserveAspectRatio="xMidYMid meet"
    >
      <title :id="`${uid}-t`">กราฟกระแสเงินสดรายวัน</title>
      <desc :id="`${uid}-d`">
        รายรับรวม {{ formatBaht(totals.income) }} รายจ่ายรวม
        {{ formatBaht(totals.expense) }} ยอดสุทธิสิ้นช่วง {{ formatBaht(totals.end) }}
      </desc>
      <line :x1="PAD.left" :x2="W - PAD.right" :y1="geo.mid" :y2="geo.mid" class="axis" />
      <g v-for="b in geo.bars" :key="b.date">
        <rect
          v-if="b.income"
          :x="b.x - geo.barW / 2"
          :y="geo.mid - b.income"
          :width="geo.barW"
          :height="b.income"
          class="bar-income"
        />
        <rect
          v-if="b.expense"
          :x="b.x - geo.barW / 2"
          :y="geo.mid"
          :width="geo.barW"
          :height="b.expense"
          class="bar-expense"
        />
      </g>
      <path :d="geo.line" class="cumulative" />
      <text v-for="t in geo.ticks" :key="t.i" :x="t.x" :y="H - 6" class="tick">{{ t.day }}</text>
    </svg>
    <figcaption class="legend">
      <span><i class="swatch income" aria-hidden="true" />รายรับ (แท่งขึ้น)</span>
      <span><i class="swatch expense" aria-hidden="true" />รายจ่าย (แท่งลง)</span>
      <span><i class="swatch line" aria-hidden="true" />ยอดสะสม</span>
    </figcaption>
    <details>
      <summary>ดูข้อมูลเป็นตาราง</summary>
      <table>
        <thead>
          <tr>
            <th scope="col">วันที่</th>
            <th scope="col">รายรับ</th>
            <th scope="col">รายจ่าย</th>
            <th scope="col">ยอดสะสม</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in activeDays" :key="d.date">
            <th scope="row">{{ formatThaiDate(d.date) }}</th>
            <td>{{ formatBaht(d.income) }}</td>
            <td>{{ formatBaht(d.expense) }}</td>
            <td>{{ formatBaht(d.cumulative) }}</td>
          </tr>
          <tr v-if="activeDays.length === 0">
            <td colspan="4">ไม่มีข้อมูล</td>
          </tr>
        </tbody>
      </table>
    </details>
  </figure>
</template>

<style scoped>
.chart {
  margin: 0;
}
svg {
  width: 100%;
  height: auto;
}
.axis {
  stroke: #9ca3af;
}
.bar-income {
  fill: var(--income);
}
.bar-expense {
  fill: var(--expense);
}
.cumulative {
  fill: none;
  stroke: #1f2937;
  stroke-width: 2;
}
.tick {
  font-size: 11px;
  fill: var(--muted);
  text-anchor: middle;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  font-size: 0.875rem;
  color: var(--muted);
}
.swatch {
  display: inline-block;
  width: 0.75rem;
  height: 0.75rem;
  margin-inline-end: 0.25rem;
  border-radius: 2px;
  vertical-align: middle;
}
.swatch.income {
  background: var(--income);
}
.swatch.expense {
  background: var(--expense);
}
.swatch.line {
  background: #1f2937;
  height: 2px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
  font-variant-numeric: tabular-nums;
}
th,
td {
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid #e5e7eb;
  text-align: end;
}
th[scope='row'],
thead th:first-child {
  text-align: start;
}
summary {
  cursor: pointer;
  min-height: 44px;
  display: flex;
  align-items: center;
  color: var(--primary);
}
</style>
