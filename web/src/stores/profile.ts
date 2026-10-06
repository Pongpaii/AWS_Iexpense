import {
  defaultSettings,
  type SettingsInput,
  type UserAchievement,
  type UserSettings,
} from '@money-flow/shared';
import { reactive, readonly } from 'vue';
import type { Endpoints } from '../api/endpoints';

/** settings + achievements ของผู้ใช้ (หรือของ demo) */
export function createProfileStore(deps: { api: Endpoints; readOnly: boolean }) {
  const state = reactive<{
    settings: UserSettings;
    loaded: boolean;
    achievements: UserAchievement[];
    achievementsLoaded: boolean;
  }>({
    settings: defaultSettings(),
    loaded: false,
    achievements: [],
    achievementsLoaded: false,
  });

  function applyTheme() {
    document.documentElement.dataset.expenseColor = state.settings.expenseColor;
  }

  async function loadSettings() {
    state.settings = await deps.api.getSettings();
    state.loaded = true;
    applyTheme();
  }

  async function saveSettings(input: SettingsInput) {
    state.settings = await deps.api.putSettings(input);
    applyTheme();
    return state.settings;
  }

  async function loadAchievements() {
    state.achievements = await deps.api.listAchievements();
    state.achievementsLoaded = true;
  }

  /** บันทึก badge ใหม่ที่ได้ (idempotent ฝั่ง server) — demo ไม่บันทึก */
  async function award(badgeIds: string[]): Promise<string[]> {
    const have = new Set(state.achievements.map((a) => a.badgeId));
    const fresh = badgeIds.filter((id) => !have.has(id));
    if (fresh.length === 0) return [];
    if (deps.readOnly) {
      // demo: แสดงในหน่วยความจำอย่างเดียว
      const now = new Date().toISOString();
      state.achievements.push(...fresh.map((badgeId) => ({ badgeId, earnedAt: now })));
      return fresh;
    }
    const saved = await Promise.all(fresh.map((id) => deps.api.addAchievement(id)));
    state.achievements.push(...saved);
    return fresh;
  }

  return {
    // readonly ป้องกันการแก้ state ตรง ๆ ตอน runtime; type คงเดิมเพื่อส่งต่อให้ฟังก์ชันคำนวณได้
    state: readonly(state) as typeof state,
    readOnly: deps.readOnly,
    loadSettings,
    saveSettings,
    loadAchievements,
    award,
  };
}

export type ProfileStore = ReturnType<typeof createProfileStore>;
