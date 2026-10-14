import { describe, expect, it } from 'vitest'
import {
  buildStorePublicBasePath,
  buildStorePublicPath,
  DEFAULT_STORE_PUBLIC_SLUG,
  normalizeStorePublicSlug,
  replaceStoreSlugInPath,
} from './storePublicLink'

describe('storePublicLink', () => {
  it('normaliza alias y URLs públicas', () => {
    expect(normalizeStorePublicSlug('Mi Tienda Pro')).toBe('mi-tienda-pro')
    expect(normalizeStorePublicSlug('https://dominio.com/s/Tienda VIP')).toBe('tienda-vip')
  })

  it('construye la base pública y subrutas', () => {
    expect(buildStorePublicBasePath('catalogo-dtm')).toBe('/s/catalogo-dtm')
    expect(buildStorePublicPath('catalogo-dtm', '/checkout')).toBe('/s/catalogo-dtm/checkout')
  })

  it('reemplaza el alias de una ruta pública existente', () => {
    expect(replaceStoreSlugInPath('/s/tienda-demo/carrito', 'nueva-url')).toBe('/s/nueva-url/carrito')
  })

  it('usa el alias por defecto cuando no recibe valor', () => {
    expect(buildStorePublicBasePath()).toBe(`/s/${DEFAULT_STORE_PUBLIC_SLUG}`)
  })
})

