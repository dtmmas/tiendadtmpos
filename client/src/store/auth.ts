import { create } from 'zustand'
import { api, setAuthToken } from '../api'

export type Role = 'ADMIN' | 'CAJERO' | 'ALMACEN' | string

export interface User {
  id: number
  name: string
  role: Role
  permissions: string[]
  canSell?: boolean
  warehouseId?: number
  warehouseName?: string
}

interface AuthState {
  token?: string
  user?: User
  login: (email: string, password: string) => Promise<boolean>
  logout: () => void
  hasPermission: (permission: string) => boolean
  canSell: () => boolean
}

// Rehidratar desde localStorage al cargar
let storedAuth: { token?: string; user?: User } | null = null
try {
  const raw = localStorage.getItem('auth')
  storedAuth = raw ? JSON.parse(raw) : null
} catch {
  storedAuth = null
}
if (storedAuth?.token) setAuthToken(storedAuth.token)

export const useAuthStore = create<AuthState>((set, get) => ({
  token: storedAuth?.token,
  user: storedAuth?.user,
  async login(email, password) {
    try {
      const { data } = await api.post('/auth/login', { email, password })
      setAuthToken(data.token)
      // Persistir sesión
      try { localStorage.setItem('auth', JSON.stringify({ token: data.token, user: data.user })) } catch {}
      set({ token: data.token, user: data.user })
      return true
    } catch (e) {
      return false
    }
  },
  logout() {
    setAuthToken(undefined)
    try { localStorage.removeItem('auth') } catch {}
    set({ token: undefined, user: undefined })
  },
  hasPermission(permission: string) {
    const user = get().user
    if (!user) return false
    if (user.role === 'ADMIN') return true
    return user.permissions?.includes(permission) || false
  },
  canSell() {
    const user = get().user
    if (!user || user.canSell === false) return false
    if (user.role === 'ADMIN') return true
    return user.permissions?.includes('sales:create') || user.permissions?.includes('pos:access') || false
  }
}))
