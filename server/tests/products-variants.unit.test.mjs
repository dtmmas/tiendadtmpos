import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isGroupedImeiSpreadsheetFormat,
  normalizeGroupedImeiSpreadsheetRows,
  normalizeSerializedVariants,
  parseJsonArrayFieldDetailed,
  validateSerializedVariantCompatibility,
} from '../routes/products.js'

test('parseJsonArrayFieldDetailed reporta error descriptivo para JSON inválido', () => {
  const result = parseJsonArrayFieldDetailed({ variants: '{bad json' }, 'variants')

  assert.deepEqual(result.value, [])
  assert.match(result.error || '', /JSON inválido en variants/i)
})

test('detecta el formato agrupado de telefonos con IMEI por bloques', () => {
  const result = isGroupedImeiSpreadsheetFormat([
    { CODIGO: 'LOGICB7-GRS', IMEI: '351846230572274', ' PRECIO ': 100 },
    { CODIGO: '', IMEI: '351846230585680', ' PRECIO ': '' },
    { CODIGO: 'LOGICB7-CEL', IMEI: '351846230465057', ' PRECIO ': 100 },
  ])

  assert.equal(result, true)
})

test('normaliza hojas agrupadas de telefonos a filas importables tipo IMEI', () => {
  const rows = normalizeGroupedImeiSpreadsheetRows([
    { CODIGO: 'LOGICB7-GRS', IMEI: '351846230572274', ' PRECIO ': 100 },
    { CODIGO: '', IMEI: '351846230585680', ' PRECIO ': '' },
    { CODIGO: 'LOGICB7-CEL', IMEI: '351846230465057', ' PRECIO ': 100 },
  ])

  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], {
    name: 'LOGICB7-GRS',
    sku: 'LOGICB7-GRS',
    productCode: 'LOGICB7-GRS',
    unit: 'UND',
    description: 'LOGICB7-GRS',
    productType: 'IMEI',
    imeis: '351846230572274,351846230585680',
    price: 100,
  })
  assert.equal(rows[1].productType, 'IMEI')
  assert.equal(rows[1].imeis, '351846230465057')
})

test('normaliza hojas agrupadas y fusiona codigos repetidos sin duplicar IMEIs', () => {
  const rows = normalizeGroupedImeiSpreadsheetRows([
    { CODIGO: 'SAM-A17-4/128GB-NEG', IMEI: '353181615667632', ' PRECIO ': 1399 },
    { CODIGO: '', IMEI: '353181615667633', ' PRECIO ': '' },
    { CODIGO: 'SAM-A17-4/128GB-NEG', IMEI: '353181615667633', ' PRECIO ': 1399 },
    { CODIGO: '', IMEI: '353181615667634', ' PRECIO ': '' },
  ])

  assert.equal(rows.length, 1)
  assert.equal(rows[0].productCode, 'SAM-A17-4/128GB-NEG')
  assert.equal(rows[0].imeis, '353181615667632,353181615667633,353181615667634')
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
