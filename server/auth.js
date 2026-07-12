import jwt from 'jsonwebtoken'

export function signToken(user) {
  const secret = process.env.JWT_SECRET || 'devsecret'
  return jwt.sign({
    id: user.id,
    role: user.role,
    name: user.name,
    permissions: Array.isArray(user.permissions) ? user.permissions : [],
    warehouseId: user.warehouseId ?? null,
    warehouseName: user.warehouseName ?? null,
    canSell: user.canSell !== undefined ? Boolean(user.canSell) : true,
  }, secret, { expiresIn: '8h' })
}

export function authMiddleware(req, res, next) {
  const auth = req.headers['authorization']
  if (!auth) return res.status(401).json({ error: 'No token' })
  const token = auth.replace('Bearer ', '')
  try {
    const secret = process.env.JWT_SECRET || 'devsecret'
    const payload = jwt.verify(token, secret)
    req.user = payload
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

export function roleMiddleware(roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No auth' })
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' })
    next()
  }
}

export function isAdminUser(user) {
  return String(user?.role || '').toUpperCase() === 'ADMIN'
}

export function canUserSell(user) {
  if (!user) return false
  return Boolean(user?.canSell ?? true)
}

export function hasUserPermission(user, permission) {
  if (!user || !permission) return false
  if (isAdminUser(user)) return true
  return Array.isArray(user.permissions) && user.permissions.includes(permission)
}

export function hasExplicitUserPermission(user, permission) {
  if (!user || !permission) return false
  return Array.isArray(user.permissions) && user.permissions.includes(permission)
}

export function getUserWarehouseId(user) {
  const warehouseId = Number(user?.warehouseId || 0)
  return warehouseId > 0 ? warehouseId : null
}

export function canAccessWarehouse(user, warehouseId) {
  const targetWarehouseId = Number(warehouseId || 0)
  if (!targetWarehouseId) return false
  if (isAdminUser(user)) return true
  return getUserWarehouseId(user) === targetWarehouseId
}

// New middleware for permission check
// Since permissions are not in the token (to keep it small), we might need to fetch them or rely on frontend?
// No, backend MUST verify.
// But checking DB on every request is expensive? Not really for MySQL.
// Or we can include permissions in token if the list is small (< 4KB).
// The list is around 30 strings. 30 * 20 chars = 600 bytes. It's fine.
// BUT I didn't include permissions in signToken above.
// Let's update signToken to include permissions if provided.

// Wait, I updated auth.js file content but I should also update signToken implementation to include permissions if I want to use them in middleware without DB hit.
// However, standard practice for JWT is to verify against DB or cache if you want immediate revocation/updates.
// But for simplicity, let's assume if I change a role, the user needs to re-login to get new permissions if I put them in token.
// Or I can fetch permissions in the middleware.

// Let's go with fetching permissions in middleware for `permissionMiddleware`.
// It requires `getPool`.

import { getPool } from './db.js'

export function permissionMiddleware(requiredPermission) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No auth' })
    
    // Admin always has access? Maybe.
    if (req.user.role === 'ADMIN') return next()

    try {
      const pool = await getPool()
      const [rows] = await pool.query(
        `SELECT 1 
         FROM users u
         JOIN role_permissions rp ON u.role_id = rp.role_id
         JOIN permissions p ON rp.permission_id = p.id
         WHERE u.id = ? AND p.code = ?`,
        [req.user.id, requiredPermission]
      )
      
      if (rows.length > 0) {
        next()
      } else {
        res.status(403).json({ error: 'Forbidden: Missing permission ' + requiredPermission })
      }
    } catch (err) {
      console.error('Permission check error:', err)
      res.status(500).json({ error: 'Server error during permission check' })
    }
  }
}
