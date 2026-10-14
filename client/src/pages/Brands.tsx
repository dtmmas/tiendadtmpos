import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { resolveUploadedAssetUrl } from '../utils/assets'

interface Brand {
  id: number
  name: string
  logoUrl?: string | null
}

function getBrandInitials(name: string) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'MR'
}

async function fileToDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('No se pudo leer la imagen seleccionada'))
    reader.readAsDataURL(file)
  })
}

export default function Brands() {
  const [items, setItems] = useState<Brand[]>([])
  const [query, setQuery] = useState('')
  const [usage, setUsage] = useState<Record<number, number>>({})
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [editTarget, setEditTarget] = useState<Brand | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Brand | null>(null)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [name, setName] = useState('')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState('')
  const [removeLogo, setRemoveLogo] = useState(false)

  const load = async () => {
    const { data } = await api.get('/brands')
    const sorted = [...data].sort((a: Brand, b: Brand) => a.name.localeCompare(b.name))
    setItems(sorted)
    try {
      const entries = await Promise.all(sorted.map(async (brand: Brand) => {
        const { data } = await api.get(`/brands/${brand.id}/usage`)
        return [brand.id, data?.count || 0] as const
      }))
      setUsage(Object.fromEntries(entries))
    } catch {}
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((brand) => {
      return brand.name.toLowerCase().includes(q)
    })
  }, [items, query])

  function resetFormState() {
    setName('')
    setLogoFile(null)
    setLogoPreview('')
    setRemoveLogo(false)
  }

  function startCreate() {
    resetFormState()
    setShowCreate(true)
  }

  function cancelCreate() {
    setShowCreate(false)
    resetFormState()
  }

  function startEdit(brand: Brand) {
    setEditTarget(brand)
    setName(brand.name)
    setLogoFile(null)
    setLogoPreview(resolveUploadedAssetUrl(brand.logoUrl))
    setRemoveLogo(false)
    setShowEdit(true)
  }

  function cancelEdit() {
    setShowEdit(false)
    setEditTarget(null)
    resetFormState()
  }

  async function handleLogoChange(file?: File | null) {
    if (!file) {
      setLogoFile(null)
      return
    }
    const preview = await fileToDataUrl(file)
    setLogoFile(file)
    setLogoPreview(preview)
    setRemoveLogo(false)
  }

  function clearLogoSelection() {
    setLogoFile(null)
    setLogoPreview('')
    setRemoveLogo(true)
  }

  async function saveCreate() {
    const trimmed = name.trim()
    if (!trimmed) return
    if (items.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) {
      alert('Ya existe una marca con ese nombre')
      return
    }

    setLoading(true)
    try {
      if (logoFile) {
        const formData = new FormData()
        formData.append('name', trimmed)
        formData.append('logo', logoFile)
        await api.post('/brands', formData)
      } else {
        await api.post('/brands', { name: trimmed })
      }
      setShowCreate(false)
      resetFormState()
      await load()
      alert('Marca creada correctamente')
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'No se pudo crear la marca.'
      alert(msg)
    } finally {
      setLoading(false)
    }
  }

  async function saveEdit() {
    if (!editTarget) return
    const trimmed = name.trim()
    if (!trimmed) return
    if (items.some((item) => item.id !== editTarget.id && item.name.toLowerCase() === trimmed.toLowerCase())) {
      alert('Ya existe una marca con ese nombre')
      return
    }

    setLoading(true)
    try {
      if (logoFile || removeLogo) {
        const formData = new FormData()
        formData.append('name', trimmed)
        if (logoFile) formData.append('logo', logoFile)
        if (removeLogo) formData.append('removeLogo', '1')
        await api.put(`/brands/${editTarget.id}`, formData)
      } else {
        await api.put(`/brands/${editTarget.id}`, { name: trimmed })
      }
      setShowEdit(false)
      setEditTarget(null)
      resetFormState()
      await load()
      alert('Marca actualizada correctamente')
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'No se pudo actualizar la marca.'
      alert(msg)
    } finally {
      setLoading(false)
    }
  }

  function removeBrand(id: number) {
    const target = items.find((brand) => brand.id === id) || null
    setDeleteTarget(target)
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    try {
      setLoading(true)
      await api.delete(`/brands/${deleteTarget.id}`)
      await load()
      setDeleteTarget(null)
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'No se pudo eliminar la marca.'
      alert(msg)
    } finally {
      setLoading(false)
    }
  }

  function renderBrandLogo(brandName: string, brandLogoUrl?: string | null, size = 58) {
    const resolved = resolveUploadedAssetUrl(brandLogoUrl)
    return (
      <div
        style={{
          width: size,
          height: size,
          minWidth: size,
          borderRadius: 16,
          border: '1px solid var(--border)',
          background: 'var(--modal)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          color: 'var(--muted)',
          fontWeight: 800,
        }}
      >
        {resolved ? (
          <img
            src={resolved}
            alt={brandName}
            style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 8 }}
          />
        ) : (
          <span>{getBrandInitials(brandName)}</span>
        )}
      </div>
    )
  }

  function renderBrandModal(title: string, onCancel: () => void, onSave: () => void) {
    const previewSource = logoPreview || (removeLogo ? '' : resolveUploadedAssetUrl(editTarget?.logoUrl))
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 90 }}>
        <div style={{ width: 520, maxWidth: 'calc(100vw - 24px)', background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 16, padding: 18 }}>
          <h3 style={{ margin: 0, marginBottom: 14 }}>{title}</h3>

          <div style={{ display: 'grid', gridTemplateColumns: '112px 1fr', gap: 16, alignItems: 'start' }}>
            <div style={{ display: 'grid', gap: 10, justifyItems: 'center' }}>
              {renderBrandLogo(name || editTarget?.name || 'Marca', previewSource, 96)}
              <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
                Vista previa del logo
              </div>
            </div>

            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <label>Nombre</label>
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </div>

              <div>
                <label>Logo de la marca</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const file = e.target.files?.[0] || null
                    try {
                      await handleLogoChange(file)
                    } catch (err: any) {
                      alert(err?.message || 'No se pudo cargar la imagen')
                    }
                  }}
                />
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                  Sube un archivo PNG, JPG, WEBP o SVG para usarlo en la tienda online.
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => {
                    setLogoFile(null)
                    setLogoPreview('')
                    setRemoveLogo(false)
                  }}
                >
                  Mantener actual
                </button>
                <button type="button" onClick={clearLogoSelection}>
                  Quitar logo
                </button>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <button onClick={onCancel}>Cancelar</button>
            <button onClick={onSave} disabled={loading}>{loading ? 'Guardando...' : 'Guardar'}</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Marcas</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input placeholder="Buscar..." value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 280 }} />
          <button className="primary-btn" onClick={startCreate}>Nuevo</button>
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
        </div>
      </div>

      {view === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
          {filtered.map((brand) => (
            <div key={brand.id} style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {renderBrandLogo(brand.name, brand.logoUrl)}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{brand.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{usage[brand.id] ?? 0} producto(s)</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button className="icon-btn primary" title="Editar" aria-label="Editar" onClick={() => startEdit(brand)}>
                  <svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 17.25V21h3.75L17.81 9.94a1 1 0 0 0 0-1.41l-3.34-3.34a1 1 0 0 0-1.41 0L3 16.59z" fill="currentColor" /></svg>
                </button>
                <button className="icon-btn danger" title="Eliminar" aria-label="Eliminar" onClick={() => removeBrand(brand.id)} disabled={(usage[brand.id] ?? 0) > 0}>
                  <svg viewBox="0 0 24 24" width="18" height="18">
                    <path d="M3 6h18" stroke="currentColor" strokeWidth="2" />
                    <path d="M8 6V4h8v2" stroke="currentColor" strokeWidth="2" />
                    <path d="M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2" />
                    <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: 'var(--modal)' }}>
              <tr>
                <th style={{ textAlign: 'left', padding: 8 }}>Logo</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Nombre</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Uso</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((brand) => (
                <tr key={brand.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 8 }}>{renderBrandLogo(brand.name, brand.logoUrl, 48)}</td>
                  <td style={{ padding: 8 }}>{brand.name}</td>
                  <td style={{ padding: 8 }}>{usage[brand.id] ?? 0} producto(s)</td>
                  <td style={{ padding: 8 }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="icon-btn primary" title="Editar" aria-label="Editar" onClick={() => startEdit(brand)}>
                        <svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 17.25V21h3.75L17.81 9.94a1 1 0 0 0 0-1.41l-3.34-3.34a1 1 0 0 0-1.41 0L3 16.59z" fill="currentColor" /></svg>
                      </button>
                      <button className="icon-btn danger" title="Eliminar" aria-label="Eliminar" onClick={() => removeBrand(brand.id)} disabled={(usage[brand.id] ?? 0) > 0}>
                        <svg viewBox="0 0 24 24" width="18" height="18">
                          <path d="M3 6h18" stroke="currentColor" strokeWidth="2" />
                          <path d="M8 6V4h8v2" stroke="currentColor" strokeWidth="2" />
                          <path d="M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2" />
                          <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate ? renderBrandModal('Nueva marca', cancelCreate, saveCreate) : null}
      {showEdit ? renderBrandModal('Editar marca', cancelEdit, saveEdit) : null}

      {deleteTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 90 }}>
          <div style={{ width: 420, background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
            <h3 style={{ margin: 0, marginBottom: 12 }}>Confirmar eliminación</h3>
            <div style={{ marginBottom: 12 }}>
              Esta acción eliminará la marca <strong>{deleteTarget.name}</strong> de forma permanente. ¿Confirmar?
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setDeleteTarget(null)} disabled={loading}>Cancelar</button>
              <button className="danger" onClick={confirmDelete} disabled={loading}>Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
