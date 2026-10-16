import express from 'express'
import multer from 'multer'
import fs from 'fs/promises'
import * as XLSX from 'xlsx'
import { authMiddleware, canAccessWarehouse, getUserWarehouseId, isAdminUser, roleMiddleware } from '../auth.js'
import { getPool } from '../db.js'
import { registerMovement } from '../services/inventory.js'
import { uploadsDir } from '../paths.js'
import {
  PRODUCT_IMAGE_LIMIT,
  PRODUCT_IMAGE_MAX_SIZE_BYTES,
  ensureLegacyProductImageRecord,
  ensureProductImagesTable,
  getProductImages,
  parseProductImagesInstructions,
  productImageFileFilter,
  replaceProductImages,
  validateProductImagesInstructions,
} from '../services/product_images.js'

const XLSXApi = XLSX?.readFile && XLSX?.utils ? XLSX : (XLSX?.default || XLSX)

const router = express.Router()
const upload = multer({ dest: uploadsDir })
const productImageUpload = multer({
  dest: uploadsDir,
  limits: {
    fileSize: PRODUCT_IMAGE_MAX_SIZE_BYTES,
    files: PRODUCT_IMAGE_LIMIT,
  },
  fileFilter: productImageFileFilter,
})

function productImagesUploadMiddleware(req, res, next) {
  const middleware = productImageUpload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'images', maxCount: PRODUCT_IMAGE_LIMIT },
  ])

  middleware(req, res, (error) => {
    if (!error) {
      next()
      return
    }

    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        res.status(400).json({ error: 'Cada imagen debe pesar como maximo 5 MB.' })
        return
      }
      if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
        res.status(400).json({ error: `Solo puedes cargar hasta ${PRODUCT_IMAGE_LIMIT} imagenes por producto.` })
        return
      }
    }

    if (error?.code === 'PRODUCT_IMAGE_INVALID_TYPE') {
      res.status(400).json({ error: error.message || 'Solo se permiten imagenes JPG, PNG o WebP.' })
      return
    }

    next(error)
  })
}

function collectUploadedProductImageFiles(req) {
  const singleImage = Array.isArray(req.files?.image) ? req.files.image : []
  const galleryImages = Array.isArray(req.files?.images) ? req.files.images : []
  return [...singleImage, ...galleryImages]
}

async function getProductImagesMap(executor, productIds = []) {
  const normalizedIds = [...new Set(productIds.map(id => Number(id || 0)).filter(Boolean))]
  if (normalizedIds.length === 0) return new Map()

  const placeholders = normalizedIds.map(() => '?').join(', ')
  const [rows] = await executor.query(
    `SELECT id, product_id AS productId, image_url AS imageUrl, sort_order AS sortOrder, is_primary AS isPrimary
     FROM product_images
     WHERE product_id IN (${placeholders})
     ORDER BY product_id ASC, sort_order ASC, id ASC`,
    normalizedIds
  )

  const imageMap = new Map()
  for (const row of rows || []) {
    const productId = Number(row.productId || 0)
    if (!imageMap.has(productId)) imageMap.set(productId, [])
    imageMap.get(productId).push({
      id: Number(row.id),
      productId,
      imageUrl: row.imageUrl,
      sortOrder: Number(row.sortOrder || 0),
      isPrimary: Boolean(Number(row.isPrimary || 0)),
    })
  }

  return imageMap
}

// Ensure warehouse stock table and default warehouse id=1
async function ensureWarehouseStockTable(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS product_warehouse_stock (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    warehouse_id INT NOT NULL,
    quantity INT NOT NULL DEFAULT 0,
    UNIQUE KEY uniq_product_warehouse (product_id, warehouse_id),
    CONSTRAINT fk_pws_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    CONSTRAINT fk_pws_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE
  )`)
}

async function ensureStoreBannerColumn(pool) {
  const [rows] = await pool.query(
    `SELECT 1
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'products'
       AND COLUMN_NAME = 'store_banner_principal'
     LIMIT 1`
  )
  if (Array.isArray(rows) && rows.length > 0) return
  await pool.query('ALTER TABLE products ADD COLUMN store_banner_principal TINYINT(1) NOT NULL DEFAULT 0 AFTER image_url')
}

async function ensureTrackingColumns(pool) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'products'
       AND COLUMN_NAME IN ('tracking_profile', 'tracking_meta')`
  )

  const existing = new Set((rows || []).map(row => String(row.COLUMN_NAME || '').toLowerCase()))
  if (!existing.has('tracking_profile')) {
    await pool.query('ALTER TABLE products ADD COLUMN tracking_profile VARCHAR(20) NULL AFTER shelf_location')
  }
  if (!existing.has('tracking_meta')) {
    await pool.query('ALTER TABLE products ADD COLUMN tracking_meta TEXT NULL AFTER tracking_profile')
  }
}

