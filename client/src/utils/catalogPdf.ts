import jsPDF from 'jspdf'
import { addLogoToPdf } from './printBranding'
import { resolveUploadedAssetUrl } from './assets'
import { formatMoney } from './currency'

export interface CatalogPdfProduct {
  id: number
  name: string
  productCode?: string
  price: number
  description?: string
  imageUrl?: string
  images?: Array<{ imageUrl?: string | null }>
}

type GenerateCatalogPdfOptions = {
  title: string
  subtitle?: string
  currency: string
  logoUrl?: string
  storeName?: string
  products: CatalogPdfProduct[]
  onProgress?: (progress: number, stage: string) => void
}

const imageCache = new Map<string, string | null>()
const CATALOG_CARD_IMAGE_HEIGHT = 50
const CATALOG_CARD_TITLE_Y = 62
const CATALOG_CARD_PRICE_TOP_OFFSET = 25

export function normalizeCatalogTitleText(value: string) {
  return String(value || '')
    .replace(/\bSITEMA\b/gi, match => (match === match.toUpperCase() ? 'SISTEMA' : 'Sistema'))
}

export function getCatalogProductPrimaryImageUrl(product: CatalogPdfProduct) {
  const firstGalleryImage = Array.isArray(product.images)
    ? product.images.map(item => String(item?.imageUrl || '').trim()).find(Boolean)
    : ''
  const fallback = String(product.imageUrl || '').trim()
  const selected = firstGalleryImage || fallback
  if (!selected) return ''
  if (selected.startsWith('/uploads/') || selected.startsWith('uploads/') || selected.includes('/uploads/')) {
    return resolveUploadedAssetUrl(selected)
  }
  return selected
}

export function filterCatalogProducts(
  products: CatalogPdfProduct[],
  options?: { onlyWithImage?: boolean; selectedIds?: number[] }
) {
  const selectedIdSet = new Set((options?.selectedIds || []).map(id => Number(id)))
  const mustFilterBySelection = selectedIdSet.size > 0

  return (Array.isArray(products) ? products : []).filter(product => {
    const hasImage = Boolean(getCatalogProductPrimaryImageUrl(product))
    if (options?.onlyWithImage && !hasImage) return false
    if (mustFilterBySelection && !selectedIdSet.has(Number(product.id))) return false
    return true
  })
}

export function buildCatalogPdfFileName(title: string) {
  const safeBase = normalizeCatalogTitleText(String(title || 'catalogo-productos'))
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  const datePart = new Date().toISOString().slice(0, 10)
  return `${safeBase || 'catalogo-productos'}-${datePart}.pdf`
}

function truncateText(doc: jsPDF, value: string, maxWidth: number, maxLines: number) {
  if (maxLines <= 0) return []
  const normalized = String(value || '').trim()
  if (!normalized) return ['Sin descripcion disponible']
  const lines = doc.splitTextToSize(normalized, maxWidth) as string[]
  if (lines.length <= maxLines) return lines
  const truncated = lines.slice(0, maxLines)
  const lastLine = truncated[maxLines - 1] || ''
  truncated[maxLines - 1] = `${lastLine.slice(0, Math.max(0, lastLine.length - 3))}...`
  return truncated
}

export function getCatalogCardDescriptionMaxLines(options: {
  cardHeight: number
  titleLineCount: number
  hasCode: boolean
}) {
  const titleY = CATALOG_CARD_TITLE_Y
  const descriptionStartY = titleY + (options.titleLineCount > 1 ? 11 : 6) + (options.hasCode ? 6 : 0)
  const priceTopY = options.cardHeight - CATALOG_CARD_PRICE_TOP_OFFSET
  const bottomPadding = 4
  const lineHeight = 4.2
  const availableHeight = priceTopY - descriptionStartY - bottomPadding
  return Math.max(0, Math.floor(availableHeight / lineHeight))
}

