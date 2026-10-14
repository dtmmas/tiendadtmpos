import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useConfigStore } from '../store/config'
import { formatCompanyName } from '../utils/text'
import { resolveUploadedAssetUrl } from '../utils/assets'
import { useStorePublicRouting } from '../hooks/useStorePublicRouting'
import '../styles/store-public.css'

const RESIDENTIAL_PLANS = [
  {
    key: 'basic',
    name: 'Plan Basico',
    speed: '25M',
    price: 'Q.150.00',
    description: 'Internet residencial para uso diario, navegacion, redes sociales y streaming ligero.',
    features: ['Solo internet', 'Instalacion gratis', 'Pago mensual'],
    accent: 'orange',
  },
  {
    key: 'tv50',
    name: 'Internet + TV Digital',
    speed: '50M',
    price: 'Q.200.00',
    description: 'Conexion para toda la familia con 106 canales digitales incluidos.',
    features: ['50M + TV digital', '106 canales digitales', 'Aplican restricciones en TV Digital'],
    accent: 'blue',
  },
  {
    key: 'mid',
    name: 'Plan Intermedio',
    speed: '75M',
    price: 'Q.200.00',
    description: 'Mas velocidad para hogares con multiples dispositivos conectados al mismo tiempo.',
    features: ['Solo internet', 'Mayor estabilidad', 'Instalacion gratis'],
    accent: 'cyan',
  },
  {
    key: 'advanced',
    name: 'Plan Avanzado',
    speed: '100M',
    price: 'Q.350.00',
    description: 'Alta velocidad + TV Digital para una experiencia completa de entretenimiento y conectividad.',
    features: ['100M + TV digital', '106 canales digitales', 'Aplican restricciones en TV Digital'],
    accent: 'purple',
  },
  {
    key: 'corp',
    name: 'Plan Corporativo',
    speed: '150M',
    price: 'Q.450.00',
    description: 'Internet de alta velocidad para uso intensivo, teletrabajo y necesidades exigentes.',
    features: ['150 megas', 'Alta velocidad', 'Ideal para alto consumo'],
    accent: 'dark',
  },
] as const

