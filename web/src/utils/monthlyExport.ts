import { Capacitor, registerPlugin } from '@capacitor/core'
import type { Transaction } from '../types/transaction'

interface MonthlyExportPlugin {
  shareCsv(options: { filename: string; content: string; title: string }): Promise<void>
}

export interface MonthlyExportSummary {
  month: string
  monthLabel: string
  transactions: Transaction[]
  openingBalance: number
  income: number
  expense: number
  closingBalance: number
}

export type MonthlyExportResult = 'shared' | 'downloaded' | 'cancelled'

const MonthlyExport = registerPlugin<MonthlyExportPlugin>('MonthlyExport')

const protectSpreadsheetCell = (value: string) => {
  const trimmed = value.trimStart()
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return value
  return /^[=+\-@]/.test(trimmed) ? `'${value}` : value
}

const csvCell = (value: string | number) => {
  const normalized = protectSpreadsheetCell(String(value)).replace(/"/g, '""')
  return `"${normalized}"`
}

const csvRow = (values: Array<string | number>) => values.map(csvCell).join(',')

const formatAmount = (amount: number) => Number(amount).toFixed(2)

export const buildMonthlyCsv = (summary: MonthlyExportSummary) => {
  const rows = [
    csvRow(['รายงานรายเดือน Money Flow']),
    csvRow(['เดือน', summary.monthLabel]),
    csvRow(['จำนวนรายการ', summary.transactions.length]),
    csvRow(['ยอดยกมา', formatAmount(summary.openingBalance)]),
    csvRow(['รายรับของเดือน', formatAmount(summary.income)]),
    csvRow(['รายจ่ายของเดือน', formatAmount(summary.expense)]),
    csvRow(['สุทธิของเดือน', formatAmount(summary.income - summary.expense)]),
    csvRow(['ยอดคงเหลือสะสม', formatAmount(summary.closingBalance)]),
    '',
    csvRow(['วันที่', 'ประเภท', 'หมวดหมู่', 'รายการ', 'จำนวนเงิน']),
    ...summary.transactions.map((transaction) =>
      csvRow([
        transaction.transaction_date,
        transaction.type === 'income' ? 'รายรับ' : 'รายจ่าย',
        transaction.category ?? '',
        transaction.description,
        formatAmount(transaction.amount),
      ]),
    ),
  ]

  // BOM ช่วยให้ Excel เปิดข้อความภาษาไทยเป็น UTF-8 ได้ถูกต้อง
  return `\uFEFF${rows.join('\r\n')}\r\n`
}

export const buildMonthlyFilename = (month: string) => `money-flow-${month}.csv`

const downloadCsv = (filename: string, content: string) => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

const browserShareFallbackErrors = new Set([
  'NotAllowedError',
  'SecurityError',
  'NotSupportedError',
  'DataError',
])

const shouldFallbackToDownload = (error: unknown) => {
  if (error instanceof DOMException && browserShareFallbackErrors.has(error.name)) return true
  return error instanceof Error && /^permission denied\.?$/i.test(error.message.trim())
}

export const exportMonthlyCsv = async (
  summary: MonthlyExportSummary,
): Promise<MonthlyExportResult> => {
  if (!/^\d{4}-\d{2}$/.test(summary.month)) throw new Error('เดือนไม่ถูกต้อง')
  if (summary.transactions.length === 0) throw new Error('ไม่มีรายการสำหรับส่งออก')

  const filename = buildMonthlyFilename(summary.month)
  const content = buildMonthlyCsv(summary)
  const title = `Money Flow — ${summary.monthLabel}`

  if (Capacitor.isNativePlatform()) {
    await MonthlyExport.shareCsv({ filename, content, title })
    return 'shared'
  }

  const file = new File([content], filename, { type: 'text/csv;charset=utf-8' })
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
      if (shouldFallbackToDownload(error)) {
        downloadCsv(filename, content)
        return 'downloaded'
      }
      throw error
    }
  }

  downloadCsv(filename, content)
  return 'downloaded'
}
