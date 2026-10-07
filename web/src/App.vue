<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, ref, watch } from 'vue'
import AchievementToast from './components/AchievementToast.vue'
import AuthGate from './components/AuthGate.vue'
import EditTransactionModal from './components/EditTransactionModal.vue'
import PasswordResetScreen from './components/PasswordResetScreen.vue'
import SettingsModal from './components/SettingsModal.vue'
import AnalyticsPage from './pages/AnalyticsPage.vue'
import OverviewPage from './pages/OverviewPage.vue'
import RecordPage from './pages/RecordPage.vue'
import { useAchievements } from './composables/useAchievements'
import { useAppMessages } from './composables/useAppMessages'
import { useAuth } from './composables/useAuth'
import { useNavigation } from './composables/useNavigation'
import { useServerSettings } from './composables/useServerSettings'
import { useTransactions } from './composables/useTransactions'
import { useUndoDelete } from './composables/useUndoDelete'
import { isBackendConfigured } from './lib/backend'
import type { Transaction, TransactionType } from './types/transaction'
import { createDemoTransactions, DEMO_USER_EMAIL } from './utils/demoData'
import { exportMonthlyCsv } from './utils/monthlyExport'

/**
 * ตู้ความสำเร็จเป็น modal ไม่ใส่ loadingComponent เพราะ skeleton แบบ panel
 * จะโผล่มาอยู่ในเลย์เอาต์ปกติ ไม่ใช่ในหน้าต่างซ้อน
 * ใช้ v-if ที่ template คู่กัน เพื่อให้ chunk โหลดตอนกดเปิดจริง ๆ
 */
const AchievementGallery = defineAsyncComponent(() => import('./components/AchievementGallery.vue'))

type ViewMode = 'month' | 'all'

const toLocalIsoDate = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// --- state ที่เป็นเรื่องของหน้าจอนี้จริง ๆ เท่านั้น ---
// ตัวที่เกี่ยวกับข้อมูล/auth/การนำทาง ย้ายไปอยู่ใน composables แล้ว
const exportBusy = ref(false)
const settingsOpen = ref(false)
const achievementsOpen = ref(false)
const selectionMode = ref(false)
const demoMode = ref(false)
const viewMode = ref<ViewMode>('month')
const todayDate = toLocalIsoDate(new Date())
const selectedOverviewMonth = ref(todayDate.slice(0, 7))
const selectedRecordDate = ref(todayDate)
const isOverviewMonthValid = computed(() =>
  /^\d{4}-(0[1-9]|1[0-2])$/.test(selectedOverviewMonth.value),
)

const {
  errorMessage,
  successMessage,
  showMessage,
  clearError,
  clearAll: clearMessages,
} = useAppMessages()

const showError = (message: string) => {
  errorMessage.value = message
}

const {
  activePage,
  navigateTo,
  rememberReturnLocation,
  restoreReturnLocation,
  clearReturnLocation,
} = useNavigation({
  // กลับมาหน้าจดรายการแล้วต้องออกจากโหมดเลือกหลายรายการเสมอ
  onNavigate: (page) => {
    if (page === 'record') selectionMode.value = false
  },
})

// undo ต้องเกิดก่อน tx เพราะ tx ต้องรู้ว่าจะเปิดหน้าต่าง "เลิกทำ" ที่ไหน
// ส่วน restore อ้างถึง tx แบบ lazy จึงไม่เป็นวงกลม
const undo = useUndoDelete({ restore: (transaction) => tx.restoreTransaction(transaction) })

const auth = useAuth({
  onMessage: showMessage,
  onError: showError,
  onSessionActive: async () => {
    await settings.loadSettings()
    await tx.loadTransactions()
    await loadAchievements()
    await checkAchievements()
    await tx.flushOfflineQueue()
  },
  onSessionCleared: () => clearAuthenticatedState(),
  onSignedIn: () => {
    demoMode.value = false
  },
  rememberReturnLocation,
  restoreReturnLocation,
  clearReturnLocation,
})

const settings = useServerSettings(auth.userId)

watch(settings.errorMessage, (message) => {
  if (message) showError(message)
})

const tx = useTransactions({
  userId: auth.userId,
  isDemoMode: () => demoMode.value,
  onMessage: showMessage,
  onError: showError,
  clearError,
  handleAuthError: auth.handleAuthError,
  onMutated: async () => {
    await checkAchievements()
  },
  onDeleted: undo.offerUndo,
  onBeforeBulkChange: undo.clearUndo,
})

