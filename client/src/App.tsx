import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useState } from 'react'
import { api } from './api'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Products from './pages/Products'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import { useConfigStore } from './store/config'
import RoleGuard from './components/RoleGuard'
import Config from './pages/Config'
import Categories from './pages/Categories'
import Brands from './pages/Brands'
import Suppliers from './pages/Suppliers'
import Units from './pages/Units'
import Departments from './pages/Departments'
import Shelves from './pages/Shelves'
import POS from './pages/POS'
import Customers from './pages/Customers'
import Sales from './pages/Sales'
import MySalesReport from './pages/MySalesReport'
import Credits from './pages/Credits'
import CreditReports from './pages/CreditReports'
import Logs from './pages/Logs'
import Roles from './pages/Roles'
import Users from './pages/Users'
import Purchases from './pages/Purchases'
import PurchaseCreate from './pages/PurchaseCreate'
import PurchaseDetails from './pages/PurchaseDetails'
import PermissionGuard from './components/PermissionGuard'
import Warehouses from './pages/Warehouses'
import InventoryMovements from './pages/InventoryMovements'
import InventoryReport from './pages/InventoryReport'
import Transfers from './pages/Transfers'
import CashRegister from './pages/CashRegister'
import CashHistory from './pages/CashHistory'
import { formatCompanyName } from './utils/text'
import AlertHost from './components/AlertHost'
import { useAuthStore } from './store/auth'
import StoreFront from './pages/StoreFront'
import StoreCart from './pages/StoreCart'
import StoreCheckout from './pages/StoreCheckout'
import StoreOrderStatus from './pages/StoreOrderStatus'
import StoreAdmin from './pages/StoreAdmin'
import StoreResidentialPlans from './pages/StoreResidentialPlans'
import { showAppAlert } from './components/AlertHost'
import RootCore from './pages/RootCore'
import RootAccessGuard from './components/RootAccessGuard'
import StoreLegacyRedirect from './components/StoreLegacyRedirect'
import { matchesStoreCustomDomain } from './utils/storePublicLink'

function RootLanding() {
  const user = useAuthStore(s => s.user)
  const hasPermission = useAuthStore(s => s.hasPermission)
  const hasExplicitPermission = useAuthStore(s => s.hasExplicitPermission)
  const canSell = useAuthStore(s => s.canSell)
  const isAdmin = String(user?.role || '').toUpperCase() === 'ADMIN'
  const isRootOperator = ['ROOT', 'SUPERUSUARIO'].includes(String(user?.role || '').toUpperCase()) && hasExplicitPermission('root:access')

  if (isAdmin) return <Navigate to="/dashboard" replace />
  if (isRootOperator) return <Navigate to="/root-core" replace />
  if (hasPermission('products:read')) return <Navigate to="/products" replace />
  if (canSell()) return <Navigate to="/pos" replace />
  if (hasPermission('cash:view') || hasPermission('cash:open') || hasPermission('cash:movements') || hasPermission('cash:close')) {
    return <Navigate to="/cash-register" replace />
  }
  return <Navigate to="/products" replace />
}