async function ensureSerializedVariantStructures(pool) {
  const [variantCols] = await pool.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'product_variants'
       AND COLUMN_NAME IN ('color', 'ram', 'storage', 'carrier', 'sim_type', 'identifier_mode', 'variant_meta', 'sort_order')`
  )

  const existingVariantCols = new Set((variantCols || []).map(row => String(row.COLUMN_NAME || '').toLowerCase()))

  await pool.query(`CREATE TABLE IF NOT EXISTS product_variants (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    name VARCHAR(160) NOT NULL,
    sku VARCHAR(80) UNIQUE,
    color VARCHAR(60) NULL,
    ram VARCHAR(60) NULL,
    storage VARCHAR(60) NULL,
    carrier VARCHAR(60) NULL,
    sim_type VARCHAR(60) NULL,
    identifier_mode VARCHAR(20) NOT NULL DEFAULT 'IMEI',
    variant_meta TEXT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    stock INT NOT NULL DEFAULT 0,
    price DECIMAL(12,2) NOT NULL DEFAULT 0,
    cost DECIMAL(12,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
  )`)

  if (!existingVariantCols.has('color')) {
    await pool.query('ALTER TABLE product_variants ADD COLUMN color VARCHAR(60) NULL AFTER sku')
  }
  if (!existingVariantCols.has('ram')) {
    await pool.query('ALTER TABLE product_variants ADD COLUMN ram VARCHAR(60) NULL AFTER color')
  }
  if (!existingVariantCols.has('storage')) {
    await pool.query('ALTER TABLE product_variants ADD COLUMN storage VARCHAR(60) NULL AFTER ram')
  }
  if (!existingVariantCols.has('carrier')) {
    await pool.query('ALTER TABLE product_variants ADD COLUMN carrier VARCHAR(60) NULL AFTER storage')
  }
  if (!existingVariantCols.has('sim_type')) {
    await pool.query('ALTER TABLE product_variants ADD COLUMN sim_type VARCHAR(60) NULL AFTER carrier')
  }
  if (!existingVariantCols.has('identifier_mode')) {
    await pool.query(`ALTER TABLE product_variants ADD COLUMN identifier_mode VARCHAR(20) NOT NULL DEFAULT 'IMEI' AFTER sim_type`)
  }
  if (!existingVariantCols.has('variant_meta')) {
    await pool.query('ALTER TABLE product_variants ADD COLUMN variant_meta TEXT NULL AFTER identifier_mode')
  }
  if (!existingVariantCols.has('sort_order')) {
    await pool.query('ALTER TABLE product_variants ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER variant_meta')
  }

  await pool.query(`CREATE TABLE IF NOT EXISTS product_variant_units (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    variant_id INT NOT NULL,
    imei VARCHAR(50) NULL,
    serial_no VARCHAR(100) NULL,
    warehouse_id INT NOT NULL DEFAULT 1,
    status VARCHAR(16) NOT NULL DEFAULT 'AVAILABLE',
    unit_meta TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_variant_units_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    CONSTRAINT fk_variant_units_variant FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE,
    CONSTRAINT fk_variant_units_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
    UNIQUE KEY uniq_variant_unit_imei (imei),
    UNIQUE KEY uniq_variant_unit_serial (serial_no)
  )`)
}

async function ensureDefaultWarehouseId1(pool) {
  // Create warehouses table if missing
  await pool.query(`CREATE TABLE IF NOT EXISTS warehouses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL UNIQUE
  )`)
  // Ensure a warehouse with id=1 exists
  const [rows] = await pool.query('SELECT id FROM warehouses WHERE id = 1 LIMIT 1')
  if (!Array.isArray(rows) || rows.length === 0) {
    // Try to insert with explicit id=1; if duplicate on name, adjust
    try {
      await pool.query('INSERT INTO warehouses (id, name) VALUES (1, ?)', ['PRINCIPAL'])
    } catch (err) {
      // If explicit id insert fails due to constraints, create a row and then set id if needed
      await pool.query('INSERT INTO warehouses (name) VALUES (?)', ['PRINCIPAL'])
    }
  }
}

// Helpers para parsear JSON de FormData y sumar cantidades
function hasNum(v) {
  return v !== null && v !== undefined && !Number.isNaN(Number(v)) && String(v).trim() !== ''
}
function parseJsonArrayField(body, key) {
  const raw = body?.[key]
  if (!raw || typeof raw !== 'string') return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}
function parseJsonArrayFieldDetailed(body, key) {
  const raw = body?.[key]
  if (raw === undefined || raw === null || raw === '') return { value: [], raw, error: null }
  if (Array.isArray(raw)) return { value: raw, raw, error: null }
  if (typeof raw !== 'string') {
    return { value: [], raw, error: `El campo ${key} debe enviarse como un JSON de arreglo.` }
  }
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) {
      return { value: [], raw, error: `El campo ${key} debe ser un arreglo JSON válido.` }
    }
    return { value: arr, raw, error: null }
  } catch (error) {
    return { value: [], raw, error: `JSON inválido en ${key}: ${error?.message || 'error de parseo'}` }
  }
}
function parseJsonObjectField(body, key) {
  const raw = body?.[key]
  if (!raw || typeof raw !== 'string') return null
  try {
    const obj = JSON.parse(raw)
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null
  } catch {
    return null
  }
}
function sumQuantity(arr, quantityKey = 'quantity') {
  return arr.reduce((acc, v) => acc + Number(v?.[quantityKey] || 0), 0)
}

const TRACKING_PROFILES = new Set(['GENERAL', 'ALIMENTO', 'MEDICAMENTO', 'COSMETICO', 'QUIMICO'])
const ENABLED_PRODUCT_TYPES = new Set(['GENERAL', 'MEDICINAL', 'IMEI', 'SERIAL', 'VARIANT_SERIALIZED'])
const VARIANT_IDENTIFIER_MODES = new Set(['IMEI', 'SERIAL'])
const SERIALIZED_DEVICE_CATEGORIES = new Set(['PHONE_IMEI', 'DEVICE_SERIAL'])
const TRACKING_META_KEYS = [
  'storageNotes',
  'presentation',
  'activeIngredient',
  'concentration',
  'dosageForm',
  'sanitaryRegistry',
  'packageType',
  'originInfo',
  'regulatoryNotes',
  'serializedDeviceProfile',
]
const VARIANT_META_KEYS = ['deviceCategory', 'notes', 'modelCode']
const VARIANT_UNIT_META_KEYS = ['supplierName', 'purchaseReference', 'notes']

function normalizeTrackingProfile(value, productType) {
  if (String(productType || 'GENERAL').toUpperCase() !== 'MEDICINAL') return null
  const normalized = String(value || '').trim().toUpperCase()
  if (!normalized) return 'GENERAL'
  return TRACKING_PROFILES.has(normalized) ? normalized : 'GENERAL'
}

function sanitizeTrackingMeta(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const sanitized = TRACKING_META_KEYS.reduce((acc, key) => {
    const value = readCaseInsensitiveValue(raw, [key])
    if (value === undefined || value === null) return acc
    if (key === 'serializedDeviceProfile') {
      const normalizedDeviceCategory = normalizeSerializedDeviceCategory(value)
      if (normalizedDeviceCategory) acc[key] = normalizedDeviceCategory
      return acc
    }
    const normalized = String(value).trim()
    if (normalized) acc[key] = normalized
    return acc
  }, {})

  return Object.keys(sanitized).length > 0 ? sanitized : null
}

function sanitizeVariantMeta(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const sanitized = VARIANT_META_KEYS.reduce((acc, key) => {
    const value = readCaseInsensitiveValue(raw, [key])
    if (value === undefined || value === null) return acc
    if (key === 'deviceCategory') {
      const normalizedDeviceCategory = normalizeSerializedDeviceCategory(value)
      if (normalizedDeviceCategory) acc[key] = normalizedDeviceCategory
      return acc
    }
    const normalized = String(value).trim()
    if (normalized) acc[key] = normalized
    return acc
  }, {})
  return Object.keys(sanitized).length > 0 ? sanitized : null
}

function sanitizeVariantUnitMeta(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const sanitized = VARIANT_UNIT_META_KEYS.reduce((acc, key) => {
    const value = raw?.[key]
    if (value === undefined || value === null) return acc
    const normalized = String(value).trim()
    if (normalized) acc[key] = normalized
    return acc
  }, {})
  return Object.keys(sanitized).length > 0 ? sanitized : null
}

function normalizeVariantIdentifierMode(value) {
  const normalized = String(value || '').trim().toUpperCase()
  return VARIANT_IDENTIFIER_MODES.has(normalized) ? normalized : 'IMEI'
}

function normalizeSerializedDeviceCategory(value) {
  const normalized = String(value || '').trim().toUpperCase()
  return SERIALIZED_DEVICE_CATEGORIES.has(normalized) ? normalized : null
}

function buildVariantName(rawVariant) {
  const explicitName = String(readCaseInsensitiveValue(rawVariant, ['name']) || '').trim()
  if (explicitName) return explicitName

  const parts = [
    readCaseInsensitiveValue(rawVariant, ['color']),
    readCaseInsensitiveValue(rawVariant, ['ram']),
    readCaseInsensitiveValue(rawVariant, ['storage']),
    readCaseInsensitiveValue(rawVariant, ['carrier']),
    readCaseInsensitiveValue(rawVariant, ['simType', 'sim_type']),
  ]
    .map(value => String(value || '').trim())
    .filter(Boolean)

  return parts.length > 0 ? parts.join(' / ') : 'Variante'
}

function readCaseInsensitiveValue(source, keys) {
  if (!source || typeof source !== 'object') return undefined
  const keyList = Array.isArray(keys) ? keys : [keys]
  const entries = Object.entries(source)
  for (const key of keyList) {
    if (Object.prototype.hasOwnProperty.call(source, key)) return source[key]
    const matchedEntry = entries.find(([entryKey]) => String(entryKey || '').toUpperCase() === String(key || '').toUpperCase())
    if (matchedEntry) return matchedEntry[1]
  }
  return undefined
}

function normalizeSerializedVariants(rawVariants) {
  if (!Array.isArray(rawVariants)) return []

  return rawVariants
    .map((variant, index) => {
      const identifierMode = normalizeVariantIdentifierMode(readCaseInsensitiveValue(variant, ['identifierMode', 'identifier_mode']))
      const variantMeta = sanitizeVariantMeta(readCaseInsensitiveValue(variant, ['meta']))
      const deviceCategory = normalizeSerializedDeviceCategory(
        readCaseInsensitiveValue(variant, ['deviceCategory', 'device_category'])
        || variantMeta?.deviceCategory
        || (identifierMode === 'SERIAL' ? 'DEVICE_SERIAL' : 'PHONE_IMEI')
      ) || (identifierMode === 'SERIAL' ? 'DEVICE_SERIAL' : 'PHONE_IMEI')
      const unitsRaw = readCaseInsensitiveValue(variant, ['units'])
      const units = Array.isArray(unitsRaw)
        ? unitsRaw.map((unit) => {
          const imei = normalizeOptionalIdentifier(readCaseInsensitiveValue(unit, ['imei']))
          const serialNo = normalizeOptionalIdentifier(readCaseInsensitiveValue(unit, ['serialNo', 'serial', 'serial_no']))
          const unitMeta = sanitizeVariantUnitMeta(readCaseInsensitiveValue(unit, ['meta']))
          return {
            imei,
            serialNo,
            warehouseId: Number(readCaseInsensitiveValue(unit, ['warehouseId', 'warehouse_id']) || 1) || 1,
            meta: unitMeta,
          }
        }).filter(unit => {
          if (identifierMode === 'IMEI') return Boolean(unit.imei)
          if (identifierMode === 'SERIAL') return Boolean(unit.serialNo)
          return Boolean(unit.imei || unit.serialNo)
        })
        : []

      return {
        name: buildVariantName(variant),
        sku: normalizeOptionalIdentifier(readCaseInsensitiveValue(variant, ['sku'])),
        color: String(readCaseInsensitiveValue(variant, ['color']) || '').trim() || null,
        ram: String(readCaseInsensitiveValue(variant, ['ram']) || '').trim() || null,
        storage: String(readCaseInsensitiveValue(variant, ['storage']) || '').trim() || null,
        carrier: String(readCaseInsensitiveValue(variant, ['carrier']) || '').trim() || null,
        simType: String(readCaseInsensitiveValue(variant, ['simType', 'sim_type']) || '').trim() || null,
        identifierMode,
        price: hasNum(readCaseInsensitiveValue(variant, ['price'])) ? Number(readCaseInsensitiveValue(variant, ['price'])) : 0,
        cost: hasNum(readCaseInsensitiveValue(variant, ['cost'])) ? Number(readCaseInsensitiveValue(variant, ['cost'])) : 0,
        meta: {
          ...(variantMeta || {}),
          deviceCategory,
        },
        units,
        sortOrder: Number(readCaseInsensitiveValue(variant, ['sortOrder', 'sort_order']) ?? index) || index,
      }
    })
    .filter(variant => variant.name)
}

function hasSerializedVariantUnits(variants) {
  return Array.isArray(variants) && variants.some(variant => Array.isArray(variant?.units) && variant.units.length > 0)
}

function validateSerializedVariantCompatibility(variants) {
  if (!Array.isArray(variants)) return null
  let expectedDeviceCategory = null

  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index]
    const label = variant?.name || `Variante ${index + 1}`
    const deviceCategory = normalizeSerializedDeviceCategory(
      variant?.meta?.deviceCategory || variant?.deviceCategory || (variant?.identifierMode === 'SERIAL' ? 'DEVICE_SERIAL' : 'PHONE_IMEI')
    ) || 'PHONE_IMEI'
    const identifierMode = normalizeVariantIdentifierMode(variant?.identifierMode)
    const hasCarrier = Boolean(String(variant?.carrier || '').trim())
    const hasSimType = Boolean(String(variant?.simType || '').trim())

    if (!expectedDeviceCategory) {
      expectedDeviceCategory = deviceCategory
    } else if (expectedDeviceCategory !== deviceCategory) {
      return 'No puedes mezclar variantes de telefono con variantes de computadoras u otros equipos dentro del mismo producto.'
    }

    if (deviceCategory === 'PHONE_IMEI' && identifierMode !== 'IMEI') {
      return `La variante ${label} está clasificada como telefono y debe usar IMEI como identificador principal.`
    }

    if (deviceCategory === 'DEVICE_SERIAL') {
      if (identifierMode !== 'SERIAL') {
        return `La variante ${label} está clasificada como computadora u otro equipo y debe usar numero de serie como identificador principal.`
      }
      if (hasCarrier || hasSimType) {
        return `La variante ${label} no puede guardar compañia telefonica ni tipo de SIM porque está clasificada como computadora u otro equipo.`
      }
    }
  }

  return null
}

function inferSerializedDeviceCategoryFromVariantRecord(record) {
  const meta = parseStoredVariantMeta(record?.variant_meta)
  return normalizeSerializedDeviceCategory(
    meta?.deviceCategory || record?.deviceCategory || (normalizeVariantIdentifierMode(record?.identifier_mode) === 'SERIAL' ? 'DEVICE_SERIAL' : 'PHONE_IMEI')
  ) || 'PHONE_IMEI'
}

function inferSerializedDeviceCategoryFromProductRecord(record) {
  const trackingMeta = parseStoredTrackingMeta(record?.tracking_meta)
  return normalizeSerializedDeviceCategory(trackingMeta?.serializedDeviceProfile) || null
}

function parseStoredTrackingMeta(raw) {
  if (!raw) return undefined
  try {
    return sanitizeTrackingMeta(JSON.parse(raw)) || undefined
  } catch {
    return undefined
  }
}

function parseStoredVariantMeta(raw) {
  if (!raw) return undefined
  try {
    return sanitizeVariantMeta(JSON.parse(raw)) || undefined
  } catch {
    return undefined
  }
}

function parseStoredVariantUnitMeta(raw) {
  if (!raw) return undefined
  try {
    return sanitizeVariantUnitMeta(JSON.parse(raw)) || undefined
  } catch {
    return undefined
  }
}

function normalizeEnabledProductTypes(input) {
  let values = input
  if (typeof values === 'string') {
    try {
      values = JSON.parse(values)
    } catch {
      values = values.split(',').map(item => item.trim()).filter(Boolean)
    }
  }
  const normalized = Array.isArray(values)
    ? values
      .map(value => String(value || '').trim().toUpperCase())
      .filter(value => ENABLED_PRODUCT_TYPES.has(value))
    : []
  const unique = [...new Set(normalized)]
  return unique.length > 0 ? unique : ['GENERAL']
}

async function getEnabledProductTypes(pool) {
  try {
    const [rows] = await pool.query('SELECT enabled_product_types FROM system_config WHERE id = 1 LIMIT 1')
    return normalizeEnabledProductTypes(rows?.[0]?.enabled_product_types || ['GENERAL', 'MEDICINAL', 'IMEI', 'SERIAL', 'VARIANT_SERIALIZED'])
  } catch {
    return ['GENERAL', 'MEDICINAL', 'IMEI', 'SERIAL', 'VARIANT_SERIALIZED']
  }
}

function normalizeSpreadsheetKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[_-]/g, '')
}

function splitList(value) {
  const raw = String(value || '').trim()
  if (!raw) return []
  if (raw.startsWith('[') || raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return raw
    .split(/[\n,;]+/g)
    .map(s => String(s || '').trim())
    .filter(Boolean)
}

function parseJsonListOrThrow(value, label) {
  const raw = String(value || '').trim()
  if (!raw) return []
  if (raw.startsWith('[') || raw.startsWith('{')) {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  }
  throw new Error(`${label} debe venir como JSON (ej: ["A","B"])`)
}

function mapSpreadsheetRow(rawRow) {
  const out = {}
  for (const [k, v] of Object.entries(rawRow || {})) {
    const nk = normalizeSpreadsheetKey(k)
    if (!nk) continue
    out[nk] = v
  }

  const pick = (keys) => {
    for (const k of keys) {
      const nk = normalizeSpreadsheetKey(k)
      if (Object.prototype.hasOwnProperty.call(out, nk)) return out[nk]
    }
    return undefined
  }

  return {
    name: pick(['name', 'nombre']),
    sku: pick(['sku']),
    productCode: pick(['productcode', 'product_code', 'codigo', 'codigoproducto', 'codigo_producto']),
    categoryId: pick(['categoryid', 'category_id', 'categoriaid', 'categoria_id']),
    brandId: pick(['brandid', 'brand_id', 'marcaid', 'marca_id']),
    supplierId: pick(['supplierid', 'supplier_id', 'proveedorid', 'proveedor_id']),
    price: pick(['price', 'precio']),
    price2: pick(['price2', 'precio2']),
    price3: pick(['price3', 'precio3']),
    cost: pick(['cost', 'costo']),
    initialStock: pick(['initialstock', 'initial_stock', 'stockinicial']),
    minStock: pick(['minstock', 'min_stock', 'stockminimo']),
    unit: pick(['unit', 'unidad']),
    description: pick(['description', 'descripcion']),
    productType: pick(['producttype', 'product_type', 'tipo', 'tipoproducto']),
    altName: pick(['altname', 'altnombre', 'nombrealterno']),
    genericName: pick(['genericname', 'nombregenerico', 'nombre_generico']),
    shelfLocation: pick(['shelflocation', 'ubicacion', 'ubicacionestante']),
    trackingProfile: pick(['trackingprofile', 'tracking_profile', 'perfilvencimiento', 'perfildelote', 'perfildelotes']),
    trackingMeta: pick(['trackingmeta', 'tracking_meta', 'metavencimiento', 'metalote', 'meta_lote']),
    batches: pick(['batches', 'lotes']),
    imeis: pick(['imeis', 'imei']),
    serials: pick(['serials', 'series', 'serial']),
    variants: pick(['variants', 'variantes', 'serializedvariants', 'variantesserializadas']),
  }
}

function isGroupedImeiSpreadsheetFormat(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return false

  let codeHeaderDetected = false
  let imeiHeaderDetected = false
  let namedRows = 0
  let continuationRows = 0

  for (const row of rows.slice(0, 20)) {
    const normalizedKeys = Object.keys(row || {}).map(normalizeSpreadsheetKey).filter(Boolean)
    if (normalizedKeys.includes('codigo')) codeHeaderDetected = true
    if (normalizedKeys.includes('imei')) imeiHeaderDetected = true

    const mapped = mapSpreadsheetRow(row)
    if (String(mapped.name || '').trim()) namedRows += 1
    if (!String(mapped.productCode || '').trim() && String(mapped.imeis || '').trim()) continuationRows += 1
  }

  return codeHeaderDetected && imeiHeaderDetected && namedRows === 0 && continuationRows > 0
}

function normalizeGroupedImeiSpreadsheetRows(rows) {
  if (!isGroupedImeiSpreadsheetFormat(rows)) return rows

  const grouped = new Map()
  const orderedCodes = []
  let currentCode = ''

  const ensureEntry = (code) => {
    const normalizedCode = String(code || '').trim()
    if (!normalizedCode) return null
    if (!grouped.has(normalizedCode)) {
      grouped.set(normalizedCode, {
        name: normalizedCode,
        sku: normalizedCode,
        productCode: normalizedCode,
        unit: 'UND',
        description: normalizedCode,
        productType: 'IMEI',
        imeis: [],
      })
      orderedCodes.push(normalizedCode)
    }
    return grouped.get(normalizedCode)
  }

  for (const row of rows) {
    const mapped = mapSpreadsheetRow(row)
    const code = String(mapped.productCode || '').trim()
    if (code) currentCode = code
    if (!currentCode) continue

    const entry = ensureEntry(currentCode)
    if (!entry) continue

    const price = mapped.price !== '' && mapped.price !== undefined && mapped.price !== null
      ? Number(mapped.price)
      : null
    if (price !== null && Number.isFinite(price)) entry.price = price

    const imeis = splitList(mapped.imeis)
    for (const imei of imeis) {
      const normalizedImei = String(imei || '').trim()
      if (!normalizedImei || entry.imeis.includes(normalizedImei)) continue
      entry.imeis.push(normalizedImei)
    }
  }

  return orderedCodes.map((code) => {
    const entry = grouped.get(code)
    return {
      ...entry,
      imeis: entry.imeis.join(','),
    }
  })
}

async function createProductAtomic({ pool, userId, payload, imageUrl }) {
  const { name, sku, productCode, categoryId, brandId, supplierId, price, price2, price3, cost, stock, initialStock, minStock, unit, description, productType, altName, genericName, shelfLocation, trackingProfile, trackingMeta, storeBannerPrincipal } = payload
  const { normalizedSku, normalizedProductCode } = await ensureUniqueProductIdentifiers(pool, { sku, productCode })

  const rawBatches = Array.isArray(payload.batches) ? payload.batches : []
  const batches = rawBatches
    .map(b => ({
      batch_no: String(b?.batch_no ?? b?.batchNo ?? '').trim(),
      expiry_date: b?.expiry_date ?? b?.expiryDate ?? null,
      quantity: Number(b?.quantity ?? 0),
    }))
    .filter(b => b.batch_no.length > 0 && b.quantity > 0)
  const rawImeis = Array.isArray(payload.imeis) ? payload.imeis : []
  const imeis = rawImeis.map(x => String(x || '').trim()).filter(s => s.length > 0)
  const rawSerials = Array.isArray(payload.serials) ? payload.serials : []
  const serials = rawSerials.map(x => String(x || '').trim()).filter(s => s.length > 0)
  const variants = normalizeSerializedVariants(payload.variants)

  const type = String(productType || 'GENERAL').toUpperCase()
  const normalizedTrackingProfile = normalizeTrackingProfile(trackingProfile, type)
  const normalizedTrackingMeta = sanitizeTrackingMeta(trackingMeta)
  let derivedStock = hasNum(stock) ? Number(stock) : 0
  if (type === 'MEDICINAL') derivedStock = sumQuantity(batches, 'quantity')
  else if (type === 'IMEI') derivedStock = imeis.length
  else if (type === 'SERIAL') derivedStock = serials.length
  else if (type === 'VARIANT_SERIALIZED') derivedStock = variants.reduce((sum, variant) => sum + variant.units.length, 0)
  // #region debug-point B:create-product-normalized
  ;(()=>{import('node:fs').then(({readFileSync})=>{let u='http://127.0.0.1:7777/event',s='variant-save-error';try{const e=readFileSync('.dbg/variant-save-error.env','utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'B',location:'server/routes/products.js:createProductAtomic',msg:'[DEBUG] createProductAtomic normalized payload',data:{type,sku:normalizedSku||null,productCode:normalizedProductCode||null,variantsCount:Array.isArray(variants)?variants.length:0,variantUnitCounts:Array.isArray(variants)?variants.map(variant=>({name:variant.name,identifierMode:variant.identifierMode,units:Array.isArray(variant.units)?variant.units.length:0,warehouses:Array.isArray(variant.units)?[...new Set(variant.units.map(unit=>Number(unit.warehouseId||0)||0))]:[]})):[],derivedStock,initialStockValue:Number(initialStock ?? derivedStock ?? 0)},ts:Date.now()})}).catch(()=>{})}).catch(()=>{})})();
  // #endregion

  if (type === 'IMEI' && imeis.length) {
    const dupList = [...new Set(imeis.filter((v, i, arr) => arr.indexOf(v) !== i))]
    if (dupList.length > 0) {
      return { error: 'Valores duplicados detectados en IMEIs', duplicate: dupList.join(', '), status: 409 }
    }
  } else if (type === 'SERIAL' && serials.length) {
    const dupList = [...new Set(serials.filter((v, i, arr) => arr.indexOf(v) !== i))]
    if (dupList.length > 0) {
      return { error: 'Valores duplicados detectados en series', duplicate: dupList.join(', '), status: 409 }
    }
  }

  if (type === 'IMEI' && imeis.length) {
    for (const imei of imeis) {
      const [dupRows] = await pool.query('SELECT id FROM product_imeis WHERE imei = ? LIMIT 1', [imei])
      if (dupRows.length > 0) {
        throw { code: 'ER_DUP_ENTRY', sqlMessage: `Duplicate entry '${imei}' for key 'uniq_imei'`, message: 'IMEI duplicado' }
      }
    }
  }

  if (type === 'VARIANT_SERIALIZED') {
    if (hasSerializedVariantUnits(variants)) {
      return { error: 'Las unidades IMEI/Serie de variantes se ingresan desde Compras o Ajustes de Stock, no desde Productos.', status: 400 }
    }
    if (variants.length > 0) {
      const compatibilityError = validateSerializedVariantCompatibility(variants)
      if (compatibilityError) {
        return { error: compatibilityError, status: 400 }
      }

      const requestVariantSkus = variants.map(variant => variant.sku).filter(Boolean)
      const repeatedVariantSku = [...new Set(requestVariantSkus.filter((value, index, arr) => arr.indexOf(value) !== index))]
      if (repeatedVariantSku.length > 0) {
        return { error: 'SKU duplicado entre variantes', duplicate: repeatedVariantSku.join(', '), status: 409 }
      }

      for (const variant of variants) {
        if (variant.sku) {
          const [dupVariantSkuRows] = await pool.query('SELECT id FROM product_variants WHERE UPPER(TRIM(COALESCE(sku, ""))) = ? LIMIT 1', [variant.sku])
          if (Array.isArray(dupVariantSkuRows) && dupVariantSkuRows.length > 0) {
            throw { code: 'ER_DUP_ENTRY', sqlMessage: `Duplicate entry '${variant.sku}' for key 'product_variants.sku'`, message: 'SKU de variante duplicado' }
          }
        }
      }
    }
  }

  await ensureDefaultWarehouseId1(pool)
  await ensureWarehouseStockTable(pool)
  await ensureStoreBannerColumn(pool)
  await ensureTrackingColumns(pool)
  await ensureSerializedVariantStructures(pool)
  await ensureProductImagesTable(pool)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const initialStockValue = Number(initialStock ?? derivedStock ?? 0)

    const [result] = await conn.query(
      'INSERT INTO products (name, sku, product_code, category_id, brand_id, supplier_id, price, price2, price3, cost, avg_cost, last_cost, min_stock, unit, description, image_url, store_banner_principal, product_type, alt_name, generic_name, shelf_location, tracking_profile, tracking_meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        name,
        normalizedSku,
        normalizedProductCode,
        categoryId ? Number(categoryId) : null,
        brandId ? Number(brandId) : null,
        supplierId ? Number(supplierId) : null,
        Number(price || 0),
        Number(price2 || 0),
        Number(price3 || 0),
        Number(cost || 0),
        Number(cost || 0),
        Number(cost || 0),
        Number(minStock || 0),
        unit || null,
        description || null,
        imageUrl,
        storeBannerPrincipal ? 1 : 0,
        type,
        altName || null,
        genericName || null,
        shelfLocation || null,
        normalizedTrackingProfile,
        normalizedTrackingMeta ? JSON.stringify(normalizedTrackingMeta) : null,
      ]
    )
    const id = result.insertId

    if (storeBannerPrincipal) {
      await conn.query('UPDATE products SET store_banner_principal = 0 WHERE id <> ?', [id])
    }

    if (type === 'MEDICINAL' && batches.length) {
      await Promise.all(
        batches.map(b =>
          conn.query('INSERT INTO product_batches (product_id, batch_no, expiry_date, quantity) VALUES (?, ?, ?, ?)', [id, b.batch_no, b.expiry_date, Number(b.quantity || 0)])
        )
      )
    } else if (type === 'IMEI' && imeis.length) {
      await Promise.all(imeis.map(imei => conn.query('INSERT INTO product_imeis (product_id, imei) VALUES (?, ?)', [id, String(imei || '')])))
    } else if (type === 'SERIAL' && serials.length) {
      await Promise.all(serials.map(serial => conn.query('INSERT INTO product_serials (product_id, serial_no) VALUES (?, ?)', [id, String(serial || '')])))
    } else if (type === 'VARIANT_SERIALIZED' && variants.length) {
      for (const variant of variants) {
        const [variantResult] = await conn.query(
          `INSERT INTO product_variants
           (product_id, name, sku, color, ram, storage, carrier, sim_type, identifier_mode, variant_meta, sort_order, stock, price, cost)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            variant.name,
            variant.sku,
            variant.color,
            variant.ram,
            variant.storage,
            variant.carrier,
            variant.simType,
            variant.identifierMode,
            variant.meta ? JSON.stringify(variant.meta) : null,
            Number(variant.sortOrder || 0),
            0,
            Number(variant.price || 0),
            Number(variant.cost || 0),
          ]
        )
      }
    }

    if (initialStockValue > 0) {
      if (type === 'MEDICINAL' && batches.length) {
        await conn.query('UPDATE product_batches SET warehouse_id = 1 WHERE product_id = ?', [id])
      } else if (type === 'IMEI' && imeis.length) {
        await conn.query('UPDATE product_imeis SET warehouse_id = 1 WHERE product_id = ?', [id])
      } else if (type === 'SERIAL' && serials.length) {
        await conn.query('UPDATE product_serials SET warehouse_id = 1 WHERE product_id = ?', [id])
      } else if (type === 'VARIANT_SERIALIZED' && variants.length) {
        await conn.query('UPDATE product_variant_units SET warehouse_id = 1 WHERE product_id = ?', [id])
      }

      await registerMovement(
        {
          productId: id,
          warehouseId: 1,
          type: 'INITIAL',
          quantity: initialStockValue,
          notes: 'Inventario inicial al crear producto',
          userId,
        },
        conn
      )
    }

    await conn.commit()
    return {
      id,
      name,
      sku: normalizedSku || undefined,
      productCode: normalizedProductCode || undefined,
      categoryId: categoryId ? Number(categoryId) : undefined,
      brandId: brandId ? Number(brandId) : undefined,
      supplierId: supplierId ? Number(supplierId) : undefined,
      price: Number(price || 0),
      price2: Number(price2 || 0),
      price3: Number(price3 || 0),
      cost: Number(cost || 0),
      avgCost: Number(cost || 0),
      lastCost: Number(cost || 0),
      stock: initialStockValue,
      initialStock: initialStockValue,
      minStock: Number(minStock || 0),
      unit: unit || undefined,
      description: description || undefined,
      imageUrl: imageUrl || undefined,
      storeBannerPrincipal: Boolean(storeBannerPrincipal),
      productType: type,
      altName: altName || undefined,
      genericName: genericName || undefined,
      shelfLocation: shelfLocation || undefined,
      trackingProfile: normalizedTrackingProfile || undefined,
      trackingMeta: normalizedTrackingMeta || undefined,
    }
  } catch (txErr) {
    await conn.rollback()
    throw txErr
  } finally {
    conn.release()
  }
}

