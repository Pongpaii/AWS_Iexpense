<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { appConfig, safeRedirect, startSession } from '../app-context';
import {
  authErrorMessage,
  completeNewPassword,
  confirmPasswordReset,
  currentSession,
  login,
  passwordProblems,
  requestPasswordReset,
  type LoginStep,
} from '../auth/auth';
import { showToast } from '../stores/toast';

type Step = 'signin' | 'newPassword' | 'forgot' | 'reset';

const route = useRoute();
const router = useRouter();
const uid = useId();
const id = (n: string) => `${uid}-${n}`;

const step = ref<Step>('signin');
const email = ref('');
const password = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const code = ref('');
const error = ref('');
const loading = ref(false);
const heading = ref<HTMLElement | null>(null);

const titles: Record<Step, string> = {
  signin: 'เข้าสู่ระบบ',
  newPassword: 'ตั้งรหัสผ่านใหม่',
  forgot: 'ลืมรหัสผ่าน',
  reset: 'ตั้งรหัสผ่านใหม่ด้วยรหัสยืนยัน',
};

const problems = computed(() => passwordProblems(newPassword.value));
const mismatch = computed(
  () => confirmPassword.value !== '' && confirmPassword.value !== newPassword.value,
);

async function go(next: Step) {
  step.value = next;
  error.value = '';
  newPassword.value = '';
  confirmPassword.value = '';
  await nextTick();
  heading.value?.focus(); // ย้าย focus ให้ screen reader รู้ว่าเปลี่ยนขั้นตอน
}

async function run(fn: () => Promise<void>) {
  error.value = '';
  loading.value = true;
  try {
    await fn();
  } catch (err) {
    error.value = authErrorMessage(err);
  } finally {
    loading.value = false;
  }
}

async function finish(next: LoginStep) {
  if (next === 'NEW_PASSWORD_REQUIRED') return go('newPassword');
  if (next === 'RESET_PASSWORD_REQUIRED') return go('forgot');
  const user = await currentSession();
  if (!user) throw new Error('no session');
  startSession(user);
  password.value = '';
  await router.replace(safeRedirect(route.query.redirect));
}

function validateNewPassword(): boolean {
  if (problems.value.length) {
    error.value = `รหัสผ่านต้อง${problems.value.join(', ')}`;
    return false;
  }
  if (newPassword.value !== confirmPassword.value) {
    error.value = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน';
    return false;
  }
  return true;
}

const onSignIn = () =>
  run(async () => {
    if (!email.value.trim() || !password.value) {
      error.value = 'กรุณากรอกอีเมลและรหัสผ่าน';
      return;
    }
    await finish(await login(email.value, password.value));
  });

const onNewPassword = () =>
  run(async () => {
    if (!validateNewPassword()) return;
    await finish(await completeNewPassword(newPassword.value));
    showToast('ตั้งรหัสผ่านใหม่เรียบร้อย', { kind: 'success' });
  });

const onForgot = () =>
  run(async () => {
    if (!email.value.trim()) {
      error.value = 'กรุณากรอกอีเมล';
      return;
    }
    await requestPasswordReset(email.value);
    showToast('ถ้าอีเมลนี้มีบัญชีอยู่ ระบบได้ส่งรหัสยืนยันไปแล้ว');
    await go('reset');
  });

const onReset = () =>
  run(async () => {
    if (!/^\d{6}$/.test(code.value.trim())) {
      error.value = 'รหัสยืนยันต้องเป็นตัวเลข 6 หลัก';
      return;
    }
    if (!validateNewPassword()) return;
    await confirmPasswordReset(email.value, code.value, newPassword.value);
    showToast('ตั้งรหัสผ่านใหม่แล้ว กรุณาเข้าสู่ระบบ', { kind: 'success' });
    password.value = '';
    code.value = '';
    await go('signin');
  });
</script>

