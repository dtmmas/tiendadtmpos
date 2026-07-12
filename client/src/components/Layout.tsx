import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuthStore } from '../store/auth'
import { useConfigStore } from '../store/config'
import { useThemeStore } from '../store/theme'
import { formatCompanyName } from '../utils/text'

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout, hasPermission, canSell } = useAuthStore()
  const config = useConfigStore(s => s.config)
  const { mode, setMode } = useThemeStore()
  const companyName = formatCompanyName(config?.name)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  const canManageProducts = String(user?.role || '').toUpperCase() === 'ADMIN' || hasPermission('products:write')
  const productsMenuLabel = canManageProducts ? 'Productos' : 'Catalogo de productos'

  const openPOSWindow = (event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault()
    event?.stopPropagation()

    const posUrl = new URL('/pos', window.location.origin).toString()
    const anchor = document.createElement('a')
    anchor.href = posUrl
    anchor.target = 'dtmpos-pos-window'
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)

    setMobileMenuOpen(false)
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand" onClick={() => navigate('/') }>
          {config?.logoUrl && <img src={config.logoUrl} alt="logo" />}
          <div>
            <strong>{companyName}</strong>
            <small>{config?.currency ?? 'USD'}</small>
          </div>
        </div>
        <nav className="nav nav-desktop">
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
              <polyline points="9 22 9 12 15 12 15 22"></polyline>
            </svg>
            <span>DASHBOARD</span>
          </Link>
          {canSell() && (
            <button
              type="button"
              onClick={openPOSWindow}
              style={{ fontWeight: 'bold', color: '#2ecc71', display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(46, 204, 113, 0.1)', padding: '6px 12px', borderRadius: '8px', border: 'none', cursor: 'pointer' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <path d="M16 10a4 4 0 0 1-8 0"></path>
              </svg>
              <span>VENTAS / POS</span>
            </button>
          )}

          {(hasPermission('cash:view') || hasPermission('cash:open') || hasPermission('cash:movements') || hasPermission('cash:close') || hasPermission('sales:create')) && (
            <Link to="/cash-register" style={{ fontWeight: 'bold', color: '#eab308', display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(234, 179, 8, 0.1)', padding: '6px 12px', borderRadius: '8px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="6" width="20" height="12" rx="2"></rect>
                <circle cx="12" cy="12" r="2"></circle>
                <path d="M6 12h.01M18 12h.01"></path>
              </svg>
              <span>CAJA</span>
            </Link>
          )}
          {(hasPermission('credits:read') || hasPermission('purchases:read')) && (
            <div className="nav-group">
              <button className="nav-trigger" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                  <polyline points="2 17 12 22 22 17"></polyline>
                  <polyline points="2 12 12 17 22 12"></polyline>
                </svg>
                <span>PROCESOS</span>
              </button>
              <div className="nav-panel">
                {hasPermission('credits:read') && <Link to="/credits">Créditos</Link>}
                {hasPermission('purchases:read') && <Link to="/purchases">Compras</Link>}
              </div>
            </div>
          )}

          {(hasPermission('products:read') || hasPermission('customers:read') || hasPermission('categories:read') || hasPermission('brands:read') || hasPermission('departments:read') || hasPermission('units:read') || hasPermission('suppliers:read')) && (
          <div className="nav-group">
            <button className="nav-trigger" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
              </svg>
              <span>CATÁLOGO</span>
            </button>
            <div className="nav-panel">
              {hasPermission('products:read') && <Link to="/products">{productsMenuLabel}</Link>}
              {hasPermission('customers:read') && <Link to="/customers">Clientes</Link>}
              {hasPermission('categories:read') && <Link to="/categories">Categorías</Link>}
              {hasPermission('brands:read') && <Link to="/brands">Marcas</Link>}
              {hasPermission('departments:read') && <Link to="/departments">Departamentos</Link>}
              {hasPermission('units:read') && <Link to="/units">Unidades</Link>}
              {hasPermission('suppliers:read') && <Link to="/suppliers">Proveedores</Link>}
            </div>
          </div>
          )}

          {/* Inventory Group */}
          {hasPermission('inventory:read') && (
          <div className="nav-group">
            <button className="nav-trigger" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="21 8 21 21 3 21 3 8"></polyline>
                <rect x="1" y="3" width="22" height="5"></rect>
                <line x1="10" y1="12" x2="14" y2="12"></line>
              </svg>
              <span>INVENTARIO</span>
            </button>
            <div className="nav-panel">
              <Link to="/inventory">Movimientos</Link>
              <Link to="/inventory/report">Reporte Stock</Link>
            </div>
          </div>
          )}

          {/* Warehouses Group */}
          {(hasPermission('shelves:read') || hasPermission('warehouses:read') || true) && ( // Assuming permissions, defaulting to true if specific perm missing in store
          <div className="nav-group">
            <button className="nav-trigger" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 21v-8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8"></path>
                <path d="M5 11V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4"></path>
                <path d="M9 7v4"></path>
                <path d="M15 7v4"></path>
              </svg>
              <span>ALMACENES</span>
            </button>
            <div className="nav-panel">
              <Link to="/warehouses">Almacenes/Tiendas</Link>
              <Link to="/transfers">Traslados</Link>
              {hasPermission('shelves:read') && <Link to="/shelves">Ubicaciones</Link>}
            </div>
          </div>
          )}

          {(hasPermission('sales:read') || hasPermission('credits:read') || hasPermission('cash:view') || hasPermission('cash:close')) && (
            <div className="nav-group">
              <button className="nav-trigger" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10"></line>
                  <line x1="12" y1="20" x2="12" y2="4"></line>
                  <line x1="6" y1="20" x2="6" y2="14"></line>
                </svg>
                <span>REPORTES</span>
              </button>
              <div className="nav-panel">
                {hasPermission('sales:read') && (user?.role === 'ADMIN' ? <Link to="/sales">Historial Ventas</Link> : <Link to="/my-sales">Mis Ventas</Link>)}
                {hasPermission('credits:read') && <Link to="/credit-reports">Reporte Créditos</Link>}
                {(hasPermission('cash:view') || hasPermission('cash:close')) && <Link to="/cash-history">Cierres de Caja</Link>}
              </div>
            </div>
          )}

          <div className="nav-group">
            <button className="nav-trigger" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
              <span>SISTEMA</span>
            </button>
            <div className="nav-panel">
              {hasPermission('config:read') && <Link to="/config">Config</Link>}
              {hasPermission('logs:read') && <Link to="/logs">Logs</Link>}
              {hasPermission('users:read') && <Link to="/users">Usuarios</Link>}
              {hasPermission('roles:read') && <Link to="/roles">Roles</Link>}
            </div>
          </div>
        </nav>
        <div className="header-actions">
          <div className="view-toggle" aria-label="Selector de tema">
            <button className={`toggle-btn ${mode === 'light' ? 'active' : ''}`} onClick={() => setMode('light')}>Claro</button>
            <button className={`toggle-btn ${mode === 'dark' ? 'active' : ''}`} onClick={() => setMode('dark')}>Oscuro</button>
            <button className={`toggle-btn ${mode === 'system' ? 'active' : ''}`} onClick={() => setMode('system')}>Sistema</button>
          </div>
          <div className="user">
            <span>{user?.name} ({user?.role})</span>
            <button onClick={logout}>Salir</button>
          </div>
          <button
            type="button"
            className="mobile-menu-btn"
            onClick={() => setMobileMenuOpen(prev => !prev)}
            aria-label={mobileMenuOpen ? 'Cerrar menu' : 'Abrir menu'}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? 'Cerrar' : 'Menu'}
          </button>
        </div>
      </header>
      <div className={`mobile-menu ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="mobile-menu-section">
          <Link to="/">Dashboard</Link>
          {canSell() && (
            <button type="button" onClick={openPOSWindow}>Ventas / POS</button>
          )}
          {(hasPermission('cash:view') || hasPermission('cash:open') || hasPermission('cash:movements') || hasPermission('cash:close') || hasPermission('sales:create')) && (
            <Link to="/cash-register">Caja</Link>
          )}
        </div>

        {(hasPermission('credits:read') || hasPermission('purchases:read')) && (
          <div className="mobile-menu-section">
            <div className="mobile-menu-title">Procesos</div>
            {hasPermission('credits:read') && <Link to="/credits">Créditos</Link>}
            {hasPermission('purchases:read') && <Link to="/purchases">Compras</Link>}
          </div>
        )}

        {(hasPermission('products:read') || hasPermission('customers:read') || hasPermission('categories:read') || hasPermission('brands:read') || hasPermission('departments:read') || hasPermission('units:read') || hasPermission('suppliers:read')) && (
          <div className="mobile-menu-section">
            <div className="mobile-menu-title">Catalogo</div>
            {hasPermission('products:read') && <Link to="/products">{productsMenuLabel}</Link>}
            {hasPermission('customers:read') && <Link to="/customers">Clientes</Link>}
            {hasPermission('categories:read') && <Link to="/categories">Categorías</Link>}
            {hasPermission('brands:read') && <Link to="/brands">Marcas</Link>}
            {hasPermission('departments:read') && <Link to="/departments">Departamentos</Link>}
            {hasPermission('units:read') && <Link to="/units">Unidades</Link>}
            {hasPermission('suppliers:read') && <Link to="/suppliers">Proveedores</Link>}
          </div>
        )}

        {hasPermission('inventory:read') && (
          <div className="mobile-menu-section">
            <div className="mobile-menu-title">Inventario</div>
            <Link to="/inventory">Movimientos</Link>
            <Link to="/inventory/report">Reporte stock</Link>
          </div>
        )}

        {(hasPermission('shelves:read') || hasPermission('warehouses:read') || true) && (
          <div className="mobile-menu-section">
            <div className="mobile-menu-title">Almacenes</div>
            <Link to="/warehouses">Almacenes / Tiendas</Link>
            <Link to="/transfers">Traslados</Link>
            {hasPermission('shelves:read') && <Link to="/shelves">Ubicaciones</Link>}
          </div>
        )}

        {(hasPermission('sales:read') || hasPermission('credits:read') || hasPermission('cash:view') || hasPermission('cash:close')) && (
          <div className="mobile-menu-section">
            <div className="mobile-menu-title">Reportes</div>
            {hasPermission('sales:read') && (user?.role === 'ADMIN' ? <Link to="/sales">Historial ventas</Link> : <Link to="/my-sales">Mis ventas</Link>)}
            {hasPermission('credits:read') && <Link to="/credit-reports">Reporte créditos</Link>}
            {(hasPermission('cash:view') || hasPermission('cash:close')) && <Link to="/cash-history">Cierres de caja</Link>}
          </div>
        )}

        <div className="mobile-menu-section">
          <div className="mobile-menu-title">Sistema</div>
          {hasPermission('config:read') && <Link to="/config">Config</Link>}
          {hasPermission('logs:read') && <Link to="/logs">Logs</Link>}
          {hasPermission('users:read') && <Link to="/users">Usuarios</Link>}
          {hasPermission('roles:read') && <Link to="/roles">Roles</Link>}
        </div>

        <div className="mobile-menu-section">
          <div className="mobile-menu-title">Sesion</div>
          <div className="mobile-menu-user">{user?.name} ({user?.role})</div>
          <button type="button" onClick={logout}>Salir</button>
        </div>
      </div>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
