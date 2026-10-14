import { useEffect, useMemo } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { buildStorePublicBasePath, buildStorePublicPath, normalizeStorePublicSlug, replaceStoreSlugInPath } from '../utils/storePublicLink'

export function useStorePublicRouting(configuredSlug?: string | null) {
  const { storeSlug } = useParams()
  const location = useLocation()
  const navigate = useNavigate()

  const normalizedRouteSlug = useMemo(() => normalizeStorePublicSlug(storeSlug), [storeSlug])
  const normalizedConfiguredSlug = useMemo(
    () => configuredSlug ? normalizeStorePublicSlug(configuredSlug) : '',
    [configuredSlug]
  )
  const resolvedSlug = normalizedConfiguredSlug || normalizedRouteSlug
  const storeBasePath = useMemo(() => buildStorePublicBasePath(resolvedSlug), [resolvedSlug])

  useEffect(() => {
    if (!normalizedConfiguredSlug || !storeSlug || normalizedRouteSlug === normalizedConfiguredSlug) return
    navigate(`${replaceStoreSlugInPath(location.pathname, normalizedConfiguredSlug)}${location.search}${location.hash}`, { replace: true })
  }, [location.hash, location.pathname, location.search, navigate, normalizedConfiguredSlug, normalizedRouteSlug, storeSlug])

  return {
    storeSlug: resolvedSlug,
    storeBasePath,
    buildStorePath: (suffix = '') => buildStorePublicPath(resolvedSlug, suffix),
  }
}

