<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAccentTone } from '../composables/useAccentTone'
import { useDailyReminder } from '../composables/useDailyReminder'
import { useSalarySettings } from '../composables/useSalarySettings'
import {
  createPlanItemId,
  dayKindEmojis,
  dayKindLabels,
  formatKeywords,
  MAX_PLAN_ITEMS,
  parseKeywords,
  sumPlanItems,
  useDailyCap,
  type CapPlanItem,
  type DayKind,
} from '../composables/useDailyCap'
import { transactionCategories } from '../types/transaction'
import { formatBaht } from '../utils/format'

const props = withDefaults(
  defineProps<{
    open: boolean
    transactionCount: number
    busy: boolean
    readOnly?: boolean
  }>(),
  { readOnly: false },
)

const emit = defineEmits<{
  close: []
  manage: []
  reset: []
}>()

const { monthlySalary, salaryDay, salaryHidden, saveMonthlySalary, toggleSalaryVisibility } =
  useSalarySettings()
const { accentTone, accentToneOptions, activeSwatch, setAccentTone } = useAccentTone()
const activeAccentHint = computed(
  () => accentToneOptions.find((option) => option.value === accentTone.value)?.hint ?? '',
)
const {
  reminderEnabled,
  reminderTime,
  reminderBusy,
  isNativeReminderSupported,
  initializeDailyReminder,
  updateDailyReminder,
} = useDailyReminder()
const { capEnabled, cloneProfile, saveProfile, setCapEnabled, resetProfile } = useDailyCap()
const confirmingReset = ref(false)
const salaryDraft = ref<number | string>(monthlySalary.value)
const salaryError = ref('')
const salaryNotice = ref('')
const reminderEnabledDraft = ref(reminderEnabled.value)
const reminderTimeDraft = ref(reminderTime.value)
const reminderFeedback = ref('')
const reminderFeedbackIsError = ref(false)
let salaryNoticeTimer: number | undefined

/**
 * เก็บคีย์เวิร์ดเป็นข้อความดิบระหว่างพิมพ์ แล้วค่อยแปลงเป็น array ตอนบันทึก
 * ช่วงเวลาแยกเป็น 3 ฟิลด์เพื่อผูกกับ input type="time" ได้ตรง ๆ
 */
type CapPlanItemDraft = CapPlanItem & {
  keywordText: string
  timeEnabled: boolean
  timeStart: string
  timeEnd: string
}

interface CapProfileDraft {
  cap: number | string
  items: CapPlanItemDraft[]
}

const capKindOrder: DayKind[] = ['weekday', 'weekend']
const capKindDraft = ref<DayKind>('weekday')
const capEnabledDraft = ref(capEnabled.value)
const capDrafts = ref<Record<DayKind, CapProfileDraft>>({
  weekday: { cap: 0, items: [] },
  weekend: { cap: 0, items: [] },
})
const capFeedback = ref('')
const capFeedbackIsError = ref(false)

const cloneCapProfileDraft = (kind: DayKind): CapProfileDraft => {
  const profile = cloneProfile(kind)
  return {
    cap: profile.cap,
    items: profile.items.map((item) => ({
      ...item,
      keywordText: formatKeywords(item.keywords),
      timeEnabled: item.timeWindow !== null,
      timeStart: item.timeWindow?.start ?? '05:00',
      timeEnd: item.timeWindow?.end ?? '11:59',
    })),
  }
}

const cloneCapDrafts = (): Record<DayKind, CapProfileDraft> => ({
  weekday: cloneCapProfileDraft('weekday'),
  weekend: cloneCapProfileDraft('weekend'),
})

capDrafts.value = cloneCapDrafts()

const activeCapDraft = computed(() => capDrafts.value[capKindDraft.value])
const activeCapPlanTotal = computed(() => sumPlanItems(activeCapDraft.value.items))
const activeCapSpare = computed(
  () => Math.round((Number(activeCapDraft.value.cap || 0) - activeCapPlanTotal.value) * 100) / 100,
)

const clearCapFeedback = () => {
  capFeedback.value = ''
  capFeedbackIsError.value = false
}

const selectCapKind = (kind: DayKind) => {
  capKindDraft.value = kind
  clearCapFeedback()
}

const clearSalaryFeedback = () => {
  salaryError.value = ''
  salaryNotice.value = ''
}

const addPlanItem = () => {
  if (activeCapDraft.value.items.length >= MAX_PLAN_ITEMS) {
    capFeedback.value = `เพิ่มรายการในแผนได้สูงสุด ${MAX_PLAN_ITEMS} รายการ`
    capFeedbackIsError.value = true
    return
  }

  clearCapFeedback()
  activeCapDraft.value.items.push({
    id: createPlanItemId(),
    emoji: '💸',
    label: '',
    amount: 0,
    keywords: [],
    keywordText: '',
    timeWindow: null,
    timeEnabled: false,
    timeStart: '05:00',
    timeEnd: '11:59',
    category: null,
  })
}

const removePlanItem = (id: string) => {
  clearCapFeedback()
  activeCapDraft.value.items = activeCapDraft.value.items.filter((item) => item.id !== id)
}

const usePlanTotalAsCap = () => {
  clearCapFeedback()
  activeCapDraft.value.cap = activeCapPlanTotal.value
}