async function loadImageAsDataUrl(url: string) {
  const normalized = String(url || '').trim()
  if (!normalized) return null
  if (imageCache.has(normalized)) return imageCache.get(normalized) ?? null

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
        resolve(canvas.toDataURL('image/jpeg', 0.92))
      } catch {
        resolve(null)
      }
    }
    image.onerror = () => resolve(null)
    image.src = normalized
  })

  imageCache.set(normalized, result)
  return result
}

async function yieldToUi() {
  await new Promise(resolve => window.setTimeout(resolve, 0))
}

function drawCoverPage(doc: jsPDF, options: GenerateCatalogPdfOptions, generatedAt: string) {
  const normalizedTitle = normalizeCatalogTitleText(options.title || 'Catalogo de productos')
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  doc.setFillColor(15, 23, 42)
  doc.rect(0, 0, pageWidth, pageHeight, 'F')
  doc.setFillColor(37, 99, 235)
  doc.roundedRect(14, 24, pageWidth - 28, pageHeight - 48, 10, 10, 'F')
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(22, 36, pageWidth - 44, pageHeight - 72, 8, 8, 'F')

  doc.setTextColor(15, 23, 42)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(26)
  doc.text(normalizedTitle, 30, 68, { maxWidth: pageWidth - 60 })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(12)
  const subtitleLines = doc.splitTextToSize(
    options.subtitle || 'Una seleccion visual pensada para destacar imagen, descripcion y precio de cada producto.',
    pageWidth - 60
  ) as string[]
  doc.text(subtitleLines, 30, 84)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text(options.storeName || 'Tienda DTM', 30, 118)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.text(`Productos incluidos: ${options.products.length}`, 30, 128)
  doc.text(`Generado: ${generatedAt}`, 30, 136)
}

