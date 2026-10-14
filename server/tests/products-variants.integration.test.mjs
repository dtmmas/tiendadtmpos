import test from 'node:test'
import assert from 'node:assert/strict'
import mysql from 'mysql2/promise'
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, '..', '.env') })

const API_BASE_URL = process.env.TEST_API_BASE_URL || `http://127.0.0.1:${process.env.PORT || 4003}/api`
const LOGIN_EMAIL = process.env.TEST_LOGIN_EMAIL || 'admin@local'
const LOGIN_PASSWORD = process.env.TEST_LOGIN_PASSWORD || 'admin123'

function uniqueId() {
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`
}

async function login() {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD }),
  })

  assert.equal(response.status, 200, 'No se pudo autenticar para pruebas de integración')
  const payload = await response.json()
  assert.ok(payload?.token, 'La autenticación no devolvió token')
  return payload.token
}

async function openDb() {
  return mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'dtmpos',
  })
}

async function cleanupProduct(productId) {
  if (!productId) return
  const conn = await openDb()
  try {
    await conn.query('DELETE FROM product_variant_units WHERE product_id = ?', [productId])
    await conn.query('DELETE FROM product_variants WHERE product_id = ?', [productId])
    await conn.query('DELETE FROM product_batches WHERE product_id = ?', [productId])
    await conn.query('DELETE FROM product_imeis WHERE product_id = ?', [productId])
    await conn.query('DELETE FROM product_serials WHERE product_id = ?', [productId])
    await conn.query('DELETE FROM product_warehouse_stock WHERE product_id = ?', [productId])
    await conn.query('DELETE FROM inventory_movements WHERE product_id = ?', [productId])
    await conn.query('DELETE FROM products WHERE id = ?', [productId])
  } finally {
    await conn.end()
  }
}

async function ensureSerializedVariantTypeEnabled() {
  const conn = await openDb()
  try {
    await conn.query(
      'UPDATE system_config SET enabled_product_types = ? WHERE id = 1',
      [JSON.stringify(['GENERAL', 'MEDICINAL', 'IMEI', 'SERIAL', 'VARIANT_SERIALIZED'])]
    )
  } finally {
    await conn.end()
  }
}

async function createVariantProduct({ token, name, sku, variants, malformed = false, trackingMeta = null }) {
  await ensureSerializedVariantTypeEnabled()
  const params = new URLSearchParams()
  params.set('name', name)
  params.set('sku', sku)
  params.set('price', '2500')
  params.set('cost', '2000')
  params.set('unit', 'UNIDAD')
  params.set('productType', 'VARIANT_SERIALIZED')
  params.set('batches', '[]')
  params.set('imeis', '[]')
  params.set('serials', '[]')
  params.set('variants', malformed ? variants : JSON.stringify(variants))
  if (trackingMeta) params.set('trackingMeta', JSON.stringify(trackingMeta))

  const response = await fetch(`${API_BASE_URL}/products`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })

  const text = await response.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: response.status, body }
}

async function updateVariantProduct({ token, productId, name, sku, variants }) {
  await ensureSerializedVariantTypeEnabled()
  const params = new URLSearchParams()
  params.set('name', name)
  params.set('sku', sku)
  params.set('price', '2550')
  params.set('cost', '2050')
  params.set('unit', 'UNIDAD')
  params.set('productType', 'VARIANT_SERIALIZED')
  params.set('batches', '[]')
  params.set('imeis', '[]')
  params.set('serials', '[]')
  params.set('variants', JSON.stringify(variants))

  const response = await fetch(`${API_BASE_URL}/products/${productId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })

  const text = await response.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: response.status, body }
}

