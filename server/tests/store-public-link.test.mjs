import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildStorePublicBasePath,
  buildStorePublicPath,
  DEFAULT_STORE_PUBLIC_SLUG,
  normalizeStorePublicSlug,
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

