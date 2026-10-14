import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'

const SPECIAL_ROLES = new Set(['ROOT', 'SUPERUSUARIO'])

export default function RootAccessGuard({ children }: { children: JSX.Element }) {
  const user = useAuthStore(s => s.user)
  const hasExplicitPermission = useAuthStore(s => s.hasExplicitPermission)
  const roleCode = String(user?.role || '').trim().toUpperCase()
  const allowed = !!user && SPECIAL_ROLES.has(roleCode) && hasExplicitPermission('root:access')

  if (!user) return <Navigate to="/login" />
  if (!allowed) return <Navigate to="/" />

  return children
}
