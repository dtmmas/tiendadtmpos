import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useAuthStore } from '../store/auth'
import { useConfigStore } from '../store/config'
import { THEME_COLOR_OPTIONS, useThemeStore } from '../store/theme'
import { formatCompanyName } from '../utils/text'

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout, hasPermission, canSell } = useAuthStore()
  const config = useConfigStore(s => s.config)
  const { mode, setMode, color, setColor } = useThemeStore()
  const companyName = formatCompanyName(config?.name)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [themePaletteOpen, setThemePaletteOpen] = useState(false)
  const [mobileMenuSections, setMobileMenuSections] = useState<Record<string, boolean>>({
    principal: true,
    procesos: false,
    catalogo: false,
    inventario: false,
    almacenes: false,
    reportes: false,
    sistema: false
  })
  const themePaletteRef = useRef<HTMLDivElement | null>(null)
  const closeMobileMenu = () => setMobileMenuOpen(false)
  const currentThemeOption = THEME_COLOR_OPTIONS.find((option) => option.value === color) ?? THEME_COLOR_OPTIONS[0]

  useEffect(() => {
    setMobileMenuOpen(false)
    setThemePaletteOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!mobileMenuOpen) return

    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false)
      }
    }

    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [mobileMenuOpen])

  useEffect(() => {
    if (!themePaletteOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target?.closest('.theme-palette-scope') && themePaletteRef.current && !themePaletteRef.current.contains(target as Node)) {
        setThemePaletteOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setThemePaletteOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [themePaletteOpen])

  const isAdmin = String(user?.role || '').toUpperCase() === 'ADMIN'
  const canManageProducts = String(user?.role || '').toUpperCase() === 'ADMIN' || hasPermission('products:write')
  const productsMenuLabel = canManageProducts ? 'Productos' : 'Catalogo de productos'
  const defaultHomePath = isAdmin ? '/dashboard' : '/products'

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

  const openQuotationWindow = (event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault()
    event?.stopPropagation()

    const quotationUrl = new URL('/quotations', window.location.origin).toString()
    const anchor = document.createElement('a')
    anchor.href = quotationUrl
    anchor.target = 'dtmpos-quotation-window'
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)

    setMobileMenuOpen(false)
  }

  const renderMobileMenuIcon = (kind: string) => {
    switch (kind) {
      case 'dashboard':
        return (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
            <polyline points="9 22 9 12 15 12 15 22"></polyline>
          </svg>
        )
      case 'pos':
        return (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <path d="M16 10a4 4 0 0 1-8 0"></path>
          </svg>
        )
      case 'cash':
        return (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="6" width="20" height="12" rx="2"></rect>
            <circle cx="12" cy="12" r="2"></circle>
            <path d="M6 12h.01M18 12h.01"></path>
          </svg>
        )
      case 'layers':
        return (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
            <polyline points="2 17 12 22 22 17"></polyline>
            <polyline points="2 12 12 17 22 12"></polyline>
          </svg>
        )
      case 'catalog':
        return (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
          </svg>
        )
      case 'inventory':
        return (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="21 8 21 21 3 21 3 8"></polyline>
            <rect x="1" y="3" width="22" height="5"></rect>
            <line x1="10" y1="12" x2="14" y2="12"></line>
          </svg>
        )
      case 'warehouse':
        return (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 21v-8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8"></path>
            <path d="M5 11V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4"></path>
            <path d="M9 7v4"></path>
            <path d="M15 7v4"></path>
          </svg>
        )
      case 'reports':
        return (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10"></line>
            <line x1="12" y1="20" x2="12" y2="4"></line>
            <line x1="6" y1="20" x2="6" y2="14"></line>
          </svg>
        )
      case 'settings':
        return (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        )
      case 'user':
        return (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21a8 8 0 1 0-16 0"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
        )
      default:
        return (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
          </svg>
        )
    }
  }

  const renderMobileMenuLinkCard = (to: string, label: string, description: string, icon: string) => (
    <Link to={to} className="mobile-menu-card" onClick={closeMobileMenu}>
      <span className="mobile-menu-card-icon">{renderMobileMenuIcon(icon)}</span>
      <span className="mobile-menu-card-title">{label}</span>
      <span className="mobile-menu-card-description">{description}</span>
    </Link>
  )

  const renderMobileMenuActionCard = (label: string, description: string, icon: string, onClick: () => void) => (
    <button type="button" className="mobile-menu-card" onClick={onClick}>
      <span className="mobile-menu-card-icon">{renderMobileMenuIcon(icon)}</span>
      <span className="mobile-menu-card-title">{label}</span>
      <span className="mobile-menu-card-description">{description}</span>
    </button>
  )

  const toggleMobileMenuSection = (section: string) => {
    setMobileMenuSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }))
  }

  const renderMobileMenuSection = (section: string, title: string, icon: string, children: React.ReactNode) => {
    const isOpen = Boolean(mobileMenuSections[section])

    return (
      <div className={`mobile-menu-group${isOpen ? ' open' : ''}`}>
        <button
          type="button"
          className="mobile-menu-section-trigger"
          onClick={() => toggleMobileMenuSection(section)}
          aria-expanded={isOpen}
        >
          <span className="mobile-menu-section-trigger-main">
            <span className="mobile-menu-card-icon mobile-menu-section-icon">{renderMobileMenuIcon(icon)}</span>
            <span className="mobile-menu-title">{title}</span>
          </span>
          <span className={`mobile-menu-section-chevron${isOpen ? ' open' : ''}`}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </span>
        </button>
        {isOpen && (
          <div className="mobile-menu-cards">
            {children}
          </div>
        )}
      </div>
    )
  }

  const renderThemePalette = (mobile = false) => (
    <div className={mobile ? 'theme-color-picker theme-color-picker-mobile' : 'theme-color-picker'} aria-label="Selector de color del tema">
      {THEME_COLOR_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`theme-color-btn${color === option.value ? ' active' : ''}${mobile ? ' mobile' : ''}`}
          onClick={() => {
            setColor(option.value)
            setThemePaletteOpen(false)
          }}
          aria-label={`Usar tema ${option.label}`}
          title={`Tema ${option.label}`}
        >
          <span className="theme-color-dot" style={{ background: option.preview }} />
          <span className="theme-color-name">{option.label}</span>
        </button>
      ))}
    </div>
  )

  return (
    <div className="app">
      <header className="header">
        <div className="brand" onClick={() => navigate(defaultHomePath) }>
          {config?.logoUrl && <img src={config.logoUrl} alt="logo" />}
          <div>
            <strong>{companyName}</strong>
            <small>{config?.currency ?? 'USD'}</small>
          </div>
        </div>
        <nav className="nav nav-desktop">
          {isAdmin && (
            <Link to="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9 22 9 12 15 12 15 22"></polyline>
              </svg>
              <span>DASHBOARD</span>
            </Link>
          )}
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
          {(canSell() || hasPermission('credits:read') || hasPermission('purchases:read')) && (
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
                {canSell() && (
                  <button
                    type="button"
                    onClick={openQuotationWindow}
                    style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', textAlign: 'left', width: '100%' }}
                  >
                    Cotizaciones
                  </button>
                )}
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
          <div className="theme-controls">
            <div className="view-toggle" aria-label="Selector de modo de tema">
              <button className={`toggle-btn ${mode === 'light' ? 'active' : ''}`} onClick={() => setMode('light')}>Claro</button>
              <button className={`toggle-btn ${mode === 'dark' ? 'active' : ''}`} onClick={() => setMode('dark')}>Oscuro</button>
              <button className={`toggle-btn ${mode === 'system' ? 'active' : ''}`} onClick={() => setMode('system')}>Sistema</button>
            </div>
            <div className="theme-palette-dropdown theme-palette-scope" ref={themePaletteRef}>
              <button
                type="button"
                className={`theme-palette-trigger${themePaletteOpen ? ' open' : ''}`}
                onClick={() => setThemePaletteOpen((prev) => !prev)}
                aria-expanded={themePaletteOpen}
                aria-label="Abrir paleta de colores"
              >
                <span className="theme-palette-trigger-main">
                  <span className="theme-color-dot" style={{ background: currentThemeOption.preview }} />
                  <span className="theme-palette-trigger-label">Color</span>
                  <span className="theme-palette-trigger-value">{currentThemeOption.label}</span>
                </span>
                <span className={`theme-palette-chevron${themePaletteOpen ? ' open' : ''}`}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </span>
              </button>
              {themePaletteOpen && (
                <div className="theme-palette-menu">
                  {renderThemePalette()}
                </div>
              )}
            </div>
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
      {mobileMenuOpen && (
        <div className="mobile-menu-backdrop" onClick={closeMobileMenu}>
          <div
            className="mobile-menu-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Menu principal"
            onClick={event => event.stopPropagation()}
          >
            <div className="mobile-menu-dialog-header">
              <div>
                <div className="mobile-menu-dialog-title">Menú</div>
                <div className="mobile-menu-dialog-subtitle">Accesos rápidos del sistema</div>
              </div>
              <button type="button" className="mobile-menu-dialog-close" onClick={closeMobileMenu} aria-label="Cerrar menu">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            <div className="mobile-menu-dialog-body">
              <div className="mobile-menu-grid">
                {renderMobileMenuSection('principal', 'Principal', 'dashboard', (
                  <>
                    {isAdmin && renderMobileMenuLinkCard('/dashboard', 'Dashboard', 'Resumen general', 'dashboard')}
                    {canSell() && renderMobileMenuActionCard('Ventas / POS', 'Abrir punto de venta', 'pos', () => openPOSWindow())}
                    {(hasPermission('cash:view') || hasPermission('cash:open') || hasPermission('cash:movements') || hasPermission('cash:close') || hasPermission('sales:create')) &&
                      renderMobileMenuLinkCard('/cash-register', 'Caja', 'Operaciones de caja', 'cash')}
                  </>
                ))}

                {(canSell() || hasPermission('credits:read') || hasPermission('purchases:read')) && (
                  renderMobileMenuSection('procesos', 'Procesos', 'layers', (
                    <>
                      {canSell() && renderMobileMenuActionCard('Cotizaciones', 'Abrir cotizador', 'layers', () => openQuotationWindow())}
                      {hasPermission('credits:read') && renderMobileMenuLinkCard('/credits', 'Créditos', 'Gestionar cobros', 'layers')}
                      {hasPermission('purchases:read') && renderMobileMenuLinkCard('/purchases', 'Compras', 'Registrar entradas', 'layers')}
                    </>
                  ))
                )}

                {(hasPermission('products:read') || hasPermission('customers:read') || hasPermission('categories:read') || hasPermission('brands:read') || hasPermission('departments:read') || hasPermission('units:read') || hasPermission('suppliers:read')) && (
                  renderMobileMenuSection('catalogo', 'Catálogo', 'catalog', (
                    <>
                      {hasPermission('products:read') && renderMobileMenuLinkCard('/products', productsMenuLabel, 'Listado principal', 'catalog')}
                      {hasPermission('customers:read') && renderMobileMenuLinkCard('/customers', 'Clientes', 'Gestionar clientes', 'catalog')}
                      {hasPermission('categories:read') && renderMobileMenuLinkCard('/categories', 'Categorías', 'Organizar productos', 'catalog')}
                      {hasPermission('brands:read') && renderMobileMenuLinkCard('/brands', 'Marcas', 'Gestionar marcas', 'catalog')}
                      {hasPermission('departments:read') && renderMobileMenuLinkCard('/departments', 'Departamentos', 'Clasificación interna', 'catalog')}
                      {hasPermission('units:read') && renderMobileMenuLinkCard('/units', 'Unidades', 'Medidas de venta', 'catalog')}
                      {hasPermission('suppliers:read') && renderMobileMenuLinkCard('/suppliers', 'Proveedores', 'Relación comercial', 'catalog')}
                    </>
                  ))
                )}

                {hasPermission('inventory:read') && (
                  renderMobileMenuSection('inventario', 'Inventario', 'inventory', (
                    <>
                      {renderMobileMenuLinkCard('/inventory', 'Movimientos', 'Entradas y ajustes', 'inventory')}
                      {renderMobileMenuLinkCard('/inventory/report', 'Reporte stock', 'Resumen de existencias', 'inventory')}
                    </>
                  ))
                )}

                {(hasPermission('shelves:read') || hasPermission('warehouses:read') || true) && (
                  renderMobileMenuSection('almacenes', 'Almacenes', 'warehouse', (
                    <>
                      {renderMobileMenuLinkCard('/warehouses', 'Almacenes', 'Tiendas y bodegas', 'warehouse')}
                      {renderMobileMenuLinkCard('/transfers', 'Traslados', 'Mover existencias', 'warehouse')}
                      {hasPermission('shelves:read') && renderMobileMenuLinkCard('/shelves', 'Ubicaciones', 'Estantes y zonas', 'warehouse')}
                    </>
                  ))
                )}

                {(hasPermission('sales:read') || hasPermission('credits:read') || hasPermission('cash:view') || hasPermission('cash:close')) && (
                  renderMobileMenuSection('reportes', 'Reportes', 'reports', (
                    <>
                      {hasPermission('sales:read') &&
                        (user?.role === 'ADMIN'
                          ? renderMobileMenuLinkCard('/sales', 'Historial ventas', 'Ventas registradas', 'reports')
                          : renderMobileMenuLinkCard('/my-sales', 'Mis ventas', 'Historial personal', 'reports'))}
                      {hasPermission('credits:read') && renderMobileMenuLinkCard('/credit-reports', 'Créditos', 'Reporte de cobros', 'reports')}
                      {(hasPermission('cash:view') || hasPermission('cash:close')) &&
                        renderMobileMenuLinkCard('/cash-history', 'Cierres caja', 'Historial de cierres', 'reports')}
                    </>
                  ))
                )}

                {renderMobileMenuSection('sistema', 'Sistema', 'settings', (
                  <>
                    {hasPermission('config:read') && renderMobileMenuLinkCard('/config', 'Config', 'Ajustes del sistema', 'settings')}
                    {hasPermission('logs:read') && renderMobileMenuLinkCard('/logs', 'Logs', 'Registro de eventos', 'settings')}
                    {hasPermission('users:read') && renderMobileMenuLinkCard('/users', 'Usuarios', 'Accesos y cuentas', 'settings')}
                    {hasPermission('roles:read') && renderMobileMenuLinkCard('/roles', 'Roles', 'Permisos del sistema', 'settings')}
                  </>
                ))}
              </div>

              <div className="mobile-theme-panel theme-palette-scope">
                <div className="mobile-theme-panel-header">
                  <div className="mobile-theme-panel-title">Tema visual</div>
                  <div className="mobile-theme-panel-subtitle">Combina modo y color del sistema</div>
                </div>
                <div className="view-toggle mobile-view-toggle" aria-label="Selector de modo de tema">
                  <button className={`toggle-btn ${mode === 'light' ? 'active' : ''}`} onClick={() => setMode('light')}>Claro</button>
                  <button className={`toggle-btn ${mode === 'dark' ? 'active' : ''}`} onClick={() => setMode('dark')}>Oscuro</button>
                  <button className={`toggle-btn ${mode === 'system' ? 'active' : ''}`} onClick={() => setMode('system')}>Sistema</button>
                </div>
                <button
                  type="button"
                  className={`theme-palette-mobile-trigger${themePaletteOpen ? ' open' : ''}`}
                  onClick={() => setThemePaletteOpen((prev) => !prev)}
                  aria-expanded={themePaletteOpen}
                >
                  <span className="theme-palette-trigger-main">
                    <span className="theme-color-dot" style={{ background: currentThemeOption.preview }} />
                    <span className="theme-palette-trigger-label">Paleta</span>
                    <span className="theme-palette-trigger-value">{currentThemeOption.label}</span>
                  </span>
                  <span className={`theme-palette-chevron${themePaletteOpen ? ' open' : ''}`}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                  </span>
                </button>
                {themePaletteOpen && renderThemePalette(true)}
              </div>

              <div className="mobile-menu-session">
                <div className="mobile-menu-session-info">
                  <span className="mobile-menu-card-icon">{renderMobileMenuIcon('user')}</span>
                  <div>
                    <div className="mobile-menu-session-name">{user?.name}</div>
                    <div className="mobile-menu-session-role">{user?.role}</div>
                  </div>
                </div>
                <button type="button" className="mobile-menu-session-logout" onClick={() => { logout(); closeMobileMenu() }}>
                  Salir
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
