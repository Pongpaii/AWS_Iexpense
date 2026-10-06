<script setup lang="ts">
import { dismissToast, toasts } from '../stores/toast';

async function runAction(id: number, run: () => void | Promise<void>) {
  dismissToast(id);
  await run();
}
</script>

<template>
  <!-- status = polite: อ่านข้อความให้ screen reader โดยไม่ขัดจังหวะ -->
  <div class="toast-host" role="status" aria-live="polite" aria-atomic="false">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="`toast-${t.kind}`">
      <span class="toast-message">{{ t.message }}</span>
      <button
        v-if="t.action"
        type="button"
        class="btn btn-secondary toast-action"
        @click="runAction(t.id, t.action.run)"
      >
        {{ t.action.label }}
      </button>
      <button
        type="button"
        class="btn btn-link btn-icon"
        aria-label="ปิดข้อความแจ้งเตือน"
        @click="dismissToast(t.id)"
      >
        ✕
      </button>
    </div>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  inset-inline: 0;
  /* อยู่เหนือแถบเมนูด้านล่าง */
  bottom: calc(4.5rem + env(safe-area-inset-bottom));
  display: grid;
  justify-items: center;
  gap: 0.5rem;
  padding-inline: 1rem;
  z-index: 50;
  pointer-events: none;
}
.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: min(100%, 32rem);
  padding: 0.5rem 0.5rem 0.5rem 1rem;
  border-radius: var(--radius);
  background: #1f2937;
  color: #fff;
  box-shadow: 0 4px 12px rgb(0 0 0 / 0.25);
}
.toast-error {
  background: #7f1d1d;
}
.toast-success {
  background: #14532d;
}
.toast-message {
  flex: 1;
}
.toast-action {
  min-height: 36px;
}
.toast .btn-link {
  color: #fff;
  text-decoration: none;
}
</style>
