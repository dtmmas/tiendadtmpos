import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import jwt from 'jsonwebtoken'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, '..', '.env') })

const API_BASE_URL = process.env.TEST_API_BASE_URL || `http://127.0.0.1:${process.env.PORT || 4003}/api`
const ADMIN_EMAIL = process.env.TEST_LOGIN_EMAIL || 'admin@local'
const ADMIN_PASSWORD = process.env.TEST_LOGIN_PASSWORD || 'admin123'
const ROOT_EMAIL = process.env.DEFAULT_ROOT_EMAIL || 'root@local'
const ROOT_PASSWORD = process.env.DEFAULT_ROOT_PASSWORD || 'root123'
const JWT_SECRET = process.env.JWT_SECRET || 'devsecret'

function uniqueId() {
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`
}

async function login(email, password) {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  const text = await response.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }

  return { status: response.status, body }
}

async function openDb() {
  return mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'dtmpos',
  })
}

async function apiRequest({ token, pathName, method = 'GET', body }) {
  const response = await fetch(`${API_BASE_URL}${pathName}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await response.text()
  let payload = null
  try {
    payload = JSON.parse(text)
  } catch {
    payload = text
  }
  return { status: response.status, body: payload }
}

async function cleanupSpecialUserByEmail(email) {
  const conn = await openDb()
  try {
    const [rows] = await conn.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email])
    const userId = Number(rows?.[0]?.id || 0)
    if (!userId) return
    await conn.query('DELETE FROM user_permission_grants WHERE user_id = ?', [userId])
    await conn.query('DELETE FROM users WHERE id = ?', [userId])
  } finally {
    await conn.end()
  }
}

test('el usuario root existe y solo carga permisos del modulo core', async () => {
  const result = await login(ROOT_EMAIL, ROOT_PASSWORD)
  assert.equal(result.status, 200)
  assert.equal(result.body?.user?.role, 'ROOT')
  assert.ok(Array.isArray(result.body?.user?.permissions))
  assert.ok(result.body.user.permissions.includes('root:access'))
  assert.ok(result.body.user.permissions.includes('root:core:store'))
  assert.ok(result.body.user.permissions.includes('root:core:product-types'))
  assert.ok(result.body.user.permissions.includes('root:core:permissions'))
  assert.ok(!result.body.user.permissions.includes('users:write'))
  assert.ok(!result.body.user.permissions.includes('config:write'))
})

test('un administrador estándar no puede entrar por ruta directa al módulo root', async () => {
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  assert.equal(admin.status, 200)

  const result = await apiRequest({
    token: admin.body.token,
    pathName: '/root-core/state',
  })

  assert.equal(result.status, 403)
})

test('un token manipulado con rol root no supera la validación multicapa del backend', async () => {
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  assert.equal(admin.status, 200)

  const forgedToken = jwt.sign({
    id: admin.body.user.id,
    role: 'ROOT',
    name: admin.body.user.name,
    permissions: ['root:access', 'root:core:store', 'root:core:product-types', 'root:core:permissions', 'root:audit:read'],
  }, JWT_SECRET, { expiresIn: '5m' })

  const result = await apiRequest({
    token: forgedToken,
    pathName: '/root-core/state',
  })

  assert.equal(result.status, 403)
})

test('root puede cambiar flags core y cada cambio queda auditado', async () => {
  const root = await login(ROOT_EMAIL, ROOT_PASSWORD)
  assert.equal(root.status, 200)

  const initialState = await apiRequest({ token: root.body.token, pathName: '/root-core/state' })
  assert.equal(initialState.status, 200)

  const originalStoreEnabled = Boolean(initialState.body.systemFlags.storeEnabled)
  const originalProductTypes = initialState.body.systemFlags.enabledProductTypes

  try {
    const toggleStore = await apiRequest({
      token: root.body.token,
      pathName: '/root-core/store-enabled',
      method: 'PUT',
      body: { enabled: !originalStoreEnabled },
    })
    assert.equal(toggleStore.status, 200)

    const toggleTypes = await apiRequest({
      token: root.body.token,
      pathName: '/root-core/product-types',
      method: 'PUT',
      body: { enabledProductTypes: ['GENERAL', 'IMEI'] },
    })
    assert.equal(toggleTypes.status, 200)

    const audit = await apiRequest({
      token: root.body.token,
      pathName: '/root-core/audit?limit=20',
    })
    assert.equal(audit.status, 200)
    assert.ok(audit.body.some(item => item.actionCode === 'root.store_enabled.update'))
    assert.ok(audit.body.some(item => item.actionCode === 'root.product_types.update'))
  } finally {
    await apiRequest({
      token: root.body.token,
      pathName: '/root-core/store-enabled',
      method: 'PUT',
      body: { enabled: originalStoreEnabled },
    })
    await apiRequest({
      token: root.body.token,
      pathName: '/root-core/product-types',
      method: 'PUT',
      body: { enabledProductTypes: originalProductTypes },
    })
  }
})

