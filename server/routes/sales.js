import express from 'express'
import { authMiddleware, getUserWarehouseId, isAdminUser, canUserSell, hasExplicitUserPermission } from '../auth.js'
import { getPool } from '../db.js'
import { registerMovement } from '../services/inventory.js'

const router = express.Router()

function roundCurrency(value) {
  return Math.round(Number(value || 0) * 100) / 100
}

function normalizeRefundMethod(value) {
  const method = String(value || '').trim().toUpperCase()
  return ['CASH', 'CARD', 'DEPOSIT', 'CREDIT'].includes(method) ? method : 'CASH'
}

async function columnExists(db, table, column) {
  const [rows] = await db.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [column])
  return Array.isArray(rows) && rows.length > 0
}

async function fkExists(db, table, fkName) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS c
     FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND CONSTRAINT_NAME = ?
       AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
    [table, fkName]
  )
  return Number(rows?.[0]?.c || 0) > 0
}

async function ensureSalesSchema(db) {
  const hasSalesUserId = await columnExists(db, 'sales', 'user_id')
  if (!hasSalesUserId) {
    await db.query('ALTER TABLE sales ADD COLUMN user_id INT NULL')
  }

  if (!(await fkExists(db, 'sales', 'fk_sales_user'))) {
    try {
      await db.query(`
        ALTER TABLE sales
        ADD CONSTRAINT fk_sales_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      `)
    } catch (error) {
      console.warn(`Skipped fk_sales_user: ${error.message}`)
    }
  }

  const hasSalesWarehouseId = await columnExists(db, 'sales', 'warehouse_id')
  if (!hasSalesWarehouseId) {
    await db.query('ALTER TABLE sales ADD COLUMN warehouse_id INT NULL')
  }

  if (!(await fkExists(db, 'sales', 'fk_sales_warehouse'))) {
    try {
      await db.query(`
        ALTER TABLE sales
        ADD CONSTRAINT fk_sales_warehouse
        FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE SET NULL
      `)
    } catch (error) {
      console.warn(`Skipped fk_sales_warehouse: ${error.message}`)
    }
  }

  // Completa ventas históricas usando primero inventory_movements y luego caja.
  await db.query(`
    UPDATE sales s
    LEFT JOIN (
      SELECT reference_id AS sale_id, MAX(user_id) AS user_id
      FROM inventory_movements
      WHERE type = 'SALE'
        AND reference_id IS NOT NULL
        AND user_id IS NOT NULL
      GROUP BY reference_id
    ) sale_inventory_user ON sale_inventory_user.sale_id = s.id
    SET s.user_id = sale_inventory_user.user_id
    WHERE (s.user_id IS NULL OR s.user_id = 0)
      AND sale_inventory_user.user_id IS NOT NULL
  `)

  await db.query(`
    UPDATE sales s
    LEFT JOIN (
      SELECT cm.ref_id AS sale_id, MAX(cs.opened_by) AS opened_by
      FROM cash_movements cm
      JOIN cashbox_shifts cs ON cs.id = cm.shift_id
      WHERE cm.ref_type = 'SALE' AND cm.ref_id IS NOT NULL
      GROUP BY cm.ref_id
    ) sale_shift ON sale_shift.sale_id = s.id
    SET s.user_id = sale_shift.opened_by
    WHERE (s.user_id IS NULL OR s.user_id = 0)
      AND sale_shift.opened_by IS NOT NULL
  `)

  await db.query(`
    UPDATE sales s
    LEFT JOIN (
      SELECT reference_id AS sale_id, MAX(warehouse_id) AS warehouse_id
      FROM inventory_movements
      WHERE type = 'SALE'
        AND reference_id IS NOT NULL
        AND warehouse_id IS NOT NULL
      GROUP BY reference_id
    ) sale_inventory_warehouse ON sale_inventory_warehouse.sale_id = s.id
    SET s.warehouse_id = sale_inventory_warehouse.warehouse_id
    WHERE (s.warehouse_id IS NULL OR s.warehouse_id = 0)
      AND sale_inventory_warehouse.warehouse_id IS NOT NULL
  `)

  await db.query(`
    UPDATE sales s
    LEFT JOIN users u ON u.id = s.user_id
    SET s.warehouse_id = u.warehouse_id
    WHERE (s.warehouse_id IS NULL OR s.warehouse_id = 0)
      AND u.warehouse_id IS NOT NULL
  `)

  if (!(await columnExists(db, 'sale_items', 'original_unit_price'))) {
    await db.query('ALTER TABLE sale_items ADD COLUMN original_unit_price DECIMAL(10,2) NULL')
  }

  if (!(await columnExists(db, 'sale_items', 'price_source'))) {
    await db.query("ALTER TABLE sale_items ADD COLUMN price_source VARCHAR(30) NULL DEFAULT 'BASE'")
  }

  if (!(await columnExists(db, 'sale_items', 'unit_cost_snapshot'))) {
    await db.query('ALTER TABLE sale_items ADD COLUMN unit_cost_snapshot DECIMAL(12,2) NULL')
  }

  if (!(await columnExists(db, 'sale_items', 'total_cost_snapshot'))) {
    await db.query('ALTER TABLE sale_items ADD COLUMN total_cost_snapshot DECIMAL(12,2) NULL')
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS sale_returns (
      id INT AUTO_INCREMENT PRIMARY KEY,
      sale_id INT NOT NULL,
      user_id INT NULL,
      warehouse_id INT NULL,
      reason TEXT NOT NULL,
      refund_method VARCHAR(20) NOT NULL DEFAULT 'CASH',
      refund_total DECIMAL(12,2) NOT NULL DEFAULT 0,
      affects_cash TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_sale_returns_sale FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
    )
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS sale_return_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      sale_return_id INT NOT NULL,
      sale_item_id INT NOT NULL,
      product_id INT NOT NULL,
      quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
      unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      total DECIMAL(12,2) NOT NULL DEFAULT 0,
      unit_cost_snapshot DECIMAL(12,2) NULL,
      total_cost_snapshot DECIMAL(12,2) NULL,
      serial VARCHAR(100) NULL,
      imei VARCHAR(50) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_sale_return_items_return FOREIGN KEY (sale_return_id) REFERENCES sale_returns(id) ON DELETE CASCADE,
      CONSTRAINT fk_sale_return_items_sale_item FOREIGN KEY (sale_item_id) REFERENCES sale_items(id) ON DELETE CASCADE
    )
  `)

  try {
    await db.query(`
      ALTER TABLE cash_movements
      MODIFY COLUMN ref_type ENUM('SALE','PURCHASE','MANUAL','PAYMENT','CREDIT_PAYMENT','SALE_RETURN') NOT NULL
    `)
  } catch (error) {
    console.warn(`Skipped cash_movements.ref_type SALE_RETURN normalization: ${error.message}`)
  }

  await db.query(`
    UPDATE sale_items si
    JOIN products p ON p.id = si.product_id
    SET si.unit_cost_snapshot = COALESCE(si.unit_cost_snapshot, p.avg_cost, p.cost, 0),
        si.total_cost_snapshot = COALESCE(si.total_cost_snapshot, si.quantity * COALESCE(si.unit_cost_snapshot, p.avg_cost, p.cost, 0))
    WHERE si.unit_cost_snapshot IS NULL OR si.total_cost_snapshot IS NULL
  `)
}

async function buildSalesContext(db) {
  await ensureSalesSchema(db)
  const hasSalesUserId = await columnExists(db, 'sales', 'user_id')

  return {
    hasSalesUserId,
    sellerIdExpr: hasSalesUserId
      ? 'COALESCE(s.user_id, sale_inventory_user.user_id, sale_shift.opened_by)'
      : 'COALESCE(sale_inventory_user.user_id, sale_shift.opened_by)',
    sellerNameExpr: hasSalesUserId
      ? "COALESCE(su.name, iu.name, cu.name, 'SIN USUARIO')"
      : "COALESCE(iu.name, cu.name, 'SIN USUARIO')",
    sellerJoin: hasSalesUserId
      ? `
        LEFT JOIN users su ON su.id = s.user_id
        LEFT JOIN users iu ON iu.id = sale_inventory_user.user_id
      `
      : 'LEFT JOIN users iu ON iu.id = sale_inventory_user.user_id',
    baseJoins: `
      LEFT JOIN customers c ON s.customer_id = c.id
      LEFT JOIN warehouses sw ON sw.id = s.warehouse_id
      LEFT JOIN (
        SELECT i.sale_id,
               MIN(i.paid) AS credit_fully_paid,
               CASE
                 WHEN MIN(i.paid) = 1 THEN COALESCE(MAX(i.paid_at), MAX(cp.last_paid_at))
                 ELSE NULL
               END AS credit_fully_paid_at
        FROM installments i
        LEFT JOIN (
          SELECT installment_id, MAX(paid_at) AS last_paid_at
          FROM credit_payments
          GROUP BY installment_id
        ) cp ON cp.installment_id = i.id
        GROUP BY i.sale_id
      ) i ON i.sale_id = s.id
      LEFT JOIN (
        SELECT si.sale_id,
               COALESCE(SUM(COALESCE(si.total_cost_snapshot, si.quantity * COALESCE(si.unit_cost_snapshot, p.avg_cost, p.cost, 0))), 0) AS cost_total,
               COALESCE(SUM(si.total - COALESCE(si.total_cost_snapshot, si.quantity * COALESCE(si.unit_cost_snapshot, p.avg_cost, p.cost, 0))), 0) AS profit
        FROM sale_items si
        JOIN products p ON p.id = si.product_id
        GROUP BY si.sale_id
      ) calc ON calc.sale_id = s.id
      LEFT JOIN (
        SELECT reference_id AS sale_id, MAX(user_id) AS user_id
        FROM inventory_movements
        WHERE type = 'SALE'
          AND reference_id IS NOT NULL
          AND user_id IS NOT NULL
        GROUP BY reference_id
      ) sale_inventory_user ON sale_inventory_user.sale_id = s.id
      LEFT JOIN (
        SELECT cm.ref_id AS sale_id, MAX(cs.opened_by) AS opened_by
        FROM cash_movements cm
        JOIN cashbox_shifts cs ON cs.id = cm.shift_id
        WHERE cm.ref_type = 'SALE' AND cm.ref_id IS NOT NULL
        GROUP BY cm.ref_id
      ) sale_shift ON sale_shift.sale_id = s.id
      LEFT JOIN (
        SELECT sr.sale_id,
               COUNT(DISTINCT sr.id) AS return_count,
               COALESCE(SUM(sri.total), 0) AS returned_total,
               COALESCE(SUM(COALESCE(sri.total_cost_snapshot, sri.quantity * COALESCE(sri.unit_cost_snapshot, 0))), 0) AS returned_cost_total,
               COALESCE(SUM(sri.total - COALESCE(sri.total_cost_snapshot, sri.quantity * COALESCE(sri.unit_cost_snapshot, 0))), 0) AS returned_profit
        FROM sale_returns sr
        JOIN sale_return_items sri ON sri.sale_return_id = sr.id
        GROUP BY sr.sale_id
      ) return_calc ON return_calc.sale_id = s.id
      LEFT JOIN users cu ON cu.id = sale_shift.opened_by
    `,
  }
}

function getSalesFilters(req, context, forceUserId = null) {
  const search = (req.query.search || '').toString().trim()
  const startDate = (req.query.startDate || '').toString().slice(0, 10)
  const endDate = (req.query.endDate || '').toString().slice(0, 10)
  const paymentMethod = (req.query.paymentMethod || '').toString().trim().toUpperCase()
  const statusFilter = (req.query.statusFilter || 'ACTIVE').toString().trim().toUpperCase()
  const requestedUserId = Number(req.query.userId || 0)
  const requestedWarehouseId = Number(req.query.warehouseId || 0)
  const isAdmin = isAdminUser(req.user)
  const effectiveUserId = forceUserId || (isAdmin ? requestedUserId : Number(req.user?.id || 0))
  const userWarehouseId = getUserWarehouseId(req.user)
  const effectiveWarehouseId = isAdmin ? requestedWarehouseId : Number(userWarehouseId || 0)
  const isPaidCreditFilter = paymentMethod === 'CREDIT_PAID'
  const isRealizedFilter = paymentMethod === 'REALIZED'
  const dateFieldExpr = isPaidCreditFilter ? 'DATE(i.credit_fully_paid_at)' : 'DATE(s.created_at)'
  const where = []
  const params = []

  if (!isAdmin && !userWarehouseId) {
    where.push('1 = 0')
  }

  if (search) {
    where.push(`(s.doc_no LIKE ? OR c.name LIKE ? OR s.id = ? OR ${context.sellerNameExpr} LIKE ?)`)
    params.push(`%${search}%`, `%${search}%`, Number(search) || 0, `%${search}%`)
  }
  if (startDate) {
    if (isRealizedFilter) {
      where.push(`(
        (
          COALESCE(s.payment_method, '') IN ('CASH', 'CARD', 'DEPOSIT')
          AND COALESCE(s.is_credit, 0) = 0
          AND DATE(s.created_at) >= ?
        )
        OR (
          (s.payment_method = 'CREDIT' OR COALESCE(s.is_credit, 0) = 1)
          AND COALESCE(i.credit_fully_paid, 0) = 1
          AND i.credit_fully_paid_at IS NOT NULL
          AND DATE(i.credit_fully_paid_at) >= ?
        )
      )`)
      params.push(startDate, startDate)
    } else {
      where.push(`${dateFieldExpr} >= ?`)
      params.push(startDate)
    }
  }
  if (endDate) {
    if (isRealizedFilter) {
      where.push(`(
        (
          COALESCE(s.payment_method, '') IN ('CASH', 'CARD', 'DEPOSIT')
          AND COALESCE(s.is_credit, 0) = 0
          AND DATE(s.created_at) <= ?
        )
        OR (
          (s.payment_method = 'CREDIT' OR COALESCE(s.is_credit, 0) = 1)
          AND COALESCE(i.credit_fully_paid, 0) = 1
          AND i.credit_fully_paid_at IS NOT NULL
          AND DATE(i.credit_fully_paid_at) <= ?
        )
      )`)
      params.push(endDate, endDate)
    } else {
      where.push(`${dateFieldExpr} <= ?`)
      params.push(endDate)
    }
  }
  if (effectiveUserId > 0) {
    where.push(`${context.sellerIdExpr} = ?`)
    params.push(effectiveUserId)
  }
  if (effectiveWarehouseId > 0) {
    where.push('s.warehouse_id = ?')
    params.push(effectiveWarehouseId)
  }
  if (statusFilter === 'CANCELLED') {
    where.push(`COALESCE(s.status, 'COMPLETED') = 'CANCELLED'`)
  } else if (statusFilter !== 'ALL') {
    where.push(`COALESCE(s.status, 'COMPLETED') <> 'CANCELLED'`)
  }
  if (paymentMethod === 'NON_CREDIT') {
    where.push(`(COALESCE(s.payment_method, '') <> 'CREDIT' AND COALESCE(s.is_credit, 0) = 0)`)
  } else if (paymentMethod === 'CREDIT') {
    where.push(`(s.payment_method = 'CREDIT' OR COALESCE(s.is_credit, 0) = 1)`)
  } else if (paymentMethod === 'CREDIT_PAID') {
    where.push(`(s.payment_method = 'CREDIT' OR COALESCE(s.is_credit, 0) = 1)`)
    where.push('COALESCE(i.credit_fully_paid, 0) = 1')
    where.push('i.credit_fully_paid_at IS NOT NULL')
  } else if (paymentMethod === 'REALIZED') {
    where.push(`(
      (
        COALESCE(s.payment_method, '') IN ('CASH', 'CARD', 'DEPOSIT')
        AND COALESCE(s.is_credit, 0) = 0
      )
      OR (
        (s.payment_method = 'CREDIT' OR COALESCE(s.is_credit, 0) = 1)
        AND COALESCE(i.credit_fully_paid, 0) = 1
        AND i.credit_fully_paid_at IS NOT NULL
      )
    )`)
  } else if (['CASH', 'CARD', 'DEPOSIT'].includes(paymentMethod)) {
    where.push('s.payment_method = ?')
    params.push(paymentMethod)
  }

  return {
    whereClause: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
    orderByClause: isPaidCreditFilter
      ? 'ORDER BY i.credit_fully_paid_at DESC, s.created_at DESC'
      : isRealizedFilter
        ? `ORDER BY
             CASE
               WHEN (s.payment_method = 'CREDIT' OR COALESCE(s.is_credit, 0) = 1)
                 AND COALESCE(i.credit_fully_paid, 0) = 1
                 AND i.credit_fully_paid_at IS NOT NULL
               THEN i.credit_fully_paid_at
               ELSE s.created_at
             END DESC,
             s.created_at DESC`
        : 'ORDER BY s.created_at DESC',
  }
}

function buildSalesSelect(context, canSeeProfit) {
  return `
    SELECT s.*, c.name AS customer_name,
           i.credit_fully_paid,
           i.credit_fully_paid_at,
           COALESCE(return_calc.return_count, 0) AS return_count,
           COALESCE(return_calc.returned_total, 0) AS returned_total,
           CASE WHEN s.status = 'CANCELLED' THEN 0 ELSE COALESCE(s.total, 0) - COALESCE(return_calc.returned_total, 0) END AS final_total,
           sw.name AS warehouse_name,
           ${canSeeProfit ? 'COALESCE(calc.cost_total, 0)' : 'NULL'} AS cost_total,
           ${canSeeProfit ? 'COALESCE(return_calc.returned_cost_total, 0)' : 'NULL'} AS returned_cost_total,
           ${canSeeProfit ? "CASE WHEN s.status = 'CANCELLED' THEN 0 ELSE COALESCE(calc.profit, 0) END" : 'NULL'} AS profit,
           ${canSeeProfit ? "CASE WHEN s.status = 'CANCELLED' THEN 0 ELSE COALESCE(calc.profit, 0) - COALESCE(return_calc.returned_profit, 0) END" : 'NULL'} AS final_profit,
           ${context.sellerIdExpr} AS seller_id,
           ${context.sellerNameExpr} AS seller_name
    FROM sales s
    ${context.baseJoins}
    ${context.sellerJoin}
  `
}

// Listar ventas (historial)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const limit = Math.max(1, Number(req.query.limit || 50))
    const offset = Math.max(0, Number(req.query.offset || 0))
    const pool = await getPool()
    await ensureSalesSchema(pool)
    const context = await buildSalesContext(pool)
    const canSeeProfit = req.user?.role === 'ADMIN'
    const { whereClause, params, orderByClause } = getSalesFilters(req, context)
    const query = `
      ${buildSalesSelect(context, canSeeProfit)}
      ${whereClause}
      ${orderByClause}
      LIMIT ? OFFSET ?
    `
    const rowsParams = [...params, limit, offset]
    const [rows] = await pool.query(query, rowsParams)

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM sales s
      ${context.baseJoins}
      ${context.sellerJoin}
      ${whereClause}
    `
    const [countRows] = await pool.query(countQuery, params)
    const totalRecords = Number(countRows?.[0]?.total || 0)

    const [summaryRows] = await pool.query(
      `
        SELECT COUNT(*) AS records,
               COALESCE(SUM(s.total), 0) AS gross_total,
               COALESCE(SUM(CASE WHEN s.status = 'CANCELLED' THEN 0 ELSE s.total - COALESCE(return_calc.returned_total, 0) END), 0) AS net_total,
               COALESCE(SUM(CASE WHEN s.status = 'CANCELLED' THEN 0 ELSE COALESCE(calc.profit, 0) - COALESCE(return_calc.returned_profit, 0) END), 0) AS total_profit,
               COALESCE(SUM(CASE WHEN s.status = 'CANCELLED' THEN 1 ELSE 0 END), 0) AS cancelled_count
        FROM sales s
        ${context.baseJoins}
        ${context.sellerJoin}
        ${whereClause}
      `,
      params
    )

    const [summaryByMethodRows] = await pool.query(
      `
        SELECT
          CASE
            WHEN s.payment_method = 'CREDIT' OR COALESCE(s.is_credit, 0) = 1 THEN 'CREDIT'
            ELSE COALESCE(s.payment_method, 'N/D')
          END AS payment_method,
          COALESCE(SUM(CASE WHEN s.status = 'CANCELLED' THEN 0 ELSE s.total - COALESCE(return_calc.returned_total, 0) END), 0) AS net_total
        FROM sales s
        ${context.baseJoins}
        ${context.sellerJoin}
        ${whereClause}
        GROUP BY
          CASE
            WHEN s.payment_method = 'CREDIT' OR COALESCE(s.is_credit, 0) = 1 THEN 'CREDIT'
            ELSE COALESCE(s.payment_method, 'N/D')
          END
      `,
      params
    )

    const byUserRows = canSeeProfit
      ? (await pool.query(
          `
            SELECT ${context.sellerIdExpr} AS user_id,
                   ${context.sellerNameExpr} AS user_name,
                   COUNT(*) AS sales_count,
                   COALESCE(SUM(s.total), 0) AS gross_total,
                   COALESCE(SUM(CASE WHEN s.status = 'CANCELLED' THEN 0 ELSE s.total - COALESCE(return_calc.returned_total, 0) END), 0) AS total,
                   COALESCE(SUM(CASE WHEN s.status = 'CANCELLED' THEN 0 ELSE COALESCE(calc.profit, 0) - COALESCE(return_calc.returned_profit, 0) END), 0) AS profit,
                   COALESCE(SUM(CASE WHEN s.status = 'CANCELLED' THEN 1 ELSE 0 END), 0) AS cancelled_count
            FROM sales s
            ${context.baseJoins}
            ${context.sellerJoin}
            ${whereClause}
            GROUP BY ${context.sellerIdExpr}, ${context.sellerNameExpr}
            ORDER BY total DESC, sales_count DESC, user_name ASC
          `,
          params
        ))[0]
      : []

    return res.json({
      data: rows,
      pagination: {
        total: totalRecords,
        limit,
        offset,
      },
      summary: {
        records: Number(summaryRows?.[0]?.records || 0),
        grossTotal: Number(summaryRows?.[0]?.gross_total || 0),
        netTotal: Number(summaryRows?.[0]?.net_total || 0),
        totalProfit: canSeeProfit ? Number(summaryRows?.[0]?.total_profit || 0) : 0,
        cancelledCount: Number(summaryRows?.[0]?.cancelled_count || 0),
        byMethod: Object.fromEntries(
          (summaryByMethodRows || []).map(row => [
            row.payment_method || 'N/D',
            Number(row.net_total || 0),
          ])
        ),
      },
      byUser: (byUserRows || []).map(row => ({
        userId: row.user_id ? Number(row.user_id) : null,
        userName: row.user_name || 'SIN USUARIO',
        salesCount: Number(row.sales_count || 0),
        grossTotal: Number(row.gross_total || 0),
        total: Number(row.total || 0),
        profit: Number(row.profit || 0),
        cancelledCount: Number(row.cancelled_count || 0),
      })),
    })
  } catch (err) {
    console.error('Sales list error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

router.get('/my-report', authMiddleware, async (req, res) => {
  try {
    const limit = Math.max(1, Number(req.query.limit || 50))
    const offset = Math.max(0, Number(req.query.offset || 0))
    const pool = await getPool()
    await ensureSalesSchema(pool)
    const context = await buildSalesContext(pool)
    const { whereClause, params, orderByClause } = getSalesFilters(req, context, Number(req.user?.id || 0))
    const query = `
      ${buildSalesSelect(context, false)}
      ${whereClause}
      ${orderByClause}
      LIMIT ? OFFSET ?
    `
    const [rows] = await pool.query(query, [...params, limit, offset])
    const [countRows] = await pool.query(
      `
        SELECT COUNT(*) AS total
        FROM sales s
        ${context.baseJoins}
        ${context.sellerJoin}
        ${whereClause}
      `,
      params
    )
    const [summaryRows] = await pool.query(
      `
        SELECT COUNT(*) AS records,
               COALESCE(SUM(CASE WHEN s.status = 'CANCELLED' THEN 0 ELSE s.total - COALESCE(return_calc.returned_total, 0) END), 0) AS net_total,
               COALESCE(SUM(CASE WHEN s.status = 'CANCELLED' THEN 1 ELSE 0 END), 0) AS cancelled_count
        FROM sales s
        ${context.baseJoins}
        ${context.sellerJoin}
        ${whereClause}
      `,
      params
    )

    return res.json({
      data: rows,
      pagination: {
        total: Number(countRows?.[0]?.total || 0),
        limit,
        offset,
      },
      summary: {
        records: Number(summaryRows?.[0]?.records || 0),
        netTotal: Number(summaryRows?.[0]?.net_total || 0),
        cancelledCount: Number(summaryRows?.[0]?.cancelled_count || 0),
      },
    })
  } catch (err) {
    console.error('My sales report error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// Crear nueva venta
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { customerId, items, total, isCredit, docNo, paymentMethod, receivedAmount, changeAmount, referenceNumber } = req.body
    const canChangePosPrice = hasExplicitUserPermission(req.user, 'pos:change_price')
    const canUseManualPosPrice = hasExplicitUserPermission(req.user, 'pos:manual_price')

    if (!canUserSell(req.user)) {
      return res.status(403).json({ error: 'Tu usuario no tiene habilitadas las ventas en POS' })
    }
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No hay items en la venta' })
    }

    const pool = await getPool()
    const conn = await pool.getConnection()
    const saleWarehouseId = getUserWarehouseId(req.user)

    if (!saleWarehouseId) {
      conn.release()
      return res.status(400).json({ error: 'El usuario no tiene una tienda asignada para vender' })
    }

    try {
      await conn.beginTransaction()
      await ensureSalesSchema(conn)
      const hasSalesUserId = await columnExists(conn, 'sales', 'user_id')

      const [shiftRows] = await conn.query(
        'SELECT id, opened_at, opening_balance FROM cashbox_shifts WHERE opened_by = ? AND closed_at IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE',
        [req.user.id]
      )
      const shift = shiftRows?.[0]
      if (!shift) {
        await conn.rollback()
        return res.status(400).json({ error: 'Caja cerrada. Debes abrir caja para realizar ventas.' })
      }

      const finalPaymentMethod = paymentMethod || (isCredit ? 'CREDIT' : 'CASH')
      const normalizedCustomerId = Number(customerId || 0)

      if (isCredit) {
        if (!normalizedCustomerId) {
          await conn.rollback()
          return res.status(400).json({ error: 'Para vender a crédito debes seleccionar un cliente real' })
        }

        const [customerRows] = await conn.query(
          'SELECT id, name FROM customers WHERE id = ? LIMIT 1',
          [normalizedCustomerId]
        )
        if (!customerRows?.length) {
          await conn.rollback()
          return res.status(400).json({ error: 'El cliente seleccionado para el crédito no existe o ya no está disponible' })
        }
      }

      // 1. Crear Venta
      const saleInsertSql = hasSalesUserId
        ? 'INSERT INTO sales (customer_id, user_id, warehouse_id, doc_no, total, is_credit, payment_method, received_amount, change_amount, reference_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        : 'INSERT INTO sales (customer_id, warehouse_id, doc_no, total, is_credit, payment_method, received_amount, change_amount, reference_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      const saleInsertParams = hasSalesUserId
        ? [normalizedCustomerId || null, req.user.id, saleWarehouseId, docNo || null, total, isCredit ? 1 : 0, finalPaymentMethod, receivedAmount || 0, changeAmount || 0, referenceNumber || null]
        : [normalizedCustomerId || null, saleWarehouseId, docNo || null, total, isCredit ? 1 : 0, finalPaymentMethod, receivedAmount || 0, changeAmount || 0, referenceNumber || null]
      const [saleResult] = await conn.query(saleInsertSql, saleInsertParams)
      const saleId = saleResult.insertId

      // 1.1 Si es crédito, crear cuota inicial (installment)
      if (isCredit) {
        // Por defecto 30 días para pagar, o configurable
        const dueDate = new Date()
        dueDate.setDate(dueDate.getDate() + 30)
        
        await conn.query(
          'INSERT INTO installments (sale_id, due_date, amount, paid) VALUES (?, ?, ?, 0)',
          [saleId, dueDate, total]
        )
      }

      // 2. Procesar items
      for (const item of items) {
        // item: { productId, quantity, price, imei, serial }
        const [productRows] = await conn.query(
          'SELECT price, price2, price3, product_type, avg_cost, cost FROM products WHERE id = ? LIMIT 1',
          [item.productId]
        )
        const productPriceRow = productRows?.[0]
        if (!productPriceRow) {
          throw new Error(`Producto no encontrado: ${item.productId}`)
        }
        const productType = String(productPriceRow.product_type || 'GENERAL').toUpperCase()

        const requestedPrice = Number(item.price)
        const originalUnitPrice = Number(productPriceRow.price || 0)
        const requestedPriceSource = String(item.priceSource || '').trim().toUpperCase()
        const allowedPrices = [
          originalUnitPrice,
          Number(productPriceRow.price2 || 0),
          Number(productPriceRow.price3 || 0),
        ].filter(price => Number.isFinite(price) && price > 0)

        if (requestedPrice <= 0 || !Number.isFinite(requestedPrice)) {
          await conn.rollback()
          return res.status(400).json({ error: 'El precio del item no es valido' })
        }

        let priceSource = 'BASE'

        if (canUseManualPosPrice && requestedPriceSource === 'MANUAL') {
          priceSource = 'MANUAL'
        } else if (!canChangePosPrice) {
          if (Math.abs(requestedPrice - originalUnitPrice) > 0.0001) {
            await conn.rollback()
            return res.status(403).json({ error: 'Tu usuario no tiene permiso para cambiar precios en POS' })
          }
        } else if (!allowedPrices.some(price => Math.abs(price - requestedPrice) <= 0.0001)) {
          if (canUseManualPosPrice) {
            priceSource = 'MANUAL'
          } else {
            await conn.rollback()
            return res.status(400).json({ error: 'El precio seleccionado no es valido para este producto' })
          }
        } else if (Math.abs(requestedPrice - Number(productPriceRow.price2 || 0)) <= 0.0001) {
          priceSource = 'PRICE2'
        } else if (Math.abs(requestedPrice - Number(productPriceRow.price3 || 0)) <= 0.0001) {
          priceSource = 'PRICE3'
        }

        if (requestedPriceSource === 'MANUAL' && !canUseManualPosPrice) {
          await conn.rollback()
          return res.status(403).json({ error: 'Tu usuario no tiene permiso para ingresar precio manual en POS' })
        }

        if (productType === 'SERIAL') {
          if (!item.serial) {
            await conn.rollback()
            return res.status(400).json({ error: `Debes seleccionar la serie exacta para vender el producto ${item.productId}` })
          }
          if (Number(item.quantity) !== 1) {
            await conn.rollback()
            return res.status(400).json({ error: `Los productos con serie solo pueden venderse una unidad por item (${item.productId})` })
          }
        }

        if (productType === 'IMEI') {
          if (!item.imei) {
            await conn.rollback()
            return res.status(400).json({ error: `Debes seleccionar el IMEI exacto para vender el producto ${item.productId}` })
          }
          if (Number(item.quantity) !== 1) {
            await conn.rollback()
            return res.status(400).json({ error: `Los productos con IMEI solo pueden venderse una unidad por item (${item.productId})` })
          }
        }

        const itemTotal = Number(item.price) * Number(item.quantity)
        const unitCostSnapshot = Math.round(Number(productPriceRow.avg_cost ?? productPriceRow.cost ?? 0) * 100) / 100
        const totalCostSnapshot = Math.round(unitCostSnapshot * Number(item.quantity || 0) * 100) / 100
        
        // Insertar sale_item
        await conn.query(
          'INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, total, serial, imei, original_unit_price, price_source, unit_cost_snapshot, total_cost_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [saleId, item.productId, item.quantity, item.price, itemTotal, item.serial || null, item.imei || null, originalUnitPrice, priceSource, unitCostSnapshot, totalCostSnapshot]
        )

        if (item.serial) {
             const [serialResult] = await conn.query(
               'UPDATE product_serials SET status = "SOLD" WHERE product_id = ? AND serial_no = ? AND warehouse_id = ? AND status = "AVAILABLE"',
               [item.productId, item.serial, saleWarehouseId]
             )
             if (!serialResult.affectedRows) {
               throw new Error(`La serie ${item.serial} no está disponible para la venta en la tienda seleccionada`)
             }
        } else if (item.imei) {
             const [imeiResult] = await conn.query(
               'UPDATE product_imeis SET status = "SOLD" WHERE product_id = ? AND imei = ? AND warehouse_id = ? AND status = "AVAILABLE"',
               [item.productId, item.imei, saleWarehouseId]
             )
             if (!imeiResult.affectedRows) {
               throw new Error(`El IMEI ${item.imei} no está disponible para la venta en la tienda seleccionada`)
             }
        } else if (item.batchNo) {
            // Producto medicinal con lote
             const [batchResult] = await conn.query(
               'UPDATE product_batches SET quantity = quantity - ? WHERE product_id = ? AND batch_no = ? AND warehouse_id = ? AND quantity >= ?',
               [item.quantity, item.productId, item.batchNo, saleWarehouseId, item.quantity]
             )
             if (!batchResult.affectedRows) {
               throw new Error(`El lote ${item.batchNo} no está disponible para la venta en la tienda seleccionada`)
             }
        }

        // Registrar movimiento de inventario (SALE)
        // Esto actualiza product_warehouse_stock y crea entrada en inventory_movements
        await registerMovement({
            productId: item.productId,
            warehouseId: saleWarehouseId, // Tienda
            type: 'SALE',
            quantity: item.quantity,
            referenceId: saleId,
            userId: req.user?.id,
            notes: `Venta #${saleResult.insertId}`
        }, conn)
      }

      if (finalPaymentMethod === 'CASH') {
        await conn.query(
          'INSERT INTO cash_movements (shift_id, type, concept, amount, ref_type, ref_id) VALUES (?, "IN", ?, ?, "SALE", ?)',
          [shift.id, `Venta #${saleId}`, total, saleId]
        )
      }

      await conn.commit()
      res.json({ success: true, saleId })

    } catch (err) {
      await conn.rollback()
      console.error('Error creando venta:', err)
      res.status(500).json({ error: 'Error al procesar la venta' })
    } finally {
      conn.release()
    }

  } catch (err) {
    console.error('Sales POST error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// Ventas del día: suma de total por fecha
router.get('/daily', authMiddleware, async (req, res) => {
  try {
    const date = (req.query.date || '').toString().trim()
    const pool = await getPool()
    await ensureSalesSchema(pool)
    const isAdmin = isAdminUser(req.user)
    const warehouseId = getUserWarehouseId(req.user)
    if (!isAdmin && !warehouseId) {
      return res.json({ total: 0 })
    }
    let rows
    if (date) {
      if (isAdmin) {
        ;[rows] = await pool.query(
          "SELECT COALESCE(SUM(total), 0) AS total FROM sales WHERE DATE(created_at) = ? AND COALESCE(status, 'COMPLETED') != 'CANCELLED'",
          [date]
        )
      } else {
        ;[rows] = await pool.query(
          "SELECT COALESCE(SUM(total), 0) AS total FROM sales WHERE DATE(created_at) = ? AND warehouse_id = ? AND COALESCE(status, 'COMPLETED') != 'CANCELLED'",
          [date, warehouseId]
        )
      }
    } else {
      if (isAdmin) {
        ;[rows] = await pool.query(
          "SELECT COALESCE(SUM(total), 0) AS total FROM sales WHERE DATE(created_at) = CURDATE() AND COALESCE(status, 'COMPLETED') != 'CANCELLED'"
        )
      } else {
        ;[rows] = await pool.query(
          "SELECT COALESCE(SUM(total), 0) AS total FROM sales WHERE DATE(created_at) = CURDATE() AND warehouse_id = ? AND COALESCE(status, 'COMPLETED') != 'CANCELLED'",
          [warehouseId]
        )
      }
    }
    const total = Number(rows?.[0]?.total || 0)
    return res.json({ total })
  } catch (err) {
    console.error('Sales daily GET error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// Créditos por vencer: cuotas no pagadas con due_date dentro de un rango
router.get('/credits/upcoming', authMiddleware, async (req, res) => {
  try {
    const days = Math.max(0, Number(req.query.days || 7))
    const pool = await getPool()
    await ensureSalesSchema(pool)
    const isAdmin = isAdminUser(req.user)
    const warehouseId = getUserWarehouseId(req.user)
    if (!isAdmin && !warehouseId) {
      return res.json({ count: 0, days })
    }
    const [rows] = isAdmin
      ? await pool.query(
          'SELECT COUNT(*) AS c FROM installments WHERE paid = 0 AND due_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)',
          [days]
        )
      : await pool.query(
          `SELECT COUNT(*) AS c
           FROM installments i
           JOIN sales s ON s.id = i.sale_id
           WHERE i.paid = 0 AND i.due_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
             AND s.warehouse_id = ?`,
          [days, warehouseId]
        )
    const count = Number(rows?.[0]?.c || 0)
    return res.json({ count, days })
  } catch (err) {
    console.error('Sales upcoming credits GET error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// Resumen de ventas por rango de fechas (inclusive)
router.get('/summary', authMiddleware, async (req, res) => {
  try {
    const start = (req.query.start || '').toString().slice(0, 10)
    const end = (req.query.end || '').toString().slice(0, 10)
    const pool = await getPool()
    await ensureSalesSchema(pool)
    const isAdmin = isAdminUser(req.user)
    const warehouseId = getUserWarehouseId(req.user)
    if (!isAdmin && !warehouseId) {
      return res.json({ total: 0, start: start || null, end: end || null })
    }
    let rows
    if (start && end) {
      if (isAdmin) {
        ;[rows] = await pool.query(
          "SELECT COALESCE(SUM(total), 0) AS total FROM sales WHERE DATE(created_at) BETWEEN ? AND ? AND COALESCE(status, 'COMPLETED') != 'CANCELLED'",
          [start, end]
        )
      } else {
        ;[rows] = await pool.query(
          "SELECT COALESCE(SUM(total), 0) AS total FROM sales WHERE DATE(created_at) BETWEEN ? AND ? AND warehouse_id = ? AND COALESCE(status, 'COMPLETED') != 'CANCELLED'",
          [start, end, warehouseId]
        )
      }
    } else {
      if (isAdmin) {
        ;[rows] = await pool.query(
          "SELECT COALESCE(SUM(total), 0) AS total FROM sales WHERE DATE(created_at) = CURDATE() AND COALESCE(status, 'COMPLETED') != 'CANCELLED'"
        )
      } else {
        ;[rows] = await pool.query(
          "SELECT COALESCE(SUM(total), 0) AS total FROM sales WHERE DATE(created_at) = CURDATE() AND warehouse_id = ? AND COALESCE(status, 'COMPLETED') != 'CANCELLED'",
          [warehouseId]
        )
      }
    }
    const total = Number(rows?.[0]?.total || 0)
    return res.json({ total, start: start || null, end: end || null })
  } catch (err) {
    console.error('Sales summary GET error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})
// Listado detallado de cuotas próximas a vencer
router.get('/credits/upcoming/list', authMiddleware, async (req, res) => {
  try {
    const days = Math.max(0, Number(req.query.days || 7))
    const limit = Math.max(1, Number(req.query.limit || 10))
    const pool = await getPool()
    await ensureSalesSchema(pool)
    const isAdmin = isAdminUser(req.user)
    const warehouseId = getUserWarehouseId(req.user)
    if (!isAdmin && !warehouseId) {
      return res.json({ days, limit, items: [] })
    }
    const [rows] = isAdmin
      ? await pool.query(
          `SELECT i.id AS installment_id, i.sale_id, i.due_date, i.amount,
                  s.doc_no, s.total AS sale_total,
                  c.name AS customer_name
             FROM installments i
             JOIN sales s ON s.id = i.sale_id
        LEFT JOIN customers c ON c.id = s.customer_id
            WHERE i.paid = 0
              AND i.due_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
            ORDER BY i.due_date ASC, i.id ASC
            LIMIT ?`,
          [days, limit]
        )
      : await pool.query(
          `SELECT i.id AS installment_id, i.sale_id, i.due_date, i.amount,
                  s.doc_no, s.total AS sale_total,
                  c.name AS customer_name
             FROM installments i
             JOIN sales s ON s.id = i.sale_id
        LEFT JOIN customers c ON c.id = s.customer_id
            WHERE i.paid = 0
              AND i.due_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)
              AND s.warehouse_id = ?
            ORDER BY i.due_date ASC, i.id ASC
            LIMIT ?`,
          [days, warehouseId, limit]
        )
    const items = (rows || []).map(r => ({
      id: r.installment_id,
      saleId: r.sale_id,
      dueDate: r.due_date ? String(r.due_date).slice(0, 10) : '',
      amount: Number(r.amount || 0),
      docNo: r.doc_no || '',
      saleTotal: Number(r.sale_total || 0),
      customerName: r.customer_name || 'Sin cliente',
    }))
    return res.json({ days, limit, items })
  } catch (err) {
    console.error('Sales upcoming credits list GET error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// Obtener detalle de una venta
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const saleId = req.params.id
    const pool = await getPool()
    await ensureSalesSchema(pool)
    const context = await buildSalesContext(pool)
    const canSeeProfit = req.user?.role === 'ADMIN'
    const ownerFilter = canSeeProfit
      ? ''
      : (getUserWarehouseId(req.user) ? ' AND s.warehouse_id = ?' : ' AND 1 = 0')
    const saleParams = canSeeProfit ? [saleId] : [saleId, Number(getUserWarehouseId(req.user) || 0)]
    
    // Venta header
    const [saleRows] = await pool.query(
      `
        SELECT s.*, c.name AS customer_name, c.document AS customer_document, c.address AS customer_address, c.phone AS customer_phone,
               i.credit_fully_paid,
               i.credit_fully_paid_at,
               COALESCE(return_calc.return_count, 0) AS return_count,
               COALESCE(return_calc.returned_total, 0) AS returned_total,
               CASE WHEN s.status = 'CANCELLED' THEN 0 ELSE COALESCE(s.total, 0) - COALESCE(return_calc.returned_total, 0) END AS final_total,
               ${canSeeProfit ? 'COALESCE(calc.cost_total, 0)' : 'NULL'} AS cost_total,
               ${canSeeProfit ? "CASE WHEN s.status = 'CANCELLED' THEN 0 ELSE COALESCE(calc.profit, 0) END" : 'NULL'} AS profit,
               ${canSeeProfit ? "CASE WHEN s.status = 'CANCELLED' THEN 0 ELSE COALESCE(calc.profit, 0) - COALESCE(return_calc.returned_profit, 0) END" : 'NULL'} AS final_profit,
               ${context.sellerIdExpr} AS seller_id,
               ${context.sellerNameExpr} AS seller_name
        FROM sales s
        ${context.baseJoins}
        ${context.sellerJoin}
        WHERE s.id = ?${ownerFilter}
      `,
      saleParams
    )
    
    if (saleRows.length === 0) {
      return res.status(404).json({ error: 'Venta no encontrada' })
    }
    const sale = saleRows[0]

    // Items
    const [items] = await pool.query(`
      SELECT si.*, p.name as product_name, p.sku,
             COALESCE(ret.returned_quantity, 0) AS returned_quantity,
             GREATEST(si.quantity - COALESCE(ret.returned_quantity, 0), 0) AS available_return_quantity
      FROM sale_items si
      JOIN products p ON si.product_id = p.id
      LEFT JOIN (
        SELECT sri.sale_item_id, COALESCE(SUM(sri.quantity), 0) AS returned_quantity
        FROM sale_return_items sri
        JOIN sale_returns sr ON sr.id = sri.sale_return_id
        WHERE sr.sale_id = ?
        GROUP BY sri.sale_item_id
      ) ret ON ret.sale_item_id = si.id
      WHERE si.sale_id = ?
    `, [saleId, saleId])

    const [returnRows] = await pool.query(`
      SELECT sr.id,
             sr.sale_id,
             sr.reason,
             sr.refund_method,
             sr.refund_total,
             sr.affects_cash,
             sr.created_at,
             u.name AS user_name,
             sri.id AS return_item_id,
             sri.sale_item_id,
             sri.product_id,
             sri.quantity,
             sri.unit_price,
             sri.total,
             sri.serial,
             sri.imei,
             p.name AS product_name
      FROM sale_returns sr
      LEFT JOIN users u ON u.id = sr.user_id
      LEFT JOIN sale_return_items sri ON sri.sale_return_id = sr.id
      LEFT JOIN products p ON p.id = sri.product_id
      WHERE sr.sale_id = ?
      ORDER BY sr.created_at DESC, sri.id ASC
    `, [saleId])

    const returnsMap = new Map()
    for (const row of returnRows || []) {
      if (!returnsMap.has(row.id)) {
        returnsMap.set(row.id, {
          id: row.id,
          sale_id: row.sale_id,
          reason: row.reason,
          refund_method: row.refund_method,
          refund_total: Number(row.refund_total || 0),
          affects_cash: Boolean(row.affects_cash),
          created_at: row.created_at,
          user_name: row.user_name || 'SIN USUARIO',
          items: [],
        })
      }
      if (row.return_item_id) {
        returnsMap.get(row.id).items.push({
          id: row.return_item_id,
          sale_item_id: row.sale_item_id,
          product_id: row.product_id,
          product_name: row.product_name || 'Producto',
          quantity: Number(row.quantity || 0),
          unit_price: Number(row.unit_price || 0),
          total: Number(row.total || 0),
          serial: row.serial || null,
          imei: row.imei || null,
        })
      }
    }

    res.json({ ...sale, items, returns: Array.from(returnsMap.values()) })
  } catch (err) {
    console.error('Sale detail error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

router.post('/:id/returns', authMiddleware, async (req, res) => {
  try {
    const saleId = Number(req.params.id || 0)
    const reason = String(req.body?.reason || '').trim()
    const refundMethod = normalizeRefundMethod(req.body?.refundMethod)
    const requestedItems = Array.isArray(req.body?.items) ? req.body.items : []

    if (!saleId) {
      return res.status(400).json({ error: 'Venta inválida' })
    }
    if (!reason) {
      return res.status(400).json({ error: 'Debes indicar el motivo de la devolución' })
    }
    if (requestedItems.length === 0) {
      return res.status(400).json({ error: 'Debes seleccionar al menos un producto para devolver' })
    }

    const canReturnSales = isAdminUser(req.user) || (Array.isArray(req.user?.permissions) && req.user.permissions.includes('sales:cancel'))
    if (!canReturnSales) {
      return res.status(403).json({ error: 'No tienes permiso para registrar devoluciones de ventas' })
    }

    const pool = await getPool()
    const conn = await pool.getConnection()

    try {
      await conn.beginTransaction()
      await ensureSalesSchema(conn)

      const isAdmin = isAdminUser(req.user)
      const userWarehouseId = getUserWarehouseId(req.user)
      if (!isAdmin && !userWarehouseId) {
        await conn.rollback()
        return res.status(403).json({ error: 'No tienes una tienda asignada para registrar devoluciones' })
      }

      const saleWhere = !isAdmin ? ' AND warehouse_id = ?' : ''
      const saleParams = !isAdmin ? [saleId, userWarehouseId] : [saleId]
      const [saleRows] = await conn.query(`SELECT * FROM sales WHERE id = ?${saleWhere} FOR UPDATE`, saleParams)
      if (saleRows.length === 0) {
        await conn.rollback()
        return res.status(404).json({ error: 'Venta no encontrada' })
      }

      const sale = saleRows[0]
      if (sale.status === 'CANCELLED') {
        await conn.rollback()
        return res.status(400).json({ error: 'No se puede devolver una venta cancelada' })
      }

      const isCredit = sale.payment_method === 'CREDIT' || Number(sale.is_credit || 0) === 1
      if (isCredit && refundMethod !== 'CREDIT') {
        await conn.rollback()
        return res.status(400).json({ error: 'Las devoluciones de ventas a crédito solo pueden aplicarse reduciendo el saldo del crédito' })
      }
      if (!isCredit && refundMethod === 'CREDIT') {
        await conn.rollback()
        return res.status(400).json({ error: 'El ajuste a crédito solo aplica para ventas a crédito' })
      }

      const [saleItems] = await conn.query(
        `
          SELECT si.*,
                 COALESCE(ret.returned_quantity, 0) AS returned_quantity
          FROM sale_items si
          LEFT JOIN (
            SELECT sri.sale_item_id, COALESCE(SUM(sri.quantity), 0) AS returned_quantity
            FROM sale_return_items sri
            JOIN sale_returns sr ON sr.id = sri.sale_return_id
            WHERE sr.sale_id = ?
            GROUP BY sri.sale_item_id
          ) ret ON ret.sale_item_id = si.id
          WHERE si.sale_id = ?
          FOR UPDATE
        `,
        [saleId, saleId]
      )

      const saleItemMap = new Map()
      for (const item of saleItems || []) {
        saleItemMap.set(Number(item.id), item)
      }

      const normalizedItems = []
      let refundTotal = 0

      for (const entry of requestedItems) {
        const saleItemId = Number(entry?.saleItemId || 0)
        const quantity = Number(entry?.quantity || 0)
        if (!saleItemId || !Number.isFinite(quantity) || quantity <= 0) {
          throw new Error('Hay productos con cantidades inválidas en la devolución')
        }

        const saleItem = saleItemMap.get(saleItemId)
        if (!saleItem) {
          throw new Error('Uno de los productos ya no pertenece a esta venta')
        }

        const soldQuantity = Number(saleItem.quantity || 0)
        const returnedQuantity = Number(saleItem.returned_quantity || 0)
        const availableReturnQuantity = roundCurrency(soldQuantity - returnedQuantity)
        if (quantity - availableReturnQuantity > 0.0001) {
          throw new Error(`La cantidad a devolver excede lo disponible en ${saleItemId}`)
        }

        if ((saleItem.serial || saleItem.imei) && Math.abs(quantity - 1) > 0.0001) {
          throw new Error('Los productos con serie o IMEI solo pueden devolverse en cantidad 1')
        }

        const unitPrice = Number(saleItem.unit_price || 0)
        const unitCost = Number(
          saleItem.unit_cost_snapshot != null
            ? saleItem.unit_cost_snapshot
            : (soldQuantity > 0 ? Number(saleItem.total_cost_snapshot || 0) / soldQuantity : 0)
        )
        const lineRefund = roundCurrency(unitPrice * quantity)
        const lineCost = roundCurrency(unitCost * quantity)

        normalizedItems.push({
          saleItem,
          quantity,
          unitPrice,
          unitCost,
          lineRefund,
          lineCost,
        })
        refundTotal = roundCurrency(refundTotal + lineRefund)
      }

      if (refundTotal <= 0) {
        throw new Error('El total de la devolución no es válido')
      }

      let activeShift = null
      const affectsCash = refundMethod === 'CASH'
      if (affectsCash) {
        const [shiftRows] = await conn.query(
          'SELECT id FROM cashbox_shifts WHERE opened_by = ? AND closed_at IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE',
          [req.user.id]
        )
        activeShift = shiftRows?.[0] || null
        if (!activeShift) {
          throw new Error('Caja cerrada. Debes abrir caja para registrar devoluciones en efectivo.')
        }
      }

      if (refundMethod === 'CREDIT') {
        const [installments] = await conn.query(
          `
            SELECT i.id, i.amount, i.paid, i.paid_at, i.due_date,
                   COALESCE(SUM(cp.amount), 0) AS paid_so_far
            FROM installments i
            LEFT JOIN credit_payments cp ON cp.installment_id = i.id
            WHERE i.sale_id = ?
            GROUP BY i.id, i.amount, i.paid, i.paid_at, i.due_date
            ORDER BY i.due_date ASC, i.id ASC
            FOR UPDATE
          `,
          [saleId]
        )

        let outstandingTotal = 0
        for (const installment of installments || []) {
          outstandingTotal += Math.max(0, Number(installment.amount || 0) - Number(installment.paid_so_far || 0))
        }
        outstandingTotal = roundCurrency(outstandingTotal)

        if (refundTotal - outstandingTotal > 0.009) {
          throw new Error(`La devolución excede el saldo pendiente del crédito (${outstandingTotal.toFixed(2)})`)
        }

        let remainingAdjustment = refundTotal
        for (const installment of installments || []) {
          if (remainingAdjustment <= 0.009) break
          const currentAmount = Number(installment.amount || 0)
          const paidSoFar = Number(installment.paid_so_far || 0)
          const outstanding = Math.max(0, currentAmount - paidSoFar)
          if (outstanding <= 0.009) continue

          const applied = Math.min(outstanding, remainingAdjustment)
          const nextAmount = roundCurrency(currentAmount - applied)
          const shouldMarkPaid = nextAmount - paidSoFar <= 0.009

          await conn.query(
            'UPDATE installments SET amount = ?, paid = ?, paid_at = ? WHERE id = ?',
            [
              nextAmount,
              shouldMarkPaid ? 1 : 0,
              shouldMarkPaid ? (installment.paid_at || new Date()) : null,
              installment.id,
            ]
          )

          remainingAdjustment = roundCurrency(remainingAdjustment - applied)
        }
      }

      const [returnInsert] = await conn.query(
        `
          INSERT INTO sale_returns (sale_id, user_id, warehouse_id, reason, refund_method, refund_total, affects_cash)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [saleId, req.user?.id || null, Number(sale.warehouse_id || userWarehouseId || 0), reason, refundMethod, refundTotal, affectsCash ? 1 : 0]
      )
      const saleReturnId = Number(returnInsert.insertId)

      for (const item of normalizedItems) {
        await conn.query(
          `
            INSERT INTO sale_return_items
            (sale_return_id, sale_item_id, product_id, quantity, unit_price, total, unit_cost_snapshot, total_cost_snapshot, serial, imei)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            saleReturnId,
            item.saleItem.id,
            item.saleItem.product_id,
            item.quantity,
            item.unitPrice,
            item.lineRefund,
            item.unitCost,
            item.lineCost,
            item.saleItem.serial || null,
            item.saleItem.imei || null,
          ]
        )

        if (item.saleItem.serial) {
          const [serialRestore] = await conn.query(
            'UPDATE product_serials SET status = "AVAILABLE", warehouse_id = ? WHERE product_id = ? AND serial_no = ? AND status = "SOLD"',
            [Number(sale.warehouse_id || userWarehouseId || 0), item.saleItem.product_id, item.saleItem.serial]
          )
          if (!serialRestore.affectedRows) {
            throw new Error(`No se pudo reactivar la serie ${item.saleItem.serial}`)
          }
        } else if (item.saleItem.imei) {
          const [imeiRestore] = await conn.query(
            'UPDATE product_imeis SET status = "AVAILABLE", warehouse_id = ? WHERE product_id = ? AND imei = ? AND status = "SOLD"',
            [Number(sale.warehouse_id || userWarehouseId || 0), item.saleItem.product_id, item.saleItem.imei]
          )
          if (!imeiRestore.affectedRows) {
            throw new Error(`No se pudo reactivar el IMEI ${item.saleItem.imei}`)
          }
        }

        await registerMovement({
          productId: item.saleItem.product_id,
          warehouseId: Number(sale.warehouse_id || userWarehouseId || 0),
          type: 'ADJUSTMENT',
          quantity: item.quantity,
          referenceId: saleReturnId,
          userId: req.user?.id,
          notes: `Devolución parcial venta #${saleId} / devolución #${saleReturnId}`,
        }, conn)
      }

      if (affectsCash) {
        await conn.query(
          'INSERT INTO cash_movements (shift_id, type, concept, amount, ref_type, ref_id) VALUES (?, "OUT", ?, ?, "SALE_RETURN", ?)',
          [activeShift.id, `Devolución parcial venta #${saleId}`, refundTotal, saleReturnId]
        )
      }

      await conn.commit()
      res.json({ success: true, saleReturnId, refundTotal })
    } catch (error) {
      await conn.rollback()
      console.error('Sale partial return error:', error)
      res.status(400).json({ error: error.message || 'No se pudo registrar la devolución parcial' })
    } finally {
      conn.release()
    }
  } catch (err) {
    console.error('Sale partial return route error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

// Cancelar venta
router.post('/:id/cancel', authMiddleware, async (req, res) => {
  try {
    const saleId = req.params.id
    const { reason } = req.body
    
    if (!reason) {
      return res.status(400).json({ error: 'Se requiere un motivo para la cancelación' })
    }

    const pool = await getPool()
    const conn = await pool.getConnection()

    try {
      await conn.beginTransaction()

      const isAdmin = isAdminUser(req.user)
      const userWarehouseId = getUserWarehouseId(req.user)
      if (!isAdmin && !userWarehouseId) {
        await conn.rollback()
        return res.status(403).json({ error: 'No tienes una tienda asignada para cancelar ventas' })
      }

      const saleWhere = !isAdmin ? ' AND warehouse_id = ?' : ''
      const saleParams = !isAdmin ? [saleId, userWarehouseId] : [saleId]
      const [saleRows] = await conn.query(`SELECT * FROM sales WHERE id = ?${saleWhere} FOR UPDATE`, saleParams)
      if (saleRows.length === 0) {
        await conn.rollback()
        return res.status(404).json({ error: 'Venta no encontrada' })
      }

      const sale = saleRows[0]
      if (sale.status === 'CANCELLED') {
        await conn.rollback()
        return res.status(400).json({ error: 'La venta ya está cancelada' })
      }

      // 2. Actualizar estado de venta
      await conn.query(
        'UPDATE sales SET status = ?, cancellation_reason = ? WHERE id = ?',
        ['CANCELLED', reason, saleId]
      )

      // 3. Restaurar stock
      const [items] = await conn.query('SELECT * FROM sale_items WHERE sale_id = ?', [saleId])
      for (const item of items) {
        if (item.serial) {
          const [serialRestore] = await conn.query(
            'UPDATE product_serials SET status = "AVAILABLE", warehouse_id = ? WHERE product_id = ? AND serial_no = ? AND status = "SOLD"',
            [Number(sale.warehouse_id || getUserWarehouseId(req.user) || 0), item.product_id, item.serial]
          )
          if (!serialRestore.affectedRows) {
            throw new Error(`No se pudo reactivar la serie ${item.serial} al cancelar la venta`)
          }
        } else if (item.imei) {
          const [imeiRestore] = await conn.query(
            'UPDATE product_imeis SET status = "AVAILABLE", warehouse_id = ? WHERE product_id = ? AND imei = ? AND status = "SOLD"',
            [Number(sale.warehouse_id || getUserWarehouseId(req.user) || 0), item.product_id, item.imei]
          )
          if (!imeiRestore.affectedRows) {
            throw new Error(`No se pudo reactivar el IMEI ${item.imei} al cancelar la venta`)
          }
        }

        // Restaurar stock usando servicio centralizado
        await registerMovement({
            productId: item.product_id,
            warehouseId: Number(sale.warehouse_id || getUserWarehouseId(req.user) || 0),
            type: 'ADJUSTMENT',
            quantity: item.quantity,
            referenceId: saleId,
            userId: req.user?.id,
            notes: `Cancelación Venta #${saleId} - ${reason}`
        }, conn)
      }

      // 4. Si es crédito, anular cuota pendiente
      if (sale.is_credit) {
        await conn.query(
          'UPDATE installments SET paid = 1, amount = 0 WHERE sale_id = ?',
          [saleId]
        )
      }

      await conn.commit()
      res.json({ success: true, message: 'Venta cancelada exitosamente' })

    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }

  } catch (err) {
    console.error('Sale cancel error:', err)
    res.status(500).json({ error: 'Server error' })
  }
})

export default router
