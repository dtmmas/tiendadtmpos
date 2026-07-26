const MAP: Record<string, { code?: string; symbol: string }> = {
  USD: { code: 'USD', symbol: '$' },
  EUR: { code: 'EUR', symbol: '€' },
  MXN: { code: 'MXN', symbol: '$' },
  PEN: { code: 'PEN', symbol: 'S/' },
  CLP: { code: 'CLP', symbol: '$' },
  COP: { code: 'COP', symbol: '$' },
  ARS: { code: 'ARS', symbol: '$' },
  BOB: { code: 'BOB', symbol: 'Bs' },
  VES: { code: 'VES', symbol: 'Bs' },
  BRL: { code: 'BRL', symbol: 'R$' },
  GBP: { code: 'GBP', symbol: '£' },
  JPY: { code: 'JPY', symbol: '¥' },
}

const DEFAULT_LOCALE = 'en-US'

function normalize(input?: string): { code?: string; symbol: string } {
  const val = (input || 'USD').toUpperCase()
  if (MAP[val]) return MAP[val]
  // Si el usuario pone un símbolo (p.ej. "Bs"), úsalo tal cual como símbolo
  return { symbol: input || '$' }
}

export function formatNumber(value: number, fractionDigits = 2, locale = DEFAULT_LOCALE): string {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount)
}

export function formatPercent(value: number, fractionDigits = 2, locale = DEFAULT_LOCALE): string {
  return `${formatNumber(value, fractionDigits, locale)}%`
}

// Formateo de dinero con coma para millares y punto para decimales.
// Por defecto usa 'en-US' para lograr 1,234.56
export function formatMoney(amount: number, currency?: string, locale = DEFAULT_LOCALE): string {
  const info = normalize(currency)
  if (info.code) {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: info.code }).format(amount)
    } catch {
      // Fallback a símbolo si Intl falla
      const num = formatNumber(amount, 2, DEFAULT_LOCALE)
      return `${info.symbol} ${num}`
    }
  }
  const num = formatNumber(amount, 2, DEFAULT_LOCALE)
  return `${info.symbol} ${num}`
}
