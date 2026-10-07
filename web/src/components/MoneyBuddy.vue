<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useForecastSettings } from '../composables/useForecastSettings'
import { useSalarySettings } from '../composables/useSalarySettings'
import { getCategoryEmoji, type Transaction, type TransactionCategory } from '../types/transaction'
import { createFinancialForecast } from '../utils/forecast'
import { formatBaht, formatDate } from '../utils/format'
import { summarizeMonthSpending } from '../utils/monthSpending'

type Mood = 'ready' | 'happy' | 'worried' | 'overwhelmed' | 'crying'

const props = defineProps<{
  income: number
  expense: number
  balance: number
  transactions: Transaction[]
  scopeLabel?: string
}>()

const emit = defineEmits<{
  editSalary: []
}>()

const { monthlySalary, salaryDay, salaryHidden } = useSalarySettings()
const {
  encouragingMode,
  excludableCategories,
  excludedCategories,
  hasExcludedCategories,
  isCategoryExcluded,
  clearExcludedCategories,
  toggleCategoryExcluded,
  toggleEncouragingMode,
} = useForecastSettings()
const reactionIndex = ref(0)
const isTapped = ref(false)
const isTuningOpen = ref(false)
let tapTimer: number | undefined
let dateRefreshTimer: number | undefined

const toLocalIsoDate = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const currentDate = ref(toLocalIsoDate(new Date()))
const refreshCurrentDate = () => {
  currentDate.value = toLocalIsoDate(new Date())
}

const forecast = computed(() =>
  createFinancialForecast({
    transactions: props.transactions,
    monthlySalary: monthlySalary.value,
    salaryDay,
    today: currentDate.value,
    excludedCategories: excludedCategories.value,
  }),
)

const excludedSummary = computed(() =>
  excludedCategories.value
    .map((category) => `${getCategoryEmoji(category)} ${category}`)
    .join(' · '),
)

const toggleTuning = () => {
  isTuningOpen.value = !isTuningOpen.value
}

const onToggleCategory = (category: TransactionCategory) => {
  toggleCategoryExcluded(category)
}

const monthSpending = computed(() =>
  summarizeMonthSpending({
    transactions: props.transactions,
    month: currentDate.value.slice(0, 7),
    monthlySalary: monthlySalary.value,
  }),
)

const spendingRatio = computed(() => monthSpending.value.ratio)

/** บอกให้ชัดว่า % ที่เห็นหารด้วยอะไร ไม่งั้นผู้ใช้เดาไม่ออกว่าเลขมาจากไหน */
const meterBaseLabel = computed(() => {
  const summary = monthSpending.value

  if (!summary.hasIncomeBase) return 'เดือนนี้ยังไม่มีรายรับและยังไม่ได้ตั้งเงินเดือน'
  if (summary.usesSalaryBase) {
    return salaryHidden.value
      ? 'เทียบกับเงินเดือนที่ตั้งไว้ (รอบนี้ยังไม่เข้า)'
      : `เทียบกับเงินเดือนที่ตั้งไว้ ${formatBaht(summary.incomeBase)}`
  }
  return `เทียบกับรายรับเดือนนี้ ${formatBaht(summary.incomeBase)}`
})

const mood = computed<Mood>(() => {
  const result = forecast.value
  const month = monthSpending.value

  if (props.income === 0 && props.expense === 0 && !result.hasSpendingData) return 'ready'
  // โหมดให้กำลังใจ: ยอดติดลบไม่ควรทำให้น้องร้องไห้ใส่หน้าผู้ใช้ทุกครั้งที่เปิดแอป
  if (props.balance < 0) return encouragingMode.value ? 'overwhelmed' : 'crying'
  // ข้อมูลยังน้อยเกินกว่าจะตัดสิน อย่าทำให้ผู้ใช้ใหม่ตกใจด้วยเลขที่ยังเชื่อไม่ได้
  if (result.status === 'insufficient') return 'ready'
  if (result.status === 'risk') return 'overwhelmed'
  if (month.expense > 0 && (!month.hasIncomeBase || spendingRatio.value >= 80)) {
    return 'overwhelmed'
  }
  if (result.status === 'watch' || spendingRatio.value >= 50) return 'worried'
  return 'happy'
})

const learningNote = computed(() => {
  const result = forecast.value
  const trustPercent = Math.round(result.estimateWeight * 100)
  return (
    `ข้อมูล ${result.historyDays} วัน ${result.expenseRecordCount} รายการ ` +
    `น้องเชื่อข้อมูลจริงอยู่ ${trustPercent}% ที่เหลือใช้ค่าอ้างอิงจากเงินเดือนแทน`
  )
})

const forecastMessage = computed(() => {
  const result = forecast.value

  if (!result.hasSpendingData) {
    return salaryHidden.value
      ? `ตั้งวันเงินเดือนไว้วันที่ ${result.salaryDay} แล้ว เริ่มจดรายจ่ายเพื่อให้คาดการณ์แม่นขึ้นนะ`
      : `ตั้งเงินเดือนไว้ ${formatBaht(result.monthlySalary)} วันที่ ${result.salaryDay} เริ่มจดรายจ่ายเพื่อให้คาดการณ์แม่นขึ้นนะ`
  }

  if (result.status === 'insufficient') {
    return (
      `ยังสรุปแนวโน้มไม่ได้นะ ${learningNote.value} ` +
      `ตอนนี้ประเมินไว้ราว ${formatBaht(result.averageDailyExpense)} ต่อวัน`
    )
  }

  if (result.status === 'risk') {
    // โหมดให้กำลังใจ: พูดถึง "ทางไป" ก่อน ไม่เอายอดติดลบขึ้นเป็นประโยคแรก
    if (encouragingMode.value) {
      if (result.safeDailyBudget !== null && result.safeDailyBudget > 0) {
        return `ช่วงนี้ตึงนิดนึง แต่มีทางไปนะ ถ้าคุมวันละราว ${formatBaht(result.safeDailyBudget)} ก็ถึงวันเงินเดือนได้`
      }
      return 'ช่วงนี้ตึงนิดนึง แต่แค่ยังจดอยู่ทุกวันก็เก่งมากแล้วนะ ค่อยๆ ไปด้วยกัน'
    }

    if (result.currentBalance < 0) {
      return `ยอดคงเหลือติดลบ ${formatBaht(Math.abs(result.currentBalance))} แล้วนะ ยังแก้ได้อยู่เลย สู้ๆ!`
    }
    if (result.balanceBeforeSalary < 0) {
      return 'ถ้าใช้ใกล้เคียงเดิม อาจขาดอีกนิดก่อนเงินเดือนออก ลองดูรายการที่ยืดหยุ่นได้บ้างนะ'
    }
    return 'แนวโน้มอีก 30 วัน ยอดอาจลดลงมานิดนึง แต่ยังแก้ได้นะ ค่อยๆ ปรับด้วยกันเลย'
  }

  if (result.status === 'watch') {
    if (encouragingMode.value) {
      return `ใช้เฉลี่ยวันละ ${formatBaht(result.averageDailyExpense)} กำลังพอดีๆ อยู่นะ เว้นรายการที่รอได้อีกนิดก็สบายเลย`
    }
    return `ช่วงนี้ใช้เฉลี่ย ${formatBaht(result.averageDailyExpense)} ต่อวัน น้องเห็นแล้วนะ ลองดูรายการที่รอได้ด้วยกันไหม`
  }

  return `ถ้าใช้จ่ายใกล้เคียงเดิม ก่อนเงินเดือนเข้าคาดว่าจะเหลือ ${formatBaht(result.balanceBeforeSalary)}`
})

