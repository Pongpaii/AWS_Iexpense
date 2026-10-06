<script setup lang="ts">
import { formatBaht } from '@money-flow/shared';
import { computed, useId } from 'vue';
import type { CategorySlice } from '../../lib/analytics';

const props = defineProps<{ slices: readonly CategorySlice[] }>();
const uid = useId();

/** สีแยกหมวดชัดเจน (ไม่ใช้สีเป็นข้อมูลอย่างเดียว — มี legend + ตัวเลข) */
const PALETTE = [
  '#ea580c',
  '#2563eb',
  '#16a34a',
  '#9333ea',
  '#db2777',
  '#0891b2',
  '#ca8a04',
  '#4b5563',
  '#65a30d',
  '#7c3aed',
];

const R = 60;
const C = 2 * Math.PI * R;
const total = computed(() => props.slices.reduce((s, x) => s + x.total, 0));

const segments = computed(() => {
  let offset = 0;
  return props.slices.map((s, i) => {
    const len = s.share * C;
    const seg = {
      ...s,
      color: PALETTE[i % PALETTE.length]!,
      dash: `${len} ${C - len}`,
      offset: -offset,
    };
    offset += len;
    return seg;
  });
});

const pct = (share: number) => `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
</script>

<template>
  <figure class="donut">
    <svg viewBox="0 0 160 160" role="img" :aria-labelledby="`${uid}-t ${uid}-d`">
      <title :id="`${uid}-t`">สัดส่วนรายจ่ายตามหมวด</title>
      <desc :id="`${uid}-d`">
        {{ segments.map((s) => `${s.category} ${pct(s.share)}`).join(', ') || 'ไม่มีรายจ่าย' }}
      </desc>
      <circle cx="80" cy="80" :r="R" class="track" />
      <circle
        v-for="s in segments"
        :key="s.category"
        cx="80"
        cy="80"
        :r="R"
        fill="none"
        :stroke="s.color"
        stroke-width="22"
        :stroke-dasharray="s.dash"
        :stroke-dashoffset="s.offset"
        transform="rotate(-90 80 80)"
      />
      <text x="80" y="76" class="center-label">รวม</text>
      <text x="80" y="96" class="center-value">{{ formatBaht(total) }}</text>
    </svg>
    <figcaption>
      <ul class="legend">
        <li v-for="s in segments" :key="s.category">
          <i class="swatch" :style="{ background: s.color }" aria-hidden="true" />
          <span class="cat">{{ s.category }}</span>
          <span class="num">{{ formatBaht(s.total) }}</span>
          <span class="pct">{{ pct(s.share) }}</span>
        </li>
        <li v-if="segments.length === 0" class="empty">ยังไม่มีรายจ่าย</li>
      </ul>
    </figcaption>
  </figure>
</template>

<style scoped>
.donut {
  margin: 0;
  display: grid;
  grid-template-columns: minmax(8rem, 11rem) 1fr;
  gap: 1rem;
  align-items: center;
}
@media (max-width: 30rem) {
  .donut {
    grid-template-columns: 1fr;
    justify-items: center;
  }
}
svg {
  width: 100%;
  max-width: 11rem;
}
.track {
  fill: none;
  stroke: #e5e7eb;
  stroke-width: 22;
}
.center-label {
  font-size: 11px;
  text-anchor: middle;
  fill: var(--muted);
}
.center-value {
  font-size: 13px;
  font-weight: 700;
  text-anchor: middle;
  fill: var(--text);
}
.legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.25rem;
  width: 100%;
}
.legend li {
  display: grid;
  grid-template-columns: 1rem 1fr auto 3.5rem;
  gap: 0.5rem;
  align-items: center;
  font-variant-numeric: tabular-nums;
}
.swatch {
  width: 0.875rem;
  height: 0.875rem;
  border-radius: 3px;
}
.num,
.pct {
  text-align: end;
}
.pct {
  color: var(--muted);
}
.empty {
  color: var(--muted);
  display: block !important;
}
</style>
