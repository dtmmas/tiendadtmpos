import { create } from 'zustand'

export type Theme = 'light' | 'dark'
export type ThemeMode = 'light' | 'dark' | 'system'

export const THEME_COLOR_OPTIONS = [
  { value: 'sky', label: 'Azul', preview: '#0ea5e9' },
  { value: 'cyan', label: 'Cian', preview: '#06b6d4' },
  { value: 'emerald', label: 'Esmeralda', preview: '#10b981' },
  { value: 'lime', label: 'Lima', preview: '#84cc16' },
  { value: 'amber', label: 'Ambar', preview: '#f59e0b' },
  { value: 'orange', label: 'Naranja', preview: '#f97316' },
  { value: 'rose', label: 'Rosa', preview: '#f43f5e' },
  { value: 'pink', label: 'Rosado', preview: '#ec4899' },
  { value: 'violet', label: 'Violeta', preview: '#8b5cf6' },
  { value: 'indigo', label: 'Indigo', preview: '#6366f1' },
  { value: 'slate', label: 'Gris', preview: '#64748b' },
  { value: 'white', label: 'Blanco', preview: '#f8fafc' },
] as const

export type ThemeColor = typeof THEME_COLOR_OPTIONS[number]['value']

interface ThemeState {
  theme: Theme
  mode: ThemeMode
  color: ThemeColor
  setMode: (m: ThemeMode) => void
  setColor: (c: ThemeColor) => void
  toggleMode: () => void
}

function detectSystemTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function isThemeColor(value: string | null | undefined): value is ThemeColor {
  return THEME_COLOR_OPTIONS.some((option) => option.value === value)
}

function applyTheme(t: Theme, mode?: ThemeMode, color?: ThemeColor) {
  try {
    document.documentElement.setAttribute('data-theme', t)
    if (mode) document.documentElement.setAttribute('data-theme-mode', mode)
    if (color) document.documentElement.setAttribute('data-theme-color', color)
  } catch {}
}

let initialMode: ThemeMode = 'dark'
try {
  const raw = localStorage.getItem('themeMode') as ThemeMode | null
  if (raw === 'light' || raw === 'dark' || raw === 'system') initialMode = raw
} catch {}

let initialColor: ThemeColor = 'sky'
try {
  const raw = localStorage.getItem('themeColor')
  if (isThemeColor(raw)) initialColor = raw
} catch {}

let initialTheme: Theme = initialMode === 'system' ? detectSystemTheme() : (initialMode as Theme)

// Aplicar inmediatamente para evitar flash
try { applyTheme(initialTheme, initialMode, initialColor) } catch {}

function subscribeSystemChanges(onChange: (t: Theme) => void) {
  if (!window.matchMedia) return () => {}
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const handler = () => onChange(media.matches ? 'dark' : 'light')
  try { media.addEventListener('change', handler) } catch { media.addListener(handler) }
  return () => {
    try { media.removeEventListener('change', handler) } catch { media.removeListener(handler) }
  }
}

export const useThemeStore = create<ThemeState>((set, get) => {
  let unsub: (() => void) | null = null
  return {
    theme: initialTheme,
    mode: initialMode,
    color: initialColor,
    setMode(m) {
      try { localStorage.setItem('themeMode', m) } catch {}
      if (unsub) { try { unsub() } catch {} ; unsub = null }
      const currentColor = get().color
      if (m === 'system') {
        const sys = detectSystemTheme()
        applyTheme(sys, m, currentColor)
        set({ mode: m, theme: sys })
        unsub = subscribeSystemChanges((t) => {
          applyTheme(t, 'system', get().color)
          set({ theme: t })
        })
      } else {
        applyTheme(m as Theme, m, currentColor)
        set({ mode: m, theme: m as Theme })
      }
    },
    setColor(c) {
      try { localStorage.setItem('themeColor', c) } catch {}
      applyTheme(get().theme, get().mode, c)
      set({ color: c })
    },
    toggleMode() {
      const current = get().mode
      const next = current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light'
      get().setMode(next)
    },
  }
})
