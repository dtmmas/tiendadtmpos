import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { getWarehouseHighlightStyle } from '../utils/warehouseHighlight'

interface Warehouse { id: number; name: string }
interface Shelf { id: number; name: string; warehouseId?: number | null; warehouseIds?: number[] }

export default function Shelves() {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [shelves, setShelves] = useState<Shelf[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [isMobileViewport, setIsMobileViewport] = useState(false)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [section, setSection] = useState<'almacenes' | 'estantes'>('almacenes')
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})

  // create/edit state
  const [showCreate, setShowCreate] = useState(false)
  const [createMode, setCreateMode] = useState<'warehouse' | 'shelf'>('warehouse')
  const [name, setName] = useState('')
  const [parentWarehouseId, setParentWarehouseId] = useState<number | null>(null)

  const [showEdit, setShowEdit] = useState(false)
  const [editTarget, setEditTarget] = useState<{ type: 'warehouse' | 'shelf'; item: Warehouse | Shelf } | null>(null)
  const [editName, setEditName] = useState('')
  const [editWarehouseId, setEditWarehouseId] = useState<number | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<{ type: 'warehouse' | 'shelf'; item: Warehouse | Shelf } | null>(null)

  const load = async () => {
    const [wData, sData] = await Promise.all([
      api.get('/warehouses'),
      api.get('/shelves')
    ])
    const wSorted = [...wData.data].sort((a: Warehouse, b: Warehouse) => a.name.localeCompare(b.name))
    const sSorted = [...sData.data].sort((a: Shelf, b: Shelf) => a.name.localeCompare(b.name))
    setWarehouses(wSorted)
    setShelves(sSorted)
  }
  useEffect(() => { load() }, [])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)')
    const syncViewport = () => setIsMobileViewport(mediaQuery.matches)
    syncViewport()
    mediaQuery.addEventListener('change', syncViewport)
    return () => mediaQuery.removeEventListener('change', syncViewport)
  }, [])

  const filteredWarehouses = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return warehouses
    return warehouses.filter(w => (w.name || '').toLowerCase().includes(q))
  }, [warehouses, query])

  const filteredShelves = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return shelves
    return shelves.filter(s => {
      const byName = (s.name || '').toLowerCase().includes(q)
      const ids = Array.isArray(s.warehouseIds) && s.warehouseIds.length > 0 ? s.warehouseIds : (s.warehouseId != null ? [s.warehouseId] : [])
      const byWarehouse = ids.some(id => ((warehouses.find(w => w.id === id)?.name || '').toLowerCase()).includes(q))
      return byName || byWarehouse
    })
  }, [shelves, warehouses, query])

  const childrenByWarehouse = useMemo(() => {
    const map: Record<number, Shelf[]> = {}
    for (const s of shelves) {
      const ids = Array.isArray(s.warehouseIds) && s.warehouseIds.length > 0 ? s.warehouseIds : (s.warehouseId != null ? [s.warehouseId] : [])
      for (const wid of ids) {
        if (!map[wid]) map[wid] = []
        map[wid].push(s)
      }
    }
    return map
  }, [shelves])

  const toggleExpand = (id: number) => setExpanded(prev => ({ ...prev, [id]: !prev[id] }))

  const startCreateShelf = (warehouseId?: number) => { setCreateMode('shelf'); setName(''); setParentWarehouseId(warehouseId ?? null); setShowCreate(true) }
  const cancelCreate = () => { setShowCreate(false); setName(''); setParentWarehouseId(null) }
  const saveCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setLoading(true)
    try {
      if (!parentWarehouseId) { alert('Selecciona un almacén padre'); return }
      if (shelves.some(x => (x.name || '').toLowerCase() === trimmed.toLowerCase() && x.warehouseId === parentWarehouseId)) {
        alert('Ya existe un estante con ese nombre en este almacén')
        return
      }
      await api.post('/shelves', { name: trimmed, warehouseId: parentWarehouseId })
      
      setShowCreate(false)
      setName('')
      setParentWarehouseId(null)
      await load()
      alert('Estante creado correctamente')
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'No se pudo guardar.'
      alert(msg)
    } finally {
      setLoading(false)
    }
  }

  const startEditShelf = (s: Shelf) => { setEditTarget({ type: 'shelf', item: s }); setEditName(s.name); setEditWarehouseId(s.warehouseId ?? (s.warehouseIds && s.warehouseIds.length > 0 ? s.warehouseIds[0] : null)); setShowEdit(true) }
  const cancelEdit = () => { setShowEdit(false); setEditTarget(null); setEditName(''); setEditWarehouseId(null) }
  const saveEdit = async () => {
    if (!editTarget) return
    const trimmed = editName.trim()
    if (!trimmed) return
    setLoading(true)
    try {
      const s = editTarget.item as Shelf
      const wid = editWarehouseId ?? null
      if (!wid) { alert('Selecciona un almacén padre'); return }
      if (shelves.some(x => x.id !== s.id && (x.name || '').toLowerCase() === trimmed.toLowerCase() && x.warehouseId === wid)) {
        alert('Ya existe un estante con ese nombre en este almacén')
        return
      }
      await api.put(`/shelves/${s.id}`, { name: trimmed, warehouseId: wid })
      
      setShowEdit(false)
      setEditTarget(null)
      setEditName('')
      setEditWarehouseId(null)
      await load()
      alert('Actualizado correctamente')
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'No se pudo actualizar.'
      alert(msg)
    } finally {
      setLoading(false)
    }
  }

  // Vincular estante existente a un almacén
  const [showLinkExisting, setShowLinkExisting] = useState(false)
  const [linkWarehouseId, setLinkWarehouseId] = useState<number | null>(null)
  const [selectedExistingShelfId, setSelectedExistingShelfId] = useState<number | null>(null)
  const startLinkExisting = (warehouseId: number) => {
    setLinkWarehouseId(warehouseId)
    setSelectedExistingShelfId(null)
    setShowLinkExisting(true)
  }
  const cancelLinkExisting = () => { setShowLinkExisting(false); setLinkWarehouseId(null); setSelectedExistingShelfId(null) }
  const saveLinkExisting = async () => {
    if (!linkWarehouseId || !selectedExistingShelfId) return
    setLoading(true)
    try {
      // Vincular sin cambiar asignaciones existentes (muchos-a-muchos)
      await api.post(`/shelves/${selectedExistingShelfId}/assign`, { warehouseId: linkWarehouseId })
      setShowLinkExisting(false)
      setLinkWarehouseId(null)
      setSelectedExistingShelfId(null)
      await load()
      alert('Estante vinculado al almacén correctamente')
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'No se pudo vincular.'
      alert(msg)
    } finally {
      setLoading(false)
    }
  }

  const removeShelf = (id: number) => {
    const target = shelves.find(s => s.id === id) || null
    if (target) setDeleteTarget({ type: 'shelf', item: target })
  }
  const confirmDelete = async () => {
    if (!deleteTarget) return
    setLoading(true)
    try {
      if (deleteTarget.type === 'warehouse') {
        // Not implemented anymore
      } else {
        const s = deleteTarget.item as Shelf
        await api.delete(`/shelves/${s.id}`)
      }
      await load()
      setDeleteTarget(null)
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'No se pudo eliminar.'
      alert(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: isMobileViewport ? 14 : 20 }}>
      <div style={{ display: 'flex', alignItems: isMobileViewport ? 'stretch' : 'center', justifyContent: 'space-between', flexDirection: isMobileViewport ? 'column' : 'row', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Ubicaciones / Estantes</h2>
        <div style={{ display: 'flex', alignItems: isMobileViewport ? 'stretch' : 'center', gap: 8, flexWrap: 'wrap', flexDirection: isMobileViewport ? 'column' : 'row', width: isMobileViewport ? '100%' : 'auto' }}>
          <input placeholder="Buscar..." value={query} onChange={e => setQuery(e.target.value)} style={{ width: isMobileViewport ? '100%' : 280 }} />
          
          <button className="primary-btn" onClick={() => startCreateShelf()} style={{ width: isMobileViewport ? '100%' : 'auto' }}>Nuevo estante</button>
          
          <div className="view-toggle">
            <button
              className={`toggle-btn ${view === 'grid' ? 'active' : ''}`}
              onClick={() => setView('grid')}
              aria-label="Vista grid"
              title="Vista grid"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z" />
              </svg>
            </button>
            <button
              className={`toggle-btn ${view === 'list' ? 'active' : ''}`}
              onClick={() => setView('list')}
              aria-label="Vista lista"
              title="Vista lista"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z" />
              </svg>
            </button>
          </div>
          <div className="view-toggle">
            <button className={`toggle-btn ${section === 'almacenes' ? 'active' : ''}`} onClick={() => setSection('almacenes')}>Almacenes</button>
            <button className={`toggle-btn ${section === 'estantes' ? 'active' : ''}`} onClick={() => setSection('estantes')}>Estantes</button>
          </div>
        </div>
      </div>

      {view === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: isMobileViewport ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
          {(section === 'almacenes' ? filteredWarehouses : filteredShelves).map(item => (
            <div key={(item as any).id} style={{ background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {section === 'almacenes' ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontWeight: 600 }}>{(item as Warehouse).name}</span>
                    <span style={{ fontSize: 11, padding: '2px 6px', border: '1px solid var(--border)', borderRadius: 10, opacity: 0.8 }}>Almacén</span>
                  </div>
                  <button className="small-btn" onClick={() => toggleExpand((item as Warehouse).id)}>{expanded[(item as Warehouse).id] ? 'Contraer estantes' : 'Mostrar estantes'}</button>
                  {expanded[(item as Warehouse).id] && (
                    <ul style={{ marginTop: 8, paddingLeft: 18 }}>
                      {(childrenByWarehouse[(item as Warehouse).id] || []).length === 0 ? (
                        <li style={{ opacity: 0.8 }}>Sin estantes</li>
                      ) : (
                        childrenByWarehouse[(item as Warehouse).id].map(sc => (
                          <li key={sc.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span>{sc.name}</span>
                            <span style={{ fontSize: 11, padding: '2px 6px', border: '1px solid var(--border)', borderRadius: 10, opacity: 0.8 }}>Estante</span>
                            <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                              <button className="icon-btn primary" title="Editar" aria-label="Editar" onClick={() => startEditShelf(sc)}>
                                <svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 17.25V21h3.75L17.81 9.94a1 1 0 0 0 0-1.41l-3.34-3.34a1 1 0 0 0-1.41 0L3 16.59z" fill="currentColor"/></svg>
                              </button>
                              <button className="icon-btn danger" title="Eliminar" aria-label="Eliminar" onClick={() => removeShelf(sc.id)}>
                                <svg viewBox="0 0 24 24" width="16" height="16">
                                  <path d="M3 6h18" stroke="currentColor" strokeWidth="2"/>
                                  <path d="M8 6V4h8v2" stroke="currentColor" strokeWidth="2"/>
                                  <path d="M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2"/>
                                  <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2"/>
                                </svg>
                              </button>
                            </div>
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                  <div style={{ display: 'flex', gap: 10, marginTop: 'auto', alignItems: 'center', flexWrap: 'wrap' }}>
                  
                  {/* Read-only view of warehouse */}
                  <div style={{ flex: 1 }}></div>
                </div>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontWeight: 600 }}>{(item as Shelf).name}</span>
                    <span style={{ fontSize: 11, padding: '2px 6px', border: '1px solid var(--border)', borderRadius: 10, opacity: 0.8 }}>Estante</span>
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: 13 }}>Almacén: <span className="warehouse-highlight" style={getWarehouseHighlightStyle((() => {
                    const wid = (item as Shelf).warehouseId ?? null
                    return wid ? (warehouses.find(w => w.id === wid)?.name || '—') : '—'
                  })())}>{(() => {
                    const wid = (item as Shelf).warehouseId ?? null
                    return wid ? (warehouses.find(w => w.id === wid)?.name || '—') : '—'
                  })()}</span></div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 'auto', alignItems: 'center' }}>
                    <button className="icon-btn primary" title="Editar" aria-label="Editar" onClick={() => startEditShelf(item as Shelf)}>
                      <svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 17.25V21h3.75L17.81 9.94a1 1 0 0 0 0-1.41l-3.34-3.34a1 1 0 0 0-1.41 0L3 16.59z" fill="currentColor"/></svg>
                    </button>
                    <button className="icon-btn danger" title="Eliminar" aria-label="Eliminar" onClick={() => removeShelf((item as Shelf).id)}>
                      <svg viewBox="0 0 24 24" width="18" height="18">
                        <path d="M3 6h18" stroke="currentColor" strokeWidth="2"/>
                        <path d="M8 6V4h8v2" stroke="currentColor" strokeWidth="2"/>
                        <path d="M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2"/>
                        <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2"/>
                      </svg>
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        isMobileViewport ? (
        <div style={{ display: 'grid', gap: 12 }}>
          {(section === 'almacenes' ? filteredWarehouses : filteredShelves).map(item => (
            <div key={(item as any).id} style={{ background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 12, padding: 14, display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{(item as any).name}</div>
                  {section === 'estantes' && (
                    <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>
                      Almacén: <span className="warehouse-highlight" style={getWarehouseHighlightStyle((() => {
                        const shelf = item as Shelf
                        const ids = Array.isArray(shelf.warehouseIds) && shelf.warehouseIds.length > 0 ? shelf.warehouseIds : (shelf.warehouseId != null ? [shelf.warehouseId] : [])
                        return ids.length ? (warehouses.find(w => w.id === ids[0])?.name || '—') : '—'
                      })())}>{(() => {
                        const shelf = item as Shelf
                        const ids = Array.isArray(shelf.warehouseIds) && shelf.warehouseIds.length > 0 ? shelf.warehouseIds : (shelf.warehouseId != null ? [shelf.warehouseId] : [])
                        if (!ids.length) return '—'
                        const names = ids.map(id => warehouses.find(w => w.id === id)?.name || String(id)).filter(Boolean)
                        return names.join(', ')
                      })()}</span>
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 11, padding: '3px 8px', border: '1px solid var(--border)', borderRadius: 999, opacity: 0.85 }}>
                  {section === 'almacenes' ? 'Almacén' : 'Estante'}
                </span>
              </div>

              {section === 'almacenes' && (
                <>
                  <button className="small-btn" onClick={() => toggleExpand((item as Warehouse).id)} style={{ width: '100%' }}>
                    {expanded[(item as Warehouse).id] ? 'Contraer estantes' : 'Mostrar estantes'}
                  </button>
                  {expanded[(item as Warehouse).id] && (
                    <div style={{ display: 'grid', gap: 8 }}>
                      {(childrenByWarehouse[(item as Warehouse).id] || []).length === 0 ? (
                        <div style={{ opacity: 0.8, fontSize: 13 }}>Sin estantes</div>
                      ) : (
                        childrenByWarehouse[(item as Warehouse).id].map(sc => (
                          <div key={sc.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, background: 'var(--bg)', display: 'grid', gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontWeight: 600 }}>{sc.name}</span>
                              <span style={{ fontSize: 11, padding: '2px 6px', border: '1px solid var(--border)', borderRadius: 10, opacity: 0.8 }}>Estante</span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                              <button className="icon-btn primary" title="Editar" aria-label="Editar" onClick={() => startEditShelf(sc)} style={{ width: '100%', justifyContent: 'center', padding: '0 16px' }}>
                                Editar
                              </button>
                              <button className="icon-btn danger" title="Eliminar" aria-label="Eliminar" onClick={() => removeShelf(sc.id)} style={{ width: '100%', justifyContent: 'center', padding: '0 16px' }}>
                                Eliminar
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}

              {section === 'estantes' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <button className="icon-btn primary" title="Editar" aria-label="Editar" onClick={() => startEditShelf(item as Shelf)} style={{ width: '100%', justifyContent: 'center', padding: '0 16px' }}>
                    Editar
                  </button>
                  <button className="icon-btn danger" title="Eliminar" aria-label="Eliminar" onClick={() => removeShelf((item as Shelf).id)} style={{ width: '100%', justifyContent: 'center', padding: '0 16px' }}>
                    Eliminar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: 'var(--modal)' }}>
              <tr>
                <th style={{ textAlign: 'left', padding: 12, borderBottom: '1px solid var(--border)' }}>Nombre</th>
                {section === 'estantes' && (<th style={{ textAlign: 'left', padding: 12, borderBottom: '1px solid var(--border)' }}>Almacén</th>)}
                <th style={{ textAlign: 'left', padding: 12, borderBottom: '1px solid var(--border)' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {(section === 'almacenes' ? filteredWarehouses : filteredShelves).map(item => (
                <tr key={(item as any).id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 12 }}>{(item as any).name}</td>
                  {section === 'estantes' && (
                    <td style={{ padding: 12 }}>{(() => {
                      const shelf = item as Shelf
                      const ids = Array.isArray(shelf.warehouseIds) && shelf.warehouseIds.length > 0 ? shelf.warehouseIds : (shelf.warehouseId != null ? [shelf.warehouseId] : [])
                      if (!ids.length) return '—'
                      const names = ids.map(id => warehouses.find(w => w.id === id)?.name || String(id)).filter(Boolean)
                      return names.join(', ')
                    })()}</td>
                  )}
                  <td style={{ padding: 12 }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {section === 'almacenes' ? (
                        <>
                          {/* Read-only view */}
                          <button className="icon-btn" title="Agregar estante nuevo" aria-label="Agregar estante nuevo" onClick={() => startCreateShelf((item as Warehouse).id)}>
                            <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2"/></svg>
                          </button>
                        </>
                      ) : (
                        <button className="icon-btn primary" title="Editar" aria-label="Editar" onClick={() => startEditShelf(item as Shelf)}>
                          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 17.25V21h3.75L17.81 9.94a1 1 0 0 0 0-1.41l-3.34-3.34a1 1 0 0 0-1.41 0L3 16.59z" fill="currentColor"/></svg>
                        </button>
                      )}
                      {section === 'almacenes' ? (
                        <div />
                      ) : (
                        <button className="icon-btn danger" title="Eliminar" aria-label="Eliminar" onClick={() => removeShelf((item as Shelf).id)}>
                          <svg viewBox="0 0 24 24" width="18" height="18">
                            <path d="M3 6h18" stroke="currentColor" strokeWidth="2"/>
                            <path d="M8 6V4h8v2" stroke="currentColor" strokeWidth="2"/>
                            <path d="M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2"/>
                            <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2"/>
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )
      )}

      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: isMobileViewport ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobileViewport ? 0 : 16, zIndex: 1000 }}>
          <div style={{ width: isMobileViewport ? '100%' : 460, maxWidth: isMobileViewport ? '100%' : 460, maxHeight: isMobileViewport ? '88vh' : undefined, overflowY: isMobileViewport ? 'auto' : 'visible', background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: isMobileViewport ? '18px 18px 0 0' : 12, padding: 16 }}>
            <h3 style={{ margin: 0, marginBottom: 12 }}>{createMode === 'warehouse' ? 'Nuevo almacén' : 'Nuevo estante'}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4 }}>Nombre</label>
                <input value={name} onChange={e => setName(e.target.value)} style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', padding: '8px 12px', borderRadius: 6, color: 'inherit' }} />
              </div>
              {createMode === 'shelf' && (
                <div>
                  <label style={{ display: 'block', marginBottom: 4 }}>Almacén</label>
                  <select value={parentWarehouseId ?? ''} onChange={e => setParentWarehouseId(e.target.value ? Number(e.target.value) : null)} style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', padding: '8px 12px', borderRadius: 6, color: 'inherit' }}>
                    <option value="">Selecciona un almacén…</option>
                    {warehouses.map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', flexDirection: isMobileViewport ? 'column' : 'row', gap: 8, marginTop: 14 }}>
              <button onClick={cancelCreate} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--border)', color: 'inherit', borderRadius: 6, cursor: 'pointer', width: isMobileViewport ? '100%' : 'auto' }}>Cancelar</button>
              <button className="primary-btn" onClick={saveCreate} style={{ width: isMobileViewport ? '100%' : 'auto' }} disabled={loading}>{loading ? 'Guardando...' : 'Crear'}</button>
            </div>
          </div>
        </div>
      )}

      {showLinkExisting && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: isMobileViewport ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobileViewport ? 0 : 16, zIndex: 1000 }}>
          <div style={{ width: isMobileViewport ? '100%' : 460, maxWidth: isMobileViewport ? '100%' : 460, maxHeight: isMobileViewport ? '88vh' : undefined, overflowY: isMobileViewport ? 'auto' : 'visible', background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: isMobileViewport ? '18px 18px 0 0' : 12, padding: 16 }}>
            <h3 style={{ margin: 0, marginBottom: 12 }}>Vincular estante existente</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
              <div>
                <label>Estante</label>
                <select value={selectedExistingShelfId ?? ''} onChange={e => setSelectedExistingShelfId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Selecciona un estante…</option>
                  {shelves.filter(s => {
                    const ids = Array.isArray(s.warehouseIds) && s.warehouseIds.length > 0 ? s.warehouseIds : (s.warehouseId != null ? [s.warehouseId] : [])
                    return linkWarehouseId ? !ids.some(id => id === linkWarehouseId) : true
                  }).map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Almacén</label>
                <select value={linkWarehouseId ?? ''} onChange={e => setLinkWarehouseId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Selecciona un almacén…</option>
                  {warehouses.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', flexDirection: isMobileViewport ? 'column' : 'row', gap: 8, marginTop: 14 }}>
              <button onClick={cancelLinkExisting} style={{ width: isMobileViewport ? '100%' : 'auto' }}>Cancelar</button>
              <button className="primary-btn" onClick={saveLinkExisting} style={{ width: isMobileViewport ? '100%' : 'auto' }} disabled={loading || !selectedExistingShelfId || !linkWarehouseId}>{loading ? 'Guardando...' : 'Vincular'}</button>
            </div>
          </div>
        </div>
      )}

      {showEdit && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: isMobileViewport ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobileViewport ? 0 : 16, zIndex: 1000 }}>
          <div style={{ width: isMobileViewport ? '100%' : 460, maxWidth: isMobileViewport ? '100%' : 460, maxHeight: isMobileViewport ? '88vh' : undefined, overflowY: isMobileViewport ? 'auto' : 'visible', background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: isMobileViewport ? '18px 18px 0 0' : 12, padding: 16 }}>
            <h3 style={{ margin: 0, marginBottom: 12 }}>{editTarget?.type === 'warehouse' ? 'Editar almacén' : 'Editar estante'}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
              <div>
                <label>Nombre</label>
                <input value={editName} onChange={e => setEditName(e.target.value)} />
              </div>
              {editTarget?.type === 'shelf' && (
                <div>
                  <label>Almacén</label>
                  <select value={editWarehouseId ?? ''} onChange={e => setEditWarehouseId(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">Selecciona un almacén…</option>
                    {warehouses.map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', flexDirection: isMobileViewport ? 'column' : 'row', gap: 8, marginTop: 14 }}>
              <button onClick={cancelEdit} style={{ width: isMobileViewport ? '100%' : 'auto' }}>Cancelar</button>
              <button className="primary-btn" onClick={saveEdit} style={{ width: isMobileViewport ? '100%' : 'auto' }} disabled={loading}>{loading ? 'Guardando...' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: isMobileViewport ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobileViewport ? 0 : 16, zIndex: 1000 }}>
          <div style={{ width: isMobileViewport ? '100%' : 420, maxWidth: isMobileViewport ? '100%' : 420, background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: isMobileViewport ? '18px 18px 0 0' : 12, padding: 16 }}>
            <h3 style={{ margin: 0, marginBottom: 12 }}>Eliminar {deleteTarget.type === 'warehouse' ? 'almacén' : 'estante'}</h3>
            <p>¿Seguro que deseas eliminar "{(deleteTarget.item as any)?.name}"?</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', flexDirection: isMobileViewport ? 'column' : 'row', gap: 8, marginTop: 14 }}>
              <button onClick={() => setDeleteTarget(null)} style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--border)', color: 'inherit', borderRadius: 6, cursor: 'pointer', width: isMobileViewport ? '100%' : 'auto' }}>Cancelar</button>
              <button className="primary-btn danger" onClick={confirmDelete} style={{ width: isMobileViewport ? '100%' : 'auto' }} disabled={loading}>{loading ? 'Eliminando...' : 'Eliminar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
