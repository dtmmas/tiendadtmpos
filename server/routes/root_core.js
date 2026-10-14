import express from 'express'
import bcrypt from 'bcryptjs'
import { authMiddleware } from '../auth.js'
import { getPool } from '../db.js'
import {
  ROOT_PERMISSION_CATALOG,
  ROOT_PERMISSION_CODES,
  SUPERUSER_ROLE_CODE,
  ROOT_ROLE_CODE,
  DEFAULT_ENABLED_PRODUCT_TYPES,
  appendRootAuditLog,
  ensureRootAccessSchema,
  getEffectivePermissionCodes,
  parseStoredEnabledProductTypes,
  normalizeEnabledProductTypes,
  rootAccessMiddleware,
  isSpecialRoleCode,
} from '../services/root_access.js'

const router = express.Router()
const ROOT_MUTABLE_PERMISSION_CODES = ROOT_PERMISSION_CODES.filter(code => code !== 'root:access')

async function getSpecialRoleIds(pool) {
  const [rows] = await pool.query(
    `SELECT id, code
     FROM roles
     WHERE code IN (?, ?)`,
    [ROOT_ROLE_CODE, SUPERUSER_ROLE_CODE]
  )
  return Object.fromEntries((rows || []).map(row => [String(row.code || '').toUpperCase(), Number(row.id)]))
}

async function ensureCoreConfigState(pool) {
  await ensureRootAccessSchema(pool)
  const [systemRows] = await pool.query(
    'SELECT enabled_product_types FROM system_config WHERE id = 1 LIMIT 1'
  )
  const [storeRows] = await pool.query(
    'SELECT enabled FROM store_settings WHERE id = 1 LIMIT 1'
  )
  return {
    enabledProductTypes: parseStoredEnabledProductTypes(systemRows?.[0]?.enabled_product_types),
    storeEnabled: Boolean(Number(storeRows?.[0]?.enabled ?? 1)),
  }
}

async function listSpecialUsers(pool) {
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.email, u.active, u.role_id, r.code AS roleCode, r.name AS roleName
     FROM users u
     INNER JOIN roles r ON r.id = u.role_id
     WHERE r.code IN (?, ?)
     ORDER BY FIELD(r.code, ?, ?), u.name ASC, u.id ASC`,
    [ROOT_ROLE_CODE, SUPERUSER_ROLE_CODE, ROOT_ROLE_CODE, SUPERUSER_ROLE_CODE]
  )

  const users = []
  for (const row of rows || []) {
    const permissions = await getEffectivePermissionCodes(pool, row.id, row.role_id)
    users.push({
      id: Number(row.id || 0),
      name: row.name || '',
      email: row.email || '',
      active: Boolean(Number(row.active ?? 1)),
      roleCode: String(row.roleCode || '').toUpperCase(),
      roleName: row.roleName || '',
      permissions: permissions.filter(code => ROOT_PERMISSION_CODES.includes(code)),
    })
  }
  return users
}

async function listRootAuditLogs(pool, limit = 100) {
  const safeLimit = Math.max(1, Math.min(300, Number(limit || 100)))
  const [rows] = await pool.query(
    `SELECT id, actor_user_id AS actorUserId, actor_role_code AS actorRoleCode,
            action_code AS actionCode, resource_type AS resourceType, resource_id AS resourceId,
            request_ip AS requestIp, before_state_json AS beforeStateJson, after_state_json AS afterStateJson,
            metadata_json AS metadataJson, created_at AS createdAt
     FROM root_audit_logs
     ORDER BY id DESC
     LIMIT ?`,
    [safeLimit]
  )

  return (rows || []).map(row => {
    const parse = (raw) => {
      if (!raw) return null
      try {
        return JSON.parse(raw)
      } catch {
        return null
      }
    }
    return {
      id: Number(row.id || 0),
      actorUserId: Number(row.actorUserId || 0),
      actorRoleCode: row.actorRoleCode || '',
      actionCode: row.actionCode || '',
      resourceType: row.resourceType || '',
      resourceId: row.resourceId || null,
      requestIp: row.requestIp || null,
      beforeState: parse(row.beforeStateJson),
      afterState: parse(row.afterStateJson),
      metadata: parse(row.metadataJson),
      createdAt: row.createdAt,
    }
  })
}

async function getSpecialUserById(pool, userId) {
  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.email, u.active, u.role_id, r.code AS roleCode, r.name AS roleName
     FROM users u
     INNER JOIN roles r ON r.id = u.role_id
     WHERE u.id = ?
       AND r.code IN (?, ?)
     LIMIT 1`,
    [userId, ROOT_ROLE_CODE, SUPERUSER_ROLE_CODE]
  )
  const user = rows?.[0]
  if (!user) return null
  return {
    id: Number(user.id || 0),
    name: user.name || '',
    email: user.email || '',
    active: Boolean(Number(user.active ?? 1)),
    roleId: Number(user.role_id || 0),
    roleCode: String(user.roleCode || '').toUpperCase(),
    roleName: user.roleName || '',
    permissions: (await getEffectivePermissionCodes(pool, user.id, user.role_id)).filter(code => ROOT_PERMISSION_CODES.includes(code)),
  }
}