function normalizeOptionalIdentifier(value) {
  const normalized = String(value ?? '').trim().toUpperCase()
  return normalized || null
}

async function ensureUniqueProductIdentifiers(pool, { sku, productCode, excludeProductId = null }) {
  const normalizedSku = normalizeOptionalIdentifier(sku)
  const normalizedProductCode = normalizeOptionalIdentifier(productCode)

  if (normalizedSku) {
    const skuParams = [normalizedSku]
    let skuQuery = 'SELECT id FROM products WHERE UPPER(TRIM(COALESCE(sku, ""))) = ?'
    if (excludeProductId) {
      skuQuery += ' AND id <> ?'
      skuParams.push(Number(excludeProductId))
    }
    skuQuery += ' LIMIT 1'

    const [skuRows] = await pool.query(skuQuery, skuParams)
    if (Array.isArray(skuRows) && skuRows.length > 0) {
      throw {
        code: 'ER_DUP_ENTRY',
        sqlMessage: `Duplicate entry '${normalizedSku}' for key 'products.sku'`,
        message: 'SKU duplicado'
      }
    }
  }

  if (normalizedProductCode) {
    const codeParams = [normalizedProductCode]
    let codeQuery = 'SELECT id FROM products WHERE UPPER(TRIM(COALESCE(product_code, ""))) = ?'
    if (excludeProductId) {
      codeQuery += ' AND id <> ?'
      codeParams.push(Number(excludeProductId))
    }
    codeQuery += ' LIMIT 1'

    const [codeRows] = await pool.query(codeQuery, codeParams)
    if (Array.isArray(codeRows) && codeRows.length > 0) {
      throw {
        code: 'ER_DUP_ENTRY',
        sqlMessage: `Duplicate entry '${normalizedProductCode}' for key 'uniq_products_product_code'`,
        message: 'Codigo de producto duplicado'
      }
    }
  }

  return {
    normalizedSku,
    normalizedProductCode,
  }
}

function resolveWarehouseScope(req, requestedWarehouseId) {
  const userWarehouseId = getUserWarehouseId(req.user)
  const isAdmin = isAdminUser(req.user)
  const targetWarehouseId = Number(requestedWarehouseId || 0)

  if (isAdmin) {
    return { warehouseId: targetWarehouseId || null, denied: false }
  }
  if (!userWarehouseId) {
    return { warehouseId: null, denied: true }
  }
  if (!targetWarehouseId) {
    return { warehouseId: userWarehouseId, denied: false }
  }
  if (!canAccessWarehouse(req.user, targetWarehouseId)) {
    return { warehouseId: null, denied: true }
  }
  return { warehouseId: targetWarehouseId, denied: false }
}

