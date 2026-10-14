import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeSerializedVariants, parseJsonArrayFieldDetailed, validateSerializedVariantCompatibility } from '../routes/products.js'

test('parseJsonArrayFieldDetailed reporta error descriptivo para JSON inválido', () => {
  const result = parseJsonArrayFieldDetailed({ variants: '{bad json' }, 'variants')

  assert.deepEqual(result.value, [])
  assert.match(result.error || '', /JSON inválido en variants/i)
})

test('normalizeSerializedVariants conserva unidades con payload estándar', () => {
  const normalized = normalizeSerializedVariants([
    {
      name: 'Galaxy A17',
      sku: 'GA17-001',
      identifierMode: 'IMEI',
      units: [
        { imei: '359876543210221', warehouseId: 2, meta: { supplierName: 'Proveedor 1' } },
      ],
    },
  ])

  assert.equal(normalized.length, 1)
  assert.equal(normalized[0].identifierMode, 'IMEI')
  assert.equal(normalized[0].units.length, 1)
  assert.equal(normalized[0].units[0].imei, '359876543210221')
  assert.equal(normalized[0].units[0].warehouseId, 2)
  assert.equal(normalized[0].units[0].meta?.supplierName, 'Proveedor 1')
})

test('normalizeSerializedVariants tolera payloads con claves en mayúsculas', () => {
  const normalized = normalizeSerializedVariants([
    {
      NAME: 'Galaxy A17',
      SKU: 'GA17-002',
      IDENTIFIERMODE: 'IMEI',
      COLOR: 'NEGRO',
      UNITS: [
        { IMEI: '359876543210222', WAREHOUSEID: 3, META: { SUPPLIERNAME: 'Proveedor 2', NOTES: 'Unidad importada' } },
      ],
    },
  ])

  assert.equal(normalized.length, 1)
  assert.equal(normalized[0].name, 'Galaxy A17')
  assert.equal(normalized[0].identifierMode, 'IMEI')
  assert.equal(normalized[0].units.length, 1)
  assert.equal(normalized[0].units[0].imei, '359876543210222')
  assert.equal(normalized[0].units[0].warehouseId, 3)
})

test('normalizeSerializedVariants infiere categoria de dispositivo para equipos serializados', () => {
  const normalized = normalizeSerializedVariants([
    {
      name: 'Laptop Pro 14',
      sku: 'LTP-14',
      identifierMode: 'SERIAL',
      color: 'GRIS',
      meta: {
        modelCode: 'PRO14',
      },
    },
  ])

  assert.equal(normalized.length, 1)
  assert.equal(normalized[0].identifierMode, 'SERIAL')
  assert.equal(normalized[0].meta?.deviceCategory, 'DEVICE_SERIAL')
})

test('validateSerializedVariantCompatibility rechaza atributos telefonicos en equipos serializados', () => {
  const error = validateSerializedVariantCompatibility([
    {
      name: 'Laptop Pro 14',
      identifierMode: 'SERIAL',
      carrier: 'CLARO',
      simType: '',
      meta: {
        deviceCategory: 'DEVICE_SERIAL',
      },
    },
  ])

  assert.match(error || '', /compañia|SIM|computadora|equipo/i)
})

test('validateSerializedVariantCompatibility rechaza mezclar categorias de telefono y equipo en el mismo producto', () => {
  const error = validateSerializedVariantCompatibility([
    {
      name: 'Telefono A17',
      identifierMode: 'IMEI',
      meta: {
        deviceCategory: 'PHONE_IMEI',
      },
    },
    {
      name: 'Laptop Pro 14',
      identifierMode: 'SERIAL',
      meta: {
        deviceCategory: 'DEVICE_SERIAL',
      },
    },
  ])

  assert.match(error || '', /mezclar|telefono|computadoras|equipos/i)
})
