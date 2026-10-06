<script setup lang="ts">
import { formatBaht } from '@money-flow/shared';
import { computed, reactive, useId } from 'vue';
import { computeRunway, type TxLike } from '../../lib/analytics';
import { formatThaiDate } from '../../lib/date';

const props = defineProps<{ balance: number; recentTxs: readonly TxLike[]; today: string }>();
const uid = useId();

/** คันโยกรายหมวด: % ที่จะลด */
const levers = reactive<Record<string, number>>({});

const runway = computed(() =>
  computeRunway({ balance: props.balance, txs: props.recentTxs, today: props.today, levers }),
);
const gained = computed(() => {
  const r = runway.value;
  return r.days !== null && r.daysBefore !== null ? r.days - r.daysBefore : null;
});
const hasLevers = computed(() => Object.values(levers).some((v) => v > 0));

function reset() {
  for (const k of Object.keys(levers)) levers[k] = 0;
}

const daysText = (d: number | null) =>
  d === null ? 'ไม่จำกัด' : d >= 3650 ? 'มากกว่า 10 ปี' : `${d.toLocaleString('th-TH')} วัน`;
</script>

<template>
  <div class="runway">
    <div class="headline" aria-live="polite">
      <p class="big">
        เงินพออยู่ได้อีก
        <strong :class="{ danger: (runway.days ?? Infinity) < 30 }">{{
          daysText(runway.days)
        }}</strong>
      </p>
      <p v-if="runway.runOutDate && runway.days !== null && runway.days < 3650" class="muted">
        ถึงประมาณ {{ formatThaiDate(runway.runOutDate) }}
      </p>
      <p class="muted">
        คงเหลือ {{ formatBaht(runway.balance) }} · ใช้เฉลี่ยวันละ
        {{ formatBaht(Math.round(runway.avgDailyAfterCuts)) }}
        <span v-if="hasLevers">(เดิม {{ formatBaht(Math.round(runway.avgDailyExpense)) }})</span>
        จาก {{ runway.windowDays }} วันล่าสุด
      </p>
      <p v-if="gained && gained > 0" class="gain">
        ปรับตามคันโยกแล้วอยู่ได้นานขึ้น {{ gained.toLocaleString('th-TH') }} วัน
      </p>
    </div>

    <h3 :id="`${uid}-levers`">คันโยกรายหมวด: ถ้าลดหมวดนี้ลง…</h3>
    <p v-if="runway.categories.length === 0" class="muted">ยังไม่มีรายจ่ายในช่วง 30 วันล่าสุด</p>
    <ul v-else class="levers" :aria-labelledby="`${uid}-levers`">
      <li v-for="c in runway.categories" :key="c.category">
        <label :for="`${uid}-${c.category}`" class="lever-label">
          <span class="cat">{{ c.category }}</span>
          <span class="muted">วันละ {{ formatBaht(Math.round(c.daily)) }}</span>
        </label>
        <input
          :id="`${uid}-${c.category}`"
          v-model.number="levers[c.category]"
          type="range"
          min="0"
          max="100"
          step="10"
          :aria-valuetext="`ลด ${levers[c.category] ?? 0}%`"
        />
        <output :for="`${uid}-${c.category}`" class="cut">−{{ levers[c.category] ?? 0 }}%</output>
      </li>
    </ul>
    <button v-if="hasLevers" type="button" class="btn btn-secondary" @click="reset">
      รีเซ็ตคันโยก
    </button>
  </div>
</template>

<style scoped>
.runway {
  display: grid;
  gap: 0.75rem;
}
.headline p {
  margin: 0;
}
.big {
  font-size: 1.25rem;
}
.big strong {
  font-size: 1.75rem;
  color: var(--primary);
}
.big strong.danger {
  color: var(--danger);
}
.muted {
  color: var(--muted);
  font-size: 0.9rem;
}
.gain {
  color: var(--income);
  font-weight: 600;
}
h3 {
  font-size: 1rem;
  margin: 0;
}
.levers {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}
.levers li {
  display: grid;
  grid-template-columns: minmax(7rem, 1fr) 2fr 3.5rem;
  align-items: center;
  gap: 0.75rem;
}
.lever-label {
  display: grid;
}
.cat {
  font-weight: 600;
}
input[type='range'] {
  width: 100%;
  min-height: 44px;
  accent-color: var(--primary);
}
.cut {
  text-align: end;
  font-variant-numeric: tabular-nums;
}
</style>
