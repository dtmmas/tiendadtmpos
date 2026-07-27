import express from 'express'
import multer from 'multer'
import path from 'path'
import { authMiddleware } from '../auth.js'
import { getPool } from '../db.js'
import { registerMovement } from '../services/inventory.js'
import { uploadsDir } from '../paths.js'

const router = express.Router()

// Configure Multer for document uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir)
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    const ext = path.extname(file.originalname)
    cb(null, 'doc-' + uniqueSuffix + ext)
  }
})
const upload = multer({ storage: storage })

async function resolvePurchaseMovementType(conn, productId, warehouseId) {
  await conn.query(
    `INSERT INTO product_warehouse_stock (product_id, warehouse_id, quantity)
     VALUES (?, ?, 0)
     ON DUPLICATE KEY UPDATE quantity = quantity`,
    [productId, warehouseId]
  )

  const [rows] = await conn.query(
    `SELECT quantity
     FROM product_warehouse_stock
     WHERE product_id = ? AND warehouse_id = ?
     FOR UPDATE`,
    [productId, warehouseId]
  )

  return Number(rows[0]?.quantity || 0) > 0 ? 'PURCHASE' : 'INITIAL'
}

function roundCurrency(value) {
  return Math.round(Number(value || 0) * 100) / 100
}

async function recalculateProductCosts(conn, productId, quantity, unitCost) {
  const normalizedQty = Number(quantity || 0)
  const normalizedUnitCost = roundCurrency(unitCost)

  if (normalizedQty <= 0) {
    return
  }

  const [[product]] = await conn.query(
    `SELECT cost, avg_cost, last_cost
     FROM products
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`,
    [productId]
  )

  if (!product) {
    throw new Error(`Producto ${productId} no encontrado para recalcular costos`)
  }

  const [stockRows] = await conn.query(
    `SELECT quantity
     FROM product_warehouse_stock
     WHERE product_id = ?
     FOR UPDATE`,
    [productId]
  )

  const totalStockAfterPurchase = stockRows.reduce((sum, row) => sum + Number(row?.quantity || 0), 0)
  const previousStock = Math.max(0, totalStockAfterPurchase - normalizedQty)
  const currentAverage = roundCurrency(product.avg_cost ?? product.cost ?? 0)

  const nextAverage = previousStock > 0
    ? roundCurrency(((previousStock * currentAverage) + (normalizedQty * normalizedUnitCost)) / (previousStock + normalizedQty))
    : normalizedUnitCost

  await conn.query(
    `UPDATE products
     SET cost = ?, avg_cost = ?, last_cost = ?
     WHERE id = ?`,
    [nextAverage, nextAverage, normalizedUnitCost, productId]
  )
}

