<script setup lang="ts">
import { settingsToInput, type Transaction } from '@money-flow/shared';
import { computed, defineAsyncComponent, nextTick, onMounted, ref, watch } from 'vue';
import { errorMessage } from '../api/client';
import { activeApi, moneyStore, profileStore } from '../app-context';
import {
  addDays,
  budgetVsActual,
  categoryBreakdown,
  dailyCapStatus,
  dailyCashflow,
  expenseHeatmap,
  forecastMonth,
  spendingInsights,
} from '../lib/analytics';
import { currentMonth, formatThaiMonth, monthRange, shiftMonth, todayLocal } from '../lib/date';
import { showToast } from '../stores/toast';

// กราฟโหลดแบบ lazy → หน้าแรกไม่ต้องโหลดโค้ดกราฟ
const CashflowChart = defineAsyncComponent(
  () => import('../components/analytics/CashflowChart.vue'),
);
const CategoryDonut = defineAsyncComponent(
  () => import('../components/analytics/CategoryDonut.vue'),
);
const CalendarHeatmap = defineAsyncComponent(
  () => import('../components/analytics/CalendarHeatmap.vue'),
);
const RunwayPanel = defineAsyncComponent(() => import('../components/analytics/RunwayPanel.vue'));
const BudgetVsActual = defineAsyncComponent(
  () => import('../components/analytics/BudgetVsActual.vue'),
);
const DailyCapCard = defineAsyncComponent(() => import('../components/analytics/DailyCapCard.vue'));
const MoneyBuddy = defineAsyncComponent(() => import('../components/analytics/MoneyBuddy.vue'));

const store = computed(() => moneyStore.value!);
const profile = computed(() => profileStore.value!);
const settings = computed(() => profile.value.state.settings);

const today = todayLocal();
const month = ref(store.value.state.month);
const monthTxs = ref<Transaction[]>([]);
const recentTxs = ref<Transaction[]>([]);
const balance = ref(0);
const loading = ref(true);
const error = ref('');
const savingHeat = ref(false);
const localExcluded = ref<string[] | null>(null);

type Tab = 'runway' | 'budget';
const tab = ref<Tab>('runway');
const tabs: { id: Tab; label: string }[] = [
  { id: 'runway', label: 'Runway' },
  { id: 'budget', label: 'งบ vs จ่ายจริง' },
];

let token = 0;
async function load() {
  const t = ++token;
  loading.value = true;
  error.value = '';
  try {
    const { from, to } = monthRange(month.value);
    const [m, recent, bal] = await Promise.all([
      store.value.fetchRange(from, to),
      store.value.fetchRange(addDays(today, -29), today),
      activeApi.value!.balance(),
    ]);
    if (t !== token) return;
    monthTxs.value = m;
    recentTxs.value = recent;
    balance.value = bal.balance;
  } catch (err) {
    if (t === token) error.value = errorMessage(err);
  } finally {
    if (t === token) loading.value = false;
  }
}
onMounted(load);
watch(month, load);

const excluded = computed(() => localExcluded.value ?? settings.value.heatmapExcludedCategories);
const flows = computed(() => dailyCashflow(monthTxs.value, month.value));
const slices = computed(() => categoryBreakdown(monthTxs.value));
const heat = computed(() => expenseHeatmap(monthTxs.value, month.value, excluded.value));
const heatCategories = computed(() => categoryBreakdown(monthTxs.value).map((s) => s.category));
const budgets = computed(() => budgetVsActual(settings.value.categoryBudgets, monthTxs.value));
const cap = computed(() => dailyCapStatus(settings.value.dailyCap, recentTxs.value, today));
const forecast = computed(() =>
  forecastMonth({ month: month.value, today, monthTxs: monthTxs.value, balance: balance.value }),
);
const insights = computed(() =>
  spendingInsights({
    monthTxs: monthTxs.value,
    forecast: forecast.value,
    settings: settings.value,
  }),
);

/** บันทึกหมวดที่ไม่นับใน heatmap ลง settings (demo: เก็บในหน้าอย่างเดียว) */
async function onExcluded(next: string[]) {
  localExcluded.value = next;
  if (profile.value.readOnly || !store.value.state.online) return;
  savingHeat.value = true;
  try {
    await profile.value.saveSettings({
      ...settingsToInput(settings.value),
      heatmapExcludedCategories: next,
    });
    localExcluded.value = null;
  } catch (err) {
    showToast(errorMessage(err), { kind: 'error' });
  } finally {
    savingHeat.value = false;
  }
}

