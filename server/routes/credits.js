import express from 'express'
import multer from 'multer'
import path from 'path'
import { authMiddleware } from '../auth.js'
import { getPool } from '../db.js'
import { uploadsDir } from '../paths.js'

const router = express.Router()
const schemaCache = new Map()

function normalizeDocumentUrl(value) {
  if (!value || typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('/uploads/')) return trimmed
  if (trimmed.startsWith('uploads/')) return `/${trimmed}`

  try {
    const parsed = new URL(trimmed)
    if (parsed.pathname.startsWith('/uploads/')) {
      return `${parsed.pathname}${parsed.search || ''}${parsed.hash || ''}`
    }
  } catch {
    if (trimmed.includes('/uploads/')) {
      return trimmed.slice(trimmed.indexOf('/uploads/'))
    }
  }

  return trimmed
}

async function getExistingColumns(pool, table, columns) {
  const cacheKey = `${table}:${columns.sort().join(',')}`
  const cached = schemaCache.get(cacheKey)
  if (cached) return cached

  const placeholders = columns.map(() => '?').join(', ')
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME IN (${placeholders})`,
    [table, ...columns]
  )

  const existing = new Set(rows.map(row => row.COLUMN_NAME))
  schemaCache.set(cacheKey, existing)
  return existing
}

async function getCreditPaymentsSchema(pool) {
  return getExistingColumns(pool, 'credit_payments', [
    'payment_method',
    'reference',
    'document_url',
    'received_by',
    'paid_at',
    'user_id',
  ])
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir)
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    const ext = path.extname(file.originalname)
    cb(null, file.fieldname + '-' + uniqueSuffix + ext)
  }
})

const upload = multer({ storage: storage })

// Listar créditos pendientes
router.get('/', authMiddleware, async (req, res) => {
  try {
    const search = (req.query.search || '').toString().trim()
    const status = (req.query.status || '').toString().trim() // 'PENDING', 'PAID'
    const startDate = (req.query.startDate || '').toString().trim()
    const endDate = (req.query.endDate || '').toString().trim()
    
    const pool = await getPool()
    const salesColumns = await getExistingColumns(pool, 'sales', ['status'])
    const salesStatusFilter = salesColumns.has('status')
      ? `COALESCE(s.status, 'COMPLETED') != 'CANCELLED'`
      : '1 = 1'
    
    let query = `
      SELECT 
        i.id, 
        i.sale_id, 
        i.due_date, 
        i.amount as total_amount, 
        i.paid,
        s.doc_no, 
        s.created_at as sale_date,
        c.name as customer_name,
        (SELECT COALESCE(SUM(amount), 0) FROM credit_payments cp WHERE cp.installment_id = i.id) as paid_amount
      FROM installments i 
      JOIN sales s ON i.sale_id = s.id 
      LEFT JOIN customers c ON s.customer_id = c.id 
      WHERE ${salesStatusFilter}
    `
    
    const params = []

    if (search) {
      query += ` AND (c.name LIKE ? OR s.doc_no LIKE ? OR s.id = ?)`
      params.push(`%${search}%`, `%${search}%`, search)
    }

    if (status === 'PENDING' || status === 'PENDIENTE') {
      query += ` AND i.paid = 0`
    } else if (status === 'PAID' || status === 'PAGADO' || status === 'PAGADOS') {
      query += ` AND i.paid = 1`
    }

    if (startDate) {
      query += ` AND DATE(s.created_at) >= ?`
      params.push(startDate)
    }

    if (endDate) {
      query += ` AND DATE(s.created_at) <= ?`
      params.push(endDate)
    }

    query += ` ORDER BY i.paid ASC, i.due_date ASC`

    const [rows] = await pool.query(query, params)
    res.json(rows)
  } catch (err) {
    console.error('Credits list error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// Listar historial de pagos de un crédito
router.get('/:id/payments', authMiddleware, async (req, res) => {
  try {
    const installmentId = req.params.id
    const pool = await getPool()
    const columns = await getCreditPaymentsSchema(pool)
    
    const [rows] = await pool.query(
      `SELECT 
         id,
         amount,
         ${columns.has('payment_method') ? `COALESCE(payment_method, 'CASH')` : `'CASH'`} as payment_method,
         ${columns.has('reference') ? 'reference' : 'NULL'} as reference,
         ${columns.has('paid_at') ? 'paid_at' : 'CURRENT_TIMESTAMP'} as created_at,
         ${columns.has('received_by') ? 'received_by' : 'NULL'} as received_by,
         ${columns.has('document_url') ? 'document_url' : 'NULL'} as document_url
       FROM credit_payments 
       WHERE installment_id = ? 
       ORDER BY ${columns.has('paid_at') ? 'paid_at' : 'id'} DESC, id DESC`,
      [installmentId]
    )
    
    res.json(rows.map(row => ({
      ...row,
      document_url: normalizeDocumentUrl(row.document_url),
    })))
  } catch (err) {
    console.error('Payments history error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// Registrar pago
router.post('/pay', authMiddleware, upload.single('document'), async (req, res) => {
  try {
    const { installmentId, amount, paymentMethod, reference, responsible, paymentDate } = req.body
    const documentUrl = req.file ? `/uploads/${req.file.filename}` : null
    
    if (!installmentId || !amount || Number(amount) <= 0) {
      return res.status(400).json({ error: 'Datos inválidos' })
    }

    if ((paymentMethod === 'CARD' || paymentMethod === 'DEPOSIT') && !reference) {
      return res.status(400).json({ error: 'Referencia requerida para Tarjeta/Depósito' })
    }

    // Determinar fecha de pago
    let finalPaymentDate = new Date()
    if (paymentMethod !== 'CASH' && paymentDate) {
      finalPaymentDate = new Date(paymentDate)
    }

    const pool = await getPool()
    const paymentColumns = await getCreditPaymentsSchema(pool)
    const conn = await pool.getConnection()

    try {
      await conn.beginTransaction()

      // 1. Verificar deuda actual
      const [rows] = await conn.query(
        `SELECT 
          i.id, i.amount, i.paid, i.sale_id,
          COALESCE(s.status, 'COMPLETED') as sale_status,
          (SELECT COALESCE(SUM(amount), 0) FROM credit_payments cp WHERE cp.installment_id = i.id) as paid_so_far
         FROM installments i 
         JOIN sales s ON s.id = i.sale_id
         WHERE i.id = ? FOR UPDATE`,
        [installmentId]
      )

      if (rows.length === 0) {
        throw new Error('Cuota no encontrada')
      }

      const installment = rows[0]
      if (installment.paid) {
        throw new Error('Esta cuota ya está pagada')
      }
      if (installment.sale_status === 'CANCELLED') {
        throw new Error('No se puede registrar pagos a una venta cancelada')
      }

      const currentDebt = Number(installment.amount) - Number(installment.paid_so_far)
      if (Number(amount) > currentDebt) {
        throw new Error(`El monto excede la deuda pendiente (${currentDebt})`)
      }

      const finalPaymentMethod = paymentMethod || 'CASH'
      let activeShift = null
      if (finalPaymentMethod === 'CASH') {
        const [shiftRows] = await conn.query(
          'SELECT id FROM cashbox_shifts WHERE opened_by = ? AND closed_at IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE',
          [req.user.id]
        )
        activeShift = shiftRows?.[0] || null
        if (!activeShift) {
          throw new Error('Caja cerrada. Debes abrir caja para registrar cobros en efectivo.')
        }
      }

      // 2. Registrar pago
      const insertColumns = ['installment_id', 'amount']
      const insertValues = [installmentId, amount]

      if (paymentColumns.has('payment_method')) {
        insertColumns.push('payment_method')
        insertValues.push(finalPaymentMethod)
      }
      if (paymentColumns.has('reference')) {
        insertColumns.push('reference')
        insertValues.push(reference || null)
      }
      if (paymentColumns.has('document_url')) {
        insertColumns.push('document_url')
        insertValues.push(documentUrl)
      }
      if (paymentColumns.has('received_by')) {
        insertColumns.push('received_by')
        insertValues.push(responsible || null)
      }
      if (paymentColumns.has('paid_at')) {
        insertColumns.push('paid_at')
        insertValues.push(finalPaymentDate)
      }
      if (paymentColumns.has('user_id')) {
        insertColumns.push('user_id')
        insertValues.push(req.user.id)
      }

      const [result] = await conn.query(
        `INSERT INTO credit_payments (${insertColumns.join(', ')}) VALUES (${insertColumns.map(() => '?').join(', ')})`,
        insertValues
      )
      const paymentId = result.insertId

      if (finalPaymentMethod === 'CASH') {
        await conn.query(
          'INSERT INTO cash_movements (shift_id, type, concept, amount, ref_type, ref_id, created_at) VALUES (?, "IN", ?, ?, "CREDIT_PAYMENT", ?, ?)',
          [activeShift.id, `Abono de crédito venta #${installment.sale_id}`, amount, paymentId, finalPaymentDate]
        )
      }

      // 3. Verificar si se completó el pago
      const newPaidAmount = Number(installment.paid_so_far) + Number(amount)
      // Usamos un pequeño margen por errores de punto flotante
      if (Math.abs(newPaidAmount - Number(installment.amount)) < 0.01) {
        await conn.query(
          'UPDATE installments SET paid = 1, paid_at = ? WHERE id = ?',
          [finalPaymentDate, installmentId]
        )
      }

      await conn.commit()
      res.json({ success: true, paymentId })

    } catch (err) {
      await conn.rollback()
      console.error('Error registrando pago:', err)
      res.status(400).json({ error: err.message || 'Error al registrar pago' })
    } finally {
      conn.release()
    }

  } catch (err) {
    console.error('Credit pay error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

export default router