function StoreAdminDisabledRoute() {
  useEffect(() => {
    showAppAlert('La tienda en línea no está habilitada en este negocio.')
  }, [])

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
      <div style={{ border: '1px solid rgba(245, 158, 11, 0.28)', background: 'rgba(245, 158, 11, 0.08)', color: '#92400e', borderRadius: 16, padding: 18 }}>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 6 }}>Tienda en línea deshabilitada</div>
        <div style={{ fontSize: 14, lineHeight: 1.5 }}>
          Este negocio no tiene habilitado el módulo de tienda en línea en este momento. Puedes activarlo desde <strong>Configuración del sistema</strong>.
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const fetchConfig = useConfigStore(s => s.fetchConfig)
  const config = useConfigStore(s => s.config)
  const canSell = useAuthStore(s => s.canSell)
  const [storeEnabled, setStoreEnabled] = useState(config?.storeEnabled === true)
  const [storeRoutingResolved, setStoreRoutingResolved] = useState(false)
  const [storeCustomDomain, setStoreCustomDomain] = useState('')

  useEffect(() => { fetchConfig() }, [fetchConfig])
  useEffect(() => {
    setStoreEnabled(config?.storeEnabled === true)
  }, [config?.storeEnabled])
  useEffect(() => {
    document.title = formatCompanyName(config?.name)
  }, [config?.name])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await api.get('/store/settings')
        if (!cancelled) {
          setStoreCustomDomain(String(data?.customDomain || ''))
        }
      } catch {
        if (!cancelled) setStoreCustomDomain('')
      } finally {
        if (!cancelled) setStoreRoutingResolved(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const currentHost = typeof window === 'undefined' ? '' : window.location.host
  const storeDomainActive = matchesStoreCustomDomain(currentHost, storeCustomDomain)

  if (!storeRoutingResolved) return null

  return (
    <>
      <Routes>
        <Route path="/s/:storeSlug" element={<StoreFront />} />
        <Route path="/s/:storeSlug/catalogo" element={<StoreFront mode="catalog" />} />
        <Route path="/s/:storeSlug/internet-residencial" element={<StoreResidentialPlans />} />
        <Route path="/s/:storeSlug/carrito" element={<StoreCart />} />
        <Route path="/s/:storeSlug/checkout" element={<StoreCheckout />} />
        <Route path="/s/:storeSlug/pedido/:orderCode" element={<StoreOrderStatus />} />
        <Route path="/s" element={<StoreLegacyRedirect />} />
        <Route path="/tienda" element={<StoreLegacyRedirect />} />
        <Route path="/tienda/catalogo" element={<StoreLegacyRedirect suffix="/catalogo" />} />
        <Route path="/internet-residencial" element={<StoreLegacyRedirect suffix="/internet-residencial" />} />
        <Route path="/tienda/carrito" element={<StoreLegacyRedirect suffix="/carrito" />} />
        <Route path="/tienda/checkout" element={<StoreLegacyRedirect suffix="/checkout" />} />
        <Route path="/tienda/pedido/:orderCode" element={<StoreLegacyRedirect suffix="/pedido/:orderCode" />} />
        {storeDomainActive ? (
          <>
            <Route path="/" element={<StoreFront />} />
            <Route path="/catalogo" element={<StoreFront mode="catalog" />} />
            <Route path="/internet-residencial" element={<StoreResidentialPlans />} />
            <Route path="/carrito" element={<StoreCart />} />
            <Route path="/checkout" element={<StoreCheckout />} />
            <Route path="/pedido/:orderCode" element={<StoreOrderStatus />} />
            <Route path="/login" element={<Navigate to="/" replace />} />
          </>
        ) : (
          <>
            <Route path="/login" element={<Login />} />
            <Route
              path="/pos"
              element={
                <ProtectedRoute>
                  {canSell() ? <POS /> : <Navigate to="/" />}
                </ProtectedRoute>
              }
            />
            <Route
              path="/quotations"
              element={
                <ProtectedRoute>
                  {canSell() ? <POS mode="quote" /> : <Navigate to="/" />}
                </ProtectedRoute>
              }
            />
            <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
              <Route index element={<RootLanding />} />
              <Route path="dashboard" element={<RoleGuard roles={['ADMIN']}><Dashboard /></RoleGuard>} />
              <Route path="products" element={<PermissionGuard permission="products:read"><Products /></PermissionGuard>} />
              <Route path="categories" element={<PermissionGuard permission="categories:read"><Categories /></PermissionGuard>} />
              <Route path="brands" element={<PermissionGuard permission="brands:read"><Brands /></PermissionGuard>} />
              <Route path="suppliers" element={<PermissionGuard permission="suppliers:read"><Suppliers /></PermissionGuard>} />
              <Route path="departments" element={<PermissionGuard permission="departments:read"><Departments /></PermissionGuard>} />
              <Route path="shelves" element={<PermissionGuard permission="shelves:read"><Shelves /></PermissionGuard>} />
              <Route path="warehouses" element={<PermissionGuard permission="products:read"><Warehouses /></PermissionGuard>} />
              <Route path="transfers" element={<PermissionGuard permission="products:read"><Transfers /></PermissionGuard>} />
              <Route path="inventory" element={<PermissionGuard permission="inventory:read"><InventoryMovements /></PermissionGuard>} />
              <Route path="inventory/report" element={<PermissionGuard permission="inventory:read"><InventoryReport /></PermissionGuard>} />
              <Route path="customers" element={<PermissionGuard permission="customers:read"><Customers /></PermissionGuard>} />
              <Route path="credits" element={<PermissionGuard permission="credits:read"><Credits /></PermissionGuard>} />
              <Route path="sales" element={<PermissionGuard permission="sales:read"><RoleGuard roles={['ADMIN']}><Sales /></RoleGuard></PermissionGuard>} />
              <Route path="my-sales" element={<PermissionGuard permission="sales:read"><MySalesReport /></PermissionGuard>} />
              <Route path="purchases" element={<PermissionGuard permission="purchases:read"><Purchases /></PermissionGuard>} />
              <Route path="purchases/new" element={<PermissionGuard permission="purchases:write"><PurchaseCreate /></PermissionGuard>} />
              <Route path="purchases/:id" element={<PermissionGuard permission="purchases:read"><PurchaseDetails /></PermissionGuard>} />
              <Route path="credit-reports" element={<PermissionGuard permission="credits:read"><CreditReports /></PermissionGuard>} />
              <Route path="cash-register" element={<PermissionGuard permission={["cash:view", "cash:open", "cash:movements", "cash:close", "sales:create"]}><CashRegister /></PermissionGuard>} />
              <Route path="cash-history" element={<PermissionGuard permission={["cash:view", "cash:close", "sales:read"]}><CashHistory /></PermissionGuard>} />
              <Route path="units" element={<PermissionGuard permission="units:read"><Units /></PermissionGuard>} />
              <Route path="config" element={<PermissionGuard permission="config:read"><Config /></PermissionGuard>} />
              <Route path="root-core" element={<RootAccessGuard><RootCore /></RootAccessGuard>} />
              <Route path="store-admin" element={<RoleGuard roles={['ADMIN']}>{storeEnabled ? <StoreAdmin /> : <StoreAdminDisabledRoute />}</RoleGuard>} />
              <Route path="logs" element={<PermissionGuard permission="logs:read"><Logs /></PermissionGuard>} />

              {/* New Role Management Routes */}
              <Route path="roles" element={<PermissionGuard permission="roles:read"><Roles /></PermissionGuard>} />
              <Route path="users" element={<PermissionGuard permission="users:read"><Users /></PermissionGuard>} />
            </Route>
          </>
        )}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
      <AlertHost />
    </>
  )
}
