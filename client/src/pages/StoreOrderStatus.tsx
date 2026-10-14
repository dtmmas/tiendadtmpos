import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { useConfigStore } from '../store/config'
import { formatMoney } from '../utils/currency'
import { formatCompanyName } from '../utils/text'
import { useStorePublicRouting } from '../hooks/useStorePublicRouting'
import '../styles/store-public.css'

type OrderItem = {
  productId: number
  productName: string
  quantity: number
  unitPrice: number
  total: number
}

type Payment = {
  provider: string
  status: string
  paymentLink: string | null
  reference: string | null
  amount: number
  createdAt: string
}

type OrderDetails = {
  id: number
  orderCode: string
  status: string
  currency: string
  fulfillmentType: 'PICKUP' | 'DELIVERY'
  department: string | null
  municipality: string | null
  address: string | null
  shippingFee: number
  subtotal: number
  total: number
  customerName: string
  customerPhone: string | null
  customerEmail: string | null
  scheduledFor: string | null
  paidAt: string | null
  createdAt: string
  items: OrderItem[]
  payments: Payment[]
  publicSlug?: string
  customDomain?: string
}

function statusLabel(status: string) {
  const normalized = String(status || '').toUpperCase()
  if (normalized === 'PAID') return 'Pagado'
  if (normalized === 'CANCELLED') return 'Cancelado'
  return 'Pendiente de pago'
}

