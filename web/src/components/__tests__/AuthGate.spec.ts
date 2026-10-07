import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AuthModule from '../../aws/auth'

const login = vi.fn()
const requestPasswordReset = vi.fn()
const confirmPasswordReset = vi.fn()
const publishSignedIn = vi.fn()
const emitAuthEvent = vi.fn()

// mock ก่อน import คอมโพเนนต์ เพราะ AuthGate เรียก Cognito (ผ่าน aws/auth) ตรง ๆ
vi.mock('../../aws/auth', async (importActual) => {
  const actual = await importActual<typeof AuthModule>()
  return {
    authErrorMessage: actual.authErrorMessage,
    passwordProblems: actual.passwordProblems,
    login: (...args: unknown[]) => login(...args),
    requestPasswordReset: (...args: unknown[]) => requestPasswordReset(...args),
    confirmPasswordReset: (...args: unknown[]) => confirmPasswordReset(...args),
  }
})
vi.mock('../../lib/authSession', () => ({
  publishSignedIn: () => publishSignedIn(),
  emitAuthEvent: (...args: unknown[]) => emitAuthEvent(...args),
}))
vi.mock('../../lib/backend', () => ({ isBackendConfigured: true, backendConfigError: '' }))

const AuthGate = (await import('../AuthGate.vue')).default

type GateWrapper = VueWrapper<InstanceType<typeof AuthGate>>

const mountGate = (props: Record<string, unknown> = {}): GateWrapper =>
  mount(AuthGate, { props }) as GateWrapper

const signIn = async (wrapper: GateWrapper, email: string, password: string) => {
  await wrapper.find('#auth-email').setValue(email)
  await wrapper.find('#auth-password').setValue(password)
  await wrapper.find('form').trigger('submit')
  await flushPromises()
}

const cognitoError = (name: string) => Object.assign(new Error(name), { name })

beforeEach(() => {
  login.mockReset().mockResolvedValue('DONE')
  requestPasswordReset.mockReset().mockResolvedValue(undefined)
  confirmPasswordReset.mockReset().mockResolvedValue(undefined)
  publishSignedIn.mockReset().mockResolvedValue({ user: { id: 'u', email: 'user@example.com' } })
  emitAuthEvent.mockReset()
})