/**
 * ประโยคเชียร์ที่อ้างข้อมูลจริง ไม่ใช่คำปลอบลอยๆ
 * ใช้เฉพาะโหมดให้กำลังใจ และเฉพาะอารมณ์ที่ผู้ใช้กำลังเครียด
 */
const cheerLines = computed(() => {
  if (!encouragingMode.value) return []

  const result = forecast.value
  const lines: string[] = []

  if (result.daysUntilSalary > 0) {
    lines.push(`อีก ${result.daysUntilSalary} วันเงินเดือนก็เข้าแล้ว ตัวเลขจะกลับมาดูใจดีขึ้นเองนะ`)
  }
  if (result.expenseRecordCount > 0) {
    lines.push(
      `จดมาแล้ว ${result.expenseRecordCount} รายการใน ${result.historyDays} วัน ` +
        'แค่นี้ก็ชนะคนที่ไม่เคยรู้ว่าเงินหายไปไหนแล้วนะ',
    )
  }
  if (result.excludedExpenseCount > 0) {
    lines.push(`กัน ${excludedSummary.value} ออกจากสูตรไว้แล้ว ตัวเลขที่เห็นคือส่วนที่ปรับได้จริงๆ`)
  }
  if (result.safeDailyBudget !== null && result.safeDailyBudget > 0) {
    lines.push(
      `เป้าง่ายๆ วันนี้: ใช้ไม่เกิน ${formatBaht(result.safeDailyBudget)} เท่านี้ก็ผ่านแล้ว`,
    )
  }

  lines.push('เดือนนี้ไม่ได้ตัดสินอะไรทั้งนั้น พรุ่งนี้เริ่มใหม่ได้ทุกวันเลยนะ 🌤️')
  return lines
})

const messages = computed<Record<Mood, string[]>>(() => ({
  ready: [
    forecastMessage.value,
    'พร้อมช่วยดูแลเงินแล้ว เพิ่มรายการแรกได้เลย!',
    'เริ่มจากบันทึกรายรับหรือรายจ่ายวันนี้ก่อนก็ได้นะ',
  ],
  happy: [
    forecastMessage.value,
    'เก่งมาก! แนวโน้มการเงินยังอยู่ในระดับสบายใจ 🎉',
    `ยอดคงเหลือถึงวันนี้ ${formatBaht(forecast.value.currentBalance)} รักษาจังหวะนี้ไว้นะ`,
    'บันทึกครบ วางแผนได้ดี น้องภูมิใจแทนเลย!',
  ],
  worried: [
    forecastMessage.value,
    ...cheerLines.value,
    'ไม่เป็นไรนะ ลองดูรายการย้อนหลังด้วยกันไหม อาจมีบางอย่างที่ตัดออกได้',
    'ก่อนซื้อครั้งหน้า ลองถามตัวเองว่า “ต้องการจริงๆ ไหม” ได้ผลมากเลย',
    'น้องอยู่ตรงนี้ ค่อยๆ ปรับด้วยกันได้เลย',
  ],
  overwhelmed: [
    forecastMessage.value,
    ...cheerLines.value,
    'เดือนนี้ใช้เยอะหน่อย แต่โอเคนะ ทุกคนก็มีช่วงแบบนี้ 💪',
    'ไม่ต้องโทษตัวเองนะ แค่รู้แล้วก็ดีกว่าไม่รู้เยอะเลย',
    'ลองดูว่ามีรายการไหนที่เดือนหน้าลดได้บ้าง ทีละนิดก็ช่วยได้นะ',
    'น้องเชื่อว่าเดือนหน้าจะดีขึ้นแน่ๆ!',
  ],
  crying: [
    forecastMessage.value,
    ...cheerLines.value,
    'น้องเป็นห่วงนะ แต่ยังแก้ได้อยู่เลย อย่าเพิ่งกังวลมาก',
    'ค่อยๆ ดูทีละรายการ บางทีแค่งดของไม่จำเป็นก็ช่วยได้เยอะนะ',
    'น้องอยู่ตรงนี้ เดินผ่านช่วงนี้ไปด้วยกันได้เลย 🤝',
  ],
}))

const message = computed(() => {
  const choices = messages.value[mood.value]
  return choices[reactionIndex.value % choices.length]
})

const statusLabel = computed(() => {
  if (mood.value === 'ready') {
    return forecast.value.hasSpendingData ? 'กำลังเรียนรู้' : 'รอข้อมูลแรก'
  }
  if (mood.value === 'happy') return 'สบายดี'
  if (mood.value === 'worried') return 'มีเรื่องบอก'
  if (mood.value === 'overwhelmed') return 'สู้ๆ นะ'
  return 'ยากนิดนึง'
})

const forecastStatusLabel = computed(() => {
  if (forecast.value.status === 'insufficient') return 'กำลังเรียนรู้'
  if (forecast.value.status === 'safe') return 'แนวโน้มสบายใจ'
  if (forecast.value.status === 'watch') return 'ค่อยๆ ดูกัน'
  return 'ยังปรับได้'
})

const forecastConfidenceLabel = computed(() => {
  if (forecast.value.confidence === 'high') return 'ความมั่นใจสูง (ข้อมูลเกิน 2 รอบเงินเดือน)'
  if (forecast.value.confidence === 'medium') return 'ความมั่นใจปานกลาง'
  return 'ข้อมูลยังน้อย ยังไม่เตือนแนวโน้ม'
})