router.use(authMiddleware)
router.use(rootAccessMiddleware())

router.get('/state', async (req, res) => {
  try {
    const pool = await getPool()
    const coreState = await ensureCoreConfigState(pool)
    const specialUsers = await listSpecialUsers(pool)
    const canReadAudit = req.rootContext.permissions.includes('root:audit:read')

    return res.json({
      currentUser: {
        id: req.rootContext.id,
        name: req.rootContext.name,
        email: req.rootContext.email,
        role: req.rootContext.role,
        permissions: req.rootContext.permissions.filter(code => ROOT_PERMISSION_CODES.includes(code)),
      },
      capabilities: {
        canManageStore: req.rootContext.permissions.includes('root:core:store'),
        canManageProductTypes: req.rootContext.permissions.includes('root:core:product-types'),
        canManageSuperusers: req.rootContext.permissions.includes('root:core:permissions'),
        canReadAudit,
      },
      systemFlags: coreState,
      availablePermissions: ROOT_PERMISSION_CATALOG,
      mutablePermissions: ROOT_MUTABLE_PERMISSION_CODES,
      specialUsers,
      auditLogs: canReadAudit ? await listRootAuditLogs(pool, 80) : [],
    })
  } catch (error) {
    console.error('Root core state error:', error)
    return res.status(500).json({ error: 'No se pudo cargar el modulo root' })
  }
})

router.get('/audit', rootAccessMiddleware('root:audit:read'), async (req, res) => {
  try {
    const pool = await getPool()
    const logs = await listRootAuditLogs(pool, req.query.limit || 120)
    return res.json(logs)
  } catch (error) {
    console.error('Root core audit error:', error)
    return res.status(500).json({ error: 'No se pudo cargar la auditoria root' })
  }
})

router.put('/store-enabled', rootAccessMiddleware('root:core:store'), async (req, res) => {
  try {
    const pool = await getPool()
    const current = await ensureCoreConfigState(pool)
    const nextEnabled = Boolean(req.body?.enabled)

    await pool.query('UPDATE store_settings SET enabled = ? WHERE id = 1', [nextEnabled ? 1 : 0])
    await appendRootAuditLog(pool, {
      actor: req.rootContext,
      req,
      actionCode: 'root.store_enabled.update',
      resourceType: 'store_settings',
      resourceId: '1',
      beforeState: { enabled: current.storeEnabled },
      afterState: { enabled: nextEnabled },
    })

    return res.json({ ok: true, enabled: nextEnabled })
  } catch (error) {
    console.error('Root core store toggle error:', error)
    return res.status(500).json({ error: 'No se pudo actualizar el estado de la tienda' })
  }
})