// Listar compras
router.get('/', authMiddleware, async (req, res) => {
  try {
    const limit = Math.max(1, Number(req.query.limit || 50))
    const offset = Math.max(0, Number(req.query.offset || 0))
    const search = (req.query.search || '').toString().trim()

    const pool = await getPool()
    let query = `
      SELECT p.*, COALESCE(p.status, 'COMPLETED') as status, s.name as supplier_name, u.name as user_name, w.name as warehouse_name
      FROM purchases p 
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN users u ON p.user_id = u.id
      LEFT JOIN warehouses w ON p.warehouse_id = w.id
    `
    const params = []

    if (search) {
      query += ` WHERE p.doc_no LIKE ? OR s.name LIKE ? OR p.id = ?`
      params.push(`%${search}%`, `%${search}%`, search)
    }

    query += ` ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
    params.push(limit, offset)

    const [rows] = await pool.query(query, params)
    
    // Get total count
    let countQuery = `
      SELECT COUNT(*) as total 
      FROM purchases p 
      LEFT JOIN suppliers s ON p.supplier_id = s.id
    `
    const countParams = []
    if (search) {
      countQuery += ` WHERE p.doc_no LIKE ? OR s.name LIKE ? OR p.id = ?`
      countParams.push(`%${search}%`, `%${search}%`, search)
    }
    const [countRows] = await pool.query(countQuery, countParams)
    const totalRecords = countRows[0].total

    res.json({
      data: rows,
      pagination: {
        total: totalRecords,
        limit,
        offset
      }
    })
  } catch (err) {
    console.error('Purchases list error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// Obtener detalles de una compra
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params
    const pool = await getPool()
    
    const [rows] = await pool.query(`
      SELECT p.*, COALESCE(p.status, 'COMPLETED') as status, s.name as supplier_name, u.name as user_name, w.name as warehouse_name
      FROM purchases p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      LEFT JOIN users u ON p.user_id = u.id
      LEFT JOIN warehouses w ON p.warehouse_id = w.id
      WHERE p.id = ?
    `, [id])

    if (rows.length === 0) return res.status(404).json({ error: 'Purchase not found' })
    const purchase = rows[0]

    const [items] = await pool.query(`
      SELECT pi.*, p.name as product_name, p.product_code as product_code
      FROM purchase_items pi
      JOIN products p ON pi.product_id = p.id
      WHERE pi.purchase_id = ?
    `, [id])

    purchase.items = items
    res.json(purchase)
  } catch (err) {
    console.error('Purchase details error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// Crear nueva compra
router.post('/', authMiddleware, upload.single('document'), async (req, res) => {
  try {
    let { supplierId, items, total, docNo, notes, warehouseId } = req.body
    const userId = req.user?.id
    const documentPath = req.file ? `/uploads/${req.file.filename}` : null

    // Parse items if string (multipart/form-data)
    if (typeof items === 'string') {
      try {
        items = JSON.parse(items)
      } catch (e) {
        return res.status(400).json({ error: 'Invalid items JSON format' })
      }
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No hay items en la compra' })
    }

    const pool = await getPool()
    const conn = await pool.getConnection()

    try {
      await conn.beginTransaction()

      // 1. Crear Compra
      const [result] = await conn.query(
        'INSERT INTO purchases (supplier_id, user_id, doc_no, total, notes, status, warehouse_id, document_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [supplierId || null, userId || null, docNo || null, total, notes || null, 'COMPLETED', warehouseId || null, documentPath]
      )
      const purchaseId = result.insertId

      // 2. Procesar items y actualizar stock
      const targetWarehouseId = warehouseId || 1 // Default to 1 if not specified
      const movementTypeByProduct = new Map()

      for (const item of items) {
        // item: { productId, quantity, unitCost }
        const itemTotal = Number(item.unitCost) * Number(item.quantity)
        const movementKey = `${item.productId}:${targetWarehouseId}`
        let movementType = movementTypeByProduct.get(movementKey)
        if (!movementType) {
          movementType = await resolvePurchaseMovementType(conn, item.productId, targetWarehouseId)
          movementTypeByProduct.set(movementKey, movementType)
        }
        const movementLabel = movementType === 'INITIAL' ? 'Ingreso inicial por compra' : 'Compra'
        
        await conn.query(
          'INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, total, total_cost, serials) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [purchaseId, item.productId, item.quantity, item.unitCost, itemTotal, itemTotal, item.serials || null]
        )

        // Handle Product Types
        if (item.productType === 'MEDICINAL') {
            if (item.batches && Array.isArray(item.batches) && item.batches.length > 0) {
                for (const batch of item.batches) {
                    if (batch.batchNo && batch.expiryDate && batch.quantity > 0) {
                        await conn.query(
                            'INSERT INTO product_batches (product_id, batch_no, expiry_date, quantity, warehouse_id) VALUES (?, ?, ?, ?, ?)',
                            [item.productId, batch.batchNo, batch.expiryDate, batch.quantity, targetWarehouseId]
                        )
                    }
                }
            } else if (item.batchNo && item.expiryDate) {
                 // Fallback for legacy/single batch
                 await conn.query(
                     'INSERT INTO product_batches (product_id, batch_no, expiry_date, quantity, warehouse_id) VALUES (?, ?, ?, ?, ?)',
                     [item.productId, item.batchNo, item.expiryDate, item.quantity, targetWarehouseId]
                 )
            }
        } else if (item.productType === 'IMEI' && item.serials) {
            const imeis = String(item.serials || '').split(/\r?\n/).map(s => s.trim()).filter(s => s)
            
            if (imeis.length !== Number(item.quantity)) {
                 throw new Error(`La cantidad de IMEIs (${imeis.length}) no coincide con la cantidad del producto ${item.productId} (${item.quantity})`)
            }

            for (const imei of imeis) {
                const [existing] = await conn.query('SELECT id FROM product_imeis WHERE product_id = ? AND imei = ?', [item.productId, imei])
                if (existing.length > 0) {
                     throw new Error(`El IMEI ${imei} ya existe para el producto ${item.productId}`)
                }

                await conn.query(
                    'INSERT INTO product_imeis (product_id, imei, status, warehouse_id) VALUES (?, ?, "AVAILABLE", ?)',
                    [item.productId, imei, targetWarehouseId]
                )
            }
        } else if (item.productType === 'SERIAL' && item.serials) {
             // Limpiar y validar seriales
             // Usar expresión regular para dividir por saltos de línea (\r\n, \n, \r)
             const serials = String(item.serials || '').split(/\r?\n/).map(s => s.trim()).filter(s => s)
             
             // Verificar que la cantidad de seriales coincida con la cantidad comprada
             if (serials.length !== Number(item.quantity)) {
                 throw new Error(`La cantidad de seriales (${serials.length}) no coincide con la cantidad del producto ${item.productId} (${item.quantity})`)
             }

             for (const serial of serials) {
                // Verificar si el serial ya existe para este producto (opcional, pero recomendado para evitar duplicados si la DB no tiene restricción única global)
                const [existing] = await conn.query('SELECT id FROM product_serials WHERE product_id = ? AND serial_no = ?', [item.productId, serial])
                if (existing.length > 0) {
                     // Si ya existe, podemos optar por lanzar error o ignorar. 
                     // Lanzar error es más seguro para evitar inconsistencias.
                     throw new Error(`El serial ${serial} ya existe para el producto ${item.productId}`)
                }

                await conn.query(
                    'INSERT INTO product_serials (product_id, serial_no, status, warehouse_id) VALUES (?, ?, "AVAILABLE", ?)', // Asumimos estado AVAILABLE
                    [item.productId, serial, targetWarehouseId]
                )
             }
        }

        // Actualizar stock usando servicio centralizado
        await registerMovement({
            productId: item.productId,
            warehouseId: targetWarehouseId, // Use the target warehouse
            type: movementType,
            quantity: item.quantity,
            referenceId: purchaseId,
            userId: userId,
            notes: `${movementLabel} #${docNo || purchaseId}`
        }, conn)

        await recalculateProductCosts(conn, item.productId, item.quantity, item.unitCost)
      }

      await conn.commit()
      
      res.json({ success: true, id: purchaseId, message: 'Compra registrada correctamente' })
    } catch (err) {
      await conn.rollback()
      console.error('Purchase creation transaction error:', err)
      res.status(500).json({ error: 'Error al procesar la compra' })
    } finally {
      conn.release()
    }
  } catch (err) {
    console.error('Purchase creation error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

export default router
