import bcrypt from 'bcryptjs'
import { getPool } from '../db.js'

export const ROOT_ROLE_CODE = 'ROOT'
export const SUPERUSER_ROLE_CODE = 'SUPERUSUARIO'
export const SPECIAL_ROLE_CODES = [ROOT_ROLE_CODE, SUPERUSER_ROLE_CODE]
export const DEFAULT_ENABLED_PRODUCT_TYPES = ['GENERAL', 'MEDICINAL', 'IMEI', 'SERIAL', 'VARIANT_SERIALIZED']

export const ROOT_PERMISSION_CATALOG = [
  { code: 'root:access', description: 'Acceso al modulo exclusivo root' },
  { code: 'root:core:store', description: 'Activar o desactivar la tienda en linea' },
  { code: 'root:core:product-types', description: 'Gestionar tipos de producto habilitados' },
  { code: 'root:core:permissions', description: 'Administrar superusuarios y permisos root' },
  { code: 'root:audit:read', description: 'Ver auditoria inmutable del modulo root' },
]

export const ROOT_PERMISSION_CODES = ROOT_PERMISSION_CATALOG.map(item => item.code)
export const SUPERUSER_DEFAULT_PERMISSION_CODES = ['root:access', 'root:audit:read']

function executorQuery(executor, sql, params = []) {
  if (!executor || typeof executor.query !== 'function') {
    throw new Error('Executor de base de datos invalido')
  }
  return executor.query(sql, params)
}

async function columnExists(executor, tableName, columnName) {
  const [rows] = await executorQuery(
    executor,
    `SELECT 1
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  )
  return Array.isArray(rows) && rows.length > 0
}

async function getColumnDefinition(executor, tableName, columnName) {
  const [rows] = await executorQuery(
    executor,
    `SELECT DATA_TYPE AS dataType,
            COLUMN_TYPE AS columnType,
            IS_NULLABLE AS isNullable
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  )
  return rows?.[0] || null
}

async function triggerExists(executor, triggerName) {
  const [rows] = await executorQuery(
    executor,
    `SELECT 1
     FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE()
       AND TRIGGER_NAME = ?
     LIMIT 1`,
    [triggerName]
  )
  return Array.isArray(rows) && rows.length > 0
}

export function isSpecialRoleCode(roleCode) {
  return SPECIAL_ROLE_CODES.includes(String(roleCode || '').trim().toUpperCase())
}

export function isRootPermissionCode(permissionCode) {
  return ROOT_PERMISSION_CODES.includes(String(permissionCode || '').trim())
}

export function normalizeEnabledProductTypes(input) {
  let values = input
  if (typeof values === 'string') {
    try {
      values = JSON.parse(values)
    } catch {
      values = values.split(',').map(item => item.trim()).filter(Boolean)
    }
  }

  const allowed = new Set(DEFAULT_ENABLED_PRODUCT_TYPES)
  const normalized = Array.isArray(values)
    ? values
      .map(value => String(value || '').trim().toUpperCase())
      .filter(value => allowed.has(value))
    : []

  const unique = [...new Set(normalized)]
  return unique.length > 0
    ? (unique.includes('GENERAL') ? unique : ['GENERAL', ...unique])
    : ['GENERAL']
}

export function parseStoredEnabledProductTypes(raw) {
  if (!raw) return [...DEFAULT_ENABLED_PRODUCT_TYPES]
  try {
    return normalizeEnabledProductTypes(JSON.parse(raw))
  } catch {
    return normalizeEnabledProductTypes(raw)
  }
}

function parseLegacyRootPermissionCodes(raw) {
  if (!raw) return []

  let values = raw
  if (typeof values === 'string') {
    try {
      values = JSON.parse(values)
    } catch {
      values = values.split(',').map(item => item.trim()).filter(Boolean)
    }
  }

  const mapped = new Set(['root:access'])
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = String(value || '').trim().toLowerCase()
    if (!normalized) continue
    if (ROOT_PERMISSION_CODES.includes(normalized)) {
      mapped.add(normalized)
      continue
    }
    if (normalized === 'root:read') {
      mapped.add('root:audit:read')
      continue
    }
    if (normalized === 'root:write') {
      mapped.add('root:core:store')
      mapped.add('root:core:product-types')
      mapped.add('root:core:permissions')
    }
  }

  return [...mapped].filter(code => ROOT_PERMISSION_CODES.includes(code))
}

