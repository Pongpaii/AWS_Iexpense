<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useDailyCap } from '../composables/useDailyCap'
import { useForecastSettings } from '../composables/useForecastSettings'
import { useSalarySettings } from '../composables/useSalarySettings'
import { getCategoryEmoji, type Transaction, type TransactionCategory } from '../types/transaction'
import { toLocalIsoDate } from '../utils/dateUtils'
import { formatBaht, formatDate } from '../utils/format'
import { buildRunway, weeklyAverageDailyCap, type RunwayScenario } from '../utils/runway'

const props = defineProps<{ transactions: Transaction[] }>()

const { monthlySalary, salaryDay } = useSalarySettings()
const { capEnabled, capSettings } = useDailyCap()
const {
  excludableCategories,
  excludedCategories,
  hasExcludedCategories,
  isCategoryExcluded,
  clearExcludedCategories,
  toggleCategoryExcluded,
} = useForecastSettings()

/** วันที่ปัจจุบันต้องขยับเอง เพราะหน้านี้เปิดค้างข้ามเที่ยงคืนได้ */
const today = ref(toLocalIsoDate(new Date()))
let dateTimer: number | undefined

onMounted(() => {
  dateTimer = window.setInterval(() => {
    today.value = toLocalIsoDate(new Date())
  }, 60_000)
})

onBeforeUnmount(() => {
  if (dateTimer !== undefined) window.clearInterval(dateTimer)
})

const plannedDailyBurn = computed(() =>
  capEnabled.value
    ? weeklyAverageDailyCap(capSettings.value.weekday.cap, capSettings.value.weekend.cap)
    : 0,
)

const runway = computed(() =>
  buildRunway({
    transactions: props.transactions,
    today: today.value,
    monthlySalary: monthlySalary.value,
    salaryDay,
    plannedDailyBurn: plannedDailyBurn.value,
    excludedCategories: excludedCategories.value,
  }),
)

const tuningOpen = ref(false)
const onToggleCategory = (category: TransactionCategory) => {
  toggleCategoryExcluded(category)
}

const excludedSummary = computed(() =>
  excludedCategories.value
    .map((category) => `${getCategoryEmoji(category)} ${category}`)
    .join(' · '),
)

const statusCopy = computed(() => {
  const result = runway.value

  if (result.balance < 0) {
    return {
      label: 'ติดลบอยู่',
      headline: 'ยอดรวมติดลบอยู่ตอนนี้',
      detail: 'เติมเงินเข้าหรือหยุดรายจ่ายที่ตัดได้ก่อน แล้วค่อยวางแผนวันต่อไป',
    }
  }

  if (result.status === 'insufficient') {
    return {
      label: 'ข้อมูลยังน้อย',
      headline: 'ยังบอกไม่ได้ว่าเงินอยู่ได้อีกกี่วัน',
      detail: 'จดรายจ่ายต่ออีกสองสามวัน ระบบจะเริ่มคำนวณอัตราการใช้ต่อวันให้',
    }
  }

  const days = result.primary.days ?? 0
  if (result.status === 'risk') {
    return {
      label: 'ไม่ถึงวันเงินเดือน',
      headline: `เงินหมดก่อนเงินเดือน ${result.primary.shortfallDays} วัน`,
      detail: `ถ้าใช้วันละ ${formatBaht(result.primary.burnPerDay)} เท่าเดิม เงินจะหมดวันที่ ${
        result.primary.runsOutDate ? formatDate(result.primary.runsOutDate) : '—'
      }`,
    }
  }

  if (result.status === 'watch') {
    return {
      label: 'เฉียดฉิว',
      headline: `พอถึงวันเงินเดือนแบบหวุดหวิด (${days} วัน)`,
      detail: 'เหลือเผื่อไม่กี่วัน มีรายจ่ายก้อนเดียวแทรกก็พลาดได้',
    }
  }

  return {
    label: 'ปลอดภัย',
    headline: `เงินอยู่ได้อีก ${days} วัน`,
    detail: `เกินวันเงินเดือนไป ${days - result.daysUntilSalary} วัน ยังมีที่ให้หายใจ`,
  }
})

/** ความยาวหลอด: เทียบ runway กับวันเงินเดือน · เต็มหลอด = ถึงวันเงินเดือนแล้ว */
const salaryProgress = computed(() => {
  const result = runway.value
  if (result.primary.days === null) return 0
  if (result.daysUntilSalary <= 0) return 100
  return Math.min(100, Math.round((result.primary.days / result.daysUntilSalary) * 100))
})