<template>
  <div class="login">
    <section class="card login-card" :aria-labelledby="id('title')">
      <h1 :id="id('title')" ref="heading" tabindex="-1">{{ titles[step] }}</h1>

      <p v-if="!appConfig.ok" class="form-error" role="alert">
        ยังไม่ได้ตั้งค่าการเชื่อมต่อระบบ ({{ appConfig.message }})
      </p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>

      <!-- เข้าสู่ระบบ -->
      <form v-if="step === 'signin'" class="stack" novalidate @submit.prevent="onSignIn">
        <div class="field">
          <label :for="id('email')">อีเมล</label>
          <input
            :id="id('email')"
            v-model="email"
            type="email"
            autocomplete="username"
            inputmode="email"
            required
          />
        </div>
        <div class="field">
          <label :for="id('password')">รหัสผ่าน</label>
          <input
            :id="id('password')"
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
          />
        </div>
        <button type="submit" class="btn" :disabled="loading || !appConfig.ok">
          {{ loading ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ' }}
        </button>
        <button type="button" class="btn btn-link" @click="go('forgot')">ลืมรหัสผ่าน?</button>
        <p class="field-hint">
          ครั้งแรกให้ใช้รหัสผ่านชั่วคราวจากอีเมลเชิญ แล้วระบบจะให้ตั้งรหัสผ่านใหม่
        </p>
      </form>

      <div v-if="step === 'signin'" class="demo">
        <p>ยังไม่มีบัญชี? ลองดูตัวอย่างด้วยข้อมูลสมมติ (ไม่เชื่อมต่อเซิร์ฟเวอร์)</p>
        <RouterLink to="/demo" class="btn btn-secondary">ลองใช้โหมดทดลอง</RouterLink>
      </div>

      <!-- ตั้งรหัสผ่านใหม่ (ครั้งแรก) / ด้วยรหัสยืนยัน -->
      <form
        v-else-if="step === 'newPassword' || step === 'reset'"
        class="stack"
        novalidate
        @submit.prevent="step === 'reset' ? onReset() : onNewPassword()"
      >
        <p v-if="step === 'newPassword'">กรุณาตั้งรหัสผ่านใหม่เพื่อใช้งานต่อ</p>
        <div v-if="step === 'reset'" class="field">
          <label :for="id('code')">รหัสยืนยันจากอีเมล</label>
          <input
            :id="id('code')"
            v-model="code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            required
          />
        </div>
        <input
          v-if="step === 'newPassword'"
          type="email"
          :value="email"
          autocomplete="username"
          hidden
        />
        <div class="field">
          <label :for="id('new')">รหัสผ่านใหม่</label>
          <input
            :id="id('new')"
            v-model="newPassword"
            type="password"
            autocomplete="new-password"
            required
            :aria-describedby="id('rules')"
          />
          <ul :id="id('rules')" class="rules">
            <li
              v-for="rule in [
                'อย่างน้อย 10 ตัวอักษร',
                'มีตัวพิมพ์เล็ก (a-z)',
                'มีตัวพิมพ์ใหญ่ (A-Z)',
                'มีตัวเลข (0-9)',
              ]"
              :key="rule"
              :class="{ ok: newPassword && !problems.includes(rule) }"
            >
              <span aria-hidden="true">{{
                newPassword && !problems.includes(rule) ? '✓' : '•'
              }}</span>
              {{ rule }}
            </li>
          </ul>
        </div>
        <div class="field">
          <label :for="id('confirm')">ยืนยันรหัสผ่านใหม่</label>
          <input
            :id="id('confirm')"
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            required
            :aria-invalid="mismatch"
            :aria-describedby="mismatch ? id('mismatch') : undefined"
          />
          <span v-if="mismatch" :id="id('mismatch')" class="field-error">รหัสผ่านไม่ตรงกัน</span>
        </div>
        <button type="submit" class="btn" :disabled="loading">
          {{ loading ? 'กำลังบันทึก…' : 'ตั้งรหัสผ่าน' }}
        </button>
        <button type="button" class="btn btn-link" @click="go('signin')">
          กลับไปหน้าเข้าสู่ระบบ
        </button>
      </form>

      <!-- ขอรหัสยืนยัน -->
      <form v-else class="stack" novalidate @submit.prevent="onForgot">
        <p>กรอกอีเมลของบัญชี ระบบจะส่งรหัสยืนยัน 6 หลักไปให้</p>
        <div class="field">
          <label :for="id('femail')">อีเมล</label>
          <input
            :id="id('femail')"
            v-model="email"
            type="email"
            autocomplete="username"
            inputmode="email"
            required
          />
        </div>
        <button type="submit" class="btn" :disabled="loading || !appConfig.ok">
          {{ loading ? 'กำลังส่ง…' : 'ส่งรหัสยืนยัน' }}
        </button>
        <button type="button" class="btn btn-link" @click="go('reset')">มีรหัสยืนยันแล้ว</button>
        <button type="button" class="btn btn-link" @click="go('signin')">
          กลับไปหน้าเข้าสู่ระบบ
        </button>
      </form>
    </section>
  </div>
</template>

<style scoped>
.login {
  display: grid;
  place-items: start center;
  padding-top: 2rem;
}
.login-card {
  width: min(100%, 26rem);
  display: grid;
  gap: 1rem;
}
.login-card h1:focus {
  outline: none;
}
.stack {
  display: grid;
  gap: 0.875rem;
}
.rules {
  list-style: none;
  margin: 0.25rem 0 0;
  padding: 0;
  font-size: 0.875rem;
  color: var(--muted);
}
.demo {
  border-top: 1px solid #e5e7eb;
  padding-top: 1rem;
  display: grid;
  gap: 0.5rem;
}
.demo p {
  margin: 0;
  color: var(--muted);
  font-size: 0.9rem;
}
.rules li.ok {
  color: var(--income);
}
</style>