const nextSalaryTiming = computed(() => {
  if (forecast.value.daysUntilSalary === 0) return 'วันนี้'
  if (forecast.value.daysUntilSalary === 1) return 'พรุ่งนี้'
  return `อีก ${forecast.value.daysUntilSalary} วัน`
})

/**
 * "เงินอยู่ได้อีกกี่วัน" = ยอดคงเหลือรวม ÷ รายจ่ายเฉลี่ยต่อวัน
 * ตัวเลขมาจาก forecast.estimatedMoneyLastsDays จึงใช้ค่าเฉลี่ยชุดเดียวกับการ์ดอื่น
 */
const runwayDays = computed(() => forecast.value.estimatedMoneyLastsDays)

const runwayLabel = computed(() => {
  if (forecast.value.currentBalance <= 0) return 'เงินหมดแล้ว'
  if (runwayDays.value === null) return 'รอข้อมูล'
  if (runwayDays.value > 365) return 'เกิน 365 วัน'
  return `${runwayDays.value} วัน`
})

const runwayLevel = computed(() => {
  if (forecast.value.currentBalance <= 0) return 'risk'
  if (runwayDays.value === null) return 'unknown'
  if (runwayDays.value <= 7) return 'risk'
  if (runwayDays.value < forecast.value.daysUntilSalary) return 'watch'
  return 'safe'
})

/** เทียบ runway กับวันเงินเดือน เพื่อบอกว่าพอถึงรอบหน้าหรือขาดอีกกี่วัน */
const runwayVsSalary = computed(() => {
  if (runwayDays.value === null || forecast.value.currentBalance <= 0) return null

  const gap = runwayDays.value - forecast.value.daysUntilSalary
  if (gap >= 0) return `พอถึงวันเงินเดือน เผื่อได้อีก ${gap} วัน`
  return `ขาดอีกประมาณ ${Math.abs(gap)} วันก่อนเงินเดือนเข้า`
})

const forecastAdvice = computed(() => {
  const result = forecast.value

  if (!result.hasSpendingData) {
    return 'บันทึกรายจ่ายเพิ่มอีกนิดนึงแล้วน้องจะวิเคราะห์แนวโน้มให้ได้เลยนะ!'
  }

  if (result.status === 'insufficient') {
    return result.hasFullCycleData
      ? 'ข้อมูลครบรอบแล้ว แต่ยังน้อยอยู่ บันทึกต่อไปแล้วน้องจะแม่นขึ้นเรื่อยๆ นะ'
      : 'ค่าเฉลี่ยช่วงต้นรอบอาจคลาดเคลื่อนได้นะ รอให้ครบรอบก่อนแล้วจะแม่นขึ้นเอง'
  }

  if (result.status === 'risk') {
    if (result.safeDailyBudget !== null) {
      return `ถ้าลองคุมวันละประมาณ ${formatBaht(result.safeDailyBudget)} น่าจะพอถึงวันเงินเดือนออกได้สบายๆ นะ!`
    }
    return 'ลองดูรายการที่ลดได้ก่อนนะ บางทีแค่ไม่กี่รายการก็ทำให้เบาขึ้นเยอะเลย'
  }

  if (result.status === 'watch') {
    const monthlyTrend = result.averageDailyExpense * 30
    if (encouragingMode.value) {
      return monthlyTrend > result.monthlySalary
        ? `แนวโน้มเดือนนี้เกินงบอยู่ ${formatBaht(monthlyTrend - result.monthlySalary)} เฉลี่ยแล้วแค่วันละ ${formatBaht((monthlyTrend - result.monthlySalary) / 30)} เท่านั้น ลดตรงนี้ได้ก็กลับมาบวกแล้วนะ`
        : 'รายจ่ายเริ่มใกล้งบนิดนึง ไม่มีอะไรน่าตกใจนะ แค่ลองเว้นรายการที่รอได้ก็ช่วยได้มากเลย'
    }
    if (monthlyTrend > result.monthlySalary) {
      return `แนวโน้ม 30 วันสูงกว่าเงินเดือนประมาณ ${formatBaht(monthlyTrend - result.monthlySalary)} ลองดูรายการที่ไม่ด่วนก่อนนะ`
    }
    return 'รายจ่ายเริ่มใกล้งบนิดนึง ไม่มีอะไรน่าตกใจนะ แค่ลองเว้นรายการที่รอได้ก็ช่วยได้มากเลย'
  }

  return `หลังเงินเดือนรอบหน้าเข้า คาดว่าจะมี ${formatBaht(result.balanceAfterSalary)} ถ้าพฤติกรรมใกล้เคียงเดิม 👍`
})

const progressWidth = computed(() => `${Math.min(spendingRatio.value, 100)}%`)

const react = () => {
  reactionIndex.value += 1
  isTapped.value = false
  window.clearTimeout(tapTimer)
  requestAnimationFrame(() => {
    isTapped.value = true
    tapTimer = window.setTimeout(() => {
      isTapped.value = false
    }, 520)
  })
}

onMounted(() => {
  refreshCurrentDate()
  dateRefreshTimer = window.setInterval(refreshCurrentDate, 60_000)
  window.addEventListener('focus', refreshCurrentDate)
})

onBeforeUnmount(() => {
  window.clearTimeout(tapTimer)
  window.clearInterval(dateRefreshTimer)
  window.removeEventListener('focus', refreshCurrentDate)
})
</script>

