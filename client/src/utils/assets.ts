export function resolveUploadedAssetUrl(value?: string | null) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''

  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:')
  ) {
    return trimmed
  }

  if (trimmed.startsWith('/uploads/')) return trimmed
  if (trimmed.startsWith('uploads/')) return `/${trimmed}`

  const uploadsIndex = trimmed.indexOf('/uploads/')
  if (uploadsIndex >= 0) return trimmed.slice(uploadsIndex)

  return `/uploads/${trimmed.replace(/^\/+/, '')}`
}
