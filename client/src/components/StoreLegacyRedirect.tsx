import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { buildStorePublicPath, DEFAULT_STORE_PUBLIC_SLUG, normalizeStorePublicSlug } from '../utils/storePublicLink'

type Props = {
  suffix?: string
}

export default function StoreLegacyRedirect({ suffix = '' }: Props) {
  const [targetSlug, setTargetSlug] = useState<string | null>(null)
  const params = useParams()

  const resolvedSuffix = Object.entries(params).reduce((currentValue, [key, value]) => {
    return currentValue.replace(`:${key}`, encodeURIComponent(String(value || '')))
  }, suffix)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await api.get('/store/settings')
        if (!cancelled) setTargetSlug(normalizeStorePublicSlug(data?.publicSlug || DEFAULT_STORE_PUBLIC_SLUG))
      } catch {
        if (!cancelled) setTargetSlug(DEFAULT_STORE_PUBLIC_SLUG)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (!targetSlug) return null

  return <Navigate to={buildStorePublicPath(targetSlug, resolvedSuffix)} replace />
}
