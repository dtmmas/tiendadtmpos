import jsPDF from 'jspdf'

const logoCache = new Map<string, string | null>()
const PLACEHOLDER_LOGO_PATTERN = /placehold\.co\/64x64\?text=LOGO/i

function isPrintableLogoUrl(logoUrl?: string) {
  const normalized = String(logoUrl || '').trim()
  return Boolean(normalized) && !PLACEHOLDER_LOGO_PATTERN.test(normalized)
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

async function loadImageAsDataUrl(logoUrl: string): Promise<string | null> {
  if (logoCache.has(logoUrl)) {
    return logoCache.get(logoUrl) ?? null
  }

  const result = await new Promise<string | null>(resolve => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth || image.width || 1
        canvas.height = image.naturalHeight || image.height || 1
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(null)
          return
        }
        ctx.drawImage(image, 0, 0)
        resolve(canvas.toDataURL('image/png'))
      } catch {
        resolve(null)
      }
    }
    image.onerror = () => resolve(null)
    image.src = logoUrl
  })

  logoCache.set(logoUrl, result)
  return result
}

export function buildPrintLogoHtml(
  logoUrl?: string,
  alt = 'Logo empresa',
  options?: {
    maxWidth?: number
    maxHeight?: number
    marginBottom?: number
    align?: 'left' | 'center' | 'right'
  }
) {
  if (!isPrintableLogoUrl(logoUrl)) return ''

  const maxWidth = options?.maxWidth ?? 140
  const maxHeight = options?.maxHeight ?? 60
  const marginBottom = options?.marginBottom ?? 10
  const align = options?.align ?? 'center'

  return `
    <div style="display:flex; justify-content:${align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center'}; margin-bottom:${marginBottom}px;">
      <img
        src="${escapeHtmlAttribute(String(logoUrl || ''))}"
        alt="${escapeHtmlAttribute(alt)}"
        style="display:block; max-width:${maxWidth}px; max-height:${maxHeight}px; width:auto; height:auto; object-fit:contain;"
        onerror="this.style.display='none'; if (this.parentElement) this.parentElement.style.display='none';"
      />
    </div>
  `
}

export async function addLogoToPdf(
  doc: jsPDF,
  logoUrl?: string,
  options?: {
    x?: number
    y?: number
    maxWidth?: number
    maxHeight?: number
  }
) {
  if (!isPrintableLogoUrl(logoUrl)) return 0

  const dataUrl = await loadImageAsDataUrl(String(logoUrl))
  if (!dataUrl) return 0

  try {
    const props = doc.getImageProperties(dataUrl)
    const originalWidth = Number(props.width || 1)
    const originalHeight = Number(props.height || 1)
    const maxWidth = options?.maxWidth ?? 30
    const maxHeight = options?.maxHeight ?? 20
    const ratio = Math.min(maxWidth / originalWidth, maxHeight / originalHeight)
    const width = Math.max(1, originalWidth * ratio)
    const height = Math.max(1, originalHeight * ratio)
    const format = dataUrl.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG'

    doc.addImage(dataUrl, format, options?.x ?? 14, options?.y ?? 8, width, height)
    return height
  } catch {
    return 0
  }
}
