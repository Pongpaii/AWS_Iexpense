<script setup lang="ts">
import type {
  Transaction,
  TransactionCreateInput,
  TransactionUpdateInput,
} from '@money-flow/shared';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { errorMessage } from '../api/client';
import { checkAchievements, moneyStore, profileStore } from '../app-context';
import DailyCapCard from '../components/analytics/DailyCapCard.vue';
import SummaryCards from '../components/SummaryCards.vue';
import TransactionForm from '../components/TransactionForm.vue';
import TransactionList from '../components/TransactionList.vue';
import { dailyCapStatus } from '../lib/analytics';
import { currentMonth, formatThaiMonth, shiftMonth, todayLocal } from '../lib/date';
import { showToast } from '../stores/toast';

const store = computed(() => moneyStore.value!);
const s = computed(() => store.value.state);

const formRef = ref<InstanceType<typeof TransactionForm> | null>(null);
const editing = ref<Transaction | null>(null);
const submitting = ref(false);
const busy = ref(false);

const isCurrentMonth = computed(() => s.value.month === currentMonth());
const settings = computed(() => profileStore.value?.state.settings);
/** งบรายวัน: รายการวันนี้อยู่ต้นรายการเสมอ (เรียงใหม่สุดก่อน) */
const capStatus = computed(() =>
  settings.value && isCurrentMonth.value
    ? dailyCapStatus(settings.value.dailyCap, s.value.items, todayLocal())
    : null,
);

const badgeCheck = () => void checkAchievements().catch(() => undefined);

async function load(month?: string) {
  try {
    await store.value.loadMonth(month);
  } catch (err) {
    showToast(errorMessage(err), { kind: 'error' });
  }
}

onMounted(async () => {
  await load();
  badgeCheck();
});
// กลับมาออนไลน์ → app-context โหลดใหม่ให้แล้ว; ที่นี่แค่ปิดโหมดแก้ไขเมื่อออฟไลน์
watch(
  // optional chaining: store เป็น null ได้ชั่วขณะตอนออกจากระบบ
  () => moneyStore.value?.state.online,
  (online) => {
    if (!online) editing.value = null;
  },
);

async function onCreate(input: TransactionCreateInput) {
  submitting.value = true;
  try {
    const res = await store.value.add(input);
    formRef.value?.reset();
    if (res.status === 'saved') badgeCheck();
    if (res.status === 'queued') {
      showToast('บันทึกไว้ในเครื่องแล้ว จะซิงก์อัตโนมัติเมื่อออนไลน์');
    } else {
      showToast('บันทึกรายการแล้ว', { kind: 'success' });
    }
  } catch (err) {
    formRef.value?.showError(errorMessage(err));
  } finally {
    submitting.value = false;
  }
}

async function onUpdate(id: string, patch: TransactionUpdateInput) {
  submitting.value = true;
  try {
    await store.value.update(id, patch);
    editing.value = null;
    showToast('แก้ไขรายการแล้ว', { kind: 'success' });
  } catch (err) {
    formRef.value?.showError(errorMessage(err));
  } finally {
    submitting.value = false;
  }
}

async function startEdit(t: Transaction) {
  editing.value = t;
  await nextTick();
  document.getElementById('entry')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  formRef.value?.focus();
}

async function withUndo(message: string, action: () => Promise<() => Promise<void>>) {
  busy.value = true;
  try {
    const undo = await action();
    showToast(message, {
      action: {
        label: 'เลิกทำ',
        run: async () => {
          try {
            await undo();
            showToast('กู้คืนแล้ว', { kind: 'success' });
          } catch (err) {
            showToast(errorMessage(err), { kind: 'error' });
          }
        },
      },
    });
  } catch (err) {
    showToast(errorMessage(err), { kind: 'error' });
  } finally {
    busy.value = false;
  }
}

