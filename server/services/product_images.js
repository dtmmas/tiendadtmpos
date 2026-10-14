export const PRODUCT_IMAGE_LIMIT = 10
export const PRODUCT_IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024
export const PRODUCT_IMAGE_ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
export const PRODUCT_IMAGE_ALLOWED_EXTENSIONS = /\.(jpe?g|png|webp)$/i

function normalizeImageUrl(value) {
  const trimmed = String(value || '').trim()
  return trimmed || null
}

export function isSupportedProductImageFile(file) {
  const mimeType = String(file?.mimetype || '').trim().toLowerCase()
  const originalName = String(file?.originalname || '').trim().toLowerCase()
  return PRODUCT_IMAGE_ALLOWED_MIME_TYPES.has(mimeType) || PRODUCT_IMAGE_ALLOWED_EXTENSIONS.test(originalName)
}

export function productImageFileFilter(req, file, cb) {
  if (!isSupportedProductImageFile(file)) {
    const error = new Error('Solo se permiten imagenes JPG, PNG o WebP.')
    error.code = 'PRODUCT_IMAGE_INVALID_TYPE'
    cb(error)
    return
  }
  cb(null, true)
}

export async function ensureProductImagesTable(executor) {
  await executor.query(`CREATE TABLE IF NOT EXISTS product_images (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    image_url VARCHAR(255) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_primary TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_product_images_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    KEY idx_product_images_product_sort (product_id, sort_order),
    KEY idx_product_images_primary (product_id, is_primary)
  )`)
}

export async function getProductImages(executor, productId) {
  await ensureProductImagesTable(executor)
  const [rows] = await executor.query(
    `SELECT id, product_id AS productId, image_url AS imageUrl, sort_order AS sortOrder, is_primary AS isPrimary
     FROM product_images
     WHERE product_id = ?
     ORDER BY sort_order ASC, id ASC`,
    [productId]
  )
  return (rows || []).map(row => ({
    id: Number(row.id),
    productId: Number(row.productId),
    imageUrl: row.imageUrl,
    sortOrder: Number(row.sortOrder || 0),
    isPrimary: Boolean(Number(row.isPrimary || 0)),
  }))
}

export async function ensureLegacyProductImageRecord(executor, productId, imageUrl) {
  const normalizedImageUrl = normalizeImageUrl(imageUrl)
  if (!normalizedImageUrl) return

  await ensureProductImagesTable(executor)
  const [rows] = await executor.query(
    'SELECT id FROM product_images WHERE product_id = ? LIMIT 1',
    [productId]
  )
  if (Array.isArray(rows) && rows.length > 0) return

  await executor.query(
    `INSERT INTO product_images (product_id, image_url, sort_order, is_primary)
     VALUES (?, ?, 0, 1)`,
    [productId, normalizedImageUrl]
  )
}

export function parseProductImagesInstructions(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { value: null, error: null }
  }

  const source = typeof raw === 'string' ? raw : JSON.stringify(raw)

  try {
    const parsed = JSON.parse(source)
    if (!Array.isArray(parsed)) {
      return { value: null, error: 'La galeria de imagenes debe enviarse como un arreglo JSON.' }
    }
    return { value: parsed, error: null }
  } catch (error) {
    return { value: null, error: `La galeria de imagenes contiene JSON invalido: ${error?.message || 'error de parseo'}` }
  }
}