const submitDailyCap = () => {
  clearCapFeedback()
  setCapEnabled(capEnabledDraft.value)

  if (!capEnabledDraft.value) {
    capFeedback.value = 'ปิดงบรายวันแล้ว หลอดจะซ่อนไว้จนกว่าจะเปิดอีกครั้ง'
    return
  }

  let persisted = true

  for (const kind of capKindOrder) {
    const draft = capDrafts.value[kind]
    const result = saveProfile(kind, {
      cap: Number(draft.cap),
      items: draft.items.map((item) => ({
        ...item,
        amount: Number(item.amount),
        keywords: parseKeywords(item.keywordText),
        timeWindow: item.timeEnabled ? { start: item.timeStart, end: item.timeEnd } : null,
      })),
    })

    if (!result.ok) {
      capFeedbackIsError.value = true
      capFeedback.value =
        result.reason === 'invalid-cap'
          ? `เพดานงบของ${dayKindLabels[kind]} ต้องมากกว่า 0 บาท`
          : result.reason === 'invalid-time'
            ? `ช่วงเวลาในแผนของ${dayKindLabels[kind]} ไม่ถูกต้อง`
            : `จำนวนเงินในแผนของ${dayKindLabels[kind]} ไม่ถูกต้อง`
      capKindDraft.value = kind
      return
    }

    persisted = persisted && result.persisted
  }

  capDrafts.value = cloneCapDrafts()
  capFeedback.value = persisted
    ? 'บันทึกงบรายวันแล้ว หลอดจะอัปเดตทันที'
    : 'ใช้ค่านี้ในรอบปัจจุบัน แต่เบราว์เซอร์ไม่อนุญาตให้บันทึกถาวร'
}

const restoreDefaultCap = () => {
  const kind = capKindDraft.value
  resetProfile(kind)
  capDrafts.value = cloneCapDrafts()
  capFeedbackIsError.value = false
  capFeedback.value = `คืนค่าเริ่มต้นของ${dayKindLabels[kind]} แล้ว`
}

const showSalaryNotice = (message: string) => {
  salaryNotice.value = message
  window.clearTimeout(salaryNoticeTimer)
  salaryNoticeTimer = window.setTimeout(() => {
    salaryNotice.value = ''
  }, 4000)
}

const toggleSalaryPrivacy = () => {
  const result = toggleSalaryVisibility()
  const action = salaryHidden.value ? 'เบลอเงินเดือนแล้ว' : 'แสดงเงินเดือนแล้ว'
  showSalaryNotice(result.persisted ? action : `${action} แต่จำค่าได้เฉพาะรอบนี้`)
}

const resetEditors = () => {
  salaryDraft.value = monthlySalary.value
  salaryError.value = ''
  salaryNotice.value = ''
  reminderEnabledDraft.value = reminderEnabled.value
  reminderTimeDraft.value = reminderTime.value
  reminderFeedback.value = ''
  reminderFeedbackIsError.value = false
  capEnabledDraft.value = capEnabled.value
  capDrafts.value = cloneCapDrafts()
  capKindDraft.value = 'weekday'
  clearCapFeedback()
}

watch(
  () => props.open,
  (open) => {
    if (open) resetEditors()
  },
)

const submitSalary = () => {
  const amount = Number(salaryDraft.value)

  if (!Number.isFinite(amount) || amount <= 0) {
    salaryError.value = 'กรอกเงินเดือนที่มากกว่า 0 บาท'
    return
  }

  if (amount > 100_000_000) {
    salaryError.value = 'จำนวนเงินเดือนสูงเกินกว่าที่ระบบรองรับ'
    return
  }

  const result = saveMonthlySalary(amount)
  if (!result.ok) {
    salaryError.value = 'บันทึกเงินเดือนไม่สำเร็จ กรุณาตรวจสอบจำนวนเงิน'
    return
  }

  salaryDraft.value = monthlySalary.value
  salaryError.value = ''
  showSalaryNotice(
    result.persisted
      ? 'บันทึกแล้ว น้องถุงเงินคำนวณใหม่ให้ทันที'
      : 'ใช้ค่านี้ในรอบปัจจุบัน แต่เบราว์เซอร์ไม่อนุญาตให้บันทึกถาวร',
  )
}

const submitReminder = async () => {
  reminderFeedback.value = ''
  reminderFeedbackIsError.value = false
  const result = await updateDailyReminder(reminderEnabledDraft.value, reminderTimeDraft.value)

  if (result.ok) {
    reminderFeedback.value = reminderEnabledDraft.value
      ? `ตั้งเตือนทุกวันเวลา ${reminderTimeDraft.value} น. แล้ว`
      : 'ปิดการแจ้งเตือนรายวันแล้ว'
    if (!result.persisted) reminderFeedback.value += ' แต่จำค่าได้เฉพาะรอบนี้'
    return
  }

  reminderEnabledDraft.value = reminderEnabled.value
  reminderFeedbackIsError.value = true
  if (result.reason === 'permission-denied') {
    reminderFeedback.value = 'ยังไม่ได้รับสิทธิ์แจ้งเตือน สามารถเปิดภายหลังได้จากการตั้งค่า Android'
  } else if (result.reason === 'unsupported') {
    reminderFeedback.value = 'การแจ้งเตือนรายวันใช้ได้เมื่อเปิดผ่านแอป Android เท่านั้น'
  } else if (result.reason === 'invalid-time') {
    reminderFeedback.value = 'กรุณาเลือกเวลาแจ้งเตือนให้ถูกต้อง'
  } else {
    reminderFeedback.value = 'ตั้งการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่'
  }
}

const close = () => {
  if (props.busy || reminderBusy.value) return
  confirmingReset.value = false
  emit('close')
}

