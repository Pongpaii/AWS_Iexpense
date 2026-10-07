<script setup lang="ts">
import { computed, ref } from 'vue'
import { authErrorMessage, completeNewPassword, passwordProblems } from '../aws/auth'
import { publishSignedIn } from '../lib/authSession'

/**
 * ตั้งรหัสผ่านครั้งแรก: บัญชีที่ผู้ดูแลสร้างด้วยรหัสชั่วคราว
 * Cognito บังคับให้ตั้งรหัสใหม่ก่อน (NEW_PASSWORD_REQUIRED) จึงจะได้ session
 */
const emit = defineEmits<{
  done: []
  cancel: []
}>()

/** ตรงกับ password policy ของ User Pool (AuthStack) */
const MIN_LENGTH = 10

const password = ref('')
const confirmation = ref('')
const showPassword = ref(false)
const loading = ref(false)
const errorMessage = ref('')

const problems = computed(() => (password.value ? passwordProblems(password.value) : []))
const tooShort = computed(() => problems.value.length > 0)
const mismatched = computed(
  () => confirmation.value.length > 0 && password.value !== confirmation.value,
)
const canSubmit = computed(
  () =>
    password.value.length > 0 &&
    problems.value.length === 0 &&
    password.value === confirmation.value,
)

const savePassword = async () => {
  if (!canSubmit.value || loading.value) return

  loading.value = true
  errorMessage.value = ''

  try {
    const step = await completeNewPassword(password.value)
    if (step !== 'DONE') throw new Error(step)
    password.value = ''
    confirmation.value = ''
    // แจ้ง useAuth ให้เริ่ม session ก่อนปิดหน้าจอนี้
    await publishSignedIn()
    emit('done')
  } catch (error) {
    errorMessage.value = authErrorMessage(error)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="reset-page">
    <section class="reset-card" aria-labelledby="reset-title">
      <div class="reset-brand" aria-hidden="true">฿</div>
      <span class="reset-kicker">Money Flow</span>
      <h1 id="reset-title">ตั้งรหัสผ่านใหม่</h1>
      <p class="reset-description">
        บัญชีนี้ใช้รหัสผ่านชั่วคราว ตั้งรหัสผ่านใหม่ยาวอย่างน้อย {{ MIN_LENGTH }} ตัวอักษร
        มีตัวพิมพ์ใหญ่ ตัวพิมพ์เล็ก และตัวเลข
      </p>

      <form class="reset-form" @submit.prevent="savePassword">
        <label for="new-password">
          <span>รหัสผ่านใหม่</span>
          <span class="password-field">
            <input
              id="new-password"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="new-password"
              :minlength="MIN_LENGTH"
              required
              :disabled="loading"
              @input="errorMessage = ''"
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

        <label for="confirm-password">
          <span>ยืนยันรหัสผ่าน</span>
          <input
            id="confirm-password"
            v-model="confirmation"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="new-password"
            required
            :disabled="loading"
            @input="errorMessage = ''"
          />
        </label>

        <p v-if="tooShort" class="reset-hint" role="status">
          รหัสผ่านต้อง{{ problems.join(' · ') }}
        </p>
        <p v-else-if="mismatched" class="reset-hint" role="status">รหัสผ่านสองช่องยังไม่ตรงกัน</p>
        <p v-if="errorMessage" class="reset-error" role="alert">{{ errorMessage }}</p>

        <button class="primary-button" type="submit" :disabled="loading || !canSubmit">
          <span v-if="loading" class="reset-spinner" aria-hidden="true"></span>
          {{ loading ? 'กำลังบันทึก...' : 'บันทึกรหัสผ่าน' }}
        </button>

        <button class="text-button" type="button" :disabled="loading" @click="emit('cancel')">
          ยกเลิกและกลับไปหน้าเข้าสู่ระบบ
        </button>
      </form>
    </section>
  </main>
</template>

<style scoped>
.reset-page {
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

.reset-card {
  width: min(430px, 100%);
  padding: 34px;
  border: 1px solid rgba(255, 255, 255, 0.74);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 28px 80px rgba(5, 28, 19, 0.3);
  text-align: center;
}

.reset-brand {
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
}

.reset-kicker {
  color: #55806d;
  font-size: 0.63rem;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

h1 {
  margin: 5px 0 8px;
  color: #19372a;
  font-size: 1.4rem;
}

.reset-description {
  margin: 0 0 20px;
  color: #708078;
  font-size: 0.74rem;
  line-height: 1.6;
}

.reset-form,
.reset-form label {
  display: grid;
  gap: 8px;
}

.reset-form label {
  text-align: left;
}

.reset-form label > span:first-child {
  color: #3c5e4f;
  font-size: 0.68rem;
  font-weight: 700;
}

.reset-form input {
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
}

.reset-form input:focus {
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

.primary-button {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin-top: 8px;
  padding: 9px 15px;
  border: 1px solid #194d3b;
  border-radius: 11px;
  color: #fff;
  background: #194d3b;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.74rem;
  font-weight: 800;
}

.primary-button:disabled {
  opacity: 0.55;
}

.text-button {
  padding: 6px;
  border: 0;
  color: #45715c;
  background: transparent;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 0.66rem;
  font-weight: 700;
  text-decoration: underline;
}

.reset-hint {
  margin: 0;
  color: #7d8983;
  font-size: 0.63rem;
  text-align: left;
}

.reset-error {
  margin: 0;
  padding: 9px 11px;
  border-radius: 9px;
  color: var(--alert-ink);
  background: var(--alert-tint);
  font-size: 0.66rem;
  line-height: 1.55;
  text-align: left;
}

.reset-spinner {
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
  .reset-page {
    padding: 15px;
  }
  .reset-card {
    padding: 27px 20px;
    border-radius: 20px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .reset-spinner {
    animation: none;
  }
}
</style>
