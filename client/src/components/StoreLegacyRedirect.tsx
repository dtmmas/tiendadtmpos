import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { buildStoreEntryUrl, buildStorePublicPath, DEFAULT_STORE_PUBLIC_SLUG, normalizeStoreCustomDomain, normalizeStorePublicSlug } from '../utils/storePublicLink'

type Props = {
  suffix?: string
}

export default function StoreLegacyRedirect({ suffix = '' }: Props) {
  const [targetSlug, setTargetSlug] = useState<string | null>(null)
  const [targetDomain, setTargetDomain] = useState<string>('')
  const params = useParams()

  const resolvedSuffix = Object.entries(params).reduce((currentValue, [key, value]) => {
    return currentValue.replace(`:${key}`, encodeURIComponent(String(value || '')))
  }, suffix)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await api.get('/store/settings')
        if (!cancelled) {
          setTargetSlug(normalizeStorePublicSlug(data?.publicSlug || DEFAULT_STORE_PUBLIC_SLUG))
          setTargetDomain(normalizeStoreCustomDomain(data?.customDomain || ''))
        }
      } catch {
        if (!cancelled) setTargetSlug(DEFAULT_STORE_PUBLIC_SLUG)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!targetSlug || !targetDomain || typeof window === 'undefined') return
    window.location.replace(buildStoreEntryUrl({
      slug: targetSlug,
      customDomain: targetDomain,
      suffix: resolvedSuffix,
    }))
  }, [resolvedSuffix, targetDomain, targetSlug])

  if (!targetSlug) return null

  if (targetDomain) return null

  return <Navigate to={buildStorePublicPath(targetSlug, resolvedSuffix)} replace />
}
