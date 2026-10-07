<script setup lang="ts">
/**
 * โครงหน้าจอสำหรับคอมโพเนนต์ที่โหลดแบบ lazy
 *
 * ใช้เป็น loadingComponent ของ defineAsyncComponent เพื่อให้ช่วงที่ chunk
 * ยังโหลดไม่เสร็จ พื้นที่ยังคงความสูงไว้ หน้าจอจะไม่กระตุกตอนของจริงมาแทน
 */
withDefaults(
  defineProps<{
    /** ความสูงของพื้นที่เนื้อหา ให้ใกล้เคียงของจริงที่สุด */
    height?: number
    rows?: number
    label?: string
    variant?: 'chart' | 'list'
  }>(),
  { height: 220, rows: 4, label: 'กำลังโหลด', variant: 'chart' },
)
</script>

<template>
  <section class="panel skeleton-panel" role="status" :aria-label="label" aria-live="polite">
    <div class="skeleton-panel__heading">
      <span class="skeleton skeleton--text" style="width: 84px"></span>
      <span class="skeleton skeleton--title" style="width: 168px"></span>
    </div>

    <div
      v-if="variant === 'chart'"
      class="skeleton skeleton-panel__chart"
      :style="{ height: `${height}px` }"
    ></div>

    <ul v-else class="skeleton-panel__rows">
      <li v-for="row in rows" :key="row">
        <span class="skeleton skeleton--circle" style="width: 34px; height: 34px"></span>
        <span class="skeleton-panel__row-copy">
          <span class="skeleton skeleton--text" style="width: 62%"></span>
          <span class="skeleton skeleton--text" style="width: 38%; height: 8px"></span>
        </span>
        <span class="skeleton skeleton--text" style="width: 64px"></span>
      </li>
    </ul>

    <span class="visually-hidden">{{ label }}</span>
  </section>
</template>

<style scoped>
.skeleton-panel__heading {
  display: grid;
  gap: 7px;
  margin-bottom: 16px;
}

.skeleton-panel__chart {
  width: 100%;
  border-radius: 12px;
}

.skeleton-panel__rows {
  display: grid;
  gap: 14px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.skeleton-panel__rows li {
  display: grid;
  align-items: center;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  gap: 11px;
}

.skeleton-panel__row-copy {
  display: grid;
  gap: 6px;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
