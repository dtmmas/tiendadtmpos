export const DEFAULT_STORE_PUBLIC_SLUG = 'tiendadtm'
export const STORE_PUBLIC_PREFIX = '/s'

const RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'app',
  'assets',
  'brands',
  'cash-history',
  'cash-register',
  'categories',
  'checkout',
  'config',
  'credits',
  'credit-reports',
  'customers',
  'dashboard',
  'departments',
  'internet-residencial',
  'inventory',
  'logs',
  'login',
  'pedido',
  'pos',
  'products',
  'purchases',
  'quotations',
  'roles',
  'root-core',
  's',
  'sales',
  'shelves',
  'store',
  'store-admin',
  'suppliers',
  'transfers',
  'units',
  'uploads',
  'users',
  'warehouses',
])

function stripDiacritics(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function decodePathSegment(value) {
  try {
    return decodeURIComponent(String(value || ''))
  } catch {
    return String(value || '')
  }
}

export function normalizeStorePublicSlug(value) {
  const rawValue = String(value || '').trim()
  if (!rawValue) return DEFAULT_STORE_PUBLIC_SLUG

  let candidate = rawValue
  try {
    if (/^https?:\/\//i.test(rawValue)) {
      const parsed = new URL(rawValue)
      const segments = String(parsed.pathname || '')
        .split('/')
        .map((segment) => segment.trim())
        .filter(Boolean)
      if (segments[0]?.toLowerCase() === STORE_PUBLIC_PREFIX.replace('/', '') && segments[1]) {
        candidate = decodePathSegment(segments[1])
      } else if (segments.length === 1) {
        candidate = decodePathSegment(segments[0])
      }
    }
  } catch {
    candidate = rawValue
  }

  candidate = candidate
    .replace(/^\/+/, '')
    .replace(new RegExp(`^${STORE_PUBLIC_PREFIX.replace('/', '')}\/`, 'i'), '')
    .split('/')[0]

  return stripDiacritics(candidate)
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || DEFAULT_STORE_PUBLIC_SLUG
}

export function validateStorePublicSlug(value) {
  const slug = normalizeStorePublicSlug(value)

  if (slug.length < 3) {
    return { ok: false, slug, error: 'El enlace público debe tener al menos 3 caracteres.' }
  }

  if (slug.length > 60) {
    return { ok: false, slug, error: 'El enlace público no puede superar 60 caracteres.' }
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return { ok: false, slug, error: 'El enlace público solo puede usar letras, números y guiones medios.' }
  }

  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, slug, error: 'Ese enlace entra en conflicto con rutas reservadas del sistema.' }
  }

  return { ok: true, slug, error: null }
}

export function buildStorePublicBasePath(slug) {
  return `${STORE_PUBLIC_PREFIX}/${normalizeStorePublicSlug(slug)}`
}

export function buildStorePublicPath(slug, suffix = '') {
  const basePath = buildStorePublicBasePath(slug)
  const normalizedSuffix = String(suffix || '').trim()
  if (!normalizedSuffix || normalizedSuffix === '/') return basePath
  return normalizedSuffix.startsWith('/') ? `${basePath}${normalizedSuffix}` : `${basePath}/${normalizedSuffix}`
}