const { session, authReady, authError, sessionExpired, signingOut, passwordRecovery } = auth
const { signOut, finishPasswordRecovery, cancelPasswordRecovery } = auth
const { deletedTransaction, undoBusy, clearUndo, undoDelete } = undo
const {
  transactions,
  editingTransaction,
  formVersion,
  loading,
  saving,
  bulkBusy,
  busyId,
  isOnline,
  offlineSyncing,
  offlinePendingCount,
  saveTransaction,
  editTransaction,
  deleteTransaction,
  flushOfflineQueue,
} = tx

const recordTransactions = computed(() =>
  transactions.value.filter(
    ({ transaction_date }) => transaction_date === selectedRecordDate.value,
  ),
)

const filteredTransactions = computed(() => {
  if (viewMode.value === 'all') return transactions.value
  if (!isOverviewMonthValid.value) return []

  return transactions.value.filter(({ transaction_date }) =>
    transaction_date.startsWith(selectedOverviewMonth.value),
  )
})

const overviewPeriodLabel = computed(() => {
  if (viewMode.value === 'all') return 'เงินทั้งหมด'
  if (!isOverviewMonthValid.value) return 'เลือกเดือน'

  return new Intl.DateTimeFormat('th-TH', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${selectedOverviewMonth.value}-01T12:00:00`))
})

const previousOverviewMonth = computed(() => {
  if (!isOverviewMonthValid.value) return ''
  const [year, month] = selectedOverviewMonth.value.split('-').map(Number)
  const previous = new Date(year, month - 2, 1)
  return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`
})

const previousMonthTransactions = computed(() => {
  if (!previousOverviewMonth.value) return []
  return transactions.value.filter(({ transaction_date }) =>
    transaction_date.startsWith(previousOverviewMonth.value),
  )
})

const displayedTransactions = computed(() =>
  selectionMode.value ? transactions.value : filteredTransactions.value,
)

const sumTransactions = (items: Transaction[], type: TransactionType) =>
  items
    .filter((transaction) => transaction.type === type)
    .reduce((sum, transaction) => sum + Number(transaction.amount), 0)

const income = computed(() => sumTransactions(filteredTransactions.value, 'income'))
const expense = computed(() => sumTransactions(filteredTransactions.value, 'expense'))
const openingBalance = computed(() => {
  if (viewMode.value !== 'month' || !isOverviewMonthValid.value) return 0

  const monthStart = `${selectedOverviewMonth.value}-01`
  const transactionsBeforeMonth = transactions.value.filter(
    ({ transaction_date }) => transaction_date < monthStart,
  )

  return (
    sumTransactions(transactionsBeforeMonth, 'income') -
    sumTransactions(transactionsBeforeMonth, 'expense')
  )
})
const balance = computed(() => openingBalance.value + income.value - expense.value)

const recordIncome = computed(() => sumTransactions(recordTransactions.value, 'income'))
const recordExpense = computed(() => sumTransactions(recordTransactions.value, 'expense'))
const recordBalance = computed(() => {
  const transactionsThroughSelectedDate = transactions.value.filter(
    ({ transaction_date }) => transaction_date <= selectedRecordDate.value,
  )

  return (
    sumTransactions(transactionsThroughSelectedDate, 'income') -
    sumTransactions(transactionsThroughSelectedDate, 'expense')
  )
})

const allIncome = computed(() => sumTransactions(transactions.value, 'income'))
const allExpense = computed(() => sumTransactions(transactions.value, 'expense'))
const allBalance = computed(() => allIncome.value - allExpense.value)

const {
  rows: achievementRows,
  unlockedCount: achievementsUnlocked,
  totalCount: achievementsTotal,
  progressPercent: achievementsPercent,
  loading: achievementsLoading,
  errorMessage: achievementsError,
  currentPending: pendingBadge,
  loadAchievements,
  checkAchievements,
  dismissPending,
  reset: resetAchievements,
} = useAchievements({
  transactions: () => transactions.value,
  balance: allBalance,
  userId: () => session.value?.user.id ?? null,
  demoMode,
})

// ความสำเร็จเป็นฟีเจอร์เสริม แต่ถ้าเขียน/อ่านไม่สำเร็จต้องให้ผู้ใช้เห็นสาเหตุ ไม่ใช่เงียบไป
watch(achievementsError, (message) => {
  if (message) errorMessage.value = message
})

const isRecordToday = computed(() => selectedRecordDate.value === todayDate)

const recordDateLabel = computed(() =>
  new Intl.DateTimeFormat('th-TH', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${selectedRecordDate.value}T12:00:00`)),
)

const shiftRecordDate = (amount: number) => {
  const date = new Date(`${selectedRecordDate.value}T12:00:00`)
  date.setDate(date.getDate() + amount)
  const nextDate = toLocalIsoDate(date)
  if (nextDate <= todayDate) selectedRecordDate.value = nextDate
}

const goToToday = () => {
  selectedRecordDate.value = todayDate
}

const emptyListHint = computed(() => {
  if (selectionMode.value || viewMode.value === 'all') {
    return 'ยังไม่มีรายการ ลองเพิ่มรายรับหรือรายจ่ายรายการแรก'
  }
  if (!selectedOverviewMonth.value) return 'เลือกเดือนที่ต้องการดูรายการ'
  return `ยังไม่มีรายการใน${overviewPeriodLabel.value}`
})

const handleMonthlyExport = async () => {
  if (exportBusy.value || viewMode.value !== 'month') return

  if (!isOverviewMonthValid.value) {
    errorMessage.value = 'กรุณาเลือกเดือนที่ต้องการส่งออกให้ถูกต้อง'
    return
  }

  if (filteredTransactions.value.length === 0) {
    errorMessage.value = 'เดือนนี้ยังไม่มีข้อมูลให้ส่งออก'
    return
  }

  exportBusy.value = true
  errorMessage.value = ''

  try {
    const result = await exportMonthlyCsv({
      month: selectedOverviewMonth.value,
      monthLabel: overviewPeriodLabel.value,
      transactions: filteredTransactions.value,
      openingBalance: openingBalance.value,
      income: income.value,
      expense: expense.value,
      closingBalance: balance.value,
    })

    if (result === 'downloaded') showMessage('ดาวน์โหลดรายงาน CSV เรียบร้อยแล้ว')
    if (result === 'shared') showMessage('สร้างรายงานพร้อมแชร์เรียบร้อยแล้ว')
  } catch (error) {
    errorMessage.value =
      error instanceof Error
        ? `ส่งออกรายงานไม่สำเร็จ: ${error.message}`
        : 'ส่งออกรายงานไม่สำเร็จ กรุณาลองอีกครั้ง'
  } finally {
    exportBusy.value = false
  }
}

const enterDemoMode = () => {
  demoMode.value = true
  clearError()
  clearUndo()
  tx.setTransactions(createDemoTransactions())
  selectedRecordDate.value = todayDate
  selectedOverviewMonth.value = todayDate.slice(0, 7)
  viewMode.value = 'month'
  selectionMode.value = false
  navigateTo('record')
  void loadAchievements()
  showMessage('เข้าโหมดดูตัวอย่างแล้ว ข้อมูลทั้งหมดเป็นตัวอย่างสมมติ')
}

const exitDemoMode = () => {
  demoMode.value = false
  clearAuthenticatedState()
  navigateTo('record')
}

/** เลือกวันจากปฏิทินความร้อนแล้วกระโดดไปหน้าจดรายการของวันนั้น */
const openRecordDay = (date: string) => {
  if (date > todayDate) return
  selectedRecordDate.value = date
  navigateTo('record')
}

const startSelectionMode = async () => {
  viewMode.value = 'all'
  selectionMode.value = true
  navigateTo('overview')
  await nextTick()
  document.querySelector('.overview-list')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

/** ปิดโหมดเลือกหลายรายการเมื่อการลบสำเร็จ ส่วนที่เหลือ useTransactions จัดการเอง */
const handleBulkDelete = async (ids: string[]) => {
  if (await tx.deleteSelectedTransactions(ids)) selectionMode.value = false
}

const handleResetAll = async () => {
  if (await tx.resetAllTransactions()) {
    selectionMode.value = false
    settingsOpen.value = false
  }
}

/** ล้างทุกอย่างที่ผูกกับผู้ใช้คนก่อน ใช้ตอนออกจากระบบหรือสลับบัญชี */
const clearAuthenticatedState = () => {
  clearUndo()
  resetAchievements()
  tx.resetState()
  selectionMode.value = false
  settingsOpen.value = false
  achievementsOpen.value = false
  exportBusy.value = false
  clearMessages()
}

// การถอด listener ของ hash, undo timer และ auth subscription
// อยู่ใน onBeforeUnmount ของแต่ละ composable แล้ว
onMounted(() => void auth.initialize())
</script>

<template>
  <main v-if="!authReady" class="auth-loading-page" role="status" aria-live="polite">
    <div class="auth-loading-card">
      <span class="auth-loading-spinner" aria-hidden="true"></span>
      <strong>กำลังตรวจสอบการเข้าสู่ระบบ</strong>
      <small>รอสักครู่นะ</small>
    </div>
  </main>

  <PasswordResetScreen
    v-else-if="passwordRecovery"
    @done="finishPasswordRecovery"
    @cancel="cancelPasswordRecovery"
  />

  <AuthGate
    v-else-if="!session && !demoMode"
    :initial-error="
      sessionExpired
        ? 'เซสชันหมดอายุแล้ว กรุณาเข้าสู่ระบบใหม่ ระบบจะพากลับไปหน้าที่ค้างไว้'
        : authError
    "
    @demo="enterDemoMode"
  />

  <div v-else class="app-shell" :class="{ 'app-shell--demo': demoMode }">
    <header class="topbar">
      <nav class="navbar container">
        <a
          class="brand"
          href="#record"
          aria-label="Money Flow หน้าจดรายการ"
          @click="activePage = 'record'"
        >
          <span class="brand-mark">฿</span>
          <span>Money Flow</span>
        </a>

        <div class="page-nav" role="navigation" aria-label="เมนูหลัก">
          <button
            type="button"
            :class="{ active: activePage === 'record' }"
            @click="navigateTo('record')"
          >
            <span aria-hidden="true">＋</span> จดรายการ
          </button>
          <button
            type="button"
            :class="{ active: activePage === 'overview' }"
            @click="navigateTo('overview')"
          >
            <span aria-hidden="true">▥</span> ภาพรวม
          </button>
          <button
            type="button"
            :class="{ active: activePage === 'analytics' }"
            @click="navigateTo('analytics')"
          >
            <span aria-hidden="true">◹</span> วิเคราะห์
          </button>
        </div>

        <div class="nav-actions">
          <span
            v-if="!isOnline || offlinePendingCount > 0"
            class="offline-badge"
            :class="{ 'offline-badge--syncing': isOnline && offlineSyncing }"
            role="status"
            aria-live="polite"
            :title="
              !isOnline
                ? 'ไม่มีการเชื่อมต่ออินเทอร์เน็ต รายการที่จดจะถูกเก็บไว้ในคิว'
                : `มี ${offlinePendingCount} รายการรอซิงก์`
            "
          >
            <span class="offline-dot" aria-hidden="true"></span>
            <span class="offline-copy">
              <small>{{ !isOnline ? 'ออฟไลน์' : offlineSyncing ? 'กำลังซิงก์' : 'รอซิงก์' }}</small>
              <b v-if="offlinePendingCount > 0">{{ offlinePendingCount }} รายการ</b>
              <b v-else>เก็บไว้ในเครื่อง</b>
            </span>
            <button
              v-if="isOnline && offlinePendingCount > 0 && !offlineSyncing"
              type="button"
              class="offline-retry"
              aria-label="ลองซิงก์อีกครั้ง"
              @click="flushOfflineQueue()"
            >
              ซิงก์
            </button>
          </span>

          <span
            class="connection-badge"
            :class="demoMode ? 'demo-badge' : 'connected'"
            :title="demoMode ? 'โหมดดูตัวอย่าง' : (session?.user.email ?? 'เข้าสู่ระบบแล้ว')"
          >
            <span class="connection-dot"></span>
            <span class="account-copy">
              <small>{{ demoMode ? 'โหมดดูตัวอย่าง' : 'เข้าสู่ระบบแล้ว' }}</small>
              <b>{{ demoMode ? DEMO_USER_EMAIL : (session?.user.email ?? 'บัญชีผู้ใช้') }}</b>
            </span>
          </span>
          <button
            v-if="demoMode"
            class="logout-trigger"
            type="button"
            aria-label="ออกจากโหมดดูตัวอย่าง"
            title="ออกจากโหมดดูตัวอย่าง"
            @click="exitDemoMode"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10M14 8l4 4-4 4M9 12h9"
              />
            </svg>
          </button>
          <button
            v-else
            class="logout-trigger"
            type="button"
            :disabled="signingOut"
            :aria-label="signingOut ? 'กำลังออกจากระบบ' : 'ออกจากระบบ'"
            title="ออกจากระบบ"
            @click="signOut"
          >
            <span v-if="signingOut" class="logout-spinner" aria-hidden="true"></span>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10M14 8l4 4-4 4M9 12h9"
              />
            </svg>
          </button>
          <button
            class="achievements-trigger"
            type="button"
            :aria-label="`เปิดตู้ความสำเร็จ ปลดล็อคแล้ว ${achievementsUnlocked} จาก ${achievementsTotal} ใบ`"
            :title="`ความสำเร็จ ${achievementsUnlocked}/${achievementsTotal}`"
            @click="achievementsOpen = true"
          >
            <span aria-hidden="true">🏆</span>
            <b v-if="achievementsUnlocked > 0" aria-hidden="true">{{ achievementsUnlocked }}</b>
          </button>
          <button
            class="settings-trigger"
            type="button"
            aria-label="เปิดการตั้งค่า"
            @click="settingsOpen = true"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
              />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>
      </nav>
    </header>

    <main class="container dashboard">
      <aside v-if="demoMode" class="demo-banner" role="status">
        <div class="demo-banner__icon" aria-hidden="true">👀</div>
        <div class="demo-banner__copy">
          <strong>กำลังดูตัวอย่างแอป</strong>
          <p>
            ข้อมูล 6 เดือนนี้เป็นตัวอย่างสมมติ ลองกดดูกราฟ สลับเดือน
            และเปิดสัดส่วนหมวดหมู่ได้เต็มที่ แต่เพิ่ม แก้ไข หรือลบไม่ได้
          </p>
        </div>
        <button type="button" @click="exitDemoMode">เข้าสู่ระบบ</button>
      </aside>

      <aside v-else-if="!isBackendConfigured" class="setup-notice" role="status">
        <div class="setup-notice__icon">!</div>
        <div>
          <strong>ยังไม่ได้เชื่อมฐานข้อมูล</strong>
          <p>
            ใส่ค่า API URL และ Cognito ในไฟล์ <code>web/.env.local</code> (ดู
            <code>.env.example</code>) แล้วเปิดเว็บใหม่
          </p>
        </div>
      </aside>

      <div v-if="errorMessage" class="alert alert--error" role="alert">
        <span>!</span>{{ errorMessage }}
        <button type="button" aria-label="ปิดข้อความ" @click="errorMessage = ''">×</button>
      </div>

      <div v-if="successMessage" class="toast" role="status">✓ {{ successMessage }}</div>

      <Transition name="undo-toast">
        <div v-if="deletedTransaction" class="undo-toast" role="status">
          <div class="undo-icon" aria-hidden="true">↶</div>
          <div>
            <strong>ลบ “{{ deletedTransaction.description }}” แล้ว</strong>
            <small>กู้คืนได้อีกครู่หนึ่ง</small>
          </div>
          <button type="button" :disabled="undoBusy" @click="undoDelete">
            <span v-if="undoBusy" class="spinner spinner--dark" aria-hidden="true"></span>
            {{ undoBusy ? 'กำลังกู้คืน' : 'เลิกทำ' }}
          </button>
          <button
            class="undo-close"
            type="button"
            aria-label="ปิด"
            :disabled="undoBusy"
            @click="clearUndo"
          >
            ×
          </button>
        </div>
      </Transition>

      <Transition name="page" mode="out-in">
        <RecordPage
          v-if="activePage === 'record'"
          key="record"
          :transactions="transactions"
          :record-transactions="recordTransactions"
          :selected-date="selectedRecordDate"
          :is-today="isRecordToday"
          :date-label="recordDateLabel"
          :form-version="formVersion"
          :saving="saving"
          :loading="loading"
          :busy-id="busyId"
          :bulk-busy="bulkBusy"
          :read-only="demoMode"
          :form-disabled="!isBackendConfigured || demoMode"
          :record-balance="recordBalance"
          :record-income="recordIncome"
          :record-expense="recordExpense"
          :all-balance="allBalance"
          :all-income="allIncome"
          :all-expense="allExpense"
          @previous-day="shiftRecordDate(-1)"
          @next-day="shiftRecordDate(1)"
          @today="goToToday"
          @show-overview="navigateTo('overview')"
          @submit="saveTransaction"
          @edit="editTransaction"
          @delete="deleteTransaction"
          @bulk-delete="handleBulkDelete"
          @cancel-selection="selectionMode = false"
          @open-settings="settingsOpen = true"
        />

        <OverviewPage
          v-else-if="activePage === 'overview'"
          key="overview"
          :transactions="transactions"
          :filtered-transactions="filteredTransactions"
          :displayed-transactions="displayedTransactions"
          :previous-month-transactions="previousMonthTransactions"
          :selected-month="selectedOverviewMonth"
          :today-month="todayDate.slice(0, 7)"
          :view-mode="viewMode"
          :month-valid="isOverviewMonthValid"
          :period-label="overviewPeriodLabel"
          :empty-list-hint="emptyListHint"
          :balance="balance"
          :income="income"
          :expense="expense"
          :loading="loading"
          :busy-id="busyId"
          :bulk-busy="bulkBusy"
          :selection-mode="selectionMode"
          :read-only="demoMode"
          :export-busy="exportBusy"
          @update:view-mode="viewMode = $event"
          @update:selected-month="selectedOverviewMonth = $event"
          @select-day="openRecordDay"
          @export="handleMonthlyExport"
          @edit="editTransaction"
          @delete="deleteTransaction"
          @bulk-delete="handleBulkDelete"
          @cancel-selection="selectionMode = false"
        />

        <AnalyticsPage v-else key="analytics" :transactions="transactions" :read-only="demoMode" />
      </Transition>
    </main>

    <EditTransactionModal
      :transaction="editingTransaction"
      :busy="saving"
      @close="editingTransaction = null"
      @submit="saveTransaction"
    />

    <SettingsModal
      :open="settingsOpen"
      :transaction-count="transactions.length"
      :busy="bulkBusy"
      :read-only="demoMode"
      @close="settingsOpen = false"
      @manage="startSelectionMode"
      @reset="handleResetAll"
    />

    <AchievementGallery
      v-if="achievementsOpen"
      :open="achievementsOpen"
      :rows="achievementRows"
      :unlocked-count="achievementsUnlocked"
      :total-count="achievementsTotal"
      :progress-percent="achievementsPercent"
      :loading="achievementsLoading"
      :read-only="demoMode"
      @close="achievementsOpen = false"
    />

    <AchievementToast :badge="pendingBadge" @done="dismissPending" />
  </div>
</template>

<style scoped>
.auth-loading-page {
  display: grid;
  min-height: 100vh;
  min-height: 100dvh;
  place-items: center;
  padding: 24px;
  color: #fff;
  background: linear-gradient(145deg, #153d30, #1d5a43 58%, #286b4f);
  font-family: 'Noto Sans Thai', sans-serif;
}

.auth-loading-card {
  display: grid;
  min-width: min(300px, 100%);
  justify-items: center;
  gap: 7px;
  padding: 28px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.08);
  box-shadow: 0 20px 55px rgba(7, 28, 19, 0.2);
}

.auth-loading-card strong {
  font-size: 0.82rem;
}
.auth-loading-card small {
  color: rgba(255, 255, 255, 0.62);
  font-size: 0.64rem;
}

.auth-loading-spinner {
  width: 28px;
  height: 28px;
  margin-bottom: 5px;
  border: 3px solid rgba(255, 255, 255, 0.25);
  border-top-color: var(--lime);
  border-radius: 50%;
  animation: auth-spin 0.75s linear infinite;
}

@keyframes auth-spin {
  to {
    transform: rotate(360deg);
  }
}

.app-shell {
  min-height: 100vh;
}

.topbar {
  position: sticky;
  z-index: 30;
  top: 0;
  height: 62px;
  color: white;
  background: #194d3b;
  box-shadow: 0 6px 24px rgba(19, 57, 43, 0.14);
}

.navbar {
  height: 100%;
  padding-top: 0;
}

.page-nav {
  position: absolute;
  left: 50%;
  display: flex;
  padding: 3px;
  border: 1px solid rgba(255, 255, 255, 0.11);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.07);
  transform: translateX(-50%);
}

.page-nav button {
  display: inline-flex;
  min-height: 31px;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border: 0;
  border-radius: 7px;
  color: rgba(255, 255, 255, 0.66);
  background: transparent;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.66rem;
  font-weight: 700;
}

.page-nav button.active {
  color: var(--green);
  background: var(--lime);
}

.nav-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.nav-actions .connection-badge {
  max-width: 210px;
  padding: 5px 9px;
  border-radius: 10px;
}

.offline-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 9px;
  border: 1px solid rgba(127, 201, 209, 0.4);
  border-radius: 10px;
  background: rgba(127, 201, 209, 0.16);
}

.offline-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 7px;
  border-radius: 50%;
  background: var(--watch-soft);
}

.offline-badge--syncing .offline-dot {
  animation: offline-pulse 1.1s ease-in-out infinite;
}

@keyframes offline-pulse {
  50% {
    opacity: 0.25;
  }
}

.offline-copy {
  display: grid;
  min-width: 0;
  line-height: 1.15;
}

.offline-copy small {
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.45rem;
  font-weight: 600;
}

.offline-copy b {
  overflow: hidden;
  color: #d7f0f3;
  font-size: 0.58rem;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.offline-retry {
  padding: 4px 7px;
  border: 1px solid rgba(215, 240, 243, 0.35);
  border-radius: 7px;
  color: #d7f0f3;
  background: transparent;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.55rem;
  font-weight: 700;
  cursor: pointer;
}

.offline-retry:hover {
  color: #194d3b;
  background: #d7f0f3;
}

.offline-retry:focus-visible {
  outline: 2px solid rgba(201, 240, 108, 0.55);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .offline-badge--syncing .offline-dot {
    animation: none;
  }
}

.account-copy {
  display: grid;
  min-width: 0;
  line-height: 1.15;
}

.account-copy small {
  color: rgba(255, 255, 255, 0.52);
  font-size: 0.45rem;
  font-weight: 600;
}

.account-copy b {
  overflow: hidden;
  color: rgba(255, 255, 255, 0.86);
  font-size: 0.58rem;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.logout-trigger {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.17);
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.78);
  background: rgba(255, 255, 255, 0.07);
  transition:
    color 0.2s,
    background 0.2s;
}

.logout-trigger:hover:not(:disabled) {
  color: #194d3b;
  background: var(--alert-line);
}

.logout-trigger:focus-visible,
.settings-trigger:focus-visible {
  outline: 3px solid rgba(201, 240, 108, 0.45);
  outline-offset: 2px;
}

.logout-trigger svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.logout-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: auth-spin 0.7s linear infinite;
}

.achievements-trigger {
  position: relative;
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.17);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.07);
  font-size: 0.92rem;
  line-height: 1;
  transition:
    background 0.2s,
    transform 0.2s;
}

.achievements-trigger:hover {
  background: rgba(143, 208, 106, 0.22);
  transform: translateY(-1px);
}

.achievements-trigger:focus-visible {
  outline: 3px solid rgba(201, 240, 108, 0.45);
  outline-offset: 2px;
}

.achievements-trigger b {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 16px;
  padding: 1px 4px;
  border-radius: 999px;
  color: #194d3b;
  background: var(--lime);
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.48rem;
  font-weight: 800;
  line-height: 1.35;
}

.settings-trigger {
  display: grid;
  box-sizing: border-box;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.17);
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.78);
  background: rgba(255, 255, 255, 0.07);
  transition:
    color 0.2s,
    background 0.2s,
    border-color 0.2s;
}

.settings-trigger:hover {
  color: var(--green);
  background: var(--lime);
}

.settings-trigger svg {
  display: block;
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
  transform-origin: center;
  transition: transform 0.2s ease;
}

@media (hover: hover) and (pointer: fine) {
  .settings-trigger:hover svg {
    transform: rotate(15deg);
  }
}

.dashboard {
  display: block;
  width: min(1180px, calc(100% - 32px));
  min-height: 0;
  padding-block: 12px 28px;
}

.demo-banner {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  margin-bottom: 11px;
  padding: 11px 13px;
  border: 1px solid var(--cheer-line);
  border-radius: 13px;
  background: var(--cheer-tint);
  font-family: 'Noto Sans Thai', sans-serif;
}

.demo-banner__icon {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 11px;
  background: var(--cheer-line);
  font-size: 1rem;
}

.demo-banner__copy strong {
  color: var(--cheer-ink);
  font-size: 0.74rem;
}

.demo-banner__copy p {
  margin: 2px 0 0;
  color: var(--cheer-text);
  font-size: 0.62rem;
  line-height: 1.5;
}

.demo-banner button {
  min-height: 34px;
  padding: 7px 13px;
  border: 1px solid #194d3b;
  border-radius: 9px;
  color: #fff;
  background: #194d3b;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.65rem;
  font-weight: 800;
  white-space: nowrap;
}

.demo-badge {
  border-color: rgba(143, 208, 106, 0.35) !important;
  background: rgba(143, 208, 106, 0.14) !important;
}

.demo-badge .connection-dot {
  background: var(--cheer);
}

.undo-toast {
  position: fixed;
  z-index: 80;
  right: 22px;
  bottom: 22px;
  display: grid;
  max-width: min(390px, calc(100% - 24px));
  grid-template-columns: 34px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  padding: 11px 12px;
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 14px;
  color: white;
  background: #193c2f;
  box-shadow: 0 18px 50px rgba(10, 35, 25, 0.28);
  font-family: 'Noto Sans Thai', sans-serif;
}

.undo-icon {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 10px;
  color: #194d3b;
  background: var(--lime);
  font-size: 1rem;
  font-weight: 800;
}

.undo-toast strong,
.undo-toast small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.undo-toast strong {
  font-size: 0.72rem;
}
.undo-toast small {
  margin-top: 2px;
  color: rgba(255, 255, 255, 0.58);
  font-size: 0.58rem;
}

.undo-toast > button:not(.undo-close) {
  display: inline-flex;
  min-height: 32px;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border: 1px solid rgba(201, 240, 108, 0.42);
  border-radius: 8px;
  color: var(--lime);
  background: rgba(201, 240, 108, 0.08);
  font-size: 0.65rem;
  font-weight: 800;
}

.undo-close {
  padding: 3px;
  border: 0;
  color: rgba(255, 255, 255, 0.5);
  background: transparent;
  font-size: 1rem;
}

.undo-toast-enter-active,
.undo-toast-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.28s cubic-bezier(0.2, 0.9, 0.2, 1);
}

.undo-toast-enter-from,
.undo-toast-leave-to {
  opacity: 0;
  transform: translateY(16px) scale(0.97);
}

.page-enter-active,
.page-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.page-enter-from {
  opacity: 0;
  transform: translateY(9px);
}

.page-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (prefers-reduced-motion: reduce) {
  .page-enter-active,
  .page-leave-active {
    transition: none;
  }
}

@media (max-width: 780px) {
  .dashboard {
    min-height: auto;
  }
  .page-nav {
    position: static;
    transform: none;
  }
}

@media (max-width: 580px) {
  .undo-toast {
    right: 12px;
    bottom: 12px;
    left: 12px;
    grid-template-columns: 30px minmax(0, 1fr) auto;
  }
  .undo-close {
    display: none;
  }
  .undo-icon {
    width: 30px;
    height: 30px;
  }
  .topbar {
    height: auto;
    min-height: 58px;
  }
  .navbar {
    flex-wrap: wrap;
    gap: 7px;
    padding-block: 9px;
  }
  .brand > span:last-child {
    display: none;
  }
  .page-nav {
    order: 3;
    width: 100%;
  }
  .page-nav button {
    flex: 1;
    justify-content: center;
  }
  .connection-badge {
    max-width: 145px;
    font-size: 0.6rem;
  }
  .dashboard {
    padding-top: 9px;
  }
  .demo-banner {
    grid-template-columns: 32px minmax(0, 1fr);
  }
  .demo-banner__icon {
    width: 32px;
    height: 32px;
    border-radius: 9px;
  }
  .demo-banner button {
    grid-column: 1 / -1;
  }
}

.app-shell {
  min-height: 100dvh;
}

@media (display-mode: standalone) {
  .auth-loading-page {
    padding-top: max(24px, var(--safe-top));
    padding-right: max(24px, var(--safe-right));
    padding-bottom: max(24px, var(--safe-bottom));
    padding-left: max(24px, var(--safe-left));
  }

  .topbar {
    height: calc(62px + var(--safe-top));
    padding-top: var(--safe-top);
  }

  .dashboard {
    padding-right: var(--safe-right);
    padding-bottom: calc(28px + var(--safe-bottom));
    padding-left: var(--safe-left);
  }

  .undo-toast {
    right: calc(22px + var(--safe-right));
    bottom: calc(22px + var(--safe-bottom));
  }
}

@media (display-mode: standalone) and (max-width: 580px) {
  .topbar {
    height: auto;
    min-height: calc(58px + var(--safe-top));
  }

  .navbar {
    height: auto;
  }

  .undo-toast {
    right: calc(12px + var(--safe-right));
    bottom: calc(12px + var(--safe-bottom));
    left: calc(12px + var(--safe-left));
  }
}
</style>
