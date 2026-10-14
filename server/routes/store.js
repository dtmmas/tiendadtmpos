import express from 'express'
import { authMiddleware, roleMiddleware } from '../auth.js'
import { getPool } from '../db.js'
import { ensureSalesSchema } from './sales.js'
import { registerMovement } from '../services/inventory.js'

const router = express.Router()

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

async function ensureBrandLogoColumn(pool) {
  const [rows] = await pool.query(
    `SELECT 1
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'brands'
       AND COLUMN_NAME = 'logo_url'
     LIMIT 1`
  )
  if (Array.isArray(rows) && rows.length > 0) return
  await pool.query('ALTER TABLE brands ADD COLUMN logo_url VARCHAR(255) NULL DEFAULT NULL AFTER name')
}

async function ensureStoreFeatureColumns(pool) {
  const requiredColumns = [
    ['enabled', "ALTER TABLE store_settings ADD COLUMN enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER id"],
    ['catalog_enabled', "ALTER TABLE store_settings ADD COLUMN catalog_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER enabled"],
    ['cart_enabled', "ALTER TABLE store_settings ADD COLUMN cart_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER catalog_enabled"],
    ['checkout_enabled', "ALTER TABLE store_settings ADD COLUMN checkout_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER cart_enabled"],
    ['favorites_enabled', "ALTER TABLE store_settings ADD COLUMN favorites_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER checkout_enabled"],
    ['recommendations_enabled', "ALTER TABLE store_settings ADD COLUMN recommendations_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER favorites_enabled"],
    ['banner_product_id', "ALTER TABLE store_settings ADD COLUMN banner_product_id INT NULL DEFAULT NULL AFTER recommendations_enabled"],
    ['banner_product_id_2', "ALTER TABLE store_settings ADD COLUMN banner_product_id_2 INT NULL DEFAULT NULL AFTER banner_product_id"],
    ['banner_product_id_3', "ALTER TABLE store_settings ADD COLUMN banner_product_id_3 INT NULL DEFAULT NULL AFTER banner_product_id_2"],
    ['banner_product_id_4', "ALTER TABLE store_settings ADD COLUMN banner_product_id_4 INT NULL DEFAULT NULL AFTER banner_product_id_3"],
    ['online_price_mode', "ALTER TABLE store_settings ADD COLUMN online_price_mode VARCHAR(30) NOT NULL DEFAULT 'PRICE3' AFTER banner_product_id_4"],
    ['online_cost_adjustment_percent', "ALTER TABLE store_settings ADD COLUMN online_cost_adjustment_percent DECIMAL(8,2) NOT NULL DEFAULT 0 AFTER online_price_mode"],
  ]

  for (const [columnName, statement] of requiredColumns) {
    const [rows] = await pool.query(
      `SELECT 1
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'store_settings'
         AND COLUMN_NAME = ?
       LIMIT 1`,
      [columnName]
    )
    if (Array.isArray(rows) && rows.length > 0) continue
    await pool.query(statement)
  }
}

