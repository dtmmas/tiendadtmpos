import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useStoreCart } from '../store/storeCart'
import { useConfigStore } from '../store/config'
import { api } from '../api'
import { formatMoney } from '../utils/currency'
import { resolveUploadedAssetUrl } from '../utils/assets'
import { formatCompanyName } from '../utils/text'
import '../styles/store-public.css'

export default function StoreCart() {
  const navigate = useNavigate()
  const config = useConfigStore(s => s.config)
  const fetchConfig = useConfigStore(s => s.fetchConfig)
  const items = useStoreCart(s => s.items)
  const setQuantity = useStoreCart(s => s.setQuantity)
  const removeItem = useStoreCart(s => s.removeItem)
  const clear = useStoreCart(s => s.clear)
  const subtotal = useStoreCart(s => s.subtotal())
  const totalItems = useStoreCart(s => s.count())
  const [storeSettings, setStoreSettings] = useState<{ enabled: boolean; cartEnabled: boolean; checkoutEnabled: boolean } | null>(null)

  const title = useMemo(() => formatCompanyName(config?.name || 'TIENDA'), [config?.name])
  const currency = config?.currency || 'USD'

  useEffect(() => {
    if (!config) void fetchConfig()
  }, [config, fetchConfig])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await api.get('/store/settings')
        if (!cancelled) setStoreSettings(data)
      } catch {
        if (!cancelled) setStoreSettings(null)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (!items.length) return <Navigate to="/tienda" replace />
  if (storeSettings && (storeSettings.enabled === false || storeSettings.cartEnabled === false)) {
    return <Navigate to="/tienda" replace />
  }

  return (
    <div className="store-shell">
      <div className="store-container">
        <div className="store-topbar">
          <div className="store-brand">
            <span className="store-brand-label">Carrito</span>
            <div className="store-brand-title">{title}</div>
            <div className="store-brand-subtitle">Revisa tus productos antes de pasar al checkout</div>
          </div>

          <div className="store-actions">
            <Link to="/tienda" className="store-button-secondary">Seguir comprando</Link>
            <button type="button" className="store-button-ghost store-remove" onClick={() => { clear(); navigate('/tienda') }}>
              Vaciar carrito
            </button>
          </div>
        </div>

        <div className="store-cart-layout">
          <section className="store-list">
            {items.map((item) => (
              <article key={item.productId} className="store-cart-item store-card">
                <div className="store-thumb">
                  {item.imageUrl ? (
                    <img src={resolveUploadedAssetUrl(item.imageUrl)} alt={item.name} />
                  ) : (
                    <div className="store-card-fallback">Sin imagen</div>
                  )}
                </div>

                <div>
                  <div className="store-item-title">{item.name}</div>
                  <div className="store-item-subtext">{formatMoney(item.price, currency)} por unidad</div>

                  <div className="store-item-footer">
                    <div className="store-quantity-control">
                      <button type="button" className="store-quantity-button" onClick={() => setQuantity(item.productId, item.quantity - 1)}>-</button>
                      <input
                        className="store-quantity-input"
                        value={String(item.quantity)}
                        onChange={(e) => setQuantity(item.productId, Number(e.target.value))}
                        inputMode="numeric"
                      />
                      <button type="button" className="store-quantity-button" onClick={() => setQuantity(item.productId, item.quantity + 1)}>+</button>
                    </div>

                    <div className="store-item-total">{formatMoney(Number(item.price || 0) * Number(item.quantity || 0), currency)}</div>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="button" className="store-button-ghost store-remove" onClick={() => removeItem(item.productId)}>
                    Quitar
                  </button>
                </div>
              </article>
            ))}
          </section>

          <aside className="store-summary">
            <div>
              <div className="store-section-title">Resumen de compra</div>
              <div className="store-section-copy">Una vista limpia tipo ecommerce para revisar antes de pagar.</div>
            </div>

            <div className="store-panel-soft">
              <div className="store-summary-row">
                <span>Productos</span>
                <strong>{totalItems}</strong>
              </div>
              <div className="store-summary-row">
                <span>Subtotal</span>
                <strong>{formatMoney(subtotal, currency)}</strong>
              </div>
            </div>

            <div className="store-notice">
              El envio se calcula en el checkout segun departamento y municipio.
            </div>

            {storeSettings?.checkoutEnabled !== false ? (
              <button type="button" className="store-button store-button-full" onClick={() => navigate('/tienda/checkout')}>
                Continuar al checkout
              </button>
            ) : (
              <div className="store-notice">
                El checkout web está desactivado desde la configuración de Tienda en Línea.
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
