const bahtFormatter = new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

const dateFormatter = new Intl.DateTimeFormat('th-TH', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

export const formatBaht = (amount: number) => bahtFormatter.format(amount)

export const formatDate = (date: string) => dateFormatter.format(new Date(`${date}T00:00:00`))
