import express from 'express'
import bcrypt from 'bcryptjs'
import { signToken } from '../auth.js'
import { getPool } from '../db.js'

const router = express.Router()

router.post('/login', async (req, res) => {
  const { email, password } = req.body
  try {
    const pool = await getPool()
    if (pool) {
      const [canSellCols] = await pool.query("SHOW COLUMNS FROM users LIKE 'can_sell'")
      const hasCanSellColumn = Array.isArray(canSellCols) && canSellCols.length > 0

      // Fetch user and role name
      const [rows] = await pool.query(
        `SELECT u.id, u.name, u.email, u.password, u.role_id, u.warehouse_id,
                ${hasCanSellColumn ? 'u.can_sell' : '1 AS can_sell'},
                r.code as role_code, r.name as role_name, w.name as warehouse_name 
         FROM users u 
         LEFT JOIN roles r ON u.role_id = r.id 
         LEFT JOIN warehouses w ON u.warehouse_id = w.id
         WHERE u.email = ? AND u.active = 1 LIMIT 1`,
        [email]
      )

      // Fallback for JSON seed if DB has no users (legacy support, maybe remove later)
      if (!rows || rows.length === 0) {
        // Try legacy check if no user found in DB (only if we want to support non-migrated envs, but we migrated)
        // Let's stick to DB logic primarily.
        return res.status(401).json({ error: 'Invalid credentials' })
      }

      const user = rows[0]
      const ok = await bcrypt.compare(password, user.password)
      if (!ok) return res.status(401).json({ error: 'Invalid credentials' })

      // Fetch permissions
      const [perms] = await pool.query(
        `SELECT p.code 
         FROM permissions p 
         JOIN role_permissions rp ON p.id = rp.permission_id 
         WHERE rp.role_id = ?`,
        [user.role_id]
      )
      const permissions = perms.map(p => p.code)

      // Prepare user object for token and response
      // Map role_code to role for frontend compatibility
      const userData = {
        id: user.id,
        name: user.name,
        role: user.role_code || user.role_name || 'USER', // Fallback
        permissions,
        canSell: Boolean(Number(user.can_sell ?? 1)),
        warehouseId: user.warehouse_id ?? null,
        warehouseName: user.warehouse_name ?? null
      }

      const token = signToken(userData)
      return res.json({ token, user: userData })
    }

    // Fallback if no DB pool (should not happen in production)
    return res.status(500).json({ error: 'Database not available' })
  } catch (err) {
    console.error('Login error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

export default router
