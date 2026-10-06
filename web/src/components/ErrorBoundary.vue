<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue';

/** Error Boundary: จับ error ของ component ลูก แสดงหน้าสำรองแทนจอขาว */
const props = withDefaults(defineProps<{ title?: string }>(), {
  title: 'ส่วนนี้แสดงผลไม่สำเร็จ',
});

const failed = ref(false);
const attempt = ref(0);

onErrorCaptured((err) => {
  console.error('[ErrorBoundary]', err);
  failed.value = true;
  return false; // ไม่ส่งต่อไป global handler (แสดง fallback แล้ว)
});

const reload = () => window.location.reload();

function retry() {
  failed.value = false;
  attempt.value++;
}
</script>

<template>
  <div v-if="failed" class="card boundary" role="alert">
    <h2>{{ props.title }}</h2>
    <p>เกิดข้อผิดพลาดที่ไม่คาดคิด ข้อมูลของคุณยังปลอดภัย</p>
    <div class="actions">
      <button type="button" class="btn" @click="retry">ลองใหม่</button>
      <button type="button" class="btn btn-secondary" @click="reload">โหลดหน้าใหม่</button>
    </div>
  </div>
  <slot v-else :key="attempt" />
</template>

<style scoped>
.boundary {
  border-left: 4px solid var(--danger);
}
.actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
</style>
