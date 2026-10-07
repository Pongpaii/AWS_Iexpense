<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Transaction, TransactionInput } from '../types/transaction'
import TransactionForm from './TransactionForm.vue'

const props = defineProps<{
  transaction: Transaction | null
  busy: boolean
}>()

const emit = defineEmits<{
  close: []
  submit: [value: TransactionInput]
}>()

const dialog = ref<HTMLElement | null>(null)

const close = () => {
  if (!props.busy) emit('close')
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && props.transaction) close()
}

watch(
  () => props.transaction,
  async (transaction) => {
    document.body.style.overflow = transaction ? 'hidden' : ''
    if (transaction) {
      await nextTick()
      dialog.value?.focus()
    }
  },
)

onMounted(() => window.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="edit-modal">
      <div v-if="transaction" class="edit-backdrop" @mousedown.self="close">
        <section
          ref="dialog"
          class="edit-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-dialog-title"
          tabindex="-1"
        >
          <header class="edit-header">
            <div>
              <span>แก้ไข Transaction</span>
              <h2 id="edit-dialog-title">{{ transaction.description }}</h2>
            </div>
            <button type="button" aria-label="ปิดหน้าต่างแก้ไข" :disabled="busy" @click="close">
              ×
            </button>
          </header>

          <div class="edit-body">
            <TransactionForm
              :editing="transaction"
              :busy="busy"
              @submit="emit('submit', $event)"
              @cancel="close"
            />
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.edit-backdrop {
  position: fixed;
  z-index: 110;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(10, 28, 21, 0.62);
  backdrop-filter: blur(6px);
}

.edit-dialog {
  width: min(540px, 100%);
  max-height: calc(100vh - 40px);
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.55);
  border-radius: 20px;
  outline: none;
  background: #f7f9f6;
  box-shadow: 0 30px 90px rgba(7, 28, 19, 0.34);
}

.edit-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
  padding: 18px 20px;
  color: white;
  background: #194d3b;
}

.edit-header span {
  color: #c9f06c;
  font-size: 0.57rem;
  font-weight: 800;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}

.edit-header h2 {
  max-width: 390px;
  margin: 2px 0 0;
  overflow: hidden;
  font-family: 'Noto Sans Thai', sans-serif;
  font-size: 1rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.edit-header button {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 9px;
  color: white;
  background: rgba(255, 255, 255, 0.08);
  font-size: 1.15rem;
}

.edit-body {
  max-height: calc(100vh - 116px);
  overflow-y: auto;
  padding: 14px;
}

.edit-body :deep(.form-panel) {
  position: static;
  top: auto;
  padding: 17px;
  box-shadow: none;
}

.edit-modal-enter-active,
.edit-modal-leave-active {
  transition: opacity 0.2s ease;
}

.edit-modal-enter-active .edit-dialog,
.edit-modal-leave-active .edit-dialog {
  transition:
    opacity 0.2s ease,
    transform 0.25s cubic-bezier(0.2, 0.9, 0.2, 1);
}

.edit-modal-enter-from,
.edit-modal-leave-to {
  opacity: 0;
}

.edit-modal-enter-from .edit-dialog,
.edit-modal-leave-to .edit-dialog {
  opacity: 0;
  transform: translateY(14px) scale(0.97);
}

@media (max-width: 580px) {
  .edit-backdrop {
    align-items: end;
    padding: 0;
  }

  .edit-dialog {
    width: 100%;
    max-height: 94vh;
    border-radius: 20px 20px 0 0;
  }

  .edit-header {
    padding: 16px 17px;
  }

  .edit-body {
    max-height: calc(94vh - 70px);
    padding: 10px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .edit-modal-enter-active,
  .edit-modal-leave-active,
  .edit-modal-enter-active .edit-dialog,
  .edit-modal-leave-active .edit-dialog {
    transition: none;
  }
}
</style>
