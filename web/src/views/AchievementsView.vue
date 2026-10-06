<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { errorMessage } from '../api/client';
import { checkAchievements, moneyStore, profileStore } from '../app-context';
import { BADGES, currentStreak, longestStreak } from '../lib/achievements';
import { addDays } from '../lib/analytics';
import { formatThaiDate, todayLocal } from '../lib/date';
import { showToast } from '../stores/toast';

const profile = computed(() => profileStore.value!);
const store = computed(() => moneyStore.value!);
const earned = computed(
  () => new Map(profile.value.state.achievements.map((a) => [a.badgeId, a.earnedAt])),
);
const streak = ref<{ current: number; longest: number } | null>(null);

onMounted(async () => {
  try {
    const today = todayLocal();
    const recent = await store.value.fetchRange(addDays(today, -89), today);
    const dates = recent.map((t) => t.transactionDate);
    streak.value = { current: currentStreak(dates, today), longest: longestStreak(dates) };
    await checkAchievements();
  } catch (err) {
    showToast(errorMessage(err), { kind: 'error' });
  }
});
</script>

<template>
  <div class="ach">
    <h1>ความสำเร็จ</h1>

    <section class="card streak" aria-labelledby="streak-title">
      <h2 id="streak-title">Streak การบันทึก</h2>
      <p v-if="!streak" class="skeleton" style="height: 3rem">
        <span class="visually-hidden">กำลังโหลด</span>
      </p>
      <div v-else class="streak-nums">
        <p>
          <span class="big">🔥 {{ streak.current }}</span> วันติดต่อกัน (ปัจจุบัน)
        </p>
        <p>
          <span class="big">🏆 {{ streak.longest }}</span> วัน (ยาวที่สุดใน 90 วัน)
        </p>
      </div>
    </section>

    <section class="card" aria-labelledby="badges-title">
      <h2 id="badges-title">เหรียญรางวัล ({{ earned.size }}/{{ BADGES.length }})</h2>
      <ul class="badges">
        <li
          v-for="b in BADGES"
          :key="b.id"
          :class="{ locked: !earned.has(b.id) }"
          data-testid="badge"
        >
          <span class="icon" aria-hidden="true">{{ earned.has(b.id) ? b.icon : '🔒' }}</span>
          <span class="title">{{ b.title }}</span>
          <span class="desc">{{ b.description }}</span>
          <span class="when">
            {{
              earned.has(b.id)
                ? `ได้รับเมื่อ ${formatThaiDate(earned.get(b.id)!.slice(0, 10))}`
                : 'ยังไม่ได้รับ'
            }}
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.ach {
  display: grid;
  gap: 1rem;
}
.ach h1 {
  margin: 0;
}
.streak-nums {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
}
.streak-nums p {
  margin: 0;
}
.big {
  font-size: 1.75rem;
  font-weight: 800;
}
.badges {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
}
.badges li {
  display: grid;
  justify-items: center;
  text-align: center;
  gap: 0.125rem;
  padding: 0.75rem;
  border-radius: var(--radius);
  background: #f0fdfa;
  border: 1px solid #99f6e4;
}
.badges li.locked {
  background: #f9fafb;
  border-color: #e5e7eb;
}
.icon {
  font-size: 2rem;
}
.title {
  font-weight: 700;
}
.desc,
.when {
  font-size: 0.8125rem;
  color: var(--muted);
}
</style>
