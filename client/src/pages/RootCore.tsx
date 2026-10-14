import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'

const PRODUCT_TYPE_OPTIONS = [
  { value: 'GENERAL', label: 'General', description: 'Catálogo base sin trazabilidad especial.' },
  { value: 'MEDICINAL', label: 'Lotes y vencimiento', description: 'Productos con lote o fecha de vencimiento.' },
  { value: 'IMEI', label: 'IMEI', description: 'Equipos con IMEI único.' },
  { value: 'SERIAL', label: 'Serie', description: 'Productos con número de serie único.' },
  { value: 'VARIANT_SERIALIZED', label: 'IMEI-SERIAL VARIANTE', description: 'Producto maestro con variantes y unidades por IMEI o serie.' },
] as const

type RootPermission = {
  code: string
  description: string
}

type SpecialUser = {
  id: number
  name: string
  email: string
  active: boolean
  roleCode: string
  roleName: string
  permissions: string[]
}

type AuditLogItem = {
  id: number
  actorUserId: number
  actorRoleCode: string
  actionCode: string
  resourceType: string
  resourceId?: string | null
  requestIp?: string | null
  beforeState?: any
  afterState?: any
  metadata?: any
  createdAt: string
}

type RootStateResponse = {
  currentUser: {
    id: number
    name: string
    email: string
    role: string
    permissions: string[]
  }
  capabilities: {
    canManageStore: boolean
    canManageProductTypes: boolean
    canManageSuperusers: boolean
    canReadAudit: boolean
  }
  systemFlags: {
    storeEnabled: boolean
    enabledProductTypes: string[]
  }
  availablePermissions: RootPermission[]
  mutablePermissions: string[]
  specialUsers: SpecialUser[]
  auditLogs: AuditLogItem[]
}

type RootTab = 'core' | 'audit'

function cardStyle(background = 'var(--modal)') {
  return {
    background,
    border: '1px solid var(--border)',
    borderRadius: 18,
    padding: 18,
    display: 'grid',
    gap: 14,
  } as const
}

