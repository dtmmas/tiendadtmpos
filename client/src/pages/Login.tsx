import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { useConfigStore } from '../store/config'
import { formatCompanyName } from '../utils/text'

export default function Login() {
  const navigate = useNavigate()
  const { login, user, hasPermission, canSell } = useAuthStore()
  const config = useConfigStore(s => s.config)
  const companyName = formatCompanyName(config?.name)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    const ok = await login(email.trim(), password)
    setIsSubmitting(false)
    if (ok) {
      const nextUser = useAuthStore.getState().user || user
      const isAdmin = String(nextUser?.role || '').toUpperCase() === 'ADMIN'
      if (isAdmin) navigate('/')
      else if (hasPermission('products:read')) navigate('/products')
      else if (canSell()) navigate('/pos')
      else navigate('/')
    }
    else setError('Credenciales inválidas')
  }

  return (
    <div className="login-shell">
      <div className="login-backdrop" aria-hidden="true" />
      <div className="login-layout">
        <section className="login-panel login-panel--brand">
          <div className="login-badge">Sistema POS</div>
          <h1 className="login-title">{companyName}</h1>
          <p className="login-description">
            Accede a tu panel de ventas, inventario y caja desde una pantalla mas limpia y enfocada.
          </p>
          <div className="login-highlights">
            <div className="login-highlight">
              <span className="login-highlight-value">{config?.currency ?? 'USD'}</span>
              <span className="login-highlight-label">Moneda base</span>
            </div>
            <div className="login-highlight">
              <span className="login-highlight-value">Seguro</span>
              <span className="login-highlight-label">Acceso privado</span>
            </div>
          </div>
        </section>

        <section className="login-panel login-panel--form">
          <div className="login-card-modern">
            <div className="login-card-header">
              {config?.logoUrl && (
                <div className="login-logo-wrap">
                  <img src={config.logoUrl} alt="logo" className="login-logo" />
                </div>
              )}
              <div className="login-copy">
                <p className="login-eyebrow">Bienvenido</p>
                <h3 className="login-card-title">Iniciar sesión</h3>
              </div>
            </div>
            <div className="login-copy login-copy--supporting">
              <p>Ingresa tus credenciales para continuar.</p>
            </div>

            <form className="login-form" onSubmit={onSubmit}>
              <div className="login-field">
                <label htmlFor="email">Correo</label>
                <input
                  id="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tucorreo@dominio.com"
                />
              </div>

              <div className="login-field">
                <label htmlFor="password">Contraseña</label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Escribe tu contraseña"
                />
              </div>

              {error && <div className="login-error">{error}</div>}

              <button className="login-submit" type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Ingresando...' : 'Entrar'}
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  )
}