const startManaging = () => {
  emit('manage')
  close()
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && props.open) close()
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  void initializeDailyReminder()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.clearTimeout(salaryNoticeTimer)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="modal-backdrop" role="presentation" @mousedown.self="close">
        <section
          class="settings-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-title"
        >
          <header class="settings-header">
            <div>
              <span>ตั้งค่า</span>
              <h2 id="settings-title">จัดการข้อมูล</h2>
            </div>
            <button
              class="close-button"
              type="button"
              aria-label="ปิดหน้าต่างตั้งค่า"
              :disabled="busy"
              @click="close"
            >
              ×
            </button>
          </header>

          <div class="settings-body">
            <section class="setting-card accent-card">
              <div class="setting-icon setting-icon--accent" aria-hidden="true">
                <i :style="{ background: activeSwatch }"></i>
              </div>
              <div class="setting-copy">
                <strong>สีของรายจ่ายและยอดเกินงบ</strong>
                <p>
                  ใช้กับหลอดงบที่เกิน, ยอดติดลบ, ปฏิทินวันที่ใช้หนัก และไอคอนรายจ่าย
                  เลือกที่อ่านสบายตาที่สุดสำหรับคุณ
                </p>
                <div class="accent-options" role="radiogroup" aria-label="สีของรายจ่ายและยอดเกินงบ">
                  <button
                    v-for="option in accentToneOptions"
                    :key="option.value"
                    class="accent-option"
                    :class="{ 'is-active': accentTone === option.value }"
                    type="button"
                    role="radio"
                    :aria-checked="accentTone === option.value"
                    :title="option.hint"
                    @click="setAccentTone(option.value)"
                  >
                    <i :style="{ background: option.swatch }" aria-hidden="true"></i>
                    <b>{{ option.label }}</b>
                  </button>
                </div>
                <small class="accent-hint">{{ activeAccentHint }}</small>
              </div>
            </section>

            <form class="setting-card salary-card" @submit.prevent="submitSalary">
              <div class="setting-icon setting-icon--salary" aria-hidden="true">฿</div>
              <div class="setting-copy salary-copy">
                <strong>เงินเดือนสำหรับการคาดการณ์</strong>
                <p>
                  สมมติว่าเงินเข้าทุกวันที่ {{ salaryDay }} ของเดือน
                  (กุมภาพันธ์ใช้วันสุดท้ายของเดือน)
                </p>

                <label class="salary-field" for="monthly-salary">
                  <span>เงินเดือนต่อเดือน</span>
                  <span class="salary-input-wrap">
                    <b aria-hidden="true">฿</b>
                    <input
                      id="monthly-salary"
                      v-model.number="salaryDraft"
                      :type="salaryHidden ? 'password' : 'number'"
                      min="1"
                      max="100000000"
                      step="1"
                      inputmode="decimal"
                      autocomplete="off"
                      :disabled="busy"
                      aria-describedby="salary-feedback"
                      @input="clearSalaryFeedback"
                    />
                    <button
                      class="salary-visibility"
                      type="button"
                      :aria-label="salaryHidden ? 'แสดงเงินเดือน' : 'เบลอเงินเดือน'"
                      :aria-pressed="!salaryHidden"
                      :title="salaryHidden ? 'แสดงเงินเดือน' : 'เบลอเงินเดือน'"
                      :disabled="busy"
                      @click="toggleSalaryPrivacy"
                    >
                      <svg v-if="salaryHidden" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 4.3A10.7 10.7 0 0 1 12 4c5.5 0 9 5.1 9 5.1a14.8 14.8 0 0 1-2.5 2.8M6.6 6.7C4.4 8.2 3 10.9 3 10.9S6.5 16 12 16c1 0 2-.2 2.8-.5"
                        />
                      </svg>
                      <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M3 12s3.5-5 9-5 9 5 9 5-3.5 5-9 5-9-5-9-5Z" />
                        <circle cx="12" cy="12" r="2.5" />
                      </svg>
                    </button>
                    <em>บาท</em>
                  </span>
                </label>

                <small
                  v-if="salaryError"
                  id="salary-feedback"
                  class="salary-feedback salary-feedback--error"
                  role="alert"
                  >{{ salaryError }}</small
                >
                <small
                  v-else-if="salaryNotice"
                  id="salary-feedback"
                  class="salary-feedback salary-feedback--success"
                  role="status"
                  >{{ salaryNotice }}</small
                >
                <small v-else id="salary-feedback">
                  ซิงก์กับบัญชีเมื่อออนไลน์ และเก็บ cache ไว้ในเครื่องสำหรับใช้งานออฟไลน์
                </small>
              </div>
              <button class="setting-button salary-save" type="submit" :disabled="busy">
                บันทึกเงินเดือน
              </button>
            </form>

            <form class="setting-card cap-card" @submit.prevent="submitDailyCap">
              <div class="setting-icon setting-icon--cap" aria-hidden="true">◔</div>
              <div class="setting-copy cap-copy">
                <strong>งบรายจ่ายต่อวัน (CAP)</strong>
                <p>ตั้งเพดานของแต่ละวัน แล้วหน้าจดรายการจะมีหลอดบอกว่าวันนี้เกินงบหรือยัง</p>

                <label class="cap-toggle">
                  <input
                    v-model="capEnabledDraft"
                    type="checkbox"
                    :disabled="busy"
                    @change="clearCapFeedback"
                  />
                  <span aria-hidden="true"></span>
                  เปิดใช้งบรายวัน
                </label>

                <div v-if="capEnabledDraft" class="cap-editor">
                  <div class="cap-kind-tabs" role="group" aria-label="เลือกประเภทวัน">
                    <button
                      v-for="kind in capKindOrder"
                      :key="kind"
                      type="button"
                      :class="{ active: capKindDraft === kind }"
                      :disabled="busy"
                      @click="selectCapKind(kind)"
                    >
                      {{ dayKindEmojis[kind] }} {{ dayKindLabels[kind] }}
                    </button>
                  </div>

                  <label class="cap-field" :for="`daily-cap-${capKindDraft}`">
                    <span>เพดานรายจ่ายต่อวัน</span>
                    <span class="cap-input-wrap">
                      <b aria-hidden="true">฿</b>
                      <input
                        :id="`daily-cap-${capKindDraft}`"
                        v-model.number="activeCapDraft.cap"
                        type="number"
                        min="1"
                        step="1"
                        inputmode="decimal"
                        :disabled="busy"
                        @input="clearCapFeedback"
                      />
                      <em>บาท / วัน</em>
                    </span>
                  </label>

                  <div class="cap-plan-editor">
                    <div class="cap-plan-head">
                      <span>แผนค่าใช้จ่ายในวัน</span>
                      <button type="button" :disabled="busy" @click="usePlanTotalAsCap">
                        ใช้ผลรวมเป็นเพดาน
                      </button>
                    </div>

                    <p class="cap-plan-note">
                      ระบบดูหมวดหมู่ก่อน: ค่าอาหารเข้าช่องอาหาร ค่าเดินทางเข้าช่องเดินทาง
                      ไม่ว่าจะจ่ายกี่โมง · คำในชื่อรายการกับช่วงเวลาใช้แยกช่องย่อยภายในหมวดเดียวกัน
                      (เช่น อาหารเช้า/กลางวัน/เย็น) · หมวดที่ไม่มีช่องเฉพาะจะไปรวมที่ช่อง “หมวดอื่น
                      ๆ” · รายจ่ายหนึ่งรายการนับช่องเดียว ช่วงเวลาข้ามเที่ยงคืนได้ (15:00–04:59)
                    </p>

                    <div
                      v-for="(item, index) in activeCapDraft.items"
                      :key="item.id"
                      class="cap-plan-item"
                    >
                      <div class="cap-plan-row">
                        <input
                          v-model="item.emoji"
                          class="cap-plan-emoji"
                          type="text"
                          maxlength="2"
                          :aria-label="`อีโมจิของรายการที่ ${index + 1}`"
                          :disabled="busy"
                          @input="clearCapFeedback"
                        />
                        <input
                          v-model="item.label"
                          class="cap-plan-label"
                          type="text"
                          maxlength="24"
                          placeholder="ชื่อรายการ เช่น กลางวัน"
                          :aria-label="`ชื่อรายการที่ ${index + 1}`"
                          :disabled="busy"
                          @input="clearCapFeedback"
                        />
                        <input
                          v-model.number="item.amount"
                          class="cap-plan-amount"
                          type="number"
                          min="0"
                          step="1"
                          inputmode="decimal"
                          :aria-label="`จำนวนเงินของรายการที่ ${index + 1}`"
                          :disabled="busy"
                          @input="clearCapFeedback"
                        />
                        <button
                          class="cap-plan-remove"
                          type="button"
                          :aria-label="`ลบรายการที่ ${index + 1}`"
                          :disabled="busy"
                          @click="removePlanItem(item.id)"
                        >
                          ×
                        </button>
                      </div>

                      <div class="cap-plan-time">
                        <label class="cap-time-toggle">
                          <input
                            v-model="item.timeEnabled"
                            type="checkbox"
                            :disabled="busy"
                            @change="clearCapFeedback"
                          />
                          ใช้ช่วงเวลา
                        </label>
                        <input
                          v-model="item.timeStart"
                          type="time"
                          :disabled="busy || !item.timeEnabled"
                          :aria-label="`เวลาเริ่มของรายการที่ ${index + 1}`"
                          @input="clearCapFeedback"
                        />
                        <span aria-hidden="true">–</span>
                        <input
                          v-model="item.timeEnd"
                          type="time"
                          :disabled="busy || !item.timeEnabled"
                          :aria-label="`เวลาสิ้นสุดของรายการที่ ${index + 1}`"
                          @input="clearCapFeedback"
                        />
                      </div>

                      <div class="cap-plan-match">
                        <input
                          v-model="item.keywordText"
                          class="cap-plan-keywords"
                          type="text"
                          maxlength="160"
                          placeholder="คำที่ใช้แยกช่องในหมวดเดียวกัน คั่นด้วย , เช่น เช้า, breakfast"
                          :aria-label="`คำที่ใช้จับคู่ของรายการที่ ${index + 1}`"
                          :disabled="busy"
                          @input="clearCapFeedback"
                        />
                        <select
                          v-model="item.category"
                          class="cap-plan-category"
                          :aria-label="`หมวดหมู่ของรายการที่ ${index + 1}`"
                          :disabled="busy"
                          @change="clearCapFeedback"
                        >
                          <option :value="null">✨ หมวดอื่น ๆ (ช่องรวม)</option>
                          <option
                            v-for="option in transactionCategories"
                            :key="option.value"
                            :value="option.value"
                          >
                            {{ option.emoji }} {{ option.value }}
                          </option>
                        </select>
                      </div>
                    </div>

                    <button
                      class="cap-plan-add"
                      type="button"
                      :disabled="busy || activeCapDraft.items.length >= MAX_PLAN_ITEMS"
                      @click="addPlanItem"
                    >
                      ＋ เพิ่มรายการในแผน
                    </button>

                    <p class="cap-plan-summary">
                      <span
                        >รวมแผน <b>{{ formatBaht(activeCapPlanTotal) }}</b></span
                      >
                      <span :class="{ 'cap-plan-summary--over': activeCapSpare < 0 }">
                        {{ activeCapSpare < 0 ? 'แผนเกินเพดาน' : 'กันเหลือ' }}
                        <b>{{ formatBaht(Math.abs(activeCapSpare)) }}</b>
                      </span>
                    </p>
                  </div>

                  <button
                    class="cap-restore"
                    type="button"
                    :disabled="busy"
                    @click="restoreDefaultCap"
                  >
                    คืนค่าเริ่มต้นของ{{ dayKindLabels[capKindDraft] }}
                  </button>
                </div>

                <small
                  v-if="capFeedback"
                  class="cap-feedback"
                  :class="{ 'cap-feedback--error': capFeedbackIsError }"
                  :role="capFeedbackIsError ? 'alert' : 'status'"
                  >{{ capFeedback }}</small
                >
                <small v-else>
                  ค่าเริ่มต้น: วันทำงาน ฿320 · อาหารเช้า 05:00–11:59 (65) · อาหารกลางวัน 12:00–14:59
                  (70) · อาหารเย็น 15:00–04:59 (70) · เดินทาง 77 · หมวดอื่น ๆ 38 ·
                  ซิงก์งบกับบัญชีเมื่อออนไลน์ และเก็บ cache ไว้ในเครื่องสำหรับใช้งานออฟไลน์
                </small>
              </div>
              <button class="setting-button cap-save" type="submit" :disabled="busy">
                บันทึกงบรายวัน
              </button>
            </form>

            <form class="setting-card reminder-card" @submit.prevent="submitReminder">
              <div class="setting-icon setting-icon--reminder" aria-hidden="true">◷</div>
              <div class="setting-copy reminder-copy">
                <strong>เตือนจดรายจ่ายทุกวัน</strong>
                <p v-if="isNativeReminderSupported">
                  เลือกเวลาที่สะดวก ระบบจะขอสิทธิ์แจ้งเตือนเมื่อคุณกดบันทึกเพื่อเปิดใช้งาน
                </p>
                <p v-else>
                  ฟีเจอร์นี้ใช้ได้ในแอป Android เว็บปกติจะไม่เรียกใช้การแจ้งเตือนของอุปกรณ์
                </p>

                <div class="reminder-controls">
                  <label class="reminder-toggle">
                    <input
                      v-model="reminderEnabledDraft"
                      type="checkbox"
                      :disabled="busy || reminderBusy || !isNativeReminderSupported"
                      @change="reminderFeedback = ''"
                    />
                    <span aria-hidden="true"></span>
                    เปิดการแจ้งเตือน
                  </label>
                  <label class="reminder-time" for="daily-reminder-time">
                    <span>เวลา</span>
                    <input
                      id="daily-reminder-time"
                      v-model="reminderTimeDraft"
                      type="time"
                      :disabled="busy || reminderBusy || !isNativeReminderSupported"
                      @input="reminderFeedback = ''"
                    />
                    <span>น.</span>
                  </label>
                </div>

                <small
                  v-if="reminderFeedback"
                  class="reminder-feedback"
                  :class="{ 'reminder-feedback--error': reminderFeedbackIsError }"
                  :role="reminderFeedbackIsError ? 'alert' : 'status'"
                  >{{ reminderFeedback }}</small
                >
                <small v-else>ค่าเริ่มต้น 21:00 น. · เก็บเฉพาะในอุปกรณ์เครื่องนี้</small>
              </div>
              <button
                class="setting-button reminder-save"
                type="submit"
                :disabled="busy || reminderBusy || !isNativeReminderSupported"
              >
                {{ reminderBusy ? 'กำลังตั้งค่า...' : 'บันทึกการเตือน' }}
              </button>
            </form>

            <p v-if="readOnly" class="read-only-note" role="note">
              โหมดดูตัวอย่าง: ปรับเงินเดือนเพื่อลองดูการคาดการณ์ได้ แต่แก้ไขหรือลบข้อมูลไม่ได้
            </p>

            <article v-if="!readOnly" class="setting-card">
              <div class="setting-icon setting-icon--manage" aria-hidden="true">✓</div>
              <div class="setting-copy">
                <strong>เลือกลบรายการ</strong>
                <p>เลือกธุรกรรมหลายรายการแล้วลบพร้อมกันได้</p>
                <small>มีข้อมูลทั้งหมด {{ transactionCount }} รายการ</small>
              </div>
              <button
                class="setting-button"
                type="button"
                :disabled="transactionCount === 0 || busy"
                @click="startManaging"
              >
                จัดการรายการ
              </button>
            </article>

            <div v-if="!readOnly" class="danger-zone">
              <div class="danger-heading">
                <span>Danger zone</span>
                <p>การดำเนินการส่วนนี้ไม่สามารถย้อนกลับได้</p>
              </div>

              <article class="setting-card setting-card--danger">
                <div class="setting-icon setting-icon--danger" aria-hidden="true">↻</div>
                <div class="setting-copy">
                  <strong>รีเซ็ตข้อมูลทั้งหมด</strong>
                  <p>ลบรายรับและรายจ่ายทุกแถวออกจากฐานข้อมูล</p>
                </div>

                <button
                  v-if="!confirmingReset"
                  class="setting-button setting-button--danger"
                  type="button"
                  :disabled="transactionCount === 0 || busy"
                  @click="confirmingReset = true"
                >
                  รีเซ็ตข้อมูล
                </button>
              </article>

              <div v-if="confirmingReset" class="reset-confirm" role="alert">
                <div>
                  <strong>ยืนยันลบ {{ transactionCount }} รายการทั้งหมด?</strong>
                  <p>กราฟ ยอดสรุป และอารมณ์น้องถุงเงินจะกลับสู่ค่าเริ่มต้น</p>
                </div>
                <div class="confirm-actions">
                  <button type="button" :disabled="busy" @click="confirmingReset = false">
                    ยกเลิก
                  </button>
                  <button
                    class="confirm-delete"
                    type="button"
                    :disabled="busy"
                    @click="emit('reset')"
                  >
                    <span v-if="busy" class="mini-spinner" aria-hidden="true"></span>
                    {{ busy ? 'กำลังลบ...' : 'ใช่ ลบทั้งหมด' }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  z-index: 100;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(10, 28, 21, 0.58);
  backdrop-filter: blur(5px);
}

