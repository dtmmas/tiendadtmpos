import dns from 'node:dns/promises'

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

function splitHostAndPort(value) {
  const normalized = String(value || '').trim().toLowerCase()
  const match = normalized.match(/^([^/:?#]+)(?::(\d{1,5}))?$/)
  if (!match) return null
  return {
    host: match[1],
    port: match[2] ? Number(match[2]) : null,
  }
}

function isIPv4(host) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false
  return host.split('.').every((segment) => Number(segment) >= 0 && Number(segment) <= 255)
}

function isLocalDevelopmentHost(host) {
  return host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0' || host.startsWith('127.')
}

function isValidHostname(host) {
  if (!host) return false
  if (isIPv4(host) || isLocalDevelopmentHost(host)) return true
  if (host.length > 253) return false
  const labels = host.split('.')
  if (labels.length < 2) return false
  return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
}

function normalizeComparableHost(value) {
  const split = splitHostAndPort(normalizeStoreCustomDomain(value))
  return split?.host || ''
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

export function normalizeStoreCustomDomain(value) {
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

export function validateStoreCustomDomain(value, options = {}) {
  const domain = normalizeStoreCustomDomain(value)
  const systemHost = normalizeComparableHost(options.systemHost)

  if (!domain) {
    return {
      ok: true,
      domain: '',
      host: '',
      port: null,
      isLocal: false,
      error: null,
    }
  }

  const split = splitHostAndPort(domain)
  if (!split) {
    return { ok: false, domain, host: '', port: null, isLocal: false, error: 'El dominio de la tienda no tiene un formato válido.' }
  }

  if (!isValidHostname(split.host)) {
    return { ok: false, domain, host: split.host, port: split.port, isLocal: false, error: 'Ingresa un dominio válido, por ejemplo `tienda.midominio.com`.' }
  }

  if (split.port != null && (!Number.isInteger(split.port) || split.port <= 0 || split.port > 65535)) {
    return { ok: false, domain, host: split.host, port: split.port, isLocal: false, error: 'El puerto del dominio debe estar entre 1 y 65535.' }
  }

  const isLocal = isLocalDevelopmentHost(split.host)
  if (systemHost && split.host === systemHost && !isLocal) {
    return { ok: false, domain, host: split.host, port: split.port, isLocal, error: 'El dominio de la tienda debe ser distinto al dominio principal del sistema.' }
  }

  return {
    ok: true,
    domain,
    host: split.host,
    port: split.port,
    isLocal,
    error: null,
  }
}

export async function checkStoreCustomDomainAvailability(value, options = {}) {
  const validation = validateStoreCustomDomain(value, options)
  if (!validation.ok) {
    return {
      ...validation,
      dnsReady: false,
      message: validation.error,
      records: [],
    }
  }

  if (!validation.domain) {
    return {
      ...validation,
      dnsReady: null,
      message: 'No hay dominio personalizado configurado.',
      records: [],
    }
  }

  if (validation.isLocal || isIPv4(validation.host)) {
    return {
      ...validation,
      dnsReady: true,
      message: 'Dominio listo para entorno local o IP directa.',
      records: [],
    }
  }

  const resolver = options.resolver || dns
  const records = []

  const checks = [
    ['A', async () => resolver.resolve4(validation.host)],
    ['AAAA', async () => resolver.resolve6(validation.host)],
    ['CNAME', async () => resolver.resolveCname(validation.host)],
  ]

  for (const [type, action] of checks) {
    try {
      const values = await action()
      if (Array.isArray(values) && values.length > 0) {
        records.push({
          type,
          values: values.map((entry) => String(entry || '')),
        })
      }
    } catch (error) {
      const code = String(error?.code || '')
      if (!['ENOTFOUND', 'ENODATA', 'ENOTIMP', 'EINVAL', 'SERVFAIL'].includes(code)) {
        records.push({
          type,
          values: [`error:${code || 'UNKNOWN'}`],
        })
      }
    }
  }

  const dnsReady = records.some((record) => Array.isArray(record.values) && record.values.length > 0 && !String(record.values[0] || '').startsWith('error:'))
  return {
    ...validation,
    dnsReady,
    message: dnsReady
      ? 'El dominio tiene registros DNS detectables.'
      : 'Todavía no encontramos registros DNS para este dominio. Puedes guardarlo, pero la publicación requerirá apuntarlo al servidor.',
    records,
  }
}

export function matchesStoreCustomDomain(currentHost, configuredDomain) {
  const current = normalizeComparableHost(currentHost)
  const configured = normalizeComparableHost(configuredDomain)
  return Boolean(current && configured && current === configured)
}

export function getStoreCustomDomainProtocol(configuredDomain) {
  const validation = validateStoreCustomDomain(configuredDomain)
  return validation.isLocal ? 'http' : 'https'
}

export function buildStoreRootPath(suffix = '') {
  const normalizedSuffix = String(suffix || '').trim()
  if (!normalizedSuffix || normalizedSuffix === '/') return '/'
  return normalizedSuffix.startsWith('/') ? normalizedSuffix : `/${normalizedSuffix}`
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

export function buildStoreEntryPath(options = {}) {
  if (options.customDomain) return buildStoreRootPath(options.suffix)
  return buildStorePublicPath(options.slug, options.suffix)
}

export function buildStoreEntryUrl(options = {}) {
  if (options.customDomain) {
    const domain = normalizeStoreCustomDomain(options.customDomain)
    return `${getStoreCustomDomainProtocol(domain)}://${domain}${buildStoreRootPath(options.suffix)}`
  }
  const origin = String(options.origin || '').trim().replace(/\/+$/, '')
  const path = buildStorePublicPath(options.slug, options.suffix)
  return origin ? `${origin}${path}` : path
}

