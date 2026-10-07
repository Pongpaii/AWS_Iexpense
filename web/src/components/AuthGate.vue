<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  authErrorMessage,
  confirmPasswordReset,
  login,
  passwordProblems,
  requestPasswordReset,
} from '../aws/auth'
import { emitAuthEvent, publishSignedIn } from '../lib/authSession'
import { backendConfigError, isBackendConfigured } from '../lib/backend'

const props = defineProps<{
  initialError?: string
}>()

const emit = defineEmits<{
  demo: []
}>()

/**
 * Cognito ปิดการสมัครเองไว้ (ผู้ดูแลสร้างบัญชีให้) จึงไม่มีโหมดสมัครสมาชิก
 * ลืมรหัสผ่าน: Cognito ส่ง "รหัสยืนยัน" ทางอีเมล (ไม่ใช่ลิงก์) แล้วตั้งรหัสใหม่ในหน้านี้เลย
 */
type AuthMode = 'signIn' | 'forgot' | 'forgotConfirm'

const mode = ref<AuthMode>('signIn')
const email = ref('')
const password = ref('')
const code = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const loading = ref(false)
const resetDone = ref(false)
const errorMessage = ref('')

const displayedError = computed(() => errorMessage.value || props.initialError || '')
const canSubmitSignIn = computed(() => Boolean(email.value.trim() && password.value))
const newPasswordIssues = computed(() =>
  newPassword.value ? passwordProblems(newPassword.value) : [],
)
const canSubmitReset = computed(
  () =>
    Boolean(code.value.trim() && newPassword.value) &&
    newPasswordIssues.value.length === 0 &&
    newPassword.value === confirmPassword.value,
)

const clearFeedback = () => {
  errorMessage.value = ''
}

const switchMode = (next: AuthMode) => {
  mode.value = next
  resetDone.value = false
  errorMessage.value = ''
  password.value = ''
  code.value = ''
  newPassword.value = ''
  confirmPassword.value = ''
}

const notConfigured = () => {
  errorMessage.value = 'ยังไม่ได้ตั้งค่าการเชื่อมต่อ AWS กรุณาตรวจสอบ Environment Variables'
}

const signIn = async () => {
  if (!isBackendConfigured) return notConfigured()
  if (!canSubmitSignIn.value || loading.value) return

  loading.value = true
  errorMessage.value = ''

  try {
    const step = await login(email.value, password.value)
    password.value = ''
    if (step === 'DONE') {
      await publishSignedIn()
    } else if (step === 'NEW_PASSWORD_REQUIRED') {
      // รหัสชั่วคราวจากผู้ดูแล: ไปหน้าตั้งรหัสผ่านใหม่
      emitAuthEvent({ type: 'newPasswordRequired' })
    } else {
      switchMode('forgot')
      errorMessage.value = 'บัญชีนี้ต้องตั้งรหัสผ่านใหม่ก่อน กดส่งรหัสยืนยันทางอีเมลด้านล่าง'
    }
  } catch (error) {
    errorMessage.value = authErrorMessage(error)
  } finally {
    loading.value = false
  }
}

const sendResetCode = async () => {
  if (!isBackendConfigured) return notConfigured()
  if (!email.value.trim() || loading.value) return

  loading.value = true
  errorMessage.value = ''

  try {
    await requestPasswordReset(email.value)
    mode.value = 'forgotConfirm'
  } catch (error) {
    errorMessage.value = authErrorMessage(error)
  } finally {
    loading.value = false
  }
}