const scenarioTone = (scenario: RunwayScenario) => {
  if (!scenario.available) return 'off'
  if (scenario.days === null) return 'off'
  return scenario.reachesSalary ? 'ok' : 'risk'
}

const confidenceNote = computed(() => {
  const result = runway.value
  const base = `คิดจากข้อมูล ${result.historyDays} วัน ${result.expenseRecordCount} รายการ`
  if (!result.hasSpendingData) return 'ยังไม่มีรายจ่ายให้คำนวณอัตราการใช้'
  if (result.isEstimateBlended) {
    return `${base} · ข้อมูลยังไม่ครบรอบ ตัวเลขจึงผสมค่าอ้างอิงจากเงินเดือนอยู่`
  }
  return `${base} · เชื่อข้อมูลจริงเต็มร้อยแล้ว`
})

const cutLabel = (days: number | null) => (days === null ? 'ไม่มีกำหนด' : `+${days} วัน`)
</script>

<template>
  <section class="chart-panel runway-panel" aria-labelledby="runway-title">
    <header class="chart-heading">
      <div>
        <span class="chart-eyebrow">Runway</span>
        <h2 id="runway-title">ความมั่งคั่งที่เหลืออยู่ได้อีกกี่วัน</h2>
      </div>

      <button
        class="runway-tune"
        type="button"
        :aria-expanded="tuningOpen"
        aria-controls="runway-tuning"
        @click="tuningOpen = !tuningOpen"
      >
        {{ hasExcludedCategories ? `กันออก ${excludedCategories.length} หมวด` : 'ปรับการคำนวณ' }}
      </button>
    </header>

    <div v-if="tuningOpen" id="runway-tuning" class="runway-tuning">
      <p>
        ติ๊กหมวดที่ไม่ต้องเอามาคิดอัตราการใช้ต่อวัน เช่น ค่าที่พักที่จ่ายก้อนเดียวทุกเดือน
        <b>เงินคงเหลือยังนับรายจ่ายครบทุกหมวดตามจริง</b>
      </p>

      <div class="runway-chips">
        <label
          v-for="option in excludableCategories"
          :key="option.value"
          class="runway-chip"
          :class="{ 'is-off': isCategoryExcluded(option.value) }"
        >
          <input
            type="checkbox"
            :checked="isCategoryExcluded(option.value)"
            @change="onToggleCategory(option.value)"
          />
          <span>{{ option.emoji }} {{ option.value }}</span>
        </label>
      </div>

      <button v-if="hasExcludedCategories" type="button" @click="clearExcludedCategories()">
        คิดทุกหมวดเหมือนเดิม
      </button>
    </div>

    <div class="runway-hero" :class="`runway-hero--${runway.status}`">
      <div class="runway-hero__main">
        <small>{{ statusCopy.label }}</small>
        <strong v-if="runway.primary.days !== null"> {{ runway.primary.days }}<em>วัน</em> </strong>
        <strong v-else class="runway-hero__unknown">—</strong>
        <p>{{ statusCopy.headline }}</p>
        <span>{{ statusCopy.detail }}</span>
      </div>

      <ul class="runway-facts">
        <li>
          <small>เงินที่มีอยู่จริง</small>
          <b :class="{ 'is-over': runway.balance < 0 }">{{ formatBaht(runway.balance) }}</b>
        </li>
        <li>
          <small>ไหลออกวันละ</small>
          <b>{{ formatBaht(runway.primary.burnPerDay) }}</b>
        </li>
        <li>
          <small>เงินเดือนออกอีก</small>
          <b>{{ runway.daysUntilSalary }} วัน</b>
        </li>
        <li>
          <small>เงินหมดวันที่</small>
          <b>
            <time v-if="runway.primary.runsOutDate" :datetime="runway.primary.runsOutDate">
              {{ formatDate(runway.primary.runsOutDate) }}
            </time>
            <template v-else>ยังคิดไม่ได้</template>
          </b>
        </li>
      </ul>
    </div>

    <section class="runway-race" aria-label="เทียบ runway กับวันเงินเดือน">
      <div class="runway-race__head">
        <span>จากวันนี้ถึงวันเงินเดือน ({{ formatDate(runway.nextSalaryDate) }})</span>
        <b>{{ salaryProgress }}% ของระยะที่ต้องไปให้ถึง</b>
      </div>

      <div
        class="runway-track"
        role="progressbar"
        :aria-valuenow="salaryProgress"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="`เงินอยู่ได้ ${runway.primary.days ?? 0} วัน จากที่ต้องไปให้ถึง ${runway.daysUntilSalary} วัน`"
      >
        <i class="runway-track__fill" :style="{ width: `${salaryProgress}%` }"></i>
      </div>

      <p class="runway-target">
        <template v-if="runway.daysUntilSalary > 0">
          ใช้ได้วันละไม่เกิน <b>{{ formatBaht(runway.targetDailySpend) }}</b> จึงจะถึงวันเงินเดือน
          <template v-if="runway.requiredDailyCut > 0">
            · ต้องลดจากตอนนี้วันละ
            <b class="is-over">{{ formatBaht(runway.requiredDailyCut) }}</b>
            (รวม {{ formatBaht(runway.requiredTotalCut) }})
          </template>
          <template v-else>· จังหวะตอนนี้อยู่ในเกณฑ์แล้ว</template>
        </template>
        <template v-else>วันนี้เป็นวันเงินเดือนพอดี เริ่มรอบใหม่ได้เลย</template>
      </p>
    </section>

    <ul class="runway-scenarios" aria-label="ฉากทัศน์การใช้เงิน">
      <li
        v-for="scenario in runway.scenarios"
        :key="scenario.id"
        :class="[`is-${scenarioTone(scenario)}`, { 'is-primary': scenario.id === 'actual' }]"
      >
        <div class="runway-scenarios__head">
          <b>{{ scenario.label }}</b>
          <span v-if="scenario.available && scenario.days !== null">{{ scenario.days }} วัน</span>
          <span v-else>—</span>
        </div>
        <small>
          <template v-if="!scenario.available">
            {{ scenario.id === 'planned' ? 'ยังไม่ได้เปิดงบรายวัน' : 'ยังไม่มีข้อมูลพอ' }}
          </template>
          <template v-else>
            วันละ {{ formatBaht(scenario.burnPerDay) }} ·
            {{
              scenario.reachesSalary ? 'ถึงวันเงินเดือน' : `ขาดอีก ${scenario.shortfallDays} วัน`
            }}
          </template>
        </small>
        <em>{{ scenario.hint }}</em>
      </li>
    </ul>

    <section v-if="runway.categories.length" class="runway-levers">
      <header>
        <strong>อะไรกินเวลาของเราไปบ้าง</strong>
        <span>ค่าอาหารกับค่าเดินทางขึ้นก่อนเสมอ เพราะเป็นสองอย่างที่ลดได้ทันทีวันนี้</span>
      </header>

      <ul>
        <li
          v-for="lever in runway.categories"
          :key="lever.label"
          :class="{ 'is-priority': lever.isPriority }"
        >
          <div class="runway-lever__head">
            <span class="runway-lever__name">
              {{ lever.emoji }} {{ lever.label }}
              <mark v-if="lever.isPriority">จำเป็น</mark>
            </span>
            <b>{{ formatBaht(lever.perDay) }}<em>/วัน</em></b>
          </div>

          <div class="runway-track runway-track--slim">
            <i
              class="runway-track__fill"
              :style="{ width: `${Math.min(100, Math.round(lever.share * 100))}%` }"
            ></i>
          </div>

          <small>
            {{ Math.round(lever.share * 100) }}% ของเงินที่ไหลออก ·
            {{ lever.transactionCount }} รายการ ·
            <template v-if="lever.isEssential">
              ลดครึ่งหนึ่ง {{ cutLabel(lever.extraDaysIfHalved) }}
            </template>
            <template v-else>ตัดออก {{ cutLabel(lever.extraDaysIfCut) }}</template>
          </small>
        </li>
      </ul>
    </section>

    <footer class="runway-foot">
      <small>{{ confidenceNote }}</small>
      <small v-if="hasExcludedCategories">ไม่ได้เอามาคิด: {{ excludedSummary }}</small>
      <small v-if="runway.essentialShare > 0">
        ค่าอาหาร + ค่าเดินทางคิดเป็น {{ Math.round(runway.essentialShare * 100) }}%
        ของเงินที่ไหลออกต่อวัน ({{ formatBaht(runway.essentialPerDay) }}/วัน)
      </small>
    </footer>
  </section>
