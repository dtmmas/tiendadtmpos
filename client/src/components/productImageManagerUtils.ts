export const PRODUCT_IMAGE_LIMIT = 10
export const PRODUCT_IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024
export const PRODUCT_IMAGE_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const PRODUCT_IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp'

export interface ProductImageRecord {
  id?: number
  imageUrl?: string | null
  sortOrder?: number
  isPrimary?: boolean
}

export interface ProductImageDraft {
  id?: number
  file?: File | null
  imageUrl?: string | null
  previewUrl: string
  fileName: string
  isExisting: boolean
}

export function formatProductImageSize(bytes: number) {
  const sizeInMb = bytes / (1024 * 1024)
  return `${sizeInMb.toFixed(sizeInMb >= 10 ? 0 : 1)} MB`
}

export function isValidProductImageFile(file: File) {
  const type = String(file?.type || '').toLowerCase()
  const name = String(file?.name || '').toLowerCase()
  return PRODUCT_IMAGE_ALLOWED_TYPES.includes(type as typeof PRODUCT_IMAGE_ALLOWED_TYPES[number])
    || /\.(jpe?g|png|webp)$/i.test(name)
}

export function validateProductImageFiles(files: File[], nextTotalCount: number) {
  const errors: string[] = []

  if (nextTotalCount > PRODUCT_IMAGE_LIMIT) {
    errors.push(`Solo puedes cargar hasta ${PRODUCT_IMAGE_LIMIT} fotografias por producto.`)
  }

  files.forEach(file => {
    if (!isValidProductImageFile(file)) {
      errors.push(`"${file.name}" no es compatible. Solo se permiten JPG, PNG o WebP.`)
    }
    if (Number(file.size || 0) > PRODUCT_IMAGE_MAX_SIZE_BYTES) {
      errors.push(`"${file.name}" supera el limite de 5 MB por imagen.`)
    }
  })

  return [...new Set(errors)]
}

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error(`No se pudo leer la imagen ${file.name}.`))
    reader.readAsDataURL(file)
  })
}

export async function createProductImageDraft(file: File) {
  return {
    file,
    imageUrl: null,
    previewUrl: await readFileAsDataUrl(file),
    fileName: file.name,
    isExisting: false,
  } satisfies ProductImageDraft
}

export async function createProductImageDrafts(files: File[]) {
  return Promise.all(files.map(file => createProductImageDraft(file)))
}

export function createExistingProductImageDraft(image: ProductImageRecord): ProductImageDraft | null {
  const imageUrl = String(image?.imageUrl || '').trim()
  if (!imageUrl) return null
  return {
    id: image.id,
    file: null,
    imageUrl,
    previewUrl: imageUrl,
    fileName: imageUrl.split('/').pop() || 'imagen',
    isExisting: true,
  }
}

export function buildProductImagesUploadPayload(images: ProductImageDraft[]) {
  const newFiles: File[] = []
  const productImages = images.map(image => {
    if (image.isExisting && image.id) {
      return { id: image.id }
    }
    if (image.isExisting && image.imageUrl) {
      return { legacyImageUrl: image.imageUrl }
    }

    const uploadIndex = newFiles.length
    if (image.file) newFiles.push(image.file)
    return { uploadIndex }
  })

  return {
    productImages,
    newFiles,
  }
}