.settings-modal {
  width: min(620px, 100%);
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  border: 1px solid rgba(255, 255, 255, 0.6);
  border-radius: 22px;
  background: #fff;
  box-shadow: 0 30px 90px rgba(7, 28, 19, 0.3);
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24px 26px 19px;
  border-bottom: 1px solid #e8ebe7;
}

.settings-header span,
.danger-heading > span {
  color: #698176;
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.settings-header h2 {
  margin: 3px 0 0;
  color: #18231f;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 1.2rem;
}

.close-button {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border: 0;
  border-radius: 10px;
  color: #68736e;
  background: #f1f4f1;
  font-size: 1.3rem;
}

.settings-body {
  padding: 22px 26px 26px;
}

.read-only-note {
  margin: 14px 0 0;
  padding: 10px 12px;
  border: 1px solid var(--cheer-line);
  border-radius: 11px;
  color: var(--cheer-ink);
  background: var(--cheer-tint);
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.66rem;
  line-height: 1.55;
}

.setting-card {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 17px;
  border: 1px solid #e3e8e3;
  border-radius: 15px;
  background: #fbfcfb;
}

.setting-icon {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border-radius: 13px;
  font-weight: 800;
}

.salary-card {
  align-items: start;
  margin-bottom: 12px;
  border-color: #cfe3d7;
  background: linear-gradient(135deg, #f8fcf9, #eef8f2);
}

.accent-card {
  align-items: start;
  margin-bottom: 12px;
}

.setting-icon--accent {
  background: #f1f5f2;
}

.setting-icon--accent i {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
}

.accent-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 9px;
}

.accent-option {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 11px;
  border: 1px solid #dce4de;
  border-radius: 999px;
  background: #fff;
  font-family: 'Noto Sans Thai', sans-serif;
  cursor: pointer;
  transition:
    border-color 0.16s,
    background 0.16s;
}

.accent-option i {
  display: block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
}

.accent-option b {
  color: #45534c;
  font-size: 0.62rem;
  font-weight: 700;
}

.accent-option.is-active {
  border-color: #2f6b51;
  background: var(--green-light);
}

.accent-option.is-active b {
  color: #1f5c40;
}

.accent-option:focus-visible {
  outline: 3px solid rgba(41, 116, 79, 0.28);
  outline-offset: 1px;
}

.accent-hint {
  display: block;
  margin-top: 7px;
  color: var(--muted);
  font-size: 0.58rem;
  line-height: 1.5;
}

.setting-icon--salary {
  color: #1d6d49;
  background: #dff2e7;
  font-family: 'Manrope', sans-serif;
  font-size: 1rem;
}

.salary-copy {
  display: grid;
  gap: 3px;
}

.salary-field {
  display: grid;
  gap: 5px;
  margin-top: 9px;
  color: #4f675c;
  font-size: 0.62rem;
  font-weight: 700;
}

.salary-input-wrap {
  display: grid;
  min-height: 42px;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 7px;
  padding: 0 11px;
  border: 1px solid #cfdcd4;
  border-radius: 10px;
  background: #fff;
  transition:
    border-color 0.16s,
    box-shadow 0.16s;
}

.salary-input-wrap:focus-within {
  border-color: #5e987a;
  box-shadow: 0 0 0 3px rgba(65, 139, 99, 0.12);
}

.salary-input-wrap b {
  color: #2c7955;
  font-family: 'Manrope', sans-serif;
  font-size: 0.8rem;
}

.salary-input-wrap input {
  width: 100%;
  min-width: 0;
  padding: 7px 0;
  border: 0;
  outline: 0;
  color: #1f352b;
  background: transparent;
  font-family: 'Manrope', sans-serif;
  font-size: 0.86rem;
  font-weight: 700;
}

.salary-visibility {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 8px;
  color: #537166;
  background: #eef4f0;
}

.salary-visibility:hover:not(:disabled) {
  color: #235f43;
  background: #e1eee6;
}

.salary-visibility:focus-visible {
  outline: 3px solid rgba(41, 116, 79, 0.28);
  outline-offset: 1px;
}

.salary-visibility svg {
  width: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.salary-input-wrap em {
  color: #819087;
  font-size: 0.59rem;
  font-style: normal;
  font-weight: 600;
}

.setting-copy .salary-feedback--error {
  color: var(--alert-text);
}

.setting-copy .salary-feedback--success {
  color: #277451;
}

.salary-save,
.reminder-save {
  align-self: end;
}

.cap-card {
  align-items: start;
  margin-bottom: 12px;
  border-color: #d5e2da;
  background: linear-gradient(135deg, #fbfdfb, #f0f7f3);
}

.setting-icon--cap {
  color: #1d6d49;
  background: #dff2e7;
  font-size: 1.25rem;
}

.cap-copy {
  display: grid;
  gap: 4px;
}

.cap-toggle {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-top: 8px;
  color: #4f675c;
  font-size: 0.65rem;
  font-weight: 700;
}

.cap-toggle input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.cap-toggle > span {
  position: relative;
  width: 34px;
  height: 20px;
  border-radius: 999px;
  background: #cbd5cf;
  transition: background 0.18s;
}

.cap-toggle > span::after {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(25, 77, 59, 0.28);
  content: '';
  transition: transform 0.18s;
}

.cap-toggle input:checked + span {
  background: #39775d;
}
.cap-toggle input:checked + span::after {
  transform: translateX(14px);
}
.cap-toggle input:focus-visible + span {
  outline: 3px solid rgba(41, 116, 79, 0.25);
}

.cap-editor {
  display: grid;
  gap: 10px;
  margin-top: 10px;
}

.cap-kind-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px;
  border-radius: 11px;
  background: #e9f1eb;
}

.cap-kind-tabs button {
  flex: 1 1 auto;
  min-height: 32px;
  padding: 6px 10px;
  border: 0;
  border-radius: 8px;
  color: #4c6559;
  background: transparent;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.63rem;
  font-weight: 700;
}

.cap-kind-tabs button.active {
  color: #194d3b;
  background: #fff;
  box-shadow: 0 2px 8px rgba(25, 77, 59, 0.12);
}

.cap-field {
  display: grid;
  gap: 5px;
  color: #4f675c;
  font-size: 0.62rem;
  font-weight: 700;
}

.cap-input-wrap {
  display: grid;
  min-height: 42px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  padding: 0 11px;
  border: 1px solid #cfdcd4;
  border-radius: 10px;
  background: #fff;
}

.cap-input-wrap:focus-within {
  border-color: #5e987a;
  box-shadow: 0 0 0 3px rgba(65, 139, 99, 0.12);
}

.cap-input-wrap b {
  color: #2c7955;
  font-family: 'Manrope', sans-serif;
  font-size: 0.8rem;
}

.cap-input-wrap input {
  width: 100%;
  min-width: 0;
  padding: 7px 0;
  border: 0;
  outline: 0;
  color: #1f352b;
  background: transparent;
  font-family: 'Manrope', sans-serif;
  font-size: 0.86rem;
  font-weight: 700;
}

.cap-input-wrap em {
  color: #819087;
  font-size: 0.59rem;
  font-style: normal;
  font-weight: 600;
}

.cap-plan-editor {
  display: grid;
  gap: 6px;
  padding: 11px;
  border: 1px dashed #cfdcd4;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.72);
}

.cap-plan-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #4f675c;
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.cap-plan-head button {
  padding: 5px 8px;
  border: 1px solid #cfdad3;
  border-radius: 8px;
  color: #2b6b4d;
  background: #fff;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.58rem;
  font-weight: 700;
}

.cap-plan-note {
  margin: 0 !important;
  color: #7d8782 !important;
  font-size: 0.58rem !important;
  line-height: 1.5;
}

.cap-plan-item {
  display: grid;
  gap: 5px;
  padding: 8px;
  border: 1px solid #e6ece8;
  border-radius: 10px;
  background: #fff;
}

.cap-plan-row {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 88px 30px;
  align-items: center;
  gap: 6px;
}

.cap-plan-match {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 132px;
  align-items: center;
  gap: 6px;
}

.cap-plan-time {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.cap-time-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #4f675c;
  font-size: 0.58rem;
  font-weight: 700;
}

.cap-time-toggle input {
  width: 13px;
  height: 13px;
  accent-color: #39775d;
}

.cap-plan-time > span {
  color: #a5b0aa;
  font-size: 0.6rem;
}

.cap-plan-time input[type='time'] {
  min-height: 30px;
  padding: 3px 6px;
  border: 1px solid #d9e2dc;
  border-radius: 8px;
  color: #1f352b;
  background: #fff;
  font-family: 'Manrope', sans-serif;
  font-size: 0.62rem;
  font-weight: 700;
}

.cap-plan-time input[type='time']:disabled {
  color: #a8b2ad;
  background: #f4f6f4;
}

.cap-plan-match input,
.cap-plan-match select {
  min-height: 32px;
  min-width: 0;
  padding: 4px 7px;
  border: 1px dashed #d9e2dc;
  border-radius: 8px;
  color: #405048;
  background: #fbfdfb;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.6rem;
}

.cap-plan-match input:focus-visible,
.cap-plan-match select:focus-visible {
  border-color: #5e987a;
  border-style: solid;
  outline: 0;
  box-shadow: 0 0 0 3px rgba(65, 139, 99, 0.12);
}

.cap-plan-row input {
  min-height: 34px;
  padding: 5px 8px;
  border: 1px solid #d9e2dc;
  border-radius: 8px;
  color: #1f352b;
  background: #fff;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.66rem;
}

.cap-plan-row input:focus-visible {
  border-color: #5e987a;
  outline: 0;
  box-shadow: 0 0 0 3px rgba(65, 139, 99, 0.12);
}

.cap-plan-emoji {
  text-align: center;
}

.cap-plan-amount {
  font-family: 'Manrope', sans-serif !important;
  font-weight: 700;
  text-align: right;
}

.cap-plan-remove {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  padding: 0;
  border: 1px solid var(--alert-line);
  border-radius: 8px;
  color: var(--alert-text);
  background: #fff;
  font-size: 1rem;
  line-height: 1;
}

.cap-plan-remove:hover:not(:disabled) {
  background: var(--alert-tint);
}

.cap-plan-add {
  justify-self: start;
  margin-top: 2px;
  padding: 6px 10px;
  border: 1px dashed #b9cec3;
  border-radius: 9px;
  color: #2b6b4d;
  background: transparent;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.62rem;
  font-weight: 700;
}

.cap-plan-add:disabled {
  color: #9aa8a1;
  border-color: #dce2de;
}

.cap-plan-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 5px 0 0 !important;
  padding-top: 8px;
  border-top: 1px solid #e9eeea;
  color: #55625c !important;
  font-size: 0.64rem !important;
}

.cap-plan-summary b {
  color: var(--ink);
  font-family: 'Manrope', sans-serif;
  font-weight: 800;
}

.cap-plan-summary--over,
.cap-plan-summary--over b {
  color: var(--alert-text);
}

.cap-restore {
  justify-self: start;
  padding: 6px 10px;
  border: 0;
  border-radius: 8px;
  color: #5a6d64;
  background: transparent;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.61rem;
  font-weight: 700;
  text-decoration: underline;
}

.setting-copy .cap-feedback {
  color: #277451;
}
.setting-copy .cap-feedback--error {
  color: var(--alert-text);
}

.cap-save {
  align-self: end;
}

.reminder-card {
  align-items: start;
  margin-bottom: 12px;
  border-color: #d8e1d1;
  background: linear-gradient(135deg, #fbfcf7, #f4f8e8);
}

.setting-icon--reminder {
  color: #194d3b;
  background: #e7f4bd;
  font-size: 1.2rem;
}

.reminder-copy {
  display: grid;
  gap: 4px;
}

.reminder-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 16px;
  margin-top: 9px;
}

.reminder-toggle,
.reminder-time {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #4f675c;
  font-size: 0.65rem;
  font-weight: 700;
}

.reminder-toggle input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.reminder-toggle > span {
  position: relative;
  width: 34px;
  height: 20px;
  border-radius: 999px;
  background: #cbd5cf;
  transition: background 0.18s;
}

.reminder-toggle > span::after {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(25, 77, 59, 0.28);
  content: '';
  transition: transform 0.18s;
}

.reminder-toggle input:checked + span {
  background: #39775d;
}
.reminder-toggle input:checked + span::after {
  transform: translateX(14px);
}
.reminder-toggle input:focus-visible + span {
  outline: 3px solid rgba(41, 116, 79, 0.25);
}
.reminder-toggle input:disabled + span {
  opacity: 0.55;
}

.reminder-time input {
  min-height: 36px;
  padding: 5px 8px;
  border: 1px solid #cfdcd4;
  border-radius: 8px;
  color: #1f352b;
  background: #fff;
  font-family: 'Manrope', sans-serif;
  font-weight: 700;
}

.reminder-feedback {
  color: #277451 !important;
}
.reminder-feedback--error {
  color: var(--alert-text) !important;
}

.setting-icon--manage {
  color: #267551;
  background: #e3f2e9;
}

.setting-icon--danger {
  color: var(--alert-text);
  background: var(--alert-tint);
}

.setting-copy {
  min-width: 0;
  font-family: 'Noto Sans Thai', sans-serif;
}

.setting-copy strong {
  color: #25322c;
  font-size: 0.83rem;
}

.setting-copy p,
.danger-heading p,
.reset-confirm p {
  margin: 3px 0 0;
  color: #7d8782;
  font-size: 0.69rem;
  line-height: 1.5;
}

.setting-copy small {
  display: block;
  margin-top: 5px;
  color: #4f7765;
  font-size: 0.62rem;
}

.setting-button {
  padding: 9px 12px;
  border: 1px solid #cfdad3;
  border-radius: 9px;
  color: #285e46;
  background: #fff;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.69rem;
  font-weight: 700;
}

.setting-button:hover:not(:disabled) {
  border-color: #67937f;
  background: #f2f8f4;
}

.danger-zone {
  margin-top: 26px;
  padding-top: 19px;
  border-top: 1px dashed #dbdfdc;
}

.danger-heading {
  margin-bottom: 10px;
}

.danger-heading > span {
  color: var(--alert-text);
}

.setting-card--danger {
  border-color: var(--alert-line);
  background: var(--alert-tint);
}

.setting-button--danger {
  color: var(--alert-ink);
  border-color: var(--alert-line);
}

.setting-button--danger:hover:not(:disabled) {
  border-color: var(--alert-soft);
  background: var(--alert-tint);
}

.reset-confirm {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
  margin-top: 10px;
  padding: 14px 15px;
  border: 1px solid var(--alert-line);
  border-radius: 12px;
  color: var(--alert-ink);
  background: var(--alert-tint);
  font-family: 'Noto Sans Thai', sans-serif;
}

.reset-confirm strong {
  font-size: 0.76rem;
}

.confirm-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 7px;
}