<template>
  <section class="buddy-card" :class="`buddy-card--${mood}`" aria-labelledby="buddy-title">
    <div class="buddy-copy">
      <div class="buddy-heading">
        <span class="buddy-kicker">เพื่อนดูแลกระเป๋า</span>
        <span class="mood-badge"><i></i>{{ statusLabel }}</span>
      </div>
      <h2 id="buddy-title">
        น้องถุงเงิน
        <small v-if="scopeLabel">{{ scopeLabel }}</small>
      </h2>

      <button class="speech" type="button" aria-label="คุยกับน้องถุงเงิน" @click="react">
        <span aria-live="polite">{{ message }}</span>
        <small>แตะเพื่อคุยกับน้อง</small>
      </button>

      <div class="spending-meter">
        <div class="meter-label">
          <span>เดือนนี้ใช้ไป {{ spendingRatio }}% ของรายรับ</span>
          <strong>{{ formatBaht(monthSpending.expense) }}</strong>
        </div>
        <div
          class="meter-track"
          role="progressbar"
          aria-label="สัดส่วนรายจ่ายเดือนนี้ต่อรายรับเดือนนี้"
          :aria-valuenow="Math.min(spendingRatio, 100)"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <span :style="{ width: progressWidth }"></span>
        </div>
        <div class="meter-zones" aria-hidden="true">
          <span>สบายใจ</span><span>ระวัง</span><span>สูง</span>
        </div>
        <p class="meter-base">{{ meterBaseLabel }}</p>
      </div>
    </div>

    <button
      class="buddy-button"
      :class="{ 'is-tapped': isTapped }"
      type="button"
      aria-label="แตะน้องถุงเงิน"
      @click="react"
    >
      <span v-if="mood === 'happy'" class="spark spark--one" aria-hidden="true">✦</span>
      <span v-if="mood === 'happy'" class="spark spark--two" aria-hidden="true">✦</span>
      <span v-if="mood === 'crying'" class="puddle" aria-hidden="true"></span>

      <svg
        class="buddy"
        viewBox="0 0 220 220"
        role="img"
        :aria-label="`น้องถุงเงินกำลัง${statusLabel}`"
      >
        <path class="shadow" d="M43 193c0-13 31-23 69-23s68 10 68 23-30 18-68 18-69-5-69-18Z" />
        <g class="vamp-horns" aria-hidden="true">
          <path class="horn horn--left" d="M88 56C69 50 60 34 65 11c5 12 14 20 29 23l-6 22Z" />
          <path class="horn horn--right" d="M130 56c19-6 28-22 23-45-5 12-14 20-29 23l6 22Z" />
        </g>
        <path
          class="knot"
          d="M75 52c7-11 13-20 14-34 12 6 22 6 35 0 2 13 9 24 18 34-18 12-48 11-67 0Z"
        />
        <path class="tie" d="M70 50c17-9 57-9 75 0l-8 17c-18-7-42-7-59 0L70 50Z" />
        <path
          class="body"
          d="M77 61c18-9 43-9 61 0 15 20 38 50 38 84 0 39-27 59-68 59s-67-20-67-59c0-34 22-64 36-84Z"
        />
        <path class="belly" d="M61 142c0-28 20-57 47-57s47 29 47 57-17 47-47 47-47-19-47-47Z" />
        <path class="arm arm--left" d="M48 117c-18 5-25 19-19 34 3 7 9 10 15 7" />
        <path class="arm arm--right" d="M168 117c18 5 25 19 19 34-3 7-9 10-15 7" />

        <g class="face" :class="`face--${mood}`">
          <template v-if="mood === 'happy'">
            <path class="eye-line" d="M82 120c5-7 12-7 17 0" />
            <path class="eye-line" d="M118 120c5-7 12-7 17 0" />
            <path class="mouth-line" d="M92 141c9 12 24 12 33 0" />
            <circle class="cheek" cx="78" cy="139" r="7" />
            <circle class="cheek" cx="139" cy="139" r="7" />
          </template>

          <template v-else-if="mood === 'worried'">
            <path class="brow" d="M78 108l18 5" />
            <path class="brow" d="M139 108l-18 5" />
            <ellipse class="eye" cx="89" cy="122" rx="5" ry="7" />
            <ellipse class="eye" cx="128" cy="122" rx="5" ry="7" />
            <path class="mouth-line" d="M96 151c7-7 18-7 25 0" />
          </template>

          <template v-else-if="mood === 'overwhelmed'">
            <path class="brow" d="M80 110l16 3" />
            <path class="brow" d="M137 110l-16 3" />
            <ellipse class="eye" cx="89" cy="122" rx="5" ry="7" />
            <ellipse class="eye" cx="128" cy="122" rx="5" ry="7" />
            <path class="mouth-line" d="M97 146c5 5 18 5 23 0" />
            <circle class="cheek" cx="78" cy="139" r="5" opacity="0.5" />
            <circle class="cheek" cx="139" cy="139" r="5" opacity="0.5" />
          </template>

          <template v-else-if="mood === 'crying'">
            <path class="brow" d="M78 111l17-6" />
            <path class="brow" d="M139 111l-17-6" />
            <path class="eye-line" d="M80 124c6 5 13 5 19 0" />
            <path class="eye-line" d="M117 124c6 5 13 5 19 0" />
            <path class="mouth-fill" d="M94 153c5-15 23-15 29 0-8 7-20 7-29 0Z" />
            <path
              class="tear tear--left"
              d="M84 129c-1 9-8 15-5 22 3 7 12 7 15 0 3-7-6-14-10-22Z"
            />
            <path
              class="tear tear--right"
              d="M132 129c1 9 8 15 5 22-3 7-12 7-15 0-3-7 6-14 10-22Z"
            />
          </template>

          <template v-else>
            <ellipse class="eye" cx="89" cy="122" rx="5" ry="7" />
            <ellipse class="eye" cx="128" cy="122" rx="5" ry="7" />
            <path class="mouth-line" d="M99 145h19" />
          </template>
        </g>
        <text class="baht" x="108" y="95" text-anchor="middle">฿</text>
      </svg>
    </button>

    <section
      class="forecast-panel"
      :class="`forecast-panel--${forecast.status}`"
      aria-labelledby="forecast-title"
    >
      <header class="forecast-heading">
        <div>
          <span>วิเคราะห์อนาคต</span>
          <h3 id="forecast-title">คาดการณ์ 30 วัน</h3>
        </div>
        <div class="forecast-heading__actions">
          <span class="forecast-status">{{ forecastStatusLabel }}</span>
          <button
            class="forecast-tune"
            type="button"
            :aria-expanded="isTuningOpen"
            aria-controls="forecast-tuning"
            @click="toggleTuning"
          >
            ปรับสูตร
          </button>
          <button type="button" @click="emit('editSalary')">ตั้งค่า</button>
        </div>
      </header>

      <div v-if="isTuningOpen" id="forecast-tuning" class="forecast-tuning">
        <label class="tuning-switch">
          <input type="checkbox" :checked="encouragingMode" @change="toggleEncouragingMode()" />
          <span>
            <strong>โหมดให้กำลังใจ</strong>
            พูดถึงทางออกก่อนยอดติดลบ และไม่ทำหน้าร้องไห้ใส่
          </span>
        </label>

        <fieldset class="tuning-group">
          <legend>ไม่เอาหมวดนี้มาคิดในสูตรคาดการณ์</legend>
          <div class="tuning-categories">
            <label
              v-for="option in excludableCategories"
              :key="option.value"
              :class="{ 'is-on': isCategoryExcluded(option.value) }"
            >
              <input
                type="checkbox"
                :checked="isCategoryExcluded(option.value)"
                @change="onToggleCategory(option.value)"
              />
              <span>{{ option.emoji }} {{ option.value }}</span>
            </label>
          </div>
          <p class="tuning-note">
            เหมาะกับค่าที่จ่ายก้อนเดียวทุกเดือนอย่างค่าที่พัก ยอดคงเหลือจริงยังนับครบทุกหมวดเสมอ
            กันออกมีผลแค่กับตัวเลขคาดการณ์
          </p>
          <button
            v-if="hasExcludedCategories"
            class="tuning-reset"
            type="button"
            @click="clearExcludedCategories()"
          >
            รวมทุกหมวดกลับ
          </button>
        </fieldset>
      </div>

      <div class="forecast-metrics">
        <article>
          <span>รายจ่ายเฉลี่ย / วัน</span>
          <strong>
            {{ forecast.hasSpendingData ? formatBaht(forecast.averageDailyExpense) : 'รอข้อมูล' }}
          </strong>
          <small v-if="forecast.isEstimateBlended" :title="learningNote">
            ค่าประมาณ · จริง {{ formatBaht(forecast.observedDailyExpense) }} จากข้อมูล
            {{ forecast.historyDays }} วัน
          </small>
          <small v-else-if="forecast.hasSpendingData">
            {{ forecast.historyDays }} วัน · {{ forecast.expenseRecordCount }} รายการ
          </small>
          <small v-else>เริ่มจดรายจ่ายเพื่อวิเคราะห์</small>
          <small v-if="forecast.excludedExpenseCount > 0" class="forecast-excluded">
            ไม่รวม {{ excludedSummary }} · กันออก {{ formatBaht(forecast.excludedExpenseTotal) }}
          </small>
        </article>

        <article>
          <span>เงินอยู่ได้อีกกี่วัน</span>
          <strong
            :class="{
              'is-negative': runwayLevel === 'risk' && !encouragingMode,
              'is-soft': runwayLevel === 'risk' && encouragingMode,
            }"
          >
            {{ runwayLabel }}
          </strong>
          <small v-if="runwayDays !== null">
            {{ formatBaht(forecast.currentBalance) }} ÷ วันละ
            {{ formatBaht(forecast.averageDailyExpense) }}
          </small>
          <small v-else>เริ่มจดรายจ่ายแล้วน้องจะคำนวณให้</small>
          <small v-if="forecast.moneyRunsOutDate">
            หมดประมาณ
            <time :datetime="forecast.moneyRunsOutDate">
              {{ formatDate(forecast.moneyRunsOutDate) }}
            </time>
            · เงินเดือนเข้า{{ nextSalaryTiming }}
          </small>
          <small v-if="runwayVsSalary" class="forecast-runway-gap">{{ runwayVsSalary }}</small>
        </article>

        <article>
          <span>คาดว่าก่อนเงินเดือนเข้า</span>
          <strong
            :class="{
              'is-negative': forecast.balanceBeforeSalary < 0 && !encouragingMode,
              'is-soft': forecast.balanceBeforeSalary < 0 && encouragingMode,
            }"
          >
            {{ formatBaht(forecast.balanceBeforeSalary) }}
          </strong>
          <small>หักรายจ่ายคาดการณ์ {{ formatBaht(forecast.projectedExpenseUntilSalary) }}</small>
        </article>

        <article>
          <span>ยอดคาดการณ์อีก 30 วัน</span>
          <strong
            :class="{
              'is-negative': forecast.projectedBalance30Days < 0 && !encouragingMode,
              'is-soft': forecast.projectedBalance30Days < 0 && encouragingMode,
            }"
          >
            {{ formatBaht(forecast.projectedBalance30Days) }}
          </strong>
          <small>
            รายจ่าย {{ formatBaht(forecast.projectedExpense30Days) }} · เงินเดือน
            {{ forecast.salaryPaymentsIn30Days }} รอบ
          </small>
          <small
            v-if="encouragingMode && forecast.projectedBalance30Days < 0"
            class="forecast-reframe"
          >
            นี่คือภาพ “ถ้าไม่เปลี่ยนอะไรเลย” ซึ่งเปลี่ยนได้ทุกวันนะ
          </small>
        </article>
      </div>

      <p class="forecast-advice">{{ forecastAdvice }}</p>
      <footer>
        {{ forecastConfidenceLabel }} · คำนวณจากข้อมูลสูงสุด 90 วัน · เงินเดือนวันที่
        {{ forecast.salaryDay }} (ก.พ. ใช้วันสุดท้าย)
        <template v-if="forecast.isEstimateBlended"> · {{ learningNote }}</template>
        <template v-if="hasExcludedCategories"> · ไม่รวม {{ excludedSummary }} ในสูตร</template>
      </footer>
    </section>
  </section>