export async function ensureRootAccessSchema(executor) {
  const rolesCodeColumn = await getColumnDefinition(executor, 'roles', 'code')
  if (!rolesCodeColumn) {
    await executorQuery(executor, 'ALTER TABLE roles ADD COLUMN code VARCHAR(64) NULL AFTER id')
  } else if (String(rolesCodeColumn.dataType || '').toLowerCase() === 'enum') {
    await executorQuery(executor, 'ALTER TABLE roles MODIFY COLUMN code VARCHAR(64) NULL')
  }
  await executorQuery(
    executor,
    "UPDATE roles SET code = UPPER(REPLACE(TRIM(name), ' ', '_')) WHERE code IS NULL OR TRIM(code) = ''"
  )

  if (await columnExists(executor, 'users', 'role_id') === false) {
    await executorQuery(executor, 'ALTER TABLE users ADD COLUMN role_id INT NULL AFTER role')
  }
  if (await columnExists(executor, 'users', 'is_root') === false) {
    await executorQuery(executor, 'ALTER TABLE users ADD COLUMN is_root TINYINT(1) NOT NULL DEFAULT 0 AFTER role_id')
  }
  if (await columnExists(executor, 'users', 'root_permissions') === false) {
    await executorQuery(executor, 'ALTER TABLE users ADD COLUMN root_permissions TEXT NULL AFTER is_root')
  }
  if (await columnExists(executor, 'users', 'warehouse_id') === false) {
    await executorQuery(executor, 'ALTER TABLE users ADD COLUMN warehouse_id INT NULL DEFAULT NULL AFTER role_id')
  }
  if (await columnExists(executor, 'users', 'can_sell') === false) {
    await executorQuery(executor, 'ALTER TABLE users ADD COLUMN can_sell TINYINT(1) NOT NULL DEFAULT 1 AFTER warehouse_id')
  }
  if (await columnExists(executor, 'system_config', 'enabled_product_types') === false) {
    await executorQuery(executor, 'ALTER TABLE system_config ADD COLUMN enabled_product_types TEXT NULL AFTER logo_url')
  }

  await executorQuery(
    executor,
    `UPDATE users u
     INNER JOIN roles r ON UPPER(TRIM(u.role)) = UPPER(TRIM(r.code))
     SET u.role_id = r.id
     WHERE u.role_id IS NULL`
  )

  await executorQuery(
    executor,
    `CREATE TABLE IF NOT EXISTS user_permission_grants (
      user_id INT NOT NULL,
      permission_id INT NOT NULL,
      granted_by_user_id INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, permission_id)
    )`
  )

  await executorQuery(
    executor,
    `CREATE TABLE IF NOT EXISTS root_audit_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      actor_user_id INT NOT NULL,
      actor_role_code VARCHAR(64) NOT NULL,
      action_code VARCHAR(120) NOT NULL,
      resource_type VARCHAR(80) NOT NULL,
      resource_id VARCHAR(80) NULL,
      request_ip VARCHAR(120) NULL,
      before_state_json LONGTEXT NULL,
      after_state_json LONGTEXT NULL,
      metadata_json LONGTEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  )

  if (!(await triggerExists(executor, 'root_audit_logs_no_update'))) {
    await executorQuery(
      executor,
      `CREATE TRIGGER root_audit_logs_no_update
       BEFORE UPDATE ON root_audit_logs
       FOR EACH ROW
       SIGNAL SQLSTATE '45000'
       SET MESSAGE_TEXT = 'Los registros de auditoria root son inmutables y no pueden modificarse.'`
    )
  }

  if (!(await triggerExists(executor, 'root_audit_logs_no_delete'))) {
    await executorQuery(
      executor,
      `CREATE TRIGGER root_audit_logs_no_delete
       BEFORE DELETE ON root_audit_logs
       FOR EACH ROW
       SIGNAL SQLSTATE '45000'
       SET MESSAGE_TEXT = 'Los registros de auditoria root son inmutables y no pueden eliminarse.'`
    )
  }

  for (const permission of ROOT_PERMISSION_CATALOG) {
    await executorQuery(
      executor,
      `INSERT INTO permissions (code, description)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE description = VALUES(description)`,
      [permission.code, permission.description]
    )
  }

  const roleDefinitions = [
    {
      code: ROOT_ROLE_CODE,
      name: 'Root',
      description: 'Superusuario root con alcance limitado a funciones core del sistema.',
      permissions: ROOT_PERMISSION_CODES,
    },
    {
      code: SUPERUSER_ROLE_CODE,
      name: 'Superusuario',
      description: 'Operador core con acceso solo a funciones root autorizadas.',
      permissions: SUPERUSER_DEFAULT_PERMISSION_CODES,
    },
  ]

  for (const role of roleDefinitions) {
    await executorQuery(
      executor,
      `INSERT INTO roles (code, name, description)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description)`,
      [role.code, role.name, role.description]
    )
  }

  const [roleRows] = await executorQuery(
    executor,
    `SELECT id, code
     FROM roles
     WHERE code IN (?, ?)`,
    [ROOT_ROLE_CODE, SUPERUSER_ROLE_CODE]
  )
  const roleIds = Object.fromEntries((roleRows || []).map(row => [String(row.code || '').toUpperCase(), Number(row.id)]))

  const [permissionRows] = await executorQuery(
    executor,
    `SELECT id, code
     FROM permissions
     WHERE code IN (${ROOT_PERMISSION_CODES.map(() => '?').join(',')})`,
    ROOT_PERMISSION_CODES
  )
  const permissionIds = Object.fromEntries((permissionRows || []).map(row => [String(row.code || ''), Number(row.id)]))

  for (const role of roleDefinitions) {
    const roleId = roleIds[role.code]
    if (!roleId) continue
    await executorQuery(executor, 'DELETE FROM role_permissions WHERE role_id = ?', [roleId])
    for (const permissionCode of role.permissions) {
      const permissionId = permissionIds[permissionCode]
      if (!permissionId) continue
      await executorQuery(
        executor,
        'INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
        [roleId, permissionId]
      )
    }
  }

  const [legacyRootUsers] = await executorQuery(
    executor,
    `SELECT id, email, root_permissions
     FROM users
     WHERE COALESCE(is_root, 0) = 1
        OR email = ?
        OR root_permissions IS NOT NULL`,
    [String(process.env.DEFAULT_ROOT_EMAIL || 'root@local').trim().toLowerCase()]
  )

  const superuserRoleId = roleIds[SUPERUSER_ROLE_CODE]
  for (const legacyUser of legacyRootUsers || []) {
    const userId = Number(legacyUser.id || 0)
    if (!userId) continue

    const normalizedEmail = String(legacyUser.email || '').trim().toLowerCase()
    const isDefaultRoot = normalizedEmail === String(process.env.DEFAULT_ROOT_EMAIL || 'root@local').trim().toLowerCase()
    const targetRoleId = isDefaultRoot ? roleIds[ROOT_ROLE_CODE] : superuserRoleId
    if (!targetRoleId) continue

    await executorQuery(
      executor,
      `UPDATE users
       SET role_id = ?, can_sell = 0, active = 1
       WHERE id = ?`,
      [targetRoleId, userId]
    )

    if (!isDefaultRoot && superuserRoleId) {
      const legacyPermissions = parseLegacyRootPermissionCodes(legacyUser.root_permissions)
      if (legacyPermissions.length > 0) {
        for (const permissionCode of legacyPermissions) {
          const permissionId = permissionIds[permissionCode]
          if (!permissionId) continue
          await executorQuery(
            executor,
            `INSERT IGNORE INTO user_permission_grants (user_id, permission_id, granted_by_user_id)
             VALUES (?, ?, NULL)`,
            [userId, permissionId]
          )
        }
      }
    }
  }

  await executorQuery(
    executor,
    `UPDATE system_config
     SET enabled_product_types = ?
     WHERE id = 1 AND (enabled_product_types IS NULL OR TRIM(enabled_product_types) = '')`,
    [JSON.stringify(DEFAULT_ENABLED_PRODUCT_TYPES)]
  )

  await executorQuery(
    executor,
    `CREATE TABLE IF NOT EXISTS store_settings (
      id INT PRIMARY KEY,
      enabled TINYINT(1) NOT NULL DEFAULT 1
    )`
  )
  await executorQuery(
    executor,
    `INSERT IGNORE INTO store_settings (id, enabled)
     VALUES (1, 1)`
  )

  const rootEmail = String(process.env.DEFAULT_ROOT_EMAIL || 'root@local').trim().toLowerCase()
  const rootPassword = String(process.env.DEFAULT_ROOT_PASSWORD || 'root123').trim() || 'root123'
  const rootName = String(process.env.DEFAULT_ROOT_NAME || 'Root').trim() || 'Root'
  const rootRoleId = roleIds[ROOT_ROLE_CODE]

  if (rootRoleId) {
    const passwordHash = await bcrypt.hash(rootPassword, 10)
    await executorQuery(
      executor,
      `INSERT INTO users (name, email, password, role_id, warehouse_id, can_sell, active)
       VALUES (?, ?, ?, ?, NULL, 0, 1)
       ON DUPLICATE KEY UPDATE
         name = VALUES(name),
         password = VALUES(password),
         role_id = VALUES(role_id),
         can_sell = 0,
         active = 1`,
      [rootName, rootEmail, passwordHash, rootRoleId]
    )
  }
}

export async function getEffectivePermissionCodes(pool, userId, roleId = null) {
  const normalizedUserId = Number(userId || 0)
  if (!normalizedUserId) return []

  let effectiveRoleId = Number(roleId || 0)
  if (!effectiveRoleId) {
    const [userRows] = await pool.query('SELECT role_id FROM users WHERE id = ? LIMIT 1', [normalizedUserId])
    effectiveRoleId = Number(userRows?.[0]?.role_id || 0)
  }

  const params = [normalizedUserId]
  let roleQuery = ''
  if (effectiveRoleId > 0) {
    roleQuery = `
      UNION
      SELECT DISTINCT p.code
      FROM permissions p
      INNER JOIN role_permissions rp ON rp.permission_id = p.id
      WHERE rp.role_id = ?
    `
    params.push(effectiveRoleId)
  }

  const [rows] = await pool.query(
    `
    SELECT DISTINCT code
    FROM (
      SELECT DISTINCT p.code
      FROM permissions p
      INNER JOIN user_permission_grants upg ON upg.permission_id = p.id
      WHERE upg.user_id = ?
      ${roleQuery}
    ) effective_permissions
    ORDER BY code ASC
    `,
    params
  )

  return (rows || []).map(row => String(row.code || '').trim()).filter(Boolean)
}

export async function getAuthenticatedSecurityContext(pool, userId) {
  const normalizedUserId = Number(userId || 0)
  if (!normalizedUserId) return null

  const [rows] = await pool.query(
    `SELECT u.id, u.name, u.email, u.active, u.role_id, u.warehouse_id,
            u.can_sell, r.code AS role_code, r.name AS role_name, w.name AS warehouse_name
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     LEFT JOIN warehouses w ON w.id = u.warehouse_id
     WHERE u.id = ?
     LIMIT 1`,
    [normalizedUserId]
  )

  const user = rows?.[0]
  if (!user || Number(user.active || 0) !== 1) return null

  const permissions = await getEffectivePermissionCodes(pool, user.id, user.role_id)
  return {
    id: Number(user.id),
    name: user.name || '',
    email: user.email || '',
    role: String(user.role_code || user.role_name || '').trim().toUpperCase(),
    roleId: Number(user.role_id || 0),
    permissions,
    canSell: Boolean(Number(user.can_sell ?? 1)),
    warehouseId: user.warehouse_id == null ? null : Number(user.warehouse_id),
    warehouseName: user.warehouse_name || null,
  }
}

export function getRequestIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0] || '').split(',')[0].trim()
  }
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim()
  }
  return String(req.ip || req.socket?.remoteAddress || '').trim() || null
}

export function rootAccessMiddleware(requiredPermissions = []) {
  const normalizedRequiredPermissions = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions]

  return async (req, res, next) => {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ error: 'No autenticado' })
      }

      const pool = await getPool()
      await ensureRootAccessSchema(pool)
      const context = await getAuthenticatedSecurityContext(pool, req.user.id)

      if (!context) {
        return res.status(401).json({ error: 'Sesion invalida o usuario inactivo' })
      }

      if (!isSpecialRoleCode(context.role) || !context.permissions.includes('root:access')) {
        return res.status(403).json({ error: 'Acceso restringido al modulo root' })
      }

      const missingPermission = normalizedRequiredPermissions.find(permission => !context.permissions.includes(permission))
      if (missingPermission) {
        return res.status(403).json({ error: `Permiso root insuficiente: ${missingPermission}` })
      }

      req.rootContext = context
      next()
    } catch (error) {
      console.error('Root access middleware error:', error)
      res.status(500).json({ error: 'No se pudo validar el acceso root' })
    }
  }
}

export async function appendRootAuditLog(executor, {
  actor,
  req,
  actionCode,
  resourceType,
  resourceId = null,
  beforeState = null,
  afterState = null,
  metadata = null,
}) {
  if (!actor?.id || !actionCode || !resourceType) return

  await executorQuery(
    executor,
    `INSERT INTO root_audit_logs
     (actor_user_id, actor_role_code, action_code, resource_type, resource_id, request_ip, before_state_json, after_state_json, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      Number(actor.id),
      String(actor.role || ''),
      String(actionCode || ''),
      String(resourceType || ''),
      resourceId == null ? null : String(resourceId),
      getRequestIp(req),
      beforeState == null ? null : JSON.stringify(beforeState),
      afterState == null ? null : JSON.stringify(afterState),
      metadata == null ? null : JSON.stringify(metadata),
    ]
  )
}