export default function StoreOrderStatus() {
  const { orderCode } = useParams()
  const config = useConfigStore(s => s.config)
  const [order, setOrder] = useState<OrderDetails | null>(null)
  const [storeSettings, setStoreSettings] = useState<{ publicSlug?: string; customDomain?: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { buildStorePath } = useStorePublicRouting(storeSettings?.publicSlug || order?.publicSlug, storeSettings?.customDomain || order?.customDomain)

  const title = useMemo(() => formatCompanyName(config?.name || 'TIENDA'), [config?.name])
  const currency = order?.currency || config?.currency || 'USD'

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await api.get('/store/settings')
        if (!cancelled) setStoreSettings(data)
      } catch {}
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!orderCode) return
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        setError(null)
        const { data } = await api.get(`/store/orders/${encodeURIComponent(orderCode)}`)
        if (!cancelled) setOrder(data)
      } catch (e: any) {
        if (!cancelled) setError(e?.response?.data?.error || 'No se pudo cargar el pedido')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [orderCode])

  if (!orderCode) return <Navigate to={buildStorePath()} replace />

  const latestPayment = order?.payments?.[0] || null
  const provider = String(latestPayment?.provider || '').toUpperCase()
  const isPaid = String(order?.status || '').toUpperCase() === 'PAID'

  return (
    <div className="store-shell">
      <div className="store-container">
        <div className="store-topbar">
          <div className="store-brand">
            <span className="store-brand-label">Estado del pedido</span>
            <div className="store-brand-title">{title}</div>
            <div className="store-brand-subtitle">Seguimiento del pedido con una presentación más clara y comercial.</div>
          </div>

          <div className="store-actions">
            <Link to={buildStorePath()} className="store-button-secondary">Volver al catalogo</Link>
          </div>
        </div>

        {loading ? (
          <div className="store-loading">Cargando pedido...</div>
        ) : error ? (
          <div className="store-error">{error}</div>
        ) : order ? (
          <div className="store-order-layout">
            <div className="store-order-main">
              <section className="store-section-card store-card">
                <div className="store-section-heading">
                  <div>
                    <h2 className="store-section-title">Pedido {order.orderCode}</h2>
                    <div className="store-section-copy">Comparte este código con el equipo si necesitas ayuda.</div>
                  </div>

                  <span className={`store-status-badge ${isPaid ? 'store-status-paid' : 'store-status-pending'}`}>
                    {statusLabel(order.status)}
                  </span>
                </div>

                <div className="store-order-kpis">
                  <div className="store-kpi">
                    <div className="store-kpi-label">Cliente</div>
                    <div className="store-kpi-value">{order.customerName}</div>
                  </div>
                  <div className="store-kpi">
                    <div className="store-kpi-label">Entrega</div>
                    <div className="store-kpi-value">{order.fulfillmentType === 'PICKUP' ? 'Pickup' : 'Delivery'}</div>
                  </div>
                  <div className="store-kpi">
                    <div className="store-kpi-label">Total</div>
                    <div className="store-kpi-value">{formatMoney(order.total, currency)}</div>
                  </div>
                </div>

                {order.scheduledFor ? (
                  <div className="store-notice">
                    Pedido programado para <strong style={{ color: 'var(--text)' }}>{order.scheduledFor}</strong>.
                  </div>
                ) : null}
              </section>

              <section className="store-section-card store-card">
                <div className="store-section-heading">
                  <div>
                    <h2 className="store-section-title">Entrega</h2>
                    <div className="store-section-copy">Datos del destino o modalidad de retiro.</div>
                  </div>
                </div>

                <div className="store-panel-soft">
                  <strong style={{ color: 'var(--text)' }}>
                    {order.fulfillmentType === 'PICKUP' ? 'Recoger en tienda' : 'Envio a domicilio'}
                  </strong>
                  {order.fulfillmentType === 'DELIVERY' ? (
                    <div style={{ marginTop: 8 }}>
                      {order.department || ''}{order.municipality ? `, ${order.municipality}` : ''}{order.address ? ` · ${order.address}` : ''}
                    </div>
                  ) : (
                    <div style={{ marginTop: 8 }}>El equipo coordinará el punto y hora de retiro.</div>
                  )}
                </div>
              </section>

              <section className="store-section-card store-card">
                <div className="store-section-heading">
                  <div>
                    <h2 className="store-section-title">Productos</h2>
                    <div className="store-section-copy">Resumen del pedido con subtotales por línea.</div>
                  </div>
                </div>

                <div className="store-list" style={{ gap: 10 }}>
                  {order.items.map((item) => (
                    <div key={item.productId} className="store-panel-soft">
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <strong style={{ color: 'var(--text)' }}>{item.productName}</strong>
                        <strong style={{ color: 'var(--text)' }}>{formatMoney(item.total, currency)}</strong>
                      </div>
                      <div className="store-section-copy">
                        {item.quantity} x {formatMoney(item.unitPrice, currency)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <aside className="store-order-panel">
              <div className="store-section-title">Pago</div>
              <div className="store-section-copy">Panel lateral tipo ecommerce con el estado de cobro y próximos pasos.</div>

              <div className="store-divider" style={{ margin: '14px 0' }} />

              {isPaid ? (
                <div className="store-notice" style={{ color: '#86efac' }}>
                  El pago ya fue confirmado. Tu pedido está registrado como pagado.
                </div>
              ) : (
                <div className="store-notice">
                  {provider === 'TRANSFER'
                    ? 'Realiza la transferencia y comparte el comprobante para validación.'
                    : 'El equipo enviará el link de pago para completar el cobro con tarjeta.'}
                </div>
              )}

              <div className="store-summary-row" style={{ marginTop: 16 }}>
                <span>Subtotal</span>
                <strong>{formatMoney(order.subtotal, currency)}</strong>
              </div>
              <div className="store-summary-row">
                <span>Envio</span>
                <strong>{formatMoney(order.shippingFee, currency)}</strong>
              </div>
              <div className="store-summary-row">
                <span>Total</span>
                <span className="store-summary-total">{formatMoney(order.total, currency)}</span>
              </div>

              {latestPayment?.paymentLink ? (
                <a href={latestPayment.paymentLink} target="_blank" rel="noreferrer" className="store-button store-button-full" style={{ marginTop: 18 }}>
                  Abrir link de pago
                </a>
              ) : null}

              <div className="store-panel-soft" style={{ marginTop: 16 }}>
                <div><strong style={{ color: 'var(--text)' }}>Código:</strong> {order.orderCode}</div>
                <div><strong style={{ color: 'var(--text)' }}>Estado:</strong> {statusLabel(order.status)}</div>
              </div>
            </aside>
          </div>
        ) : null}
      </div>
    </div>
  )
}