</template>

<style scoped>
.buddy-card {
  position: relative;
  display: grid;
  min-height: 270px;
  grid-template-columns: minmax(0, 1.4fr) minmax(220px, 0.6fr);
  align-items: center;
  gap: 24px;
  margin-top: 20px;
  padding: 27px 34px;
  overflow: hidden;
  border: 1px solid #dce7df;
  border-radius: 20px;
  background: linear-gradient(125deg, #f8fcf9 0%, #edf7f1 68%, #e3f4e9 100%);
  box-shadow: 0 12px 40px rgba(23, 45, 36, 0.055);
  transition:
    background 0.4s,
    border-color 0.4s;
}

.buddy-card::after {
  position: absolute;
  right: -60px;
  top: -110px;
  width: 330px;
  height: 330px;
  border: 1px solid rgba(51, 143, 101, 0.12);
  border-radius: 50%;
  box-shadow:
    0 0 0 55px rgba(51, 143, 101, 0.035),
    0 0 0 110px rgba(51, 143, 101, 0.02);
  content: '';
  pointer-events: none;
}

.buddy-card--worried {
  border-color: var(--watch-line);
  background: linear-gradient(125deg, #fbfeff, var(--watch-tint));
}

.buddy-card--overwhelmed {
  border-color: var(--alert-line);
  background: linear-gradient(125deg, #fdfcff, var(--alert-tint));
}

.buddy-card--crying {
  border-color: #d5e2ed;
  background: linear-gradient(125deg, #f8fbfd, #e8f1f7);
}

.buddy-copy {
  position: relative;
  z-index: 2;
}

.buddy-heading {
  display: flex;
  align-items: center;
  gap: 12px;
}

.buddy-kicker {
  color: #57806e;
  font-size: 0.64rem;
  font-weight: 800;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}

.mood-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  border-radius: 999px;
  color: #42725d;
  background: rgba(66, 145, 103, 0.1);
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.62rem;
  font-weight: 700;
}

.mood-badge i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #42a172;
}

.buddy-card--worried .mood-badge {
  color: var(--watch-text);
  background: rgba(63, 160, 171, 0.13);
}

.buddy-card--worried .mood-badge i {
  background: var(--watch);
}

.buddy-card--overwhelmed .mood-badge {
  color: var(--alert-text);
  background: var(--alert-tint);
}

.buddy-card--overwhelmed .mood-badge i {
  background: var(--alert-soft);
}

.buddy-card--crying .mood-badge {
  color: #557993;
  background: rgba(77, 127, 163, 0.11);
}

.buddy-card--crying .mood-badge i {
  background: #6496b9;
}

.buddy-copy h2 {
  margin: 6px 0 13px;
  color: var(--ink);
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: clamp(1.25rem, 2vw, 1.65rem);
}

.buddy-copy h2 small {
  display: inline-block;
  margin-left: 4px;
  padding: 3px 6px;
  border-radius: 999px;
  color: #517565;
  background: rgba(55, 139, 98, 0.1);
  font-size: 0.52rem;
  font-weight: 700;
  vertical-align: middle;
}

.speech {
  position: relative;
  display: flex;
  width: min(100%, 560px);
  align-items: flex-start;
  flex-direction: column;
  gap: 4px;
  padding: 13px 16px;
  border: 1px solid #dce6df;
  border-radius: 13px;
  outline: none;
  color: #34443d;
  background: rgba(255, 255, 255, 0.82);
  text-align: left;
  box-shadow: 0 5px 18px rgba(27, 67, 49, 0.055);
  transition:
    transform 0.2s,
    border-color 0.2s;
}

.speech::after {
  position: absolute;
  right: -9px;
  top: 22px;
  width: 16px;
  height: 16px;
  border-top: 1px solid #dce6df;
  border-right: 1px solid #dce6df;
  background: #fff;
  content: '';
  transform: rotate(45deg);
}

.speech:hover,
.speech:focus-visible {
  border-color: #87aa9a;
  transform: translateY(-1px);
}

.speech span {
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.82rem;
  font-weight: 600;
  line-height: 1.5;
}

.speech small {
  color: #8b9791;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.6rem;
}

.spending-meter {
  max-width: 560px;
  margin-top: 16px;
}

.meter-label,
.meter-zones {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-family: 'Noto Sans Thai', sans-serif;
}

.meter-label {
  margin-bottom: 7px;
  color: #64726c;
  font-size: 0.66rem;
}

.meter-label strong {
  color: var(--ink);
  font-family: 'Manrope', sans-serif;
  font-size: 0.7rem;
}

.meter-base {
  margin: 6px 0 0;
  color: #7d8b85;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.58rem;
}

.meter-track {
  height: 9px;
  overflow: hidden;
  border-radius: 99px;
  background: linear-gradient(
    90deg,
    #dfece5 0 50%,
    var(--watch-line) 50% 80%,
    var(--alert-line) 80%
  );
}

.meter-track > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #3c966a;
  box-shadow: 2px 0 6px rgba(26, 92, 62, 0.2);
  transition:
    width 0.65s cubic-bezier(0.2, 0.8, 0.2, 1),
    background 0.3s;
}

.buddy-card--worried .meter-track > span {
  background: var(--watch);
}

.buddy-card--crying .meter-track > span {
  background: var(--alert-soft);
}

.meter-zones {
  margin-top: 5px;
  color: #9aa39f;
  font-size: 0.55rem;
}

.forecast-panel {
  position: relative;
  z-index: 2;
  display: grid;
  grid-column: 1 / -1;
  gap: 11px;
  margin-top: 3px;
  padding: 15px;
  border: 1px solid rgba(70, 126, 98, 0.18);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.76);
  font-family: 'Noto Sans Thai', sans-serif;
  box-shadow: 0 6px 20px rgba(26, 68, 49, 0.045);
}