const confirmReset = async () => {
  if (!isBackendConfigured) return notConfigured()
  if (!canSubmitReset.value || loading.value) return

  loading.value = true
  errorMessage.value = ''

  try {
    await confirmPasswordReset(email.value, code.value, newPassword.value)
    code.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    resetDone.value = true
  } catch (error) {
    errorMessage.value = authErrorMessage(error)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="auth-page">
    <section class="auth-card" aria-labelledby="auth-title">
      <div class="auth-brand" aria-hidden="true">฿</div>
      <span class="auth-kicker">Money Flow</span>
      <h1 id="auth-title">
        {{ mode === 'signIn' ? 'ยินดีต้อนรับกลับ' : 'ตั้งรหัสผ่านใหม่' }}
      </h1>

      <template v-if="!isBackendConfigured">
        <p class="auth-description">
          ยังไม่ได้เชื่อมต่อ AWS กรุณาใส่ค่า VITE_API_URL, VITE_COGNITO_USER_POOL_ID,
          VITE_COGNITO_CLIENT_ID และ VITE_AWS_REGION ใน Environment Variables
        </p>
        <p v-if="backendConfigError" class="auth-error" role="alert">{{ backendConfigError }}</p>
      </template>

      <template v-else-if="resetDone">
        <div class="mail-sent" role="status" aria-live="polite">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>ตั้งรหัสผ่านใหม่แล้ว</strong>
            <p>
              เข้าสู่ระบบด้วยอีเมล <b>{{ email.trim() }}</b> และรหัสผ่านใหม่ได้เลย
            </p>
          </div>
        </div>
        <button class="secondary-button" type="button" @click="switchMode('signIn')">
          กลับไปหน้าเข้าสู่ระบบ
        </button>
      </template>

      <form v-else-if="mode === 'signIn'" class="auth-form" @submit.prevent="signIn">
        <p class="auth-description">กรอกอีเมลและรหัสผ่านของบัญชีที่ผู้ดูแลสร้างไว้ให้</p>

        <label for="auth-email">
          <span>อีเมล</span>
          <input
            id="auth-email"
            v-model="email"
            type="email"
            autocomplete="email"
            inputmode="email"
            placeholder="you@example.com"
            required
            :disabled="loading"
            @input="clearFeedback"
          />
        </label>

        <label for="auth-password">
          <span>รหัสผ่าน</span>
          <span class="password-field">
            <input
              id="auth-password"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              placeholder="••••••••"
              required
              :disabled="loading"
              @input="clearFeedback"
            />
            <button
              type="button"
              :aria-label="showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'"
              :aria-pressed="showPassword"
              :disabled="loading"
              @click="showPassword = !showPassword"
            >
              {{ showPassword ? 'ซ่อน' : 'แสดง' }}
            </button>
          </span>
        </label>

        <p v-if="displayedError" class="auth-error" role="alert">{{ displayedError }}</p>

        <button class="primary-button" type="submit" :disabled="loading || !canSubmitSignIn">
          <span v-if="loading" class="auth-spinner" aria-hidden="true"></span>
          {{ loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ' }}
        </button>

        <button class="text-button" type="button" :disabled="loading" @click="switchMode('forgot')">
          ลืมรหัสผ่าน?
        </button>
      </form>

      <form v-else-if="mode === 'forgot'" class="auth-form" @submit.prevent="sendResetCode">
        <p class="auth-description">
          กรอกอีเมลของบัญชี ระบบจะส่งรหัสยืนยันไปให้เพื่อใช้ตั้งรหัสผ่านใหม่
        </p>

        <label for="reset-email">
          <span>อีเมล</span>
          <input
            id="reset-email"
            v-model="email"
            type="email"
            autocomplete="email"
            inputmode="email"
            placeholder="you@example.com"
            required
            :disabled="loading"
            @input="clearFeedback"
          />
        </label>

        <p v-if="displayedError" class="auth-error" role="alert">{{ displayedError }}</p>

        <button class="primary-button" type="submit" :disabled="loading || !email.trim()">
          <span v-if="loading" class="auth-spinner" aria-hidden="true"></span>
          {{ loading ? 'กำลังส่งรหัส...' : 'ส่งรหัสยืนยัน' }}
        </button>

        <button class="text-button" type="button" :disabled="loading" @click="switchMode('signIn')">
          กลับไปเข้าสู่ระบบด้วยรหัสผ่าน
        </button>
      </form>

      <form v-else class="auth-form" novalidate @submit.prevent="confirmReset">
        <p class="auth-description">
          ส่งรหัสยืนยันไปที่ <b>{{ email.trim() }}</b> แล้ว กรอกรหัสและตั้งรหัสผ่านใหม่
        </p>

        <label for="reset-code">
          <span>รหัสยืนยันจากอีเมล</span>
          <input
            id="reset-code"
            v-model="code"
            type="text"
            autocomplete="one-time-code"
            inputmode="numeric"
            placeholder="123456"
            required
            :disabled="loading"
            @input="clearFeedback"
          />
        </label>

        <label for="reset-new-password">
          <span>รหัสผ่านใหม่</span>
          <span class="password-field">
            <input
              id="reset-new-password"
              v-model="newPassword"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="new-password"
              placeholder="อย่างน้อย 10 ตัวอักษร"
              required
              :disabled="loading"
              @input="clearFeedback"
            />
            <button
              type="button"
              :aria-label="showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'"
              :aria-pressed="showPassword"
              :disabled="loading"
              @click="showPassword = !showPassword"
            >
              {{ showPassword ? 'ซ่อน' : 'แสดง' }}
            </button>
          </span>
        </label>

        <label for="reset-confirm-password">
          <span>ยืนยันรหัสผ่าน</span>
          <input
            id="reset-confirm-password"
            v-model="confirmPassword"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="new-password"
            placeholder="กรอกรหัสผ่านอีกครั้ง"
            required
            :disabled="loading"
            @input="clearFeedback"
          />
        </label>

        <p v-if="newPasswordIssues.length" class="auth-description" role="status">
          รหัสผ่านต้อง{{ newPasswordIssues.join(' · ') }}
        </p>
        <p
          v-else-if="confirmPassword && confirmPassword !== newPassword"
          class="auth-description"
          role="status"
        >
          รหัสผ่านสองช่องยังไม่ตรงกัน
        </p>
        <p v-if="displayedError" class="auth-error" role="alert">{{ displayedError }}</p>

        <button class="primary-button" type="submit" :disabled="loading || !canSubmitReset">
          <span v-if="loading" class="auth-spinner" aria-hidden="true"></span>
          {{ loading ? 'กำลังบันทึก...' : 'ตั้งรหัสผ่านใหม่' }}
        </button>

        <button class="text-button" type="button" :disabled="loading" @click="sendResetCode">
          ส่งรหัสใหม่อีกครั้ง
        </button>
        <button class="text-button" type="button" :disabled="loading" @click="switchMode('signIn')">
          กลับไปเข้าสู่ระบบ
        </button>
      </form>

      <div class="demo-divider"><span>หรือ</span></div>

      <button class="demo-button" type="button" @click="emit('demo')">
        <span aria-hidden="true">👀</span>
        เข้าดูตัวอย่างแอป (Demo)
      </button>
      <p class="demo-note">
        เข้าไม่ได้ก็ดูได้ ข้อมูลเป็นตัวอย่างสมมติ ดูได้อย่างเดียว เพิ่ม/แก้ไข/ลบไม่ได้
      </p>

      <small>ยังไม่มีบัญชี? ติดต่อผู้ดูแลระบบ หรือทดลองใช้งานผ่านโหมด Demo</small>
    </section>
  </main>
</template>

<style scoped>
.auth-page {
  display: grid;
  min-height: 100vh;
  min-height: 100dvh;
  place-items: center;
  padding: 24px;
  background:
    radial-gradient(circle at 15% 15%, rgba(201, 240, 108, 0.2), transparent 32%),
    linear-gradient(145deg, #153d30, #1d5a43 58%, #286b4f);
  font-family: 'Noto Sans Thai', sans-serif;
}

.auth-card {
  width: min(430px, 100%);
  padding: 34px;
  border: 1px solid rgba(255, 255, 255, 0.74);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 28px 80px rgba(5, 28, 19, 0.3);
  text-align: center;
}

.auth-brand {
  display: grid;
  width: 54px;
  height: 54px;
  margin: 0 auto 14px;
  place-items: center;
  border-radius: 17px;
  color: #194d3b;
  background: #c9f06c;
  font-family: 'Manrope', sans-serif;
  font-size: 1.45rem;
  font-weight: 800;
  box-shadow: 0 9px 20px rgba(87, 125, 34, 0.2);
}

.auth-kicker {
  color: #55806d;
  font-size: 0.63rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

h1 {
  margin: 5px 0 8px;
  color: #19372a;
  font-size: 1.45rem;
}

.auth-description {
  margin: 0 0 20px;
  color: #708078;
  font-size: 0.76rem;
  line-height: 1.65;
}

.auth-form,
.auth-form label {
  display: grid;
  gap: 8px;
}

.auth-form label {
  text-align: left;
}

.auth-form label > span:first-child {
  color: #3c5e4f;
  font-size: 0.68rem;
  font-weight: 700;
}

.auth-form input {
  width: 100%;
  min-height: 48px;
  padding: 10px 13px;
  border: 1px solid #d2ded7;
  border-radius: 11px;
  outline: none;
  color: #1d3329;
  background: #fbfdfc;
  font:
    600 0.78rem 'Manrope',
    'Noto Sans Thai',
    sans-serif;
  transition:
    border-color 0.16s,
    box-shadow 0.16s;
}

.auth-form input:focus {
  border-color: #5b9577;
  box-shadow: 0 0 0 4px rgba(64, 137, 99, 0.13);
}

.password-field {
  position: relative;
  display: block;
}

.password-field input {
  padding-right: 62px;
}

.password-field button {
  position: absolute;
  right: 7px;
  top: 50%;
  min-height: 30px;
  padding: 5px 9px;
  border: 1px solid #d7e2dc;
  border-radius: 8px;
  color: #38614c;
  background: #fff;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.6rem;
  font-weight: 700;
  transform: translateY(-50%);
}

.password-field button:hover:not(:disabled) {
  border-color: #a7c3b3;
  background: #f4faf6;
}

.primary-button,
.secondary-button {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin-top: 8px;
  padding: 9px 15px;
  border-radius: 11px;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.74rem;
  font-weight: 800;
}

.primary-button {
  border: 1px solid #194d3b;
  color: white;
  background: #194d3b;
}

.secondary-button {
  border: 1px solid #cbdad2;
  color: #285c44;
  background: #fff;
}

.primary-button:disabled {
  opacity: 0.55;
}

.text-button {
  margin-top: 2px;
  padding: 6px;
  border: 0;
  border-radius: 8px;
  color: #45715c;
  background: transparent;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.66rem;
  font-weight: 700;
  text-decoration: underline;
}

.text-button:hover:not(:disabled) {
  color: #22513c;
}

.text-button:disabled {
  opacity: 0.55;
}

.auth-error {
  margin: 3px 0 0;
  padding: 9px 11px;
  border-radius: 9px;
  color: var(--alert-ink);
  background: var(--alert-tint);
  font-size: 0.66rem;
  line-height: 1.55;
  text-align: left;
}

.mail-sent {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  gap: 10px;
  margin: 20px 0 10px;
  padding: 14px;
  border: 1px solid #cfe4d7;
  border-radius: 13px;
  color: #285e46;
  background: #eff8f2;
  text-align: left;
}

.mail-sent > span {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  background: #3b9065;
  font-weight: 800;
}

.mail-sent strong {
  font-size: 0.75rem;
}

.mail-sent p {
  margin: 3px 0 0;
  overflow-wrap: anywhere;
  color: #688075;
  font-size: 0.66rem;
  line-height: 1.5;
}

.demo-divider {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 10px;
  margin: 18px 0 14px;
  color: #a3aea8;
  font-size: 0.6rem;
  font-weight: 700;
}

.demo-divider::before,
.demo-divider::after {
  content: '';
  height: 1px;
  background: #e2e9e5;
}

.demo-button {
  display: inline-flex;
  width: 100%;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 9px 15px;
  border: 1px solid #cbdad2;
  border-radius: 11px;
  color: #285c44;
  background: #f4faf6;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.74rem;
  font-weight: 800;
  transition:
    border-color 0.16s,
    background 0.16s;
}

.demo-button:hover {
  border-color: #9dc0ac;
  background: #eaf5ee;
}

.demo-button:focus-visible {
  outline: 3px solid rgba(64, 137, 99, 0.28);
  outline-offset: 2px;
}

.demo-note {
  margin: 9px 0 0;
  color: #8a968f;
  font-size: 0.6rem;
  line-height: 1.5;
}

.auth-card > small {
  display: block;
  margin-top: 18px;
  color: #96a19b;
  font-size: 0.58rem;
}

.auth-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.34);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 480px) {
  .auth-page {
    padding: 15px;
  }
  .auth-card {
    padding: 27px 20px;
    border-radius: 20px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .auth-spinner {
    animation: none;
  }
}
</style>