</template>

<style scoped>
.chart-panel {
  padding: 20px 22px 18px;
  border: 1px solid var(--line);
  border-radius: 19px;
  background: var(--paper);
  box-shadow: 0 8px 24px rgba(23, 45, 36, 0.045);
}
.chart-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.chart-eyebrow {
  color: #71877d;
  font-size: 0.57rem;
  font-weight: 800;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}
.chart-heading h2 {
  margin: 3px 0 0;
  color: var(--ink);
  font:
    700 0.95rem 'Noto Sans Thai',
    sans-serif;
}

.runway-panel {
  display: grid;
  gap: 13px;
  font-family: 'Noto Sans Thai', sans-serif;
}
.chart-heading {
  margin-bottom: 0;
}

.runway-tune {
  flex: 0 0 auto;
  min-height: 34px;
  padding: 7px 12px;
  border: 1px dashed #cfdad3;
  border-radius: 10px;
  color: #3d6754;
  background: #fff;
  font:
    700 0.6rem 'Noto Sans Thai',
    sans-serif;
  cursor: pointer;
}
.runway-tune:hover {
  border-color: #6d9c83;
  background: #f4f9f6;
}

.runway-tuning {
  display: grid;
  gap: 8px;
  padding: 11px 12px;
  border: 1px dashed #d6e0d9;
  border-radius: 13px;
  background: #f7faf8;
}
.runway-tuning p {
  margin: 0;
  color: var(--muted);
  font-size: 0.6rem;
  line-height: 1.55;
}
.runway-tuning p b {
  color: #45534c;
}
.runway-tuning > button {
  justify-self: start;
  padding: 5px 10px;
  border: 0;
  border-radius: 8px;
  color: #2f6b51;
  background: var(--green-light);
  font:
    700 0.6rem 'Noto Sans Thai',
    sans-serif;
  cursor: pointer;
}
.runway-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.runway-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 9px;
  border: 1px solid #dbe4de;
  border-radius: 999px;
  background: #fff;
  color: #45534c;
  font-size: 0.6rem;
  font-weight: 600;
  cursor: pointer;
}
.runway-chip input {
  width: 12px;
  height: 12px;
  accent-color: #2f6b51;
}
.runway-chip.is-off {
  border-color: var(--alert-line);
  color: var(--alert-muted);
  background: var(--alert-tint);
  text-decoration: line-through;
}
.runway-chip:focus-within {
  outline: 3px solid rgba(41, 116, 79, 0.22);
  outline-offset: 1px;
}