async function getProductById({ token, productId }) {
  const response = await fetch(`${API_BASE_URL}/products/${productId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  const text = await response.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: response.status, body }
}

test('crea un producto con variantes serializadas usando JSON estándar', async () => {
  const token = await login()
  const runId = uniqueId()
  const sku = `IT-VAR-${runId}`

  const result = await createVariantProduct({
    token,
    name: `INTEGRACION VARIANTES ${runId}`,
    sku,
    variants: [
      {
        name: 'A17 NEGRO 4/128',
        sku: `${sku}-V1`,
        color: 'NEGRO',
        ram: '4GB',
        storage: '128GB',
        carrier: 'LIBERADO',
        simType: 'DOBLE SIM',
        identifierMode: 'IMEI',
        price: 2500,
        cost: 2000,
      },
    ],
  })

  assert.equal(result.status, 200)
  assert.equal(result.body.productType, 'VARIANT_SERIALIZED')
  assert.equal(result.body.stock, 0)

  await cleanupProduct(result.body.id)
})

test('crea una variante serializada para computadora usando numero de serie y la expone en detalles', async () => {
  const token = await login()
  const runId = uniqueId()
  const sku = `IT-VAR-PC-${runId}`

  const created = await createVariantProduct({
    token,
    name: `INTEGRACION VARIANTES PC ${runId}`,
    sku,
    variants: [
      {
        name: 'Laptop Pro 14 / 16GB / 512GB',
        sku: `${sku}-V1`,
        color: 'GRIS',
        ram: '16GB',
        storage: '512GB',
        identifierMode: 'SERIAL',
        deviceCategory: 'DEVICE_SERIAL',
        price: 5200,
        cost: 4700,
        meta: {
          deviceCategory: 'DEVICE_SERIAL',
          modelCode: 'PRO14-16512',
        },
      },
    ],
  })

  assert.equal(created.status, 200)

  const details = await getProductById({ token, productId: created.body.id })
  assert.equal(details.status, 200)
  assert.equal(details.body.variants?.length, 1)
  assert.equal(details.body.variants?.[0]?.identifierMode, 'SERIAL')
  assert.equal(details.body.variants?.[0]?.meta?.deviceCategory, 'DEVICE_SERIAL')
  assert.equal(details.body.variants?.[0]?.carrier, undefined)
  assert.equal(details.body.variants?.[0]?.simType, undefined)

  await cleanupProduct(created.body.id)
})

test('permite crear producto serializado sin variantes y completarlas despues conservando el tipo base', async () => {
  const token = await login()
  const runId = uniqueId()
  const sku = `IT-VAR-BASE-${runId}`

  const created = await createVariantProduct({
    token,
    name: `INTEGRACION VARIANTES BASE ${runId}`,
    sku,
    variants: [],
    trackingMeta: {
      serializedDeviceProfile: 'DEVICE_SERIAL',
    },
  })

  assert.equal(created.status, 200)
  assert.equal(created.body.productType, 'VARIANT_SERIALIZED')

  const updated = await updateVariantProduct({
    token,
    productId: created.body.id,
    name: `INTEGRACION VARIANTES BASE ${runId}`,
    sku,
    variants: [
      {
        name: 'Laptop Pro 14 / 16GB / 512GB',
        sku: `${sku}-V1`,
        color: 'GRIS',
        ram: '16GB',
        storage: '512GB',
        identifierMode: 'SERIAL',
        meta: {
          deviceCategory: 'DEVICE_SERIAL',
        },
        price: 5200,
        cost: 4700,
      },
    ],
  })

  assert.equal(updated.status, 200)

  const details = await getProductById({ token, productId: created.body.id })
  assert.equal(details.status, 200)
  assert.equal(details.body.trackingMeta?.serializedDeviceProfile, 'DEVICE_SERIAL')
  assert.equal(details.body.variants?.length, 1)
  assert.equal(details.body.variants?.[0]?.identifierMode, 'SERIAL')

  await cleanupProduct(created.body.id)
})

test('rechaza unidades serializadas cuando se intentan enviar desde productos', async () => {
  const token = await login()
  const runId = uniqueId()
  const sku = `IT-VAR-UP-${runId}`
  const imei = `35987655${String(runId).replace(/\D/g, '').slice(-8).padStart(8, '0')}`

  const result = await createVariantProduct({
    token,
    name: `INTEGRACION VARIANTES UPPER ${runId}`,
    sku,
    variants: JSON.stringify([
      {
        name: 'A17 NEGRO 4/128',
        sku: `${sku}-V1`,
        color: 'NEGRO',
        ram: '4GB',
        storage: '128GB',
        carrier: 'LIBERADO',
        simType: 'DOBLE SIM',
        identifierMode: 'IMEI',
        price: 2500,
        cost: 2000,
        units: [{ imei, warehouseId: 1 }],
      },
    ]).toUpperCase(),
    malformed: true,
  })

  assert.equal(result.status, 400)
  assert.match(result.body.error || '', /compras|ajustes|productos/i)
})

test('rechaza variants malformado con mensaje descriptivo', async () => {
  const token = await login()
  const runId = uniqueId()
  const result = await createVariantProduct({
    token,
    name: `INTEGRACION VARIANTES BAD ${runId}`,
    sku: `IT-VAR-BAD-${runId}`,
    variants: '{"badJson":true',
    malformed: true,
  })

  assert.equal(result.status, 400)
  assert.match(result.body.error || '', /variants/i)
  assert.match(result.body.details || '', /json inválido/i)
})

test('rechaza guardar atributos de telefono en una variante de computadora o equipo serializado', async () => {
  const token = await login()
  const runId = uniqueId()
  const result = await createVariantProduct({
    token,
    name: `INTEGRACION VARIANTES MIX ${runId}`,
    sku: `IT-VAR-MIX-${runId}`,
    variants: [
      {
        name: 'Laptop Pro 14 / 16GB / 512GB',
        sku: `IT-VAR-MIX-${runId}-V1`,
        color: 'GRIS',
        ram: '16GB',
        storage: '512GB',
        identifierMode: 'SERIAL',
        deviceCategory: 'DEVICE_SERIAL',
        carrier: 'CLARO',
        simType: 'DOBLE SIM',
        price: 5200,
        cost: 4700,
        meta: {
          deviceCategory: 'DEVICE_SERIAL',
        },
      },
    ],
  })

  assert.equal(result.status, 400)
  assert.match(result.body.error || '', /compañia|SIM|computadora|equipo/i)
})

test('permite editar variantes serializadas si no hay unidades activas aunque exista stock fantasma en almacenes', async () => {
  const token = await login()
  const runId = uniqueId()
  const sku = `IT-VAR-EDIT-${runId}`

  const created = await createVariantProduct({
    token,
    name: `INTEGRACION VARIANTES EDIT ${runId}`,
    sku,
    variants: [
      {
        name: 'A17 NEGRO 4/128',
        sku: `${sku}-V1`,
        color: 'NEGRO',
        ram: '4GB',
        storage: '128GB',
        carrier: 'LIBERADO',
        simType: 'DOBLE SIM',
        identifierMode: 'IMEI',
        price: 2500,
        cost: 2000,
      },
    ],
  })

  assert.equal(created.status, 200)

  const productId = created.body.id
  const conn = await openDb()
  try {
    await conn.query(
      `INSERT INTO product_warehouse_stock (product_id, warehouse_id, quantity)
       VALUES (?, 1, 3)
       ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)`,
      [productId]
    )
  } finally {
    await conn.end()
  }

  const updated = await updateVariantProduct({
    token,
    productId,
    name: `INTEGRACION VARIANTES EDIT ${runId}`,
    sku,
    variants: [
      {
        name: 'A17 AZUL 6/128',
        sku: `${sku}-V2`,
        color: 'AZUL',
        ram: '6GB',
        storage: '128GB',
        carrier: 'LIBERADO',
        simType: 'DOBLE SIM',
        identifierMode: 'IMEI',
        price: 2650,
        cost: 2150,
      },
    ],
  })

  assert.equal(updated.status, 200)
  assert.equal(updated.body.productType, 'VARIANT_SERIALIZED')

  const details = await getProductById({ token, productId })
  assert.equal(details.status, 200)
  assert.equal(details.body.productType, 'VARIANT_SERIALIZED')
  assert.equal(details.body.stock, 0)
  assert.equal(details.body.variants?.length, 1)
  assert.equal(details.body.variants?.[0]?.sku, `${sku}-V2`)

  await cleanupProduct(productId)
})

test('rechaza cambiar la categoria de telefono a computadora al editar un producto serializado ya creado', async () => {
  const token = await login()
  const runId = uniqueId()
  const sku = `IT-VAR-LOCK-${runId}`

  const created = await createVariantProduct({
    token,
    name: `INTEGRACION VARIANTES LOCK ${runId}`,
    sku,
    variants: [
      {
        name: 'A17 NEGRO 4/128',
        sku: `${sku}-V1`,
        color: 'NEGRO',
        ram: '4GB',
        storage: '128GB',
        carrier: 'LIBERADO',
        simType: 'DOBLE SIM',
        identifierMode: 'IMEI',
        price: 2500,
        cost: 2000,
        meta: {
          deviceCategory: 'PHONE_IMEI',
        },
      },
    ],
  })

  assert.equal(created.status, 200)

  const updated = await updateVariantProduct({
    token,
    productId: created.body.id,
    name: `INTEGRACION VARIANTES LOCK ${runId}`,
    sku,
    variants: [
      {
        name: 'Laptop Pro 14 / 16GB / 512GB',
        sku: `${sku}-PC1`,
        color: 'GRIS',
        ram: '16GB',
        storage: '512GB',
        identifierMode: 'SERIAL',
        price: 5200,
        cost: 4700,
        meta: {
          deviceCategory: 'DEVICE_SERIAL',
        },
      },
    ],
  })

  assert.equal(updated.status, 400)
  assert.match(updated.body.error || '', /categoria|original|serializado/i)

  await cleanupProduct(created.body.id)
})
