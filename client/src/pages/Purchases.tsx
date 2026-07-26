import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { useConfigStore } from '../store/config'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { formatMoney } from '../utils/currency'

interface Purchase {
  id: number
  supplier_id: number | null
  supplier_name: string | null
  user_id: number | null
  user_name: string | null
  doc_no: string | null
  total: number
  status: string
  created_at: string
  notes: string | null
}

export default function Purchases() {
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [totalRecords, setTotalRecords] = useState(0)
  const limit = 50
  
  const config = useConfigStore(s => s.config)
  const navigate = useNavigate()
  const { hasPermission } = useAuthStore()

  useEffect(() => {
    loadPurchases()
  }, [page, search])

  async function loadPurchases() {
    setLoading(true)
    try {
      const { data } = await api.get('/purchases', {
        params: { limit, offset: page * limit, search }
      })
      setPurchases(data.data)
      setTotalRecords(data.pagination.total)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-shell" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="page-toolbar" style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>Compras</h1>
        {hasPermission('purchases:write') && (
          <button 
            className="btn-primary"
            onClick={() => navigate('/purchases/new')}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <span style={{ fontSize: '1.2rem' }}>+</span> Nueva Compra
          </button>
        )}
      </div>

      <div style={{ 
        display: 'flex', 
        flexWrap: 'wrap',
        gap: 16, 
        marginBottom: 20, 
        backgroundColor: 'var(--modal)', 
        padding: 16, 
        borderRadius: 8,
        border: '1px solid var(--border)' 
      }}>
        <input 
          type="text" 
          placeholder="Buscar por doc, proveedor, ID..." 
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0) }}
          style={{ flex: 1, padding: 8, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
        />
      </div>

      <div className="table-scroll" style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, backgroundColor: 'var(--modal)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--surface)', zIndex: 1 }}>
            <tr>
              <th style={{ padding: 12, textAlign: 'left', borderBottom: '2px solid var(--border)' }}>ID</th>
              <th style={{ padding: 12, textAlign: 'left', borderBottom: '2px solid var(--border)' }}>Fecha</th>
              <th style={{ padding: 12, textAlign: 'left', borderBottom: '2px solid var(--border)' }}>Proveedor</th>
              <th style={{ padding: 12, textAlign: 'left', borderBottom: '2px solid var(--border)' }}>Doc No.</th>
              <th style={{ padding: 12, textAlign: 'left', borderBottom: '2px solid var(--border)' }}>Usuario</th>
              <th style={{ padding: 12, textAlign: 'right', borderBottom: '2px solid var(--border)' }}>Total</th>
              <th style={{ padding: 12, textAlign: 'center', borderBottom: '2px solid var(--border)' }}>Estado</th>
              <th style={{ padding: 12, textAlign: 'center', borderBottom: '2px solid var(--border)' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {purchases.map(p => (
              (() => {
                const status = (p.status || 'COMPLETED').toUpperCase()
                const isCompleted = status === 'COMPLETED'
                return (
              <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: 12 }}>#{p.id}</td>
                <td style={{ padding: 12 }}>{new Date(p.created_at).toLocaleString()}</td>
                <td style={{ padding: 12 }}>{p.supplier_name || '-'}</td>
                <td style={{ padding: 12 }}>{p.doc_no || '-'}</td>
                <td style={{ padding: 12 }}>{p.user_name || '-'}</td>
                <td style={{ padding: 12, textAlign: 'right', fontWeight: 'bold' }}>
                  {formatMoney(Number(p.total), config?.currency)}
                </td>
                <td style={{ padding: 12, textAlign: 'center' }}>
                  <span style={{ 
                    padding: '4px 8px', 
                    borderRadius: 4, 
                    backgroundColor: isCompleted ? 'rgba(46, 204, 113, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                    color: isCompleted ? '#2ecc71' : '#ef4444',
                    fontWeight: 'bold',
                    fontSize: '0.8rem'
                  }}>
                    {isCompleted ? 'COMPLETADO' : status}
                  </span>
                </td>
                <td style={{ padding: 12, textAlign: 'center' }}>
                  <button 
                    onClick={() => navigate(`/purchases/${p.id}`)}
                    className="icon-btn"
                    title="Ver Detalles"
                  >
                    👁️
                  </button>
                </td>
              </tr>
                )
              })()
            ))}
            {purchases.length === 0 && !loading && (
              <tr>
                <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
                  No hay compras registradas
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      
      {/* Pagination */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
        <button 
          disabled={page === 0}
          onClick={() => setPage(p => p - 1)}
          className="btn-secondary"
        >
          Anterior
        </button>
        <span style={{ display: 'flex', alignItems: 'center' }}>
          Página {page + 1} de {Math.ceil(totalRecords / limit) || 1}
        </span>
        <button 
          disabled={(page + 1) * limit >= totalRecords}
          onClick={() => setPage(p => p + 1)}
          className="btn-secondary"
        >
          Siguiente
        </button>
      </div>
    </div>
  )
}