.forecast-heading,
.forecast-heading__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.forecast-heading > div:first-child > span {
  display: block;
  color: #678174;
  font-size: 0.54rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.forecast-heading h3 {
  margin: 2px 0 0;
  color: #22362d;
  font-size: 0.82rem;
}

.forecast-status {
  padding: 4px 7px;
  border-radius: 999px;
  color: #337052;
  background: #e5f3eb;
  font-size: 0.55rem;
  font-weight: 800;
  white-space: nowrap;
}

.forecast-panel--insufficient .forecast-status {
  color: #65766e;
  background: #edf1ef;
}

.forecast-panel--watch .forecast-status {
  color: var(--watch-ink);
  background: var(--watch-line);
}

.forecast-panel--risk .forecast-status {
  color: var(--alert-ink);
  background: var(--alert-line);
}

.forecast-heading__actions button {
  padding: 4px 7px;
  border: 1px solid #c9d9d0;
  border-radius: 7px;
  color: #35664f;
  background: #fff;
  font-family: inherit;
  font-size: 0.55rem;
  font-weight: 700;
  white-space: nowrap;
}

.forecast-heading__actions button:hover,
.forecast-heading__actions button:focus-visible {
  border-color: #6f9b84;
  background: #f3f8f5;
}

.forecast-heading__actions button:focus-visible {
  outline: 3px solid rgba(41, 116, 79, 0.28);
  outline-offset: 1px;
}

.forecast-metrics small.forecast-runway-gap {
  margin-top: 4px;
  color: #4a6b58;
  font-weight: 700;
}

.forecast-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 7px;
}

.forecast-metrics article {
  min-width: 0;
  padding: 10px;
  border: 1px solid #e1e9e4;
  border-radius: 10px;
  background: rgba(248, 251, 249, 0.92);
}

.forecast-metrics span,
.forecast-metrics strong,
.forecast-metrics small {
  display: block;
}

.forecast-metrics span {
  min-height: 2.6em;
  color: #74847c;
  font-size: 0.57rem;
  font-weight: 700;
  line-height: 1.3;
}

