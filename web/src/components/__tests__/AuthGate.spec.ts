import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AuthModule from '../../aws/auth'

const login = vi.fn()
const register = vi.fn()
const confirmRegistration = vi.fn()
const resendRegistrationCode = vi.fn()
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
    register: (...args: unknown[]) => register(...args),
    confirmRegistration: (...args: unknown[]) => confirmRegistration(...args),
    resendRegistrationCode: (...args: unknown[]) => resendRegistrationCode(...args),
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
  register.mockReset().mockResolvedValue('CONFIRM_SIGN_UP')
  confirmRegistration.mockReset().mockResolvedValue(undefined)
  resendRegistrationCode.mockReset().mockResolvedValue(undefined)
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

  describe('บัญชีทดลอง (demo / 123456)', () => {
    const mountWithDemo = async (email = 'demo@example.com', password = '123456') => {
      vi.stubEnv('VITE_DEMO_EMAIL', email)
      vi.stubEnv('VITE_DEMO_PASSWORD', password)
      vi.resetModules()
      const Gate = (await import('../AuthGate.vue')).default
      return mount(Gate) as GateWrapper
    }

    afterEach(() => vi.unstubAllEnvs())

    it('แสดงชื่อผู้ใช้/รหัสผ่าน และปุ่มเข้าสู่ระบบด้วยบัญชีทดลอง', async () => {
      const wrapper = await mountWithDemo()
      expect(wrapper.text()).toContain('demo')
      expect(wrapper.text()).toContain('123456')

      await wrapper.find('.demo-account-button').trigger('click')
      await flushPromises()
      expect(login).toHaveBeenCalledWith('demo@example.com', '123456')
      expect(publishSignedIn).toHaveBeenCalledOnce()
    })

    it('พิมพ์ "demo" ในช่องอีเมลเอง → แปลงเป็นอีเมลบัญชีทดลอง', async () => {
      const wrapper = await mountWithDemo()
      await signIn(wrapper, 'Demo', '123456')
      expect(login).toHaveBeenCalledWith('demo@example.com', '123456')
    })

    it('ไม่ได้ตั้งค่า → ไม่มีปุ่มบัญชีทดลอง และ "demo" ส่งไปตามเดิม', async () => {
      const wrapper = await mountWithDemo('', '')
      expect(wrapper.find('.demo-account-button').exists()).toBe(false)
      await signIn(wrapper, 'demo', '123456')
      expect(login).toHaveBeenCalledWith('demo', '123456')
    })
  })

  describe('สมัครสมาชิก (รหัสยืนยันทางอีเมล)', () => {
    const openSignUp = async (wrapper: GateWrapper) => {
      const btn = wrapper
        .findAll('.text-button')
        .find((button) => button.text().includes('สมัครสมาชิก'))
      await btn?.trigger('click')
    }

    const fillSignUp = async (wrapper: GateWrapper, email: string, pw: string, again = pw) => {
      await wrapper.find('#signup-email').setValue(email)
      await wrapper.find('#signup-password').setValue(pw)
      await wrapper.find('#signup-confirm-password').setValue(again)
      await wrapper.find('form').trigger('submit')
      await flushPromises()
    }

    const submitCode = async (wrapper: GateWrapper, code: string) => {
      await wrapper.find('#signup-code').setValue(code)
      await wrapper.find('form').trigger('submit')
      await flushPromises()
    }

    it('มีปุ่มสมัครสมาชิกในหน้าเข้าสู่ระบบ', async () => {
      const wrapper = mountGate()
      await openSignUp(wrapper)

      expect(wrapper.find('#signup-email').exists()).toBe(true)
      expect(wrapper.find('h1').text()).toBe('สมัครสมาชิก')
    })

    it('สมัคร → กรอกรหัสยืนยัน → เข้าสู่ระบบให้อัตโนมัติ', async () => {
      const wrapper = mountGate()
      await openSignUp(wrapper)
      await fillSignUp(wrapper, 'new@example.com', 'NewPassword1')

      expect(register).toHaveBeenCalledWith('new@example.com', 'NewPassword1')
      expect(wrapper.find('#signup-code').exists()).toBe(true)
      expect(wrapper.text()).toContain('new@example.com')

      await submitCode(wrapper, '123456')

      expect(confirmRegistration).toHaveBeenCalledWith('new@example.com', '123456')
      expect(login).toHaveBeenCalledWith('new@example.com', 'NewPassword1')
      expect(publishSignedIn).toHaveBeenCalledOnce()
    })

    it('ไม่ส่งเมื่อรหัสผ่านไม่ตรงนโยบาย', async () => {
      const wrapper = mountGate()
      await openSignUp(wrapper)
      await fillSignUp(wrapper, 'new@example.com', 'short')

      expect(register).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain('อย่างน้อย 6 ตัวอักษร')
    })

    it('ไม่ส่งเมื่อยืนยันรหัสผ่านไม่ตรงกัน', async () => {
      const wrapper = mountGate()
      await openSignUp(wrapper)
      await fillSignUp(wrapper, 'new@example.com', 'NewPassword1', 'NewPassword2')

      expect(register).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain('ไม่ตรงกัน')
    })

    it('อีเมลซ้ำ: แสดงข้อความภาษาไทย', async () => {
      register.mockRejectedValue(cognitoError('UsernameExistsException'))
      const wrapper = mountGate()
      await openSignUp(wrapper)
      await fillSignUp(wrapper, 'old@example.com', 'NewPassword1')

      expect(wrapper.find('[role="alert"]').text()).toContain('อีเมลนี้มีบัญชีอยู่แล้ว')
    })

    it('รหัสยืนยันผิด: แสดงข้อความ และไม่เข้าสู่ระบบ', async () => {
      confirmRegistration.mockRejectedValue(cognitoError('CodeMismatchException'))
      const wrapper = mountGate()
      await openSignUp(wrapper)
      await fillSignUp(wrapper, 'new@example.com', 'NewPassword1')
      await submitCode(wrapper, '000000')

      expect(wrapper.find('[role="alert"]').text()).toContain('รหัสยืนยันไม่ถูกต้อง')
      expect(login).not.toHaveBeenCalled()
    })

    it('ขอรหัสยืนยันใหม่ได้', async () => {
      const wrapper = mountGate()
      await openSignUp(wrapper)
      await fillSignUp(wrapper, 'new@example.com', 'NewPassword1')
      const resend = wrapper
        .findAll('.text-button')
        .find((button) => button.text().includes('ส่งรหัสใหม่'))
      await resend?.trigger('click')
      await flushPromises()

      expect(resendRegistrationCode).toHaveBeenCalledWith('new@example.com')
      expect(wrapper.text()).toContain('ส่งรหัสยืนยันใหม่แล้ว')
    })

    it('login บัญชีที่ยังไม่ยืนยันอีเมล: ส่งรหัสใหม่และพาไปหน้ายืนยัน แล้วเข้าสู่ระบบต่อ', async () => {
      login.mockRejectedValueOnce(cognitoError('UserNotConfirmedException'))
      const wrapper = mountGate()
      await signIn(wrapper, 'new@example.com', 'NewPassword1')

      expect(resendRegistrationCode).toHaveBeenCalledWith('new@example.com')
      expect(wrapper.find('#signup-code').exists()).toBe(true)

      await submitCode(wrapper, '123456')

      expect(login).toHaveBeenLastCalledWith('new@example.com', 'NewPassword1')
      expect(publishSignedIn).toHaveBeenCalledOnce()
    })
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
      expect(wrapper.text()).toContain('อย่างน้อย 6 ตัวอักษร')
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

  it('ไม่มีปุ่มโหมดดูตัวอย่างแบบอ่านอย่างเดียวแล้ว (เหลือแค่บัญชีทดลอง)', () => {
    const wrapper = mountGate()
    expect(wrapper.text()).not.toContain('ดูตัวอย่าง')
  })
})

describe('AuthGate infra link', () => {
  it('มีลิงก์ไปหน้าแผนภาพ AWS Infrastructure (เปิดแท็บใหม่)', () => {
    const wrapper = mountGate()
    const link = wrapper.find('a.infra-link')

    expect(link.exists()).toBe(true)
    expect(link.attributes('href')).toBe('/infrastructure.html')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toContain('noopener')
  })
})
