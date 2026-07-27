import React, { useEffect, useMemo, useState } from 'react'
import { useConfigStore } from '../store/config'
import { formatMoney } from '../utils/currency'
import { getProducts, getCategories, getBrands, getSuppliers, getDepartments, getUnits, getDailySales, getUpcomingCredits, getUpcomingCreditsList, getSalesSummary } from '../api'

interface Product {
  id: number
  name: string
  price: number
  cost?: number
  stock: number
  minStock?: number
}

export default function Dashboard() {
  const currency = useConfigStore(s => s.config?.currency || 'USD')

  const [loading, setLoading] = useState(true)
  const [isMobileViewport, setIsMobileViewport] = useState(false)
  const [products, setProducts] = useState<Product[]>([])
  const [counts, setCounts] = useState({
    categories: 0,
    brands: 0,
    suppliers: 0,
    departments: 0,
    units: 0,
  })
  const [dailySales, setDailySales] = useState(0)
  const [creditsDue, setCreditsDue] = useState(0)
  const [upcomingCredits, setUpcomingCredits] = useState<{ id: number; saleId: number; dueDate: string; amount: number; docNo: string; saleTotal: number; customerName: string }[]>([])
  const [salesPeriod, setSalesPeriod] = useState<'HOY' | 'SEMANA' | 'MES'>('HOY')
  const [creditsDays, setCreditsDays] = useState<number>(7)
  const [customStart, setCustomStart] = useState<string>('')
  const [customEnd, setCustomEnd] = useState<string>('')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [prod, cats, brands, sups, deps, units, sales, credits] = await Promise.all([
          getProducts(),
          getCategories(),
          getBrands(),
          getSuppliers(),
          getDepartments(),
          getUnits(),
          getDailySales(),
          getUpcomingCredits(7),
        ])
        setProducts(prod || [])
        setCounts({
          categories: Array.isArray(cats) ? cats.length : 0,
          brands: Array.isArray(brands) ? brands.length : 0,
          suppliers: Array.isArray(sups) ? sups.length : 0,
          departments: Array.isArray(deps) ? deps.length : 0,
          units: Array.isArray(units) ? units.length : 0,
        })
        setDailySales(Number(sales?.total || 0))
        setCreditsDue(Number(credits?.count || 0))
        try {
          const list = await getUpcomingCreditsList(creditsDays, 10)
          setUpcomingCredits(Array.isArray(list?.items) ? list.items : [])
        } catch {}
      } catch (err) {
        // Silenciar errores en Dashboard, se puede agregar toast si está disponible
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)')
    const syncViewport = () => setIsMobileViewport(mediaQuery.matches)
    syncViewport()
    mediaQuery.addEventListener('change', syncViewport)
    return () => mediaQuery.removeEventListener('change', syncViewport)
  }, [])

  useEffect(() => {
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    const today = new Date()
    let start: string
    let end: string
    if (customStart && customEnd) {
      start = (customStart || '').slice(0, 10)
      end = (customEnd || '').slice(0, 10)
    } else {
      start = fmt(today)
      end = fmt(today)
      if (salesPeriod === 'SEMANA') {
        const d = new Date()
        d.setDate(d.getDate() - 6)
        start = fmt(d)
        end = fmt(today)
      } else if (salesPeriod === 'MES') {
        const d = new Date(today.getFullYear(), today.getMonth(), 1)
        start = fmt(d)
        end = fmt(today)
      }
    }
    ;(async () => {
      try {
        const s = await getSalesSummary(start, end)
        setDailySales(Number(s?.total || 0))
      } catch {}
    })()
  }, [salesPeriod, customStart, customEnd])

  useEffect(() => {
    ;(async () => {
      try {
        const c = await getUpcomingCredits(creditsDays)
        setCreditsDue(Number(c?.count || 0))
      } catch {}
      try {
        const list = await getUpcomingCreditsList(creditsDays, 10)
        setUpcomingCredits(Array.isArray(list?.items) ? list.items : [])
      } catch {}
    })()
  }, [creditsDays])

  const metrics = useMemo(() => {
    const totalProducts = products.length
    const lowStock = products.filter(p => typeof p.minStock === 'number' && p.minStock! > 0 && p.stock <= (p.minStock || 0)).length
    const zeroStock = products.filter(p => p.stock <= 0).length
    const inventoryValue = products.reduce((acc, p) => acc + (Number(p.cost || 0) * Number(p.stock || 0)), 0)
    const potentialRevenue = products.reduce((acc, p) => acc + (Number(p.price || 0) * Number(p.stock || 0)), 0)
    return { totalProducts, lowStock, zeroStock, inventoryValue, potentialRevenue }
  }, [products])

  const topLowStock = useMemo(() => {
    return products
      .filter(p => typeof p.minStock === 'number' && p.minStock! > 0)
      .sort((a, b) => (a.stock - (a.minStock || 0)) - (b.stock - (b.minStock || 0)))
      .slice(0, 5)
  }, [products])

  const recentProducts = useMemo(() => {
    // La API devuelve productos ordenados por id DESC
    return products.slice(0, 5)
  }, [products])

  const renderMobileMetricList = (
    items: Array<React.ReactNode>,
    emptyText: string
  ) => {
    if (items.length === 0) {
      return <div className="muted" style={{ padding: 10 }}>{emptyText}</div>
    }
    return <div style={{ display: 'grid', gap: 10 }}>{items}</div>
  }

  return (
    <div className="page-shell page-shell--narrow">
      <div className="page-toolbar" style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Dashboard</h2>
        
        {/* Filtros de Fecha */}
        <div style={{ display: 'flex', flexDirection: isMobileViewport ? 'column' : 'row', gap: 10, alignItems: isMobileViewport ? 'stretch' : 'center', background: 'var(--modal)', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', width: isMobileViewport ? '100%' : 'auto' }}>
            <select 
                value={salesPeriod} 
                onChange={e => setSalesPeriod(e.target.value as any)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text)', fontWeight: 600, cursor: 'pointer', width: isMobileViewport ? '100%' : 'auto' }}
            >
                <option value="HOY">Hoy</option>
                <option value="SEMANA">Esta Semana</option>
                <option value="MES">Este Mes</option>
            </select>
            {/* Custom Range Logic (simplified for UI) */}
            {(salesPeriod === 'HOY' || salesPeriod === 'SEMANA' || salesPeriod === 'MES') && (
                <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                    {/* Could show dates here */}
                </div>
            )}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Cargando métricas...</div>
      ) : (
        <>
          {/* Main KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobileViewport ? '1fr' : 'repeat(auto-fit, minmax(200px, 1fr))', gap: 15, marginBottom: 20 }}>
            <StatCard title="Ventas del Periodo" value={formatMoney(dailySales, currency)} color="#22c55e" highlight style={{ gridColumn: isMobileViewport ? 'auto' : 'span 2' }} />
            <StatCard title="Valor Inventario (Costo)" value={formatMoney(metrics.inventoryValue, currency)} color="#3b82f6" />
            <StatCard title="Valor Potencial (Venta)" value={formatMoney(metrics.potentialRevenue, currency)} color="#8b5cf6" />
            <StatCard title="Créditos por Cobrar" value={creditsDue} color="#eab308" />
          </div>

          {/* Secondary KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobileViewport ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(150px, 1fr))', gap: 15, marginBottom: 20 }}>
            <StatCard title="Total Productos" value={metrics.totalProducts} color="#64748b" small />
            <StatCard title="Stock Bajo" value={metrics.lowStock} color="#ef4444" small />
            <StatCard title="Sin Stock" value={metrics.zeroStock} color="#dc2626" small />
            <StatCard title="Categorías" value={counts.categories} color="#64748b" small />
            <StatCard title="Marcas" value={counts.brands} color="#64748b" small />
            <StatCard title="Proveedores" value={counts.suppliers} color="#64748b" small />
          </div>

          {/* Tables Grid */}
          <div className="responsive-stats-grid">
            
            {/* Low Stock Table */}
            <div className="card">
              <h3>Productos con Stock Bajo</h3>
              {isMobileViewport ? renderMobileMetricList(
                topLowStock.map(p => (
                  <div key={p.id} style={{ background: 'var(--surface)', borderRadius: 10, padding: 12, display: 'grid', gap: 6 }}>
                    <div style={{ fontWeight: 700 }}>{p.name}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '0.9rem' }}>
                      <span>Stock: <strong style={{ color: '#ef4444' }}>{p.stock}</strong></span>
                      <span style={{ color: 'var(--muted)' }}>Min: {p.minStock}</span>
                    </div>
                  </div>
                )),
                'Todo en orden.'
              ) : topLowStock.length === 0 ? (
                <div className="muted" style={{ padding: 10 }}>Todo en orden.</div>
              ) : (
                <div className="table-scroll">
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left', fontSize: '0.85rem' }}>
                        <th style={{ padding: 8 }}>Producto</th>
                        <th style={{ padding: 8, textAlign: 'right' }}>Stock</th>
                        <th style={{ padding: 8, textAlign: 'right' }}>Mín</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topLowStock.map(p => (
                        <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: 8 }}>{p.name}</td>
                          <td style={{ padding: 8, textAlign: 'right', fontWeight: 'bold', color: '#ef4444' }}>{p.stock}</td>
                          <td style={{ padding: 8, textAlign: 'right', color: 'var(--muted)' }}>{p.minStock}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Upcoming Credits */}
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobileViewport ? 'stretch' : 'center', flexDirection: isMobileViewport ? 'column' : 'row', gap: 10, marginBottom: 10 }}>
                <h3 style={{ margin: 0 }}>Vencimientos de Crédito</h3>
                <select 
                    value={creditsDays} 
                    onChange={e => setCreditsDays(Number(e.target.value))}
                    style={{ fontSize: '0.8rem', padding: 4, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', width: isMobileViewport ? '100%' : 'auto' }}
                >
                    <option value={7}>7 días</option>
                    <option value={14}>14 días</option>
                    <option value={30}>30 días</option>
                </select>
              </div>
              {isMobileViewport ? renderMobileMetricList(
                upcomingCredits.map(i => (
                  <div key={i.id} style={{ background: 'var(--surface)', borderRadius: 10, padding: 12, display: 'grid', gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <strong>{i.customerName}</strong>
                      <span style={{ fontWeight: 700 }}>{formatMoney(i.amount, currency)}</span>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{i.dueDate}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>{i.docNo || `V-${i.saleId}`}</div>
                  </div>
                )),
                'Sin vencimientos próximos.'
              ) : upcomingCredits.length === 0 ? (
                <div className="muted" style={{ padding: 10 }}>Sin vencimientos próximos.</div>
              ) : (
                <div className="table-scroll">
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left', fontSize: '0.85rem' }}>
                        <th style={{ padding: 8 }}>Fecha</th>
                        <th style={{ padding: 8 }}>Cliente</th>
                        <th style={{ padding: 8, textAlign: 'right' }}>Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {upcomingCredits.map(i => (
                        <tr key={i.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: 8, fontSize: '0.9rem' }}>{i.dueDate}</td>
                          <td style={{ padding: 8, fontSize: '0.9rem' }}>
                              <div>{i.customerName}</div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>{i.docNo || `V-${i.saleId}`}</div>
                          </td>
                          <td style={{ padding: 8, textAlign: 'right', fontWeight: 600 }}>{formatMoney(i.amount, currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Recent Products */}
            <div className="card">
              <h3>Productos Recientes</h3>
              {isMobileViewport ? renderMobileMetricList(
                recentProducts.map(p => (
                  <div key={p.id} style={{ background: 'var(--surface)', borderRadius: 10, padding: 12, display: 'grid', gap: 6 }}>
                    <div style={{ fontWeight: 700 }}>{p.name}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '0.9rem' }}>
                      <span>{formatMoney(p.price, currency)}</span>
                      <span style={{ color: 'var(--muted)' }}>Stock: {p.stock}</span>
                    </div>
                  </div>
                )),
                'Sin productos recientes.'
              ) : (
              <div className="table-scroll">
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left', fontSize: '0.85rem' }}>
                      <th style={{ padding: 8 }}>Producto</th>
                      <th style={{ padding: 8, textAlign: 'right' }}>Precio</th>
                      <th style={{ padding: 8, textAlign: 'right' }}>Stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentProducts.map(p => (
                      <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: 8 }}>{p.name}</td>
                        <td style={{ padding: 8, textAlign: 'right' }}>{formatMoney(p.price, currency)}</td>
                        <td style={{ padding: 8, textAlign: 'right' }}>{p.stock}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
            </div>

          </div>
        </>
      )}
    </div>
  )
}

function StatCard({ title, value, color, highlight, small, style }: any) {
    return (
        <div className="card" style={{ 
            borderLeft: `4px solid ${color}`, 
            background: highlight ? 'rgba(234, 179, 8, 0.05)' : undefined,
            padding: small ? '12px' : '20px',
            ...style
        }}>
            <div style={{ fontSize: small ? '0.8rem' : '0.9rem', color: 'var(--muted)', marginBottom: 5 }}>{title}</div>
            <div style={{ fontSize: small ? '1.2rem' : '1.8rem', fontWeight: 'bold', color: 'var(--text)' }}>
                {value}
            </div>
        </div>
    )
}
