import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useConfigStore } from '../store/config'
import { useStoreCart } from '../store/storeCart'
import { useStoreWishlist } from '../store/storeWishlist'
import { formatMoney } from '../utils/currency'
import { resolveUploadedAssetUrl } from '../utils/assets'
import { formatCompanyName } from '../utils/text'
import '../styles/store-public.css'

type StoreSettings = {
  currency: string
  enabled: boolean
  catalogEnabled: boolean
  cartEnabled: boolean
  checkoutEnabled: boolean
  favoritesEnabled: boolean
  recommendationsEnabled: boolean
  warehouseId: number
  cutoffTime: string
  acceptAfterCutoff: string
  pickupEnabled: boolean
  deliveryEnabled: boolean
  pickupNotes: string
}

type StoreProduct = {
  id: number
  name: string
  categoryId?: number
  parentCategoryId?: number
  subcategoryId?: number
  departmentId?: number
  brandId?: number
  storeBannerPrincipal?: boolean
  bannerPriority?: number
  imageUrl: string | null
  price: number
  compareAtPrice?: number
  stock: number
  productType: string
  description?: string
  categoryName?: string
  parentCategoryName?: string
  subcategoryName?: string
  departmentName?: string
  brandName?: string
  brandLogoUrl?: string | null
  totalSold?: number
}

type CategoryFilter = {
  key: string
  label: string
  count: number
}

type BrandFilter = {
  key: string
  label: string
  count: number
  logoUrl?: string | null
}

type HierarchyNode = {
  key: string
  label: string
  count: number
  categories: Array<{
    key: string
    label: string
    count: number
    subcategories: Array<{
      key: string
      label: string
      count: number
    }>
  }>
}

type SortOption = 'featured' | 'price_asc' | 'price_desc' | 'best_sellers' | 'newest'
type ViewMode = 'grid' | 'list'

const INITIAL_VISIBLE_PRODUCTS = 12
const LOAD_MORE_STEP = 12

const BRAND_LOGO_DOMAINS: Record<string, string> = {
  '3nstar': '3nstar.com',
  'acer': 'acer.com',
  'adata': 'adata.com',
  'amanco': 'amanco.com',
  'amd': 'amd.com',
  'aoc': 'aoc.com',
  'apple': 'apple.com',
  'argom': 'argomtech.com',
  'asus': 'asus.com',
  'band-fix': 'bandfix.com',
  'band fix': 'bandfix.com',
  'belkin': 'belkin.com',
  'benq': 'benq.com',
  'brother': 'brother.com',
  'canon': 'canon.com',
  'cdp': 'cdpups.com',
  'custom': 'custom.biz',
  'corsair': 'corsair.com',
  'dahua': 'dahuasecurity.com',
  'dell': 'dell.com',
  'deviser': 'deviser.com',
  'e-touch': 'etouchlatam.com',
  'etouch': 'etouchlatam.com',
  'epson': 'epson.com',
  'eset': 'eset.com',
  'ezviz': 'ezviz.com',
  'foton': 'fotontv.com',
  'foton tv': 'fotontv.com',
  'forza': 'forzaups.com',
  'gigabyte': 'gigabyte.com',
  'hikvision': 'hikvision.com',
  'honor': 'honor.com',
  'hp': 'hp.com',
  'hpe': 'hpe.com',
  'huawei': 'huawei.com',
  'imou': 'imoulife.com',
  'intel': 'intel.com',
  'jbl': 'jbl.com',
  'kingston': 'kingston.com',
  'klip xtreame': 'klipxtreme.com',
  'klip xtreme': 'klipxtreme.com',
  'lenovo': 'lenovo.com',
  'linkbasic': 'linkbasic.com',
  'logitech': 'logitech.com',
  'mercusys': 'mercusys.com',
  'microsoft': 'microsoft.com',
  'mikrotik': 'mikrotik.com',
  'msi': 'msi.com',
  'nexxt': 'nexxtsolutions.com',
  'nextlink': 'nextlinkinternet.com',
  'nextlink internet': 'nextlinkinternet.com',
  'nvidia': 'nvidia.com',
  'prisma': 'prismafibersolutions.com',
  'primus gaming': 'primusgaming.com',
  'sandisk': 'sandisk.com',
  'samsung': 'samsung.com',
  'seagate': 'seagate.com',
  'sonoff': 'sonoff.tech',
  'tibox': 'tibox.com',
  'tp-link': 'tp-link.com',
  'tplink': 'tp-link.com',
  'ubiquiti': 'ui.com',
  'wester digital': 'westerndigital.com',
  'western digital': 'westerndigital.com',
  'viewsonic': 'viewsonic.com',
  'winersat': 'winersat.com',
  'xiaomi': 'xiaomi.com',
  'xtech': 'xtechamericas.com',
  'yeastar': 'yeastar.com',
  'yofc': 'yofc.com',
  'zkteko': 'zkteco.com',
}

function getOfferLabel(product: StoreProduct) {
  const compareAtPrice = Number(product.compareAtPrice || 0)
  const price = Number(product.price || 0)
  if (!compareAtPrice || compareAtPrice <= price) return ''
  const discount = Math.max(1, Math.round(((compareAtPrice - price) / compareAtPrice) * 100))
  return `Oferta -${discount}%`
}

function getSavingsAmount(product: StoreProduct) {
  const compareAtPrice = Number(product.compareAtPrice || 0)
  const price = Number(product.price || 0)
  if (!compareAtPrice || compareAtPrice <= price) return 0
  return Math.max(0, compareAtPrice - price)
}

function getCategoryLabel(product: StoreProduct) {
  const parentCategory = String(product.parentCategoryName || '').trim()
  if (parentCategory) return parentCategory
  const category = String(product.categoryName || '').trim()
  if (category) return category
  return String(product.productType || 'GENERAL').trim()
}

function getSubcategoryLabel(product: StoreProduct) {
  return String(product.subcategoryName || '').trim()
}

function getDepartmentLabel(product: StoreProduct) {
  const department = String(product.departmentName || '').trim()
  if (department) return department
  return 'GENERAL'
}

function getHierarchyPath(product: StoreProduct) {
  const parts = [getDepartmentLabel(product), getCategoryLabel(product), getSubcategoryLabel(product)].filter(Boolean)
  return parts.join(' > ')
}

function getTagLabels(product: StoreProduct, newestIds: Set<number>, bestSellerIds: Set<number>) {
  const tags: string[] = []
  if (newestIds.has(product.id)) tags.push('Nuevo')
  if (bestSellerIds.has(product.id)) tags.push('Más vendido')
  if (Number(product.stock || 0) > 0 && Number(product.stock || 0) <= 5) tags.push('Pocas unidades')
  return tags
}

function getFeaturedScore(product: StoreProduct, newestIds: Set<number>, bestSellerIds: Set<number>) {
  let score = 0
  if (getOfferLabel(product)) score += 300
  if (bestSellerIds.has(product.id)) score += 220
  if (newestIds.has(product.id)) score += 160
  if (Number(product.stock || 0) > 0 && Number(product.stock || 0) <= 5) score += 40
  score += Math.min(Number(product.totalSold || 0), 50)
  return score
}

function getHeroCopy(product: StoreProduct | null, newestIds: Set<number>, bestSellerIds: Set<number>) {
  if (!product) return 'Encuentra promociones destacadas, categorías visuales y compra rápida desde la tienda en línea.'
  if (getOfferLabel(product)) return 'Aprovecha este precio especial por tiempo limitado y agrégalo al carrito en segundos.'
  if (bestSellerIds.has(product.id)) return 'Uno de los productos con mejor salida en la tienda, ideal para destacar confianza y demanda.'
  if (newestIds.has(product.id)) return 'Recién ingresado al catálogo, listo para compra inmediata con entrega o pickup.'
  if (Number(product.stock || 0) > 0 && Number(product.stock || 0) <= 5) return 'Quedan pocas unidades disponibles, una buena opción para acelerar la conversión.'
  return 'Producto destacado del catálogo online, presentado con acceso rápido a detalle y compra inmediata.'
}