async function ensureStorePricingOverrideTable(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS store_product_pricing_overrides (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    adjustment_percent DECIMAL(8,2) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_store_product_override (product_id)
  )`)
}

function normalizeBannerProductIds(input) {
  const values = Array.isArray(input) ? input : input == null ? [] : [input]
  const unique = []
  for (const value of values) {
    const id = Number(value || 0)
    if (!Number.isInteger(id) || id <= 0 || unique.includes(id)) continue
    unique.push(id)
    if (unique.length >= 4) break
  }
  return unique
}

function getBannerProductIds(settings) {
  return normalizeBannerProductIds([
    settings?.banner_product_id,
    settings?.banner_product_id_2,
    settings?.banner_product_id_3,
    settings?.banner_product_id_4,
  ])
}

function roundCurrency(value) {
  return Math.round(Number(value || 0) * 100) / 100
}

function normalizeOnlinePricingMode(value) {
  const normalized = String(value || '').trim().toUpperCase()
  return normalized === 'COST_PLUS_PERCENT' ? 'COST_PLUS_PERCENT' : 'PRICE3'
}

function normalizeOnlineAdjustmentPercent(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(-99.99, Math.min(9999.99, roundCurrency(numeric)))
}

function normalizeProductPricingOverrides(input) {
  const values = Array.isArray(input) ? input : []
  const deduped = new Map()
  for (const entry of values) {
    const productId = Number(entry?.productId || 0)
    if (!Number.isInteger(productId) || productId <= 0) continue
    deduped.set(productId, {
      productId,
      adjustmentPercent: normalizeOnlineAdjustmentPercent(entry?.adjustmentPercent || 0),
    })
  }
  return Array.from(deduped.values())
}

async function getStoreProductPricingOverrideMap(pool) {
  await ensureStorePricingOverrideTable(pool)
  const [rows] = await pool.query(
    `SELECT product_id AS productId, adjustment_percent AS adjustmentPercent
     FROM store_product_pricing_overrides`
  )
  return new Map((rows || []).map((row) => [Number(row.productId || 0), Number(row.adjustmentPercent || 0)]))
}

async function getStoreProductPricingOverrides(pool, settings) {
  await ensureStorePricingOverrideTable(pool)
  const activeSettings = settings || await getSettings(pool)
  const [rows] = await pool.query(
    `SELECT spo.product_id AS productId,
            spo.adjustment_percent AS adjustmentPercent,
            p.name,
            p.sku,
            p.image_url AS imageUrl,
            p.price,
            p.price3,
            p.avg_cost AS avgCost,
            p.cost
     FROM store_product_pricing_overrides spo
     INNER JOIN products p ON p.id = spo.product_id
     ORDER BY p.name ASC, p.id ASC`
  )

  return (rows || []).map((row) => {
    const pricing = computeOnlineProductPricing(row, activeSettings, Number(row.adjustmentPercent || 0))
    return {
      productId: Number(row.productId || 0),
      adjustmentPercent: Number(row.adjustmentPercent || 0),
      name: row.name || '',
      sku: row.sku || '',
      imageUrl: row.imageUrl || null,
      effectivePrice: pricing.price,
    }
  })
}

function computeOnlineProductPricing(product, settings, overrideAdjustmentPercent = null) {
  const priceMode = normalizeOnlinePricingMode(settings?.online_price_mode)
  const adjustmentPercent = normalizeOnlineAdjustmentPercent(
    overrideAdjustmentPercent == null
      ? settings?.online_cost_adjustment_percent
      : overrideAdjustmentPercent
  )
  const baseCost = roundCurrency(product?.avg_cost ?? product?.avgCost ?? product?.cost ?? 0)
  const basePrice3 = roundCurrency(product?.price3 || 0)
  const compareCandidates = [
    roundCurrency(product?.price || 0),
    basePrice3,
  ].filter((value) => value > 0)

  let computedPrice = basePrice3
  if (priceMode === 'COST_PLUS_PERCENT' && baseCost > 0) {
    computedPrice = roundCurrency(baseCost * (1 + (adjustmentPercent / 100)))
  }

  const compareAtPrice = compareCandidates.reduce((max, current) => (current > max ? current : max), 0)

  return {
    priceMode,
    adjustmentPercent,
    baseCost,
    price: computedPrice > 0 ? computedPrice : 0,
    compareAtPrice: compareAtPrice > computedPrice ? compareAtPrice : 0,
  }
}

function normalizeFulfillmentType(value) {
  const v = String(value || '').trim().toUpperCase()
  if (v === 'PICKUP') return 'PICKUP'
  return 'DELIVERY'
}

function normalizePaymentProvider(value) {
  const v = String(value || '').trim().toUpperCase()
  if (v === 'TRANSFER') return 'TRANSFER'
  return 'STRIPE'
}

function normalizeCutoffTime(value) {
  const raw = String(value || '').trim()
  if (!raw) return '11:00:00'
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) return '11:00:00'
  const hh = String(Math.min(Math.max(Number(match[1]), 0), 23)).padStart(2, '0')
  const mm = String(Math.min(Math.max(Number(match[2]), 0), 59)).padStart(2, '0')
  const ss = String(Math.min(Math.max(Number(match[3] || 0), 0), 59)).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function timeToMinutes(time) {
  const s = String(time || '').trim()
  const match = s.match(/^(\d{1,2}):(\d{2})/)
  if (!match) return 0
  return Number(match[1]) * 60 + Number(match[2])
}

function todayMinutes() {
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes()
}

function nextBusinessDate() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function makeOrderCode() {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `ONL-${yyyy}${mm}${dd}-${hh}${mi}${ss}-${rand}`
}

async function getSettings(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS store_settings (
    id INT PRIMARY KEY,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    catalog_enabled TINYINT(1) NOT NULL DEFAULT 1,
    cart_enabled TINYINT(1) NOT NULL DEFAULT 1,
    checkout_enabled TINYINT(1) NOT NULL DEFAULT 1,
    favorites_enabled TINYINT(1) NOT NULL DEFAULT 1,
    recommendations_enabled TINYINT(1) NOT NULL DEFAULT 1,
    banner_product_id INT NULL DEFAULT NULL,
    banner_product_id_2 INT NULL DEFAULT NULL,
    banner_product_id_3 INT NULL DEFAULT NULL,
    banner_product_id_4 INT NULL DEFAULT NULL,
    online_price_mode VARCHAR(30) NOT NULL DEFAULT 'PRICE3',
    online_cost_adjustment_percent DECIMAL(8,2) NOT NULL DEFAULT 0,
    currency VARCHAR(8) NOT NULL DEFAULT 'GTQ',
    online_warehouse_id INT NOT NULL DEFAULT 1,
    cutoff_time TIME NOT NULL DEFAULT '11:00:00',
    accept_after_cutoff VARCHAR(20) NOT NULL DEFAULT 'SCHEDULE',
    pickup_enabled TINYINT(1) NOT NULL DEFAULT 1,
    delivery_enabled TINYINT(1) NOT NULL DEFAULT 1,
    pickup_notes TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`)
  await ensureStoreFeatureColumns(pool)
  await pool.query(
    `INSERT IGNORE INTO store_settings (id, enabled, catalog_enabled, cart_enabled, checkout_enabled, favorites_enabled, recommendations_enabled, banner_product_id, currency, online_warehouse_id, cutoff_time, accept_after_cutoff, pickup_enabled, delivery_enabled)
     VALUES (1, 1, 1, 1, 1, 1, 1, NULL, 'GTQ', 1, '11:00:00', 'SCHEDULE', 1, 1)`
  )
  const [rows] = await pool.query('SELECT * FROM store_settings WHERE id = 1 LIMIT 1')
  const settings = rows?.[0] || null
  let systemCurrency = 'GTQ'
  try {
    const [configRows] = await pool.query('SELECT currency FROM system_config WHERE id = 1 LIMIT 1')
    const configuredCurrency = String(configRows?.[0]?.currency || '').trim().toUpperCase()
    if (configuredCurrency) systemCurrency = configuredCurrency
  } catch {}
  return settings ? { ...settings, currency: systemCurrency } : {
    currency: systemCurrency,
    enabled: 1,
    catalog_enabled: 1,
    cart_enabled: 1,
    checkout_enabled: 1,
    favorites_enabled: 1,
    recommendations_enabled: 1,
    banner_product_id: null,
    banner_product_id_2: null,
    banner_product_id_3: null,
    banner_product_id_4: null,
    online_price_mode: 'PRICE3',
    online_cost_adjustment_percent: 0,
    online_warehouse_id: 1,
    cutoff_time: '11:00:00',
    accept_after_cutoff: 'SCHEDULE',
    pickup_enabled: 1,
    delivery_enabled: 1,
    pickup_notes: '',
  }
}