router.put('/product-types', rootAccessMiddleware('root:core:product-types'), async (req, res) => {
  try {
    const pool = await getPool()
    const current = await ensureCoreConfigState(pool)
    const nextTypes = normalizeEnabledProductTypes(req.body?.enabledProductTypes || DEFAULT_ENABLED_PRODUCT_TYPES)

    await pool.query(
      'UPDATE system_config SET enabled_product_types = ? WHERE id = 1',
      [JSON.stringify(nextTypes)]
    )

    await appendRootAuditLog(pool, {
      actor: req.rootContext,
      req,
      actionCode: 'root.product_types.update',
      resourceType: 'system_config',
      resourceId: '1',
      beforeState: { enabledProductTypes: current.enabledProductTypes },
      afterState: { enabledProductTypes: nextTypes },
    })

    return res.json({ ok: true, enabledProductTypes: nextTypes })
  } catch (error) {
    console.error('Root core product types error:', error)
    return res.status(500).json({ error: 'No se pudieron actualizar los tipos de producto' })
  }
})

router.post('/users', rootAccessMiddleware('root:core:permissions'), async (req, res) => {
  const name = String(req.body?.name || '').trim()
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '').trim()

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Nombre, email y contraseña son obligatorios' })
  }

  try {
    const pool = await getPool()
    const roleIds = await getSpecialRoleIds(pool)
    const superuserRoleId = roleIds[SUPERUSER_ROLE_CODE]

    if (!superuserRoleId) {
      return res.status(500).json({ error: 'No se pudo resolver el rol de superusuario' })
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const [result] = await pool.query(
      `INSERT INTO users (name, email, password, role_id, warehouse_id, can_sell, active)
       VALUES (?, ?, ?, ?, NULL, 0, 1)`,
      [name, email, passwordHash, superuserRoleId]
    )

    const created = await getSpecialUserById(pool, result.insertId)
    await appendRootAuditLog(pool, {
      actor: req.rootContext,
      req,
      actionCode: 'root.superuser.create',
      resourceType: 'user',
      resourceId: String(result.insertId),
      afterState: created,
      metadata: { roleCode: SUPERUSER_ROLE_CODE },
    })

    return res.json(created)
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Ya existe un usuario con ese email' })
    }
    console.error('Root core create superuser error:', error)
    return res.status(500).json({ error: 'No se pudo crear el superusuario' })
  }
})

router.put('/users/:id', rootAccessMiddleware('root:core:permissions'), async (req, res) => {
  try {
    const pool = await getPool()
    const userId = Number(req.params.id || 0)
    if (!userId) return res.status(400).json({ error: 'Usuario invalido' })

    const beforeUser = await getSpecialUserById(pool, userId)
    if (!beforeUser) return res.status(404).json({ error: 'Usuario especial no encontrado' })

    const updates = []
    const values = []
    const nextName = req.body?.name === undefined ? null : String(req.body.name || '').trim()
    const nextEmail = req.body?.email === undefined ? null : String(req.body.email || '').trim().toLowerCase()
    const nextPassword = req.body?.password === undefined ? null : String(req.body.password || '').trim()

    if (nextName !== null) {
      if (!nextName) return res.status(400).json({ error: 'El nombre no puede quedar vacío' })
      updates.push('name = ?')
      values.push(nextName)
    }

    if (nextEmail !== null) {
      if (!nextEmail) return res.status(400).json({ error: 'El email no puede quedar vacío' })
      updates.push('email = ?')
      values.push(nextEmail)
    }

    if (req.body?.active !== undefined) {
      const requestedActive = Boolean(req.body.active)
      if (beforeUser.roleCode === ROOT_ROLE_CODE && requestedActive === false) {
        return res.status(400).json({ error: 'El usuario root no puede desactivarse desde el sistema' })
      }
      updates.push('active = ?')
      values.push(requestedActive ? 1 : 0)
    }

    if (nextPassword !== null) {
      if (!nextPassword) return res.status(400).json({ error: 'La contraseña no puede quedar vacía' })
      const passwordHash = await bcrypt.hash(nextPassword, 10)
      updates.push('password = ?')
      values.push(passwordHash)
    }

    if (updates.length === 0) {
      return res.json(beforeUser)
    }

    values.push(userId)
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values)
    const afterUser = await getSpecialUserById(pool, userId)

    await appendRootAuditLog(pool, {
      actor: req.rootContext,
      req,
      actionCode: 'root.special_user.update',
      resourceType: 'user',
      resourceId: String(userId),
      beforeState: beforeUser,
      afterState: afterUser,
      metadata: { roleCode: beforeUser.roleCode },
    })

    return res.json(afterUser)
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Ya existe un usuario con ese email' })
    }
    console.error('Root core update special user error:', error)
    return res.status(500).json({ error: 'No se pudo actualizar el usuario especial' })
  }
})

