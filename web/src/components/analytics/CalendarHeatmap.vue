<script setup lang="ts">
import { formatBaht } from '@money-flow/shared';
import { computed, useId } from 'vue';
import type { HeatCell } from '../../lib/analytics';
import { formatThaiDate } from '../../lib/date';

const props = defineProps<{
  cells: readonly HeatCell[];
  /** หมวดที่มีในเดือนนี้ (ให้เลือกไม่นับ) */
  categories: readonly string[];
  excluded: readonly string[];
  saving?: boolean;
}>();
const emit = defineEmits<{ 'update:excluded': [value: string[]] }>();
const uid = useId();

const WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

/** แบ่งเป็นสัปดาห์ (เริ่มวันอาทิตย์) */
const weeks = computed(() => {
  if (props.cells.length === 0) return [];
  const first = new Date(`${props.cells[0]!.date}T00:00:00Z`).getUTCDay();
  const slots: (HeatCell | null)[] = [...Array(first).fill(null), ...props.cells];
  while (slots.length % 7) slots.push(null);
  return Array.from({ length: slots.length / 7 }, (_, w) => slots.slice(w * 7, w * 7 + 7));
});

function toggle(cat: string) {
  const set = new Set(props.excluded);
  if (set.has(cat)) set.delete(cat);
  else set.add(cat);
  emit('update:excluded', [...set]);
}
</script>

<template>
  <div class="heatmap">
    <table :aria-describedby="`${uid}-help`">
      <caption class="visually-hidden">
        ปฏิทินรายจ่ายรายวัน
      </caption>
      <thead>
        <tr>
          <th v-for="d in WEEKDAYS" :key="d" scope="col">{{ d }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(week, wi) in weeks" :key="wi">
          <td v-for="(c, di) in week" :key="di">
            <div
              v-if="c"
              class="cell"
              :class="`lv${c.level}`"
              :title="`${formatThaiDate(c.date)}: ${formatBaht(c.expense)}`"
              data-testid="heat-cell"
            >
              <span aria-hidden="true">{{ Number(c.date.slice(8)) }}</span>
              <span class="visually-hidden">
                วันที่ {{ Number(c.date.slice(8)) }} รายจ่าย {{ formatBaht(c.expense) }}
              </span>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <p :id="`${uid}-help`" class="scale">
      <span>น้อย</span>
      <i
        v-for="lv in [0, 1, 2, 3, 4]"
        :key="lv"
        class="cell mini"
        :class="`lv${lv}`"
        aria-hidden="true"
      />
      <span>มาก</span>
    </p>

    <fieldset v-if="categories.length" class="exclude">
      <legend>หมวดที่ไม่นับในปฏิทิน</legend>
      <label v-for="c in categories" :key="c" class="chip">
        <input
          type="checkbox"
          :checked="excluded.includes(c)"
          :disabled="saving"
          @change="toggle(c)"
        />
        {{ c }}
      </label>
    </fieldset>
  </div>
</template>

<style scoped>
table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 4px;
  table-layout: fixed;
}
th {
  font-size: 0.8125rem;
  color: var(--muted);
  font-weight: 600;
}
td {
  padding: 0;
}
.cell {
  aspect-ratio: 1;
  border-radius: 6px;
  display: grid;
  place-items: center;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  border: 1px solid #e5e7eb;
}
/* โทนสีตาม --expense (ผู้ใช้เลือกได้) ใช้ color-mix เพื่อไล่ระดับ */
.lv0 {
  background: #f9fafb;
  color: var(--muted);
}
.lv1 {
  background: color-mix(in srgb, var(--expense) 18%, white);
}
.lv2 {
  background: color-mix(in srgb, var(--expense) 38%, white);
}
.lv3 {
  background: color-mix(in srgb, var(--expense) 62%, white);
  color: #fff;
}
.lv4 {
  background: var(--expense);
  color: #fff;
}
.scale {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  justify-content: flex-end;
  font-size: 0.8125rem;
  color: var(--muted);
}
.mini {
  width: 0.875rem;
  height: 0.875rem;
  aspect-ratio: auto;
}
.exclude {
  border: 0;
  padding: 0;
  margin: 0.5rem 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.exclude legend {
  font-weight: 600;
  margin-bottom: 0.25rem;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  min-height: 40px;
  padding: 0.25rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  cursor: pointer;
}
.chip input {
  width: 1.125rem;
  height: 1.125rem;
}
</style>
