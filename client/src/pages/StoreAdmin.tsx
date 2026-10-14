import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { api } from '../api'
import { useConfigStore } from '../store/config'
import { formatCompanyName } from '../utils/text'
import { resolveUploadedAssetUrl } from '../utils/assets'
import { buildStoreEntryUrl, buildStorePublicBasePath, isStoreCustomDomainDevelopmentValue } from '../utils/storePublicLink'

type StoreAdminSettings = {
  currency: string
  catalogEnabled: boolean
  cartEnabled: boolean
  checkoutEnabled: boolean
  favoritesEnabled: boolean
  recommendationsEnabled: boolean
  bannerProductIds: Array<number | null>
  onlinePricingMode: 'PRICE3' | 'COST_PLUS_PERCENT'
  onlineCostAdjustmentPercent: number
  onlineWarehouseId: number
  cutoffTime: string
  acceptAfterCutoff: string
  pickupEnabled: boolean
  deliveryEnabled: boolean
  pickupNotes: string
  publicSlug: string
  publicPath: string
  customDomain: string
  storefrontUrl?: string
}

type DomainValidationState = {
  checking: boolean
  ok: boolean | null
  dnsReady: boolean | null
  message: string | null
}

type BannerProductOption = {
  id: number
  name: string
  sku: string
  imageUrl: string | null
  price: number
}

type ProductPricingOverride = {
  productId: number
  adjustmentPercent: number
  name?: string
  sku?: string
  imageUrl?: string | null
  effectivePrice?: number
}

const panelStyle: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 20,
  background: 'var(--modal)',
  padding: 18,
  display: 'grid',
  gap: 14,
}

const cardStyle: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 16,
  background: 'var(--bg)',
  padding: 14,
  display: 'grid',
  gap: 8,
}

const previewStyle: CSSProperties = {
  ...cardStyle,
  gridTemplateColumns: '120px 1fr',
  alignItems: 'center',
  gap: 16,
}

function toBannerSlots(input: unknown) {
  const values = Array.isArray(input) ? input : []
  const normalized = values
    .map((value) => {
      const id = Number(value || 0)
      return Number.isInteger(id) && id > 0 ? id : null
    })
    .slice(0, 4)

  while (normalized.length < 4) normalized.push(null)
  return normalized
}