router.put('/users/:id/permissions', rootAccessMiddleware('root:core:permissions'), async (req, res) => {
  try {
    const pool = await getPool()
    const userId = Number(req.params.id || 0)
    if (!userId) return res.status(400).json({ error: 'Usuario invalido' })

    const targetUser = await getSpecialUserById(pool, userId)
    if (!targetUser) return res.status(404).json({ error: 'Usuario especial no encontrado' })
    if (targetUser.roleCode !== SUPERUSER_ROLE_CODE) {
      return res.status(400).json({ error: 'Solo los superusuarios permiten grants manuales en este modulo' })
    }

    const requestedPermissions = Array.isArray(req.body?.permissions)
      ? req.body.permissions.map(value => String(value || '').trim()).filter(Boolean)
      : []
    const invalidPermissions = requestedPermissions.filter(code => !ROOT_MUTABLE_PERMISSION_CODES.includes(code))
    if (invalidPermissions.length > 0) {
      return res.status(400).json({ error: `Permisos root inválidos: ${invalidPermissions.join(', ')}` })
    }

    const [permissionRows] = await pool.query(
      `SELECT id, code
       FROM permissions
       WHERE code IN (${ROOT_MUTABLE_PERMISSION_CODES.map(() => '?').join(',')})`,
      ROOT_MUTABLE_PERMISSION_CODES
    )
    const permissionMap = new Map((permissionRows || []).map(row => [String(row.code || ''), Number(row.id)]))
    const beforePermissions = targetUser.permissions.filter(code => ROOT_PERMISSION_CODES.includes(code))

    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      await conn.query(
        `DELETE upg
         FROM user_permission_grants upg
         INNER JOIN permissions p ON p.id = upg.permission_id
         WHERE upg.user_id = ?
           AND p.code IN (${ROOT_MUTABLE_PERMISSION_CODES.map(() => '?').join(',')})`,
        [userId, ...ROOT_MUTABLE_PERMISSION_CODES]
      )

      for (const permissionCode of requestedPermissions) {
        const permissionId = permissionMap.get(permissionCode)
        if (!permissionId) continue
        await conn.query(
          `INSERT IGNORE INTO user_permission_grants (user_id, permission_id, granted_by_user_id)
           VALUES (?, ?, ?)`,
          [userId, permissionId, req.rootContext.id]
        )
      }

      const afterUser = await getSpecialUserById(conn, userId)
      await appendRootAuditLog(conn, {
        actor: req.rootContext,
        req,
        actionCode: 'root.superuser.permissions.update',
        resourceType: 'user_permissions',
        resourceId: String(userId),
        beforeState: { permissions: beforePermissions },
        afterState: { permissions: afterUser?.permissions || [] },
        metadata: { userId, roleCode: targetUser.roleCode },
      })
      await conn.commit()
      return res.json(afterUser)
    } catch (error) {
      await conn.rollback()
      throw error
    } finally {
      conn.release()
    }
  } catch (error) {
    console.error('Root core update grants error:', error)
    return res.status(500).json({ error: 'No se pudieron actualizar los permisos especiales' })
  }
})

export default router