export default function StoreResidentialPlans() {
  const config = useConfigStore(s => s.config)
  const [storeSettings, setStoreSettings] = useState<{ publicSlug?: string; customDomain?: string } | null>(null)
  const { buildStorePath } = useStorePublicRouting(storeSettings?.publicSlug, storeSettings?.customDomain)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await api.get('/store/settings')
        if (!cancelled) setStoreSettings(data)
      } catch {}
    })()
    return () => { cancelled = true }
  }, [])

  const title = useMemo(() => formatCompanyName(config?.name || 'TIENDA'), [config?.name])
  const topbarLogoUrl = useMemo(() => {
    const raw = String(config?.logoUrl || '').trim()
    if (!raw || raw.includes('placehold.co/64x64?text=LOGO')) return ''
    return resolveUploadedAssetUrl(raw)
  }, [config?.logoUrl])

  return (
    <div className="store-shell">
      <div className="store-container store-market-container">
        <header className="store-market-header store-topbar-sticky">
          <div className="store-market-brand">
            <div className="store-market-logo-mark" aria-hidden="true">
              {topbarLogoUrl ? (
                <img src={topbarLogoUrl} alt={title} className="store-market-logo-image" />
              ) : (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2l7 4v8l-7 4-7-4V6l7-4z" />
                  <path d="M5 6l7 4 7-4" />
                  <path d="M12 10v8" />
                </svg>
              )}
            </div>
          </div>

          <nav className="store-market-links store-market-links-header">
            <Link to={buildStorePath()}>Inicio</Link>
            <Link to={buildStorePath('/catalogo')}>Tienda</Link>
            <Link to={buildStorePath('/internet-residencial')} className="store-market-link-active">Internet residencial</Link>
            <Link to={`${buildStorePath()}#store-categories`}>Categorías</Link>
            <Link to={`${buildStorePath()}#store-brands`}>Marcas</Link>
          </nav>

          <div className="store-market-search store-market-search-static">
            <span className="store-market-search-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2l7 4v8l-7 4-7-4V6l7-4z" />
                <path d="M5 6l7 4 7-4" />
                <path d="M12 10v8" />
              </svg>
            </span>
            <span className="store-market-search-copy">Instalacion gratis</span>
          </div>

          <div className="store-market-actions">
            <a href="#residential-coverage" className="store-market-icon-link">
              <span>Cobertura</span>
            </a>
          </div>
        </header>

        <section className="store-residential-hero">
          <div className="store-residential-hero-copy">
            <span className="store-market-eyebrow">Internet residencial</span>
            <h1>Planes de internet para tu hogar con instalacion gratis.</h1>
            <p>
              Contamos con varios planes de Internet Residencial para adaptarnos a lo que necesites.
              Solo pagas el primer mes o la diferencia de los dias restantes del mes.
            </p>
            <div className="store-residential-hero-actions">
              <a href="#residential-plans" className="store-button store-button-market">Ver planes</a>
              <a href="#residential-coverage" className="store-button-secondary">Verificar cobertura</a>
            </div>
          </div>

          <div className="store-residential-hero-panel">
            <div className="store-residential-highlight">
              <strong>Desde Q.150.00</strong>
              <span>Velocidades desde 25M hasta 150 Megas.</span>
            </div>
            <div className="store-residential-highlight">
              <strong>TV Digital disponible</strong>
              <span>Planes con 106 canales digitales para mas entretenimiento.</span>
            </div>
            <div className="store-residential-highlight">
              <strong>Facil de contratar</strong>
              <span>Solo necesitamos tu direccion o ubicacion exacta para revisar cobertura.</span>
            </div>
          </div>
        </section>

        <section id="residential-plans" className="store-residential-section">
          <div className="store-market-section-header">
            <div>
              <h2>Planes disponibles</h2>
              <p>Opciones residenciales y mixtas con internet y TV Digital segun tu necesidad.</p>
            </div>
          </div>

          <div className="store-residential-plans-grid">
            {RESIDENTIAL_PLANS.map(plan => (
              <article key={plan.key} className={`store-residential-plan-card store-residential-plan-card-${plan.accent}`}>
                <div className="store-residential-plan-top">
                  <span className="store-chip store-chip-light">Instalacion gratis</span>
                  <div className="store-residential-plan-speed">{plan.speed}</div>
                </div>
                <h3>{plan.name}</h3>
                <div className="store-residential-plan-price">{plan.price}<small> mensuales</small></div>
                <p>{plan.description}</p>
                <div className="store-residential-feature-list">
                  {plan.features.map(feature => (
                    <div key={`${plan.key}-${feature}`} className="store-residential-feature-item">{feature}</div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="residential-coverage" className="store-residential-coverage">
          <div className="store-market-section-header">
            <div>
              <h2>Verificacion de cobertura</h2>
              <p>¿Te gustaria que verifiquemos la cobertura en tu area para alguno de estos planes?</p>
            </div>
          </div>

          <div className="store-residential-coverage-grid">
            <div className="store-residential-coverage-card">
              <strong>Solo necesitamos</strong>
              <ul className="store-residential-list">
                <li>Direccion exacta o ubicacion.</li>
                <li>Plan que te interesa contratar.</li>
                <li>Referencia basica de tu zona si aplica.</li>
              </ul>
            </div>

            <div className="store-residential-coverage-card store-residential-coverage-card-accent">
              <strong>Importante</strong>
              <p>
                Los planes con TV Digital pueden tener restricciones.
                La revision de cobertura permite confirmar disponibilidad real antes de activar el servicio.
              </p>
              <div className="store-residential-coverage-note">
                Comparte tu ubicacion exacta para ayudarte a elegir el plan correcto.
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