.forecast-metrics strong {
  margin-top: 4px;
  overflow-wrap: anywhere;
  color: #244d3a;
  font-family: 'Manrope', 'Noto Sans Thai', sans-serif;
  font-size: 0.75rem;
  line-height: 1.25;
}

.forecast-metrics strong.is-negative {
  color: var(--alert-text);
}

/* โหมดให้กำลังใจ: ยังบอกว่าติดลบด้วยตัวเลขจริง แต่ไม่ตะโกนด้วยสีแดง */
.forecast-metrics strong.is-soft {
  color: #7d6a94;
}

.forecast-metrics small.forecast-excluded {
  margin-top: 5px;
  padding: 3px 6px;
  border-radius: 6px;
  color: #5c6f97;
  background: rgba(92, 111, 151, 0.09);
  font-weight: 700;
}

.forecast-metrics small.forecast-reframe {
  color: #7d6a94;
  font-weight: 700;
}

.forecast-tuning {
  display: grid;
  gap: 10px;
  padding: 11px 12px;
  border: 1px dashed #c6d8cd;
  border-radius: 11px;
  background: rgba(247, 251, 248, 0.95);
}

.tuning-switch {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: #3f5e50;
  font-size: 0.6rem;
  line-height: 1.45;
}

.tuning-switch strong {
  display: block;
  color: #244d3a;
  font-size: 0.63rem;
}

.tuning-group {
  margin: 0;
  padding: 0;
  border: 0;
}

.tuning-group legend {
  padding: 0 0 6px;
  color: #74847c;
  font-size: 0.57rem;
  font-weight: 800;
}

.tuning-categories {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tuning-categories label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border: 1px solid #d5e2db;
  border-radius: 999px;
  color: #436655;
  background: #fff;
  font-size: 0.57rem;
  font-weight: 700;
  cursor: pointer;
  transition:
    border-color 0.16s,
    background 0.16s,
    color 0.16s;
}

.tuning-categories label.is-on {
  border-color: #8d9fc4;
  color: #3f4f74;
  background: #eef2fa;
}

.tuning-categories input,
.tuning-switch input {
  width: 13px;
  height: 13px;
  margin: 0;
  accent-color: #35664f;
  flex: none;
}

.tuning-note {
  margin: 7px 0 0;
  color: #8b9690;
  font-size: 0.52rem;
  line-height: 1.45;
}

.tuning-reset {
  margin-top: 7px;
  padding: 4px 8px;
  border: 1px solid #c9d9d0;
  border-radius: 7px;
  color: #35664f;
  background: #fff;
  font-family: inherit;
  font-size: 0.55rem;
  font-weight: 700;
}

.forecast-metrics small {
  margin-top: 4px;
  color: #8b9690;
  font-size: 0.5rem;
  line-height: 1.35;
}

.forecast-advice {
  margin: 0;
  padding: 9px 11px;
  border-left: 3px solid #55a278;
  border-radius: 4px 9px 9px 4px;
  color: #3f5e50;
  background: #edf7f1;
  font-size: 0.62rem;
  font-weight: 600;
  line-height: 1.5;
}

.forecast-panel--watch .forecast-advice {
  border-left-color: var(--watch);
  color: var(--watch-ink);
  background: var(--watch-tint);
}

.forecast-panel--risk .forecast-advice {
  border-left-color: var(--alert-soft);
  color: var(--alert-ink);
  background: var(--alert-tint);
}

.forecast-panel footer {
  color: #929d97;
  font-size: 0.48rem;
  line-height: 1.4;
}

.compact-buddy .forecast-panel {
  gap: 8px;
  margin-top: 5px;
  padding: 11px;
  border-radius: 12px;
}

.compact-buddy .forecast-heading {
  align-items: flex-start;
  flex-wrap: wrap;
}

.compact-buddy .forecast-heading h3 {
  font-size: 0.72rem;
}

.compact-buddy .forecast-heading__actions {
  gap: 5px;
}