function getBrandBadge(label: string) {
  const cleaned = String(label || '').trim().replace(/\s+/g, ' ')
  if (!cleaned) return ''
  const parts = cleaned.split(' ').filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase()
  return parts.slice(0, 2).map(part => part.slice(0, 1).toUpperCase()).join('')
}

function normalizeBrandKey(label: string) {
  return String(label || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
}

function getBrandLogoUrl(label: string) {
  const normalized = normalizeBrandKey(label)
  const domain = BRAND_LOGO_DOMAINS[normalized]
  if (!domain) return ''
  return `https://logo.clearbit.com/${domain}?size=256`
}

function renderCategoryIcon(label: string) {
  const normalized = normalizeBrandKey(label)
  const iconProps = { width: 28, height: 28, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

  if (/(cableado estructurado|cableado|cables|red estructurada)/.test(normalized)) {
    return (
      <svg {...iconProps}>
        <path d="M7 7h10v4H7z" />
        <path d="M9 11v3" />
        <path d="M12 11v3" />
        <path d="M15 11v3" />
        <path d="M6 17h12" />
      </svg>
    )
  }
  if (/(electricidad|electrico|electrica)/.test(normalized)) {
    return (
      <svg {...iconProps}>
        <path d="M13 2L5 14h5l-1 8 8-12h-5l1-8z" />
      </svg>
    )
  }
  if (/(energia solar|solar|panel solar)/.test(normalized)) {
    return (
      <svg {...iconProps}>
        <circle cx="18" cy="6" r="3" />
        <path d="M6 14l4-2 4 2 4-2" />
        <path d="M5 17h14" />
        <path d="M8 17l-1 4" />
        <path d="M16 17l1 4" />
      </svg>
    )
  }
  if (/(tecnologia|tecnologia general|tech)/.test(normalized)) {
    return (
      <svg {...iconProps}>
        <rect x="4" y="5" width="16" height="10" rx="2" />
        <path d="M10 19h4" />
        <path d="M12 15v4" />
      </svg>
    )
  }
  if (/(general)/.test(normalized)) {
    return (
      <svg {...iconProps}>
        <path d="M12 3l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 15.8 7.2 18l.9-5.4-3.9-3.8 5.4-.8L12 3z" />
      </svg>
    )
  }
  if (/(otro|otros)/.test(normalized)) {
    return (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="8" />
        <path d="M9.5 9.5a2.5 2.5 0 1 1 4.2 1.8c-.9.8-1.7 1.3-1.7 2.2" />
        <path d="M12 17h.01" />
      </svg>
    )
  }
  if (/(audio|video|camara|camaras|videovigilancia|cctv|catv|dtv)/.test(normalized)) {
    return (
      <svg {...iconProps}>
        <rect x="3" y="6" width="13" height="12" rx="2" />
        <path d="M16 10l5-3v10l-5-3z" />
      </svg>
    )
  }
  if (/(seguridad|ciber|alarm|intrusion|intrusi|control de acceso)/.test(normalized)) {
    return (
      <svg {...iconProps}>
        <path d="M12 3l7 3v5c0 4.5-2.5 7.5-7 10-4.5-2.5-7-5.5-7-10V6l7-3z" />
        <path d="M9.5 12.5l1.8 1.8 3.7-3.9" />
      </svg>
    )
  }
  if (/(automat|energia|power|electrica)/.test(normalized)) {
    return (
      <svg {...iconProps}>
        <path d="M13 2L5 14h5l-1 8 8-12h-5l1-8z" />
      </svg>
    )
  }
  if (/(cableado|red|network|fttx)/.test(normalized)) {
    return (
      <svg {...iconProps}>
        <path d="M8 16v-5a4 4 0 0 1 8 0v5" />
        <path d="M12 16v6" />
        <path d="M5 19h14" />
        <path d="M9 5h6" />
      </svg>
    )
  }
  if (/(telefon|ip|comunic)/.test(normalized)) {
    return (
      <svg {...iconProps}>
        <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.3 19.3 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.5 3a2 2 0 0 1-.6 1.8l-1.3 1.3a16 16 0 0 0 6.3 6.3l1.3-1.3a2 2 0 0 1 1.8-.6l3 .5a2 2 0 0 1 1.7 2z" />
      </svg>
    )
  }
  return (
    <svg {...iconProps}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M9 9h6v6H9z" />
    </svg>
  )
}

function BrandOrbVisual({ label, logoUrl }: { label: string; logoUrl?: string | null }) {
  const [imageFailed, setImageFailed] = useState(false)
  const manualLogoUrl = resolveUploadedAssetUrl(logoUrl)
  const externalLogoUrl = getBrandLogoUrl(label)
  const finalLogoUrl = manualLogoUrl || externalLogoUrl

  if (finalLogoUrl && !imageFailed) {
    return (
      <img
        className="store-brand-orb-logo"
        src={finalLogoUrl}
        alt={label}
        loading="lazy"
        onError={() => setImageFailed(true)}
      />
    )
  }

  return <span className="store-brand-orb-mark">{getBrandBadge(label)}</span>
}

type StoreFrontProps = {
  mode?: 'landing' | 'catalog'
}

export default function StoreFront({ mode = 'landing' }: StoreFrontProps) {
  const config = useConfigStore(s => s.config)
  const location = useLocation()
  const navigate = useNavigate()
  const addItem = useStoreCart(s => s.addItem)
  const cartCount = useStoreCart(s => s.count())
  const wishlistIds = useStoreWishlist(s => s.productIds)
  const toggleWishlist = useStoreWishlist(s => s.toggle)
  const carouselRef = useRef<HTMLDivElement | null>(null)
  const brandsMenuRef = useRef<HTMLDivElement | null>(null)
  const [settings, setSettings] = useState<StoreSettings | null>(null)
  const [products, setProducts] = useState<StoreProduct[]>([])
  const [search, setSearch] = useState('')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<StoreProduct | null>(null)
  const [activeDepartment, setActiveDepartment] = useState<string>('ALL')
  const [activeCategory, setActiveCategory] = useState<string>('ALL')
  const [activeSubcategory, setActiveSubcategory] = useState<string>('ALL')
  const [activeBrand, setActiveBrand] = useState<string>('ALL')
  const [expandedDepartment, setExpandedDepartment] = useState<string | null>(null)
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<SortOption>('featured')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_PRODUCTS)
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [onlyOffers, setOnlyOffers] = useState(false)
  const [onlyInStock, setOnlyInStock] = useState(false)
  const [onlyNew, setOnlyNew] = useState(false)
  const [onlyBestSellers, setOnlyBestSellers] = useState(false)
  const [onlyFewUnits, setOnlyFewUnits] = useState(false)
  const [onlyFavorites, setOnlyFavorites] = useState(false)
  const [activeHeroIndex, setActiveHeroIndex] = useState(0)
  const [brandsMenuOpen, setBrandsMenuOpen] = useState(false)

  const title = useMemo(() => formatCompanyName(config?.name || 'TIENDA'), [config?.name])
  const topbarLogoUrl = useMemo(() => {
    const raw = String(config?.logoUrl || '').trim()
    if (!raw || raw.includes('placehold.co/64x64?text=LOGO')) return ''
    return resolveUploadedAssetUrl(raw)
  }, [config?.logoUrl])
  const isCatalogPage = mode === 'catalog'
  const currency = settings?.currency || config?.currency || 'USD'
  const storeEnabled = settings?.enabled !== false
  const catalogEnabled = settings?.catalogEnabled !== false
  const cartEnabled = settings?.cartEnabled !== false
  const checkoutEnabled = settings?.checkoutEnabled !== false
  const favoritesEnabled = settings?.favoritesEnabled !== false
  const recommendationsEnabled = settings?.recommendationsEnabled !== false
  const pickupDeliveryLabel = useMemo(() => {
    if (settings?.pickupEnabled && settings?.deliveryEnabled) return 'Elige método de entrega'
    if (settings?.pickupEnabled) return 'Recoge en tienda'
    if (settings?.deliveryEnabled) return 'Entrega a domicilio'
    return 'Compra online'
  }, [settings])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await api.get('/store/settings')
        if (!cancelled) setSettings(data)
      } catch {
        if (!cancelled) setSettings(null)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        setError(null)
        const { data } = await api.get('/store/products')
        if (!cancelled) setProducts(Array.isArray(data) ? data : [])
      } catch (e: any) {
        if (!cancelled) setError(e?.response?.data?.error || 'No se pudo cargar el catálogo')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const newestIds = useMemo(() => new Set(
    [...products]
      .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))
      .slice(0, 8)
      .map(product => product.id)
  ), [products])

  const bestSellerIds = useMemo(() => new Set(
    [...products]
      .filter(product => Number(product.totalSold || 0) > 0)
      .sort((a, b) => Number(b.totalSold || 0) - Number(a.totalSold || 0))
      .slice(0, 8)
      .map(product => product.id)
  ), [products])

  const categoryFilters = useMemo<CategoryFilter[]>(() => {
    const counts = new Map<string, number>()
    products.forEach(product => {
      const label = getCategoryLabel(product)
      counts.set(label, (counts.get(label) || 0) + 1)
    })
    return [
      { key: 'ALL', label: 'Todas', count: products.length },
      ...Array.from(counts.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([label, count]) => ({ key: label, label, count })),
    ]
  }, [products])

  const categoryHierarchy = useMemo<HierarchyNode[]>(() => {
    const departments = new Map<string, HierarchyNode>()
    products.forEach(product => {
      const departmentLabel = getDepartmentLabel(product)
      const categoryLabel = getCategoryLabel(product)
      const subcategoryLabel = getSubcategoryLabel(product)

      if (!departments.has(departmentLabel)) {
        departments.set(departmentLabel, {
          key: departmentLabel,
          label: departmentLabel,
          count: 0,
          categories: [],
        })
      }
      const departmentNode = departments.get(departmentLabel)!
      departmentNode.count += 1

      let categoryNode = departmentNode.categories.find(category => category.key === categoryLabel)
      if (!categoryNode) {
        categoryNode = {
          key: categoryLabel,
          label: categoryLabel,
          count: 0,
          subcategories: [],
        }
        departmentNode.categories.push(categoryNode)
      }
      categoryNode.count += 1

      if (subcategoryLabel) {
        let subcategoryNode = categoryNode.subcategories.find(subcategory => subcategory.key === subcategoryLabel)
        if (!subcategoryNode) {
          subcategoryNode = { key: subcategoryLabel, label: subcategoryLabel, count: 0 }
          categoryNode.subcategories.push(subcategoryNode)
        }
        subcategoryNode.count += 1
      }
    })

    return Array.from(departments.values())
      .map(department => ({
        ...department,
        categories: department.categories
          .sort((a, b) => a.label.localeCompare(b.label))
          .map(category => ({
            ...category,
            subcategories: [...category.subcategories].sort((a, b) => a.label.localeCompare(b.label)),
          })),
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [products])

  const departmentShowcase = useMemo(() => {
    return categoryHierarchy
      .slice(0, 12)
      .map(department => {
        const sample = products.find(product => getDepartmentLabel(product) === department.key)
        return { ...department, sample }
      })
  }, [categoryHierarchy, products])

  const brandFilters = useMemo<BrandFilter[]>(() => {
    const counts = new Map<string, { count: number; logoUrl: string | null }>()
    products.forEach(product => {
      const label = String(product.brandName || '').trim()
      if (!label) return
      const current = counts.get(label)
      counts.set(label, {
        count: (current?.count || 0) + 1,
        logoUrl: current?.logoUrl || product.brandLogoUrl || null,
      })
    })
    return [
      { key: 'ALL', label: 'Todas', count: products.length, logoUrl: null },
      ...Array.from(counts.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([label, meta]) => ({ key: label, label, count: meta.count, logoUrl: meta.logoUrl })),
    ]
  }, [products])

  const brandShowcase = useMemo(() => {
    return brandFilters
      .filter(filter => filter.key !== 'ALL')
  }, [brandFilters])

  const filteredProducts = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()
    const min = minPrice.trim() ? Number(minPrice) : null
    const max = maxPrice.trim() ? Number(maxPrice) : null

    return products.filter(product => {
      const matchesDepartment = activeDepartment === 'ALL' || getDepartmentLabel(product) === activeDepartment
      if (!matchesDepartment) return false
      const matchesCategory = activeCategory === 'ALL' || getCategoryLabel(product) === activeCategory
      if (!matchesCategory) return false
      const matchesSubcategory = activeSubcategory === 'ALL' || getSubcategoryLabel(product) === activeSubcategory
      if (!matchesSubcategory) return false
      const matchesBrand = activeBrand === 'ALL' || String(product.brandName || '').trim() === activeBrand
      if (!matchesBrand) return false

      const price = Number(product.price || 0)
      if (min !== null && Number.isFinite(min) && price < min) return false
      if (max !== null && Number.isFinite(max) && price > max) return false

      if (onlyOffers && !getOfferLabel(product)) return false
      if (onlyInStock && Number(product.stock || 0) <= 0) return false
      if (onlyNew && !newestIds.has(product.id)) return false
      if (onlyBestSellers && !bestSellerIds.has(product.id)) return false
      if (onlyFewUnits && !(Number(product.stock || 0) > 0 && Number(product.stock || 0) <= 5)) return false
      if (onlyFavorites && !wishlistIds.includes(product.id)) return false

      if (!normalizedSearch) return true
      const haystack = [
        product.name,
        product.description || '',
        getDepartmentLabel(product),
        getCategoryLabel(product),
        getSubcategoryLabel(product),
        product.brandName || '',
      ].join(' ').toLowerCase()
      return haystack.includes(normalizedSearch)
    })
  }, [
    activeBrand,
    activeCategory,
    activeDepartment,
    activeSubcategory,
    bestSellerIds,
    maxPrice,
    minPrice,
    newestIds,
    onlyBestSellers,
    onlyFavorites,
    onlyFewUnits,
    onlyInStock,
    onlyNew,
    onlyOffers,
    products,
    search,
    wishlistIds,
  ])

  const sortedProducts = useMemo(() => {
    const items = [...filteredProducts]
    items.sort((a, b) => {
      if (sortBy === 'price_asc') return Number(a.price || 0) - Number(b.price || 0)
      if (sortBy === 'price_desc') return Number(b.price || 0) - Number(a.price || 0)
      if (sortBy === 'best_sellers') {
        const soldDiff = Number(b.totalSold || 0) - Number(a.totalSold || 0)
        if (soldDiff !== 0) return soldDiff
        return String(a.name || '').localeCompare(String(b.name || ''))
      }
      if (sortBy === 'newest') return Number(b.id || 0) - Number(a.id || 0)
      const featuredDiff = getFeaturedScore(b, newestIds, bestSellerIds) - getFeaturedScore(a, newestIds, bestSellerIds)
      if (featuredDiff !== 0) return featuredDiff
      return Number(b.id || 0) - Number(a.id || 0)
    })
    return items
  }, [bestSellerIds, filteredProducts, newestIds, sortBy])

  const visibleProducts = useMemo(() => sortedProducts.slice(0, visibleCount), [sortedProducts, visibleCount])
  const canLoadMore = visibleCount < sortedProducts.length
  const activeFilterCount = [
    activeDepartment !== 'ALL',
    activeCategory !== 'ALL',
    activeSubcategory !== 'ALL',
    activeBrand !== 'ALL',
    !!minPrice.trim(),
    !!maxPrice.trim(),
    onlyOffers,
    onlyInStock,
    onlyNew,
    onlyBestSellers,
    onlyFewUnits,
    onlyFavorites,
  ].filter(Boolean).length

  const promoProducts = useMemo(() => {
    const featured = products.filter(product =>
      Number(product.bannerPriority || 0) > 0 || Boolean(product.storeBannerPrincipal) || !!getOfferLabel(product) || newestIds.has(product.id) || bestSellerIds.has(product.id)
    )
    return [...(featured.length ? featured : products)]
      .sort((a, b) => {
        const bannerDiff = Number(b.bannerPriority || 0) - Number(a.bannerPriority || 0)
        if (bannerDiff !== 0) return bannerDiff
        return getFeaturedScore(b, newestIds, bestSellerIds) - getFeaturedScore(a, newestIds, bestSellerIds)
      })
      .slice(0, 8)
  }, [bestSellerIds, newestIds, products])

  const heroProducts = useMemo(() => promoProducts.slice(0, 4), [promoProducts])

  const newlyArrivedProducts = useMemo(() => {
    return [...products]
      .sort((a, b) => Number(b.id || 0) - Number(a.id || 0))
      .slice(0, 5)
  }, [products])

  const topSellingProducts = useMemo(() => {
    return [...products]
      .sort((a, b) => Number(b.totalSold || 0) - Number(a.totalSold || 0))
      .slice(0, 5)
  }, [products])

  const relatedProducts = useMemo(() => {
    if (!selectedProduct) return []
    const related = [...products]
      .filter(product => product.id !== selectedProduct.id)
      .filter(product => {
        if (selectedProduct.categoryId && product.categoryId) return product.categoryId === selectedProduct.categoryId
        return getCategoryLabel(product) === getCategoryLabel(selectedProduct)
      })
      .sort((a, b) => getFeaturedScore(b, newestIds, bestSellerIds) - getFeaturedScore(a, newestIds, bestSellerIds))
    return related.slice(0, 4)
  }, [bestSellerIds, newestIds, products, selectedProduct])

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_PRODUCTS)
  }, [
    activeBrand,
    activeCategory,
    activeDepartment,
    activeSubcategory,
    maxPrice,
    minPrice,
    onlyBestSellers,
    onlyFavorites,
    onlyFewUnits,
    onlyInStock,
    onlyNew,
    onlyOffers,
    search,
    sortBy,
    viewMode,
  ])

  useEffect(() => {
    if (!isCatalogPage) return
    const params = new URLSearchParams(location.search)
    const brandFromQuery = String(params.get('brand') || '').trim()
    setActiveBrand(brandFromQuery || 'ALL')
  }, [isCatalogPage, location.search])

  useEffect(() => {
    setBrandsMenuOpen(false)
  }, [location.pathname, location.search])

  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      if (!brandsMenuRef.current) return
      if (brandsMenuRef.current.contains(event.target as Node)) return
      setBrandsMenuOpen(false)
    }

    document.addEventListener('mousedown', handleDocumentClick)
    return () => document.removeEventListener('mousedown', handleDocumentClick)
  }, [])

  useEffect(() => {
    if (activeDepartment !== 'ALL') setExpandedDepartment(activeDepartment)
    if (activeCategory !== 'ALL') setExpandedCategory(`${activeDepartment}::${activeCategory}`)
    if (activeDepartment === 'ALL' && activeCategory === 'ALL' && activeSubcategory === 'ALL') {
      setExpandedDepartment(null)
      setExpandedCategory(null)
    }
  }, [activeCategory, activeDepartment, activeSubcategory])

  useEffect(() => {
    if (!favoritesEnabled && onlyFavorites) setOnlyFavorites(false)
  }, [favoritesEnabled, onlyFavorites])

  useEffect(() => {
    setActiveHeroIndex(current => {
      if (!heroProducts.length) return 0
      return Math.min(current, heroProducts.length - 1)
    })
  }, [heroProducts])

  useEffect(() => {
    if (heroProducts.length <= 1) return
    const timer = window.setInterval(() => {
      setActiveHeroIndex(current => (current + 1) % heroProducts.length)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [heroProducts])

  function addToCart(product: StoreProduct) {
    if (!cartEnabled) {
      window.alert('El carrito está desactivado en esta tienda.')
      return
    }
    addItem({ productId: product.id, name: product.name, price: product.price, imageUrl: product.imageUrl }, 1)
  }

  function toggleFavorite(productId: number) {
    if (!favoritesEnabled) return
    toggleWishlist(productId)
  }

  function scrollPromos(direction: 'prev' | 'next') {
    const node = carouselRef.current
    if (!node) return
    const amount = Math.max(320, Math.round(node.clientWidth * 0.8))
    node.scrollBy({ left: direction === 'next' ? amount : -amount, behavior: 'smooth' })
  }

  function moveHero(direction: 'prev' | 'next') {
    if (!heroProducts.length) return
    setActiveHeroIndex(current => {
      if (direction === 'prev') return current === 0 ? heroProducts.length - 1 : current - 1
      return (current + 1) % heroProducts.length
    })
  }

  function clearCatalogFilters() {
    setSearch('')
    setMinPrice('')
    setMaxPrice('')
    setActiveDepartment('ALL')
    setActiveCategory('ALL')
    setActiveSubcategory('ALL')
    setActiveBrand('ALL')
    setExpandedDepartment(null)
    setExpandedCategory(null)
    setOnlyOffers(false)
    setOnlyInStock(false)
    setOnlyNew(false)
    setOnlyBestSellers(false)
    setOnlyFewUnits(false)
    setOnlyFavorites(false)
  }

  function renderBrandsDropdown(currentMode: 'catalog' | 'landing') {
    const visibleBrands = brandShowcase

    return (
      <div
        className={`store-market-dropdown ${brandsMenuOpen ? 'store-market-dropdown-open' : ''}`}
        ref={brandsMenuRef}
        onMouseEnter={() => setBrandsMenuOpen(true)}
        onMouseLeave={() => setBrandsMenuOpen(false)}
      >
        <button
          type="button"
          className={`store-market-dropdown-trigger ${activeBrand !== 'ALL' ? 'store-market-link-active' : ''}`}
          onClick={() => setBrandsMenuOpen(current => !current)}
          aria-haspopup="menu"
          aria-expanded={brandsMenuOpen}
        >
          Marcas
          <span aria-hidden="true">{brandsMenuOpen ? '▴' : '▾'}</span>
        </button>

        <div className="store-market-dropdown-panel" role="menu">
          <div className="store-market-dropdown-grid">
            {currentMode === 'catalog' ? (
              <Link
                to="/tienda/catalogo"
                className={`store-market-brand-card ${activeBrand === 'ALL' ? 'store-market-brand-card-active' : ''}`}
                role="menuitem"
                onClick={() => setBrandsMenuOpen(false)}
              >
                <span className="store-market-brand-card-logo">
                  <span className="store-brand-orb-mark">TM</span>
                </span>
              </Link>
            ) : null}
            {visibleBrands.map((brand) => (
              <Link
                key={`header-brand-${currentMode}-${brand.key}`}
                to={`/tienda/catalogo?brand=${encodeURIComponent(brand.key)}`}
                className={`store-market-brand-card ${activeBrand === brand.key ? 'store-market-brand-card-active' : ''}`}
                role="menuitem"
                onClick={() => setBrandsMenuOpen(false)}
              >
                <span className="store-market-brand-card-logo">
                  <BrandOrbVisual label={brand.label} logoUrl={brand.logoUrl} />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    )
  }

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
            {isCatalogPage ? (
              <>
                <Link to="/tienda">Inicio</Link>
                <Link to="/tienda/catalogo" className="store-market-link-active">Tienda</Link>
                <Link to="/internet-residencial">Internet residencial</Link>
                <Link to="/tienda#store-categories">Categorías</Link>
                {renderBrandsDropdown('catalog')}
                {recommendationsEnabled ? <a href="#store-top-sales">Soporte</a> : null}
              </>
            ) : (
              <>
                <Link to="/tienda" className="store-market-link-active">Inicio</Link>
                <Link to="/tienda/catalogo">Tienda</Link>
                <Link to="/internet-residencial">Internet residencial</Link>
                <a href="#store-categories">Categorías</a>
                {renderBrandsDropdown('landing')}
                {recommendationsEnabled ? <a href="#store-top-sales">Soporte</a> : null}
              </>
            )}
          </nav>

          <div className="store-market-search">
            <span className="store-market-search-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </span>
            <input
              className="store-market-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar productos..."
            />
          </div>

          <div className="store-market-actions">
            {cartEnabled ? (
              <Link to="/tienda/carrito" className="store-market-icon-link">
                <span>Carrito</span>
                <strong>{cartCount}</strong>
              </Link>
            ) : null}
          </div>
        </header>

        {!storeEnabled ? (
          <section className="store-market-categories">
            <div className="store-empty">
              <h3 style={{ marginTop: 0, marginBottom: 8 }}>Tienda temporalmente desactivada</h3>
              <div style={{ color: 'var(--store-muted)' }}>
                Este negocio decidió desactivar su tienda en línea desde el panel administrativo.
              </div>
            </div>
          </section>
        ) : null}

        {storeEnabled ? (
        <>
        {!isCatalogPage ? (
        <>
        <section id="store-hero" className="store-market-hero">
          <div className="store-market-hero-main">
            <div
              className="store-market-hero-track"
              style={{ transform: `translateX(-${activeHeroIndex * 100}%)` }}
            >
              {heroProducts.length ? heroProducts.map((heroProduct, index) => {
                const heroOfferLabel = getOfferLabel(heroProduct) || 'Destacado online'
                const heroSavingsAmount = getSavingsAmount(heroProduct)
                const heroTags = getTagLabels(heroProduct, newestIds, bestSellerIds).slice(0, 2)
                const heroHierarchy = getHierarchyPath(heroProduct)
                const heroCopy = getHeroCopy(heroProduct, newestIds, bestSellerIds)

                return (
                  <article key={`hero-${heroProduct.id}-${index}`} className="store-market-hero-slide">
                    <div className="store-market-hero-glow" aria-hidden="true" />
                    {heroProduct.imageUrl ? (
                      <img src={resolveUploadedAssetUrl(heroProduct.imageUrl)} alt={heroProduct.name} />
                    ) : (
                      <div className="store-market-hero-placeholder">Sin imagen</div>
                    )}
                    <div className="store-market-hero-overlay">
                      <div className="store-market-hero-topline">
                        <span className="store-market-eyebrow">{heroOfferLabel}</span>
                        {heroTags.map(tag => (
                          <span key={`hero-${heroProduct.id}-${tag}`} className="store-market-hero-tag">{tag}</span>
                        ))}
                      </div>
                      <h1>{heroProduct.name || `${title} Tienda en Línea`}</h1>
                      {heroHierarchy ? <div className="store-market-hero-path">{heroHierarchy}</div> : null}
                      <div className="store-market-hero-pricing">
                        <div className="store-market-hero-price">{formatMoney(heroProduct.price, currency)}</div>
                        {Number(heroProduct.compareAtPrice || 0) > Number(heroProduct.price || 0) ? (
                          <div className="store-market-hero-compare">
                            <span>{formatMoney(Number(heroProduct.compareAtPrice || 0), currency)}</span>
                            {heroSavingsAmount > 0 ? <strong>Ahorra {formatMoney(heroSavingsAmount, currency)}</strong> : null}
                          </div>
                        ) : null}
                      </div>
                      <p>{heroCopy}</p>
                      <div className="store-market-hero-actions">
                        <button type="button" className="store-button store-button-market" onClick={() => addToCart(heroProduct)}>
                          Agregar al carrito
                        </button>
                        <button type="button" className="store-button-secondary" onClick={() => setSelectedProduct(heroProduct)}>
                          Ver detalle
                        </button>
                      </div>
                    </div>
                  </article>
                )
              }) : (
                <article className="store-market-hero-slide">
                  <div className="store-market-hero-glow" aria-hidden="true" />
                  <div className="store-market-hero-placeholder">Sin imagen</div>
                  <div className="store-market-hero-overlay">
                    <div className="store-market-hero-topline">
                      <span className="store-market-eyebrow">Colección destacada</span>
                    </div>
                    <h1>{`${title} Tienda en Línea`}</h1>
                    <p>Encuentra promociones destacadas, categorías visuales y compra rápida desde la tienda en línea.</p>
                  </div>
                </article>
              )}
            </div>
            {heroProducts.length > 1 ? (
              <>
                <button type="button" className="store-market-hero-nav store-market-hero-nav-prev" onClick={() => moveHero('prev')} aria-label="Banner anterior">
                  ‹
                </button>
                <button type="button" className="store-market-hero-nav store-market-hero-nav-next" onClick={() => moveHero('next')} aria-label="Banner siguiente">
                  ›
                </button>
                <div className="store-market-hero-dots">
                  {heroProducts.map((product, index) => (
                    <button
                      key={`hero-dot-${product.id}`}
                      type="button"
                      className={`store-market-hero-dot ${activeHeroIndex === index ? 'store-market-hero-dot-active' : ''}`}
                      onClick={() => setActiveHeroIndex(index)}
                      aria-label={`Ver banner ${index + 1}`}
                    />
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </section>

        <section id="store-categories" className="store-market-categories">
          <div className="store-market-section-header store-market-section-header-centered">
            <div>
              <h2>CATEGORÍAS</h2>
              <p>Encuentra todo lo que necesitas para tu empresa en nuestras categorías especializadas.</p>
            </div>
          </div>

          <div className="store-market-category-grid">
            {departmentShowcase.map(department => (
              <button
                key={department.key}
                type="button"
                className={`store-market-category-card ${activeDepartment === department.key ? 'store-market-category-card-active' : ''}`}
                onClick={() => {
                  setActiveDepartment(department.key)
                  setActiveCategory('ALL')
                  setActiveSubcategory('ALL')
                }}
              >
                <div className="store-market-category-thumb">
                  {renderCategoryIcon(department.label)}
                </div>
                <div className="store-market-category-label">{department.label}</div>
              </button>
            ))}
          </div>
        </section>

        {recommendationsEnabled ? (
        <section className="store-market-carousel">
          <div className="store-market-section-header">
            <div>
              <h2>Recién ingreso</h2>
            </div>
            <div className="store-actions">
              <button type="button" className="store-button-ghost" onClick={() => scrollPromos('prev')}>Anterior</button>
              <button type="button" className="store-button-ghost" onClick={() => scrollPromos('next')}>Siguiente</button>
            </div>
          </div>

          <div ref={carouselRef} className="store-market-product-row">
            {newlyArrivedProducts.map(product => {
              const isFavorite = wishlistIds.includes(product.id)
              const tags = getTagLabels(product, newestIds, bestSellerIds)
              return (
                <article key={`new-${product.id}`} className="store-market-row-card">
                  <button
                    type="button"
                    className={`store-favorite-button store-favorite-button-light ${isFavorite ? 'store-favorite-button-active' : ''}`}
                    onClick={() => toggleFavorite(product.id)}
                    aria-label={isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                    title={isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                  >
                    {isFavorite ? '♥' : '♡'}
                  </button>
                  <div className="store-market-row-image">
                    {product.imageUrl ? (
                      <img src={resolveUploadedAssetUrl(product.imageUrl)} alt={product.name} />
                    ) : (
                      <div className="store-card-fallback">Sin imagen</div>
                    )}
                  </div>
                  <div className="store-market-row-body">
                    <div className="store-chip-row">
                      {tags.map(tag => <span key={`${product.id}-${tag}`} className="store-chip store-chip-light">{tag}</span>)}
                    </div>
                    <div className="store-product-title">{product.name}</div>
                    <div className="store-price">{formatMoney(product.price, currency)}</div>
                    <div className="store-card-actions">
                      <button type="button" className="store-button store-button-full store-button-market" onClick={() => addToCart(product)}>
                        Agregar
                      </button>
                      <button type="button" className="store-button-ghost" onClick={() => setSelectedProduct(product)}>
                        Ver
                      </button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
        ) : null}
        </>
        ) : null}

        {isCatalogPage ? (
        <section id="store-catalog" className="store-market-catalog-wrap">
          <div className="store-market-section-header">
            <div>
              <h2>Catalogo</h2>
            </div>
          </div>

          <div className="store-market-catalog-layout">
            <aside className={`store-market-sidebar ${filtersOpen ? '' : 'store-market-sidebar-collapsed'}`}>
              {filtersOpen ? (
                <div className="store-market-filters-panel">
                  <details className="store-filter-group" open>
                    <summary className="store-filter-group-title">Departamentos, categorías y subcategorías</summary>
                    <div className="store-filter-group-body store-filter-group-body-column">
                      <button
                        type="button"
                        className={`store-filter-chip store-filter-chip-light ${activeDepartment === 'ALL' && activeCategory === 'ALL' && activeSubcategory === 'ALL' ? 'store-filter-chip-active' : ''}`}
                        onClick={() => {
                          setActiveDepartment('ALL')
                          setActiveCategory('ALL')
                          setActiveSubcategory('ALL')
                        }}
                      >
                        Todas las categorías
                      </button>

                      <div className="store-hierarchy-tree">
                        {categoryHierarchy.map(department => (
                          <div
                            key={department.key}
                            className="store-hierarchy-department"
                          >
                            <div className="store-hierarchy-summary">
                              <button
                                type="button"
                                className={`store-hierarchy-button ${activeDepartment === department.key && activeCategory === 'ALL' && activeSubcategory === 'ALL' ? 'store-hierarchy-button-active' : ''}`}
                                onClick={() => {
                                  const nextExpanded = expandedDepartment === department.key ? null : department.key
                                  setExpandedDepartment(nextExpanded)
                                  setExpandedCategory(null)
                                  setActiveDepartment(department.key)
                                  setActiveCategory('ALL')
                                  setActiveSubcategory('ALL')
                                }}
                              >
                                <span>{department.label}</span>
                                <span className="store-hierarchy-button-meta">
                                  <span className="store-filter-count">{department.count}</span>
                                  <span className="store-hierarchy-arrow">{expandedDepartment === department.key ? '−' : '+'}</span>
                                </span>
                              </button>
                            </div>

                            {expandedDepartment === department.key ? (
                            <div className="store-hierarchy-children">
                              {department.categories.map(category => (
                                <div
                                  key={`${department.key}-${category.key}`}
                                  className="store-hierarchy-category"
                                >
                                  <div className="store-hierarchy-summary">
                                    <button
                                      type="button"
                                      className={`store-hierarchy-button store-hierarchy-button-level2 ${activeDepartment === department.key && activeCategory === category.key && activeSubcategory === 'ALL' ? 'store-hierarchy-button-active' : ''}`}
                                      onClick={() => {
                                        const nextCategoryKey = expandedCategory === `${department.key}::${category.key}` ? null : `${department.key}::${category.key}`
                                        setExpandedCategory(nextCategoryKey)
                                        setActiveDepartment(department.key)
                                        setActiveCategory(category.key)
                                        setActiveSubcategory('ALL')
                                      }}
                                    >
                                      <span>{category.label}</span>
                                      <span className="store-hierarchy-button-meta">
                                        <span className="store-filter-count">{category.count}</span>
                                        {category.subcategories.length ? (
                                          <span className="store-hierarchy-arrow">{expandedCategory === `${department.key}::${category.key}` ? '−' : '+'}</span>
                                        ) : null}
                                      </span>
                                    </button>
                                  </div>

                                  {category.subcategories.length && expandedCategory === `${department.key}::${category.key}` ? (
                                    <div className="store-hierarchy-children">
                                      {category.subcategories.map(subcategory => (
                                        <button
                                          key={`${department.key}-${category.key}-${subcategory.key}`}
                                          type="button"
                                          className={`store-hierarchy-button store-hierarchy-button-level3 ${activeDepartment === department.key && activeCategory === category.key && activeSubcategory === subcategory.key ? 'store-hierarchy-button-active' : ''}`}
                                          onClick={() => {
                                            setActiveDepartment(department.key)
                                            setActiveCategory(category.key)
                                            setActiveSubcategory(subcategory.key)
                                          }}
                                        >
                                          {subcategory.label}
                                          <span className="store-filter-count">{subcategory.count}</span>
                                        </button>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  </details>

                  <details className="store-filter-group" open>
                    <summary className="store-filter-group-title">Precio</summary>
                    <div className="store-filter-group-body store-price-filter-grid">
                      <div>
                        <label className="store-field-label" htmlFor="store-min-price">Precio mínimo</label>
                        <input
                          id="store-min-price"
                          className="store-input store-input-light"
                          inputMode="decimal"
                          value={minPrice}
                          onChange={(e) => setMinPrice(e.target.value)}
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="store-field-label" htmlFor="store-max-price">Precio máximo</label>
                        <input
                          id="store-max-price"
                          className="store-input store-input-light"
                          inputMode="decimal"
                          value={maxPrice}
                          onChange={(e) => setMaxPrice(e.target.value)}
                          placeholder="9999"
                        />
                      </div>
                    </div>
                  </details>

                  <details className="store-filter-group" open>
                    <summary className="store-filter-group-title">Filtros generales</summary>
                    <div className="store-filter-group-body store-filter-group-body-column">
                      <button type="button" className={`store-hierarchy-button ${onlyOffers ? 'store-hierarchy-button-active' : ''}`} onClick={() => setOnlyOffers(v => !v)}>Solo ofertas</button>
                      <button type="button" className={`store-hierarchy-button ${onlyInStock ? 'store-hierarchy-button-active' : ''}`} onClick={() => setOnlyInStock(v => !v)}>Con stock</button>
                      <button type="button" className={`store-hierarchy-button ${onlyNew ? 'store-hierarchy-button-active' : ''}`} onClick={() => setOnlyNew(v => !v)}>Nuevos</button>
                      <button type="button" className={`store-hierarchy-button ${onlyBestSellers ? 'store-hierarchy-button-active' : ''}`} onClick={() => setOnlyBestSellers(v => !v)}>Más vendidos</button>
                      <button type="button" className={`store-hierarchy-button ${onlyFewUnits ? 'store-hierarchy-button-active' : ''}`} onClick={() => setOnlyFewUnits(v => !v)}>Pocas unidades</button>
                      <button type="button" className={`store-hierarchy-button ${onlyFavorites ? 'store-hierarchy-button-active' : ''}`} onClick={() => setOnlyFavorites(v => !v)}>Favoritos</button>
                    </div>
                  </details>

                </div>
              ) : (
                <div className="store-market-sidebar-mini">
                  <div className="store-market-sidebar-mini-title">Filtros compactos</div>
                  <div className="store-market-sidebar-mini-copy">Activos: {activeFilterCount}</div>
                </div>
              )}
            </aside>

            <div className="store-market-catalog-main">
              <div className="store-toolbar">
                <div className="store-toolbar-copy">
                  Mostrando <strong>{visibleProducts.length}</strong> de <strong>{sortedProducts.length}</strong> productos
                </div>
                <div className="store-toolbar-controls">
                  <div className="store-view-toggle">
                    <button
                      type="button"
                      className={`store-button-ghost store-view-icon-button ${viewMode === 'grid' ? 'store-toggle-active' : ''}`}
                      onClick={() => setViewMode('grid')}
                      aria-label="Vista grid"
                      title="Vista grid"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="7" height="7" rx="1.5" />
                        <rect x="14" y="3" width="7" height="7" rx="1.5" />
                        <rect x="3" y="14" width="7" height="7" rx="1.5" />
                        <rect x="14" y="14" width="7" height="7" rx="1.5" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={`store-button-ghost store-view-icon-button ${viewMode === 'list' ? 'store-toggle-active' : ''}`}
                      onClick={() => setViewMode('list')}
                      aria-label="Vista lista"
                      title="Vista lista"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M8 6h13" />
                        <path d="M8 12h13" />
                        <path d="M8 18h13" />
                        <circle cx="4" cy="6" r="1.2" fill="currentColor" stroke="none" />
                        <circle cx="4" cy="12" r="1.2" fill="currentColor" stroke="none" />
                        <circle cx="4" cy="18" r="1.2" fill="currentColor" stroke="none" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="store-button-ghost store-view-icon-button store-clear-filters-button"
                      onClick={clearCatalogFilters}
                      aria-label="Borrar filtros"
                      title="Borrar filtros"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M19 6l-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6" />
                        <path d="M14 11v6" />
                      </svg>
                    </button>
                  </div>

                  <div className="store-sort-wrap">
                    <select
                      id="store-sort"
                      className="store-select store-input-light"
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as SortOption)}
                    >
                      <option value="featured">Destacados</option>
                      <option value="price_asc">Precio: menor a mayor</option>
                      <option value="price_desc">Precio: mayor a menor</option>
                      <option value="best_sellers">Más vendidos</option>
                      <option value="newest">Nuevos</option>
                    </select>
                  </div>
                </div>
              </div>

              {error ? <div className="store-error">{error}</div> : null}
              {!catalogEnabled ? (
                <div className="store-empty">
                  <h3 style={{ marginTop: 0, marginBottom: 8 }}>Catálogo web desactivado</h3>
                  <div style={{ color: 'var(--store-muted)' }}>
                    El catálogo público está desactivado desde la configuración de Tienda en Línea.
                  </div>
                </div>
              ) : null}
              {loading ? <div className="store-loading">Cargando catálogo...</div> : null}

              {!loading && catalogEnabled && sortedProducts.length === 0 ? (
                <div className="store-empty">
                  <h3 style={{ marginTop: 0, marginBottom: 8 }}>No encontramos productos</h3>
                  <div style={{ color: 'var(--store-muted)' }}>Prueba con otra búsqueda o ajusta los filtros.</div>
                </div>
              ) : null}

              {!loading && catalogEnabled && sortedProducts.length > 0 ? (
                <>
                  <div className={viewMode === 'grid' ? 'store-products-grid' : 'store-products-list'}>
                    {visibleProducts.map(product => {
                      const offerLabel = getOfferLabel(product)
                      const categoryLabel = getCategoryLabel(product)
                      const tags = getTagLabels(product, newestIds, bestSellerIds)
                      const isFavorite = wishlistIds.includes(product.id)

                      return (
                        <article key={product.id} className={`store-card store-card-light ${viewMode === 'list' ? 'store-card-list' : ''}`}>
                          <div className="store-card-media">
                            <div className="store-badge-stack">
                              <div className="store-badge-column">
                                {categoryLabel ? <span className="store-badge-soft store-badge-category">{categoryLabel}</span> : null}
                                {offerLabel ? <span className="store-badge-soft store-badge-offer">{offerLabel}</span> : null}
                              </div>
                              <div className="store-badge-column">
                                <span className="store-badge-soft store-badge-light">Stock {product.stock}</span>
                              </div>
                            </div>

                            {favoritesEnabled ? (
                              <button
                                type="button"
                                className={`store-favorite-button store-favorite-button-light ${isFavorite ? 'store-favorite-button-active' : ''}`}
                                onClick={() => toggleFavorite(product.id)}
                                aria-label={isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                                title={isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                              >
                                {isFavorite ? '♥' : '♡'}
                              </button>
                            ) : null}

                            {product.imageUrl ? (
                              <img src={resolveUploadedAssetUrl(product.imageUrl)} alt={product.name} />
                            ) : (
                              <div className="store-card-fallback">Sin imagen</div>
                            )}
                          </div>

                          <div className="store-card-body">
                            <div className="store-hierarchy-label">{getHierarchyPath(product)}</div>
                            <div className="store-chip-row">
                              {tags.map(tag => <span key={`${product.id}-${tag}`} className="store-chip store-chip-light">{tag}</span>)}
                            </div>
                            <div className="store-product-title">{product.name}</div>
                            <div className="store-product-copy">
                              {product.description?.trim() ? product.description.trim().slice(0, 120) : 'Producto disponible para compra inmediata.'}
                            </div>

                            <div className="store-meta-row">
                              <div className="store-price-wrap">
                                <div className="store-price">{formatMoney(product.price, currency)}</div>
                                {Number(product.compareAtPrice || 0) > Number(product.price || 0) ? (
                                  <div className="store-compare-price">{formatMoney(Number(product.compareAtPrice || 0), currency)}</div>
                                ) : null}
                              </div>
                              <div className="store-stock">{product.stock > 0 ? 'Disponible' : 'Agotado'}</div>
                            </div>

                            <div className="store-card-actions">
                              {cartEnabled ? (
                                <button type="button" className="store-button store-button-full store-button-market" onClick={() => addToCart(product)}>
                                  Agregar al carrito
                                </button>
                              ) : null}
                              <button type="button" className="store-button-ghost" onClick={() => setSelectedProduct(product)}>
                                Vista rápida
                              </button>
                            </div>
                          </div>
                        </article>
                      )
                    })}
                  </div>

                  {canLoadMore ? (
                    <div className="store-load-more-wrap">
                      <button type="button" className="store-button-secondary" onClick={() => setVisibleCount((count) => count + LOAD_MORE_STEP)}>
                        Cargar más productos
                      </button>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </section>
        ) : null}

        {!isCatalogPage && recommendationsEnabled ? (
        <section id="store-top-sales" className="store-market-carousel">
          <div className="store-market-section-header">
            <div>
              <h2>Más vendidos</h2>
            </div>
          </div>

          <div className="store-market-product-row store-market-product-row-static">
            {topSellingProducts.map(product => (
              <article key={`top-${product.id}`} className="store-market-row-card store-market-row-card-compact">
                <div className="store-market-row-image">
                  {product.imageUrl ? (
                    <img src={resolveUploadedAssetUrl(product.imageUrl)} alt={product.name} />
                  ) : (
                    <div className="store-card-fallback">Sin imagen</div>
                  )}
                </div>
                <div className="store-market-row-body">
                  <div className="store-product-title">{product.name}</div>
                  <div className="store-price">{formatMoney(product.price, currency)}</div>
                  <button type="button" className="store-button store-button-full store-button-market" onClick={() => addToCart(product)}>
                    Comprar
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
        ) : null}

        {!isCatalogPage && brandShowcase.length ? (
        <section id="store-brands" className="store-brand-showcase">
          <div className="store-market-section-header">
            <div>
              <h2>Marcas destacadas</h2>
            </div>
          </div>

          <div className="store-brand-marquee">
            <div className="store-brand-track">
              {[...brandShowcase, ...brandShowcase].map((brand, index) => (
                <button
                  key={`brand-row-a-${brand.key}-${index}`}
                  type="button"
                  className="store-brand-orb"
                  onClick={() => navigate(`/tienda/catalogo?brand=${encodeURIComponent(brand.key)}`)}
                  title={`Ver productos de ${brand.label}`}
                >
                  <BrandOrbVisual label={brand.label} logoUrl={brand.logoUrl} />
                </button>
              ))}
            </div>
          </div>

          {brandShowcase.length > 8 ? (
          <div className="store-brand-marquee store-brand-marquee-secondary">
            <div className="store-brand-track store-brand-track-reverse">
              {[...brandShowcase.slice(8), ...brandShowcase.slice(0, 8), ...brandShowcase.slice(8), ...brandShowcase.slice(0, 8)].map((brand, index) => (
                <button
                  key={`brand-row-b-${brand.key}-${index}`}
                  type="button"
                  className="store-brand-orb"
                  onClick={() => navigate(`/tienda/catalogo?brand=${encodeURIComponent(brand.key)}`)}
                  title={`Ver productos de ${brand.label}`}
                >
                  <BrandOrbVisual label={brand.label} logoUrl={brand.logoUrl} />
                </button>
              ))}
            </div>
          </div>
          ) : null}
        </section>
        ) : null}
        </>
        ) : null}
      </div>

      {storeEnabled && cartEnabled ? (
        <Link to="/tienda/carrito" className="store-floating-cart">
          <span className="store-floating-cart-count">{cartCount}</span>
          <span>Carrito</span>
        </Link>
      ) : null}

      {selectedProduct ? (
        <div className="store-modal-backdrop" onClick={() => setSelectedProduct(null)}>
          <div className="store-modal" onClick={(e) => e.stopPropagation()}>
            <div className="store-modal-grid">
              <div className="store-modal-media">
                {favoritesEnabled ? (
                  <button
                    type="button"
                    className={`store-favorite-button store-favorite-button-light ${wishlistIds.includes(selectedProduct.id) ? 'store-favorite-button-active' : ''}`}
                    onClick={() => toggleFavorite(selectedProduct.id)}
                    aria-label={wishlistIds.includes(selectedProduct.id) ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                    title={wishlistIds.includes(selectedProduct.id) ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                  >
                    {wishlistIds.includes(selectedProduct.id) ? '♥' : '♡'}
                  </button>
                ) : null}
                {selectedProduct.imageUrl ? (
                  <img src={resolveUploadedAssetUrl(selectedProduct.imageUrl)} alt={selectedProduct.name} />
                ) : (
                  <div className="store-card-fallback">Sin imagen</div>
                )}
              </div>

              <div className="store-modal-content">
                <button type="button" className="store-button-ghost store-modal-close" onClick={() => setSelectedProduct(null)}>
                  Cerrar
                </button>

                <div className="store-chip-row">
                  <span className="store-chip store-chip-light">{getCategoryLabel(selectedProduct)}</span>
                  {getOfferLabel(selectedProduct) ? <span className="store-chip store-chip-light">{getOfferLabel(selectedProduct)}</span> : null}
                  {getTagLabels(selectedProduct, newestIds, bestSellerIds).map(tag => (
                    <span key={`modal-${selectedProduct.id}-${tag}`} className="store-chip store-chip-light">{tag}</span>
                  ))}
                </div>

                <div className="store-hierarchy-label">{getHierarchyPath(selectedProduct)}</div>

                <h2 className="store-modal-title">{selectedProduct.name}</h2>

                <div className="store-price-wrap">
                  <div className="store-price">{formatMoney(selectedProduct.price, currency)}</div>
                  {Number(selectedProduct.compareAtPrice || 0) > Number(selectedProduct.price || 0) ? (
                    <div className="store-compare-price">{formatMoney(Number(selectedProduct.compareAtPrice || 0), currency)}</div>
                  ) : null}
                </div>

                <div className="store-modal-description">
                  {selectedProduct.description?.trim() || 'Este producto está disponible en la tienda online. Agrégalo al carrito para continuar con el checkout.'}
                </div>

                <div className="store-detail-list">
                  <div className="store-detail-row">
                    <span>Departamento</span>
                    <strong>{getDepartmentLabel(selectedProduct)}</strong>
                  </div>
                  <div className="store-detail-row">
                    <span>Categoría</span>
                    <strong>{getCategoryLabel(selectedProduct)}</strong>
                  </div>
                  {getSubcategoryLabel(selectedProduct) ? (
                    <div className="store-detail-row">
                      <span>Subcategoría</span>
                      <strong>{getSubcategoryLabel(selectedProduct)}</strong>
                    </div>
                  ) : null}
                  <div className="store-detail-row">
                    <span>Marca</span>
                    <strong>{selectedProduct.brandName?.trim() || 'Sin marca'}</strong>
                  </div>
                  <div className="store-detail-row">
                    <span>Disponibilidad</span>
                    <strong>{selectedProduct.stock > 0 ? `Stock ${selectedProduct.stock}` : 'Agotado'}</strong>
                  </div>
                  <div className="store-detail-row">
                    <span>Vendidos</span>
                    <strong>{Number(selectedProduct.totalSold || 0)}</strong>
                  </div>
                </div>

                {recommendationsEnabled && relatedProducts.length ? (
                  <div className="store-related-block">
                    <div className="store-section-title">Productos relacionados</div>
                    <div className="store-related-grid">
                      {relatedProducts.map(product => (
                        <button
                          key={`related-${product.id}`}
                          type="button"
                          className="store-related-card"
                          onClick={() => setSelectedProduct(product)}
                        >
                          <div className="store-related-thumb">
                            {product.imageUrl ? (
                              <img src={resolveUploadedAssetUrl(product.imageUrl)} alt={product.name} />
                            ) : (
                              <div className="store-card-fallback">Sin imagen</div>
                            )}
                          </div>
                          <div className="store-related-info">
                            <div className="store-related-name">{product.name}</div>
                            <div className="store-related-price">{formatMoney(product.price, currency)}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {cartEnabled ? (
                  <div className="store-cta-row">
                    <button
                      type="button"
                      className="store-button store-button-market"
                      onClick={() => {
                        addToCart(selectedProduct)
                        setSelectedProduct(null)
                      }}
                    >
                      Agregar al carrito
                    </button>
                    {checkoutEnabled ? (
                      <Link to="/tienda/carrito" className="store-button-secondary" onClick={() => setSelectedProduct(null)}>
                        Ir al carrito
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
