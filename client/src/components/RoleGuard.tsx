import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'

export default function RoleGuard({ roles, children }: { roles: string[], children: JSX.Element }) {
  const user = useAuthStore(s => s.user)
  if (!user) return <Navigate to="/login" />
  if (!roles.map(role => String(role || '').toUpperCase()).includes(String(user.role || '').toUpperCase())) return <Navigate to="/" />
  return children
}