async function ensureOnlineTables(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS shipping_zones (
    id INT AUTO_INCREMENT PRIMARY KEY,
    department VARCHAR(120) NOT NULL,
    municipality VARCHAR(120) NOT NULL,
    fee DECIMAL(12,2) NOT NULL DEFAULT 0,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_shipping_zone (department, municipality)
  )`)
  await pool.query(`CREATE TABLE IF NOT EXISTS online_orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_code VARCHAR(40) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING_PAYMENT',
    currency VARCHAR(8) NOT NULL DEFAULT 'GTQ',
    fulfillment_type VARCHAR(20) NOT NULL DEFAULT 'DELIVERY',
    department VARCHAR(120) NULL,
    municipality VARCHAR(120) NULL,
    address TEXT NULL,
    shipping_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
    subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
    total DECIMAL(12,2) NOT NULL DEFAULT 0,
    customer_name VARCHAR(160) NOT NULL,
    customer_phone VARCHAR(40) NULL,
    customer_email VARCHAR(160) NULL,
    scheduled_for DATE NULL,
    paid_at DATETIME NULL,
    sale_id INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_online_order_code (order_code)
  )`)
  await pool.query(`CREATE TABLE IF NOT EXISTS online_order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    unit_price_snapshot DECIMAL(12,2) NOT NULL DEFAULT 0,
    total DECIMAL(12,2) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_online_items_order FOREIGN KEY (order_id) REFERENCES online_orders(id) ON DELETE CASCADE
  )`)
  await pool.query(`CREATE TABLE IF NOT EXISTS online_payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    provider VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    payment_link TEXT NULL,
    reference VARCHAR(160) NULL,
    amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_online_payments_order FOREIGN KEY (order_id) REFERENCES online_orders(id) ON DELETE CASCADE
  )`)
  await pool.query(`CREATE TABLE IF NOT EXISTS product_warehouse_stock (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    warehouse_id INT NOT NULL,
    quantity INT NOT NULL DEFAULT 0,
    UNIQUE KEY uniq_product_warehouse (product_id, warehouse_id)
  )`)
}

router.get('/settings', async (req, res) => {
  try {
    const pool = await getPool()
    const settings = await getSettings(pool)
    const bannerProductIds = getBannerProductIds(settings)
    return res.json({
      currency: settings?.currency || 'GTQ',
      enabled: Boolean(Number(settings?.enabled ?? 1)),
      catalogEnabled: Boolean(Number(settings?.catalog_enabled ?? 1)),
      cartEnabled: Boolean(Number(settings?.cart_enabled ?? 1)),
      checkoutEnabled: Boolean(Number(settings?.checkout_enabled ?? 1)),
      favoritesEnabled: Boolean(Number(settings?.favorites_enabled ?? 1)),
      recommendationsEnabled: Boolean(Number(settings?.recommendations_enabled ?? 1)),
      bannerProductIds,
      onlinePricingMode: normalizeOnlinePricingMode(settings?.online_price_mode),
      onlineCostAdjustmentPercent: Number(settings?.online_cost_adjustment_percent || 0),
      warehouseId: Number(settings?.online_warehouse_id || 1),
      cutoffTime: String(settings?.cutoff_time || '11:00:00'),
      acceptAfterCutoff: String(settings?.accept_after_cutoff || 'SCHEDULE'),
      pickupEnabled: Boolean(Number(settings?.pickup_enabled ?? 1)),
      deliveryEnabled: Boolean(Number(settings?.delivery_enabled ?? 1)),
      pickupNotes: settings?.pickup_notes || '',
    })
  } catch (err) {
    console.error('Store settings error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

router.get('/shipping-zones', async (req, res) => {
  try {
    const pool = await getPool()
    await ensureOnlineTables(pool)
    const [rows] = await pool.query(
      `SELECT id, department, municipality, fee
       FROM shipping_zones
       WHERE active = 1
       ORDER BY department ASC, municipality ASC`
    )
    return res.json(rows || [])
  } catch (err) {
    console.error('Store zones error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

router.get('/products', async (req, res) => {
  try {
    const pool = await getPool()
    await ensureOnlineTables(pool)
    await ensureStoreBannerColumn(pool)
    await ensureBrandLogoColumn(pool)
    const settings = await getSettings(pool)
    const productPricingOverrideMap = await getStoreProductPricingOverrideMap(pool)
    const bannerProductIds = getBannerProductIds(settings)
    if (!Boolean(Number(settings?.enabled ?? 1)) || !Boolean(Number(settings?.catalog_enabled ?? 1))) {
      return res.json([])
    }
    const warehouseId = Number(settings?.online_warehouse_id || 1)
    const onlinePricingMode = normalizeOnlinePricingMode(settings?.online_price_mode)

    const search = String(req.query.search || '').trim()
    const categoryId = Number(req.query.categoryId || 0)
    const params = []
    const where = [
      onlinePricingMode === 'COST_PLUS_PERCENT'
        ? '(COALESCE(p.avg_cost, 0) > 0 OR COALESCE(p.cost, 0) > 0 OR p.price3 > 0)'
        : 'p.price3 > 0',
    ]
    if (categoryId > 0) {
      where.push('p.category_id = ?')
      params.push(categoryId)
    }
    if (search) {
      where.push('(p.name LIKE ? OR COALESCE(p.sku, "") LIKE ? OR COALESCE(p.product_code, "") LIKE ?)')
      const term = `%${search}%`
      params.push(term, term, term)
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const bannerPrioritySql = bannerProductIds.length
      ? `CASE ${bannerProductIds.map(() => 'WHEN p.id = ? THEN ?').join(' ')} ELSE 0 END`
      : '0'
    const bannerPriorityParams = bannerProductIds.flatMap((id, index) => [id, bannerProductIds.length - index])

    const [rows] = await pool.query(
      `
      SELECT
        p.id,
        p.name,
        p.category_id AS categoryId,
        p.brand_id AS brandId,
        p.image_url AS imageUrl,
        ${bannerPrioritySql} AS bannerPriority,
        p.price3,
        p.price,
        p.avg_cost AS avgCost,
        p.cost,
        p.product_type AS productType,
        p.description,
        c.name AS categoryName,
        c.parent_id AS categoryParentId,
        pc.id AS parentCategoryId,
        pc.name AS parentCategoryName,
        COALESCE(c.id, 0) AS rawCategoryId,
        d.id AS departmentId,
        d.name AS departmentName,
        b.name AS brandName,
        b.logo_url AS brandLogoUrl,
        COALESCE(pws.quantity, 0) AS stock,
        COALESCE(sa.totalSold, 0) AS totalSold
      FROM products p
      LEFT JOIN categories c
        ON c.id = p.category_id
      LEFT JOIN categories pc
        ON pc.id = c.parent_id
      LEFT JOIN departments d
        ON d.id = COALESCE(c.department_id, pc.department_id)
      LEFT JOIN brands b
        ON b.id = p.brand_id
      LEFT JOIN (
        SELECT product_id, SUM(quantity) AS totalSold
        FROM sale_items
        GROUP BY product_id
      ) sa
        ON sa.product_id = p.id
      LEFT JOIN product_warehouse_stock pws
        ON pws.product_id = p.id AND pws.warehouse_id = ?
      ${whereSql}
      ORDER BY bannerPriority DESC, p.id DESC
      LIMIT 2000
      `,
      [...bannerPriorityParams, warehouseId, ...params]
    )
    return res.json((rows || []).map(r => {
      const pricing = computeOnlineProductPricing(r, settings, productPricingOverrideMap.get(Number(r.id)))
      return {
        id: r.id,
        name: r.name,
        categoryId: Number(r.categoryId || 0),
        parentCategoryId: Number(r.parentCategoryId || 0),
        subcategoryId: Number(r.categoryParentId ? (r.rawCategoryId || 0) : 0),
        departmentId: Number(r.departmentId || 0),
        brandId: Number(r.brandId || 0),
        storeBannerPrincipal: Boolean(Number(r.bannerPriority || 0)),
        bannerPriority: Number(r.bannerPriority || 0),
        imageUrl: r.imageUrl || null,
        price: pricing.price,
        compareAtPrice: pricing.compareAtPrice,
        productType: r.productType || 'GENERAL',
        description: r.description || '',
        categoryName: r.categoryName || '',
        parentCategoryName: r.parentCategoryName || '',
        subcategoryName: r.categoryParentId ? (r.categoryName || '') : '',
        departmentName: r.departmentName || '',
        brandName: r.brandName || '',
        brandLogoUrl: r.brandLogoUrl || null,
        stock: Number(r.stock || 0),
        totalSold: Number(r.totalSold || 0),
      }
    }))
  } catch (err) {
    console.error('Store products error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

router.post('/orders', async (req, res) => {
  try {
    const {
      customerName,
      customerPhone,
      customerEmail,
      fulfillmentType,
      department,
      municipality,
      address,
      paymentProvider,
      items,
    } = req.body || {}

    const normalizedCustomerName = String(customerName || '').trim()
    if (!normalizedCustomerName) {
      return res.status(400).json({ error: 'Nombre requerido' })
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items requeridos' })
    }

    const pool = await getPool()
    await ensureOnlineTables(pool)
    const settings = await getSettings(pool)
    const productPricingOverrideMap = await getStoreProductPricingOverrideMap(pool)
    if (!Boolean(Number(settings?.enabled ?? 1)) || !Boolean(Number(settings?.cart_enabled ?? 1)) || !Boolean(Number(settings?.checkout_enabled ?? 1))) {
      return res.status(403).json({ error: 'La tienda no tiene habilitado el checkout web en este momento' })
    }
    const currency = String(settings?.currency || 'GTQ')
    const warehouseId = Number(settings?.online_warehouse_id || 1)
    const cutoffMinutes = timeToMinutes(String(settings?.cutoff_time || '11:00:00'))
    const nowMinutes = todayMinutes()

    const normalizedFulfillment = normalizeFulfillmentType(fulfillmentType)
    const wantsDelivery = normalizedFulfillment === 'DELIVERY'
    const normalizedProvider = normalizePaymentProvider(paymentProvider)

    let shippingFee = 0
    const normalizedDepartment = wantsDelivery ? String(department || '').trim() : ''
    const normalizedMunicipality = wantsDelivery ? String(municipality || '').trim() : ''
    const normalizedAddress = wantsDelivery ? String(address || '').trim() : ''
    if (wantsDelivery) {
      if (!normalizedDepartment || !normalizedMunicipality || !normalizedAddress) {
        return res.status(400).json({ error: 'Dirección requerida para envío' })
      }
      const [zoneRows] = await pool.query(
        `SELECT fee FROM shipping_zones WHERE active = 1 AND department = ? AND municipality = ? LIMIT 1`,
        [normalizedDepartment, normalizedMunicipality]
      )
      if (!zoneRows?.length) {
        return res.status(400).json({ error: 'No hay tarifa configurada para ese destino' })
      }
      shippingFee = roundCurrency(zoneRows[0].fee || 0)
    }

    const requested = items
      .map(v => ({
        productId: Number(v?.productId || 0),
        quantity: Number(v?.quantity || 0),
      }))
      .filter(v => v.productId > 0 && v.quantity > 0 && Number.isFinite(v.quantity))
      .slice(0, 200)

    if (requested.length === 0) {
      return res.status(400).json({ error: 'Items inválidos' })
    }

    const productIds = requested.map(i => i.productId)
    const [productRows] = await pool.query(
      `SELECT id, name, price, price3, product_type, avg_cost, cost
       FROM products
       WHERE id IN (${productIds.map(() => '?').join(',')})`,
      productIds
    )
    const productMap = new Map(productRows.map(p => [Number(p.id), p]))

    const orderItems = []
    let subtotal = 0
    for (const item of requested) {
      const p = productMap.get(item.productId)
      if (!p) return res.status(400).json({ error: `Producto no encontrado: ${item.productId}` })
      const pt = String(p.product_type || 'GENERAL').toUpperCase()
      if (pt !== 'GENERAL') {
        return res.status(400).json({ error: `Producto no disponible para tienda online: ${p.name}` })
      }
      const pricing = computeOnlineProductPricing(p, settings, productPricingOverrideMap.get(Number(p.id)))
      const unitPrice = pricing.price
      if (unitPrice <= 0) return res.status(400).json({ error: `Producto sin precio online configurado: ${p.name}` })
      const qty = Math.floor(Number(item.quantity))
      if (qty <= 0) return res.status(400).json({ error: `Cantidad inválida: ${p.name}` })
      const lineTotal = roundCurrency(unitPrice * qty)
      subtotal = roundCurrency(subtotal + lineTotal)
      orderItems.push({
        productId: item.productId,
        quantity: qty,
        unitPrice,
        total: lineTotal,
      })
    }

    const total = roundCurrency(subtotal + shippingFee)
    const orderCode = makeOrderCode()
    const scheduledFor = nowMinutes > cutoffMinutes ? nextBusinessDate() : null

    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      const [orderResult] = await conn.query(
        `INSERT INTO online_orders
         (order_code, status, currency, fulfillment_type, department, municipality, address, shipping_fee, subtotal, total,
          customer_name, customer_phone, customer_email, scheduled_for)
         VALUES (?, 'PENDING_PAYMENT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderCode,
          currency,
          normalizedFulfillment,
          normalizedDepartment || null,
          normalizedMunicipality || null,
          normalizedAddress || null,
          shippingFee,
          subtotal,
          total,
          normalizedCustomerName,
          String(customerPhone || '').trim() || null,
          String(customerEmail || '').trim() || null,
          scheduledFor,
        ]
      )
      const orderId = orderResult.insertId

      for (const oi of orderItems) {
        await conn.query(
          `INSERT INTO online_order_items (order_id, product_id, quantity, unit_price_snapshot, total)
           VALUES (?, ?, ?, ?, ?)`,
          [orderId, oi.productId, oi.quantity, oi.unitPrice, oi.total]
        )
      }

      await conn.query(
        `INSERT INTO online_payments (order_id, provider, status, amount)
         VALUES (?, ?, 'PENDING', ?)`,
        [orderId, normalizedProvider, total]
      )

      await conn.commit()
      return res.json({
        success: true,
        orderId,
        orderCode,
        currency,
        warehouseId,
        fulfillmentType: normalizedFulfillment,
        scheduledFor,
        subtotal,
        shippingFee,
        total,
        paymentProvider: normalizedProvider,
      })
    } catch (err) {
      await conn.rollback()
      console.error('Store order create error:', err)
      return res.status(500).json({ error: 'Server error' })
    } finally {
      conn.release()
    }
  } catch (err) {
    console.error('Store order create outer error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

router.get('/orders/:orderCode', async (req, res) => {
  try {
    const orderCode = String(req.params.orderCode || '').trim()
    if (!orderCode) return res.status(400).json({ error: 'Código requerido' })

    const pool = await getPool()
    await ensureOnlineTables(pool)

    const [orders] = await pool.query(
      `SELECT id, order_code AS orderCode, status, currency, fulfillment_type AS fulfillmentType,
              department, municipality, address, shipping_fee AS shippingFee, subtotal, total,
              customer_name AS customerName, customer_phone AS customerPhone, customer_email AS customerEmail,
              scheduled_for AS scheduledFor, paid_at AS paidAt, created_at AS createdAt
       FROM online_orders
       WHERE order_code = ?
       LIMIT 1`,
      [orderCode]
    )
    const order = orders?.[0]
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' })

    const [items] = await pool.query(
      `SELECT i.product_id AS productId, p.name AS productName, i.quantity,
              i.unit_price_snapshot AS unitPrice, i.total
       FROM online_order_items i
       JOIN products p ON p.id = i.product_id
       WHERE i.order_id = ?
       ORDER BY i.id ASC`,
      [order.id]
    )

    const [payments] = await pool.query(
      `SELECT provider, status, payment_link AS paymentLink, reference, amount, created_at AS createdAt
       FROM online_payments
       WHERE order_id = ?
       ORDER BY id DESC`,
      [order.id]
    )

    return res.json({
      ...order,
      shippingFee: Number(order.shippingFee || 0),
      subtotal: Number(order.subtotal || 0),
      total: Number(order.total || 0),
      items: (items || []).map(r => ({
        productId: r.productId,
        productName: r.productName,
        quantity: Number(r.quantity || 0),
        unitPrice: Number(r.unitPrice || 0),
        total: Number(r.total || 0),
      })),
      payments: (payments || []).map(p => ({
        provider: p.provider,
        status: p.status,
        paymentLink: p.paymentLink || null,
        reference: p.reference || null,
        amount: Number(p.amount || 0),
        createdAt: p.createdAt,
      })),
    })
  } catch (err) {
    console.error('Store order get error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

router.get('/admin/orders', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    const pool = await getPool()
    await ensureOnlineTables(pool)
    const status = String(req.query.status || '').trim()
    const where = []
    const params = []
    if (status) {
      where.push('status = ?')
      params.push(status)
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const [rows] = await pool.query(
      `SELECT id, order_code AS orderCode, status, fulfillment_type AS fulfillmentType,
              department, municipality, shipping_fee AS shippingFee, subtotal, total,
              customer_name AS customerName, customer_phone AS customerPhone,
              scheduled_for AS scheduledFor, paid_at AS paidAt, created_at AS createdAt
       FROM online_orders
       ${whereSql}
       ORDER BY id DESC
       LIMIT 500`,
      params
    )
    return res.json((rows || []).map(r => ({
      ...r,
      shippingFee: Number(r.shippingFee || 0),
      subtotal: Number(r.subtotal || 0),
      total: Number(r.total || 0),
    })))
  } catch (err) {
    console.error('Store admin orders error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

router.post('/admin/orders/:id/confirm-payment', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    const orderId = Number(req.params.id || 0)
    if (!orderId) return res.status(400).json({ error: 'Pedido inválido' })

    const pool = await getPool()
    await ensureOnlineTables(pool)
    const settings = await getSettings(pool)
    const warehouseId = Number(settings?.online_warehouse_id || 1)

    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      const [orderRows] = await conn.query(
        `SELECT id, order_code, status, total, sale_id
         FROM online_orders
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [orderId]
      )
      const order = orderRows?.[0]
      if (!order) {
        await conn.rollback()
        return res.status(404).json({ error: 'Pedido no encontrado' })
      }
      if (order.sale_id) {
        await conn.rollback()
        return res.status(400).json({ error: 'Pedido ya está vinculado a una venta' })
      }
      if (String(order.status || '').toUpperCase() === 'PAID') {
        await conn.rollback()
        return res.status(400).json({ error: 'Pedido ya está pagado' })
      }

      const [itemRows] = await conn.query(
        `SELECT product_id, quantity, unit_price_snapshot
         FROM online_order_items
         WHERE order_id = ?`,
        [orderId]
      )
      if (!Array.isArray(itemRows) || itemRows.length === 0) {
        await conn.rollback()
        return res.status(400).json({ error: 'Pedido sin items' })
      }

      await ensureSalesSchema(conn)

      const [saleResult] = await conn.query(
        `INSERT INTO sales (customer_id, user_id, warehouse_id, doc_no, total, is_credit, payment_method, received_amount, change_amount, reference_number)
         VALUES (NULL, ?, ?, ?, ?, 0, 'ONLINE', 0, 0, NULL)`,
        [req.user.id, warehouseId, order.order_code, Number(order.total || 0),]
      )
      const saleId = saleResult.insertId

      for (const row of itemRows) {
        const productId = Number(row.product_id)
        const qty = Number(row.quantity || 0)
        const unitPrice = roundCurrency(row.unit_price_snapshot || 0)
        const lineTotal = roundCurrency(unitPrice * qty)
        const [productRows] = await conn.query(
          'SELECT avg_cost, cost, description FROM products WHERE id = ? LIMIT 1',
          [productId]
        )
        const pr = productRows?.[0] || {}
        const unitCostSnapshot = roundCurrency(pr.avg_cost ?? pr.cost ?? 0)
        const totalCostSnapshot = roundCurrency(unitCostSnapshot * qty)
        const productDescriptionSnapshot = String(pr.description || '').trim() || null
        await conn.query(
          `INSERT INTO sale_items
           (sale_id, product_id, quantity, unit_price, total, serial, imei, batch_no, product_description_snapshot, original_unit_price, price_source, unit_cost_snapshot, total_cost_snapshot)
           VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, 'PRICE3', ?, ?)`,
          [saleId, productId, qty, unitPrice, lineTotal, productDescriptionSnapshot, unitPrice, unitCostSnapshot, totalCostSnapshot]
        )
        await registerMovement({
          productId,
          warehouseId,
          type: 'SALE',
          quantity: qty,
          referenceId: saleId,
          userId: req.user.id,
          notes: `Venta online ${order.order_code}`,
        }, conn)
      }

      await conn.query(
        `UPDATE online_orders
         SET status = 'PAID', paid_at = NOW(), sale_id = ?
         WHERE id = ?`,
        [saleId, orderId]
      )
      await conn.query(
        `UPDATE online_payments
         SET status = 'CONFIRMED'
         WHERE order_id = ? AND status <> 'CONFIRMED'`,
        [orderId]
      )

      await conn.commit()
      return res.json({ success: true, saleId })
    } catch (err) {
      await conn.rollback()
      console.error('Store confirm payment error:', err)
      return res.status(500).json({ error: 'Server error' })
    } finally {
      conn.release()
    }
  } catch (err) {
    console.error('Store confirm payment outer error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

router.get('/admin/settings', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    const pool = await getPool()
    const settings = await getSettings(pool)
    const bannerProductIds = getBannerProductIds(settings)
    return res.json({
      currency: settings?.currency || 'GTQ',
      catalogEnabled: Boolean(Number(settings?.catalog_enabled ?? 1)),
      cartEnabled: Boolean(Number(settings?.cart_enabled ?? 1)),
      checkoutEnabled: Boolean(Number(settings?.checkout_enabled ?? 1)),
      favoritesEnabled: Boolean(Number(settings?.favorites_enabled ?? 1)),
      recommendationsEnabled: Boolean(Number(settings?.recommendations_enabled ?? 1)),
      bannerProductId: bannerProductIds[0] || null,
      bannerProductIds,
      onlinePricingMode: normalizeOnlinePricingMode(settings?.online_price_mode),
      onlineCostAdjustmentPercent: Number(settings?.online_cost_adjustment_percent || 0),
      onlineWarehouseId: Number(settings?.online_warehouse_id || 1),
      cutoffTime: String(settings?.cutoff_time || '11:00:00'),
      acceptAfterCutoff: String(settings?.accept_after_cutoff || 'SCHEDULE'),
      pickupEnabled: Boolean(Number(settings?.pickup_enabled ?? 1)),
      deliveryEnabled: Boolean(Number(settings?.delivery_enabled ?? 1)),
      pickupNotes: settings?.pickup_notes || '',
    })
  } catch (err) {
    console.error('Store admin settings error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

router.put('/admin/settings', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    const pool = await getPool()
    const settings = await getSettings(pool)
    const body = req.body || {}
    const currency = String(body.currency || settings?.currency || 'GTQ').trim().toUpperCase() || 'GTQ'
    const catalogEnabled = body.catalogEnabled === undefined ? Boolean(Number(settings?.catalog_enabled ?? 1)) : Boolean(body.catalogEnabled)
    const cartEnabled = body.cartEnabled === undefined ? Boolean(Number(settings?.cart_enabled ?? 1)) : Boolean(body.cartEnabled)
    const checkoutEnabled = body.checkoutEnabled === undefined ? Boolean(Number(settings?.checkout_enabled ?? 1)) : Boolean(body.checkoutEnabled)
    const favoritesEnabled = body.favoritesEnabled === undefined ? Boolean(Number(settings?.favorites_enabled ?? 1)) : Boolean(body.favoritesEnabled)
    const recommendationsEnabled = body.recommendationsEnabled === undefined ? Boolean(Number(settings?.recommendations_enabled ?? 1)) : Boolean(body.recommendationsEnabled)
    const bannerProductIds = normalizeBannerProductIds(
      Array.isArray(body.bannerProductIds)
        ? body.bannerProductIds
        : body.bannerProductId == null ? [] : [body.bannerProductId]
    )
    const bannerProductId1 = bannerProductIds[0] || null
    const bannerProductId2 = bannerProductIds[1] || null
    const bannerProductId3 = bannerProductIds[2] || null
    const bannerProductId4 = bannerProductIds[3] || null
    const onlinePricingMode = normalizeOnlinePricingMode(body.onlinePricingMode || settings?.online_price_mode || 'PRICE3')
    const onlineCostAdjustmentPercent = normalizeOnlineAdjustmentPercent(
      body.onlineCostAdjustmentPercent === undefined
        ? (settings?.online_cost_adjustment_percent || 0)
        : body.onlineCostAdjustmentPercent
    )
    const onlineWarehouseId = Number(body.onlineWarehouseId || settings?.online_warehouse_id || 1)
    const cutoffTime = normalizeCutoffTime(body.cutoffTime || settings?.cutoff_time || '11:00:00')
    const acceptAfterCutoff = String(body.acceptAfterCutoff || settings?.accept_after_cutoff || 'SCHEDULE').trim().toUpperCase() || 'SCHEDULE'
    const pickupEnabled = body.pickupEnabled === undefined ? Boolean(Number(settings?.pickup_enabled ?? 1)) : Boolean(body.pickupEnabled)
    const deliveryEnabled = body.deliveryEnabled === undefined ? Boolean(Number(settings?.delivery_enabled ?? 1)) : Boolean(body.deliveryEnabled)
    const pickupNotes = body.pickupNotes === undefined ? (settings?.pickup_notes || '') : String(body.pickupNotes || '')

    await pool.query(
      `UPDATE store_settings
       SET currency = ?, catalog_enabled = ?, cart_enabled = ?, checkout_enabled = ?, favorites_enabled = ?, recommendations_enabled = ?, banner_product_id = ?, banner_product_id_2 = ?, banner_product_id_3 = ?, banner_product_id_4 = ?, online_price_mode = ?, online_cost_adjustment_percent = ?, online_warehouse_id = ?, cutoff_time = ?, accept_after_cutoff = ?,
           pickup_enabled = ?, delivery_enabled = ?, pickup_notes = ?
       WHERE id = 1`,
      [currency, catalogEnabled ? 1 : 0, cartEnabled ? 1 : 0, checkoutEnabled ? 1 : 0, favoritesEnabled ? 1 : 0, recommendationsEnabled ? 1 : 0, bannerProductId1, bannerProductId2, bannerProductId3, bannerProductId4, onlinePricingMode, onlineCostAdjustmentPercent, onlineWarehouseId, cutoffTime, acceptAfterCutoff, pickupEnabled ? 1 : 0, deliveryEnabled ? 1 : 0, pickupNotes]
    )
    const updated = await getSettings(pool)
    const updatedBannerProductIds = getBannerProductIds(updated)
    return res.json({
      currency: updated?.currency || 'GTQ',
      catalogEnabled: Boolean(Number(updated?.catalog_enabled ?? 1)),
      cartEnabled: Boolean(Number(updated?.cart_enabled ?? 1)),
      checkoutEnabled: Boolean(Number(updated?.checkout_enabled ?? 1)),
      favoritesEnabled: Boolean(Number(updated?.favorites_enabled ?? 1)),
      recommendationsEnabled: Boolean(Number(updated?.recommendations_enabled ?? 1)),
      bannerProductId: updatedBannerProductIds[0] || null,
      bannerProductIds: updatedBannerProductIds,
      onlinePricingMode: normalizeOnlinePricingMode(updated?.online_price_mode),
      onlineCostAdjustmentPercent: Number(updated?.online_cost_adjustment_percent || 0),
      onlineWarehouseId: Number(updated?.online_warehouse_id || 1),
      cutoffTime: String(updated?.cutoff_time || '11:00:00'),
      acceptAfterCutoff: String(updated?.accept_after_cutoff || 'SCHEDULE'),
      pickupEnabled: Boolean(Number(updated?.pickup_enabled ?? 1)),
      deliveryEnabled: Boolean(Number(updated?.delivery_enabled ?? 1)),
      pickupNotes: updated?.pickup_notes || '',
    })
  } catch (err) {
    console.error('Store admin settings update error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

router.get('/admin/banner-products', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    const pool = await getPool()
    const settings = await getSettings(pool)
    const productPricingOverrideMap = await getStoreProductPricingOverrideMap(pool)
    const [rows] = await pool.query(
      `SELECT p.id, p.name, p.sku, p.image_url AS imageUrl, p.price, p.price3, p.avg_cost AS avgCost, p.cost
       FROM products p
       ORDER BY p.id DESC
       LIMIT 2000`
    )
    return res.json((rows || []).map((row) => ({
      id: Number(row.id || 0),
      name: row.name || '',
      sku: row.sku || '',
      imageUrl: row.imageUrl || null,
      price: computeOnlineProductPricing(row, settings, productPricingOverrideMap.get(Number(row.id))).price,
    })))
  } catch (err) {
    console.error('Store admin banner products error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

router.get('/admin/product-pricing-overrides', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    const pool = await getPool()
    const settings = await getSettings(pool)
    const overrides = await getStoreProductPricingOverrides(pool, settings)
    return res.json(overrides)
  } catch (err) {
    console.error('Store admin product pricing overrides list error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

router.put('/admin/product-pricing-overrides', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    const pool = await getPool()
    await ensureStorePricingOverrideTable(pool)
    const overrides = normalizeProductPricingOverrides(req.body?.overrides)
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      await conn.query('DELETE FROM store_product_pricing_overrides')
      for (const override of overrides) {
        await conn.query(
          `INSERT INTO store_product_pricing_overrides (product_id, adjustment_percent)
           VALUES (?, ?)`,
          [override.productId, override.adjustmentPercent]
        )
      }
      await conn.commit()
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }

    const settings = await getSettings(pool)
    const updatedOverrides = await getStoreProductPricingOverrides(pool, settings)
    return res.json(updatedOverrides)
  } catch (err) {
    console.error('Store admin product pricing overrides update error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

router.get('/admin/shipping-zones', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    const pool = await getPool()
    await ensureOnlineTables(pool)
    const [rows] = await pool.query(
      `SELECT id, department, municipality, fee, active
       FROM shipping_zones
       ORDER BY department ASC, municipality ASC`
    )
    return res.json((rows || []).map(r => ({
      ...r,
      fee: Number(r.fee || 0),
      active: Boolean(Number(r.active ?? 1)),
    })))
  } catch (err) {
    console.error('Store admin zones list error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

router.post('/admin/shipping-zones', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    const pool = await getPool()
    await ensureOnlineTables(pool)
    const department = String(req.body?.department || '').trim()
    const municipality = String(req.body?.municipality || '').trim()
    const fee = roundCurrency(req.body?.fee || 0)
    if (!department || !municipality) return res.status(400).json({ error: 'Departamento y municipio requeridos' })
    await pool.query(
      `INSERT INTO shipping_zones (department, municipality, fee, active)
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE fee = VALUES(fee), active = 1`,
      [department, municipality, fee]
    )
    return res.json({ success: true })
  } catch (err) {
    console.error('Store admin zone create error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

router.put('/admin/shipping-zones/:id', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    const pool = await getPool()
    await ensureOnlineTables(pool)
    const id = Number(req.params.id || 0)
    if (!id) return res.status(400).json({ error: 'Zona inválida' })
    const fee = req.body?.fee === undefined ? null : roundCurrency(req.body?.fee)
    const active = req.body?.active === undefined ? null : (Boolean(req.body.active) ? 1 : 0)
    const updates = []
    const params = []
    if (fee !== null) {
      updates.push('fee = ?')
      params.push(fee)
    }
    if (active !== null) {
      updates.push('active = ?')
      params.push(active)
    }
    if (updates.length === 0) return res.json({ success: true })
    params.push(id)
    await pool.query(`UPDATE shipping_zones SET ${updates.join(', ')} WHERE id = ?`, params)
    return res.json({ success: true })
  } catch (err) {
    console.error('Store admin zone update error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

router.delete('/admin/shipping-zones/:id', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    const pool = await getPool()
    await ensureOnlineTables(pool)
    const id = Number(req.params.id || 0)
    if (!id) return res.status(400).json({ error: 'Zona inválida' })
    await pool.query('UPDATE shipping_zones SET active = 0 WHERE id = ?', [id])
    return res.json({ success: true })
  } catch (err) {
    console.error('Store admin zone delete error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

export default router
