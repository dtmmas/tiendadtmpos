import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useConfigStore } from '../store/config'
import { formatMoney } from '../utils/currency'

interface PurchaseItem {
  id: number
  product_id: number
  product_name: string
  product_code: string
  quantity: number
  unit_cost: number
  total_cost: number
  serials?: string
}

interface Purchase {
  id: number
  supplier_name: string
  user_name: string
  warehouse_name?: string
  doc_no: string
  total: number
  status: string
  created_at: string
  notes: string
  items: PurchaseItem[]
}

export default function PurchaseDetails() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [purchase, setPurchase] = useState<Purchase | null>(null)
  const [loading, setLoading] = useState(true)
  const config = useConfigStore(s => s.config)

  useEffect(() => {
    loadPurchase()
  }, [id])

  async function loadPurchase() {
    try {
      const { data } = await api.get(`/purchases/${id}`)
      setPurchase(data)
    } catch (err) {
      console.error(err)
      alert('Error cargando detalles de la compra')
      navigate('/purchases')
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <div style={{ padding: 20 }}>Cargando...</div>
  if (!purchase) return null

  return (
    <div style={{ padding: 20, maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1>Detalle de Compra #{purchase.id}</h1>
        <button className="btn-secondary" onClick={() => navigate('/purchases')}>Volver</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20, padding: 20, backgroundColor: 'var(--modal)', borderRadius: 8, border: '1px solid var(--border)' }}>
        <div>
          <p><strong>Fecha:</strong> {new Date(purchase.created_at).toLocaleString()}</p>
          <p><strong>Proveedor:</strong> {purchase.supplier_name}</p>
          <p><strong>Usuario:</strong> {purchase.user_name}</p>
          <p><strong>Almacén Destino:</strong> {purchase.warehouse_name || 'Tienda Principal'}</p>
        </div>
        <div>
          <p><strong>Doc No:</strong> {purchase.doc_no || '-'}</p>
          <p><strong>Estado:</strong> {purchase.status}</p>
          <p><strong>Notas:</strong> {purchase.notes || '-'}</p>
        </div>
      </div>

      <div style={{ border: '1px solid var(--border)', borderRadius: 8, backgroundColor: 'var(--modal)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--surface)' }}>
              <th style={{ padding: 12, textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Producto</th>
              <th style={{ padding: 12, textAlign: 'center', borderBottom: '1px solid var(--border)' }}>Cantidad</th>
              <th style={{ padding: 12, textAlign: 'right', borderBottom: '1px solid var(--border)' }}>Costo Unit.</th>
              <th style={{ padding: 12, textAlign: 'right', borderBottom: '1px solid var(--border)' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {purchase.items.map(item => (
              <tr key={item.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: 12 }}>
                  <div style={{ fontWeight: 'bold' }}>{item.product_name}</div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{item.product_code}</div>
                  {item.serials && (
                    <div style={{ marginTop: 4, fontSize: '0.8rem', color: 'var(--text)', whiteSpace: 'pre-wrap', backgroundColor: 'var(--bg)', padding: 4, borderRadius: 4, border: '1px solid var(--border)' }}>
                      <strong>Series/IMEIs:</strong><br/>
                      {item.serials}
                    </div>
                  )}
                </td>
                <td style={{ padding: 12, textAlign: 'center' }}>{item.quantity}</td>
                <td style={{ padding: 12, textAlign: 'right' }}>{formatMoney(Number(item.unit_cost), config?.currency)}</td>
                <td style={{ padding: 12, textAlign: 'right' }}>{formatMoney(Number(item.total_cost), config?.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} style={{ padding: 12, textAlign: 'right', fontWeight: 'bold' }}>Total:</td>
              <td style={{ padding: 12, textAlign: 'right', fontWeight: 'bold', fontSize: '1.2rem', color: 'var(--accent)' }}>
                {formatMoney(Number(purchase.total), config?.currency)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