.confirm-actions button {
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--alert-line);
  border-radius: 8px;
  color: var(--alert-muted);
  background: #fff;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.65rem;
  font-weight: 700;
}

.confirm-actions .confirm-delete {
  color: white;
  border-color: var(--alert);
  background: var(--alert);
}

.mini-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-active .settings-modal,
.modal-leave-active .settings-modal {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .settings-modal,
.modal-leave-to .settings-modal {
  opacity: 0;
  transform: translateY(12px) scale(0.98);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 580px) {
  .modal-backdrop {
    align-items: end;
    padding: 0;
  }
  .settings-modal {
    max-height: 92vh;
    border-radius: 22px 22px 0 0;
  }
  .settings-header,
  .settings-body {
    padding-inline: 18px;
  }
  .setting-card {
    grid-template-columns: 42px 1fr;
  }
  .setting-button {
    grid-column: 1 / -1;
  }
  .cap-plan-row {
    grid-template-columns: 38px minmax(0, 1fr) 72px 28px;
  }
  .cap-plan-match {
    grid-template-columns: minmax(0, 1fr);
  }
  .cap-kind-tabs button {
    flex: 1 1 100%;
  }
  .reset-confirm {
    align-items: stretch;
    flex-direction: column;
  }
  .confirm-actions {
    justify-content: flex-end;
  }
}
</style>