test('root puede crear un superusuario granular y el sistema bloquea lo no autorizado', async () => {
  const root = await login(ROOT_EMAIL, ROOT_PASSWORD)
  assert.equal(root.status, 200)

  const runId = uniqueId()
  const email = `super.root.${runId}@local`

  try {
    const created = await apiRequest({
      token: root.body.token,
      pathName: '/root-core/users',
      method: 'POST',
      body: {
        name: `SUPERUSER ${runId}`,
        email,
        password: 'super123',
      },
    })
    assert.equal(created.status, 200)
    assert.equal(created.body.roleCode, 'SUPERUSUARIO')

    const grantStoreOnly = await apiRequest({
      token: root.body.token,
      pathName: `/root-core/users/${created.body.id}/permissions`,
      method: 'PUT',
      body: {
        permissions: ['root:core:store'],
      },
    })
    assert.equal(grantStoreOnly.status, 200)
    assert.ok(grantStoreOnly.body.permissions.includes('root:access'))
    assert.ok(grantStoreOnly.body.permissions.includes('root:core:store'))
    assert.ok(!grantStoreOnly.body.permissions.includes('root:core:product-types'))

    const superuser = await login(email, 'super123')
    assert.equal(superuser.status, 200)

    const state = await apiRequest({
      token: superuser.body.token,
      pathName: '/root-core/state',
    })
    assert.equal(state.status, 200)

    const initialState = await apiRequest({ token: root.body.token, pathName: '/root-core/state' })
    const originalStoreEnabled = Boolean(initialState.body.systemFlags.storeEnabled)

    try {
      const storeToggle = await apiRequest({
        token: superuser.body.token,
        pathName: '/root-core/store-enabled',
        method: 'PUT',
        body: { enabled: !originalStoreEnabled },
      })
      assert.equal(storeToggle.status, 200)

      const productTypesDenied = await apiRequest({
        token: superuser.body.token,
        pathName: '/root-core/product-types',
        method: 'PUT',
        body: { enabledProductTypes: ['GENERAL', 'SERIAL'] },
      })
      assert.equal(productTypesDenied.status, 403)
    } finally {
      await apiRequest({
        token: root.body.token,
        pathName: '/root-core/store-enabled',
        method: 'PUT',
        body: { enabled: originalStoreEnabled },
      })
    }
  } finally {
    await cleanupSpecialUserByEmail(email)
  }
})

test('roles y usuarios root quedan ocultos de las rutas administrativas normales y token inválido se rechaza', async () => {
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD)
  assert.equal(admin.status, 200)

  const roles = await apiRequest({ token: admin.body.token, pathName: '/roles' })
  assert.equal(roles.status, 200)
  assert.ok(!roles.body.some(role => String(role.code || '').toUpperCase() === 'ROOT'))
  assert.ok(!roles.body.some(role => String(role.code || '').toUpperCase() === 'SUPERUSUARIO'))

  const users = await apiRequest({ token: admin.body.token, pathName: '/users' })
  assert.equal(users.status, 200)
  assert.ok(!users.body.some(user => String(user.email || '').toLowerCase() === String(ROOT_EMAIL).toLowerCase()))

  const invalidToken = await apiRequest({ token: 'token-totalmente-invalido', pathName: '/root-core/state' })
  assert.equal(invalidToken.status, 401)
})