.compact-buddy .forecast-metrics {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.compact-buddy .forecast-metrics article {
  padding: 8px;
}

.compact-buddy .forecast-metrics span {
  min-height: 0;
  font-size: 0.51rem;
}

.compact-buddy .forecast-metrics strong {
  font-size: 0.65rem;
}

.compact-buddy .forecast-metrics small {
  font-size: 0.46rem;
}

.compact-buddy .forecast-advice {
  padding: 8px 9px;
  font-size: 0.55rem;
}

.buddy-button {
  position: relative;
  z-index: 2;
  width: 230px;
  justify-self: center;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  filter: drop-shadow(0 13px 12px rgba(29, 74, 54, 0.13));
  cursor: pointer;
}

.buddy-button:hover .buddy {
  transform: translateY(-5px) rotate(1deg);
}

.buddy-button:focus-visible {
  border-radius: 50%;
  box-shadow: 0 0 0 4px rgba(53, 144, 101, 0.24);
}

.buddy-button.is-tapped .buddy {
  animation: buddy-tap 0.5s cubic-bezier(0.2, 0.9, 0.3, 1.3);
}

.buddy {
  display: block;
  width: 100%;
  overflow: visible;
  transition: transform 0.25s ease;
  animation: buddy-float 3.5s ease-in-out infinite;
}

.shadow {
  fill: rgba(30, 73, 53, 0.13);
}
.knot {
  fill: #77c99a;
  stroke: #1e714d;
  stroke-width: 5;
  stroke-linejoin: round;
}
.tie {
  fill: #c9f06c;
  stroke: #1e714d;
  stroke-width: 5;
  stroke-linejoin: round;
}
.body {
  fill: #5fba85;
  stroke: #1e714d;
  stroke-width: 6;
  stroke-linejoin: round;
}
.belly {
  fill: #86d5a5;
  opacity: 0.7;
}
.arm {
  fill: none;
  stroke: #1e714d;
  stroke-width: 7;
  stroke-linecap: round;
}
.eye {
  fill: #173c2d;
}
.eye-line,
.mouth-line,
.brow {
  fill: none;
  stroke: #173c2d;
  stroke-width: 6;
  stroke-linecap: round;
}
.mouth-fill {
  fill: #733b42;
  stroke: #173c2d;
  stroke-width: 4;
}
.cheek {
  fill: #f2a8c4;
  opacity: 0.72;
}
.tear {
  fill: #77c9ef;
  stroke: #4388a8;
  stroke-width: 2;
  transform-origin: center;
  animation: tear-drop 1.25s ease-in infinite;
}
.tear--right {
  animation-delay: 0.35s;
}
.baht {
  fill: #e7ffac;
  font-family: 'Manrope', sans-serif;
  font-size: 25px;
  font-weight: 800;
}

.buddy-card--worried .buddy {
  animation: buddy-nervous 1.8s ease-in-out infinite;
}

.buddy-card--crying .body {
  fill: #70aec7;
  stroke: #28657d;
}
.buddy-card--crying .knot {
  fill: #91c7dc;
  stroke: #28657d;
}
.buddy-card--crying .tie {
  fill: #d9eff7;
  stroke: #28657d;
}
.buddy-card--crying .arm {
  stroke: #28657d;
}
.buddy-card--crying .belly {
  fill: #a6d2e3;
}
.buddy-card--crying .baht {
  fill: #eaf8fd;
}
.buddy-card--crying .buddy {
  animation: buddy-sob 0.8s ease-in-out infinite;
}

.spark {
  position: absolute;
  z-index: 3;
  color: var(--cheer);
  font-size: 1.25rem;
  animation: sparkle 1.4s ease-in-out infinite;
}

.spark--one {
  right: 20px;
  top: 34px;
}
.spark--two {
  left: 22px;
  top: 80px;
  animation-delay: 0.5s;
}

.puddle {
  position: absolute;
  z-index: -1;
  left: 45px;
  bottom: 8px;
  width: 145px;
  height: 28px;
  border-radius: 50%;
  background: rgba(101, 183, 221, 0.28);
  animation: puddle 1.6s ease-in-out infinite;
}

@keyframes buddy-float {
  0%,
  100% {
    transform: translateY(0) rotate(-1deg);
  }
  50% {
    transform: translateY(-5px) rotate(1deg);
  }
}

@keyframes buddy-nervous {
  0%,
  100% {
    transform: translateX(0) rotate(0);
  }
  30% {
    transform: translateX(-2px) rotate(-1deg);
  }
  60% {
    transform: translateX(2px) rotate(1deg);
  }
}

@keyframes buddy-sob {
  0%,
  100% {
    transform: translateY(0) rotate(-0.5deg);
  }
  50% {
    transform: translateY(3px) rotate(0.5deg);
  }
}

@keyframes buddy-tap {
  0% {
    transform: scale(1);
  }
  35% {
    transform: scale(0.9) rotate(-3deg);
  }
  70% {
    transform: scale(1.08) rotate(3deg);
  }
  100% {
    transform: scale(1);
  }
}

@keyframes tear-drop {
  0% {
    transform: translateY(-2px) scale(0.8);
    opacity: 0.5;
  }
  70% {
    transform: translateY(10px) scale(1);
    opacity: 1;
  }
  100% {
    transform: translateY(16px) scale(0.7);
    opacity: 0;
  }
}

@keyframes sparkle {
  0%,
  100% {
    transform: scale(0.7) rotate(0);
    opacity: 0.35;
  }
  50% {
    transform: scale(1.2) rotate(25deg);
    opacity: 1;
  }
}

@keyframes puddle {
  0%,
  100% {
    transform: scaleX(0.88);
    opacity: 0.2;
  }
  50% {
    transform: scaleX(1);
    opacity: 0.4;
  }
}

.buddy-card.compact-buddy {
  min-height: 0;
  height: auto;
  grid-template-columns: minmax(0, 1fr) 112px;
  gap: 8px;
  margin-top: 0;
  padding: 16px;
  border-radius: 16px;
}

.buddy-card.compact-buddy::after {
  width: 210px;
  height: 210px;
  right: -85px;
  top: -65px;
  box-shadow: 0 0 0 35px rgba(51, 143, 101, 0.03);
}

.compact-buddy .buddy-kicker,
.compact-buddy .speech small,
.compact-buddy .meter-zones {
  display: none;
}

.compact-buddy .buddy-heading {
  gap: 6px;
}

.compact-buddy .mood-badge {
  padding: 4px 7px;
  font-size: 0.56rem;
}

.compact-buddy .buddy-copy h2 {
  margin: 5px 0 8px;
  font-size: 0.95rem;
}

.compact-buddy .speech {
  padding: 9px 10px;
  border-radius: 10px;
}

.compact-buddy .speech::after {
  right: -6px;
  top: 18px;
  width: 11px;
  height: 11px;
}

.compact-buddy .speech span {
  font-size: 0.66rem;
  line-height: 1.45;
}

.compact-buddy .spending-meter {
  margin-top: 10px;
}

.compact-buddy .meter-label {
  margin-bottom: 5px;
  font-size: 0.57rem;
}

.compact-buddy .meter-label strong {
  font-size: 0.59rem;
}

.compact-buddy .meter-track {
  height: 7px;
}

.compact-buddy .buddy-button {
  width: 118px;
}

.compact-buddy .spark {
  font-size: 0.85rem;
}

.compact-buddy .spark--one {
  right: 5px;
  top: 20px;
}
.compact-buddy .spark--two {
  left: 8px;
  top: 45px;
}
.compact-buddy .puddle {
  left: 20px;
  bottom: 4px;
  width: 85px;
  height: 18px;
}

@media (max-width: 760px) {
  .buddy-card {
    grid-template-columns: 1fr 180px;
    padding: 24px;
  }

  .buddy-button {
    width: 190px;
  }
}

@media (max-width: 580px) {
  .buddy-card.compact-buddy {
    grid-template-columns: minmax(0, 1fr) 105px;
    gap: 6px;
    padding: 14px;
  }

  .compact-buddy .buddy-copy,
  .compact-buddy .buddy-button {
    order: 0;
  }

  .compact-buddy .buddy-button {
    width: 105px;
  }

  .compact-buddy .buddy-heading {
    justify-content: flex-start;
  }

  .compact-buddy .buddy-copy h2 {
    text-align: left;
  }

  .buddy-card:not(.compact-buddy) {
    grid-template-columns: 1fr;
    gap: 8px;
    padding: 21px 18px 13px;
  }

  .buddy-copy {
    order: 2;
  }

  .buddy-button {
    order: 1;
    width: 165px;
  }

  .speech::after {
    display: none;
  }

  .buddy-heading {
    justify-content: center;
  }

  .buddy-copy h2 {
    text-align: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .buddy,
  .tear,
  .spark,
  .puddle {
    animation: none !important;
  }
}
</style>