export default function StoreAdmin() {
  const config = useConfigStore(s => s.config)
  const title = useMemo(() => formatCompanyName(config?.name || 'TIENDA'), [config?.name])
  const [settings, setSettings] = useState<StoreAdminSettings | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [bannerProducts, setBannerProducts] = useState<BannerProductOption[]>([])
  const [productPricingOverrides, setProductPricingOverrides] = useState<ProductPricingOverride[]>([])
  const [overrideProductId, setOverrideProductId] = useState<number | ''>('')
  const [overrideProductSearch, setOverrideProductSearch] = useState('')
  const [overrideAdjustmentPercent, setOverrideAdjustmentPercent] = useState<string>('')
  const [domainValidation, setDomainValidation] = useState<DomainValidationState>({
    checking: false,
    ok: null,
    dnsReady: null,
    message: null,
  })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        setError(null)
        const [{ data }, { data: productData }, { data: overrideData }] = await Promise.all([
          api.get('/store/admin/settings'),
          api.get('/store/admin/banner-products'),
          api.get('/store/admin/product-pricing-overrides'),
        ])
        if (!cancelled) {
          setSettings({
            ...data,
            bannerProductIds: toBannerSlots(data?.bannerProductIds ?? (data?.bannerProductId ? [data.bannerProductId] : [])),
          })
          setBannerProducts(Array.isArray(productData) ? productData : [])
          setProductPricingOverrides(Array.isArray(overrideData) ? overrideData : [])
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.response?.data?.error || 'No se pudo cargar la configuración de tienda en línea')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  function onToggle<K extends keyof StoreAdminSettings>(key: K, value: StoreAdminSettings[K]) {
    setSettings(prev => prev ? { ...prev, [key]: value } : prev)
  }

  function updateBannerSlot(index: number, value: number | null) {
    setSettings(prev => {
      if (!prev) return prev
      const bannerProductIds = [...toBannerSlots(prev.bannerProductIds)]
      bannerProductIds[index] = value
      return { ...prev, bannerProductIds }
    })
  }

  const selectedBannerProducts = useMemo(
    () => toBannerSlots(settings?.bannerProductIds).map((productId, index) => ({
      slot: index + 1,
      product: bannerProducts.find((product) => product.id === productId) || null,
    })),
    [bannerProducts, settings?.bannerProductIds]
  )

  const productOptionsById = useMemo(
    () => new Map(bannerProducts.map((product) => [product.id, product])),
    [bannerProducts]
  )

  const resolvedProductPricingOverrides = useMemo(
    () => productPricingOverrides.map((item) => {
      const product = productOptionsById.get(item.productId)
      return {
        ...item,
        name: item.name || product?.name || `Producto #${item.productId}`,
        sku: item.sku || product?.sku || '',
        imageUrl: item.imageUrl ?? product?.imageUrl ?? null,
      }
    }),
    [productOptionsById, productPricingOverrides]
  )
  const publicStorePath = useMemo(
    () => settings?.publicPath || buildStorePublicBasePath(settings?.publicSlug),
    [settings?.publicPath, settings?.publicSlug]
  )
  const publicStoreUrl = useMemo(() => {
    if (!settings) return ''
    return buildStoreEntryUrl({
      slug: settings.publicSlug,
      customDomain: settings.customDomain,
      origin: typeof window === 'undefined' ? '' : window.location.origin,
    })
  }, [settings, publicStorePath])

  const filteredOverrideProducts = useMemo(() => {
    const search = overrideProductSearch.trim().toLowerCase()
    if (!search) return bannerProducts
    return bannerProducts.filter((product) => {
      const name = String(product.name || '').toLowerCase()
      const sku = String(product.sku || '').toLowerCase()
      const id = String(product.id || '')
      return name.includes(search) || sku.includes(search) || id.includes(search)
    })
  }, [bannerProducts, overrideProductSearch])

  useEffect(() => {
    if (!settings) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        setDomainValidation((prev) => ({ ...prev, checking: true, message: null }))
        const { data } = await api.get('/store/admin/validate-domain', {
          params: { domain: settings.customDomain || '' },
        })
        if (!cancelled) {
          setDomainValidation({
            checking: false,
            ok: Boolean(data?.ok),
            dnsReady: data?.dnsReady ?? null,
            message: data?.message || null,
          })
        }
      } catch (e: any) {
        if (!cancelled) {
          setDomainValidation({
            checking: false,
            ok: false,
            dnsReady: false,
            message: e?.response?.data?.message || e?.response?.data?.error || 'No se pudo validar el dominio de la tienda.',
          })
        }
      }
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [settings?.customDomain])

  function addOrUpdateProductOverride() {
    const productId = Number(overrideProductId || 0)
    const adjustmentPercent = Number(overrideAdjustmentPercent || 0)
    if (!productId) {
      setError('Selecciona un producto para aplicar un ajuste individual.')
      return
    }
    if (!Number.isFinite(adjustmentPercent)) {
      setError('El ajuste individual debe ser numérico.')
      return
    }

    const product = productOptionsById.get(productId)
    setError(null)
    setMessage(null)
    setProductPricingOverrides((prev) => {
      const next = prev.filter((item) => item.productId !== productId)
      next.push({
        productId,
        adjustmentPercent,
        name: product?.name || `Producto #${productId}`,
        sku: product?.sku || '',
        imageUrl: product?.imageUrl || null,
      })
      return next.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'))
    })
    setOverrideProductId('')
    setOverrideProductSearch('')
    setOverrideAdjustmentPercent('')
  }

  function removeProductOverride(productId: number) {
    setMessage(null)
    setProductPricingOverrides((prev) => prev.filter((item) => item.productId !== productId))
  }

  async function save() {
    if (!settings) return
    try {
      setSaving(true)
      setError(null)
      setMessage(null)
      const payload = {
        ...settings,
        bannerProductIds: toBannerSlots(settings.bannerProductIds).filter((id): id is number => Number(id || 0) > 0),
      }
      const { data } = await api.put('/store/admin/settings', payload)
      const { data: overrideData } = await api.put('/store/admin/product-pricing-overrides', {
        overrides: productPricingOverrides.map((item) => ({
          productId: item.productId,
          adjustmentPercent: item.adjustmentPercent,
        })),
      })
      setSettings({
        ...data,
        bannerProductIds: toBannerSlots(data?.bannerProductIds ?? (data?.bannerProductId ? [data.bannerProductId] : [])),
      })
      setProductPricingOverrides(Array.isArray(overrideData) ? overrideData : [])
      setMessage('Configuración de tienda en línea guardada correctamente.')
    } catch (e: any) {
      setError(e?.response?.data?.error || 'No se pudo guardar la configuración')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28 }}>Tienda en Línea</h1>
          <div style={{ color: 'var(--muted)', marginTop: 6 }}>
            Módulo separado para administrar la web pública sin mezclarlo con POS, inventario o caja.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <a href={publicStoreUrl || publicStorePath || '/tienda'} className="btn secondary" target="_blank" rel="noreferrer">Ver tienda pública</a>
          <button type="button" className="btn" onClick={save} disabled={!settings || saving}>
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </div>

      {error ? <div className="badge danger">{error}</div> : null}
      {message ? <div className="badge success">{message}</div> : null}
      {loading ? <div className="badge">Cargando configuración...</div> : null}

      {settings ? (
        <>
          <section style={panelStyle}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>Enlace público de la tienda</div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                Define un alias exclusivo para abrir la tienda desde una URL separada del sistema administrativo.
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 360px) minmax(320px, 1fr)', gap: 12 }}>
              <label style={cardStyle}>
                <div style={{ fontWeight: 700 }}>Alias del enlace público</div>
                <input
                  value={settings.publicSlug}
                  onChange={(e) => onToggle('publicSlug', e.target.value)}
                  placeholder="mi-tienda"
                  autoComplete="off"
                />
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                  Usa un alias corto y recordable. Se permiten letras, números y guiones medios.
                </div>
              </label>

              <div style={cardStyle}>
                <div style={{ fontWeight: 700 }}>Vista previa del enlace</div>
                <div style={{ fontFamily: 'monospace', fontSize: 14, wordBreak: 'break-all' }}>
                  {publicStoreUrl || 'Se generará al guardar'}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                  La ruta pública resultante abrirá solo la tienda online y ayudará a evitar accesos al sistema interno.
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 360px) minmax(320px, 1fr)', gap: 12 }}>
              <label style={cardStyle}>
                <div style={{ fontWeight: 700 }}>Dominio personalizado</div>
                <input
                  value={settings.customDomain}
                  onChange={(e) => onToggle('customDomain', e.target.value)}
                  placeholder="dtmtiendaonline.com"
                  autoComplete="off"
                />
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                  En producción usa solo el dominio o subdominio. En desarrollo también puedes usar `localhost:5173`.
                </div>
              </label>

              <div style={cardStyle}>
                <div style={{ fontWeight: 700 }}>Estado del dominio</div>
                <div style={{ fontSize: 14, color: domainValidation.ok === false ? '#b91c1c' : domainValidation.dnsReady === false ? '#92400e' : 'var(--text)' }}>
                  {domainValidation.checking
                    ? 'Validando dominio...'
                    : domainValidation.message || 'Sin validación todavía.'}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                  {settings.customDomain
                    ? (isStoreCustomDomainDevelopmentValue(settings.customDomain)
                      ? 'Modo desarrollo detectado. Se asumirá protocolo HTTP.'
                      : 'Si el DNS todavía no apunta al servidor, la tienda podrá guardarse pero no publicarse hasta completar la propagación.')
                    : 'Si dejas este campo vacío, la tienda seguirá usando la ruta interna por alias.'}
                </div>
              </div>
            </div>
          </section>

          <section style={panelStyle}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>Funciones web</div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>Activa solo lo que realmente usarás en la página web.</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
              {[
                ['catalogEnabled', 'Catálogo web', 'Muestra u oculta el listado público de productos.'],
                ['cartEnabled', 'Carrito', 'Permite agregar productos al carrito desde la tienda.'],
                ['checkoutEnabled', 'Checkout', 'Permite continuar del carrito al formulario de pedido.'],
                ['favoritesEnabled', 'Favoritos', 'Muestra corazones, wishlist y filtro de favoritos.'],
                ['recommendationsEnabled', 'Recomendaciones', 'Muestra recién ingreso, más vendidos y relacionados.'],
              ].map(([key, label, description]) => (
                <label key={key} style={cardStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{label}</div>
                      <div style={{ color: 'var(--muted)', fontSize: 13 }}>{description}</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={Boolean(settings[key as keyof StoreAdminSettings])}
                      onChange={(e) => onToggle(key as keyof StoreAdminSettings, e.target.checked as never)}
                    />
                  </div>
                </label>
              ))}
            </div>
          </section>

          <section style={panelStyle}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>Precio web general</div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                Ajusta el precio solo para la tienda en línea sin modificar los precios ni costos del sistema interno.
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
              <label style={cardStyle}>
                <div style={{ fontWeight: 700 }}>Modo de precio online</div>
                <select
                  value={settings.onlinePricingMode}
                  onChange={(e) => onToggle('onlinePricingMode', e.target.value as StoreAdminSettings['onlinePricingMode'])}
                >
                  <option value="PRICE3">Usar precio 3 del sistema</option>
                  <option value="COST_PLUS_PERCENT">Tomar costo y aplicar ajuste %</option>
                </select>
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                  La segunda opción calcula el precio web desde `avg_cost` o `cost`.
                </div>
              </label>

              <label style={cardStyle}>
                <div style={{ fontWeight: 700 }}>Ajuste general sobre costo (%)</div>
                <input
                  type="number"
                  step="0.01"
                  value={settings.onlineCostAdjustmentPercent}
                  onChange={(e) => onToggle('onlineCostAdjustmentPercent', Number(e.target.value || 0))}
                  disabled={settings.onlinePricingMode !== 'COST_PLUS_PERCENT'}
                />
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                  Usa positivo para recargo y negativo para descuento. Ejemplo: `20` = costo + 20%, `-10` = costo - 10%.
                </div>
              </label>
            </div>

            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
              Formula actual: {settings.onlinePricingMode === 'COST_PLUS_PERCENT'
                ? `Precio web = costo del sistema x ${(1 + (Number(settings.onlineCostAdjustmentPercent || 0) / 100)).toFixed(4)}`
                : 'Precio web = price3 del sistema'}
            </div>
          </section>

          <section style={panelStyle}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>Excepciones por producto</div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                El ajuste general aplica a todos. Si aquí configuras un producto manualmente, ese producto ignora el ajuste general y usa su propio porcentaje.
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1.2fr) minmax(280px, 1.6fr) minmax(180px, 0.7fr) auto', gap: 12, alignItems: 'end' }}>
              <label style={cardStyle}>
                <div style={{ fontWeight: 700 }}>Buscar producto</div>
                <input
                  value={overrideProductSearch}
                  onChange={(e) => setOverrideProductSearch(e.target.value)}
                  placeholder="Escribe nombre, SKU o ID"
                  disabled={settings.onlinePricingMode !== 'COST_PLUS_PERCENT'}
                />
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                  Coincidencias: {filteredOverrideProducts.length}
                </div>
              </label>

              <label style={cardStyle}>
                <div style={{ fontWeight: 700 }}>Producto filtrado</div>
                <select value={overrideProductId} onChange={(e) => setOverrideProductId(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">-- Selecciona un producto --</option>
                  {filteredOverrideProducts.map((product) => (
                    <option key={`override-product-${product.id}`} value={product.id}>
                      {product.name}{product.sku ? ` | ${product.sku}` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label style={cardStyle}>
                <div style={{ fontWeight: 700 }}>Ajuste individual (%)</div>
                <input
                  type="number"
                  step="0.01"
                  value={overrideAdjustmentPercent}
                  onChange={(e) => setOverrideAdjustmentPercent(e.target.value)}
                  placeholder="0"
                  disabled={settings.onlinePricingMode !== 'COST_PLUS_PERCENT'}
                />
              </label>

              <button
                type="button"
                className="btn secondary"
                onClick={addOrUpdateProductOverride}
                disabled={settings.onlinePricingMode !== 'COST_PLUS_PERCENT'}
              >
                Agregar
              </button>
            </div>

            <div style={{ color: 'var(--muted)', fontSize: 12 }}>
              Estas excepciones solo se aplican cuando el modo general está en `Tomar costo y aplicar ajuste %`.
            </div>

            {resolvedProductPricingOverrides.length ? (
              <div style={{ display: 'grid', gap: 12 }}>
                {resolvedProductPricingOverrides.map((item) => (
                  <div
                    key={`product-override-${item.productId}`}
                    style={{
                      ...previewStyle,
                      gridTemplateColumns: '96px 1fr auto',
                    }}
                  >
                    <div
                      style={{
                        width: 96,
                        height: 96,
                        borderRadius: 16,
                        overflow: 'hidden',
                        border: '1px solid var(--border)',
                        background: 'var(--modal)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {item.imageUrl ? (
                        <img
                          src={resolveUploadedAssetUrl(item.imageUrl)}
                          alt={item.name || `Producto ${item.productId}`}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <div style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center', padding: 10 }}>
                          Sin imagen
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'grid', gap: 4 }}>
                      <div style={{ fontWeight: 700 }}>{item.name}</div>
                      <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                        SKU: {item.sku || 'SIN SKU'}
                      </div>
                      <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                        Ajuste individual: {Number(item.adjustmentPercent || 0).toFixed(2)}%
                      </div>
                      {typeof item.effectivePrice === 'number' ? (
                        <div style={{ fontWeight: 700 }}>
                          Precio online actual: {settings.currency} {Number(item.effectivePrice || 0).toFixed(2)}
                        </div>
                      ) : null}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => removeProductOverride(item.productId)}
                      >
                        Quitar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                No hay excepciones individuales. En este momento todos los productos usan el ajuste general.
              </div>
            )}
          </section>

          <section style={panelStyle}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>Banners principales</div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                Configura manualmente hasta 4 banners del carrusel principal y define el orden exacto en que aparecerán.
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
              {toBannerSlots(settings.bannerProductIds).map((productId, index) => (
                <label key={`banner-slot-${index + 1}`} style={cardStyle}>
                  <div style={{ fontWeight: 700 }}>Banner {index + 1}</div>
                  <select
                    value={productId || ''}
                    onChange={(e) => updateBannerSlot(index, e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">-- Sin asignar --</option>
                    {bannerProducts.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}{product.sku ? ` | ${product.sku}` : ''}
                      </option>
                    ))}
                  </select>
                  <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                    El orden del slot define el orden del carrusel en la portada.
                  </div>
                </label>
              ))}
            </div>

            {selectedBannerProducts.some((item) => item.product) ? (
              <div style={{ display: 'grid', gap: 12 }}>
                {selectedBannerProducts.map(({ slot, product }) => product ? (
                  <div key={`banner-preview-${slot}`} style={previewStyle}>
                    <div
                      style={{
                        width: 120,
                        height: 120,
                        borderRadius: 16,
                        overflow: 'hidden',
                        border: '1px solid var(--border)',
                        background: 'var(--modal)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {product.imageUrl ? (
                        <img
                          src={resolveUploadedAssetUrl(product.imageUrl)}
                          alt={product.name}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <div style={{ color: 'var(--muted)', fontSize: 12, textAlign: 'center', padding: 10 }}>
                          Sin imagen
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'grid', gap: 6 }}>
                      <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                        Vista previa banner {slot}
                      </div>
                      <div><strong>{product.name}</strong></div>
                      <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                        SKU: {product.sku || 'SIN SKU'}
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>
                        {settings.currency} {Number(product.price || 0).toFixed(2)}
                      </div>
                    </div>
                  </div>
                ) : null)}
              </div>
            ) : (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                Si no asignas banners manuales, la tienda seguirá usando la lógica automática de productos destacados.
              </div>
            )}
          </section>

          <section style={panelStyle}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>Operación web</div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>Define cómo funciona pickup, delivery y el corte de pedidos.</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
              <label style={cardStyle}>
                <div style={{ fontWeight: 700 }}>Moneda heredada del sistema</div>
                <input value={settings.currency} readOnly />
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>La moneda se toma de la configuración general.</div>
              </label>

              <label style={cardStyle}>
                <div style={{ fontWeight: 700 }}>Almacén para tienda online</div>
                <input
                  type="number"
                  value={settings.onlineWarehouseId}
                  onChange={(e) => onToggle('onlineWarehouseId', Number(e.target.value || 1))}
                />
              </label>

              <label style={cardStyle}>
                <div style={{ fontWeight: 700 }}>Hora de corte</div>
                <input
                  value={settings.cutoffTime}
                  onChange={(e) => onToggle('cutoffTime', e.target.value)}
                  placeholder="11:00:00"
                />
              </label>

              <label style={cardStyle}>
                <div style={{ fontWeight: 700 }}>Acción después del corte</div>
                <select
                  value={settings.acceptAfterCutoff}
                  onChange={(e) => onToggle('acceptAfterCutoff', e.target.value)}
                >
                  <option value="SCHEDULE">PROGRAMAR</option>
                  <option value="REJECT">RECHAZAR</option>
                </select>
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
              <label style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>Pickup activo</div>
                    <div style={{ color: 'var(--muted)', fontSize: 13 }}>Permite pedidos para recoger en tienda.</div>
                  </div>
                  <input type="checkbox" checked={settings.pickupEnabled} onChange={(e) => onToggle('pickupEnabled', e.target.checked)} />
                </div>
              </label>

              <label style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>Delivery activo</div>
                    <div style={{ color: 'var(--muted)', fontSize: 13 }}>Permite pedidos con envío a domicilio.</div>
                  </div>
                  <input type="checkbox" checked={settings.deliveryEnabled} onChange={(e) => onToggle('deliveryEnabled', e.target.checked)} />
                </div>
              </label>
            </div>

            <label style={cardStyle}>
              <div style={{ fontWeight: 700 }}>Notas para pickup</div>
              <textarea
                rows={4}
                value={settings.pickupNotes}
                onChange={(e) => onToggle('pickupNotes', e.target.value)}
                placeholder="Instrucciones para recoger en tienda"
              />
            </label>
          </section>

          <section style={panelStyle}>
            <div style={{ fontWeight: 800, fontSize: 18 }}>Separación con el sistema interno</div>
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
              {title} ahora puede manejar la web pública como un módulo aparte. El POS, inventario y caja siguen compartiendo datos,
              pero la experiencia pública se controla aquí con sus propios switches.
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}