async function canViewSensitiveProductData(req, pool) {
  return userHasPermissionCode(req, pool, 'products:sensitive:read')
}

async function canWriteProducts(req, pool) {
  return userHasPermissionCode(req, pool, 'products:write')
}

async function userHasPermissionCode(req, pool, permissionCode) {
  if (isAdminUser(req.user)) {
    return true
  }
  if (!req.user?.id) {
    return false
  }

  const [rows] = await pool.query(
    `SELECT 1
     FROM users u
     JOIN role_permissions rp ON u.role_id = rp.role_id
     JOIN permissions p ON rp.permission_id = p.id
     WHERE u.id = ? AND p.code = ?
     LIMIT 1`,
    [req.user.id, permissionCode]
  )

  return Array.isArray(rows) && rows.length > 0
}

function sanitizeSensitiveProductFields(item, includeSensitive) {
  if (includeSensitive) {
    return item
  }

  return {
    ...item,
    cost: undefined,
    avgCost: undefined,
    lastCost: undefined,
    supplierId: undefined,
  }
}

function capTrackedDetailsByWarehouseStock(values, stockRows, warehouseKey = 'warehouseId') {
  const safeValues = Array.isArray(values) ? values.filter(Boolean) : []
  const stockMap = new Map(
    (Array.isArray(stockRows) ? stockRows : []).map(row => [
      Number(row?.warehouse_id || 0),
      Math.max(0, Number(row?.quantity || 0))
    ])
  )
  const usedByWarehouse = new Map()

  return safeValues.filter(item => {
    const warehouseId = Number(item?.[warehouseKey] || 0)
    const allowedQty = stockMap.get(warehouseId)

    if (!allowedQty) {
      return false
    }

    const usedQty = usedByWarehouse.get(warehouseId) || 0
    if (usedQty >= allowedQty) {
      return false
    }

    usedByWarehouse.set(warehouseId, usedQty + 1)
    return true
  })
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const {
      warehouseId,
      search,
      paged,
      limit: rawLimit,
      offset: rawOffset,
      categoryId,
      subcategoryId,
      brandId,
      supplierId,
      departmentId,
      stockFilter,
    } = req.query
    const pool = await getPool()
    const includeSensitive = await canViewSensitiveProductData(req, pool)
    const scope = resolveWarehouseScope(req, warehouseId)

    if (scope.denied) {
      return res.status(403).json({ error: 'No tienes acceso a esa tienda' })
    }

    await ensureDefaultWarehouseId1(pool)
    await ensureWarehouseStockTable(pool)
    await ensureStoreBannerColumn(pool)
    await ensureTrackingColumns(pool)
    await ensureProductImagesTable(pool)
    
    // Si se especifica warehouseId, calculamos stock local y 'otros'
    // Si no, stock es global y other_stock es 0
    let stockAggregateExpr = `COALESCE(SUM(pws.quantity), 0)`
    let selectStock = `${stockAggregateExpr} as stock, 0 as other_stock`
    const params = []

    if (scope.warehouseId) {
      stockAggregateExpr = `COALESCE(SUM(CASE WHEN pws.warehouse_id = ? THEN pws.quantity ELSE 0 END), 0)`
      selectStock = `
        ${stockAggregateExpr} as stock,
        COALESCE(SUM(CASE WHEN pws.warehouse_id != ? THEN pws.quantity ELSE 0 END), 0) as other_stock
      `
      params.push(scope.warehouseId, scope.warehouseId)
    }

    const whereClauses = []
    const whereParams = []
    const havingClauses = []
    const havingParams = []

    let query = `
      SELECT p.id, p.name, p.sku, p.product_code, p.category_id, p.brand_id, p.supplier_id, p.price, p.price2, p.price3, p.cost, p.avg_cost, p.last_cost,
              ${selectStock}, 
              (SELECT COALESCE(SUM(quantity), 0) FROM inventory_movements WHERE product_id = p.id AND type = 'INITIAL') as initial_stock, 
              p.min_stock, p.unit, p.description, p.image_url, p.store_banner_principal, p.product_type, p.alt_name, p.generic_name, p.shelf_location, p.tracking_profile, p.tracking_meta
       FROM products p 
       LEFT JOIN product_warehouse_stock pws ON p.id = pws.product_id
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN categories pc ON c.parent_id = pc.id`

    const normalizedSearch = String(search || '').trim()
    if (normalizedSearch) {
      const searchTerms = normalizedSearch
        .split(/\s+/)
        .map(term => term.trim())
        .filter(Boolean)
        .slice(0, 8)

      for (const term of searchTerms) {
        const searchTerm = `%${term}%`
        whereClauses.push(`(
          p.name LIKE ?
          OR COALESCE(p.sku, '') LIKE ?
          OR COALESCE(p.product_code, '') LIKE ?
          OR COALESCE(p.description, '') LIKE ?
          OR COALESCE(p.alt_name, '') LIKE ?
          OR COALESCE(p.generic_name, '') LIKE ?
        )`)
        whereParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm)
      }
    }

    const normalizedSubcategoryId = Number(subcategoryId || 0)
    const normalizedCategoryId = Number(categoryId || 0)
    const normalizedBrandId = Number(brandId || 0)
    const normalizedSupplierId = Number(supplierId || 0)
    const normalizedDepartmentId = Number(departmentId || 0)

    if (normalizedSubcategoryId > 0) {
      whereClauses.push('p.category_id = ?')
      whereParams.push(normalizedSubcategoryId)
    } else if (normalizedCategoryId > 0) {
      whereClauses.push('(p.category_id = ? OR c.parent_id = ?)')
      whereParams.push(normalizedCategoryId, normalizedCategoryId)
    }

    if (normalizedBrandId > 0) {
      whereClauses.push('p.brand_id = ?')
      whereParams.push(normalizedBrandId)
    }

    if (normalizedSupplierId > 0) {
      whereClauses.push('p.supplier_id = ?')
      whereParams.push(normalizedSupplierId)
    }

    if (normalizedDepartmentId > 0) {
      whereClauses.push('COALESCE(c.department_id, pc.department_id) = ?')
      whereParams.push(normalizedDepartmentId)
    }

    const normalizedStockFilter = String(stockFilter || '').trim().toLowerCase()
    if (normalizedStockFilter === 'with_stock') {
      havingClauses.push('stock > 0')
    } else if (normalizedStockFilter === 'without_stock') {
      havingClauses.push('stock = 0')
    }

    if (whereClauses.length > 0) {
      query += ` WHERE ${whereClauses.join(' AND ')}`
    }

    const limit = Math.min(Math.max(Number(rawLimit || 60), 1), 200)
    const offset = Math.max(Number(rawOffset || 0), 0)
    const isPaged = String(paged || '').toLowerCase() === 'true' || Number(rawLimit || 0) > 0

    const finalParams = [...params, ...whereParams]
    query += ` GROUP BY p.id`
    if (havingClauses.length > 0) {
      query += ` HAVING ${havingClauses.join(' AND ')}`
      finalParams.push(...havingParams)
    }
    query += ` ORDER BY p.id DESC`

    let total = null
    let catalogTotal = null

    if (isPaged) {
      const countParams = [...params, ...whereParams, ...havingParams]
      const [countRows] = await pool.query(
        `SELECT COUNT(*) AS total
         FROM (
           SELECT p.id, ${stockAggregateExpr} AS stock
           FROM products p
           LEFT JOIN product_warehouse_stock pws ON p.id = pws.product_id
           LEFT JOIN categories c ON p.category_id = c.id
           LEFT JOIN categories pc ON c.parent_id = pc.id
           ${whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : ''}
           GROUP BY p.id
           ${havingClauses.length > 0 ? `HAVING ${havingClauses.join(' AND ')}` : ''}
         ) grouped_products`,
        countParams
      )
      total = Number(countRows?.[0]?.total || 0)

      const [catalogRows] = await pool.query('SELECT COUNT(*) AS total FROM products')
      catalogTotal = Number(catalogRows?.[0]?.total || 0)

      query += ` LIMIT ? OFFSET ?`
      finalParams.push(limit, offset)
    }

    const [rows] = await pool.query(query, finalParams)
    const productImageMap = await getProductImagesMap(pool, rows.map(row => row.id))

    const items = rows.map(r => sanitizeSensitiveProductFields({
      id: r.id,
      name: r.name,
      sku: r.sku,
      productCode: r.product_code || undefined,
      categoryId: r.category_id ?? undefined,
      brandId: r.brand_id ?? undefined,
      supplierId: r.supplier_id ?? undefined,
      price: Number(r.price ?? 0),
      price2: Number(r.price2 ?? 0),
      price3: Number(r.price3 ?? 0),
      cost: Number(r.cost ?? 0),
      avgCost: Number(r.avg_cost ?? r.cost ?? 0),
      lastCost: Number(r.last_cost ?? r.cost ?? 0),
      stock: Number(r.stock ?? 0),
      otherStock: Number(r.other_stock ?? 0),
      initialStock: Number(r.initial_stock ?? 0),
      minStock: Number(r.min_stock ?? 0),
      unit: r.unit || undefined,
      description: r.description || undefined,
      imageUrl: r.image_url || undefined,
      images: productImageMap.get(Number(r.id)) || [],
      storeBannerPrincipal: Boolean(Number(r.store_banner_principal || 0)),
      productType: r.product_type || undefined,
      altName: r.alt_name || undefined,
      genericName: r.generic_name || undefined,
      shelfLocation: r.shelf_location || undefined,
      trackingProfile: r.tracking_profile || undefined,
      trackingMeta: parseStoredTrackingMeta(r.tracking_meta),
    }, includeSensitive))

    if (isPaged) {
      return res.json({
        data: items,
        pagination: {
          total,
          limit,
          offset,
          page: Math.floor(offset / limit) + 1,
          totalPages: Math.max(1, Math.ceil(total / limit)),
          catalogTotal,
        }
      })
    }

    return res.json(items)
  } catch (err) {
    console.error('Products GET error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

router.get('/:id/cost-history', authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const pool = await getPool()
    const includeSensitive = await canViewSensitiveProductData(req, pool)

    if (!includeSensitive) {
      return res.status(403).json({ error: 'No tienes permisos para ver el historial de costos' })
    }

    const scope = resolveWarehouseScope(req)
    if (scope.denied) {
      return res.status(403).json({ error: 'No tienes acceso a esa tienda' })
    }

    const productParams = [id]
    let productWhere = 'WHERE p.id = ?'
    if (scope.warehouseId) {
      productWhere += ' AND pws.warehouse_id = ?'
      productParams.push(scope.warehouseId)
    }

    const [productRows] = await pool.query(
      `SELECT p.id, p.name, p.product_code, p.cost, p.avg_cost, p.last_cost
       FROM products p
       LEFT JOIN product_warehouse_stock pws ON p.id = pws.product_id
       ${productWhere}
       GROUP BY p.id
       LIMIT 1`,
      productParams
    )

    const product = productRows?.[0]
    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' })
    }

    const historyParams = [id]
    let historyWhere = 'WHERE pi.product_id = ?'
    if (scope.warehouseId) {
      historyWhere += ' AND pu.warehouse_id = ?'
      historyParams.push(scope.warehouseId)
    }

    const [historyRows] = await pool.query(
      `SELECT pu.id AS purchase_id,
              pu.doc_no,
              pu.created_at,
              pu.warehouse_id,
              w.name AS warehouse_name,
              pi.quantity,
              pi.unit_cost,
              COALESCE(pi.total_cost, pi.total, pi.quantity * pi.unit_cost, 0) AS total_cost
       FROM purchase_items pi
       JOIN purchases pu ON pu.id = pi.purchase_id
       LEFT JOIN warehouses w ON w.id = pu.warehouse_id
       ${historyWhere}
       ORDER BY pu.created_at DESC, pi.id DESC`,
      historyParams
    )

    return res.json({
      product: {
        id: Number(product.id),
        name: product.name,
        productCode: product.product_code || undefined,
        cost: Number(product.cost ?? 0),
        avgCost: Number(product.avg_cost ?? product.cost ?? 0),
        lastCost: Number(product.last_cost ?? product.cost ?? 0),
      },
      history: (historyRows || []).map(row => ({
        purchaseId: Number(row.purchase_id),
        purchaseNumber: row.doc_no ? String(row.doc_no) : `Compra #${row.purchase_id}`,
        docNo: row.doc_no || null,
        createdAt: row.created_at,
        warehouseId: row.warehouse_id ? Number(row.warehouse_id) : null,
        warehouseName: row.warehouse_name || null,
        quantity: Number(row.quantity ?? 0),
        unitCost: Number(row.unit_cost ?? 0),
        totalCost: Number(row.total_cost ?? 0),
      })),
    })
  } catch (err) {
    console.error('Product cost history error:', err)
    return res.status(500).json({ error: 'Error al obtener historial de costos' })
  }
})

