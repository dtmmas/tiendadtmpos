import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useConfigStore } from '../store/config'
import { useStoreCart } from '../store/storeCart'
import { formatMoney } from '../utils/currency'
import { formatCompanyName } from '../utils/text'
import { useStorePublicRouting } from '../hooks/useStorePublicRouting'
import '../styles/store-public.css'

type StoreSettings = {
  currency: string
  enabled: boolean
  cartEnabled: boolean
  checkoutEnabled: boolean
  warehouseId: number
  cutoffTime: string
  acceptAfterCutoff: string
  pickupEnabled: boolean
  deliveryEnabled: boolean
  pickupNotes: string
  publicSlug?: string
}

type ShippingZone = {
  id: number
  department: string
  municipality: string
  fee: number
}

type OrderResponse = {
  success: boolean
  orderId: number
  orderCode: string
  currency: string
  fulfillmentType: 'PICKUP' | 'DELIVERY'
  scheduledFor: string | null
  subtotal: number
  shippingFee: number
  total: number
  paymentProvider: 'STRIPE' | 'TRANSFER'
}

export default function StoreCheckout() {
  const navigate = useNavigate()
  const config = useConfigStore(s => s.config)
  const items = useStoreCart(s => s.items)
  const subtotal = useStoreCart(s => s.subtotal())
  const clear = useStoreCart(s => s.clear)

  const [settings, setSettings] = useState<StoreSettings | null>(null)
  const [zones, setZones] = useState<ShippingZone[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [fulfillmentType, setFulfillmentType] = useState<'DELIVERY' | 'PICKUP'>('DELIVERY')
  const [department, setDepartment] = useState('')
  const [municipality, setMunicipality] = useState('')
  const [address, setAddress] = useState('')
  const [paymentProvider, setPaymentProvider] = useState<'STRIPE' | 'TRANSFER'>('STRIPE')
  const { buildStorePath } = useStorePublicRouting(settings?.publicSlug)

  const title = useMemo(() => formatCompanyName(config?.name || 'TIENDA'), [config?.name])
  const currency = settings?.currency || config?.currency || 'USD'

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [{ data: settingsData }, { data: zonesData }] = await Promise.all([
          api.get('/store/settings'),
          api.get('/store/shipping-zones'),
        ])
        if (cancelled) return
        setSettings(settingsData)
        setZones(Array.isArray(zonesData) ? zonesData : [])
      } catch {
        if (cancelled) return
        setSettings(null)
        setZones([])
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!settings) return
    if (!settings.deliveryEnabled && settings.pickupEnabled) setFulfillmentType('PICKUP')
    if (!settings.pickupEnabled && settings.deliveryEnabled) setFulfillmentType('DELIVERY')
  }, [settings])

  const departments = useMemo(() => {
    const values = new Set<string>()
    zones.forEach((zone) => {
      const departmentValue = String(zone.department || '').trim()
      if (departmentValue) values.add(departmentValue)
    })
    return Array.from(values).sort((a, b) => a.localeCompare(b))
  }, [zones])

  const municipalities = useMemo(() => {
    if (!department) return []
    return zones
      .filter((zone) => zone.department === department)
      .map((zone) => zone.municipality)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
  }, [zones, department])

  const selectedZone = useMemo(() => {
    if (!department || !municipality) return null
    return zones.find((zone) => zone.department === department && zone.municipality === municipality) || null
  }, [zones, department, municipality])

  const shippingFee = fulfillmentType === 'DELIVERY' ? Number(selectedZone?.fee || 0) : 0
  const total = Number(subtotal || 0) + Number(shippingFee || 0)

  useEffect(() => {
    if (!department) setMunicipality('')
    else if (municipality && !municipalities.includes(municipality)) setMunicipality('')
  }, [department, municipality, municipalities])

  if (!items.length) return <Navigate to={buildStorePath()} replace />
  if (settings && (settings.enabled === false || settings.cartEnabled === false || settings.checkoutEnabled === false)) {
    return <Navigate to={buildStorePath()} replace />
  }

  async function submit() {
    setError(null)
    const normalizedName = customerName.trim()

    if (!normalizedName) {
      setError('Nombre requerido')
      return
    }

    if (fulfillmentType === 'DELIVERY') {
      if (!department.trim() || !municipality.trim() || !address.trim()) {
        setError('Dirección requerida para envío')
        return
      }
      if (!selectedZone) {
        setError('Selecciona un destino válido')
        return
      }
    }

    try {
      setLoading(true)
      const payload = {
        customerName: normalizedName,
        customerPhone: customerPhone.trim() || undefined,
        customerEmail: customerEmail.trim() || undefined,
        fulfillmentType,
        department: fulfillmentType === 'DELIVERY' ? department : undefined,
        municipality: fulfillmentType === 'DELIVERY' ? municipality : undefined,
        address: fulfillmentType === 'DELIVERY' ? address : undefined,
        paymentProvider,
        items: items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      }

      const { data } = await api.post<OrderResponse>('/store/orders', payload)
      clear()
      navigate(buildStorePath(`/pedido/${data.orderCode}`))
    } catch (e: any) {
      setError(e?.response?.data?.error || 'No se pudo crear el pedido')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="store-shell">
      <div className="store-container">
        <div className="store-topbar">
          <div className="store-brand">
            <span className="store-brand-label">Checkout</span>
            <div className="store-brand-title">{title}</div>
            <div className="store-brand-subtitle">
              Completa tus datos y confirma el pedido con un flujo mas limpio y comercial.
            </div>
          </div>

          <div className="store-actions">
            <Link to={buildStorePath('/carrito')} className="store-button-secondary">Volver al carrito</Link>
            <Link to={buildStorePath()} className="store-button-ghost">Volver al catalogo</Link>
          </div>
        </div>

        {error ? <div className="store-error" style={{ marginBottom: 16 }}>{error}</div> : null}

        <div className="store-checkout-layout">
          <div className="store-checkout-main">
            <section className="store-section-card store-card">
              <div className="store-section-heading">
                <div>
                  <h2 className="store-section-title">Datos del cliente</h2>
                  <div className="store-section-copy">Información para contacto, seguimiento y entrega.</div>
                </div>
              </div>

              <div className="store-field-grid">
                <div>
                  <label className="store-field-label" htmlFor="customer-name">Nombre completo</label>
                  <input id="customer-name" className="store-input" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Nombre del cliente" />
                </div>
                <div>
                  <label className="store-field-label" htmlFor="customer-phone">Telefono</label>
                  <input id="customer-phone" className="store-input" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="WhatsApp o llamada" />
                </div>
                <div className="store-field-span">
                  <label className="store-field-label" htmlFor="customer-email">Correo electronico</label>
                  <input id="customer-email" className="store-input" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="correo@ejemplo.com" />
                </div>
              </div>
            </section>

            <section className="store-section-card store-card">
              <div className="store-section-heading">
                <div>
                  <h2 className="store-section-title">Entrega</h2>
                  <div className="store-section-copy">Selecciona la modalidad y completa la información necesaria.</div>
                </div>
              </div>

              <div className="store-toggle-row">
                {settings?.deliveryEnabled !== false ? (
                  <button
                    type="button"
                    className={`store-toggle ${fulfillmentType === 'DELIVERY' ? 'store-toggle-active' : ''}`}
                    onClick={() => setFulfillmentType('DELIVERY')}
                  >
                    <span className="store-toggle-title">Envio a domicilio</span>
                    <span className="store-toggle-copy">Tarifa automática por departamento y municipio.</span>
                  </button>
                ) : null}

                {settings?.pickupEnabled !== false ? (
                  <button
                    type="button"
                    className={`store-toggle ${fulfillmentType === 'PICKUP' ? 'store-toggle-active' : ''}`}
                    onClick={() => setFulfillmentType('PICKUP')}
                  >
                    <span className="store-toggle-title">Recoger en tienda</span>
                    <span className="store-toggle-copy">Ideal para retiro rápido sin costo de envio.</span>
                  </button>
                ) : null}
              </div>

              {fulfillmentType === 'PICKUP' ? (
                <div className="store-notice">
                  {settings?.pickupNotes || 'Tu pedido quedará listo para coordinar retiro en tienda.'}
                </div>
              ) : (
                <div className="store-field-grid">
                  <div>
                    <label className="store-field-label" htmlFor="department">Departamento</label>
                    <select id="department" className="store-select" value={department} onChange={(e) => setDepartment(e.target.value)}>
                      <option value="">Selecciona una opcion</option>
                      {departments.map((value) => (
                        <option key={value} value={value}>{value}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="store-field-label" htmlFor="municipality">Municipio</label>
                    <select
                      id="municipality"
                      className="store-select"
                      value={municipality}
                      onChange={(e) => setMunicipality(e.target.value)}
                      disabled={!department}
                    >
                      <option value="">{department ? 'Selecciona una opcion' : 'Primero elige departamento'}</option>
                      {municipalities.map((value) => (
                        <option key={value} value={value}>{value}</option>
                      ))}
                    </select>
                  </div>

                  <div className="store-field-span">
                    <label className="store-field-label" htmlFor="address">Direccion</label>
                    <textarea
                      id="address"
                      className="store-textarea"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="Colonia, referencias, punto de entrega, etc."
                    />
                  </div>
                </div>
              )}
            </section>

            <section className="store-section-card store-card">
              <div className="store-section-heading">
                <div>
                  <h2 className="store-section-title">Metodo de pago</h2>
                  <div className="store-section-copy">Diseño claro para mostrar las opciones y facilitar la decisión.</div>
                </div>
              </div>

              <div className="store-toggle-row">
                <button
                  type="button"
                  className={`store-toggle ${paymentProvider === 'STRIPE' ? 'store-toggle-active' : ''}`}
                  onClick={() => setPaymentProvider('STRIPE')}
                >
                  <span className="store-toggle-title">Tarjeta por link</span>
                  <span className="store-toggle-copy">El pago se confirma cuando se envía el link y se valida la operación.</span>
                </button>

                <button
                  type="button"
                  className={`store-toggle ${paymentProvider === 'TRANSFER' ? 'store-toggle-active' : ''}`}
                  onClick={() => setPaymentProvider('TRANSFER')}
                >
                  <span className="store-toggle-title">Transferencia bancaria</span>
                  <span className="store-toggle-copy">Envía comprobante y el equipo confirmará el pago.</span>
                </button>
              </div>

              <div className="store-notice">
                Los pedidos se registran inicialmente como <strong style={{ color: 'var(--text)' }}>pendientes de pago</strong>.
              </div>
            </section>
          </div>

          <aside className="store-summary">
            <div>
              <div className="store-section-title">Resumen del pedido</div>
              <div className="store-section-copy">Vista lateral fija, similar a un checkout moderno.</div>
            </div>

            <div className="store-list" style={{ gap: 10 }}>
              {items.map((item) => (
                <div key={item.productId} className="store-panel-soft">
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <strong style={{ color: 'var(--text)' }}>{item.name}</strong>
                    <strong style={{ color: 'var(--text)' }}>{formatMoney(Number(item.price || 0) * Number(item.quantity || 0), currency)}</strong>
                  </div>
                  <div className="store-section-copy">Cantidad: {item.quantity}</div>
                </div>
              ))}
            </div>

            <div className="store-divider" />

            <div className="store-summary-row">
              <span>Subtotal</span>
              <strong>{formatMoney(subtotal, currency)}</strong>
            </div>
            <div className="store-summary-row">
              <span>Envio</span>
              <strong>{formatMoney(shippingFee, currency)}</strong>
            </div>
            <div className="store-summary-row">
              <span>Total</span>
              <span className="store-summary-total">{formatMoney(total, currency)}</span>
            </div>

            <button type="button" className="store-button store-button-full" disabled={loading} onClick={submit} style={{ opacity: loading ? 0.75 : 1 }}>
              {loading ? 'Creando pedido...' : 'Confirmar pedido'}
            </button>
          </aside>
        </div>
      </div>
    </div>
  )
}