.runway-hero {
  display: grid;
  align-items: center;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
  gap: 14px;
  padding: 14px 15px;
  border: 1px solid rgba(50, 131, 91, 0.3);
  border-radius: 16px;
  background: rgba(50, 131, 91, 0.05);
}
.runway-hero--watch {
  border-color: rgba(63, 160, 171, 0.45);
  background: rgba(63, 160, 171, 0.08);
}
.runway-hero--risk {
  border-color: var(--alert-line);
  background: var(--alert-tint);
}
.runway-hero--insufficient {
  border-color: var(--line);
  background: #f7faf8;
}
.runway-hero__main {
  display: grid;
  gap: 2px;
}
.runway-hero__main small {
  color: var(--muted);
  font-size: 0.53rem;
  font-weight: 800;
  letter-spacing: 0.05em;
}
.runway-hero__main strong {
  color: #1f5c40;
  font:
    800 2rem 'Manrope',
    'Noto Sans Thai',
    sans-serif;
  line-height: 1.05;
}
.runway-hero__main strong em {
  margin-left: 5px;
  font:
    700 0.7rem 'Noto Sans Thai',
    sans-serif;
  font-style: normal;
}
.runway-hero--risk .runway-hero__main strong {
  color: var(--alert-text);
}
.runway-hero--watch .runway-hero__main strong {
  color: var(--watch-text);
}
.runway-hero__unknown {
  color: #8a978f !important;
}
.runway-hero__main p {
  margin: 3px 0 0;
  color: var(--ink);
  font-size: 0.74rem;
  font-weight: 700;
}
.runway-hero__main span {
  color: #4a6a5b;
  font-size: 0.6rem;
  line-height: 1.5;
}

.runway-facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
  gap: 7px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.runway-facts li {
  display: grid;
  gap: 1px;
  padding: 7px 9px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--paper);
}
.runway-facts small {
  color: var(--muted);
  font-size: 0.48rem;
  font-weight: 700;
}
.runway-facts b {
  color: var(--ink);
  font:
    700 0.66rem 'Manrope',
    'Noto Sans Thai',
    sans-serif;
}
.runway-facts b.is-over {
  color: var(--alert-text);
}

.runway-race {
  display: grid;
  gap: 7px;
}
.runway-race__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  color: var(--muted);
  font-size: 0.58rem;
  font-weight: 700;
}
.runway-race__head b {
  color: var(--ink);
  font:
    700 0.58rem 'Manrope',
    'Noto Sans Thai',
    sans-serif;
}