router.get('/import-template', authMiddleware, async (req, res) => {
  try {
    const pool = await getPool()
    if (!await canWriteProducts(req, pool)) {
      return res.status(403).json({ error: 'No tienes permisos para importar productos' })
    }

    const header = [
      'name',
      'sku',
      'productCode',
      'categoryId',
      'brandId',
      'supplierId',
      'price',
      'price2',
      'price3',
      'cost',
      'initialStock',
      'minStock',
      'unit',
      'description',
      'productType',
      'altName',
      'genericName',
      'shelfLocation',
      'trackingProfile',
      'trackingMeta',
      'batches',
      'imeis',
      'serials',
      'variants',
    ]

    const rows = [
      header,
      [
        'Jabon Liquido 500ml',
        'SKU-001',
        'P-001',
        '',
        '',
        '',
        25,
        0,
        0,
        10,
        0,
        0,
        'UND',
        '',
        'GENERAL',
        '',
        '',
        '',
        '',
        '',
        '[]',
        '[]',
        '[]',
        '[]',
      ],
      [
        'Paracetamol 500mg',
        '',
        'MED-100',
        '',
        '',
        '',
        1.5,
        0,
        0,
        0,
        0,
        0,
        'UND',
        '',
        'MEDICINAL',
        '',
        'ACETAMINOFEN',
        'A1',
        'MEDICAMENTO',
        '{"activeIngredient":"ACETAMINOFEN","concentration":"500 MG","dosageForm":"TABLETA","sanitaryRegistry":"PENDIENTE","storageNotes":"MANTENER EN LUGAR SECO"}',
        '[{"batch_no":"L001","expiry_date":"2027-12-31","quantity":50}]',
        '[]',
        '[]',
        '[]',
      ],
      [
        'Telefono X',
        '',
        'TELX-01',
        '',
        '',
        '',
        1500,
        0,
        0,
        1200,
        0,
        0,
        'UND',
        '',
        'IMEI',
        '',
        '',
        '',
        '',
        '',
        '[]',
        '356789012345678,356789012345679',
        '[]',
        '[]',
      ],
      [
        'Router Y',
        '',
        'RTY-01',
        '',
        '',
        '',
        300,
        0,
        0,
        200,
        0,
        0,
        'UND',
        '',
        'SERIAL',
        '',
        '',
        '',
        '',
        '',
        '[]',
        '[]',
        'SN-0001,SN-0002',
        '[]',
      ],
      [
        'Samsung A17',
        'SAM-A17',
        'TEL-A17',
        '',
        '',
        '',
        0,
        0,
        0,
        0,
        0,
        0,
        'UND',
        'Producto maestro con variantes serializadas',
        'VARIANT_SERIALIZED',
        '',
        '',
        '',
        '',
        '',
        '[]',
        '[]',
        '[]',
        '[{"name":"NEGRO / 4GB / 128GB / CLARO","color":"NEGRO","ram":"4GB","storage":"128GB","carrier":"CLARO","simType":"DOBLE SIM","identifierMode":"IMEI","price":1650,"cost":1400,"units":[{"imei":"356789012340001"}]},{"name":"AZUL / 4GB / 128GB / LIBERADO","color":"AZUL","ram":"4GB","storage":"128GB","carrier":"LIBERADO","simType":"DOBLE SIM","identifierMode":"IMEI","price":1690,"cost":1425,"units":[{"imei":"356789012340002"}]}]',
      ],
    ]

    const ws = XLSXApi.utils.aoa_to_sheet(rows)
    const wb = XLSXApi.utils.book_new()
    XLSXApi.utils.book_append_sheet(wb, ws, 'Formato')

    const buf = XLSXApi.write(wb, { bookType: 'xlsx', type: 'buffer' })
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="productos_import_template.xlsx"')
    return res.send(buf)
  } catch (err) {
    console.error('Products import-template error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// NEW: get product with arrays for editing
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const { warehouseId } = req.query
    const pool = await getPool()
    const includeSensitive = await canViewSensitiveProductData(req, pool)
    const scope = resolveWarehouseScope(req, warehouseId)

    if (scope.denied) {
      return res.status(403).json({ error: 'No tienes acceso a esa tienda' })
    }

    await ensureDefaultWarehouseId1(pool)
    await ensureWarehouseStockTable(pool)
    await ensureTrackingColumns(pool)
    await ensureSerializedVariantStructures(pool)
    await ensureProductImagesTable(pool)
    
    let selectStock = `COALESCE(SUM(pws.quantity), 0) as stock, 0 as other_stock`
    const params = []

    if (scope.warehouseId) {
      selectStock = `
        COALESCE(SUM(CASE WHEN pws.warehouse_id = ? THEN pws.quantity ELSE 0 END), 0) as stock,
        COALESCE(SUM(CASE WHEN pws.warehouse_id != ? THEN pws.quantity ELSE 0 END), 0) as other_stock
      `
      params.push(scope.warehouseId, scope.warehouseId)
    }
    
    params.push(id)

    const [rows] = await pool.query(
      `SELECT p.id, p.name, p.sku, p.product_code, p.category_id, p.brand_id, p.supplier_id, p.price, p.price2, p.price3, p.cost, p.avg_cost, p.last_cost,
              ${selectStock}, 
              (SELECT COALESCE(SUM(quantity), 0) FROM inventory_movements WHERE product_id = p.id AND type = 'INITIAL') as initial_stock,
              p.min_stock, p.unit, p.description, p.image_url, p.store_banner_principal, p.product_type, p.alt_name, p.generic_name, p.shelf_location, p.tracking_profile, p.tracking_meta
       FROM products p 
       LEFT JOIN product_warehouse_stock pws ON p.id = pws.product_id
       WHERE p.id = ?
       GROUP BY p.id
       LIMIT 1`,
      params
    )
    const r = rows?.[0]
    if (!r) return res.status(404).json({ error: 'Not found' })
    await ensureLegacyProductImageRecord(pool, id, r.image_url)
    const productImages = await getProductImages(pool, id)

    const type = String(r.product_type || 'GENERAL').toUpperCase()
    let batches = []
    let imeis = []
    let serials = []
    let imeiDetails = []
    let serialDetails = []
    let variants = []

    if (type === 'MEDICINAL') {
      let query = 'SELECT batch_no, expiry_date, quantity FROM product_batches WHERE product_id = ?'
      const qParams = [id]
      if (scope.warehouseId) {
        query += ' AND warehouse_id = ?'
        qParams.push(scope.warehouseId)
      }
      query += ' ORDER BY expiry_date ASC'
      const [batchRows] = await pool.query(query, qParams)
      batches = (batchRows || []).map(b => ({
        batchNo: b.batch_no || '',
        expiryDate: b.expiry_date ? String(b.expiry_date).slice(0, 10) : '',
        quantity: Number(b.quantity || 0),
      }))
    } else if (type === 'IMEI') {
      const stockQuery = scope.warehouseId
        ? 'SELECT warehouse_id, quantity FROM product_warehouse_stock WHERE product_id = ? AND warehouse_id = ? ORDER BY warehouse_id ASC'
        : 'SELECT warehouse_id, quantity FROM product_warehouse_stock WHERE product_id = ? ORDER BY warehouse_id ASC'
      const stockParams = scope.warehouseId ? [id, scope.warehouseId] : [id]
      const [trackedStockRows] = await pool.query(stockQuery, stockParams)

      let query = `
        SELECT pi.imei, pi.warehouse_id, w.name AS warehouse_name
        FROM product_imeis pi
        LEFT JOIN warehouses w ON w.id = pi.warehouse_id
        WHERE pi.product_id = ? AND pi.status = "AVAILABLE"`
      const qParams = [id]
      if (scope.warehouseId) {
        query += ' AND pi.warehouse_id = ?'
        qParams.push(scope.warehouseId)
      }
      query += ' ORDER BY pi.id ASC'
      const [imeiRows] = await pool.query(query, qParams)
      imeiDetails = capTrackedDetailsByWarehouseStock((imeiRows || []).map(rw => ({
        imei: rw.imei || '',
        warehouseId: rw.warehouse_id ? Number(rw.warehouse_id) : null,
        warehouseName: rw.warehouse_name || 'Sin almacén',
      })), trackedStockRows)
      imeis = imeiDetails.map(item => item.imei)
    } else if (type === 'SERIAL') {
      const stockQuery = scope.warehouseId
        ? 'SELECT warehouse_id, quantity FROM product_warehouse_stock WHERE product_id = ? AND warehouse_id = ? ORDER BY warehouse_id ASC'
        : 'SELECT warehouse_id, quantity FROM product_warehouse_stock WHERE product_id = ? ORDER BY warehouse_id ASC'
      const stockParams = scope.warehouseId ? [id, scope.warehouseId] : [id]
      const [trackedStockRows] = await pool.query(stockQuery, stockParams)

      let query = `
        SELECT ps.serial_no, ps.warehouse_id, w.name AS warehouse_name
        FROM product_serials ps
        LEFT JOIN warehouses w ON w.id = ps.warehouse_id
        WHERE ps.product_id = ? AND ps.status = "AVAILABLE"`
      const qParams = [id]
      if (scope.warehouseId) {
        query += ' AND ps.warehouse_id = ?'
        qParams.push(scope.warehouseId)
      }
      query += ' ORDER BY ps.id ASC'
      const [serialRows] = await pool.query(query, qParams)
      serialDetails = capTrackedDetailsByWarehouseStock((serialRows || []).map(rw => ({
        serial: rw.serial_no || '',
        warehouseId: rw.warehouse_id ? Number(rw.warehouse_id) : null,
        warehouseName: rw.warehouse_name || 'Sin almacén',
      })), trackedStockRows)
      serials = serialDetails.map(item => item.serial)
    } else if (type === 'VARIANT_SERIALIZED') {
      const variantParams = [id]
      let unitsWarehouseFilter = ''
      if (scope.warehouseId) {
        unitsWarehouseFilter = ' AND pvu.warehouse_id = ?'
        variantParams.push(scope.warehouseId)
      }

      const [variantRows] = await pool.query(
        `SELECT pv.id, pv.name, pv.sku, pv.color, pv.ram, pv.storage, pv.carrier, pv.sim_type, pv.identifier_mode, pv.variant_meta, pv.sort_order, pv.price, pv.cost
         FROM product_variants pv
         WHERE pv.product_id = ?
         ORDER BY pv.sort_order ASC, pv.id ASC`,
        [id]
      )

      const [unitRows] = await pool.query(
        `SELECT pvu.id, pvu.variant_id, pvu.imei, pvu.serial_no, pvu.warehouse_id, pvu.unit_meta, w.name AS warehouse_name
         FROM product_variant_units pvu
         LEFT JOIN warehouses w ON w.id = pvu.warehouse_id
         WHERE pvu.product_id = ? AND pvu.status = 'AVAILABLE'${unitsWarehouseFilter}
         ORDER BY pvu.variant_id ASC, pvu.id ASC`,
        variantParams
      )

      const unitsByVariant = new Map()
      for (const row of (unitRows || [])) {
        const variantId = Number(row.variant_id || 0)
        const currentUnits = unitsByVariant.get(variantId) || []
        currentUnits.push({
          id: Number(row.id || 0),
          imei: row.imei || undefined,
          serialNo: row.serial_no || undefined,
          warehouseId: row.warehouse_id ? Number(row.warehouse_id) : null,
          warehouseName: row.warehouse_name || 'Sin almacén',
          meta: parseStoredVariantUnitMeta(row.unit_meta),
        })
        unitsByVariant.set(variantId, currentUnits)
      }

      variants = (variantRows || []).map(row => {
        const variantId = Number(row.id || 0)
        const variantUnits = unitsByVariant.get(variantId) || []
        return {
          id: variantId,
          name: row.name || '',
          sku: row.sku || undefined,
          color: row.color || undefined,
          ram: row.ram || undefined,
          storage: row.storage || undefined,
          carrier: row.carrier || undefined,
          simType: row.sim_type || undefined,
          identifierMode: normalizeVariantIdentifierMode(row.identifier_mode),
          price: Number(row.price || 0),
          cost: Number(row.cost || 0),
          stock: variantUnits.length,
          sortOrder: Number(row.sort_order || 0),
          meta: parseStoredVariantMeta(row.variant_meta),
          units: includeSensitive
            ? variantUnits
            : variantUnits.map(unit => ({ ...unit, meta: undefined })),
        }
      })
    }

    return res.json(sanitizeSensitiveProductFields({
      id: r.id,
      name: r.name,
      sku: r.sku,
      productCode: r.product_code || undefined,
      categoryId: r.category_id ?? undefined,
      brandId: r.brand_id ?? undefined,
      supplierId: r.supplier_id ?? undefined,
      price: Number(r.price ?? 0),
      price2: Number(r.price2 ?? 0),
      price3: Number(r.price3 ?? 0),
      cost: Number(r.cost ?? 0),
      avgCost: Number(r.avg_cost ?? r.cost ?? 0),
      lastCost: Number(r.last_cost ?? r.cost ?? 0),
      stock: Number(r.stock ?? 0),
      otherStock: Number(r.other_stock ?? 0),
      initialStock: Number(r.initial_stock ?? 0),
      minStock: Number(r.min_stock ?? 0),
      unit: r.unit || undefined,
      description: r.description || undefined,
      imageUrl: r.image_url || undefined,
      images: productImages,
      productType: type,
      altName: r.alt_name || undefined,
      genericName: r.generic_name || undefined,
      shelfLocation: r.shelf_location || undefined,
      trackingProfile: r.tracking_profile || undefined,
      trackingMeta: parseStoredTrackingMeta(r.tracking_meta),
      batches,
      imeis,
      serials,
      imeiDetails,
      serialDetails,
      variants: includeSensitive ? variants : variants.map(variant => ({ ...variant, cost: undefined })),
    }, includeSensitive))
  } catch (err) {
    console.error('Products GET by id error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// Obtener stock por almacén para un producto
router.get('/:id/warehouse-stock', authMiddleware, async (req, res) => {
  try {
    const productId = Number(req.params.id)
    if (!productId || Number.isNaN(productId)) {
      return res.status(400).json({ error: 'ID de producto inválido' })
    }
    const pool = await getPool()
    await ensureDefaultWarehouseId1(pool)
    await ensureWarehouseStockTable(pool)
    const preferredWarehouseId = Number(getUserWarehouseId(req.user) || 0)
    const [rows] = await pool.query(
      `SELECT
         w.id AS warehouseId,
         w.name AS warehouseName,
         COALESCE(pws.quantity, 0) AS quantity
       FROM warehouses w
       LEFT JOIN product_warehouse_stock pws
         ON pws.warehouse_id = w.id
        AND pws.product_id = ?
       ORDER BY
         CASE WHEN ? > 0 AND w.id = ? THEN 0 ELSE 1 END,
         w.name ASC`,
      [productId, preferredWarehouseId, preferredWarehouseId]
    )
    const items = (rows || []).map(r => ({
      warehouseId: Number(r.warehouseId),
      warehouseName: r.warehouseName,
      quantity: Number(r.quantity || 0),
    }))
    return res.json(items)
  } catch (err) {
    console.error('Products GET warehouse-stock error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// Transferir stock entre almacenes para un producto
router.post('/:id/warehouse-stock/transfer', authMiddleware, roleMiddleware(['ADMIN', 'ALMACEN']), async (req, res) => {
  try {
    const productId = Number(req.params.id)
    const { fromWarehouseId, toWarehouseId, quantity } = req.body || {}
    const isAdmin = isAdminUser(req.user)
    const userWarehouseId = getUserWarehouseId(req.user)
    const fromId = isAdmin ? Number(fromWarehouseId) : Number(userWarehouseId || 0)
    const toId = Number(toWarehouseId)
    const qty = Number(quantity)

    if (!productId || Number.isNaN(productId)) {
      return res.status(400).json({ error: 'ID de producto inválido' })
    }
    if (!fromId || !toId || Number.isNaN(fromId) || Number.isNaN(toId)) {
      return res.status(400).json({ error: 'IDs de almacén inválidos' })
    }
    if (!isAdmin && !userWarehouseId) {
      return res.status(400).json({ error: 'El usuario no tiene una tienda asignada para transferir' })
    }
    if (!isAdmin && Number(fromWarehouseId || 0) && Number(fromWarehouseId) !== Number(userWarehouseId)) {
      return res.status(403).json({ error: 'Solo puedes transferir desde tu tienda asignada' })
    }
    if (fromId === toId) {
      return res.status(400).json({ error: 'El almacén origen y destino deben ser distintos' })
    }
    if (!qty || Number.isNaN(qty) || qty <= 0) {
      return res.status(400).json({ error: 'Cantidad inválida' })
    }

    const pool = await getPool()
    await ensureDefaultWarehouseId1(pool)
    await ensureWarehouseStockTable(pool)
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()

      const [[productRow]] = await conn.query(
        'SELECT name, product_type FROM products WHERE id = ? LIMIT 1',
        [productId]
      )
      if (!productRow) {
        throw new Error('Producto no encontrado')
      }

      const normalizedProductType = String(productRow.product_type || '').toUpperCase()
      if (['IMEI', 'SERIAL', 'MEDICINAL', 'VARIANT_SERIALIZED'].includes(normalizedProductType)) {
        throw new Error(`El producto ${productRow.name} usa detalle por ${normalizedProductType === 'MEDICINAL' ? 'lotes' : normalizedProductType.toLowerCase()}. Usa el modulo de transferencias con seleccion detallada para evitar desfases.`)
      }
      
      // Registrar salida del origen
      await registerMovement({
        productId,
        warehouseId: fromId,
        type: 'TRANSFER_OUT',
        quantity: qty,
        notes: `Transferencia a almacén ${toId}`,
        userId: req.user?.id
      }, conn)

      // Registrar entrada al destino
      await registerMovement({
        productId,
        warehouseId: toId,
        type: 'TRANSFER_IN',
        quantity: qty,
        notes: `Transferencia desde almacén ${fromId}`,
        userId: req.user?.id
      }, conn)

      await conn.commit()
      return res.json({ ok: true })
    } catch (err) {
      try { await conn.rollback() } catch {}
      console.error('Products POST warehouse-stock/transfer txn error:', err)
      return res.status(400).json({ error: err.message || 'Error realizando transferencia' })
    } finally {
      conn.release()
    }
  } catch (err) {
    console.error('Products POST warehouse-stock/transfer error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

router.post('/', authMiddleware, productImagesUploadMiddleware, async (req, res) => {
  try {
    const { name, sku, productCode, categoryId, brandId, supplierId, price, price2, price3, cost, stock, initialStock, minStock, unit, description, productType, altName, genericName, shelfLocation, trackingProfile } = req.body
    const uploadedProductImages = collectUploadedProductImageFiles(req)
    const pool = await getPool()
    if (!await canWriteProducts(req, pool)) {
      return res.status(403).json({ error: 'No tienes permisos para crear productos' })
    }
    await ensureStoreBannerColumn(pool)
    await ensureTrackingColumns(pool)
    const enabledProductTypes = await getEnabledProductTypes(pool)
    const normalizedProductType = String(productType || 'GENERAL').trim().toUpperCase()
    if (!enabledProductTypes.includes(normalizedProductType)) {
      return res.status(400).json({ error: 'Ese tipo de producto está desactivado en la configuración del sistema' })
    }
    const variantsField = parseJsonArrayFieldDetailed(req.body, 'variants')
    const productImagesField = parseProductImagesInstructions(req.body?.productImages)
    if (normalizedProductType === 'VARIANT_SERIALIZED' && variantsField.error) {
      return res.status(400).json({ error: 'El campo variants debe ser un arreglo JSON válido para guardar variantes serializadas.', details: variantsField.error })
    }
    if (productImagesField.error) {
      return res.status(400).json({ error: productImagesField.error })
    }
    const productImagesValidationError = validateProductImagesInstructions(productImagesField.value, uploadedProductImages, [])
    if (productImagesValidationError) {
      return res.status(400).json({ error: productImagesValidationError })
    }
    const payload = {
      name,
      sku,
      productCode,
      categoryId,
      brandId,
      supplierId,
      price,
      price2,
      price3,
      cost,
      stock,
      initialStock,
      minStock,
      unit,
      description,
      productType: normalizedProductType,
      altName,
      genericName,
      shelfLocation,
      trackingProfile,
      trackingMeta: parseJsonObjectField(req.body, 'trackingMeta'),
      storeBannerPrincipal: String(req.body?.storeBannerPrincipal || '').trim() === '1',
      batches: parseJsonArrayField(req.body, 'batches'),
      imeis: parseJsonArrayField(req.body, 'imeis'),
      serials: parseJsonArrayField(req.body, 'serials'),
      variants: variantsField.value,
    }
    // #region debug-point A:post-products-request
    ;(()=>{import('node:fs').then(({readFileSync})=>{let u='http://127.0.0.1:7777/event',s='variant-save-error';try{const e=readFileSync('.dbg/variant-save-error.env','utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'A',location:'server/routes/products.js:router.post(/)',msg:'[DEBUG] incoming product create request',data:{productType:normalizedProductType,hasImage:uploadedProductImages.length>0,bodyVariantRawType:typeof req.body?.variants,bodyVariantRawLength:typeof req.body?.variants==='string'?req.body.variants.length:null,bodyVariantRawPreview:typeof req.body?.variants==='string'?req.body.variants.slice(0,180):null,parsedVariantsCount:Array.isArray(payload.variants)?payload.variants.length:0,name:String(name||''),sku:String(sku||'')},ts:Date.now()})}).catch(()=>{})}).catch(()=>{})})();
    // #endregion

    const result = await createProductAtomic({ pool, userId: req.user?.id, payload, imageUrl: null })
    if (result?.error) {
      return res.status(result.status || 400).json({ error: result.error, duplicate: result.duplicate })
    }
    const imageUpdate = await replaceProductImages({
      executor: pool,
      productId: result.id,
      currentImageUrl: null,
      instructions: productImagesField.value,
      uploadedFiles: uploadedProductImages,
    })
    if (imageUpdate?.error) {
      await pool.query('DELETE FROM products WHERE id = ?', [result.id])
      return res.status(400).json({ error: imageUpdate.error })
    }
    if (imageUpdate && Object.prototype.hasOwnProperty.call(imageUpdate, 'primaryImageUrl')) {
      await pool.query('UPDATE products SET image_url = ? WHERE id = ?', [imageUpdate.primaryImageUrl, result.id])
      result.imageUrl = imageUpdate.primaryImageUrl || undefined
      result.images = imageUpdate.images
    }
    return res.json(result)

  } catch (err) {
    // #region debug-point D:post-products-error
    ;(()=>{import('node:fs').then(({readFileSync})=>{let u='http://127.0.0.1:7777/event',s='variant-save-error';try{const e=readFileSync('.dbg/variant-save-error.env','utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'D',location:'server/routes/products.js:router.post(/):catch',msg:'[DEBUG] product create error',data:{name:err?.name||null,message:err?.message||null,code:err?.code||null,errno:err?.errno||null,sqlState:err?.sqlState||null,sqlMessage:err?.sqlMessage||null,stack:String(err?.stack||'').split('\n').slice(0,8)},ts:Date.now()})}).catch(()=>{})}).catch(()=>{})})();
    // #endregion
    console.error('Products POST error:', err)
    const isDup = err?.code === 'ER_DUP_ENTRY'
    if (isDup) {
      const m = String(err?.sqlMessage || err?.message || '')
      const match = m.match(/Duplicate entry '(.+?)' for key/i)
      const duplicate = match?.[1]
      if (m.includes('product_variant_units') || m.toLowerCase().includes('variant_unit_serial')) {
        return res.status(409).json({ error: 'Serie duplicada en unidad serializada', duplicate })
      }
      if (m.includes('product_variant_units') || m.toLowerCase().includes('variant_unit_imei')) {
        return res.status(409).json({ error: 'IMEI duplicado en unidad serializada', duplicate })
      }
      if (m.includes('product_variants') || m.toLowerCase().includes('variant') && m.toLowerCase().includes('sku')) {
        return res.status(409).json({ error: 'SKU de variante duplicado', duplicate })
      }
      if (m.includes('product_serials') || m.toLowerCase().includes('serial_no')) {
        return res.status(409).json({ error: 'Serial duplicado', duplicate })
      }
      if (m.includes('product_imeis') || m.toLowerCase().includes('imei')) {
        return res.status(409).json({ error: 'IMEI duplicado', duplicate })
      }
      if (m.toLowerCase().includes('product_code') || m.toLowerCase().includes('uniq_products_product_code')) {
        return res.status(409).json({ error: 'Codigo de producto duplicado', duplicate })
      }
      if (m.includes('products') || m.toLowerCase().includes('sku')) {
        return res.status(409).json({ error: 'SKU duplicado', duplicate })
      }
      return res.status(409).json({ error: 'Registro duplicado', duplicate })
    }
    return res.status(500).json({ error: 'Server error' })
  }
})

router.post('/import', authMiddleware, upload.single('file'), async (req, res) => {
  const filePath = req.file?.path
  try {
    const pool = await getPool()
    if (!await canWriteProducts(req, pool)) {
      return res.status(403).json({ error: 'No tienes permisos para crear productos' })
    }
    const enabledProductTypes = await getEnabledProductTypes(pool)
    if (!filePath) {
      return res.status(400).json({ error: 'Archivo requerido' })
    }

    const workbook = XLSXApi.readFile(filePath, { cellDates: true })
    const sheetName = workbook.SheetNames?.[0]
    if (!sheetName) {
      return res.status(400).json({ error: 'Archivo sin hojas' })
    }

    const ws = workbook.Sheets[sheetName]
    const rawRows = XLSXApi.utils.sheet_to_json(ws, { defval: '' })
    const rows = normalizeGroupedImeiSpreadsheetRows(rawRows)
    const errors = []
    const created = []

    for (let i = 0; i < rows.length; i++) {
      const rowNumber = i + 2
      try {
        const mapped = mapSpreadsheetRow(rows[i])
        const name = String(mapped.name || '').trim()
        if (!name) throw new Error('name/nombre es requerido')

        const productType = String(mapped.productType || 'GENERAL').trim().toUpperCase()
        if (!enabledProductTypes.includes(productType)) {
          throw new Error(`El tipo ${productType} está desactivado en la configuración del sistema`)
        }
        const payload = {
          name,
          sku: String(mapped.sku || '').trim(),
          productCode: String(mapped.productCode || '').trim(),
          categoryId: mapped.categoryId ? Number(mapped.categoryId) : null,
          brandId: mapped.brandId ? Number(mapped.brandId) : null,
          supplierId: mapped.supplierId ? Number(mapped.supplierId) : null,
          price: mapped.price !== '' ? Number(mapped.price) : 0,
          price2: mapped.price2 !== '' ? Number(mapped.price2) : 0,
          price3: mapped.price3 !== '' ? Number(mapped.price3) : 0,
          cost: mapped.cost !== '' ? Number(mapped.cost) : 0,
          initialStock: mapped.initialStock !== '' ? Number(mapped.initialStock) : undefined,
          minStock: mapped.minStock !== '' ? Number(mapped.minStock) : 0,
          unit: String(mapped.unit || '').trim(),
          description: String(mapped.description || '').trim(),
          productType,
          altName: String(mapped.altName || '').trim(),
          genericName: String(mapped.genericName || '').trim(),
          shelfLocation: String(mapped.shelfLocation || '').trim(),
          trackingProfile: String(mapped.trackingProfile || '').trim(),
          trackingMeta: parseJsonObjectField({ trackingMeta: mapped.trackingMeta }, 'trackingMeta'),
          batches: productType === 'MEDICINAL' ? parseJsonListOrThrow(mapped.batches, 'batches/lotes') : [],
          imeis: productType === 'IMEI' ? splitList(mapped.imeis) : [],
          serials: productType === 'SERIAL' ? splitList(mapped.serials) : [],
          variants: productType === 'VARIANT_SERIALIZED' ? parseJsonListOrThrow(mapped.variants, 'variants/variantes') : [],
        }

        const result = await createProductAtomic({ pool, userId: req.user?.id, payload, imageUrl: null })
        if (result?.error) {
          errors.push({ rowNumber, error: result.error, duplicate: result.duplicate })
          continue
        }
        created.push({ rowNumber, id: result.id, name })
      } catch (e) {
        const msg = String(e?.message || e)
        errors.push({ rowNumber, error: msg })
      }
    }

    return res.json({ ok: true, createdCount: created.length, errorCount: errors.length, created, errors })
  } catch (err) {
    console.error('Products import error:', err)
    return res.status(500).json({ error: err?.message || 'Error importando productos' })
  } finally {
    if (filePath) {
      try { await fs.unlink(filePath) } catch {}
    }
  }
})

router.put('/:id', authMiddleware, productImagesUploadMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const { name, sku, productCode, categoryId, brandId, supplierId, price, price2, price3, cost, stock, initialStock, minStock, unit, description, productType, altName, genericName, shelfLocation, trackingProfile } = req.body
    const pool = await getPool()
    if (!await canWriteProducts(req, pool)) {
      return res.status(403).json({ error: 'No tienes permisos para editar productos' })
    }
    await ensureStoreBannerColumn(pool)
    await ensureTrackingColumns(pool)
    const enabledProductTypes = await getEnabledProductTypes(pool)
    const uploadedProductImages = collectUploadedProductImageFiles(req)
    const [currRows] = await pool.query(
      `SELECT p.id, p.name, p.sku, p.product_code, p.category_id, p.brand_id, p.supplier_id, p.price, p.price2, p.price3, p.cost, p.avg_cost, p.last_cost,
              COALESCE(SUM(pws.quantity), 0) as stock, 
              (SELECT COALESCE(SUM(quantity), 0) FROM inventory_movements WHERE product_id = p.id AND type = 'INITIAL') as initial_stock,
              p.min_stock, p.unit, p.description, p.image_url, p.store_banner_principal, p.product_type, p.alt_name, p.generic_name, p.shelf_location, p.tracking_profile, p.tracking_meta
       FROM products p 
       LEFT JOIN product_warehouse_stock pws ON p.id = pws.product_id
       WHERE p.id = ?
       GROUP BY p.id
       LIMIT 1`,
      [id]
    )
    const current = currRows?.[0]
    if (!current) return res.status(404).json({ error: 'Not found' })
    await ensureLegacyProductImageRecord(pool, id, current.image_url)
    const existingProductImages = await getProductImages(pool, id)
    const currentType = String(current.product_type || 'GENERAL').toUpperCase()
    const has = (v) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '')
    const hasNum = (v) => has(v) && !isNaN(Number(v))

    // Sanear arrays recibidos
    const rawBatches = parseJsonArrayField(req.body, 'batches')
    const batches = rawBatches
      .map(b => ({
        batch_no: String(b?.batch_no ?? b?.batchNo ?? '').trim(),
        expiry_date: b?.expiry_date ?? b?.expiryDate ?? null,
        quantity: Number(b?.quantity ?? 0),
      }))
      .filter(b => b.batch_no.length > 0 && b.quantity > 0)
    const rawImeis = parseJsonArrayField(req.body, 'imeis')
    const imeis = rawImeis.map(x => String(x || '').trim()).filter(s => s.length > 0)
    const rawSerials = parseJsonArrayField(req.body, 'serials')
    const serials = rawSerials.map(x => String(x || '').trim()).filter(s => s.length > 0)
    const variantsField = parseJsonArrayFieldDetailed(req.body, 'variants')
    const productImagesField = parseProductImagesInstructions(req.body?.productImages)
    const variants = normalizeSerializedVariants(variantsField.value)
    const nextType = has(productType) ? String(productType).toUpperCase() : currentType
    if (nextType === 'VARIANT_SERIALIZED' && variantsField.error) {
      return res.status(400).json({ error: 'El campo variants debe ser un arreglo JSON válido para guardar variantes serializadas.', details: variantsField.error })
    }
    if (productImagesField.error) {
      return res.status(400).json({ error: productImagesField.error })
    }
    // #region debug-point C:put-products-normalized
    ;(()=>{import('node:fs').then(({readFileSync})=>{let u='http://127.0.0.1:7777/event',s='variant-save-error';try{const e=readFileSync('.dbg/variant-save-error.env','utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'C',location:'server/routes/products.js:router.put(/:id)',msg:'[DEBUG] incoming product update request',data:{productId:id,currentType,nextType,hasImageUploads:uploadedProductImages.length>0,rawVariantLength:typeof req.body?.variants==='string'?req.body.variants.length:null,normalizedVariantsCount:Array.isArray(variants)?variants.length:0,variantUnitCounts:Array.isArray(variants)?variants.map(variant=>({name:variant.name,identifierMode:variant.identifierMode,units:Array.isArray(variant.units)?variant.units.length:0,warehouses:Array.isArray(variant.units)?[...new Set(variant.units.map(unit=>Number(unit.warehouseId||0)||0))]:[]})):[]},ts:Date.now()})}).catch(()=>{})}).catch(()=>{})})();
    // #endregion
    if (has(productType) && !enabledProductTypes.includes(nextType)) {
      return res.status(400).json({ error: 'Ese tipo de producto está desactivado en la configuración del sistema' })
    }
    let derivedStock = hasNum(stock) ? Number(stock) : Number(current.stock || 0)
    if (nextType === 'MEDICINAL') derivedStock = sumQuantity(batches, 'quantity')
    else if (nextType === 'IMEI') derivedStock = imeis.length
    else if (nextType === 'SERIAL') derivedStock = serials.length
    else if (nextType === 'VARIANT_SERIALIZED') derivedStock = variants.reduce((sum, variant) => sum + variant.units.length, 0)

    const immutableTrackedTypes = new Set(['IMEI', 'SERIAL', 'VARIANT_SERIALIZED'])
    if (currentType !== nextType && (immutableTrackedTypes.has(currentType) || immutableTrackedTypes.has(nextType))) {
      return res.status(400).json({
        error: 'No puedes cambiar el tipo de un producto con trazabilidad IMEI/SERIAL/variantes serializadas desde editar producto. Usa un producto nuevo o un proceso controlado de migracion.'
      })
    }

    const nextName = has(name) ? name : current.name
    const nextSku = has(sku) ? normalizeOptionalIdentifier(sku) : normalizeOptionalIdentifier(current.sku)
    const nextProductCode = has(productCode) ? normalizeOptionalIdentifier(productCode) : normalizeOptionalIdentifier(current.product_code)
    const nextCategoryId = hasNum(categoryId) ? Number(categoryId) : (current.category_id ?? null)
    const nextBrandId = hasNum(brandId) ? Number(brandId) : (current.brand_id ?? null)
    const nextSupplierId = hasNum(supplierId) ? Number(supplierId) : (current.supplier_id ?? null)
    const nextPrice = hasNum(price) ? Number(price) : Number(current.price ?? 0)
    const nextPrice2 = hasNum(price2) ? Number(price2) : Number(current.price2 ?? 0)
    const nextPrice3 = hasNum(price3) ? Number(price3) : Number(current.price3 ?? 0)
    const nextCost = hasNum(cost) ? Number(cost) : Number(current.avg_cost ?? current.cost ?? 0)
    const nextStock = Number(derivedStock)
    const nextInitialStock = hasNum(initialStock) ? Number(initialStock) : Number((current.initial_stock ?? current.stock ?? 0))
    const nextMinStock = hasNum(minStock) ? Number(minStock) : Number(current.min_stock ?? 0)
    const nextUnit = has(unit) ? unit : (current.unit || null)
    const nextDescription = has(description) ? description : (current.description || null)
    const nextImage = current.image_url ?? null
    const nextAltName = has(altName) ? altName : (current.alt_name || null)
    const nextGenericName = has(genericName) ? genericName : (current.generic_name || null)
    const nextShelfLocation = has(shelfLocation) ? shelfLocation : (current.shelf_location || null)
    const nextTrackingProfile = nextType === 'MEDICINAL'
      ? normalizeTrackingProfile(has(trackingProfile) ? trackingProfile : current.tracking_profile, nextType)
      : null
    const nextTrackingMeta = (nextType === 'MEDICINAL' || nextType === 'VARIANT_SERIALIZED')
      ? sanitizeTrackingMeta(parseJsonObjectField(req.body, 'trackingMeta') || parseStoredTrackingMeta(current.tracking_meta))
      : null
    const nextStoreBannerPrincipal = req.body?.storeBannerPrincipal === undefined
      ? Boolean(Number(current.store_banner_principal || 0))
      : String(req.body.storeBannerPrincipal || '').trim() === '1'
    await ensureUniqueProductIdentifiers(pool, { sku: nextSku, productCode: nextProductCode, excludeProductId: id })

    // Reglas de conteo para IMEI/SERIAL: requerir cantidad exacta según stock inicial
    // REMOVED: Stock logic is now handled via purchases/adjustments

    // Validar duplicados dentro del mismo envío (protección backend)
    if (nextType === 'IMEI' && imeis.length) {
      const dupList = [...new Set(imeis.filter((v, i, arr) => arr.indexOf(v) !== i))]
      if (dupList.length > 0) {
        return res.status(409).json({ error: 'Valores duplicados detectados en IMEIs', duplicate: dupList.join(', ') })
      }
    } else if (nextType === 'SERIAL' && serials.length) {
      const dupList = [...new Set(serials.filter((v, i, arr) => arr.indexOf(v) !== i))]
      if (dupList.length > 0) {
        return res.status(409).json({ error: 'Valores duplicados detectados en series', duplicate: dupList.join(', ') })
      }
    } else if (nextType === 'VARIANT_SERIALIZED') {
      if (hasSerializedVariantUnits(variants)) {
        return res.status(400).json({
          error: 'Las unidades IMEI/Serie de variantes se ingresan desde Compras o Ajustes de Stock, no desde Productos.'
        })
      }
      const currentStoredDeviceCategory = inferSerializedDeviceCategoryFromProductRecord(current)

      if (variants.length > 0) {
        const compatibilityError = validateSerializedVariantCompatibility(variants)
        if (compatibilityError) {
          return res.status(400).json({ error: compatibilityError })
        }
      }

      const [currentVariantRows] = await pool.query(
        `SELECT identifier_mode, variant_meta
         FROM product_variants
         WHERE product_id = ?
         ORDER BY sort_order ASC, id ASC`,
        [id]
      )
      if (Array.isArray(currentVariantRows) && currentVariantRows.length > 0 && variants.length > 0) {
        const currentDeviceCategory = currentStoredDeviceCategory || inferSerializedDeviceCategoryFromVariantRecord(currentVariantRows[0])
        const nextDeviceCategory = normalizeSerializedDeviceCategory(
          variants[0]?.meta?.deviceCategory || variants[0]?.deviceCategory || (variants[0]?.identifierMode === 'SERIAL' ? 'DEVICE_SERIAL' : 'PHONE_IMEI')
        ) || 'PHONE_IMEI'
        if (currentDeviceCategory !== nextDeviceCategory) {
          return res.status(400).json({
            error: 'No puedes cambiar la categoria del dispositivo en un producto serializado ya creado. Conserva la categoria original y edita solo las variantes compatibles.'
          })
        }
      }
      if (currentStoredDeviceCategory && variants.length > 0) {
        const nextDeviceCategory = normalizeSerializedDeviceCategory(
          variants[0]?.meta?.deviceCategory || variants[0]?.deviceCategory || (variants[0]?.identifierMode === 'SERIAL' ? 'DEVICE_SERIAL' : 'PHONE_IMEI')
        ) || 'PHONE_IMEI'
        if (currentStoredDeviceCategory !== nextDeviceCategory) {
          return res.status(400).json({
            error: 'No puedes cambiar la categoria del dispositivo en un producto serializado ya creado. Conserva la categoria original y edita solo las variantes compatibles.'
          })
        }
      }

      const repeatedVariantSku = [...new Set(variants.map(variant => variant.sku).filter(Boolean).filter((value, index, arr) => arr.indexOf(value) !== index))]
      if (repeatedVariantSku.length > 0) {
        return res.status(409).json({ error: 'SKU duplicado entre variantes', duplicate: repeatedVariantSku.join(', ') })
      }
    }

    // Verificar duplicados ANTES de hacer cualquier cambio contra la base de datos
    if (nextType === 'IMEI' && imeis.length) {
      for (const imei of imeis) {
        const [dupRows] = await pool.query('SELECT id FROM product_imeis WHERE imei = ? AND product_id != ?', [imei, id])
        if (dupRows.length > 0) {
          throw { code: 'ER_DUP_ENTRY', sqlMessage: `Duplicate entry '${imei}' for key 'uniq_imei'`, message: 'IMEI duplicado' }
        }
      }
    } else if (nextType === 'VARIANT_SERIALIZED') {
      const [variantUnitRows] = await pool.query(
        `SELECT COUNT(*) AS total
         FROM product_variant_units
         WHERE product_id = ? AND status = 'AVAILABLE'`,
        [id]
      )
      const activeVariantUnitCount = Number(variantUnitRows?.[0]?.total || 0)

      if (activeVariantUnitCount > 0) {
        return res.status(400).json({
          error: 'Para editar variantes serializadas, el producto debe estar sin stock. Con stock existente, gestiona las unidades desde compras, ajustes o una migracion controlada.'
        })
      }

      for (const variant of variants) {
        if (variant.sku) {
          const [dupVariantSkuRows] = await pool.query('SELECT id FROM product_variants WHERE UPPER(TRIM(COALESCE(sku, ""))) = ? AND product_id <> ? LIMIT 1', [variant.sku, id])
          if (Array.isArray(dupVariantSkuRows) && dupVariantSkuRows.length > 0) {
            throw { code: 'ER_DUP_ENTRY', sqlMessage: `Duplicate entry '${variant.sku}' for key 'product_variants.sku'`, message: 'SKU de variante duplicado' }
          }
        }
      }
    }

    // Usar una sola conexión para la transacción completa
    // Asegurar tablas auxiliares y almacén por defecto
    await ensureDefaultWarehouseId1(pool)
    await ensureWarehouseStockTable(pool)
    await ensureStoreBannerColumn(pool)
    await ensureTrackingColumns(pool)
    await ensureSerializedVariantStructures(pool)
    await ensureProductImagesTable(pool)

    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()

      // Actualizar tabla products con stock tienda/bodega
      await conn.query(
        'UPDATE products SET name = ?, sku = ?, product_code = ?, category_id = ?, brand_id = ?, supplier_id = ?, price = ?, price2 = ?, price3 = ?, cost = ?, avg_cost = ?, last_cost = ?, min_stock = ?, unit = ?, description = ?, image_url = ?, store_banner_principal = ?, product_type = ?, alt_name = ?, generic_name = ?, shelf_location = ?, tracking_profile = ?, tracking_meta = ? WHERE id = ?',
        [
          nextName,
          nextSku,
          nextProductCode,
          nextCategoryId,
          nextBrandId,
          nextSupplierId,
          nextPrice,
          nextPrice2,
          nextPrice3,
          nextCost,
          nextCost,
          nextCost,
          nextMinStock,
          nextUnit,
          nextDescription,
          nextImage,
          nextStoreBannerPrincipal ? 1 : 0,
          nextType,
          nextAltName,
          nextGenericName,
          nextShelfLocation,
          nextTrackingProfile,
          nextTrackingMeta ? JSON.stringify(nextTrackingMeta) : null,
          id,
        ]
      )

      if (nextStoreBannerPrincipal) {
        await conn.query('UPDATE products SET store_banner_principal = 0 WHERE id <> ?', [id])
      }

      // NOTA: No sobrescribimos product_warehouse_stock con initial_stock aquí porque
      // eso resetearía el stock real del almacén al valor inicial cada vez que se edita el producto.
      // Solo actualizamos si es un producto nuevo o si queremos forzar el reinicio (lo cual debería ser otra operación).
      // Si se desea actualizar el stock del almacén 1 al editar el "initial_stock", descomentar con precaución.
      /*
      await conn.query(
        'INSERT INTO product_warehouse_stock (product_id, warehouse_id, quantity) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)',
        [id, Number(nextInitialStock || 0)]
      )
      */


      await conn.query('DELETE FROM product_batches WHERE product_id = ?', [id])
      if (nextType !== 'IMEI') {
        await conn.query('DELETE FROM product_imeis WHERE product_id = ?', [id])
      }
      if (nextType !== 'SERIAL') {
        await conn.query('DELETE FROM product_serials WHERE product_id = ?', [id])
      }
      await conn.query('DELETE FROM product_variant_units WHERE product_id = ?', [id])
      await conn.query('DELETE FROM product_variants WHERE product_id = ?', [id])

      if (nextType === 'MEDICINAL' && batches.length) {
        await Promise.all(
          batches.map(b =>
            conn.query('INSERT INTO product_batches (product_id, batch_no, expiry_date, quantity) VALUES (?, ?, ?, ?)', [id, b.batch_no, b.expiry_date, Number(b.quantity || 0)])
          )
        )
      } else if (nextType === 'IMEI' && currentType !== 'IMEI' && imeis.length) {
        await Promise.all(imeis.map(imei => conn.query('INSERT INTO product_imeis (product_id, imei) VALUES (?, ?)', [id, String(imei || '')])))
      } else if (nextType === 'SERIAL' && currentType !== 'SERIAL' && serials.length) {
        await Promise.all(serials.map(serial => conn.query('INSERT INTO product_serials (product_id, serial_no) VALUES (?, ?)', [id, String(serial || '')])))
      } else if (nextType === 'VARIANT_SERIALIZED' && variants.length) {
        for (const variant of variants) {
          await conn.query(
            `INSERT INTO product_variants
             (product_id, name, sku, color, ram, storage, carrier, sim_type, identifier_mode, variant_meta, sort_order, stock, price, cost)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id,
              variant.name,
              variant.sku,
              variant.color,
              variant.ram,
              variant.storage,
              variant.carrier,
              variant.simType,
              variant.identifierMode,
              variant.meta ? JSON.stringify(variant.meta) : null,
              Number(variant.sortOrder || 0),
              0,
              Number(variant.price || 0),
              Number(variant.cost || 0),
            ]
          )
        }
        await conn.query('DELETE FROM product_warehouse_stock WHERE product_id = ?', [id])
      }

      // Confirmar transacción
      await conn.commit()
      const imageUpdate = await replaceProductImages({
        executor: pool,
        productId: id,
        currentImageUrl: current.image_url,
        instructions: productImagesField.value,
        uploadedFiles: uploadedProductImages,
      })
      if (imageUpdate?.error) {
        return res.status(400).json({ error: imageUpdate.error })
      }
      if (imageUpdate && Object.prototype.hasOwnProperty.call(imageUpdate, 'primaryImageUrl')) {
        await pool.query('UPDATE products SET image_url = ? WHERE id = ?', [imageUpdate.primaryImageUrl, id])
      }

      const [rows2] = await conn.query(
        `SELECT p.id, p.name, p.sku, p.product_code, p.category_id, p.brand_id, p.supplier_id, p.price, p.price2, p.price3, p.cost, p.avg_cost, p.last_cost,
                COALESCE(SUM(pws.quantity), 0) as stock, 
                (SELECT COALESCE(SUM(quantity), 0) FROM inventory_movements WHERE product_id = p.id AND type = 'INITIAL') as initial_stock,
                p.min_stock, p.unit, p.description, p.image_url, p.store_banner_principal, p.product_type, p.alt_name, p.generic_name, p.shelf_location, p.tracking_profile, p.tracking_meta
         FROM products p 
         LEFT JOIN product_warehouse_stock pws ON p.id = pws.product_id
         WHERE p.id = ?
         GROUP BY p.id
         LIMIT 1`,
        [id]
      )
      const r = rows2?.[0]
      if (!r) return res.status(404).json({ error: 'Not found' })
      const responseImages = imageUpdate?.images || existingProductImages
      return res.json({
        id: r.id,
        name: r.name,
        sku: r.sku,
        productCode: r.product_code || undefined,
        categoryId: r.category_id ?? undefined,
        brandId: r.brand_id ?? undefined,
        supplierId: r.supplier_id ?? undefined,
        price: Number(r.price ?? 0),
        price2: Number(r.price2 ?? 0),
        price3: Number(r.price3 ?? 0),
        cost: Number(r.cost ?? 0),
        avgCost: Number(r.avg_cost ?? r.cost ?? 0),
        lastCost: Number(r.last_cost ?? r.cost ?? 0),
        stock: Number(r.stock ?? 0),
        initialStock: Number(r.initial_stock ?? 0),
        minStock: Number(r.min_stock ?? 0),
        unit: r.unit || undefined,
        description: r.description || undefined,
        imageUrl: r.image_url || undefined,
        images: responseImages,
        storeBannerPrincipal: Boolean(Number(r.store_banner_principal || 0)),
        productType: r.product_type || undefined,
        altName: r.alt_name || undefined,
        genericName: r.generic_name || undefined,
        shelfLocation: r.shelf_location || undefined,
        trackingProfile: r.tracking_profile || undefined,
        trackingMeta: parseStoredTrackingMeta(r.tracking_meta),
      })
    } catch (transactionErr) {
      // Rollback en caso de error dentro de la transacción
      await conn.rollback()
      throw transactionErr
    } finally {
      conn.release()
    }
  } catch (err) {
    // #region debug-point E:put-products-error
    ;(()=>{import('node:fs').then(({readFileSync})=>{let u='http://127.0.0.1:7777/event',s='variant-save-error';try{const e=readFileSync('.dbg/variant-save-error.env','utf8');u=e.match(/DEBUG_SERVER_URL=(.+)/)?.[1]||u;s=e.match(/DEBUG_SESSION_ID=(.+)/)?.[1]||s}catch{}fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:s,runId:'pre-fix',hypothesisId:'E',location:'server/routes/products.js:router.put(/:id):catch',msg:'[DEBUG] product update error',data:{name:err?.name||null,message:err?.message||null,code:err?.code||null,errno:err?.errno||null,sqlState:err?.sqlState||null,sqlMessage:err?.sqlMessage||null,stack:String(err?.stack||'').split('\n').slice(0,8)},ts:Date.now()})}).catch(()=>{})}).catch(()=>{})})();
    // #endregion
    console.error('Products PUT error:', err)
    const isDup = err?.code === 'ER_DUP_ENTRY'
    if (isDup) {
      const m = String(err?.sqlMessage || err?.message || '')
      const match = m.match(/Duplicate entry '(.+?)' for key/i)
      const duplicate = match?.[1]
      if (m.includes('product_variant_units') || m.toLowerCase().includes('variant_unit_serial')) {
        return res.status(409).json({ error: 'Serie duplicada en unidad serializada', duplicate })
      }
      if (m.includes('product_variant_units') || m.toLowerCase().includes('variant_unit_imei')) {
        return res.status(409).json({ error: 'IMEI duplicado en unidad serializada', duplicate })
      }
      if (m.includes('product_variants') || m.toLowerCase().includes('variant') && m.toLowerCase().includes('sku')) {
        return res.status(409).json({ error: 'SKU de variante duplicado', duplicate })
      }
      if (m.includes('product_serials') || m.toLowerCase().includes('serial_no')) {
        return res.status(409).json({ error: 'Serial duplicado', duplicate })
      }
      if (m.includes('product_imeis') || m.toLowerCase().includes('imei')) {
        return res.status(409).json({ error: 'IMEI duplicado', duplicate })
      }
      if (m.toLowerCase().includes('product_code') || m.toLowerCase().includes('uniq_products_product_code')) {
        return res.status(409).json({ error: 'Codigo de producto duplicado', duplicate })
      }
      if (m.includes('products') || m.toLowerCase().includes('sku')) {
        return res.status(409).json({ error: 'SKU duplicado', duplicate })
      }
      return res.status(409).json({ error: 'Registro duplicado', duplicate })
    }
    return res.status(500).json({ error: 'Server error' })
  }
})

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const pool = await getPool()
    if (!await canWriteProducts(req, pool)) {
      return res.status(403).json({ error: 'No tienes permisos para eliminar productos' })
    }
    await ensureWarehouseStockTable(pool)

    const [rows] = await pool.query(
      `SELECT p.id, COALESCE(SUM(pws.quantity), 0) AS stock
       FROM products p
       LEFT JOIN product_warehouse_stock pws ON p.id = pws.product_id
       WHERE p.id = ?
       GROUP BY p.id
       LIMIT 1`,
      [id]
    )

    const product = Array.isArray(rows) ? rows[0] : null
    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' })
    }

    if (Number(product.stock || 0) > 0) {
      return res.status(409).json({
        error: 'No se puede eliminar un producto con stock. Ajusta el inventario a 0 antes de eliminarlo.',
      })
    }

    await pool.query('DELETE FROM product_batches WHERE product_id = ?', [id])
    await pool.query('DELETE FROM product_imeis WHERE product_id = ?', [id])
    await pool.query('DELETE FROM product_serials WHERE product_id = ?', [id])
    await pool.query('DELETE FROM product_variant_units WHERE product_id = ?', [id])
    await pool.query('DELETE FROM product_variants WHERE product_id = ?', [id])
    await pool.query('DELETE FROM product_warehouse_stock WHERE product_id = ?', [id])
    await pool.query('DELETE FROM products WHERE id = ?', [id])
    return res.json({ ok: true })
  } catch (err) {
    console.error('Products DELETE error:', err)
    if (err?.code === 'ER_ROW_IS_REFERENCED_2' || err?.code === 'ER_ROW_IS_REFERENCED') {
      return res.status(409).json({
        error: 'No se puede eliminar el producto porque tiene movimientos o documentos asociados.',
      })
    }
    return res.status(500).json({ error: 'Server error' })
  }
})

export {
  isGroupedImeiSpreadsheetFormat,
  normalizeGroupedImeiSpreadsheetRows,
  normalizeSerializedVariants,
  parseJsonArrayFieldDetailed,
  readCaseInsensitiveValue,
  validateSerializedVariantCompatibility,
}

export default router