export default function RootCore() {
  const [loading, setLoading] = useState(true)
  const [savingStore, setSavingStore] = useState(false)
  const [savingTypes, setSavingTypes] = useState(false)
  const [savingUser, setSavingUser] = useState(false)
  const [savingPermissionsForUserId, setSavingPermissionsForUserId] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<RootStateResponse | null>(null)
  const [storeEnabled, setStoreEnabled] = useState(true)
  const [enabledProductTypes, setEnabledProductTypes] = useState<string[]>(['GENERAL'])
  const [newSuperuser, setNewSuperuser] = useState({ name: '', email: '', password: '' })
  const [userEditor, setUserEditor] = useState<Record<number, { name: string; email: string; password: string; active: boolean }>>({})
  const [permissionDrafts, setPermissionDrafts] = useState<Record<number, string[]>>({})
  const [activeTab, setActiveTab] = useState<RootTab>('core')

  async function loadState() {
    try {
      setLoading(true)
      setError(null)
      const { data } = await api.get('/root-core/state')
      const payload = data as RootStateResponse
      setState(payload)
      setStoreEnabled(Boolean(payload.systemFlags?.storeEnabled))
      setEnabledProductTypes(Array.isArray(payload.systemFlags?.enabledProductTypes) && payload.systemFlags.enabledProductTypes.length > 0 ? payload.systemFlags.enabledProductTypes : ['GENERAL'])
      setUserEditor(Object.fromEntries((payload.specialUsers || []).map(user => [user.id, {
        name: user.name,
        email: user.email,
        password: '',
        active: user.active,
      }])))
      setPermissionDrafts(Object.fromEntries((payload.specialUsers || []).map(user => [user.id, user.permissions.filter(permission => payload.mutablePermissions.includes(permission))])))
    } catch (err: any) {
      setError(err?.response?.data?.error || 'No se pudo cargar el módulo root')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadState()
  }, [])

  const mutablePermissionOptions = useMemo(() => {
    const available = new Map((state?.availablePermissions || []).map(permission => [permission.code, permission]))
    return (state?.mutablePermissions || []).map(code => available.get(code)).filter(Boolean) as RootPermission[]
  }, [state?.availablePermissions, state?.mutablePermissions])

  const rootUsers = useMemo(() => (state?.specialUsers || []).filter(user => user.roleCode === 'ROOT'), [state?.specialUsers])
  const superusers = useMemo(() => (state?.specialUsers || []).filter(user => user.roleCode === 'SUPERUSUARIO'), [state?.specialUsers])
  const canReadAudit = Boolean(state?.capabilities.canReadAudit)

  const setFlash = (nextMessage: string | null, nextError: string | null = null) => {
    setMessage(nextMessage)
    setError(nextError)
  }

  const toggleProductType = (productType: string) => {
    const normalized = String(productType || '').trim().toUpperCase()
    setEnabledProductTypes(prev => {
      if (normalized === 'GENERAL') return prev.includes('GENERAL') ? prev : ['GENERAL', ...prev]
      return prev.includes(normalized)
        ? prev.filter(item => item !== normalized)
        : [...prev, normalized]
    })
  }

  const toggleUserPermission = (userId: number, permissionCode: string) => {
    setPermissionDrafts(prev => {
      const current = Array.isArray(prev[userId]) ? prev[userId] : []
      return {
        ...prev,
        [userId]: current.includes(permissionCode)
          ? current.filter(item => item !== permissionCode)
          : [...current, permissionCode],
      }
    })
  }

  const saveStoreState = async () => {
    try {
      setSavingStore(true)
      setFlash(null)
      await api.put('/root-core/store-enabled', { enabled: storeEnabled })
      await loadState()
      setFlash('Estado de tienda actualizado correctamente.')
    } catch (err: any) {
      setFlash(null, err?.response?.data?.error || 'No se pudo actualizar el estado de la tienda')
    } finally {
      setSavingStore(false)
    }
  }

  const saveProductTypes = async () => {
    try {
      setSavingTypes(true)
      setFlash(null)
      await api.put('/root-core/product-types', { enabledProductTypes })
      await loadState()
      setFlash('Tipos de producto core actualizados correctamente.')
    } catch (err: any) {
      setFlash(null, err?.response?.data?.error || 'No se pudieron actualizar los tipos de producto')
    } finally {
      setSavingTypes(false)
    }
  }

  const createSuperuser = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      setSavingUser(true)
      setFlash(null)
      await api.post('/root-core/users', newSuperuser)
      setNewSuperuser({ name: '', email: '', password: '' })
      await loadState()
      setFlash('Superusuario creado correctamente.')
    } catch (err: any) {
      setFlash(null, err?.response?.data?.error || 'No se pudo crear el superusuario')
    } finally {
      setSavingUser(false)
    }
  }

  const saveSpecialUser = async (userId: number) => {
    try {
      setSavingPermissionsForUserId(userId)
      setFlash(null)
      const payload = userEditor[userId]
      await api.put(`/root-core/users/${userId}`, payload)
      await loadState()
      setFlash('Usuario especial actualizado correctamente.')
    } catch (err: any) {
      setFlash(null, err?.response?.data?.error || 'No se pudo actualizar el usuario especial')
    } finally {
      setSavingPermissionsForUserId(null)
    }
  }

  const saveUserPermissions = async (userId: number) => {
    try {
      setSavingPermissionsForUserId(userId)
      setFlash(null)
      await api.put(`/root-core/users/${userId}/permissions`, {
        permissions: permissionDrafts[userId] || [],
      })
      await loadState()
      setFlash('Permisos root del superusuario actualizados correctamente.')
    } catch (err: any) {
      setFlash(null, err?.response?.data?.error || 'No se pudieron actualizar los permisos del superusuario')
    } finally {
      setSavingPermissionsForUserId(null)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={cardStyle('linear-gradient(180deg, var(--modal), var(--card))')}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28 }}>Módulo Root Core</h1>
          <div style={{ color: 'var(--muted)', marginTop: 6 }}>
            Sección aislada para habilitar funciones core del sistema y administrar superusuarios con auditoría inmutable.
          </div>
        </div>
        {state?.currentUser && (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            Sesión: <strong>{state.currentUser.name}</strong> ({state.currentUser.role}) | Permisos root: {state.currentUser.permissions.join(', ')}
          </div>
        )}
      </div>

      {loading && <div style={cardStyle()}>Cargando módulo root...</div>}
      {error && <div style={{ ...cardStyle('rgba(239,68,68,0.08)'), color: '#991b1b' }}>{error}</div>}
      {message && <div style={{ ...cardStyle('rgba(34,197,94,0.08)'), color: '#166534' }}>{message}</div>}

      {state && (
        <>
          <section style={cardStyle('linear-gradient(180deg, var(--card), var(--modal))')}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <button
                type="button"
                className={activeTab === 'core' ? 'primary-btn' : 'secondary-btn'}
                onClick={() => setActiveTab('core')}
              >
                Root Core
              </button>
              {canReadAudit && (
                <button
                  type="button"
                  className={activeTab === 'audit' ? 'primary-btn' : 'secondary-btn'}
                  onClick={() => setActiveTab('audit')}
                >
                  Auditoría
                </button>
              )}
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              {activeTab === 'core'
                ? 'Vista operativa del módulo root para habilitaciones core y administración de superusuarios.'
                : 'Vista exclusiva para consultar la auditoría inmutable del módulo root.'}
            </div>
          </section>

          {activeTab === 'core' && (
            <>
              <section style={cardStyle()}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 18 }}>Encendido global de tienda</div>
                  <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                    Este control no aparece en la configuración general y solo se carga para operadores root.
                  </div>
                </div>
                <label style={{ ...cardStyle('var(--bg)'), cursor: state.capabilities.canManageStore ? 'pointer' : 'default' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>Tienda en línea activa</div>
                      <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                        Controla el switch maestro que habilita o deshabilita la tienda pública completa.
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={storeEnabled}
                      disabled={!state.capabilities.canManageStore || savingStore}
                      onChange={(event) => setStoreEnabled(event.target.checked)}
                    />
                  </div>
                </label>
                {state.capabilities.canManageStore && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="button" className="primary-btn" onClick={saveStoreState} disabled={savingStore}>
                      {savingStore ? 'Guardando...' : 'Guardar estado de tienda'}
                    </button>
                  </div>
                )}
              </section>

              <section style={cardStyle()}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 18 }}>Tipos de producto core</div>
                  <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                    Control exclusivo del selector maestro de tipos habilitados para creación de productos.
                  </div>
                </div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {PRODUCT_TYPE_OPTIONS.map(option => {
                    const checked = enabledProductTypes.includes(option.value)
                    const locked = option.value === 'GENERAL'
                    return (
                      <label key={option.value} style={{ ...cardStyle('var(--bg)'), padding: 14, cursor: locked || !state.capabilities.canManageProductTypes ? 'default' : 'pointer' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 10, alignItems: 'start' }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={locked || !state.capabilities.canManageProductTypes || savingTypes}
                            onChange={() => toggleProductType(option.value)}
                            style={{ marginTop: 2 }}
                          />
                          <div>
                            <div style={{ fontWeight: 700 }}>{option.label}</div>
                            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{option.description}</div>
                            {locked && <div style={{ fontSize: 12, color: '#1d4ed8', marginTop: 4 }}>General siempre permanece activo.</div>}
                          </div>
                        </div>
                      </label>
                    )
                  })}
                </div>
                {state.capabilities.canManageProductTypes && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="button" className="primary-btn" onClick={saveProductTypes} disabled={savingTypes}>
                      {savingTypes ? 'Guardando...' : 'Guardar tipos habilitados'}
                    </button>
                  </div>
                )}
              </section>

              {state.capabilities.canManageSuperusers && (
                <section style={cardStyle()}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 18 }}>Crear superusuario</div>
                    <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                      Los superusuarios creados aquí solo reciben acceso root aislado y nunca permisos administrativos globales.
                    </div>
                  </div>
                  <form onSubmit={createSuperuser} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                    <input placeholder="Nombre" value={newSuperuser.name} onChange={event => setNewSuperuser(prev => ({ ...prev, name: event.target.value }))} required />
                    <input placeholder="Email" type="email" value={newSuperuser.email} onChange={event => setNewSuperuser(prev => ({ ...prev, email: event.target.value }))} required />
                    <input placeholder="Contraseña" type="password" value={newSuperuser.password} onChange={event => setNewSuperuser(prev => ({ ...prev, password: event.target.value }))} required />
                    <button type="submit" className="primary-btn" disabled={savingUser}>{savingUser ? 'Creando...' : 'Crear superusuario'}</button>
                  </form>
                </section>
              )}

              <section style={cardStyle()}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 18 }}>Usuarios especiales</div>
                  <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                    El usuario root base se crea automáticamente. Los superusuarios pueden recibir permisos root específicos de forma granular.
                  </div>
                </div>

                <div style={{ display: 'grid', gap: 14 }}>
                  {rootUsers.map(user => (
                    <div key={user.id} style={cardStyle('var(--bg)')}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        <div>
                          <div style={{ fontWeight: 700 }}>{user.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{user.email} | {user.roleName}</div>
                        </div>
                        <span style={{ fontSize: 12, padding: '6px 10px', borderRadius: 999, background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.2)', color: '#1d4ed8', fontWeight: 700 }}>
                          ROOT BASE
                        </span>
                      </div>
                      <div style={{ fontSize: 13 }}>
                        Permisos efectivos: {user.permissions.join(', ')}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                        <input value={userEditor[user.id]?.name || ''} onChange={event => setUserEditor(prev => ({ ...prev, [user.id]: { ...prev[user.id], name: event.target.value } }))} disabled={!state.capabilities.canManageSuperusers || savingPermissionsForUserId === user.id} />
                        <input value={userEditor[user.id]?.email || ''} onChange={event => setUserEditor(prev => ({ ...prev, [user.id]: { ...prev[user.id], email: event.target.value } }))} disabled={!state.capabilities.canManageSuperusers || savingPermissionsForUserId === user.id} />
                        <input type="password" placeholder="Nueva contraseña opcional" value={userEditor[user.id]?.password || ''} onChange={event => setUserEditor(prev => ({ ...prev, [user.id]: { ...prev[user.id], password: event.target.value } }))} disabled={!state.capabilities.canManageSuperusers || savingPermissionsForUserId === user.id} />
                      </div>
                      {state.capabilities.canManageSuperusers && (
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <button type="button" className="secondary-btn" onClick={() => saveSpecialUser(user.id)} disabled={savingPermissionsForUserId === user.id}>
                            {savingPermissionsForUserId === user.id ? 'Guardando...' : 'Guardar root base'}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}

                  {superusers.map(user => (
                    <div key={user.id} style={cardStyle('var(--bg)')}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        <div>
                          <div style={{ fontWeight: 700 }}>{user.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{user.email} | {user.roleName}</div>
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                          <input
                            type="checkbox"
                            checked={Boolean(userEditor[user.id]?.active)}
                            disabled={!state.capabilities.canManageSuperusers || savingPermissionsForUserId === user.id}
                            onChange={event => setUserEditor(prev => ({ ...prev, [user.id]: { ...prev[user.id], active: event.target.checked } }))}
                          />
                          Activo
                        </label>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                        <input value={userEditor[user.id]?.name || ''} onChange={event => setUserEditor(prev => ({ ...prev, [user.id]: { ...prev[user.id], name: event.target.value } }))} disabled={!state.capabilities.canManageSuperusers || savingPermissionsForUserId === user.id} />
                        <input value={userEditor[user.id]?.email || ''} onChange={event => setUserEditor(prev => ({ ...prev, [user.id]: { ...prev[user.id], email: event.target.value } }))} disabled={!state.capabilities.canManageSuperusers || savingPermissionsForUserId === user.id} />
                        <input type="password" placeholder="Nueva contraseña opcional" value={userEditor[user.id]?.password || ''} onChange={event => setUserEditor(prev => ({ ...prev, [user.id]: { ...prev[user.id], password: event.target.value } }))} disabled={!state.capabilities.canManageSuperusers || savingPermissionsForUserId === user.id} />
                      </div>

                      <div style={{ display: 'grid', gap: 10 }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>Permisos root del superusuario</div>
                        {mutablePermissionOptions.map(permission => (
                          <label key={`${user.id}-${permission.code}`} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 10, alignItems: 'start' }}>
                            <input
                              type="checkbox"
                              checked={(permissionDrafts[user.id] || []).includes(permission.code)}
                              disabled={!state.capabilities.canManageSuperusers || savingPermissionsForUserId === user.id}
                              onChange={() => toggleUserPermission(user.id, permission.code)}
                              style={{ marginTop: 2 }}
                            />
                            <div>
                              <div style={{ fontWeight: 600 }}>{permission.code}</div>
                              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{permission.description}</div>
                            </div>
                          </label>
                        ))}
                      </div>

                      {state.capabilities.canManageSuperusers && (
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                          <button type="button" className="secondary-btn" onClick={() => saveSpecialUser(user.id)} disabled={savingPermissionsForUserId === user.id}>
                            {savingPermissionsForUserId === user.id ? 'Guardando...' : 'Guardar perfil'}
                          </button>
                          <button type="button" className="primary-btn" onClick={() => saveUserPermissions(user.id)} disabled={savingPermissionsForUserId === user.id}>
                            {savingPermissionsForUserId === user.id ? 'Guardando...' : 'Guardar permisos root'}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}

                  {state.specialUsers.length === 0 && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                        No hay usuarios especiales cargados todavía.
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </>
          )}

          {activeTab === 'audit' && state.capabilities.canReadAudit && (
            <section style={cardStyle()}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>Auditoría inmutable root</div>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                  Estos registros se almacenan como solo inserción y el backend bloquea cualquier update o delete.
                </div>
              </div>

              <div style={{ display: 'grid', gap: 10 }}>
                {state.auditLogs.map(log => (
                  <div key={log.id} style={cardStyle('var(--bg)')}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 700 }}>{log.actionCode}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{new Date(log.createdAt).toLocaleString()}</div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      Usuario #{log.actorUserId} ({log.actorRoleCode}) | IP: {log.requestIp || 'N/D'} | Recurso: {log.resourceType}{log.resourceId ? ` #${log.resourceId}` : ''}
                    </div>
                    {(log.beforeState || log.afterState || log.metadata) && (
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 12, padding: 12 }}>
                        {JSON.stringify({
                          before: log.beforeState,
                          after: log.afterState,
                          metadata: log.metadata,
                        }, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
                {state.auditLogs.length === 0 && (
                  <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                    Aún no hay acciones registradas en la auditoría root.
                  </div>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
