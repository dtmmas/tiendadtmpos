import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildStoreEntryUrl,
  buildStorePublicBasePath,
  buildStorePublicPath,
  checkStoreCustomDomainAvailability,
  DEFAULT_STORE_PUBLIC_SLUG,
  normalizeStoreCustomDomain,
  normalizeStorePublicSlug,
  validateStoreCustomDomain,
  validateStorePublicSlug,
} from '../services/store_public_link.js'

test('normaliza alias simples y rutas completas', () => {
  assert.equal(normalizeStorePublicSlug('Mi Tienda 2026'), 'mi-tienda-2026')
  assert.equal(normalizeStorePublicSlug('/s/Catalogo Premium'), 'catalogo-premium')
  assert.equal(normalizeStorePublicSlug('https://ejemplo.com/s/Tienda VIP'), 'tienda-vip')
})

test('usa el alias por defecto cuando el valor viene vacío', () => {
  assert.equal(normalizeStorePublicSlug(''), DEFAULT_STORE_PUBLIC_SLUG)
  assert.equal(buildStorePublicBasePath(''), `/s/${DEFAULT_STORE_PUBLIC_SLUG}`)
})

test('rechaza alias reservados del sistema', () => {
  const result = validateStorePublicSlug('login')
  assert.equal(result.ok, false)
  assert.match(String(result.error || ''), /rutas reservadas/i)
})

test('acepta el alias por defecto y construye subrutas públicas', () => {
  const result = validateStorePublicSlug(DEFAULT_STORE_PUBLIC_SLUG)
  assert.equal(result.ok, true)
  assert.equal(buildStorePublicPath(DEFAULT_STORE_PUBLIC_SLUG, '/catalogo'), `/s/${DEFAULT_STORE_PUBLIC_SLUG}/catalogo`)
})

test('normaliza y valida dominios personalizados', () => {
  assert.equal(normalizeStoreCustomDomain('https://Tienda.DTM.com/ruta'), 'tienda.dtm.com')
  assert.equal(validateStoreCustomDomain('tienda.midominio.com').ok, true)
  assert.equal(validateStoreCustomDomain('tiendadtmpos.sistemasdtm.com', { systemHost: 'tiendadtmpos.sistemasdtm.com' }).ok, false)
})

test('detecta disponibilidad DNS del dominio personalizado', async () => {
  const fakeResolver = {
    resolve4: async () => ['76.13.97.223'],
    resolve6: async () => [],
    resolveCname: async () => [],
  }
  const result = await checkStoreCustomDomainAvailability('tienda.midominio.com', { resolver: fakeResolver })
  assert.equal(result.ok, true)
  assert.equal(result.dnsReady, true)
})

test('construye URL absoluta con dominio personalizado', () => {
  assert.equal(
    buildStoreEntryUrl({ slug: DEFAULT_STORE_PUBLIC_SLUG, customDomain: 'tienda.midominio.com', suffix: '/checkout' }),
    'https://tienda.midominio.com/checkout'
  )
})