function drawPageHeader(doc: jsPDF, options: GenerateCatalogPdfOptions, pageNumber: number) {
  const normalizedTitle = normalizeCatalogTitleText(options.title || 'Catalogo de productos')
  const pageWidth = doc.internal.pageSize.getWidth()
  doc.setFillColor(15, 23, 42)
  doc.rect(0, 0, pageWidth, 22, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(normalizedTitle, 14, 13)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Pagina ${pageNumber}`, pageWidth - 14, 13, { align: 'right' })
}

async function drawCatalogCard(
  doc: jsPDF,
  product: CatalogPdfProduct,
  x: number,
  y: number,
  width: number,
  height: number,
  currency: string
) {
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(226, 232, 240)
  doc.roundedRect(x, y, width, height, 5, 5, 'FD')

  const imageAreaX = x + 6
  const imageAreaY = y + 6
  const imageAreaW = width - 12
  const imageAreaH = CATALOG_CARD_IMAGE_HEIGHT

  doc.setFillColor(248, 250, 252)
  doc.roundedRect(imageAreaX, imageAreaY, imageAreaW, imageAreaH, 4, 4, 'F')

  const imageUrl = getCatalogProductPrimaryImageUrl(product)
  if (imageUrl) {
    const imageDataUrl = await loadImageAsDataUrl(imageUrl)
    if (imageDataUrl) {
      try {
        const props = doc.getImageProperties(imageDataUrl)
        const sourceWidth = Number(props.width || 1)
        const sourceHeight = Number(props.height || 1)
        const ratio = Math.min(imageAreaW / sourceWidth, imageAreaH / sourceHeight)
        const targetWidth = Math.max(1, sourceWidth * ratio)
        const targetHeight = Math.max(1, sourceHeight * ratio)
        const targetX = imageAreaX + ((imageAreaW - targetWidth) / 2)
        const targetY = imageAreaY + ((imageAreaH - targetHeight) / 2)
        const format = imageDataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG'
        doc.addImage(imageDataUrl, format, targetX, targetY, targetWidth, targetHeight)
      } catch {
        // Si falla el render de una imagen puntual, dejamos el contenedor limpio.
      }
    }
  } else {
    doc.setTextColor(100, 116, 139)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text('Sin imagen', imageAreaX + (imageAreaW / 2), imageAreaY + (imageAreaH / 2), { align: 'center' })
  }

  const contentX = x + 7
  const titleY = y + CATALOG_CARD_TITLE_Y
  doc.setTextColor(15, 23, 42)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  const titleLines = doc.splitTextToSize(String(product.name || 'Producto'), width - 14) as string[]
  const displayedTitleLines = titleLines.slice(0, 2)
  doc.text(displayedTitleLines, contentX, titleY)

  const descY = titleY + (displayedTitleLines.length > 1 ? 11 : 6)
  const code = String(product.productCode || '').trim()
  if (code) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(37, 99, 235)
    doc.text(`Codigo: ${code}`, contentX, descY)
  }
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(71, 85, 105)
  const maxDescriptionLines = Math.min(5, getCatalogCardDescriptionMaxLines({
    cardHeight: height,
    titleLineCount: displayedTitleLines.length,
    hasCode: Boolean(code),
  }))
  const descriptionLines = truncateText(doc, String(product.description || ''), width - 14, maxDescriptionLines)
  if (descriptionLines.length > 0) {
    doc.text(descriptionLines, contentX, descY + (code ? 6 : 0))
  }

  const priceY = y + height - 18
  doc.setFillColor(15, 118, 110)
  doc.roundedRect(x + 7, priceY - 7, width - 14, 12, 3, 3, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text(`Precio: ${formatMoney(Number(product.price || 0), currency)}`, x + (width / 2), priceY + 0.8, { align: 'center' })
}

export async function generateProductCatalogPdf(options: GenerateCatalogPdfOptions) {
  options.onProgress?.(5, 'Preparando documento...')
  await yieldToUi()
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const generatedAt = new Date().toLocaleString()
  const safeProducts = Array.isArray(options.products) ? options.products : []
  if (safeProducts.length === 0) {
    throw new Error('No existen productos que coincidan con los filtros seleccionados.')
  }

  drawCoverPage(doc, { ...options, products: safeProducts }, generatedAt)
  options.onProgress?.(12, 'Creando portada...')
  await yieldToUi()
  await addLogoToPdf(doc, options.logoUrl, { x: 152, y: 46, maxWidth: 34, maxHeight: 26 })
  options.onProgress?.(18, 'Aplicando identidad visual...')
  await yieldToUi()

  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 14
  const gap = 8
  const cardWidth = (pageWidth - (margin * 2) - gap) / 2
  const cardHeight = 116
  const startY = 30
  const cardsPerPage = 4
  const totalProducts = Math.max(1, safeProducts.length)

  for (let index = 0; index < safeProducts.length; index += 1) {
    if (index % cardsPerPage === 0) {
      doc.addPage()
      drawPageHeader(doc, options, Math.floor(index / cardsPerPage) + 2)
      await addLogoToPdf(doc, options.logoUrl, { x: pageWidth - 36, y: 4, maxWidth: 18, maxHeight: 12 })
      options.onProgress?.(
        Math.min(92, 18 + Math.round((index / totalProducts) * 70)),
        `Maquetando pagina ${Math.floor(index / cardsPerPage) + 2}...`
      )
      await yieldToUi()
    }

    const positionInPage = index % cardsPerPage
    const row = Math.floor(positionInPage / 2)
    const col = positionInPage % 2
    const x = margin + (col * (cardWidth + gap))
    const y = startY + (row * (cardHeight + 10))

    await drawCatalogCard(doc, safeProducts[index], x, y, cardWidth, cardHeight, options.currency)
    options.onProgress?.(
      Math.min(96, 22 + Math.round(((index + 1) / totalProducts) * 70)),
      `Renderizando producto ${index + 1} de ${safeProducts.length}...`
    )
    await yieldToUi()
  }

  options.onProgress?.(98, 'Empaquetando archivo PDF...')
  await yieldToUi()
  doc.save(buildCatalogPdfFileName(options.title))
  options.onProgress?.(100, 'PDF generado correctamente.')
}
