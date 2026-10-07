import { defineComponent, h, type App } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'

export interface SetupHarness<T> {
  result: T
  unmount: () => void
  app: VueWrapper
}

/**
 * รัน composable ในบริบทของคอมโพเนนต์จริง
 *
 * จำเป็นเพราะ composable หลายตัวเรียก onMounted/onBeforeUnmount
 * ถ้าเรียกลอย ๆ hook เหล่านั้นจะไม่ทำงานและ Vue จะเตือน
 * unmount() ช่วยให้เทสต์ตรวจได้ว่า cleanup ทำงานถูกต้อง
 */
export const withSetup = <T>(composable: () => T): SetupHarness<T> => {
  let result!: T

  const wrapper = mount(
    defineComponent({
      name: 'ComposableHarness',
      setup() {
        result = composable()
        return () => h('div')
      },
    }),
  )

  return {
    result,
    app: wrapper as unknown as VueWrapper,
    unmount: () => wrapper.unmount(),
  }
}

export type { App }
