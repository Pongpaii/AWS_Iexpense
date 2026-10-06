<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { moneyStore, signOutEverywhere } from './app-context';
import ErrorBoundary from './components/ErrorBoundary.vue';
import ToastHost from './components/ToastHost.vue';
import { hasAccess, session } from './stores/session';
import { showToast } from './stores/toast';

const router = useRouter();
const route = useRoute();
/** หน้าที่ต้อง login จะถูกถอดทันทีเมื่อ session จบ (กันอ่าน store ที่ถูกล้างแล้ว) */
const canRender = computed(() => !route.meta.requiresAuth || hasAccess());
const online = ref(navigator.onLine);
const setOnline = () => (online.value = navigator.onLine);
onMounted(() => {
  window.addEventListener('online', setOnline);
  window.addEventListener('offline', setOnline);
});
onBeforeUnmount(() => {
  window.removeEventListener('online', setOnline);
  window.removeEventListener('offline', setOnline);
});

const isDemo = computed(() => session.status === 'demo');
const pendingCount = computed(() => moneyStore.value?.state.pending.length ?? 0);

const NAV = [
  { to: '/', label: 'ภาพรวม', icon: '🏠' },
  { to: '/analytics', label: 'วิเคราะห์', icon: '📊' },
  { to: '/achievements', label: 'ความสำเร็จ', icon: '🏅' },
  { to: '/settings', label: 'ตั้งค่า', icon: '⚙️' },
];

async function onSignOut() {
  if (
    pendingCount.value > 0 &&
    !window.confirm('มีรายการที่ยังไม่ได้ซิงก์ ออกจากระบบต่อหรือไม่?')
  ) {
    return;
  }
  const wasDemo = isDemo.value;
  try {
    await signOutEverywhere();
  } finally {
    await router.replace({ name: 'login' });
    showToast(wasDemo ? 'ออกจากโหมดทดลองแล้ว' : 'ออกจากระบบแล้ว');
  }
}
</script>

<template>
  <a href="#main" class="skip-link">ข้ามไปยังเนื้อหาหลัก</a>
  <header class="app-header">
    <div class="header-inner">
      <RouterLink to="/" class="brand">Money Flow</RouterLink>
      <div v-if="hasAccess()" class="user">
        <span class="email">{{ session.user?.email }}</span>
        <button type="button" class="btn btn-secondary" @click="onSignOut">
          {{ isDemo ? 'ออกจากโหมดทดลอง' : 'ออกจากระบบ' }}
        </button>
      </div>
    </div>
    <p v-if="isDemo" class="banner demo" role="status">
      โหมดทดลอง — ข้อมูลตัวอย่าง อ่านอย่างเดียว ไม่มีการเชื่อมต่อเซิร์ฟเวอร์
    </p>
    <p v-else-if="!online" class="banner" role="status">
      ออฟไลน์อยู่ — รายการใหม่จะถูกเก็บไว้และซิงก์อัตโนมัติเมื่อกลับมาออนไลน์
    </p>
  </header>

  <main id="main" class="app-main" tabindex="-1">
    <ErrorBoundary>
      <RouterView v-if="canRender" />
    </ErrorBoundary>
  </main>

  <nav v-if="hasAccess()" class="tabbar" aria-label="เมนูหลัก">
    <RouterLink
      v-for="n in NAV"
      :key="n.to"
      :to="n.to"
      class="tab"
      active-class=""
      exact-active-class="active"
    >
      <span aria-hidden="true" class="tab-icon">{{ n.icon }}</span>
      <span>{{ n.label }}</span>
    </RouterLink>
  </nav>

  <ToastHost />
</template>

<style scoped>
.app-header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--surface);
  box-shadow: var(--shadow);
  padding-top: env(safe-area-inset-top);
}
.header-inner {
  max-width: 48rem;
  margin: 0 auto;
  padding: 0.5rem 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}
.brand {
  font-weight: 800;
  font-size: 1.125rem;
  color: var(--primary);
  text-decoration: none;
}
.user {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}
.email {
  color: var(--muted);
  font-size: 0.875rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.banner {
  margin: 0;
  padding: 0.5rem 1rem;
  text-align: center;
  background: var(--warning-bg);
  color: var(--warning-text);
  font-weight: 600;
}
.banner.demo {
  background: #eff6ff;
  color: #1e3a8a;
}
.app-main {
  max-width: 48rem;
  margin: 0 auto;
  padding: 1rem 1rem 8rem;
}
.app-main:focus {
  outline: none;
}
.tabbar {
  position: fixed;
  inset-inline: 0;
  bottom: 0;
  z-index: 20;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  background: var(--surface);
  border-top: 1px solid var(--border);
  padding-bottom: env(safe-area-inset-bottom);
}
.tab {
  display: grid;
  justify-items: center;
  gap: 0.125rem;
  min-height: 56px;
  padding: 0.375rem 0.25rem;
  font-size: 0.8125rem;
  color: var(--muted);
  text-decoration: none;
}
.tab.active {
  color: var(--primary);
  font-weight: 700;
}
.tab.active .tab-icon {
  transform: scale(1.1);
}
.tab-icon {
  font-size: 1.25rem;
}
@media (max-width: 30rem) {
  .email {
    display: none;
  }
}
</style>