/** tablist ตามแนวทาง WAI-ARIA: ลูกศรซ้าย/ขวาเลื่อน tab */
const tabEls = ref<HTMLButtonElement[]>([]);
async function onTabKey(e: KeyboardEvent, i: number) {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End')
    return;
  e.preventDefault();
  const n = tabs.length;
  const next =
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? n - 1
        : (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
  tab.value = tabs[next]!.id;
  await nextTick();
  tabEls.value[next]?.focus();
}
</script>

<template>
  <div class="analytics">
    <h1>วิเคราะห์</h1>

    <nav class="month-nav" aria-label="เลือกเดือน">
      <button
        type="button"
        class="btn btn-secondary btn-icon"
        aria-label="เดือนก่อนหน้า"
        @click="month = shiftMonth(month, -1)"
      >
        ‹
      </button>
      <h2 class="month-label" aria-live="polite">{{ formatThaiMonth(month) }}</h2>
      <button
        type="button"
        class="btn btn-secondary btn-icon"
        aria-label="เดือนถัดไป"
        @click="month = shiftMonth(month, 1)"
      >
        ›
      </button>
      <button
        v-if="month !== currentMonth()"
        type="button"
        class="btn btn-link"
        @click="month = currentMonth()"
      >
        เดือนนี้
      </button>
    </nav>

    <p v-if="!store.state.online" class="form-error" role="status">
      ออฟไลน์อยู่ — ต้องออนไลน์เพื่อโหลดข้อมูลวิเคราะห์
    </p>
    <p v-if="error" class="form-error" role="alert">
      {{ error }} <button type="button" class="btn btn-link" @click="load">ลองใหม่</button>
    </p>

    <div v-if="loading" class="grid" aria-busy="true">
      <span class="visually-hidden">กำลังโหลดข้อมูลวิเคราะห์</span>
      <span v-for="n in 3" :key="n" class="skeleton block" />
    </div>

    <template v-else-if="!error">
      <section class="card" aria-labelledby="buddy-title">
        <h2 id="buddy-title">MoneyBuddy: พฤติกรรมและคาดการณ์</h2>
        <MoneyBuddy :insights="insights" :forecast="forecast" />
      </section>

      <DailyCapCard
        v-if="month === currentMonth()"
        :status="cap"
        :excluded="settings.dailyCap.excludedCategories"
      />

      <section class="card">
        <div class="tablist" role="tablist" aria-label="มุมมองการวิเคราะห์">
          <button
            v-for="(t, i) in tabs"
            :id="`tab-${t.id}`"
            :key="t.id"
            :ref="(el) => (tabEls[i] = el as HTMLButtonElement)"
            type="button"
            role="tab"
            class="tab"
            :aria-selected="tab === t.id"
            :aria-controls="`panel-${t.id}`"
            :tabindex="tab === t.id ? 0 : -1"
            @click="tab = t.id"
            @keydown="onTabKey($event, i)"
          >
            {{ t.label }}
          </button>
        </div>
        <div
          v-show="tab === 'runway'"
          id="panel-runway"
          role="tabpanel"
          aria-labelledby="tab-runway"
          tabindex="0"
        >
          <RunwayPanel :balance="balance" :recent-txs="recentTxs" :today="today" />
        </div>
        <div
          v-show="tab === 'budget'"
          id="panel-budget"
          role="tabpanel"
          aria-labelledby="tab-budget"
          tabindex="0"
        >
          <BudgetVsActual :rows="budgets" />
        </div>
      </section>

      <section class="card" aria-labelledby="cash-title">
        <h2 id="cash-title">กระแสเงินสด</h2>
        <CashflowChart :flows="flows" />
      </section>

      <section class="card" aria-labelledby="donut-title">
        <h2 id="donut-title">สัดส่วนรายจ่ายตามหมวด</h2>
        <CategoryDonut :slices="slices" />
      </section>

      <section class="card" aria-labelledby="heat-title">
        <h2 id="heat-title">ปฏิทินรายจ่าย</h2>
        <CalendarHeatmap
          :cells="heat"
          :categories="heatCategories"
          :excluded="excluded"
          :saving="savingHeat"
          @update:excluded="onExcluded"
        />
      </section>
    </template>
  </div>
</template>

<style scoped>
.analytics {
  display: grid;
  gap: 1rem;
}
.analytics h1 {
  margin: 0;
}
.card h2 {
  font-size: 1.125rem;
}
.month-nav {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.month-label {
  margin: 0;
  min-width: 10rem;
  text-align: center;
  font-size: 1.25rem;
}
.grid {
  display: grid;
  gap: 1rem;
}
.block {
  height: 10rem;
}
.tablist {
  display: flex;
  gap: 0.25rem;
  border-bottom: 2px solid #e5e7eb;
  margin-bottom: 1rem;
}
.tab {
  min-height: 44px;
  padding: 0.5rem 1rem;
  border: 0;
  background: none;
  font: inherit;
  font-weight: 600;
  color: var(--muted);
  border-bottom: 3px solid transparent;
  margin-bottom: -2px;
  cursor: pointer;
}
.tab[aria-selected='true'] {
  color: var(--primary);
  border-bottom-color: var(--primary);
}
</style>