describe('AuthGate', () => {
  it('แสดงฟอร์มเข้าสู่ระบบเป็นหน้าเริ่มต้น', () => {
    const wrapper = mountGate()

    expect(wrapper.find('#auth-email').exists()).toBe(true)
    expect(wrapper.find('#auth-password').exists()).toBe(true)
  })

  it('ไม่มีปุ่มสมัครสมาชิก เพราะ User Pool ปิดการสมัครเอง', () => {
    const wrapper = mountGate()

    expect(wrapper.findAll('.text-button').some((b) => b.text().includes('สมัครสมาชิก'))).toBe(
      false,
    )
  })

  it('แสดงข้อความ error ที่ส่งมาจากภายนอก เช่น เซสชันหมดอายุ', () => {
    const wrapper = mountGate({ initialError: 'เซสชันหมดอายุแล้ว' })

    expect(wrapper.text()).toContain('เซสชันหมดอายุแล้ว')
  })

  describe('การเข้าสู่ระบบ', () => {
    it('ส่งอีเมลและรหัสผ่านไปที่ Cognito แล้วประกาศ session', async () => {
      const wrapper = mountGate()
      await signIn(wrapper, 'user@example.com', 'secret123')

      expect(login).toHaveBeenCalledWith('user@example.com', 'secret123')
      expect(publishSignedIn).toHaveBeenCalledOnce()
    })

    it('บัญชีที่ใช้รหัสชั่วคราว: แจ้งให้ไปหน้าตั้งรหัสผ่านใหม่', async () => {
      login.mockResolvedValue('NEW_PASSWORD_REQUIRED')
      const wrapper = mountGate()
      await signIn(wrapper, 'user@example.com', 'Temp-pass1')

      expect(emitAuthEvent).toHaveBeenCalledWith({ type: 'newPasswordRequired' })
      expect(publishSignedIn).not.toHaveBeenCalled()
    })

    it('ไม่ยิงคำขอเมื่อยังกรอกไม่ครบ', async () => {
      const wrapper = mountGate()
      await wrapper.find('#auth-email').setValue('user@example.com')
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(login).not.toHaveBeenCalled()
    })

    it('ยิงคำขอครั้งเดียวแม้กด submit ซ้ำระหว่างรอผล', async () => {
      let release: (value: string) => void = () => {}
      login.mockReturnValue(
        new Promise<string>((resolve) => {
          release = resolve
        }),
      )

      const wrapper = mountGate()
      await wrapper.find('#auth-email').setValue('user@example.com')
      await wrapper.find('#auth-password').setValue('secret123')
      await wrapper.find('form').trigger('submit')
      await wrapper.find('form').trigger('submit')

      expect(login).toHaveBeenCalledTimes(1)

      release('DONE')
      await flushPromises()
    })

    it('แสดงข้อความภาษาไทยเมื่อรหัสผิด และไม่บอกว่าอีเมลนี้มีอยู่จริงหรือไม่', async () => {
      login.mockRejectedValue(cognitoError('UserNotFoundException'))

      const wrapper = mountGate()
      await signIn(wrapper, 'user@example.com', 'wrong-password')

      expect(wrapper.text()).not.toContain('UserNotFoundException')
      expect(wrapper.find('[role="alert"]').text()).toContain('อีเมลหรือรหัสผ่านไม่ถูกต้อง')
    })

    it('ล้างรหัสผ่านออกจากฟอร์มเมื่อเข้าสู่ระบบสำเร็จ', async () => {
      const wrapper = mountGate()
      await signIn(wrapper, 'user@example.com', 'secret123')

      expect((wrapper.find('#auth-password').element as HTMLInputElement).value).toBe('')
    })

    it('สลับการมองเห็นรหัสผ่านได้', async () => {
      const wrapper = mountGate()
      const toggle = wrapper.find('.password-field button')

      expect(wrapper.find('#auth-password').attributes('type')).toBe('password')

      await toggle.trigger('click')

      expect(wrapper.find('#auth-password').attributes('type')).toBe('text')
    })
  })

  describe('ลืมรหัสผ่าน (รหัสยืนยันทางอีเมล)', () => {
    const openForgotMode = async (wrapper: GateWrapper) => {
      const forgot = wrapper
        .findAll('.text-button')
        .find((button) => button.text().includes('ลืมรหัสผ่าน'))
      await forgot?.trigger('click')
    }

    const requestCode = async (wrapper: GateWrapper, email: string) => {
      await wrapper.find('#reset-email').setValue(email)
      await wrapper.find('form').trigger('submit')
      await flushPromises()
    }

    const submitNewPassword = async (
      wrapper: GateWrapper,
      code: string,
      pw: string,
      again = pw,
    ) => {
      await wrapper.find('#reset-code').setValue(code)
      await wrapper.find('#reset-new-password').setValue(pw)
      await wrapper.find('#reset-confirm-password').setValue(again)
      await wrapper.find('form').trigger('submit')
      await flushPromises()
    }

    it('สลับเข้าโหมดลืมรหัสผ่านได้', async () => {
      const wrapper = mountGate()
      await openForgotMode(wrapper)

      expect(wrapper.text()).toContain('ตั้งรหัสผ่านใหม่')
      expect(wrapper.find('#reset-email').exists()).toBe(true)
    })

    it('ขอรหัสยืนยันแล้วไปหน้ากรอกรหัส', async () => {
      const wrapper = mountGate()
      await openForgotMode(wrapper)
      await requestCode(wrapper, 'user@example.com')

      expect(requestPasswordReset).toHaveBeenCalledWith('user@example.com')
      expect(wrapper.find('#reset-code').exists()).toBe(true)
    })

    it('ไม่ยิงคำขอเมื่อยังไม่กรอกอีเมล', async () => {
      const wrapper = mountGate()
      await openForgotMode(wrapper)
      await wrapper.find('form').trigger('submit')
      await flushPromises()

      expect(requestPasswordReset).not.toHaveBeenCalled()
    })

    it('ตั้งรหัสใหม่ด้วยรหัสยืนยัน แล้วกลับไปหน้าเข้าสู่ระบบได้', async () => {
      const wrapper = mountGate()
      await openForgotMode(wrapper)
      await requestCode(wrapper, 'user@example.com')
      await submitNewPassword(wrapper, '123456', 'NewPassword1')

      expect(confirmPasswordReset).toHaveBeenCalledWith(
        'user@example.com',
        '123456',
        'NewPassword1',
      )
      expect(wrapper.text()).toContain('ตั้งรหัสผ่านใหม่แล้ว')

      await wrapper.find('.secondary-button').trigger('click')
      expect(wrapper.find('#auth-password').exists()).toBe(true)
    })

    it('ไม่ส่งเมื่อรหัสผ่านไม่ตรงนโยบาย (ต้อง 10 ตัว + ตัวใหญ่/เล็ก/ตัวเลข)', async () => {
      const wrapper = mountGate()
      await openForgotMode(wrapper)
      await requestCode(wrapper, 'user@example.com')
      await submitNewPassword(wrapper, '123456', 'short')

      expect(confirmPasswordReset).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain('อย่างน้อย 10 ตัวอักษร')
    })

    it('ไม่ส่งเมื่อยืนยันรหัสผ่านไม่ตรงกัน', async () => {
      const wrapper = mountGate()
      await openForgotMode(wrapper)
      await requestCode(wrapper, 'user@example.com')
      await submitNewPassword(wrapper, '123456', 'NewPassword1', 'NewPassword2')

      expect(confirmPasswordReset).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain('ไม่ตรงกัน')
    })

    it('รหัสยืนยันผิด: แสดงข้อความภาษาไทย', async () => {
      confirmPasswordReset.mockRejectedValue(cognitoError('CodeMismatchException'))
      const wrapper = mountGate()
      await openForgotMode(wrapper)
      await requestCode(wrapper, 'user@example.com')
      await submitNewPassword(wrapper, '000000', 'NewPassword1')

      expect(wrapper.find('[role="alert"]').text()).toContain('รหัสยืนยันไม่ถูกต้อง')
    })
  })

  it('มีทางเข้าโหมดดูตัวอย่างที่ส่ง event demo', async () => {
    const wrapper = mountGate()
    const demoButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('ตัวอย่าง'))

    await demoButton?.trigger('click')

    expect(wrapper.emitted('demo')).toHaveLength(1)
  })
})
