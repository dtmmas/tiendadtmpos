import { describe, expect, it } from 'vitest'
import {
  buildStoreEntryPath,
  buildStoreEntryUrl,
  buildStorePublicBasePath,
  buildStorePublicPath,
  DEFAULT_STORE_PUBLIC_SLUG,
  matchesStoreCustomDomain,
  normalizeStorePublicSlug,
  normalizeStoreCustomDomain,
  replaceStoreSlugInPath,
  stripStoreSlugPrefix,
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

  it('normaliza y compara dominios personalizados', () => {
    expect(normalizeStoreCustomDomain('https://Tienda.MiDominio.com/ruta')).toBe('tienda.midominio.com')
    expect(matchesStoreCustomDomain('tienda.midominio.com', 'https://tienda.midominio.com')).toBe(true)
  })

  it('usa rutas raíz cuando la tienda corre en su dominio configurado', () => {
    expect(buildStoreEntryPath({
      slug: DEFAULT_STORE_PUBLIC_SLUG,
      customDomain: 'tienda.midominio.com',
      currentHost: 'tienda.midominio.com',
      suffix: '/checkout',
    })).toBe('/checkout')
    expect(stripStoreSlugPrefix('/s/tiendadtm/pedido/ABC123')).toBe('/pedido/ABC123')
  })

  it('genera URL absoluta al usar dominio personalizado', () => {
    expect(buildStoreEntryUrl({
      slug: DEFAULT_STORE_PUBLIC_SLUG,
      customDomain: 'tienda.midominio.com',
      suffix: '/catalogo',
    })).toBe('https://tienda.midominio.com/catalogo')
  })
})