export function validateProductImagesInstructions(instructions, uploadedFiles, existingImages = []) {
  if (instructions === null) return null
  if (!Array.isArray(instructions)) return 'La galeria de imagenes debe enviarse como un arreglo.'
  if (instructions.length > PRODUCT_IMAGE_LIMIT) {
    return `Solo puedes guardar hasta ${PRODUCT_IMAGE_LIMIT} imagenes por producto.`
  }

  const existingIds = new Set(existingImages.map(item => Number(item.id || 0)).filter(Boolean))
  const existingUrls = new Set(existingImages.map(item => normalizeImageUrl(item.imageUrl)).filter(Boolean))
  const usedExistingIds = new Set()
  const usedLegacyUrls = new Set()
  const usedUploadIndexes = new Set()

  for (let index = 0; index < instructions.length; index += 1) {
    const item = instructions[index]
    const hasExistingId = Number.isInteger(Number(item?.id)) && Number(item?.id) > 0
    const hasUploadIndex = Number.isInteger(Number(item?.uploadIndex)) && Number(item?.uploadIndex) >= 0
    const legacyImageUrl = normalizeImageUrl(item?.legacyImageUrl)

    if (!hasExistingId && !hasUploadIndex && !legacyImageUrl) {
      return `La imagen ${index + 1} no indica si conserva una imagen existente o una nueva subida.`
    }

    if (hasExistingId) {
      const existingId = Number(item.id)
      if (!existingIds.has(existingId)) {
        return `La imagen existente ${existingId} ya no está disponible para este producto.`
      }
      if (usedExistingIds.has(existingId)) {
        return 'No puedes repetir la misma imagen existente dentro de la galeria.'
      }
      usedExistingIds.add(existingId)
    }

    if (hasUploadIndex) {
      const uploadIndex = Number(item.uploadIndex)
      if (uploadIndex < 0 || uploadIndex >= uploadedFiles.length) {
        return `La referencia de carga ${uploadIndex} no existe dentro de los archivos enviados.`
      }
      if (usedUploadIndexes.has(uploadIndex)) {
        return 'No puedes reutilizar el mismo archivo nuevo en varias posiciones de la galeria.'
      }
      usedUploadIndexes.add(uploadIndex)
    }

    if (legacyImageUrl) {
      if (!existingUrls.has(legacyImageUrl)) {
        return `La imagen existente ${legacyImageUrl} ya no está disponible para este producto.`
      }
      if (usedLegacyUrls.has(legacyImageUrl)) {
        return 'No puedes repetir la misma imagen existente dentro de la galeria.'
      }
      usedLegacyUrls.add(legacyImageUrl)
    }
  }

  return null
}

function buildFallbackInstructions(existingImages, uploadedFiles) {
  if (uploadedFiles.length === 0) {
    return existingImages.map(item => ({ id: item.id }))
  }

  if (existingImages.length > 0 && uploadedFiles.length === 1) {
    return [
      { uploadIndex: 0 },
      ...existingImages.slice(1).map(item => ({ id: item.id })),
    ].slice(0, PRODUCT_IMAGE_LIMIT)
  }

  return uploadedFiles.slice(0, PRODUCT_IMAGE_LIMIT).map((_, index) => ({ uploadIndex: index }))
}

export async function replaceProductImages({
  executor,
  productId,
  currentImageUrl = null,
  instructions = null,
  uploadedFiles = [],
}) {
  await ensureProductImagesTable(executor)
  await ensureLegacyProductImageRecord(executor, productId, currentImageUrl)

  const existingImages = await getProductImages(executor, productId)
  const effectiveInstructions = instructions ?? buildFallbackInstructions(existingImages, uploadedFiles)
  const validationError = validateProductImagesInstructions(effectiveInstructions, uploadedFiles, existingImages)
  if (validationError) {
    return { error: validationError }
  }

  const existingById = new Map(existingImages.map(item => [Number(item.id), item]))
  const uploadedUrls = uploadedFiles.map(file => `/uploads/${file.filename}`)
  const finalUrls = effectiveInstructions
    .map(item => {
      if (Number.isInteger(Number(item?.id)) && Number(item?.id) > 0) {
        return normalizeImageUrl(existingById.get(Number(item.id))?.imageUrl)
      }
      if (normalizeImageUrl(item?.legacyImageUrl)) {
        return normalizeImageUrl(item.legacyImageUrl)
      }
      if (Number.isInteger(Number(item?.uploadIndex)) && Number(item?.uploadIndex) >= 0) {
        return normalizeImageUrl(uploadedUrls[Number(item.uploadIndex)])
      }
      return null
    })
    .filter(Boolean)

  if (finalUrls.length > PRODUCT_IMAGE_LIMIT) {
    return { error: `Solo puedes guardar hasta ${PRODUCT_IMAGE_LIMIT} imagenes por producto.` }
  }

  await executor.query('DELETE FROM product_images WHERE product_id = ?', [productId])

  for (let index = 0; index < finalUrls.length; index += 1) {
    await executor.query(
      `INSERT INTO product_images (product_id, image_url, sort_order, is_primary)
       VALUES (?, ?, ?, ?)`,
      [productId, finalUrls[index], index, index === 0 ? 1 : 0]
    )
  }

  const images = await getProductImages(executor, productId)
  return {
    primaryImageUrl: images[0]?.imageUrl || null,
    images,
  }
}
