import express from 'express'
import { getPool } from '../db.js'
import { authMiddleware, permissionMiddleware } from '../auth.js'
import { ensureRootAccessSchema, isRootPermissionCode, isSpecialRoleCode, ROOT_PERMISSION_CODES, ROOT_ROLE_CODE, SUPERUSER_ROLE_CODE } from '../services/root_access.js'

const router = express.Router()

router.use(authMiddleware)

function normalizeRoleCode(value) {
  const normalized = String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')

  return normalized || 'ROL'
}

async function buildUniqueRoleCode(pool, baseCode, excludeRoleId = null) {
  let candidate = normalizeRoleCode(baseCode)
  let suffix = 2

  while (true) {
    const params = excludeRoleId ? [candidate, excludeRoleId] : [candidate]
    const query = excludeRoleId
      ? 'SELECT id FROM roles WHERE code = ? AND id <> ? LIMIT 1'
      : 'SELECT id FROM roles WHERE code = ? LIMIT 1'
    const [rows] = await pool.query(query, params)
    if (!Array.isArray(rows) || rows.length === 0) return candidate
    candidate = `${normalizeRoleCode(baseCode)}_${suffix}`
    suffix += 1
  }
}

// List all roles
router.get('/', permissionMiddleware('roles:read'), async (req, res) => {
  try {
    const pool = await getPool()
    await ensureRootAccessSchema(pool)
    const [roles] = await pool.query(
      'SELECT * FROM roles WHERE UPPER(COALESCE(code, "")) NOT IN (?, ?)',
      [ROOT_ROLE_CODE, SUPERUSER_ROLE_CODE]
    )
    
    // Fetch permissions for each role
    for (const role of roles) {
      const [perms] = await pool.query(
        'SELECT p.code FROM permissions p JOIN role_permissions rp ON p.id = rp.permission_id WHERE rp.role_id = ?',
        [role.id]
      )
      role.permissions = perms.map(p => p.code)
    }
    
    res.json(roles)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// List all available permissions
router.get('/permissions', permissionMiddleware('roles:read'), async (req, res) => {
  try {
    const pool = await getPool()
    await ensureRootAccessSchema(pool)
    const [perms] = await pool.query(
      `SELECT *
       FROM permissions
       WHERE code NOT IN (${ROOT_PERMISSION_CODES.map(() => '?').join(',')})`,
      ROOT_PERMISSION_CODES
    )
    res.json(perms)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Create role
router.post('/', permissionMiddleware('roles:write'), async (req, res) => {
  const { name, description, permissions, code } = req.body
  const trimmedName = String(name || '').trim()
  const trimmedDescription = String(description || '').trim()
  if (!trimmedName) return res.status(400).json({ error: 'El nombre del rol es obligatorio' })

  try {
    const pool = await getPool()
    await ensureRootAccessSchema(pool)
    const [existingByName] = await pool.query('SELECT id FROM roles WHERE name = ? LIMIT 1', [trimmedName])
    if (Array.isArray(existingByName) && existingByName.length > 0) {
      return res.status(409).json({ error: 'Ya existe un rol con ese nombre' })
    }

    const requestedCode = code || trimmedName
    const roleCode = await buildUniqueRoleCode(pool, requestedCode)
    if (isSpecialRoleCode(roleCode)) {
      return res.status(400).json({ error: 'Los roles root y superusuario solo se administran desde el modulo root' })
    }
    if (Array.isArray(permissions) && permissions.some(permissionCode => isRootPermissionCode(permissionCode))) {
      return res.status(400).json({ error: 'Los permisos root solo se administran desde el modulo root' })
    }

    const [resRole] = await pool.query('INSERT INTO roles (code, name, description) VALUES (?, ?, ?)', [roleCode, trimmedName, trimmedDescription || null])
    const roleId = resRole.insertId
    
    if (permissions && Array.isArray(permissions) && permissions.length > 0) {
      // permissions is array of codes
      const [permRows] = await pool.query('SELECT id, code FROM permissions WHERE code IN (?)', [permissions])
      for (const p of permRows) {
        await pool.query('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [roleId, p.id])
      }
    }
    
    res.json({ id: roleId, code: roleCode, name: trimmedName, description: trimmedDescription, permissions })
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Ya existe un rol con ese nombre o codigo' })
    }
    res.status(500).json({ error: err.message })
  }
})

// Update role
router.put('/:id', permissionMiddleware('roles:write'), async (req, res) => {
  const { id } = req.params
  const { name, description, permissions, code } = req.body
  const trimmedName = String(name || '').trim()
  const trimmedDescription = String(description || '').trim()
  
  try {
    const pool = await getPool()
    await ensureRootAccessSchema(pool)
    if (!trimmedName) {
      return res.status(400).json({ error: 'El nombre del rol es obligatorio' })
    }

    const [existingByName] = await pool.query('SELECT id FROM roles WHERE name = ? AND id <> ? LIMIT 1', [trimmedName, id])
    if (Array.isArray(existingByName) && existingByName.length > 0) {
      return res.status(409).json({ error: 'Ya existe otro rol con ese nombre' })
    }
    
    const [roleRows] = await pool.query('SELECT code FROM roles WHERE id = ? LIMIT 1', [id])
    const currentRoleCode = String(roleRows?.[0]?.code || '').trim().toUpperCase()
    if (isSpecialRoleCode(currentRoleCode)) {
      return res.status(403).json({ error: 'Los roles root y superusuario solo se administran desde el modulo root' })
    }

    if (code) {
      const safeCode = await buildUniqueRoleCode(pool, code, id)
      if (isSpecialRoleCode(safeCode)) {
        return res.status(400).json({ error: 'Los roles root y superusuario solo se administran desde el modulo root' })
      }
      await pool.query('UPDATE roles SET code = ?, name = ?, description = ? WHERE id = ?', [safeCode, trimmedName, trimmedDescription || null, id])
    } else {
      await pool.query('UPDATE roles SET name = ?, description = ? WHERE id = ?', [trimmedName, trimmedDescription || null, id])
    }
    
    if (permissions && Array.isArray(permissions)) {
      if (permissions.some(permissionCode => isRootPermissionCode(permissionCode))) {
        return res.status(400).json({ error: 'Los permisos root solo se administran desde el modulo root' })
      }
      await pool.query('DELETE FROM role_permissions WHERE role_id = ?', [id])
      if (permissions.length > 0) {
        const [permRows] = await pool.query('SELECT id, code FROM permissions WHERE code IN (?)', [permissions])
        for (const p of permRows) {
            await pool.query('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [id, p.id])
        }
      }
    }
    
    res.json({ id, code, name: trimmedName, description: trimmedDescription, permissions })
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Ya existe un rol con ese nombre o codigo' })
    }
    res.status(500).json({ error: err.message })
  }
})

// Delete role
router.delete('/:id', permissionMiddleware('roles:write'), async (req, res) => {
  const { id } = req.params
  try {
    const pool = await getPool()
    await ensureRootAccessSchema(pool)
    const [roleRows] = await pool.query('SELECT code FROM roles WHERE id = ? LIMIT 1', [id])
    const currentRoleCode = String(roleRows?.[0]?.code || '').trim().toUpperCase()
    if (isSpecialRoleCode(currentRoleCode)) {
      return res.status(403).json({ error: 'Los roles root y superusuario no se pueden eliminar desde esta sección' })
    }
    // Check if used by users
    const [users] = await pool.query('SELECT COUNT(*) as c FROM users WHERE role_id = ?', [id])
    if (users[0].c > 0) return res.status(400).json({ error: 'Cannot delete role assigned to users' })
    
    await pool.query('DELETE FROM roles WHERE id = ?', [id])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
