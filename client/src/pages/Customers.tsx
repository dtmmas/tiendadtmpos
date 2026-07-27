import { useState, useEffect } from 'react'
import { api } from '../api'
import { useAuthStore } from '../store/auth'

interface Customer {
  id: number
  name: string
  document: string
  phone: string
  email: string
  address: string
}

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [savingCustomer, setSavingCustomer] = useState(false)
  const [isMobileViewport, setIsMobileViewport] = useState(false)
  const { user, hasPermission } = useAuthStore()

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    document: '',
    phone: '',
    email: '',
    address: ''
  })

  useEffect(() => {
    loadCustomers()
  }, [])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)')
    const syncViewport = () => setIsMobileViewport(mediaQuery.matches)
    syncViewport()
    mediaQuery.addEventListener('change', syncViewport)
    return () => mediaQuery.removeEventListener('change', syncViewport)
  }, [])

  const loadCustomers = async () => {
    setLoading(true)
    try {
      const res = await api.get('/customers')
      setCustomers(res.data)
    } catch (err) {
      console.error(err)
      alert('Error al cargar clientes')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (savingCustomer) return
    try {
      setSavingCustomer(true)
      if (editing) {
        await api.put(`/customers/${editing.id}`, formData)
      } else {
        await api.post('/customers', formData)
      }
      setIsModalOpen(false)
      setEditing(null)
      setFormData({ name: '', document: '', phone: '', email: '', address: '' })
      loadCustomers()
    } catch (err) {
      console.error(err)
      alert('Error al guardar cliente')
    } finally {
      setSavingCustomer(false)
    }
  }

  const handleEdit = (customer: Customer) => {
    setEditing(customer)
    setFormData({
      name: customer.name,
      document: customer.document,
      phone: customer.phone,
      email: customer.email,
      address: customer.address
    })
    setIsModalOpen(true)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('¿Seguro de eliminar este cliente?')) return
    try {
      await api.delete(`/customers/${id}`)
      loadCustomers()
    } catch (err: any) {
      console.error(err)
      alert(err.response?.data?.error || 'Error al eliminar cliente')
    }
  }

  const openNew = () => {
    setEditing(null)
    setFormData({ name: '', document: '', phone: '', email: '', address: '' })
    setIsModalOpen(true)
  }

  return (
    <div style={{ padding: isMobileViewport ? 14 : 20 }}>
      <div style={{ display: 'flex', alignItems: isMobileViewport ? 'stretch' : 'center', justifyContent: 'space-between', flexDirection: isMobileViewport ? 'column' : 'row', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Clientes</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: isMobileViewport ? '100%' : 'auto' }}>
          <button className="primary-btn" onClick={openNew} style={{ width: isMobileViewport ? '100%' : 'auto' }}>Nuevo Cliente</button>
        </div>
      </div>

      {loading ? (
        <p>Cargando...</p>
      ) : isMobileViewport ? (
        <div style={{ display: 'grid', gap: 12 }}>
          {customers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--modal)' }}>
              No hay clientes registrados
            </div>
          ) : (
            customers.map(c => (
              <div key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 12, background: 'var(--modal)', padding: 14, display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{c.name}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{c.document || 'Sin documento'}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => handleEdit(c)} className="icon-btn primary" title="Editar">
                      <svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 17.25V21h3.75L17.81 9.94a1 1 0 0 0 0-1.41l-3.34-3.34a1 1 0 0 0-1.41 0L3 16.59z" fill="currentColor"/></svg>
                    </button>
                    {hasPermission('customers:write') && (
                      <button onClick={() => handleDelete(c.id)} className="icon-btn danger" title="Eliminar">
                        <svg viewBox="0 0 24 24" width="18" height="18">
                          <path d="M3 6h18" stroke="currentColor" strokeWidth="2"/>
                          <path d="M8 6V4h8v2" stroke="currentColor" strokeWidth="2"/>
                          <path d="M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2"/>
                          <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2"/>
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ display: 'grid', gap: 8, fontSize: '0.9rem' }}>
                  <div><strong>Teléfono:</strong> {c.phone || '-'}</div>
                  <div><strong>Email:</strong> {c.email || '-'}</div>
                  <div><strong>Dirección:</strong> {c.address || '-'}</div>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: 'var(--modal)' }}>
              <tr>
                <th style={{ textAlign: 'left', padding: 8 }}>Nombre</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Documento</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Teléfono</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Email</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Dirección</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {customers.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 8, fontWeight: 500 }}>{c.name}</td>
                  <td style={{ padding: 8 }}>{c.document}</td>
                  <td style={{ padding: 8 }}>{c.phone}</td>
                  <td style={{ padding: 8 }}>{c.email}</td>
                  <td style={{ padding: 8 }}>{c.address}</td>
                  <td style={{ padding: 8 }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => handleEdit(c)} className="icon-btn primary" title="Editar">
                        <svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 17.25V21h3.75L17.81 9.94a1 1 0 0 0 0-1.41l-3.34-3.34a1 1 0 0 0-1.41 0L3 16.59z" fill="currentColor"/></svg>
                      </button>
                      {hasPermission('customers:write') && (
                        <button onClick={() => handleDelete(c.id)} className="icon-btn danger" title="Eliminar">
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
              {customers.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)' }}>
                    No hay clientes registrados
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {isModalOpen && (
        <div className="modal-overlay" style={{ alignItems: isMobileViewport ? 'flex-end' : undefined, padding: isMobileViewport ? 0 : undefined }}>
          <div className="modal" style={{ width: isMobileViewport ? '100%' : undefined, maxWidth: isMobileViewport ? '100%' : undefined, borderRadius: isMobileViewport ? '18px 18px 0 0' : undefined, maxHeight: isMobileViewport ? '90vh' : undefined, overflowY: isMobileViewport ? 'auto' : undefined }}>
            <div className="modal-header">
              <h2>{editing ? 'Editar Cliente' : 'Nuevo Cliente'}</h2>
              <button onClick={() => setIsModalOpen(false)} className="close-btn" disabled={savingCustomer}>&times;</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Nombre *</label>
                  <input
                    required
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Documento / RUT / DNI</label>
                  <input
                    value={formData.document}
                    onChange={e => setFormData({ ...formData, document: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Teléfono</label>
                  <input
                    value={formData.phone}
                    onChange={e => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Dirección</label>
                  <input
                    value={formData.address}
                    onChange={e => setFormData({ ...formData, address: e.target.value })}
                  />
                </div>
              </div>
              <div className="modal-footer" style={{ flexDirection: isMobileViewport ? 'column' : 'row' }}>
                <button type="button" onClick={() => setIsModalOpen(false)} className="btn-secondary" style={{ width: isMobileViewport ? '100%' : 'auto' }} disabled={savingCustomer}>Cancelar</button>
                <button type="submit" className="btn-primary" style={{ width: isMobileViewport ? '100%' : 'auto' }} disabled={savingCustomer}>
                  {savingCustomer ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
