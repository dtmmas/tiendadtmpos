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

function createTinyPngBlob() {
  return new Blob([
    Uint8Array.from([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
      0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
      0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4, 0, 9, 251, 3, 253,
      160, 164, 90, 203, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ]),
  ], { type: 'image/png' })
}

async function login() {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD }),
  })

  assert.equal(response.status, 200, 'No se pudo autenticar para pruebas de imagenes')
  const payload = await response.json()
  assert.ok(payload?.token, 'La autenticacion no devolvio token')
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
    await conn.query('DELETE FROM product_images WHERE product_id = ?', [productId])
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

async function createProductWithImages(token, runId) {
  const form = new FormData()
  form.set('name', `GALERIA ${runId}`)
  form.set('sku', `GAL-${runId}`)
  form.set('price', '150')
  form.set('cost', '100')
  form.set('unit', 'PZ')
  form.set('productType', 'GENERAL')
  form.set('batches', '[]')
  form.set('imeis', '[]')
  form.set('serials', '[]')
  form.set('variants', '[]')
  form.set('productImages', JSON.stringify([{ uploadIndex: 0 }, { uploadIndex: 1 }]))
  form.append('images', createTinyPngBlob(), 'uno.png')
  form.append('images', createTinyPngBlob(), 'dos.png')

  const response = await fetch(`${API_BASE_URL}/products`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })

  const body = await response.json()
  return { status: response.status, body }
}

test('crea un producto con varias imagenes y expone la galeria en detalles', async () => {
  const token = await login()
  const runId = uniqueId()
  let productId = 0

  try {
    const created = await createProductWithImages(token, runId)
    assert.equal(created.status, 200)
    productId = created.body.id
    assert.equal(created.body.images.length, 2)
    assert.ok(String(created.body.imageUrl || '').includes('/uploads/'))

    const detailsResponse = await fetch(`${API_BASE_URL}/products/${productId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    assert.equal(detailsResponse.status, 200)
    const details = await detailsResponse.json()
    assert.equal(details.images.length, 2)
    assert.equal(details.images[0].isPrimary, true)
  } finally {
    await cleanupProduct(productId)
  }
})

test('permite reemplazar y eliminar imagenes individuales durante la edicion', async () => {
  const token = await login()
  const runId = uniqueId()
  let productId = 0

  try {
    const created = await createProductWithImages(token, runId)
    assert.equal(created.status, 200)
    productId = created.body.id

    const firstImageId = Number(created.body.images[0].id)
    const secondImageId = Number(created.body.images[1].id)
    assert.ok(firstImageId > 0)
    assert.ok(secondImageId > 0)

    const form = new FormData()
    form.set('name', `GALERIA ${runId}`)
    form.set('sku', `GAL-${runId}`)
    form.set('price', '175')
    form.set('cost', '120')
    form.set('unit', 'PZ')
    form.set('productType', 'GENERAL')
    form.set('batches', '[]')
    form.set('imeis', '[]')
    form.set('serials', '[]')
    form.set('variants', '[]')
    form.set('productImages', JSON.stringify([{ uploadIndex: 0 }, { id: secondImageId }]))
    form.append('images', createTinyPngBlob(), 'reemplazo.png')

    const response = await fetch(`${API_BASE_URL}/products/${productId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })

    assert.equal(response.status, 200)
    const updated = await response.json()
    assert.equal(updated.images.length, 2)
    assert.ok(String(updated.images[0].imageUrl || '').includes('/uploads/'))
    assert.equal(Number(updated.images[1].id) > 0, true)
    assert.notEqual(Number(updated.images[0].id || 0), firstImageId)
  } finally {
    await cleanupProduct(productId)
  }
})

test('rechaza formatos no soportados para la galeria de producto', async () => {
  const token = await login()
  const runId = uniqueId()
  const form = new FormData()
  form.set('name', `GALERIA INVALIDA ${runId}`)
  form.set('sku', `GAL-TXT-${runId}`)
  form.set('price', '90')
  form.set('cost', '50')
  form.set('unit', 'PZ')
  form.set('productType', 'GENERAL')
  form.set('batches', '[]')
  form.set('imeis', '[]')
  form.set('serials', '[]')
  form.set('variants', '[]')
  form.set('productImages', JSON.stringify([{ uploadIndex: 0 }]))
  form.append('images', new Blob(['texto'], { type: 'text/plain' }), 'nota.txt')

  const response = await fetch(`${API_BASE_URL}/products`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })

  assert.equal(response.status, 400)
  const body = await response.json()
  assert.match(body.error || '', /JPG|PNG|WebP/i)
})
