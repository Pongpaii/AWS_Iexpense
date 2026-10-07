import { readonly, ref } from 'vue'

export const DEFAULT_MONTHLY_SALARY = 17_000
export const SALARY_DAY = 30

export const SALARY_STORAGE_KEY = 'money-flow.monthly-salary.v1'
const SALARY_HIDDEN_STORAGE_KEY = 'money-flow.salary-hidden.v1'
export const MAX_MONTHLY_SALARY = 100_000_000

const normalizeSalary = (amount: number) => {
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_MONTHLY_SALARY) return null
  return Math.round(amount * 100) / 100
}

const loadMonthlySalary = () => {
  if (typeof window === 'undefined') return DEFAULT_MONTHLY_SALARY

  try {
    const storedSalary = window.localStorage.getItem(SALARY_STORAGE_KEY)
    if (storedSalary === null) return DEFAULT_MONTHLY_SALARY
    return normalizeSalary(Number(storedSalary)) ?? DEFAULT_MONTHLY_SALARY
  } catch {
    return DEFAULT_MONTHLY_SALARY
  }
}

const loadSalaryHidden = () => {
  if (typeof window === 'undefined') return true

  try {
    const storedPreference = window.localStorage.getItem(SALARY_HIDDEN_STORAGE_KEY)
    return storedPreference === null ? true : storedPreference !== 'false'
  } catch {
    return true
  }
}

const monthlySalary = ref(loadMonthlySalary())
const salaryHidden = ref(loadSalaryHidden())
const readonlyMonthlySalary = readonly(monthlySalary)
const readonlySalaryHidden = readonly(salaryHidden)

export interface PreferenceSaveResult {
  ok: boolean
  persisted: boolean
}

let serverSalarySaver: ((amount: number) => void | Promise<void>) | null = null

const saveMonthlySalary = (amount: number): PreferenceSaveResult => {
  const normalizedSalary = normalizeSalary(amount)
  if (normalizedSalary === null) return { ok: false, persisted: false }

  monthlySalary.value = normalizedSalary
  void serverSalarySaver?.(normalizedSalary)

  try {
    window.localStorage.setItem(SALARY_STORAGE_KEY, String(normalizedSalary))
    return { ok: true, persisted: true }
  } catch {
    return { ok: true, persisted: false }
  }
}

const setSalaryHidden = (hidden: boolean): PreferenceSaveResult => {
  salaryHidden.value = hidden

  try {
    window.localStorage.setItem(SALARY_HIDDEN_STORAGE_KEY, String(hidden))
    return { ok: true, persisted: true }
  } catch {
    return { ok: true, persisted: false }
  }
}

const toggleSalaryVisibility = () => setSalaryHidden(!salaryHidden.value)

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === SALARY_STORAGE_KEY && event.newValue !== null) {
      const storedSalary = normalizeSalary(Number(event.newValue))
      if (storedSalary !== null) monthlySalary.value = storedSalary
    }

    if (event.key === SALARY_HIDDEN_STORAGE_KEY && event.newValue !== null) {
      salaryHidden.value = event.newValue !== 'false'
    }
  })
}

export const applyServerSalary = (amount: number) => {
  const normalized = normalizeSalary(amount)
  if (normalized === null) return false
  monthlySalary.value = normalized
  try {
    window.localStorage.setItem(SALARY_STORAGE_KEY, String(normalized))
  } catch {
    // Keep the server value in memory when local cache is unavailable.
  }
  return true
}

export const registerServerSalarySaver = (
  saver: ((amount: number) => void | Promise<void>) | null,
) => {
  serverSalarySaver = saver
}

export const useSalarySettings = () => ({
  monthlySalary: readonlyMonthlySalary,
  salaryDay: SALARY_DAY,
  salaryHidden: readonlySalaryHidden,
  saveMonthlySalary,
  setSalaryHidden,
  toggleSalaryVisibility,
})
