import express from 'express'
import bcrypt from 'bcryptjs'
import { getPool } from '../db.js'
import { authMiddleware, permissionMiddleware } from '../auth.js'

const router = express.Router()

router.use(authMiddleware)

// Ensure users table has warehouse_id
async function ensureUsersSchema(pool) {
  try {
    // Check if column exists
    const [cols] = await pool.query("SHOW COLUMNS FROM users LIKE 'warehouse_id'")
    if (cols.length === 0) {
      await pool.query("ALTER TABLE users ADD COLUMN warehouse_id INT DEFAULT 1")
      // Add FK if warehouses table exists (it should)
      // await pool.query("ALTER TABLE users ADD CONSTRAINT fk_user_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)")
    }

    const [sellCols] = await pool.query("SHOW COLUMNS FROM users LIKE 'can_sell'")
    if (sellCols.length === 0) {
      await pool.query("ALTER TABLE users ADD COLUMN can_sell TINYINT(1) NOT NULL DEFAULT 1")
    }
  } catch (err) {
    console.error('Error updating users schema:', err)
  }
}

// List users
router.get('/', permissionMiddleware('users:read'), async (req, res) => {
  try {
    const pool = await getPool()
    await ensureUsersSchema(pool)
    const [users] = await pool.query(`
      SELECT u.id, u.name, u.email, u.active, u.role_id, u.warehouse_id, u.can_sell, r.name as role_name, w.name as warehouse_name
      FROM users u 
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN warehouses w ON u.warehouse_id = w.id
    `)
    res.json(users)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Create user
router.post('/', permissionMiddleware('users:write'), async (req, res) => {
  const { name, email, password, role_id, warehouse_id, can_sell } = req.body
  if (!name || !email || !password || !role_id) return res.status(400).json({ error: 'Missing fields' })

  try {
    const pool = await getPool()
    await ensureUsersSchema(pool)
    const hash = await bcrypt.hash(password, 10)
    const wId = warehouse_id ? Number(warehouse_id) : null
    const canSell = can_sell === undefined ? 1 : (can_sell ? 1 : 0)
    const [resUser] = await pool.query(
      'INSERT INTO users (name, email, password, role_id, warehouse_id, can_sell, active) VALUES (?, ?, ?, ?, ?, ?, 1)',
      [name, email, hash, role_id, wId, canSell]
    )
    res.json({ id: resUser.insertId, name, email, role_id, warehouse_id: wId, can_sell: canSell })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Email already exists' })
    res.status(500).json({ error: err.message })
  }
})

// Update user
router.put('/:id', permissionMiddleware('users:write'), async (req, res) => {
  const { id } = req.params
  const { name, email, password, role_id, warehouse_id, active, can_sell } = req.body
  
  try {
    const pool = await getPool()
    await ensureUsersSchema(pool)
    const updates = []
    const values = []
    
    if (name) { updates.push('name = ?'); values.push(name) }
    if (email) { updates.push('email = ?'); values.push(email) }
    if (role_id) { updates.push('role_id = ?'); values.push(role_id) }
    if (warehouse_id !== undefined) { updates.push('warehouse_id = ?'); values.push(warehouse_id ? Number(warehouse_id) : null) }
    if (can_sell !== undefined) { updates.push('can_sell = ?'); values.push(can_sell ? 1 : 0) }
    if (active !== undefined) { updates.push('active = ?'); values.push(active ? 1 : 0) }
    if (password) {
      const hash = await bcrypt.hash(password, 10)
      updates.push('password = ?'); values.push(hash)
    }
    
    if (updates.length === 0) return res.json({ success: true })
    
    values.push(id)
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values)
    
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Delete user
router.delete('/:id', permissionMiddleware('users:write'), async (req, res) => {
  const { id } = req.params
  try {
    const pool = await getPool()
    await pool.query('DELETE FROM users WHERE id = ?', [id])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
