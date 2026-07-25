import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
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

function RootLanding() {
  const user = useAuthStore(s => s.user)
  const hasPermission = useAuthStore(s => s.hasPermission)
  const canSell = useAuthStore(s => s.canSell)
  const isAdmin = String(user?.role || '').toUpperCase() === 'ADMIN'

  if (isAdmin) return <Navigate to="/dashboard" replace />
  if (hasPermission('products:read')) return <Navigate to="/products" replace />
  if (canSell()) return <Navigate to="/pos" replace />
  if (hasPermission('cash:view') || hasPermission('cash:open') || hasPermission('cash:movements') || hasPermission('cash:close')) {
    return <Navigate to="/cash-register" replace />
  }
  return <Navigate to="/products" replace />
}

export default function App() {
  const fetchConfig = useConfigStore(s => s.fetchConfig)
  const config = useConfigStore(s => s.config)
  const canSell = useAuthStore(s => s.canSell)

  useEffect(() => { fetchConfig() }, [fetchConfig])
  useEffect(() => {
    document.title = formatCompanyName(config?.name)
  }, [config?.name])

  return (
    <>
      <Routes>
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
          <Route path="logs" element={<PermissionGuard permission="logs:read"><Logs /></PermissionGuard>} />
          
          {/* New Role Management Routes */}
          <Route path="roles" element={<PermissionGuard permission="roles:read"><Roles /></PermissionGuard>} />
          <Route path="users" element={<PermissionGuard permission="users:read"><Users /></PermissionGuard>} />
        </Route>
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
      <AlertHost />
    </>
  )
}
