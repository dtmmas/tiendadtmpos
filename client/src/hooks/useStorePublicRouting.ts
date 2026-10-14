import { useEffect, useMemo } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  buildStoreEntryPath,
  buildStorePublicBasePath,
  matchesStoreCustomDomain,
  normalizeStorePublicSlug,
  replaceStoreSlugInPath,
  stripStoreSlugPrefix,
} from '../utils/storePublicLink'

export function useStorePublicRouting(configuredSlug?: string | null, configuredDomain?: string | null) {
  const { storeSlug } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const currentHost = typeof window === 'undefined' ? '' : window.location.host

  const normalizedRouteSlug = useMemo(() => normalizeStorePublicSlug(storeSlug), [storeSlug])
  const normalizedConfiguredSlug = useMemo(
    () => configuredSlug ? normalizeStorePublicSlug(configuredSlug) : '',
    [configuredSlug]
  )
  const resolvedSlug = normalizedConfiguredSlug || normalizedRouteSlug
  const customDomainActive = useMemo(
    () => matchesStoreCustomDomain(currentHost, configuredDomain),
    [configuredDomain, currentHost]
  )
  const storeBasePath = useMemo(
    () => customDomainActive ? '/' : buildStorePublicBasePath(resolvedSlug),
    [customDomainActive, resolvedSlug]
  )

  useEffect(() => {
    if (customDomainActive && storeSlug) {
      navigate(`${stripStoreSlugPrefix(location.pathname)}${location.search}${location.hash}`, { replace: true })
      return
    }
    if (!normalizedConfiguredSlug || !storeSlug || normalizedRouteSlug === normalizedConfiguredSlug) return
    navigate(`${replaceStoreSlugInPath(location.pathname, normalizedConfiguredSlug)}${location.search}${location.hash}`, { replace: true })
  }, [customDomainActive, location.hash, location.pathname, location.search, navigate, normalizedConfiguredSlug, normalizedRouteSlug, storeSlug])

  return {
    storeSlug: resolvedSlug,
    storeBasePath,
    customDomainActive,
    buildStorePath: (suffix = '') => buildStoreEntryPath({
      slug: resolvedSlug,
      customDomain: configuredDomain,
      currentHost,
      suffix,
    }),
  }
}
