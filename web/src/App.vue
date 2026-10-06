<script setup lang="ts">
import { loadConfig } from './config';

const config = loadConfig();
</script>

<template>
  <main class="app" aria-labelledby="app-title">
    <h1 id="app-title">Money Flow</h1>
    <p>บันทึกรายรับ–รายจ่ายของคุณ</p>
    <p v-if="!config.ok" role="status" class="notice">
      ยังไม่ได้ตั้งค่าเชื่อมต่อระบบ ({{ config.message }}) — ใช้งานได้เฉพาะโหมดทดลอง
    </p>
  </main>
</template>

<style>
:root {
  font-family: 'Noto Sans Thai', 'Sarabun', system-ui, sans-serif;
  color: #111827;
  background: #f9fafb;
}
.app {
  max-width: 40rem;
  margin: 0 auto;
  padding: 1.5rem 1rem;
}
.notice {
  padding: 0.75rem 1rem;
  border-left: 4px solid #b45309;
  background: #fffbeb;
  color: #78350f;
}
</style>
