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

function splitHostAndPort(value: string) {
  const normalized = String(value || '').trim().toLowerCase()
  const match = normalized.match(/^([^/:?#]+)(?::(\d{1,5}))?$/)
  if (!match) return null
  return {
    host: match[1],
    port: match[2] ? Number(match[2]) : null,
  }
}

function isIPv4(host: string) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false
  return host.split('.').every((segment) => Number(segment) >= 0 && Number(segment) <= 255)
}

function isLocalDevelopmentHost(host: string) {
  return host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0' || host.startsWith('127.')
}

function normalizeComparableHost(value: unknown) {
  const split = splitHostAndPort(normalizeStoreCustomDomain(value))
  return split?.host || ''
}

function getEffectiveStoreCustomDomain(value: unknown) {
  const normalized = normalizeStoreCustomDomain(value)
  const split = splitHostAndPort(normalized)
  if (!split?.host) return ''
  if (isLocalDevelopmentHost(split.host) || isIPv4(split.host)) return ''
  return normalized
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

export function normalizeStoreCustomDomain(value: unknown) {
  const rawValue = String(value || '').trim().toLowerCase()
  if (!rawValue) return ''

  try {
    const parsed = new URL(/^https?:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`)
    return String(parsed.host || '')
      .trim()
      .toLowerCase()
      .replace(/\.+$/, '')
  } catch {
    return rawValue
      .replace(/^https?:\/\//i, '')
      .replace(/^[/.]+/, '')
      .split(/[/?#]/)[0]
      .trim()
      .toLowerCase()
      .replace(/\.+$/, '')
  }
}

export function matchesStoreCustomDomain(currentHost: string, configuredDomain?: string | null) {
  const current = normalizeComparableHost(currentHost)
  const configured = normalizeComparableHost(getEffectiveStoreCustomDomain(configuredDomain))
  return Boolean(current && configured && current === configured)
}

export function getStoreCustomDomainProtocol(configuredDomain?: string | null) {
  const split = splitHostAndPort(normalizeStoreCustomDomain(configuredDomain))
  return split?.host && isLocalDevelopmentHost(split.host) ? 'http' : 'https'
}

export function buildStoreRootPath(suffix = '') {
  const normalizedSuffix = String(suffix || '').trim()
  if (!normalizedSuffix || normalizedSuffix === '/') return '/'
  return normalizedSuffix.startsWith('/') ? normalizedSuffix : `/${normalizedSuffix}`
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

export function stripStoreSlugPrefix(pathname: string) {
  const normalizedPathname = String(pathname || '').trim() || '/'
  const stripped = normalizedPathname.replace(/^\/s\/[^/]+/i, '')
  return buildStoreRootPath(stripped)
}

export function replaceStoreSlugInPath(pathname: string, slug?: string | null) {
  const normalizedPathname = String(pathname || '').trim() || '/'
  return normalizedPathname.replace(/^\/s\/[^/]+/i, buildStorePublicBasePath(slug))
}

export function buildStoreEntryPath(options: {
  slug?: string | null
  customDomain?: string | null
  currentHost?: string | null
  suffix?: string
}) {
  if (matchesStoreCustomDomain(String(options.currentHost || ''), options.customDomain)) {
    return buildStoreRootPath(options.suffix)
  }
  return buildStorePublicPath(options.slug, options.suffix)
}

export function buildStoreEntryUrl(options: {
  slug?: string | null
  customDomain?: string | null
  origin?: string | null
  suffix?: string
}) {
  const customDomain = getEffectiveStoreCustomDomain(options.customDomain)
  if (customDomain) {
    return `${getStoreCustomDomainProtocol(customDomain)}://${customDomain}${buildStoreRootPath(options.suffix)}`
  }
  const origin = String(options.origin || '').trim().replace(/\/+$/, '')
  const path = buildStorePublicPath(options.slug, options.suffix)
  return origin ? `${origin}${path}` : path
}

export function isStoreCustomDomainDevelopmentValue(configuredDomain?: string | null) {
  const split = splitHostAndPort(normalizeStoreCustomDomain(configuredDomain))
  return Boolean(split?.host && (isLocalDevelopmentHost(split.host) || isIPv4(split.host)))
}
