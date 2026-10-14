import { create } from 'zustand'

export type StoreCartItem = {
  productId: number
  name: string
  price: number
  imageUrl: string | null
  quantity: number
}

type StoredCart = {
  items: StoreCartItem[]
}

let storedCart: StoredCart | null = null
try {
  const raw = localStorage.getItem('store_cart')
  storedCart = raw ? JSON.parse(raw) : null
} catch {
  storedCart = null
}

function persistCart(items: StoreCartItem[]) {
  try { localStorage.setItem('store_cart', JSON.stringify({ items })) } catch {}
}

type StoreCartState = {
  items: StoreCartItem[]
  addItem: (item: Omit<StoreCartItem, 'quantity'>, quantity?: number) => void
  setQuantity: (productId: number, quantity: number) => void
  removeItem: (productId: number) => void
  clear: () => void
  subtotal: () => number
  count: () => number
}

export const useStoreCart = create<StoreCartState>((set, get) => ({
  items: storedCart?.items || [],
  addItem(item, quantity = 1) {
    const qty = Math.max(1, Math.floor(Number(quantity || 1)))
    const current = get().items
    const idx = current.findIndex(i => i.productId === item.productId)
    const next = idx >= 0
      ? current.map(i => i.productId === item.productId ? { ...i, quantity: i.quantity + qty } : i)
      : [...current, { ...item, quantity: qty }]
    persistCart(next)
    set({ items: next })
  },
  setQuantity(productId, quantity) {
    const qty = Math.max(0, Math.floor(Number(quantity || 0)))
    const current = get().items
    const next = qty === 0 ? current.filter(i => i.productId !== productId) : current.map(i => i.productId === productId ? { ...i, quantity: qty } : i)
    persistCart(next)
    set({ items: next })
  },
  removeItem(productId) {
    const current = get().items
    const next = current.filter(i => i.productId !== productId)
    persistCart(next)
    set({ items: next })
  },
  clear() {
    persistCart([])
    set({ items: [] })
  },
  subtotal() {
    return get().items.reduce((sum, i) => sum + (Number(i.price || 0) * Number(i.quantity || 0)), 0)
  },
  count() {
    return get().items.reduce((sum, i) => sum + Number(i.quantity || 0), 0)
  }
}))