.runway-track {
  position: relative;
  overflow: hidden;
  height: 11px;
  border-radius: 999px;
  background: #edf1ec;
  box-shadow: inset 0 1px 3px rgba(23, 45, 36, 0.08);
}
.runway-track--slim {
  height: 5px;
}
.runway-track__fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #57a97c, #8fd06a);
  transition: width 0.4s cubic-bezier(0.22, 0.68, 0.35, 1);
}
.runway-hero--watch ~ .runway-race .runway-track__fill {
  background: linear-gradient(90deg, var(--watch), var(--watch-soft));
}
.runway-hero--risk ~ .runway-race .runway-track__fill {
  background: repeating-linear-gradient(-45deg, var(--alert) 0 8px, var(--alert-soft) 8px 16px);
}

.runway-target {
  margin: 0;
  color: #4a6a5b;
  font-size: 0.62rem;
  line-height: 1.6;
}
.runway-target b {
  color: var(--ink);
  font-family: 'Manrope', 'Noto Sans Thai', sans-serif;
}
.runway-target b.is-over {
  color: var(--alert-text);
}

.runway-scenarios {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.runway-scenarios li {
  display: grid;
  gap: 3px;
  padding: 10px 11px;
  border: 1px solid var(--line);
  border-radius: 13px;
}
.runway-scenarios li.is-ok {
  border-color: rgba(50, 131, 91, 0.32);
  background: rgba(50, 131, 91, 0.05);
}
.runway-scenarios li.is-risk {
  border-color: var(--alert-line);
  background: var(--alert-tint);
}
.runway-scenarios li.is-off {
  background: #f7faf8;
}
.runway-scenarios li.is-primary {
  box-shadow: 0 0 0 2px rgba(41, 116, 79, 0.14);
}
.runway-scenarios__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.runway-scenarios__head b {
  color: var(--ink);
  font-size: 0.64rem;
}
.runway-scenarios__head span {
  color: var(--ink);
  font:
    800 0.78rem 'Manrope',
    'Noto Sans Thai',
    sans-serif;
}
.runway-scenarios small {
  color: #4a6a5b;
  font-size: 0.55rem;
  font-weight: 600;
}
.runway-scenarios em {
  color: var(--muted);
  font-size: 0.5rem;
  font-style: normal;
  line-height: 1.45;
}

.runway-levers {
  display: grid;
  gap: 8px;
  padding-top: 11px;
  border-top: 1px dashed #e2e6df;
}
.runway-levers header {
  display: grid;
  gap: 2px;
}
.runway-levers header strong {
  color: var(--ink);
  font-size: 0.7rem;
}
.runway-levers header span {
  color: var(--muted);
  font-size: 0.56rem;
  line-height: 1.5;
}
.runway-levers ul {
  display: grid;
  gap: 9px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.runway-levers li {
  display: grid;
  gap: 3px;
}
.runway-lever__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.runway-lever__name {
  display: inline-flex;
  min-width: 0;
  align-items: baseline;
  gap: 5px;
  overflow: hidden;
  color: #45534c;
  font-size: 0.64rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.runway-lever__name mark {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 999px;
  color: #1f5d40;
  background: var(--lime);
  font-size: 0.5rem;
  font-weight: 800;
}
.runway-levers li.is-priority .runway-lever__name {
  color: var(--ink);
  font-weight: 700;
}
.runway-lever__head b {
  flex: 0 0 auto;
  color: #2c3b34;
  font:
    800 0.68rem 'Manrope',
    sans-serif;
}
.runway-lever__head b em {
  margin-left: 2px;
  color: #93a09a;
  font:
    700 0.54rem 'Manrope',
    sans-serif;
  font-style: normal;
}
.runway-levers small {
  color: var(--muted);
  font-size: 0.54rem;
  font-weight: 600;
}

.runway-foot {
  display: grid;
  gap: 3px;
  padding-top: 10px;
  border-top: 1px solid #ecefe9;
}
.runway-foot small {
  color: var(--muted);
  font-size: 0.54rem;
  line-height: 1.5;
}

@media (max-width: 640px) {
  .chart-panel {
    padding: 16px 13px 14px;
    border-radius: 16px;
  }
  .runway-hero {
    grid-template-columns: 1fr;
  }
  .runway-hero__main strong {
    font-size: 1.7rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .runway-track__fill {
    transition: none;
  }
}
</style>