function onRemove(t: Transaction) {
  if (editing.value?.id === t.id) editing.value = null;
  return withUndo(`ลบ "${t.description}" แล้ว`, () => store.value.remove(t.id));
}

function onBulkRemove(ids: string[]) {
  if (!window.confirm(`ลบ ${ids.length} รายการที่เลือก?`)) return;
  return withUndo(`ลบ ${ids.length} รายการแล้ว`, async () => {
    const { deleted, undo } = await store.value.bulkRemove(ids);
    if (deleted.length < ids.length) {
      showToast(`ลบไม่ได้ ${ids.length - deleted.length} รายการ (อาจถูกลบไปแล้ว)`);
    }
    return undo;
  });
}

async function onLoadMore() {
  try {
    await store.value.loadMore();
  } catch (err) {
    showToast(errorMessage(err), { kind: 'error' });
  }
}

async function onSync() {
  try {
    const { synced, failed } = await store.value.sync();
    if (synced) showToast(`ซิงก์แล้ว ${synced} รายการ`, { kind: 'success' });
    if (failed) showToast(`ซิงก์ไม่สำเร็จ ${failed} รายการ`, { kind: 'error' });
  } catch (err) {
    showToast(errorMessage(err), { kind: 'error' });
  }
}
</script>

<template>
  <div class="dashboard">
    <h1 class="visually-hidden">ภาพรวม</h1>

    <nav class="month-nav" aria-label="เลือกเดือน">
      <button
        type="button"
        class="btn btn-secondary btn-icon"
        aria-label="เดือนก่อนหน้า"
        @click="load(shiftMonth(s.month, -1))"
      >
        ‹
      </button>
      <h2 class="month-label" aria-live="polite">{{ formatThaiMonth(s.month) }}</h2>
      <button
        type="button"
        class="btn btn-secondary btn-icon"
        aria-label="เดือนถัดไป"
        @click="load(shiftMonth(s.month, 1))"
      >
        ›
      </button>
      <button
        v-if="!isCurrentMonth"
        type="button"
        class="btn btn-link"
        @click="load(currentMonth())"
      >
        เดือนนี้
      </button>
    </nav>

    <p v-if="s.error" class="form-error" role="alert">
      {{ s.error }}
      <button type="button" class="btn btn-link" @click="load()">ลองใหม่</button>
    </p>

    <SummaryCards
      :balance="s.balance"
      :monthly="s.monthly"
      :month="s.month"
      :loading="s.loadingSummary && s.online"
    />

    <DailyCapCard
      v-if="capStatus?.enabled"
      :status="capStatus"
      :excluded="settings?.dailyCap.excludedCategories ?? []"
    />

    <div v-if="s.pending.length && s.online" class="sync-bar card">
      <span>มี {{ s.pending.length }} รายการรอซิงก์</span>
      <button type="button" class="btn btn-secondary" :disabled="s.syncing" @click="onSync">
        {{ s.syncing ? 'กำลังซิงก์…' : 'ซิงก์ตอนนี้' }}
      </button>
    </div>

    <div id="entry">
      <TransactionForm
        ref="formRef"
        :editing="editing"
        :submitting="submitting"
        :disabled="!s.online"
        @create="onCreate"
        @update="onUpdate"
        @cancel="editing = null"
      />
    </div>

    <TransactionList
      :items="s.items"
      :pending="s.pending"
      :online="s.online"
      :loading="s.loadingList"
      :loading-more="s.loadingMore"
      :has-more="!!s.nextCursor"
      :busy="busy"
      @edit="startEdit"
      @remove="onRemove"
      @bulk-remove="onBulkRemove"
      @load-more="onLoadMore"
      @discard-pending="(k) => store.discardPending(k)"
    />
  </div>
</template>

<style scoped>
.dashboard {
  display: grid;
  gap: 1rem;
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
.sync-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  background: var(--warning-bg);
  color: var(--warning-text);
}
#entry {
  scroll-margin-top: 5rem;
}
</style>
