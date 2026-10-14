import { create } from 'zustand'

type StoredWishlist = {
  productIds: number[]
}

let storedWishlist: StoredWishlist | null = null
try {
  const raw = localStorage.getItem('store_wishlist')
  storedWishlist = raw ? JSON.parse(raw) : null
} catch {
  storedWishlist = null
}

function persistWishlist(productIds: number[]) {
  try { localStorage.setItem('store_wishlist', JSON.stringify({ productIds })) } catch {}
}

type StoreWishlistState = {
  productIds: number[]
  toggle: (productId: number) => void
  has: (productId: number) => boolean
  count: () => number
}

export const useStoreWishlist = create<StoreWishlistState>((set, get) => ({
  productIds: storedWishlist?.productIds || [],
  toggle(productId) {
    const current = get().productIds
    const next = current.includes(productId)
      ? current.filter(id => id !== productId)
      : [...current, productId]
    persistWishlist(next)
    set({ productIds: next })
  },
  has(productId) {
    return get().productIds.includes(productId)
  },
  count() {
    return get().productIds.length
  },
}))
