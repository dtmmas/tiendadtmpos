export const DEFAULT_STORE_PUBLIC_SLUG = 'tiendadtm'
export const STORE_PUBLIC_PREFIX = '/s'

function stripDiacritics(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function decodePathSegment(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function normalizeStorePublicSlug(value: unknown) {
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

export function buildStorePublicBasePath(slug?: string | null) {
  return `${STORE_PUBLIC_PREFIX}/${normalizeStorePublicSlug(slug)}`
}

export function buildStorePublicPath(slug?: string | null, suffix = '') {
  const basePath = buildStorePublicBasePath(slug)
  const normalizedSuffix = String(suffix || '').trim()
  if (!normalizedSuffix || normalizedSuffix === '/') return basePath
  return normalizedSuffix.startsWith('/') ? `${basePath}${normalizedSuffix}` : `${basePath}/${normalizedSuffix}`
}

export function replaceStoreSlugInPath(pathname: string, slug?: string | null) {
  const normalizedPathname = String(pathname || '').trim() || '/'
  return normalizedPathname.replace(/^\/s\/[^/]+/i, buildStorePublicBasePath(slug))
}
