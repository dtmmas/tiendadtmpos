import React, { useEffect, useMemo, useState } from 'react'
import { useAuthStore } from '../store/auth'
import { api, getProducts, getCategories, getBrands, getSuppliers, createProduct, updateProduct, deleteProduct, getProductDetails, getProductCostHistory, getUnits, createBrand, createUnit, getDepartments, createDepartment, getWarehouses, getProductWarehouseStock, transferProductWarehouseStock, getShelves, importProductsFile, downloadProductsImportTemplate } from '../api'
import { useConfigStore } from '../store/config'
import { formatMoney } from '../utils/currency'
import { resolveUploadedAssetUrl } from '../utils/assets'
import { resolveUnitName, buildUnitNameMap } from '../utils/units'
import { getWarehouseHighlightStyle } from '../utils/warehouseHighlight'
import MobileBarcodeScannerButton from '../components/MobileBarcodeScannerButton'
import ProductImageManager from '../components/ProductImageManager'
import CatalogPdfModal from '../components/CatalogPdfModal'
import {
  ProductImageDraft,
  ProductImageRecord,
  buildProductImagesUploadPayload,
  createExistingProductImageDraft,
} from '../components/productImageManagerUtils'
import {
  filterCatalogProducts,
  generateProductCatalogPdf,
  normalizeCatalogTitleText,
  type CatalogPdfProduct,
  getCatalogProductPrimaryImageUrl,
} from '../utils/catalogPdf'
import {
  buildCatalogPdfProductQuery,
  getCatalogPdfParentCategories,
  getCatalogPdfSubcategories,
} from '../utils/catalogPdfFilters'

interface Category {
  id: number
  name: string
  parentId?: number | null
  departmentId?: number | null
}

interface Brand { id: number; name: string }
interface Supplier { id: number; name: string }
interface Department { id: number; name: string }

interface Product {
  id: number
  name: string
  sku: string
  productCode?: string
  price: number
  price2?: number
  price3?: number
  cost?: number
  avgCost?: number
  lastCost?: number
  stock: number
  otherStock?: number
  initialStock?: number
  minStock?: number
  unit?: string
  description?: string
  categoryId?: number
  brandId?: number
  supplierId?: number
  imageUrl?: string
  images?: ProductImageRecord[]
  productType?: string
  altName?: string
  genericName?: string
  shelfLocation?: string
  trackingProfile?: string
  trackingMeta?: Partial<TrackingMeta>
}

interface Batch {
  batchNo: string
  expiryDate: string
  quantity: string
}

interface TrackingMeta {
  storageNotes: string
  presentation: string
  activeIngredient: string
  concentration: string
  dosageForm: string
  sanitaryRegistry: string
  packageType: string
  originInfo: string
  regulatoryNotes: string
  serializedDeviceProfile: SerializedDeviceProfile | ''
}

interface WarehouseStockRow {
  warehouseId: number
  warehouseName: string
  quantity: number
}

interface CatalogSerialRow {
  value: string
  warehouseName: string
}

interface ProductCostHistoryRow {
  purchaseId: number
  purchaseNumber: string
  docNo?: string | null
  createdAt: string
  warehouseId?: number | null
  warehouseName?: string | null
  quantity: number
  unitCost: number
  totalCost: number
}

type SerializedDeviceProfile = 'PHONE_IMEI' | 'DEVICE_SERIAL'

interface SerializedVariantMeta {
  deviceCategory: SerializedDeviceProfile
  modelCode: string
  notes: string
}

interface SerializedVariantUnitMeta {
  supplierName: string
  purchaseReference: string
  notes: string
}

interface SerializedVariantUnitForm {
  imei: string
  serialNo: string
  warehouseId: string
  meta: SerializedVariantUnitMeta
}

interface SerializedVariantForm {
  name: string
  sku: string
  color: string
  ram: string
  storage: string
  carrier: string
  simType: string
  identifierMode: 'IMEI' | 'SERIAL'
  price: string
  cost: string
  sortOrder: string
  meta: SerializedVariantMeta
  units: SerializedVariantUnitForm[]
}

interface ProductFormState {
  id?: number
  name: string
  sku: string
  productCode: string
  price: string
  price2: string
  price3: string
  cost: string
  initialStock: string
  minStock: string
  unit: string
  description: string
  categoryId: string
  brandId: string
  supplierId: string
  imageFile?: File | null
  imagePreview?: string | null
  productImages: ProductImageDraft[]
  initialWarehouseId?: string
  initialShelfId?: string
  productType: string
  altName: string
  genericName: string
  shelfLocation: string
  trackingProfile: string
  trackingMeta: TrackingMeta
  batches: Batch[]
  imeis: string[]
  serials: string[]
  serializedDeviceProfile: SerializedDeviceProfile
  variants: SerializedVariantForm[]
}

const PRODUCT_TYPE_OPTIONS = [
  {
    value: 'GENERAL',
    label: 'General',
    description: 'Productos estándar sin características especiales',
  },
  {
    value: 'MEDICINAL',
    label: 'Con fecha de vencimiento y lotes',
    description: 'Productos con control por lotes y fecha de vencimiento',
  },
  {
    value: 'IMEI',
    label: 'IMEI',
    description: 'Dispositivos con códigos IMEI únicos',
  },
  {
    value: 'SERIAL',
    label: 'Serie',
    description: 'Productos con números de serie únicos',
  },
  {
    value: 'VARIANT_SERIALIZED',
    label: 'IMEI-SERIAL VARIANTE',
    description: 'Producto maestro con variantes por color, RAM, almacenamiento, compañía o SIM y unidades individuales con IMEI o serie.',
  },
] as const

const SERIALIZED_DEVICE_PROFILE_OPTIONS: Array<{
  value: SerializedDeviceProfile
  label: string
  description: string
}> = [
  {
    value: 'PHONE_IMEI',
    label: 'IMEI - Telefono / celular',
    description: 'Activa compañia y tipo de SIM para variantes de telefonos.',
  },
  {
    value: 'DEVICE_SERIAL',
    label: 'SERIE - Computadora / otro equipo',
    description: 'Activa numero de serie y oculta compañia y SIM para equipos no telefonicos.',
  },
]

function formatProductTypeLabel(productType?: string) {
  switch (String(productType || 'GENERAL').trim().toUpperCase()) {
    case 'MEDICINAL':
      return 'Con fecha de vencimiento y lotes'
    case 'IMEI':
      return 'IMEI'
    case 'SERIAL':
      return 'Serie'
    case 'VARIANT_SERIALIZED':
      return 'IMEI-SERIAL VARIANTE'
    default:
      return 'General'
  }
}

function createEmptyTrackingMeta(): TrackingMeta {
  return {
    storageNotes: '',
    presentation: '',
    activeIngredient: '',
    concentration: '',
    dosageForm: '',
    sanitaryRegistry: '',
    packageType: '',
    originInfo: '',
    regulatoryNotes: '',
    serializedDeviceProfile: '',
  }
}

function normalizeTrackingProfile(profile?: string) {
  switch (String(profile || '').trim().toUpperCase()) {
    case 'ALIMENTO':
    case 'MEDICAMENTO':
    case 'COSMETICO':
    case 'QUIMICO':
      return String(profile).trim().toUpperCase()
    default:
      return 'GENERAL'
  }
}

function formatTrackingProfileLabel(profile?: string) {
  switch (normalizeTrackingProfile(profile)) {
    case 'ALIMENTO':
      return 'Alimento'
    case 'MEDICAMENTO':
      return 'Medicamento'
    case 'COSMETICO':
      return 'Cosmetico'
    case 'QUIMICO':
      return 'Quimico'
    default:
      return 'General'
  }
}

function parseTrackingMeta(raw: any): TrackingMeta {
  const base = createEmptyTrackingMeta()
  if (!raw || typeof raw !== 'object') return base
  return {
    storageNotes: String(raw.storageNotes || ''),
    presentation: String(raw.presentation || ''),
    activeIngredient: String(raw.activeIngredient || ''),
    concentration: String(raw.concentration || ''),
    dosageForm: String(raw.dosageForm || ''),
    sanitaryRegistry: String(raw.sanitaryRegistry || ''),
    packageType: String(raw.packageType || ''),
    originInfo: String(raw.originInfo || ''),
    regulatoryNotes: String(raw.regulatoryNotes || ''),
    serializedDeviceProfile: normalizeSerializedDeviceProfile(raw.serializedDeviceProfile || raw.deviceCategory || ''),
  }
}

function createEmptySerializedVariantMeta(deviceCategory: SerializedDeviceProfile = 'PHONE_IMEI'): SerializedVariantMeta {
  return {
    deviceCategory,
    modelCode: '',
    notes: '',
  }
}

function createEmptySerializedVariantUnitMeta(): SerializedVariantUnitMeta {
  return {
    supplierName: '',
    purchaseReference: '',
    notes: '',
  }
}

function normalizeVariantIdentifierMode(value?: string): 'IMEI' | 'SERIAL' {
  return String(value || '').trim().toUpperCase() === 'SERIAL' ? 'SERIAL' : 'IMEI'
}

function normalizeSerializedDeviceProfile(value?: string): SerializedDeviceProfile {
  return String(value || '').trim().toUpperCase() === 'DEVICE_SERIAL' ? 'DEVICE_SERIAL' : 'PHONE_IMEI'
}

function getIdentifierModeForSerializedDeviceProfile(profile?: string): 'IMEI' | 'SERIAL' {
  return normalizeSerializedDeviceProfile(profile) === 'DEVICE_SERIAL' ? 'SERIAL' : 'IMEI'
}

function formatSerializedDeviceProfileLabel(profile?: string) {
  return normalizeSerializedDeviceProfile(profile) === 'DEVICE_SERIAL'
    ? 'Computadora / otro equipo'
    : 'Telefono / celular'
}

function createEmptySerializedVariantUnit(identifierMode: 'IMEI' | 'SERIAL' = 'IMEI', warehouseId = ''): SerializedVariantUnitForm {
  return {
    imei: identifierMode === 'IMEI' ? '' : '',
    serialNo: identifierMode === 'SERIAL' ? '' : '',
    warehouseId,
    meta: createEmptySerializedVariantUnitMeta(),
  }
}

function createEmptySerializedVariant(profile: SerializedDeviceProfile = 'PHONE_IMEI', warehouseId = ''): SerializedVariantForm {
  const identifierMode = getIdentifierModeForSerializedDeviceProfile(profile)
  return {
    name: '',
    sku: '',
    color: '',
    ram: '',
    storage: '',
    carrier: '',
    simType: '',
    identifierMode,
    price: '',
    cost: '',
    sortOrder: '',
    meta: createEmptySerializedVariantMeta(profile),
    units: [],
  }
}

function buildSerializedVariantLabel(variant: Partial<SerializedVariantForm> | any) {
  const explicitName = String(variant?.name || '').trim()
  if (explicitName) return explicitName

  const parts = [
    variant?.color,
    variant?.ram,
    variant?.storage,
    variant?.carrier,
    variant?.simType,
  ]
    .map(value => String(value || '').trim())
    .filter(Boolean)

  return parts.length > 0 ? parts.join(' / ') : 'Variante sin nombre'
}

function parseSerializedVariants(raw: any): SerializedVariantForm[] {
  if (!Array.isArray(raw)) return []
  return raw.map((variant: any, index: number) => {
    const identifierMode = normalizeVariantIdentifierMode(variant?.identifierMode)
    return {
      name: String(variant?.name || ''),
      sku: String(variant?.sku || ''),
      color: String(variant?.color || ''),
      ram: String(variant?.ram || ''),
      storage: String(variant?.storage || ''),
      carrier: String(variant?.carrier || ''),
      simType: String(variant?.simType || ''),
      identifierMode,
      price: variant?.price === undefined || variant?.price === null ? '' : String(variant.price),
      cost: variant?.cost === undefined || variant?.cost === null ? '' : String(variant.cost),
      sortOrder: variant?.sortOrder === undefined || variant?.sortOrder === null ? String(index) : String(variant.sortOrder),
      meta: {
        deviceCategory: normalizeSerializedDeviceProfile(variant?.meta?.deviceCategory || variant?.deviceCategory || (identifierMode === 'SERIAL' ? 'DEVICE_SERIAL' : 'PHONE_IMEI')),
        modelCode: String(variant?.meta?.modelCode || ''),
        notes: String(variant?.meta?.notes || ''),
      },
      units: [],
    }
  })
}

function inferSerializedDeviceProfileFromVariants(raw: any): SerializedDeviceProfile {
  if (!Array.isArray(raw) || raw.length === 0) return 'PHONE_IMEI'
  const firstVariant = raw[0]
  return normalizeSerializedDeviceProfile(
    firstVariant?.meta?.deviceCategory || firstVariant?.deviceCategory || (normalizeVariantIdentifierMode(firstVariant?.identifierMode) === 'SERIAL' ? 'DEVICE_SERIAL' : 'PHONE_IMEI')
  )
}

function inferSerializedDeviceProfile(details: any): SerializedDeviceProfile {
  const storedProfile = normalizeSerializedDeviceProfile(details?.trackingMeta?.serializedDeviceProfile || details?.tracking_meta?.serializedDeviceProfile)
  if (Array.isArray(details?.variants) && details.variants.length > 0) {
    return inferSerializedDeviceProfileFromVariants(details.variants)
  }
  return storedProfile
}

function mapProductImagesForForm(product: Partial<Product> & { images?: ProductImageRecord[] }) {
  const imageList = Array.isArray(product?.images) && product.images.length > 0
    ? product.images
    : (product?.imageUrl ? [{ imageUrl: product.imageUrl }] : [])

  return imageList
    .map(image => createExistingProductImageDraft(image))
    .filter(Boolean) as ProductImageDraft[]
}

type ImageViewerState = {
  name: string | null
  images: string[]
  activeIndex: number
  description: string | null
  price: number | null
}

function buildViewerImages(source: { imageUrl?: string | null; images?: Array<{ imageUrl?: string | null }> }, preferredUrl?: string | null) {
  const urls = [
    ...(preferredUrl ? [preferredUrl] : []),
    ...(Array.isArray(source?.images) ? source.images.map(image => image?.imageUrl || null) : []),
    source?.imageUrl || null,
  ]
    .map(value => {
      const trimmed = String(value || '').trim()
      if (!trimmed) return ''
      if (trimmed.startsWith('/uploads/') || trimmed.startsWith('uploads/') || trimmed.includes('/uploads/')) {
        return resolveUploadedAssetUrl(trimmed)
      }
      return trimmed
    })
    .filter(Boolean)

  const uniqueUrls = [...new Set(urls)]
  return uniqueUrls.length > 0 ? uniqueUrls : ['https://via.placeholder.com/800x600?text=IMG']
}

export default function Products() {
  const user = useAuthStore(s => s.user)
  const hasPermission = useAuthStore(s => s.hasPermission)
  const { config, fetchConfig } = useConfigStore()
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [units, setUnits] = useState<{ id: number; code: string; name: string }[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const currency = config?.currency || 'USD'
  
  // Stock por almacén
  const [warehouses, setWarehouses] = useState<Array<{ id: number; name: string }>>([])
  const [shelves, setShelves] = useState<Array<{ id: number; name: string; warehouseId?: number | null; warehouseIds?: number[] }>>([])
  const [warehouseStock, setWarehouseStock] = useState<WarehouseStockRow[]>([])

  const [showWarehouseStock, setShowWarehouseStock] = useState(true)
  const warehouseTotal = useMemo(() => warehouseStock.reduce((sum, x) => sum + Number(x.quantity || 0), 0), [warehouseStock])

  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [showCreate, setShowCreate] = useState(false)
  const [showProductTypeSelector, setShowProductTypeSelector] = useState(false)
  const [showSerializedVariantProfileSelector, setShowSerializedVariantProfileSelector] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<any | null>(null)
  const [details, setDetails] = useState<any | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [costHistoryProduct, setCostHistoryProduct] = useState<{ id: number; name: string; productCode?: string; cost?: number; avgCost?: number; lastCost?: number } | null>(null)
  const [costHistoryRows, setCostHistoryRows] = useState<ProductCostHistoryRow[]>([])
  const [costHistoryLoading, setCostHistoryLoading] = useState(false)
  const [costHistoryError, setCostHistoryError] = useState<string | null>(null)
  
  // Toggles para ver/ocultar secciones del panel de detalles
  const [showBatches, setShowBatches] = useState(false)
  const [showImeis, setShowImeis] = useState(false)
  const [showSerials, setShowSerials] = useState(false)
  const [showVariants, setShowVariants] = useState(false)
  
  // Visualizador de imagen (lightbox)
  const [imageViewer, setImageViewer] = useState<ImageViewerState | null>(null)
  const [showCatalogPdfModal, setShowCatalogPdfModal] = useState(false)
  const [catalogPdfProducts, setCatalogPdfProducts] = useState<CatalogPdfProduct[]>([])
  const [catalogPdfLoading, setCatalogPdfLoading] = useState(false)
  const [catalogPdfGenerating, setCatalogPdfGenerating] = useState(false)
  const [catalogPdfProgress, setCatalogPdfProgress] = useState(0)
  const [catalogPdfProgressLabel, setCatalogPdfProgressLabel] = useState('Preparando catálogo...')
  const [catalogPdfError, setCatalogPdfError] = useState<string | null>(null)
  const [catalogPdfSelectedIds, setCatalogPdfSelectedIds] = useState<number[]>([])
  const [catalogPdfTitle, setCatalogPdfTitle] = useState('Catalogo de productos')
  const [catalogPdfSubtitle, setCatalogPdfSubtitle] = useState('Descubre una selección visual con imagen, descripción y precio actualizado para impulsar la conversión.')
  const [catalogPdfOnlyWithImage, setCatalogPdfOnlyWithImage] = useState(true)
  const [catalogPdfDepartmentId, setCatalogPdfDepartmentId] = useState<number | null>(null)
  const [catalogPdfCategoryId, setCatalogPdfCategoryId] = useState<number | null>(null)
  const [catalogPdfSubcategoryId, setCatalogPdfSubcategoryId] = useState<number | null>(null)
  const [catalogPdfBrandId, setCatalogPdfBrandId] = useState<number | null>(null)
  const [catalogStockProduct, setCatalogStockProduct] = useState<Product | null>(null)
  const [catalogWarehouseStock, setCatalogWarehouseStock] = useState<WarehouseStockRow[]>([])
  const [catalogVariantSummaries, setCatalogVariantSummaries] = useState<any[]>([])
  const [catalogStockLoading, setCatalogStockLoading] = useState(false)
  const [catalogStockError, setCatalogStockError] = useState<string | null>(null)
  const [catalogSerials, setCatalogSerials] = useState<CatalogSerialRow[]>([])
  const [showCatalogSerials, setShowCatalogSerials] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null)
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<number | null>(null)
  const [selectedBrandId, setSelectedBrandId] = useState<number | null>(null)
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null)
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<number | null>(null)
  const [selectedStockFilter, setSelectedStockFilter] = useState<'all' | 'with_stock' | 'without_stock'>('with_stock')
  const [currentPage, setCurrentPage] = useState(1)
  const productsPerPage = 60
  const [totalProducts, setTotalProducts] = useState(0)
  const [catalogTotal, setCatalogTotal] = useState(0)
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [isCompactCatalogFilters, setIsCompactCatalogFilters] = useState(false)
  const [isCatalogFiltersOpen, setIsCatalogFiltersOpen] = useState(false)

  // Quick add: estados para agregar catálogo desde el modal de producto
  const [quickAddModal, setQuickAddModal] = useState<'none' | 'category' | 'subcategory' | 'brand' | 'supplier' | 'unit' | 'department'>('none')
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newBrandName, setNewBrandName] = useState('')
  const [newSupplierName, setNewSupplierName] = useState('')
  const [newUnitCode, setNewUnitCode] = useState('')
  const [newUnitName, setNewUnitName] = useState('')
  const [newDepartmentName, setNewDepartmentName] = useState('')
  const [savingQuickAdd, setSavingQuickAdd] = useState(false)
  const [formParentId, setFormParentId] = useState<number | null>(null)
  const [newCategoryParentId, setNewCategoryParentId] = useState<number | null>(null)
  const [formDepartmentId, setFormDepartmentId] = useState<number | null>(null)
  const enabledProductTypes = useMemo(() => {
    const raw = Array.isArray(config?.enabledProductTypes) ? config.enabledProductTypes : ['GENERAL', 'MEDICINAL', 'IMEI', 'SERIAL', 'VARIANT_SERIALIZED']
    const normalized = raw.map(value => String(value || '').trim().toUpperCase()).filter(Boolean)
    return normalized.length > 0 ? [...new Set(normalized)] : ['GENERAL']
  }, [config?.enabledProductTypes])
  const availableProductTypeOptions = useMemo(
    () => PRODUCT_TYPE_OPTIONS.filter(option => enabledProductTypes.includes(option.value)),
    [enabledProductTypes]
  )

  const [editTarget, setEditTarget] = useState<Product | null>(null)
  const [variantEditorTarget, setVariantEditorTarget] = useState<Product | null>(null)
  const [showVariantEditor, setShowVariantEditor] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null)
  const [imageUploadProgress, setImageUploadProgress] = useState<number | null>(null)
  const [formState, setFormState] = useState<ProductFormState>({
    name: '', sku: '', productCode: '', price: '', price2: '', price3: '', cost: '', initialStock: '', minStock: '', unit: '', description: '', categoryId: '', brandId: '', supplierId: '', imageFile: null, imagePreview: null, productImages: [],
    initialWarehouseId: '', initialShelfId: '',
    productType: 'GENERAL', altName: '', genericName: '', shelfLocation: '', trackingProfile: 'GENERAL', trackingMeta: createEmptyTrackingMeta(), batches: [], imeis: [], serials: [], serializedDeviceProfile: 'PHONE_IMEI', variants: []
  })
  const isSerializedDeviceProfileLocked = Boolean(editTarget?.id) && String(formState.productType || '').toUpperCase() === 'VARIANT_SERIALIZED'
  const serializedVariantIdentifierLabel = formState.serializedDeviceProfile === 'PHONE_IMEI' ? 'IMEI' : 'SERIE'

  const [imeiInput, setImeiInput] = useState('')
  const [serialInput, setSerialInput] = useState('')
  const defaultVariantWarehouseId = useMemo(() => {
    return String(formState.initialWarehouseId || warehouses[0]?.id || 1)
  }, [formState.initialWarehouseId, warehouses])
  
  // Helper: comprobar si un estante pertenece al almacén seleccionado
  function shelfMatchesWarehouse(shelf: { warehouseId?: number | null; warehouseIds?: number[] }, warehouseId: number) {
    if (!warehouseId) return false
    if (Array.isArray(shelf.warehouseIds) && shelf.warehouseIds.length > 0) {
      return shelf.warehouseIds.some(id => Number(id || 0) === warehouseId)
    }
    return Number(shelf.warehouseId || 0) === warehouseId
  }
  
  // Ajusta la cantidad de campos IMEI (ahora siempre 0 al crear)
  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  useEffect(() => {
    const isImei = String(formState.productType || 'GENERAL').toUpperCase() === 'IMEI'
    if (!isImei) return
    // Al crear, no hay stock inicial, así que 0 imeis.
    // Si se quisiera permitir agregar IMEIs sin stock (raro), se podría dejar manual.
    // Por ahora, limpiamos.
    if (!editTarget) {
        if (formState.imeis.length > 0) onFormChange('imeis', [])
    }
  }, [formState.productType])

  // Ajusta la cantidad de campos SERIAL (ahora siempre 0 al crear)
  useEffect(() => {
    const isSerial = String(formState.productType || 'GENERAL').toUpperCase() === 'SERIAL'
    if (!isSerial) return
    if (!editTarget) {
        if (formState.serials.length > 0) onFormChange('serials', [])
    }
  }, [formState.productType])

  // Cargar almacenes al abrir el modal de creación y preseleccionar el primero
  useEffect(() => {
    if (showCreate) {
      (async () => {
        try {
          const whList = await getWarehouses()
          setWarehouses(Array.isArray(whList) ? whList : [])
          if (!formState.initialWarehouseId && Array.isArray(whList) && whList.length > 0) {
            const preferred = whList.find((w: any) => Number(w.id) === 1)
              || whList.find((w: any) => /TIENDA|PRINCIPAL/i.test(String(w.name || '')))
              || whList[0]
            onFormChange('initialWarehouseId', String(preferred.id))
          }
          const shList = await getShelves()
          setShelves(Array.isArray(shList) ? shList : [])
        } catch (e) {
          console.warn('No se pudieron cargar almacenes para creación:', e)
        }
      })()
    }
  }, [showCreate])

  function addBatch() { 
    onFormChange('batches', [...formState.batches, { batchNo: '', expiryDate: '', quantity: '' }]) 
  }
  
  function updateBatch(idx: number, key: keyof Batch, val: string) {
    const next = [...formState.batches]; 
    next[idx] = { ...next[idx], [key]: val }; 
    onFormChange('batches', next)
  }
  
  function removeBatch(idx: number) { 
    onFormChange('batches', formState.batches.filter((_, i) => i !== idx)) 
  }

  function handleAddImei() { 
    if (imeiInput.trim()) { 
      onFormChange('imeis', [...formState.imeis, imeiInput.trim()]); 
      setImeiInput('') 
    } 
  }
  
  function removeImei(idx: number) { 
    onFormChange('imeis', formState.imeis.filter((_, i) => i !== idx)) 
  }

  function handleAddSerial() { 
    if (serialInput.trim()) { 
      onFormChange('serials', [...formState.serials, serialInput.trim()]); 
      setSerialInput('') 
    } 
  }
  
  function removeSerial(idx: number) { 
    onFormChange('serials', formState.serials.filter((_, i) => i !== idx)) 
  }

  // Refresca listas de catálogo después de crear algo rápido
  async function refreshMetaLists() {
    try {
      const [cats, brs, sups, uns, deps] = await Promise.all([
        getCategories(), getBrands(), getSuppliers(), getUnits(), getDepartments()
      ])
      setCategories(cats)
      setBrands(brs)
      setSuppliers(sups)
      setUnits(uns)
      setDepartments(deps)
      return { cats, brs, sups, uns, deps }
    } catch (err) {
      console.warn('No se pudieron refrescar listas de catálogo', err)
      return { cats: categories, brs: brands, sups: suppliers, uns: units, deps: departments }
    }
  }

  async function createCategoryQuick() {
    const name = newCategoryName.trim()
    if (!name) return
    if (!formDepartmentId) {
      alert('Selecciona un departamento antes de crear la categoría')
      return
    }
    try {
      setSavingQuickAdd(true)
      const resp = await api.post('/categories', { name, parentId: null, departmentId: formDepartmentId })
      const created = resp?.data || null
      const lists = await refreshMetaLists()
      const match = created || (lists.cats.find(c => c.name.toLowerCase() === name.toLowerCase()) || null)
      if (match) {
        // Si es categoría general recién creada, seleccionarla como padre y limpiar subcategoría
        if (!match.parentId) {
          setFormParentId(match.id)
          onFormChange('categoryId', '')
        } else {
          // Si viniera con padre (caso futuro), mantener padre y preseleccionar subcategoría
          setFormParentId(match.parentId ?? formParentId ?? null)
          onFormChange('categoryId', String(match.id))
        }
      }
      setQuickAddModal('none')
      setNewCategoryName('')
      setNewCategoryParentId(null)
    } catch (err: any) {
      alert(err?.response?.data?.error || 'No se pudo crear la categoría')
    } finally {
      setSavingQuickAdd(false)
    }
  }

  async function createSubcategoryQuick() {
    const name = newCategoryName.trim()
    if (!name) return
    if (!formParentId) {
      alert('Selecciona una categoría general primero')
      return
    }
    try {
      setSavingQuickAdd(true)
      const parentDeptId = categories.find(c => c.id === (formParentId as number))?.departmentId ?? null
      const resp = await api.post('/categories', { name, parentId: formParentId, departmentId: parentDeptId })
      const created = resp?.data || null
      const lists = await refreshMetaLists()
      const match = created || (lists.cats.find(c => c.name.toLowerCase() === name.toLowerCase() && c.parentId === formParentId) || null)
      if (match) {
        setFormParentId(formParentId)
        onFormChange('categoryId', String(match.id))
      }
      setQuickAddModal('none')
      setNewCategoryName('')
    } catch (err: any) {
      alert(err?.response?.data?.error || 'No se pudo crear la subcategoría')
    } finally {
      setSavingQuickAdd(false)
    }
  }

  async function createBrandQuick() {
    const name = newBrandName.trim()
    if (!name) return
    try {
      setSavingQuickAdd(true)
      const created = await createBrand({ name })
      const lists = await refreshMetaLists()
      const match = created || (lists.brs.find(b => b.name.toLowerCase() === name.toLowerCase()) || null)
      if (match) onFormChange('brandId', String(match.id))
      setQuickAddModal('none')
      setNewBrandName('')
    } catch (err: any) {
      alert(err?.response?.data?.error || 'No se pudo crear la marca')
    } finally {
      setSavingQuickAdd(false)
    }
  }

  async function createSupplierQuick() {
    const name = newSupplierName.trim()
    if (!name) return
    try {
      setSavingQuickAdd(true)
      const resp = await api.post('/suppliers', { name })
      const created = resp?.data || null
      const lists = await refreshMetaLists()
      const match = created || (lists.sups.find(s => s.name.toLowerCase() === name.toLowerCase()) || null)
      if (match) onFormChange('supplierId', String(match.id))
      setQuickAddModal('none')
      setNewSupplierName('')
    } catch (err: any) {
      alert(err?.response?.data?.error || 'No se pudo crear el proveedor')
    } finally {
      setSavingQuickAdd(false)
    }
  }

  async function createUnitQuick() {
    const code = newUnitCode.trim()
    const name = newUnitName.trim()
    if (!code || !name) return
    try {
      setSavingQuickAdd(true)
      const created = await createUnit({ code, name })
      const lists = await refreshMetaLists()
      const match = created || (lists.uns.find(u => u.code.toLowerCase() === code.toLowerCase()) || null)
      if (match) onFormChange('unit', match.code)
      setQuickAddModal('none')
      setNewUnitCode('')
      setNewUnitName('')
    } catch (err: any) {
      alert(err?.response?.data?.error || 'No se pudo crear la unidad')
    } finally {
      setSavingQuickAdd(false)
    }
  }

  async function createDepartmentQuick() {
    const name = newDepartmentName.trim()
    if (!name) return
    try {
      setSavingQuickAdd(true)
      const created = await createDepartment({ name })
      const lists = await refreshMetaLists()
      const match = created || (lists.deps.find(d => d.name.toLowerCase() === name.toLowerCase()) || null)
      if (match) setFormDepartmentId(match.id)
      setQuickAddModal('none')
      setNewDepartmentName('')
    } catch (err: any) {
      alert(err?.response?.data?.error || 'No se pudo crear el departamento')
    } finally {
      setSavingQuickAdd(false)
    }
  }

  // Cerrar lightbox con ESC
  function openImageViewer(source: { name?: string | null; imageUrl?: string | null; images?: Array<{ imageUrl?: string | null }>; description?: string | null; price?: number | string | null }, preferredUrl?: string | null) {
    const images = buildViewerImages(source, preferredUrl)
    const preferredResolved = preferredUrl ? buildViewerImages({ imageUrl: preferredUrl }, preferredUrl)[0] : null
    const activeIndex = preferredResolved ? Math.max(0, images.indexOf(preferredResolved)) : 0
    const rawPrice = Number(source?.price)
    setImageViewer({
      name: source?.name || null,
      images,
      activeIndex: activeIndex >= 0 ? activeIndex : 0,
      description: String(source?.description || '').trim() || null,
      price: Number.isFinite(rawPrice) ? rawPrice : null,
    })
  }

  function moveImageViewer(step: number) {
    setImageViewer(prev => {
      if (!prev || prev.images.length === 0) return prev
      const nextIndex = (prev.activeIndex + step + prev.images.length) % prev.images.length
      return { ...prev, activeIndex: nextIndex }
    })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setImageViewer(null)
      if (e.key === 'ArrowLeft') moveImageViewer(-1)
      if (e.key === 'ArrowRight') moveImageViewer(1)
    }
    if (imageViewer) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [imageViewer])
  
  useEffect(() => {
    (async () => {
      try {
        const results = await Promise.allSettled([
          getCategories(),
          getBrands(),
          getSuppliers(),
          getDepartments(),
        ])
        const [catsRes, brsRes, supsRes, depsRes] = results
        if (catsRes.status === 'fulfilled') setCategories(catsRes.value)
        else {
          const reason: any = (catsRes as any)?.reason
          console.error('AxiosError: No se pudieron cargar categorías:', reason?.message, reason?.response?.status, reason?.response?.data)
        }
        if (brsRes.status === 'fulfilled') setBrands(brsRes.value)
        else {
          const reason: any = (brsRes as any)?.reason
          console.error('AxiosError: No se pudieron cargar marcas:', reason?.message, reason?.response?.status, reason?.response?.data)
        }
        if (supsRes.status === 'fulfilled') setSuppliers(supsRes.value)
        else {
          const reason: any = (supsRes as any)?.reason
          console.error('AxiosError: No se pudieron cargar proveedores:', reason?.message, reason?.response?.status, reason?.response?.data)
        }
        if (depsRes.status === 'fulfilled') setDepartments(depsRes.value)
        else {
          const reason: any = (depsRes as any)?.reason
          console.error('AxiosError: No se pudieron cargar departamentos:', reason?.message, reason?.response?.status, reason?.response?.data)
        }
        // Si alguna falló, aún así mostramos lo disponible
        const anyRejected = results.some(r => r.status === 'rejected')
        if (anyRejected) setError('Algunas listas no se pudieron cargar, mostrando lo disponible.')
      } catch (err: any) {
        setError(err?.message || 'Error al cargar listas iniciales')
      }
    })()
  }, [])

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQuery(query.trim())
    }, 250)
    return () => window.clearTimeout(handle)
  }, [query])

  useEffect(() => {
    (async () => {
      try {
        const data = await getUnits()
        setUnits(data)
      } catch (err) {
        console.warn('No se pudieron cargar unidades', err)
      }
    })()
  }, [])

  const categoryMap = useMemo(() => {
    const map: Record<number, string> = {}
    categories.forEach(c => { map[c.id] = c.name })
    return map
  }, [categories])

  // Mapa auxiliar para acceder a la categoría (incluye parentId) por id
  const categoryById = useMemo(() => {
    const map: Record<number, Category> = {}
    categories.forEach(c => { map[c.id] = c })
    return map
  }, [categories])

  const brandMap = useMemo(() => {
    const map: Record<number, string> = {}
    brands.forEach(b => { map[b.id] = b.name })
    return map
  }, [brands])

  const supplierMap = useMemo(() => {
    const map: Record<number, string> = {}
    suppliers.forEach(s => { map[s.id] = s.name })
    return map
  }, [suppliers])
  const canViewSensitiveProductData = useMemo(() => {
    if (!user) return false
    return String(user.role || '').toUpperCase() === 'ADMIN' || hasPermission('products:sensitive:read')
  }, [user, hasPermission])
  const canManageProducts = useMemo(() => {
    if (!user) return false
    return String(user.role || '').toUpperCase() === 'ADMIN' || hasPermission('products:write')
  }, [user, hasPermission])
  const productsPageTitle = canManageProducts ? 'Productos' : 'Catalogo de productos'
  const catalogPdfVisibleProducts = useMemo(
    () => filterCatalogProducts(catalogPdfProducts, { onlyWithImage: catalogPdfOnlyWithImage }),
    [catalogPdfProducts, catalogPdfOnlyWithImage]
  )

  const departmentMap = useMemo(() => {
    const map: Record<number, string> = {}
    departments.forEach(d => { map[d.id] = d.name })
    return map
  }, [departments])

  const unitNameByCode = useMemo(() => buildUnitNameMap(units), [units])

  // Preferencias de estante por almacén (localStorage)
  const getPreferredShelfMap = (): Record<string, string> => {
    try {
      const raw = localStorage.getItem('preferredShelvesByWarehouse') || '{}'
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') return parsed
    } catch {}
    return {}
  }
  const getPreferredShelfId = (warehouseId: number): string | null => {
    const map = getPreferredShelfMap()
    return map[String(warehouseId)] || null
  }
  const setPreferredShelfId = (warehouseId: number, shelfId: number | string) => {
    const map = getPreferredShelfMap()
    map[String(warehouseId)] = String(shelfId)
    try { localStorage.setItem('preferredShelvesByWarehouse', JSON.stringify(map)) } catch {}
  }

  const detailsCatName = useMemo(() => {
    const id = details?.categoryId
    if (!id) return null
    const cat = categoryById[id]
    if (!cat) return null
    return cat.parentId ? (categoryMap[cat.parentId] || null) : (categoryMap[id] || null)
  }, [details, categoryById, categoryMap])

  const detailsSubName = useMemo(() => {
    const id = details?.categoryId
    if (!id) return null
    const cat = categoryById[id]
    if (cat && cat.parentId) return categoryMap[id] || null
    return null
  }, [details, categoryById, categoryMap])

  const detailsDeptName = useMemo(() => {
    const id = details?.categoryId
    if (!id) return null
    const cat = categoryById[id]
    const deptId = (cat?.departmentId ?? (cat?.parentId ? (categoryById[cat.parentId]?.departmentId ?? null) : null))
    return deptId ? (departmentMap[deptId] || null) : null
  }, [details, categoryById, departmentMap])

  const currentWarehouseId = user?.warehouseId ? Number(user.warehouseId) : null

  const catalogCurrentWarehouseStock = useMemo(() => {
    if (!currentWarehouseId) return null
    return catalogWarehouseStock.find(item => Number(item.warehouseId) === currentWarehouseId) || null
  }, [catalogWarehouseStock, currentWarehouseId])

  const catalogOtherWarehouseStock = useMemo(() => {
    if (!currentWarehouseId) return catalogWarehouseStock
    return catalogWarehouseStock.filter(item => Number(item.warehouseId) !== currentWarehouseId)
  }, [catalogWarehouseStock, currentWarehouseId])

  const catalogOtherWarehouseTotal = useMemo(
    () => catalogOtherWarehouseStock.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    [catalogOtherWarehouseStock]
  )

  const canShowCatalogSerials = useMemo(() => {
    return String(catalogStockProduct?.productType || '').toUpperCase() === 'SERIAL'
  }, [catalogStockProduct])

  const canShowCatalogVariantSummary = useMemo(() => {
    return String(catalogStockProduct?.productType || '').toUpperCase() === 'VARIANT_SERIALIZED'
  }, [catalogStockProduct])

  const detailImeis = useMemo(() => {
    if (Array.isArray(details?.imeiDetails) && details.imeiDetails.length > 0) {
      return details.imeiDetails
        .filter((item: any) => item && item.imei)
        .map((item: any) => ({
          value: String(item.imei || ''),
          warehouseName: String(item.warehouseName || 'Sin almacen'),
        }))
    }
    if (Array.isArray(details?.imeis) && details.imeis.length > 0) {
      return details.imeis
        .filter((item: any) => item)
        .map((item: any) => ({
          value: String(item || ''),
          warehouseName: 'Almacen no especificado',
        }))
    }
    return []
  }, [details])

  const detailSerials = useMemo(() => {
    if (Array.isArray(details?.serialDetails) && details.serialDetails.length > 0) {
      return details.serialDetails
        .filter((item: any) => item && item.serial)
        .map((item: any) => ({
          value: String(item.serial || ''),
          warehouseName: String(item.warehouseName || 'Sin almacen'),
        }))
    }
    if (Array.isArray(details?.serials) && details.serials.length > 0) {
      return details.serials
        .filter((item: any) => item)
        .map((item: any) => ({
          value: String(item || ''),
          warehouseName: 'Almacen no especificado',
        }))
    }
    return []
  }, [details])

  const detailVariants = useMemo(() => {
    return Array.isArray(details?.variants) ? details.variants : []
  }, [details])

  const parentCategories = useMemo(() => categories.filter(c => !c.parentId && (formDepartmentId ? c.departmentId === formDepartmentId : true)), [categories, formDepartmentId])
  const subcategoriesForParent = useMemo(() => categories.filter(c => c.parentId === formParentId), [categories, formParentId])
  const catalogPdfParentCategories = useMemo(
    () => getCatalogPdfParentCategories(categories, catalogPdfDepartmentId),
    [categories, catalogPdfDepartmentId]
  )
  const catalogPdfSubcategories = useMemo(
    () => getCatalogPdfSubcategories(categories, catalogPdfCategoryId),
    [categories, catalogPdfCategoryId]
  )
  const hasActiveFilters = useMemo(() => {
    return (selectedSubcategoryId !== null) || (selectedCategoryId !== null) || (selectedBrandId !== null) || (selectedSupplierId !== null) || (selectedDepartmentId !== null) || (selectedStockFilter !== 'with_stock') || (query.trim() !== '')
  }, [selectedSubcategoryId, selectedCategoryId, selectedBrandId, selectedSupplierId, selectedDepartmentId, selectedStockFilter, query])

  const activeCatalogFiltersCount = useMemo(() => {
    return [
      selectedDepartmentId !== null,
      selectedCategoryId !== null,
      selectedSubcategoryId !== null,
      selectedBrandId !== null,
      selectedSupplierId !== null,
      selectedStockFilter !== 'with_stock',
    ].filter(Boolean).length
  }, [selectedDepartmentId, selectedCategoryId, selectedSubcategoryId, selectedBrandId, selectedSupplierId, selectedStockFilter])
  
  function clearFilters() {
    setSelectedCategoryId(null)
    setSelectedSubcategoryId(null)
    setSelectedBrandId(null)
    setSelectedSupplierId(null)
    setSelectedDepartmentId(null)
    setSelectedStockFilter('with_stock')
    setQuery('')
    setIsCatalogFiltersOpen(false)
  }

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1024px)')
    const syncCompactCatalog = (event?: MediaQueryListEvent) => {
      const compact = event ? event.matches : mediaQuery.matches
      setIsCompactCatalogFilters(compact)
      if (!compact) {
        setIsCatalogFiltersOpen(false)
      }
    }

    syncCompactCatalog()

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', syncCompactCatalog)
      return () => mediaQuery.removeEventListener('change', syncCompactCatalog)
    }

    mediaQuery.addListener(syncCompactCatalog)
    return () => mediaQuery.removeListener(syncCompactCatalog)
  }, [])

  useEffect(() => {
    if (!isCompactCatalogFilters) return
    if (query.trim() || activeCatalogFiltersCount > 0) {
      setIsCatalogFiltersOpen(false)
    }
  }, [isCompactCatalogFilters, query, activeCatalogFiltersCount, selectedDepartmentId, selectedCategoryId, selectedSubcategoryId, selectedBrandId, selectedSupplierId, selectedStockFilter])

  // Al cambiar el filtro de departamento, limpiar selección de categoría para evitar estados inconsistentes
  useEffect(() => {
    if (selectedDepartmentId !== null) {
      setSelectedCategoryId(null)
      setSelectedSubcategoryId(null)
    }
  }, [selectedDepartmentId])

  // Cuando cambia el departamento seleccionado en el formulario, limpiar selección de categoría y subcategoría
  useEffect(() => {
    setFormParentId(null)
    onFormChange('categoryId', '')
  }, [formDepartmentId])

  // Si se selecciona una categoría general, fijar automáticamente su departamento
  useEffect(() => {
    if (!formParentId) return
    const deptId = categories.find(c => c.id === formParentId)?.departmentId ?? null
    if (deptId !== formDepartmentId) setFormDepartmentId(deptId)
  }, [formParentId, categories])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(totalProducts / productsPerPage)), [totalProducts])
  const paginatedProducts = products

  useEffect(() => {
    setCurrentPage(1)
  }, [query, selectedDepartmentId, selectedCategoryId, selectedSubcategoryId, selectedBrandId, selectedSupplierId, selectedStockFilter])

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages)
  }, [currentPage, totalPages])

  useEffect(() => {
    let cancelled = false

    const loadProductsPage = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await getProducts({
          paged: true,
          page: currentPage,
          limit: productsPerPage,
          search: debouncedQuery || undefined,
          categoryId: selectedSubcategoryId === null ? selectedCategoryId : undefined,
          subcategoryId: selectedSubcategoryId,
          brandId: selectedBrandId,
          supplierId: selectedSupplierId,
          departmentId: selectedDepartmentId,
          stockFilter: selectedStockFilter,
        })

        if (cancelled) return

        const nextProducts = Array.isArray(response?.data) ? response.data : []
        setProducts(nextProducts)
        setTotalProducts(Number(response?.pagination?.total || 0))
        setCatalogTotal(Number(response?.pagination?.catalogTotal || 0))
      } catch (err: any) {
        if (cancelled) return
        console.error('AxiosError: No se pudieron cargar productos:', err?.message, err?.response?.status, err?.response?.data)
        setProducts([])
        setTotalProducts(0)
        setError(err?.response?.data?.error || err?.message || 'No se pudo cargar el catalogo de productos')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadProductsPage()

    return () => {
      cancelled = true
    }
  }, [currentPage, debouncedQuery, selectedDepartmentId, selectedCategoryId, selectedSubcategoryId, selectedBrandId, selectedSupplierId, selectedStockFilter])

  function startCreate() {
    if (!canManageProducts) {
      alert('Solo tienes acceso al catalogo de productos en modo visualizacion')
      return
    }
    if (availableProductTypeOptions.length <= 1) {
      startCreateWithType(availableProductTypeOptions[0]?.value || 'GENERAL')
      return
    }
    setShowProductTypeSelector(true)
    setShowSerializedVariantProfileSelector(false)
    setEditTarget(null)
  }

  function openCreateFormWithType(productType: string, serializedDeviceProfile: SerializedDeviceProfile = 'PHONE_IMEI') {
    setShowCreate(true)
    setImageUploadProgress(null)
    setFormParentId(null)
    setNewCategoryParentId(null)

    const defaultUnitForType = (pt: string) => {
      switch ((pt || 'GENERAL').toUpperCase()) {
        case 'MEDICINAL':
          return 'PZ'
        case 'IMEI':
        case 'SERIAL':
        case 'VARIANT_SERIALIZED':
        case 'GENERAL':
        default:
          return 'PZ'
      }
    }
    const def = defaultUnitForType(productType)
    const unitCode = units.some(u => u.code === def) ? def : ''

    setFormState({
      name: '', sku: '', productCode: '', price: '', price2: '', price3: '', cost: '', initialStock: '', minStock: '', unit: unitCode, description: '', categoryId: '', brandId: '', supplierId: '', imageFile: null, imagePreview: null, productImages: [],
      initialWarehouseId: '', initialShelfId: '',
      productType: productType, altName: '', genericName: '', shelfLocation: '', trackingProfile: 'GENERAL', trackingMeta: { ...createEmptyTrackingMeta(), serializedDeviceProfile: productType === 'VARIANT_SERIALIZED' ? serializedDeviceProfile : '' }, batches: [], imeis: [], serials: [],
      serializedDeviceProfile,
      variants: []
    })
  }

  function startCreateWithType(productType: string) {
    setShowProductTypeSelector(false)
    setEditTarget(null)
    if (String(productType || '').trim().toUpperCase() === 'VARIANT_SERIALIZED') {
      setShowSerializedVariantProfileSelector(true)
      return
    }
    setShowSerializedVariantProfileSelector(false)
    openCreateFormWithType(productType)
  }

  function startCreateSerializedVariantWithProfile(profile: SerializedDeviceProfile) {
    setShowSerializedVariantProfileSelector(false)
    openCreateFormWithType('VARIANT_SERIALIZED', profile)
  }

  async function startEdit(p: Product) {
    if (!canManageProducts) {
      alert('No tienes permisos para editar productos')
      return
    }
    try {
      setShowSerializedVariantProfileSelector(false)
      setShowVariantEditor(false)
      setVariantEditorTarget(null)
      setEditTarget(p)
      setShowCreate(true)
      setLoading(true)
      const details = await getProductDetails(p.id)

      const batchesFs = Array.isArray(details.batches) ? details.batches.map((b: any) => ({
        batchNo: String(b.batchNo || b.batch_no || ''),
        expiryDate: String(b.expiryDate || b.expiry_date || ''),
        quantity: String(b.quantity ?? ''),
      })) : []
      const imeisFs = Array.isArray(details.imeis) ? details.imeis.map((x: any) => String(x || '')) : []
      const serialsFs = Array.isArray(details.serials) ? details.serials.map((x: any) => String(x || '')) : []
      const serializedDeviceProfile = inferSerializedDeviceProfile(details)
      const productImages = mapProductImagesForForm(details)

      setFormState({
        id: details.id,
        name: details.name || '',
        sku: details.sku || '',
        productCode: details.productCode || '',
        price: String(details.price ?? ''),
        price2: String(details.price2 ?? ''),
        price3: String(details.price3 ?? ''),
        cost: String(details.cost ?? ''),
        initialStock: String(details.initialStock ?? ''),
        minStock: String(details.minStock ?? ''),
        unit: details.unit || '',
        description: details.description || '',
        categoryId: details.categoryId ? String(details.categoryId) : '',
        brandId: details.brandId ? String(details.brandId) : '',
        supplierId: details.supplierId ? String(details.supplierId) : '',
        imageFile: null,
        imagePreview: productImages[0]?.previewUrl || details.imageUrl || null,
        productImages,
        initialWarehouseId: '',
        initialShelfId: '',
        productType: (details.productType || 'GENERAL').toUpperCase(),
        altName: details.altName || '',
        genericName: details.genericName || '',
        shelfLocation: details.shelfLocation || '',
        trackingProfile: normalizeTrackingProfile(details.trackingProfile),
        trackingMeta: { ...parseTrackingMeta(details.trackingMeta), serializedDeviceProfile },
        batches: batchesFs,
        imeis: imeisFs,
        serials: serialsFs,
        serializedDeviceProfile,
        variants: parseSerializedVariants(details.variants),
      })
      {
        const catSel = details.categoryId ? categories.find(c => c.id === details.categoryId) : undefined
        setFormParentId(catSel?.parentId ?? null)
        setNewCategoryParentId(catSel?.parentId ?? null)
        setFormDepartmentId(catSel?.departmentId ?? null)
      }
    } catch (err: any) {
      setError(err?.message || 'Error cargando detalles del producto')
      setFormState({
        id: p.id,
        name: p.name,
        sku: p.sku,
        productCode: p.productCode || '',
        price: String(p.price ?? ''),
        price2: String(p.price2 ?? ''),
        price3: String(p.price3 ?? ''),
        cost: String(p.cost ?? ''),
        initialStock: String(p.initialStock ?? ''),
        minStock: String(p.minStock ?? ''),
        unit: p.unit || '',
        description: p.description || '',
        categoryId: p.categoryId ? String(p.categoryId) : '',
        brandId: p.brandId ? String(p.brandId) : '',
        supplierId: p.supplierId ? String(p.supplierId) : '',
        imageFile: null,
        imagePreview: p.imageUrl || null,
        productImages: mapProductImagesForForm(p),
        initialWarehouseId: '',
        initialShelfId: '',
        productType: (p.productType || 'GENERAL').toUpperCase(),
        altName: p.altName || '',
        genericName: p.genericName || '',
        shelfLocation: p.shelfLocation || '',
        trackingProfile: normalizeTrackingProfile(p.trackingProfile),
        trackingMeta: parseTrackingMeta(p.trackingMeta),
        batches: [], imeis: [], serials: [], serializedDeviceProfile: normalizeSerializedDeviceProfile(p.trackingMeta?.serializedDeviceProfile), variants: []
      })
    } finally {
      setLoading(false)
    }
  }

  async function openVariantEditor(product: Product) {
    if (!canManageProducts) {
      alert('No tienes permisos para gestionar variantes')
      return
    }
    try {
      setShowCreate(false)
      setEditTarget(null)
      setShowSerializedVariantProfileSelector(false)
      setVariantEditorTarget(product)
      setShowVariantEditor(true)
      setLoading(true)
      const details = await getProductDetails(product.id)
      const serializedDeviceProfile = inferSerializedDeviceProfile(details)
      const productImages = mapProductImagesForForm(details)
      setFormState({
        id: details.id,
        name: details.name || '',
        sku: details.sku || '',
        productCode: details.productCode || '',
        price: String(details.price ?? ''),
        price2: String(details.price2 ?? ''),
        price3: String(details.price3 ?? ''),
        cost: String(details.cost ?? ''),
        initialStock: String(details.initialStock ?? ''),
        minStock: String(details.minStock ?? ''),
        unit: details.unit || '',
        description: details.description || '',
        categoryId: details.categoryId ? String(details.categoryId) : '',
        brandId: details.brandId ? String(details.brandId) : '',
        supplierId: details.supplierId ? String(details.supplierId) : '',
        imageFile: null,
        imagePreview: productImages[0]?.previewUrl || details.imageUrl || null,
        productImages,
        initialWarehouseId: '',
        initialShelfId: '',
        productType: (details.productType || 'GENERAL').toUpperCase(),
        altName: details.altName || '',
        genericName: details.genericName || '',
        shelfLocation: details.shelfLocation || '',
        trackingProfile: normalizeTrackingProfile(details.trackingProfile),
        trackingMeta: { ...parseTrackingMeta(details.trackingMeta), serializedDeviceProfile },
        batches: [],
        imeis: [],
        serials: [],
        serializedDeviceProfile,
        variants: parseSerializedVariants(details.variants),
      })
    } catch (err: any) {
      setShowVariantEditor(false)
      setVariantEditorTarget(null)
      setError(err?.message || 'Error cargando variantes del producto')
    } finally {
      setLoading(false)
    }
  }

  function closeVariantEditor() {
    setShowVariantEditor(false)
    setVariantEditorTarget(null)
  }

  async function openDetails(productId: number) {
    setShowDetails(true); setDetailsLoading(true); setDetails(null); setDetailsError(null)
    // Reset toggles al abrir detalles (todas ocultas al inicio excepto info principal)
    setShowBatches(false); setShowImeis(false); setShowSerials(false); setShowVariants(false)
    try {
      const d = await getProductDetails(productId)
      setDetails(d)
      // Cargar almacenes y stock por almacén al abrir detalles
      try {
        const [whList, whStock] = await Promise.all([
          getWarehouses(),
          getProductWarehouseStock(productId)
        ])
        setWarehouses(Array.isArray(whList) ? whList : [])
        setWarehouseStock(Array.isArray(whStock) ? whStock : [])

      } catch (e) {
        console.warn('Carga de almacenes/stock por almacén falló:', e)
      }
    } catch (err: any) {
      setDetailsError(err?.response?.data?.message || err?.message || 'Error cargando detalles')
    } finally {
      setDetailsLoading(false)
    }
  }

  function formatCostHistoryDate(value?: string) {
    if (!value) return '—'
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return String(value)
    return parsed.toLocaleString('es-GT', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function closeCostHistory() {
    setCostHistoryProduct(null)
    setCostHistoryRows([])
    setCostHistoryError(null)
    setCostHistoryLoading(false)
  }

  async function openCostHistory(product: { id: number; name: string; productCode?: string; cost?: number; avgCost?: number; lastCost?: number }) {
    setCostHistoryProduct(product)
    setCostHistoryRows([])
    setCostHistoryError(null)
    setCostHistoryLoading(true)
    try {
      const response = await getProductCostHistory(product.id)
      setCostHistoryProduct(response.product || product)
      setCostHistoryRows(Array.isArray(response.history) ? response.history : [])
    } catch (err: any) {
      setCostHistoryError(err?.response?.data?.error || err?.message || 'No se pudo cargar el historial de costos')
    } finally {
      setCostHistoryLoading(false)
    }
  }


  
  async function refreshWarehouseStock() {
    try {
      if (!details?.id) return
      const whStock = await getProductWarehouseStock(details.id)
      setWarehouseStock(Array.isArray(whStock) ? whStock : [])
    } catch (e) {
      console.warn('Refresh warehouse stock failed:', e)
    }
  }

  async function runImport() {
    if (!canManageProducts) {
      alert('No tienes permisos para importar productos')
      return
    }
    if (!importFile) {
      alert('Selecciona un archivo .xlsx o .csv')
      return
    }
    try {
      setImporting(true)
      setImportResult(null)
      const fd = new FormData()
      fd.append('file', importFile)
      const resp = await importProductsFile(fd)
      setImportResult(resp)
      alert(`Importación completa. Creados: ${resp.createdCount} • Errores: ${resp.errorCount}`)
      setImportFile(null)
    } catch (err: any) {
      console.error('Import error:', err)
      alert(err?.response?.data?.error || err?.message || 'Error importando productos')
    } finally {
      setImporting(false)
    }
  }

  async function downloadImportTemplate() {
    if (!canManageProducts) {
      alert('No tienes permisos para importar productos')
      return
    }
    try {
      const blob = await downloadProductsImportTemplate()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'productos_import_template.xlsx'
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch (err: any) {
      console.error('Template download error:', err)
      alert(err?.response?.data?.error || err?.message || 'Error descargando formato')
    }
  }

  async function openCatalogStock(product: Product) {
    setCatalogStockProduct(product)
    setCatalogWarehouseStock([])
    setCatalogVariantSummaries([])
    setCatalogStockError(null)
    setCatalogSerials([])
    setShowCatalogSerials(false)
    setCatalogStockLoading(true)
    try {
      const [whStock, detailData] = await Promise.all([
        getProductWarehouseStock(product.id),
        getProductDetails(product.id)
      ])
      setCatalogWarehouseStock(Array.isArray(whStock) ? whStock : [])
      setCatalogVariantSummaries(Array.isArray(detailData?.variants) ? detailData.variants : [])
      const serialRows = Array.isArray(detailData?.serialDetails) && detailData.serialDetails.length > 0
        ? detailData.serialDetails
            .filter((item: any) => item && item.serial)
            .map((item: any) => ({
              value: String(item.serial || ''),
              warehouseName: String(item.warehouseName || 'Sin almacen'),
            }))
        : Array.isArray(detailData?.serials) && detailData.serials.length > 0
          ? detailData.serials
              .filter((item: any) => item)
              .map((item: any) => ({
                value: String(item || ''),
                warehouseName: 'Almacen no especificado',
              }))
          : []
      setCatalogSerials(serialRows)
    } catch (err: any) {
      setCatalogStockError(err?.response?.data?.message || err?.message || 'Error al cargar existencias por tienda')
    } finally {
      setCatalogStockLoading(false)
    }
  }
  
  function onFormChange<K extends keyof typeof formState>(key: K, value: (typeof formState)[K]) {
    setFormState(prev => ({ ...prev, [key]: value }))
  }

  function onProductImagesChange(nextImages: ProductImageDraft[]) {
    setFormState(prev => ({
      ...prev,
      productImages: nextImages,
      imageFile: nextImages[0]?.file || null,
      imagePreview: nextImages[0]?.previewUrl || nextImages[0]?.imageUrl || null,
    }))
  }

  function onTrackingMetaChange<K extends keyof TrackingMeta>(key: K, value: TrackingMeta[K]) {
    setFormState(prev => ({
      ...prev,
      trackingMeta: {
        ...prev.trackingMeta,
        [key]: value,
      }
    }))
  }

  function onVariantChange(variantIndex: number, key: keyof SerializedVariantForm, value: any) {
    setFormState(prev => {
      const nextVariants = [...prev.variants]
      const currentVariant = nextVariants[variantIndex]
      if (!currentVariant) return prev
      if (key === 'identifierMode') {
        const identifierMode = normalizeVariantIdentifierMode(value)
        const deviceCategory = identifierMode === 'SERIAL' ? 'DEVICE_SERIAL' : 'PHONE_IMEI'
        nextVariants[variantIndex] = {
          ...currentVariant,
          identifierMode,
          carrier: deviceCategory === 'PHONE_IMEI' ? currentVariant.carrier : '',
          simType: deviceCategory === 'PHONE_IMEI' ? currentVariant.simType : '',
          meta: {
            ...currentVariant.meta,
            deviceCategory,
          },
        }
      } else {
        nextVariants[variantIndex] = { ...currentVariant, [key]: value }
      }
      return { ...prev, variants: nextVariants }
    })
  }

  function onVariantMetaChange(variantIndex: number, key: keyof SerializedVariantMeta, value: string) {
    setFormState(prev => {
      const nextVariants = [...prev.variants]
      const currentVariant = nextVariants[variantIndex]
      if (!currentVariant) return prev
      nextVariants[variantIndex] = {
        ...currentVariant,
        meta: {
          ...currentVariant.meta,
          [key]: value,
        }
      }
      return { ...prev, variants: nextVariants }
    })
  }

  function onSerializedDeviceProfileChange(value: string) {
    const nextProfile = normalizeSerializedDeviceProfile(value)
    const nextIdentifierMode = getIdentifierModeForSerializedDeviceProfile(nextProfile)
    setFormState(prev => ({
      ...prev,
      serializedDeviceProfile: nextProfile,
      variants: prev.variants.map(variant => ({
        ...variant,
        identifierMode: nextIdentifierMode,
        carrier: nextProfile === 'PHONE_IMEI' ? variant.carrier : '',
        simType: nextProfile === 'PHONE_IMEI' ? variant.simType : '',
        meta: {
          ...variant.meta,
          deviceCategory: nextProfile,
        },
      })),
    }))
  }

  function addSerializedVariant() {
    setFormState(prev => ({
      ...prev,
      variants: [...prev.variants, createEmptySerializedVariant(prev.serializedDeviceProfile, defaultVariantWarehouseId)],
    }))
  }

  function removeSerializedVariant(variantIndex: number) {
    setFormState(prev => ({
      ...prev,
      variants: prev.variants.filter((_, index) => index !== variantIndex)
    }))
  }

  function buildSerializedVariantsPayload() {
    return formState.variants.map((variant, index) => {
      const deviceCategory = normalizeSerializedDeviceProfile(variant.meta?.deviceCategory || formState.serializedDeviceProfile)
      const identifierMode = getIdentifierModeForSerializedDeviceProfile(deviceCategory)
      return {
        name: String(variant.name || '').trim(),
        sku: String(variant.sku || '').trim().toUpperCase(),
        color: String(variant.color || '').trim(),
        ram: String(variant.ram || '').trim(),
        storage: String(variant.storage || '').trim(),
        carrier: deviceCategory === 'PHONE_IMEI' ? String(variant.carrier || '').trim() : '',
        simType: deviceCategory === 'PHONE_IMEI' ? String(variant.simType || '').trim() : '',
        identifierMode,
        price: variant.price === '' ? 0 : Number(variant.price || 0),
        cost: variant.cost === '' ? 0 : Number(variant.cost || 0),
        sortOrder: variant.sortOrder === '' ? index : Number(variant.sortOrder || index),
        meta: {
          deviceCategory,
          modelCode: String(variant.meta?.modelCode || '').trim(),
          notes: String(variant.meta?.notes || '').trim(),
        },
        units: [],
      }
    })
  }

  async function saveCreate() {
    try {
      setLoading(true)
      setImageUploadProgress(0)
      const productType = String(formState.productType || 'GENERAL').trim().toUpperCase()
      const serializedVariants = buildSerializedVariantsPayload()
      const { productImages, newFiles } = buildProductImagesUploadPayload(formState.productImages)
      // Validaciones básicas de campos requeridos
      const errors: string[] = []
      if (!String(formState.name || '').trim()) errors.push('El nombre es obligatorio.')
      if (formState.price === '' || Number.isNaN(Number(formState.price))) errors.push('El precio es obligatorio y debe ser numérico.')
      if (!String(formState.unit || '').trim()) errors.push('La unidad es obligatoria.')
      if (formState.cost !== '' && Number.isNaN(Number(formState.cost))) errors.push('El costo debe ser numérico.')
      if (productType === 'VARIANT_SERIALIZED') {
        serializedVariants.forEach((variant, variantIndex) => {
          if (variant.price !== undefined && Number.isNaN(Number(variant.price))) {
            errors.push(`La variante ${variantIndex + 1} tiene un precio inválido.`)
          }
          if (variant.cost !== undefined && Number.isNaN(Number(variant.cost))) {
            errors.push(`La variante ${variantIndex + 1} tiene un costo inválido.`)
          }
        })
      }
      
      if (errors.length > 0) {
        alert(errors.join('\n'))
        setLoading(false)
        return
      }
      // Validación: para productos MEDICINAL, el stock inicial debe coincidir con la suma de lotes
      /* const isMedicinal = String(formState.productType || 'GENERAL').toUpperCase() === 'MEDICINAL'
      if (isMedicinal) {
        // Logic removed: Stock details are now entered via Purchases/Adjustments
      } */
      // Validación: para productos IMEI, la cantidad de IMEIs debe coincidir con el stock inicial
      /* const isImei = String(formState.productType || 'GENERAL').toUpperCase() === 'IMEI'
      if (isImei) {
        // Logic removed: Stock details are now entered via Purchases/Adjustments
      } */
      // Validación: para productos SERIAL, la cantidad de series debe coincidir con el stock inicial
      /* const isSerial = String(formState.productType || 'GENERAL').toUpperCase() === 'SERIAL'
      if (isSerial) {
        // Logic removed: Stock details are now entered via Purchases/Adjustments
      } */
      const fd = new FormData()
      const appendIfPresent = (k: string, v: string) => { 
        if (v !== undefined && v !== null && !(typeof v === 'string' && v === '')) fd.append(k, String(v).trim().toUpperCase()) 
      }
      fd.append('name', String(formState.name || '').trim().toUpperCase())
      fd.append('sku', String(formState.sku || '').trim().toUpperCase())
      appendIfPresent('productCode', formState.productCode)
      fd.append('price', formState.price)
      // appendIfPresent('initialStock', formState.initialStock)
      appendIfPresent('categoryId', formState.categoryId)
      appendIfPresent('brandId', formState.brandId)
      appendIfPresent('supplierId', formState.supplierId)
      appendIfPresent('price2', formState.price2)
      appendIfPresent('price3', formState.price3)
      appendIfPresent('cost', formState.cost)
      appendIfPresent('minStock', formState.minStock)
      appendIfPresent('unit', formState.unit)
      appendIfPresent('description', formState.description)
  
      // Campos de tipo
      fd.append('productType', productType)
      appendIfPresent('altName', formState.altName)
      appendIfPresent('genericName', formState.genericName)
      appendIfPresent('shelfLocation', formState.shelfLocation)
      if (String(formState.productType || '').trim().toUpperCase() === 'MEDICINAL') {
        fd.append('trackingProfile', normalizeTrackingProfile(formState.trackingProfile))
        fd.append('trackingMeta', JSON.stringify(formState.trackingMeta))
      } else if (productType === 'VARIANT_SERIALIZED') {
        fd.append('trackingMeta', JSON.stringify({ serializedDeviceProfile: formState.serializedDeviceProfile }))
      }
  
      // Arrays: serializados JSON normalizados (trim + uppercase)
      const batches = formState.batches.map(b => ({ 
        batch_no: String(b.batchNo || '').trim().toUpperCase(), 
        expiry_date: b.expiryDate, 
        quantity: Number(b.quantity || 0) 
      }))
      const imeis = [...formState.imeis].map(x => String(x || '').trim().toUpperCase())
      const serials = [...formState.serials].map(x => String(x || '').trim().toUpperCase())
      // Validación de duplicados y conteo para IMEI/SERIAL en creación
      {
        if (productType === 'IMEI' || productType === 'SERIAL') {
          const list = productType === 'IMEI' ? imeis : serials
          
          const duplicates = [...new Set(list.filter((v, i, arr) => arr.indexOf(v) !== i))]
          if (duplicates.length > 0) {
            alert(`Valores duplicados detectados: ${duplicates.join(', ')}`)
            setLoading(false)
            return
          }
        }
        if (productType === 'VARIANT_SERIALIZED') {
          const duplicateVariantSkus = [...new Set(serializedVariants.map(variant => variant.sku).filter(Boolean).filter((value, index, arr) => arr.indexOf(value) !== index))]
          if (duplicateVariantSkus.length > 0) {
            alert(`SKU de variante duplicado: ${duplicateVariantSkus.join(', ')}`)
            setLoading(false)
            return
          }
        }
      }
      fd.append('batches', JSON.stringify(batches))
      fd.append('imeis', JSON.stringify(imeis))
      fd.append('serials', JSON.stringify(serials))
      fd.append('variants', JSON.stringify(serializedVariants))
      fd.append('productImages', JSON.stringify(productImages))
      newFiles.forEach(file => fd.append('images', file))
  
      const created = await createProduct(fd, {
        onUploadProgress: percent => setImageUploadProgress(percent),
      })
      // Si se eligió un almacén distinto al predeterminado (ID 1), transferir el stock inicial
      /* try {
        const chosenWarehouseId = Number(formState.initialWarehouseId || 0)
        const initialQty = Number((created as any)?.initialStock ?? formState.initialStock ?? 0)
        if (initialQty > 0 && chosenWarehouseId && chosenWarehouseId !== 1) {
          await transferProductWarehouseStock(created.id, { fromWarehouseId: 1, toWarehouseId: chosenWarehouseId, quantity: initialQty })
        }
      } catch (e) {
        console.warn('Transferencia automática de stock inicial falló:', e)
      } */
      setProducts(prev => [created, ...prev])
      setShowCreate(false)
      setImageUploadProgress(null)
      alert('Producto creado correctamente')
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Error creando producto'
      const dup = err?.response?.data?.duplicate
      alert(dup ? `${msg}. Duplicado: ${dup}` : msg)
      setError(msg)
    } finally {
      setImageUploadProgress(null)
      setLoading(false)
    }
  }

  async function saveEdit() {
    if (!editTarget?.id) return
    try {
      setLoading(true)
      setImageUploadProgress(0)
      const productType = String(formState.productType || 'GENERAL').trim().toUpperCase()
      const serializedVariants = buildSerializedVariantsPayload()
      const { productImages, newFiles } = buildProductImagesUploadPayload(formState.productImages)
      // Validación: para productos MEDICINAL, el stock inicial debe coincidir con la suma de lotes
      // Logic removed: Stock details are now entered via Purchases/Adjustments
      /* const isMedicinal = String(formState.productType || 'GENERAL').toUpperCase() === 'MEDICINAL'
      if (isMedicinal) {
        // ...
      } */
      // Validación: para productos IMEI, la cantidad de IMEIs debe coincidir con el stock inicial
      // Logic removed: Stock details are now entered via Purchases/Adjustments
      /* const isImeiEdit = String(formState.productType || 'GENERAL').toUpperCase() === 'IMEI'
      if (isImeiEdit) {
        // ...
      } */
      // Validación: para productos SERIAL, la cantidad de series debe coincidir con el stock inicial
      // Logic removed: Stock details are now entered via Purchases/Adjustments
      /* const isSerialEdit = String(formState.productType || 'GENERAL').toUpperCase() === 'SERIAL'
      if (isSerialEdit) {
        // ...
      } */
      const fd = new FormData()
      const appendIfPresent = (k: string, v: string) => { 
        if (v !== undefined && v !== null && !(typeof v === 'string' && v === '')) fd.append(k, String(v).trim().toUpperCase()) 
      }
      const errors: string[] = []
      if (!String(formState.name || '').trim()) errors.push('El nombre es obligatorio.')
      if (formState.price === '' || Number.isNaN(Number(formState.price))) errors.push('El precio es obligatorio y debe ser numérico.')
      if (!String(formState.unit || '').trim()) errors.push('La unidad es obligatoria.')
      if (formState.cost !== '' && Number.isNaN(Number(formState.cost))) errors.push('El costo debe ser numérico.')
      if (productType === 'VARIANT_SERIALIZED') {
        serializedVariants.forEach((variant, variantIndex) => {
          if (variant.price !== undefined && Number.isNaN(Number(variant.price))) {
            errors.push(`La variante ${variantIndex + 1} tiene un precio inválido.`)
          }
          if (variant.cost !== undefined && Number.isNaN(Number(variant.cost))) {
            errors.push(`La variante ${variantIndex + 1} tiene un costo inválido.`)
          }
        })
      }
      if (errors.length > 0) {
        alert(errors.join('\n'))
        setLoading(false)
        return
      }
      fd.append('name', String(formState.name || '').trim().toUpperCase())
      fd.append('sku', String(formState.sku || '').trim().toUpperCase())
      appendIfPresent('productCode', formState.productCode)
      fd.append('price', formState.price)
      appendIfPresent('categoryId', formState.categoryId)
      appendIfPresent('brandId', formState.brandId)
      appendIfPresent('supplierId', formState.supplierId)
      appendIfPresent('price2', formState.price2)
      appendIfPresent('price3', formState.price3)
      appendIfPresent('cost', formState.cost)
      appendIfPresent('initialStock', formState.initialStock)
      appendIfPresent('minStock', formState.minStock)
      appendIfPresent('unit', formState.unit)
      appendIfPresent('description', formState.description)
  
      fd.append('productType', productType)
      appendIfPresent('altName', formState.altName)
      appendIfPresent('genericName', formState.genericName)
      appendIfPresent('shelfLocation', formState.shelfLocation)
      if (String(formState.productType || '').trim().toUpperCase() === 'MEDICINAL') {
        fd.append('trackingProfile', normalizeTrackingProfile(formState.trackingProfile))
        fd.append('trackingMeta', JSON.stringify(formState.trackingMeta))
      } else if (productType === 'VARIANT_SERIALIZED') {
        fd.append('trackingMeta', JSON.stringify({ serializedDeviceProfile: formState.serializedDeviceProfile }))
      }
  
      const batches = formState.batches.map(b => ({ 
        batch_no: String(b.batchNo || '').trim().toUpperCase(), 
        expiry_date: b.expiryDate, 
        quantity: Number(b.quantity || 0) 
      }))
      const imeis = [...formState.imeis].map(x => String(x || '').trim().toUpperCase())
      const serials = [...formState.serials].map(x => String(x || '').trim().toUpperCase())
      // Validación de duplicados para IMEI/SERIAL en edición
      {
        if (productType === 'IMEI' || productType === 'SERIAL') {
          const list = productType === 'IMEI' ? imeis : serials
          const duplicates = [...new Set(list.filter((v, i, arr) => arr.indexOf(v) !== i))]
          if (duplicates.length > 0) {
            alert(`Valores duplicados detectados: ${duplicates.join(', ')}`)
            setLoading(false)
            return
          }
        }
        if (productType === 'VARIANT_SERIALIZED') {
          const duplicateVariantSkus = [...new Set(serializedVariants.map(variant => variant.sku).filter(Boolean).filter((value, index, arr) => arr.indexOf(value) !== index))]
          if (duplicateVariantSkus.length > 0) {
            alert(`SKU de variante duplicado: ${duplicateVariantSkus.join(', ')}`)
            setLoading(false)
            return
          }
        }
      }
      fd.append('batches', JSON.stringify(batches))
      fd.append('imeis', JSON.stringify(imeis))
      fd.append('serials', JSON.stringify(serials))
      fd.append('variants', JSON.stringify(serializedVariants))
      fd.append('productImages', JSON.stringify(productImages))
      newFiles.forEach(file => fd.append('images', file))

      const updated = await updateProduct(editTarget.id, fd, {
        onUploadProgress: percent => setImageUploadProgress(percent),
      })
      setProducts(prev => prev.map(p => (p.id === updated.id ? updated : p)))
      setEditTarget(null)
      setShowCreate(false)
      setImageUploadProgress(null)
      alert('Producto actualizado correctamente')
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Error guardando producto'
      const dup = err?.response?.data?.duplicate
      alert(dup ? `${msg}. Duplicado: ${dup}` : msg)
      setError(msg)
    } finally {
      setImageUploadProgress(null)
      setLoading(false)
    }
  }

  async function saveVariantEditor() {
    if (!variantEditorTarget?.id) return
    try {
      setLoading(true)
      const serializedVariants = buildSerializedVariantsPayload()
      const errors: string[] = []
      serializedVariants.forEach((variant, variantIndex) => {
        if (variant.price !== undefined && Number.isNaN(Number(variant.price))) {
          errors.push(`La variante ${variantIndex + 1} tiene un precio inválido.`)
        }
        if (variant.cost !== undefined && Number.isNaN(Number(variant.cost))) {
          errors.push(`La variante ${variantIndex + 1} tiene un costo inválido.`)
        }
      })
      if (errors.length > 0) {
        alert(errors.join('\n'))
        setLoading(false)
        return
      }

      const duplicateVariantSkus = [...new Set(serializedVariants.map(variant => variant.sku).filter(Boolean).filter((value, index, arr) => arr.indexOf(value) !== index))]
      if (duplicateVariantSkus.length > 0) {
        alert(`SKU de variante duplicado: ${duplicateVariantSkus.join(', ')}`)
        setLoading(false)
        return
      }

      const fd = new FormData()
      const appendIfPresent = (k: string, v: string) => {
        if (v !== undefined && v !== null && !(typeof v === 'string' && v === '')) fd.append(k, String(v).trim().toUpperCase())
      }

      fd.append('name', String(formState.name || '').trim().toUpperCase())
      fd.append('sku', String(formState.sku || '').trim().toUpperCase())
      appendIfPresent('productCode', formState.productCode)
      fd.append('price', formState.price)
      appendIfPresent('categoryId', formState.categoryId)
      appendIfPresent('brandId', formState.brandId)
      appendIfPresent('supplierId', formState.supplierId)
      appendIfPresent('price2', formState.price2)
      appendIfPresent('price3', formState.price3)
      appendIfPresent('cost', formState.cost)
      appendIfPresent('initialStock', formState.initialStock)
      appendIfPresent('minStock', formState.minStock)
      appendIfPresent('unit', formState.unit)
      appendIfPresent('description', formState.description)
      fd.append('productType', 'VARIANT_SERIALIZED')
      appendIfPresent('altName', formState.altName)
      appendIfPresent('genericName', formState.genericName)
      appendIfPresent('shelfLocation', formState.shelfLocation)
      fd.append('trackingMeta', JSON.stringify({ serializedDeviceProfile: formState.serializedDeviceProfile }))
      fd.append('batches', JSON.stringify([]))
      fd.append('imeis', JSON.stringify([]))
      fd.append('serials', JSON.stringify([]))
      fd.append('variants', JSON.stringify(serializedVariants))

      const updated = await updateProduct(variantEditorTarget.id, fd)
      setProducts(prev => prev.map(p => (p.id === updated.id ? updated : p)))
      closeVariantEditor()
      alert('Variantes actualizadas correctamente')
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Error guardando variantes'
      const dup = err?.response?.data?.duplicate
      alert(dup ? `${msg}. Duplicado: ${dup}` : msg)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  async function openCatalogPdfBuilder() {
    setCatalogPdfDepartmentId(selectedDepartmentId)
    setCatalogPdfCategoryId(selectedCategoryId)
    setCatalogPdfSubcategoryId(selectedSubcategoryId)
    setCatalogPdfBrandId(selectedBrandId)
    setCatalogPdfProducts([])
    setCatalogPdfLoading(true)
    setCatalogPdfError(null)
    setCatalogPdfSelectedIds([])
    setCatalogPdfTitle(normalizeCatalogTitleText(config?.name ? `Catalogo de ${config.name}` : 'Catalogo de productos'))
    setCatalogPdfSubtitle('Explora una selección visual diseñada para compartir, vender y destacar los beneficios clave de cada artículo.')
    setShowCatalogPdfModal(true)
  }

  function closeCatalogPdfBuilder() {
    setShowCatalogPdfModal(false)
    setCatalogPdfLoading(false)
    setCatalogPdfError(null)
    setCatalogPdfGenerating(false)
    setCatalogPdfProgress(0)
    setCatalogPdfProgressLabel('Preparando catálogo...')
  }

  function resetCatalogPdfFilters() {
    setCatalogPdfDepartmentId(null)
    setCatalogPdfCategoryId(null)
    setCatalogPdfSubcategoryId(null)
    setCatalogPdfBrandId(null)
  }

  function handleCatalogPdfDepartmentChange(value: number | null) {
    setCatalogPdfDepartmentId(value)
    setCatalogPdfCategoryId(null)
    setCatalogPdfSubcategoryId(null)
  }

  function handleCatalogPdfCategoryChange(value: number | null) {
    setCatalogPdfCategoryId(value)
    setCatalogPdfSubcategoryId(null)
  }

  useEffect(() => {
    if (!showCatalogPdfModal) return

    let cancelled = false

    async function loadCatalogPdfProducts() {
      try {
        setCatalogPdfLoading(true)
        setCatalogPdfError(null)
        const response = await getProducts(buildCatalogPdfProductQuery({
          departmentId: catalogPdfDepartmentId,
          categoryId: catalogPdfCategoryId,
          subcategoryId: catalogPdfSubcategoryId,
          brandId: catalogPdfBrandId,
        }))
        if (cancelled) return
        const items = Array.isArray(response)
          ? response
          : (Array.isArray(response?.data) ? response.data : [])
        setCatalogPdfProducts(items)
        setCatalogPdfSelectedIds(
          filterCatalogProducts(items, { onlyWithImage: catalogPdfOnlyWithImage }).map(product => Number(product.id))
        )
      } catch (err: any) {
        if (cancelled) return
        setCatalogPdfProducts([])
        setCatalogPdfSelectedIds([])
        setCatalogPdfError(err?.response?.data?.error || err?.message || 'No se pudieron cargar los productos del catálogo PDF')
      } finally {
        if (!cancelled) setCatalogPdfLoading(false)
      }
    }

    void loadCatalogPdfProducts()

    return () => {
      cancelled = true
    }
  }, [
    showCatalogPdfModal,
    catalogPdfDepartmentId,
    catalogPdfCategoryId,
    catalogPdfSubcategoryId,
    catalogPdfBrandId,
    catalogPdfOnlyWithImage,
  ])

  function toggleCatalogPdfProduct(productId: number) {
    setCatalogPdfSelectedIds(prev => {
      const numericId = Number(productId)
      return prev.includes(numericId)
        ? prev.filter(id => id !== numericId)
        : [...prev, numericId]
    })
  }

  function selectAllCatalogPdfVisibleProducts() {
    setCatalogPdfSelectedIds(catalogPdfVisibleProducts.map(product => Number(product.id)))
  }

  function clearCatalogPdfSelection() {
    setCatalogPdfSelectedIds([])
  }

  async function generateCatalogPdfFile() {
    const selectedProducts = filterCatalogProducts(catalogPdfProducts, {
      onlyWithImage: catalogPdfOnlyWithImage,
      selectedIds: catalogPdfSelectedIds,
    })
    if (selectedProducts.length === 0) {
      setCatalogPdfError('Selecciona al menos un producto para generar el catálogo.')
      return
    }

    try {
      setCatalogPdfGenerating(true)
      setCatalogPdfProgress(3)
      setCatalogPdfProgressLabel('Preparando catálogo...')
      setCatalogPdfError(null)
      await generateProductCatalogPdf({
        title: catalogPdfTitle,
        subtitle: catalogPdfSubtitle,
        currency,
        logoUrl: config?.logoUrl,
        storeName: config?.name || 'Tienda DTM',
        products: selectedProducts.map(product => ({
          ...product,
          imageUrl: getCatalogProductPrimaryImageUrl(product),
        })),
        onProgress: (progress, stage) => {
          setCatalogPdfProgress(progress)
          setCatalogPdfProgressLabel(stage)
        },
      })
    } catch (err: any) {
      setCatalogPdfError(err?.message || 'No se pudo generar el catálogo PDF.')
    } finally {
      setCatalogPdfGenerating(false)
      setCatalogPdfProgress(0)
      setCatalogPdfProgressLabel('Preparando catálogo...')
    }
  }

  async function removeProduct(id: number) {
    if (!canManageProducts) {
      alert('No tienes permisos para eliminar productos')
      return
    }
    const target = products.find(p => p.id === id) || null
    setDeleteTarget(target)
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    try {
      setLoading(true)
      await deleteProduct(deleteTarget.id)
      setProducts(prev => prev.filter(p => p.id !== deleteTarget.id))
      setTotalProducts(prev => Math.max(0, prev - 1))
      setCatalogTotal(prev => Math.max(0, prev - 1))
      setDeleteTarget(null)
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Error eliminando producto'
      alert(msg)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-shell">
      <div className="page-toolbar">
        <h2 style={{ margin: 0 }}>{productsPageTitle}</h2>
        <div className="page-toolbar-actions">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input placeholder="Buscar por codigo, SKU, nombre, descripcion, alternativo o generico..." value={query} onChange={e => setQuery(e.target.value)} style={{ width: 280, maxWidth: '100%' }} />
            <MobileBarcodeScannerButton
              buttonLabel="Escanear"
              modalTitle="Escanear producto"
              onDetected={value => setQuery(value)}
            />
            {isCompactCatalogFilters && (
              <button
                type="button"
                className={`catalog-filters-toggle ${isCatalogFiltersOpen ? 'open' : ''}`}
                onClick={() => setIsCatalogFiltersOpen(prev => !prev)}
              >
                <span>Filtros</span>
                {activeCatalogFiltersCount > 0 && <strong>{activeCatalogFiltersCount}</strong>}
              </button>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Mostrando {paginatedProducts.length > 0 ? ((currentPage - 1) * productsPerPage) + 1 : 0}
            {' - '}
            {Math.min(currentPage * productsPerPage, totalProducts)} de {totalProducts}
            {' '}resultados
            {' '}• Total catalogo: {catalogTotal || totalProducts}
            {hasActiveFilters && (
              <>
                {' '}• Filtros activos
                <button className="small-btn" style={{ marginLeft: 6 }} onClick={clearFilters}>Limpiar filtros</button>
              </>
            )}
          </div>
          {!canManageProducts && (
            <div style={{ fontSize: 12, color: 'var(--muted)', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 10 }}>
              Catalogo en modo visualizacion
            </div>
          )}
          {canManageProducts && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="small-btn" onClick={downloadImportTemplate} disabled={importing}>
                Descargar formato
              </button>
              <input
                type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                disabled={importing}
                style={{ maxWidth: 260 }}
              />
              <button className="small-btn" onClick={runImport} disabled={importing || !importFile}>
                {importing ? 'Importando...' : 'Importar Excel'}
              </button>
            </div>
          )}
          <button className="small-btn" onClick={openCatalogPdfBuilder}>
            Catalogo PDF
          </button>
          {canManageProducts && <button className="primary-btn" onClick={startCreate}>Nuevo producto</button>}
          <div className="view-toggle">
            <button
              className={`toggle-btn ${view === 'grid' ? 'active' : ''}`}
              onClick={() => setView('grid')}
              aria-label="Vista grid"
              title="Vista grid"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z" />
              </svg>
            </button>
            <button
              className={`toggle-btn ${view === 'list' ? 'active' : ''}`}
              onClick={() => setView('list')}
              aria-label="Vista lista"
              title="Vista lista"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {(brands.length > 0 || suppliers.length > 0 || departments.length > 0) && (
        <div className={`catalog-filters-panel ${isCompactCatalogFilters ? 'compact' : ''} ${isCatalogFiltersOpen ? 'open' : ''}`}>
        <div className="filters-row">
          {departments.length > 0 && (
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>Departamento</label>
              <select value={selectedDepartmentId === null ? '' : selectedDepartmentId} onChange={e => setSelectedDepartmentId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Todos</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Categoría</label>
            <select value={selectedCategoryId === null ? '' : selectedCategoryId} onChange={e => { const val = e.target.value ? Number(e.target.value) : null; setSelectedCategoryId(val); setSelectedSubcategoryId(null); }}>
              <option value="">Todas</option>
              {categories
                .filter(pc => !pc.parentId && (selectedDepartmentId === null ? true : pc.departmentId === selectedDepartmentId))
                .map(pc => (
                  <option key={pc.id} value={pc.id}>{pc.name}</option>
                ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Subcategoría</label>
            <select value={selectedSubcategoryId === null ? '' : selectedSubcategoryId} onChange={e => setSelectedSubcategoryId(e.target.value ? Number(e.target.value) : null)} disabled={selectedCategoryId === null}>
              <option value="">Todas</option>
              {categories
                .filter(sc => selectedCategoryId !== null ? sc.parentId === selectedCategoryId : false)
                .map(sc => (
                  <option key={sc.id} value={sc.id}>{sc.name}</option>
                ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Marca</label>
            <select value={selectedBrandId === null ? '' : selectedBrandId} onChange={e => setSelectedBrandId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Todas</option>
              {brands.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Stock</label>
            <select value={selectedStockFilter} onChange={e => setSelectedStockFilter(e.target.value as 'all' | 'with_stock' | 'without_stock')}>
              <option value="all">Con y sin stock</option>
              <option value="with_stock">Solo con stock</option>
              <option value="without_stock">Solo sin stock</option>
            </select>
          </div>
          {canViewSensitiveProductData && (
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Proveedor</label>
            <select value={selectedSupplierId === null ? '' : selectedSupplierId} onChange={e => setSelectedSupplierId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Todos</option>
              {suppliers.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          )}
          <div>
            <button className="small-btn" onClick={clearFilters} disabled={!hasActiveFilters} title="Limpiar todos los filtros" aria-label="Limpiar filtros">
              🧹 Limpiar filtros
            </button>
          </div>
        </div>
        </div>
      )}

      {importResult && (
        <div style={{ marginTop: 12, border: '1px solid var(--border)', borderRadius: 12, padding: 12, background: 'var(--bg)' }}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Importación: {Number(importResult.createdCount || 0)} creados • {Number(importResult.errorCount || 0)} errores
          </div>
          {Array.isArray(importResult.errors) && importResult.errors.length > 0 && (
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, marginTop: 8, maxHeight: 220, overflow: 'auto' }}>
{JSON.stringify(importResult.errors.slice(0, 50), null, 2)}
            </pre>
          )}
        </div>
      )}

      {loading && <div>Cargando...</div>}
      {error && (
        <div style={{
          background: '#FEF2F2',
          color: '#991B1B',
          border: '1px solid #FCA5A5',
          borderRadius: 8,
          padding: 10,
          marginBottom: 12
        }}>
          {error}
        </div>
      )}

      {!loading && (
        <>
          {totalProducts > productsPerPage && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                Pagina {currentPage} de {totalPages} • {productsPerPage} productos por pagina
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="small-btn" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>Primera</button>
                <button className="small-btn" onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1}>Anterior</button>
                <button className="small-btn" onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages}>Siguiente</button>
                <button className="small-btn" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}>Ultima</button>
              </div>
            </div>
          )}
          {view === 'grid' ? (
            <div className="products-grid">
              {paginatedProducts.map(p => (
                <div
                  key={p.id}
                  style={{
                    background: 'var(--modal)',
                    border: '1px solid var(--border)',
                    borderRadius: 18,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 352,
                    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.07)'
                  }}
                >
                  <div style={{ position: 'relative', padding: 12, paddingBottom: 0 }}>
                    <img
                      src={p.imageUrl || 'https://via.placeholder.com/800x600?text=IMG'}
                      alt={p.name}
                      loading="lazy"
                      decoding="async"
                      style={{
                        width: '100%',
                        height: 156,
                        borderRadius: 16,
                        objectFit: 'cover',
                        cursor: 'zoom-in',
                        background: 'var(--bg)'
                      }}
                      role="button"
                      tabIndex={0}
                      title="Ver imagen grande"
                      aria-label={`Ver imagen grande de ${p.name}`}
                      onClick={() => openImageViewer(p, p.imageUrl || 'https://via.placeholder.com/800x600?text=IMG')}
                      onKeyDown={e => { if (e.key === 'Enter') openImageViewer(p, p.imageUrl || 'https://via.placeholder.com/800x600?text=IMG') }}
                    />
                    <button
                      type="button"
                      onClick={() => void openCatalogStock(p)}
                      title="Ver existencias por tienda"
                      aria-label={`Ver existencias por tienda de ${p.name}`}
                      style={{
                        position: 'absolute',
                        top: 20,
                        right: 20,
                        fontSize: 11,
                        padding: '5px 9px',
                        borderRadius: 999,
                        backdropFilter: 'blur(8px)',
                        background: 'rgba(255,255,255,0.88)',
                        color: '#0f172a',
                        fontWeight: 700,
                        cursor: 'pointer',
                        boxShadow: '0 8px 20px rgba(15, 23, 42, 0.12)',
                        ...(p.minStock !== undefined && p.minStock !== null
                          ? (Number(p.stock ?? 0) < Number(p.minStock)
                              ? { border: '1px solid #FCA5A5' }
                              : (Number(p.stock ?? 0) <= Number(p.minStock) * 1.2)
                                ? { border: '1px solid #F59E0B' }
                                : { border: '1px solid #34D399' })
                          : { border: '1px solid var(--border)' })
                      }}
                    >
                      Stock: {p.stock}
                    </button>
                  </div>

                  <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
                    <div>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: 15,
                          lineHeight: 1.3,
                          color: 'var(--text)',
                          marginBottom: 3,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden'
                        }}
                      >
                        {p.name}
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4, alignItems: 'center' }}>
                        <div style={{ fontSize: 11, letterSpacing: 0.2, color: '#60A5FA' }}>
                          SKU: {p.sku || '—'}
                        </div>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            padding: '4px 9px',
                            borderRadius: 999,
                            background: 'rgba(217, 119, 6, 0.12)',
                            border: '1px solid rgba(217, 119, 6, 0.22)',
                            color: '#a16207',
                            fontSize: 11,
                            fontWeight: 800,
                            letterSpacing: 0.3,
                            fontFamily: 'Consolas, Monaco, monospace'
                          }}
                          title={`Codigo de producto: ${p.productCode || 'Sin codigo'}`}
                        >
                          COD: {p.productCode || '—'}
                        </span>
                      </div>
                      {p.description && (
                        <div
                          style={{
                            marginTop: 8,
                            fontSize: 12,
                            lineHeight: 1.45,
                            color: 'var(--muted)',
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden'
                          }}
                          title={p.description}
                        >
                          {p.description}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 999, background: 'var(--bg)' }}>
                        {p.categoryId
                          ? (() => {
                              const cat = categoryById[p.categoryId]
                              if (!cat) return 'Sin categoria'
                              return cat.parentId ? (categoryMap[cat.parentId] || 'Sin categoria') : (categoryMap[p.categoryId] || 'Sin categoria')
                            })()
                          : 'Sin categoria'}
                      </span>
                      <span style={{ fontSize: 10, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 999, background: 'var(--bg)' }}>
                        {p.categoryId
                          ? (() => {
                              const cat = categoryById[p.categoryId]
                              const deptId = (cat?.departmentId ?? (cat?.parentId ? (categoryById[cat.parentId]?.departmentId ?? null) : null))
                              return deptId ? (departmentMap[deptId] || 'Sin departamento') : 'Sin departamento'
                            })()
                          : 'Sin departamento'}
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: canViewSensitiveProductData ? '1fr 1fr' : '1fr', gap: 8 }}>
                      <div style={{ padding: '8px 10px', borderRadius: 12, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Precio</div>
                        <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)' }}>{formatMoney(p.price ?? 0, currency)}</div>
                      </div>
                      {canViewSensitiveProductData && (
                      <div style={{ padding: '8px 10px', borderRadius: 12, background: 'rgba(245, 158, 11, 0.10)', border: '1px solid rgba(245, 158, 11, 0.25)' }}>
                        <div style={{ fontSize: 11, color: '#92400E', marginBottom: 4 }}>Costo</div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: '#92400E' }}>{formatMoney(p.cost ?? 0, currency)}</div>
                        <button
                          type="button"
                          onClick={() => void openCostHistory(p)}
                          style={{ marginTop: 8, padding: '6px 10px', borderRadius: 10, border: '1px solid rgba(245, 158, 11, 0.32)', background: 'rgba(255,255,255,0.75)', color: '#92400E', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                        >
                          Costos
                        </button>
                      </div>
                      )}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11, color: 'var(--muted)' }}>
                      <div>Marca: {p.brandId ? (brandMap[p.brandId] || '—') : '—'}</div>
                      <div>Unidad: {resolveUnitName(unitNameByCode, p.unit)}</div>
                      {canViewSensitiveProductData && <div>Proveedor: {p.supplierId ? (supplierMap[p.supplierId] || '—') : '—'}</div>}
                      <div>Stock min: {p.minStock ?? '—'}</div>
                      <div>Otras tiendas: {Number(p.otherStock ?? 0)}</div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 2 }}>
                    <button className="icon-btn" title="Ver detalles" aria-label="Ver detalles" onClick={() => openDetails(p.id)}>
                      <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 5c-7 0-11 7-11 7s4 7 11 7 11-7 11-7-4-7-11-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z" fill="currentColor"/></svg>
                    </button>
                    {canManageProducts && String(p.productType || '').toUpperCase() === 'VARIANT_SERIALIZED' && (
                      <button
                        type="button"
                        title="Gestionar variantes"
                        aria-label="Gestionar variantes"
                        onClick={() => void openVariantEditor(p)}
                        style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(37,99,235,0.22)', background: '#eff6ff', color: '#1d4ed8', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}
                      >
                        Variantes
                      </button>
                    )}
                    {canManageProducts && (
                      <button className="icon-btn primary" title="Editar" aria-label="Editar" onClick={() => startEdit(p)}>
                        <svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 17.25V21h3.75L17.81 9.94a1 1 0 0 0 0-1.41l-3.34-3.34a1 1 0 0 0-1.41 0L3 16.59z" fill="currentColor"/></svg>
                      </button>
                    )}
                    {canManageProducts && (
                      <button className="icon-btn danger" title="Eliminar" aria-label="Eliminar" onClick={() => removeProduct(p.id)} disabled={loading}>
                        <svg viewBox="0 0 24 24" width="18" height="18">
                          <path d="M3 6h18" stroke="currentColor" strokeWidth="2"/>
                          <path d="M8 6V4h8v2" stroke="currentColor" strokeWidth="2"/>
                          <path d="M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2"/>
                          <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2"/>
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="products-list table-scroll">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ background: 'var(--modal)' }}>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 8 }}>Imagen</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Nombre</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Código</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>SKU</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Categoría general</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Subcategoría</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Departamento</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Marca</th>
                    {canViewSensitiveProductData && <th style={{ textAlign: 'left', padding: 8 }}>Proveedor</th>}
                    {canViewSensitiveProductData && <th style={{ textAlign: 'left', padding: 8 }}>Costo</th>}
                    <th style={{ textAlign: 'left', padding: 8 }}>Precio</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Precio 2</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Precio 3</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Unidad</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Stock mín</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Stock</th>
                    <th style={{ textAlign: 'left', padding: 8 }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedProducts.map(p => (
                    <tr key={p.id}>
                      <td style={{ padding: 8 }}>
                        <img
                          src={p.imageUrl || 'https://via.placeholder.com/40x40?text=IMG'}
                          alt={p.name}
                          loading="lazy"
                          decoding="async"
                          width={40}
                          height={40}
                          style={{ borderRadius: 6, objectFit: 'cover', cursor: 'zoom-in' }}
                          role="button"
                          tabIndex={0}
                          title="Ver imagen grande"
                          aria-label={`Ver imagen grande de ${p.name}`}
                          onClick={() => openImageViewer(p, p.imageUrl || 'https://via.placeholder.com/800x600?text=IMG')}
                          onKeyDown={e => { if (e.key === 'Enter') openImageViewer(p, p.imageUrl || 'https://via.placeholder.com/800x600?text=IMG') }}
                        />
                      </td>
                      <td style={{ padding: 8 }}>{p.name}</td>
                      <td style={{ padding: 8 }}>{p.productCode || '-'}</td>
                      <td style={{ padding: 8, color: '#60A5FA' }}>{p.sku}</td>
                      {/* Categoría general */}
                      <td style={{ padding: 8 }}>
                        {p.categoryId
                          ? (() => {
                              const cat = categoryById[p.categoryId]
                              if (!cat) return '-'
                              // Si tiene padre, mostrar el nombre del padre; si no, la propia categoría
                              return cat.parentId ? (categoryMap[cat.parentId] || '-') : (categoryMap[p.categoryId] || '-')
                            })()
                          : '-'}
                      </td>
                      {/* Subcategoría */}
                      <td style={{ padding: 8 }}>
                        {p.categoryId
                          ? (() => {
                              const cat = categoryById[p.categoryId]
                              // Si tiene padre, la subcategoría es la propia categoría; si no, mostrar '-'
                              return cat && cat.parentId ? (categoryMap[p.categoryId] || '-') : '-'
                            })()
                          : '-'}
                      </td>
                      {/* Departamento */}
                      <td style={{ padding: 8 }}>
                        {p.categoryId
                          ? (() => {
                              const cat = categoryById[p.categoryId]
                              const deptId = (cat?.departmentId ?? (cat?.parentId ? (categoryById[cat.parentId]?.departmentId ?? null) : null))
                              return deptId ? (departmentMap[deptId] || '-') : '-'
                            })()
                          : '-'}
                      </td>
                      <td style={{ padding: 8 }}>{p.brandId ? brandMap[p.brandId] : '-'}</td>
                      {canViewSensitiveProductData && <td style={{ padding: 8 }}>{p.supplierId ? supplierMap[p.supplierId] : '-'}</td>}
                      {canViewSensitiveProductData && (
                        <td style={{ padding: 8, color: '#D97706' }}>
                          <div style={{ display: 'grid', gap: 6, justifyItems: 'start' }}>
                            <span>{formatMoney(p.cost ?? 0, currency)}</span>
                            <button
                              type="button"
                              onClick={() => void openCostHistory(p)}
                              style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid rgba(245, 158, 11, 0.32)', background: 'rgba(245, 158, 11, 0.10)', color: '#92400E', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                            >
                              Costos
                            </button>
                          </div>
                        </td>
                      )}
                      <td style={{ padding: 8 }}>{formatMoney(p.price ?? 0, currency)}</td>
                      <td style={{ padding: 8 }}>{formatMoney(p.price2 ?? 0, currency)}</td>
                      <td style={{ padding: 8 }}>{formatMoney(p.price3 ?? 0, currency)}</td>
                      <td style={{ padding: 8 }}>{resolveUnitName(unitNameByCode, p.unit)}</td>
                      <td style={{ padding: 8 }}>{p.minStock ?? '-'}</td>
                      <td style={{ padding: 8 }}>
                        <button
                          type="button"
                          onClick={() => void openCatalogStock(p)}
                          title="Ver existencias por tienda"
                          aria-label={`Ver existencias por tienda de ${p.name}`}
                          style={{
                            fontSize: 12,
                            padding: '2px 6px',
                            borderRadius: 10,
                            cursor: 'pointer',
                            ...(p.minStock !== undefined && p.minStock !== null
                              ? (Number(p.stock ?? 0) < Number(p.minStock)
                                  ? { border: '1px solid #FCA5A5', background: '#FEE2E2', color: '#991B1B', fontWeight: 600 }
                                  : (Number(p.stock ?? 0) <= Number(p.minStock) * 1.2)
                                    ? { border: '1px solid #F59E0B', background: '#FEF3C7', color: '#92400E', fontWeight: 600 }
                                    : { border: '1px solid #34D399', background: '#ECFDF5', color: '#065F46', fontWeight: 600 })
                              : { border: '1px solid var(--border)' })
                          }}
                        >
                          {p.stock}
                        </button>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                          Otras tiendas: {Number(p.otherStock ?? 0)}
                        </div>
                      </td>
                      <td style={{ padding: 8 }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="icon-btn" title="Ver detalles" aria-label="Ver detalles" onClick={() => openDetails(p.id)}>
                            <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 5c-7 0-11 7-11 7s4 7 11 7 11-7 11-7-4-7-11-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z" fill="currentColor"/></svg>
                          </button>
                          {canManageProducts && String(p.productType || '').toUpperCase() === 'VARIANT_SERIALIZED' && (
                            <button
                              type="button"
                              onClick={() => void openVariantEditor(p)}
                              style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(37,99,235,0.22)', background: '#eff6ff', color: '#1d4ed8', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}
                            >
                              Variantes
                            </button>
                          )}
                          {canManageProducts && (
                            <button className="icon-btn primary" title="Editar" aria-label="Editar" onClick={() => startEdit(p)}>
                              <svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 17.25V21h3.75L17.81 9.94a1 1 0 0 0 0-1.41l-3.34-3.34a1 1 0 0 0-1.41 0L3 16.59z" fill="currentColor"/></svg>
                            </button>
                          )}
                          {canManageProducts && (
                            <button className="icon-btn danger" title="Eliminar" aria-label="Eliminar" onClick={() => removeProduct(p.id)} disabled={loading}>
                              <svg viewBox="0 0 24 24" width="18" height="18">
                                <path d="M3 6h18" stroke="currentColor" strokeWidth="2"/>
                                <path d="M8 6V4h8v2" stroke="currentColor" strokeWidth="2"/>
                                <path d="M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2"/>
                                <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2"/>
                              </svg>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {showProductTypeSelector && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="responsive-modal" style={{ width: 400, background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
            <h3 style={{ margin: 0, marginBottom: 20, textAlign: 'center' }}>Seleccionar tipo de producto</h3>
            
            <div style={{ display: 'grid', gap: 12 }}>
              {availableProductTypeOptions.map(option => (
                <button
                  key={option.value}
                  onClick={() => startCreateWithType(option.value)}
                  style={{
                    padding: '12px 16px',
                    background: '#1e293b',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'white',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={(e) => e.currentTarget.style.background = 'var(--surface-hover)'}
                  onMouseOut={(e) => e.currentTarget.style.background = '#1e293b'}
                >
                  <div style={{ fontWeight: 'bold', marginBottom: 4 }}>{option.label}</div>
                  <div style={{ fontSize: '0.9em', opacity: 0.8 }}>{option.description}</div>
                </button>
              ))}
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 20 }}>
              <button 
                onClick={() => setShowProductTypeSelector(false)}
                style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)' }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {showSerializedVariantProfileSelector && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="responsive-modal" style={{ width: 460, background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 18, padding: 20 }}>
            <h3 style={{ margin: 0, marginBottom: 8, textAlign: 'center' }}>Tipo base de variante serializada</h3>
            <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', marginBottom: 18 }}>
              Primero define si este producto maestro trabajará con <strong>IMEI</strong> o con <strong>numero de serie</strong>. Luego se abrirá el formulario general y las variantes heredarán ese tipo.
            </div>

            <div style={{ display: 'grid', gap: 12 }}>
              {SERIALIZED_DEVICE_PROFILE_OPTIONS.map(option => (
                <button
                  key={option.value}
                  onClick={() => startCreateSerializedVariantWithProfile(option.value)}
                  style={{
                    padding: '14px 16px',
                    background: '#1e293b',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    color: 'white',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    textAlign: 'left',
                  }}
                  onMouseOver={(e) => e.currentTarget.style.background = 'var(--surface-hover)'}
                  onMouseOut={(e) => e.currentTarget.style.background = '#1e293b'}
                >
                  <div style={{ fontWeight: 800, marginBottom: 4 }}>{option.label}</div>
                  <div style={{ fontSize: 13, opacity: 0.85 }}>{option.description}</div>
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 20 }}>
              <button
                onClick={() => { setShowSerializedVariantProfileSelector(false); setShowProductTypeSelector(true) }}
                style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
              >
                Regresar
              </button>
              <button
                onClick={() => { setShowSerializedVariantProfileSelector(false); setEditTarget(null) }}
                style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="responsive-modal" style={{ width: 920, maxWidth: '94vw', background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 24, padding: 20, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 24px 60px rgba(15, 23, 42, 0.22)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 24 }}>
                  {editTarget ? 'Editar producto' : 'Nuevo producto'}
                </h3>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                  Configura la informacion principal y comercial del producto.
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, padding: '7px 12px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--bg)', fontWeight: 700 }}>
                  {formatProductTypeLabel(formState.productType)}
                </span>
                {formState.productType === 'VARIANT_SERIALIZED' && (
                  <span style={{ fontSize: 12, padding: '7px 12px', borderRadius: 999, border: '1px solid rgba(37,99,235,0.22)', background: '#eff6ff', color: '#1d4ed8', fontWeight: 800 }}>
                    Tipo base: {serializedVariantIdentifierLabel}
                  </span>
                )}
                <button
                  onClick={() => { setShowCreate(false); setEditTarget(null); setShowSerializedVariantProfileSelector(false) }}
                  style={{ width: 38, height: 38, borderRadius: 999, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
                  aria-label="Cerrar formulario"
                  title="Cerrar"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="responsive-two-col">
              <div style={{ background: 'linear-gradient(180deg, var(--bg), var(--surface))', border: '1px solid var(--border)', borderRadius: 22, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <ProductImageManager
                  value={formState.productImages}
                  onChange={onProductImagesChange}
                  uploadProgress={imageUploadProgress}
                />
                <div style={{ padding: 12, borderRadius: 16, background: 'var(--modal)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Resumen rapido</div>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{formState.name || 'Nombre pendiente'}</div>
                  <div style={{ fontSize: 12, color: '#60A5FA' }}>SKU: {formState.sku || '—'}</div>
                </div>
              </div>

              <div style={{ display: 'grid', gap: 14 }}>
                <div style={{ border: '1px solid var(--border)', borderRadius: 20, padding: 16, background: 'var(--modal)' }}>
                  <div style={{ fontWeight: 700, marginBottom: 12 }}>Informacion principal</div>
                  <div className="responsive-form-grid">
                    <div>
                      <label>Código de producto</label>
                      <input value={formState.productCode} onChange={e => onFormChange('productCode', e.target.value)} />
                    </div>
                    <div>
                      <label>Nombre</label>
                      <input value={formState.name} onChange={e => onFormChange('name', e.target.value)} />
                    </div>
                    <div>
                      <label>SKU</label>
                      <input value={formState.sku} onChange={e => onFormChange('sku', e.target.value)} />
                    </div>
                    <div>
                      <label>Stock minimo</label>
                      <input type="number" value={formState.minStock} onChange={e => onFormChange('minStock', e.target.value)} />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label>Descripción</label>
                      <textarea rows={3} value={formState.description} onChange={e => onFormChange('description', e.target.value)} />
                    </div>
                  </div>
                </div>

                <div style={{ border: '1px solid var(--border)', borderRadius: 20, padding: 16, background: 'var(--modal)' }}>
                  <div style={{ fontWeight: 700, marginBottom: 12 }}>Precios y unidad</div>
                  <div className="responsive-form-grid">
                    {canViewSensitiveProductData && (
                      <div>
                        <label>Precio costo</label>
                        <input type="number" value={formState.cost} onChange={(e) => onFormChange('cost', e.target.value)} placeholder="0.00" />
                      </div>
                    )}
                    <div>
                      <label>Precio</label>
                      <input type="number" value={formState.price} onChange={(e) => onFormChange('price', e.target.value)} placeholder="0.00" />
                    </div>
                    <div>
                      <label>Precio 2</label>
                      <input type="number" value={formState.price2} onChange={(e) => onFormChange('price2', e.target.value)} placeholder="0.00" />
                    </div>
                    <div>
                      <label>Precio 3</label>
                      <input type="number" value={formState.price3} onChange={(e) => onFormChange('price3', e.target.value)} placeholder="0.00" />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label>Unidad de venta</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <select value={formState.unit} onChange={e => onFormChange('unit', e.target.value)}>
                          <option value="">--</option>
                          {units.map(u => (
                            <option key={u.id} value={u.code}>{u.name}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          title="Nueva unidad"
                          onClick={() => setQuickAddModal('unit')}
                          style={{ width: 32, height: 32, borderRadius: 10, background: '#2563eb', color: '#fff', border: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, boxShadow: '0 2px 6px rgba(37,99,235,0.35)', cursor: 'pointer' }}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ border: '1px solid var(--border)', borderRadius: 20, padding: 16, background: 'var(--modal)' }}>
                  <div style={{ fontWeight: 700, marginBottom: 12 }}>Clasificacion y relaciones</div>
                  <div className="responsive-form-grid">
                    <div>
                      <label>Marca</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <select value={formState.brandId} onChange={e => onFormChange('brandId', e.target.value)}>
                          <option value="">--</option>
                          {brands.map(b => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          title="Nueva marca"
                          onClick={() => setQuickAddModal('brand')}
                          style={{ width: 32, height: 32, borderRadius: 10, background: '#10b981', color: '#0b1220', border: '1px solid #34d399', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, boxShadow: '0 2px 6px rgba(52,211,153,0.25)', cursor: 'pointer' }}
                        >
                          +
                        </button>
                      </div>
                    </div>
                    {canViewSensitiveProductData && (
                      <div>
                        <label>Proveedor</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <select value={formState.supplierId} onChange={e => onFormChange('supplierId', e.target.value)}>
                            <option value="">--</option>
                            {suppliers.map(s => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            title="Nuevo proveedor"
                            onClick={() => setQuickAddModal('supplier')}
                            style={{ width: 32, height: 32, borderRadius: 10, background: '#ef4444', color: '#fff', border: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, boxShadow: '0 2px 6px rgba(239,68,68,0.35)', cursor: 'pointer' }}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    )}
                    <div>
                      <label>Departamento</label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <select value={formDepartmentId ?? ''} onChange={e => setFormDepartmentId(e.target.value ? Number(e.target.value) : null)}>
                          <option value="">— Selecciona departamento —</option>
                          {departments.map(d => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          title="Nuevo departamento"
                          onClick={() => setQuickAddModal('department')}
                          style={{ width: 32, height: 32, borderRadius: 10, background: '#3b82f6', color: '#fff', border: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(59,130,246,0.35)', cursor: 'pointer' }}
                        >
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 5v14"/>
                            <path d="M5 12h14"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label>Categoría</label>
                      <div className="responsive-category-grid">
                        <select value={formParentId ?? ''} onChange={e => { const v = e.target.value ? Number(e.target.value) : null; setFormParentId(v); onFormChange('categoryId', ''); }}>
                          <option value="">— Selecciona categoría general —</option>
                          {parentCategories.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          title="Nueva categoría general"
                          onClick={() => { setNewCategoryParentId(null); setQuickAddModal('category') }}
                          style={{ width: 32, height: 32, borderRadius: 10, background: '#f59e0b', color: '#0b1220', border: '1px solid #fbbf24', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, boxShadow: '0 2px 6px rgba(251,191,36,0.35)', cursor: 'pointer' }}
                        >
                          +
                        </button>
                        <select value={formState.categoryId} onChange={e => onFormChange('categoryId', e.target.value)} disabled={!formParentId || subcategoriesForParent.length === 0}>
                          <option value="">— Selecciona subcategoría —</option>
                          {subcategoriesForParent.map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          title="Nueva subcategoría"
                          onClick={() => { if (!formParentId) { alert('Selecciona categoría general primero'); return } setNewCategoryParentId(formParentId || null); setQuickAddModal('subcategory') }}
                          disabled={!formParentId}
                          style={{ width: 32, height: 32, borderRadius: 10, background: '#f59e0b', color: '#0b1220', border: '1px solid #fbbf24', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, boxShadow: '0 2px 6px rgba(251,191,36,0.35)', cursor: 'pointer' }}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {formState.productType === 'MEDICINAL' && (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 20, padding: 16, background: 'var(--modal)' }}>
                    <div style={{ fontWeight: 700, marginBottom: 12 }}>Datos de lote y vencimiento</div>
                    <div className="responsive-form-grid">
                      <div>
                        <label>Perfil</label>
                        <select value={formState.trackingProfile} onChange={e => onFormChange('trackingProfile', normalizeTrackingProfile(e.target.value))}>
                          <option value="GENERAL">General</option>
                          <option value="ALIMENTO">Alimento</option>
                          <option value="MEDICAMENTO">Medicamento</option>
                          <option value="COSMETICO">Cosmetico</option>
                          <option value="QUIMICO">Quimico</option>
                        </select>
                      </div>
                      <div>
                        <label>Nombre alternativo o comercial</label>
                        <input value={formState.altName} onChange={e => onFormChange('altName', e.target.value)} />
                      </div>
                      <div style={{ gridColumn: '1 / -1' }}>
                        <label>Ubicación en estante</label>
                        <input value={formState.shelfLocation} onChange={e => onFormChange('shelfLocation', e.target.value)} />
                      </div>
                      {formState.trackingProfile === 'MEDICAMENTO' && (
                        <>
                          <div>
                            <label>Nombre genérico</label>
                            <input value={formState.genericName} onChange={e => onFormChange('genericName', e.target.value)} />
                          </div>
                          <div>
                            <label>Principio activo</label>
                            <input value={formState.trackingMeta.activeIngredient} onChange={e => onTrackingMetaChange('activeIngredient', e.target.value)} />
                          </div>
                          <div>
                            <label>Concentración</label>
                            <input value={formState.trackingMeta.concentration} onChange={e => onTrackingMetaChange('concentration', e.target.value)} />
                          </div>
                          <div>
                            <label>Forma farmacéutica</label>
                            <input value={formState.trackingMeta.dosageForm} onChange={e => onTrackingMetaChange('dosageForm', e.target.value)} />
                          </div>
                          <div>
                            <label>Registro sanitario</label>
                            <input value={formState.trackingMeta.sanitaryRegistry} onChange={e => onTrackingMetaChange('sanitaryRegistry', e.target.value)} />
                          </div>
                          <div>
                            <label>Condiciones de almacenamiento</label>
                            <input value={formState.trackingMeta.storageNotes} onChange={e => onTrackingMetaChange('storageNotes', e.target.value)} />
                          </div>
                        </>
                      )}
                      {formState.trackingProfile === 'ALIMENTO' && (
                        <>
                          <div>
                            <label>Presentación o contenido</label>
                            <input value={formState.trackingMeta.presentation} onChange={e => onTrackingMetaChange('presentation', e.target.value)} />
                          </div>
                          <div>
                            <label>Tipo de empaque</label>
                            <input value={formState.trackingMeta.packageType} onChange={e => onTrackingMetaChange('packageType', e.target.value)} />
                          </div>
                          <div>
                            <label>Origen o línea</label>
                            <input value={formState.trackingMeta.originInfo} onChange={e => onTrackingMetaChange('originInfo', e.target.value)} />
                          </div>
                          <div>
                            <label>Condiciones de almacenamiento</label>
                            <input value={formState.trackingMeta.storageNotes} onChange={e => onTrackingMetaChange('storageNotes', e.target.value)} />
                          </div>
                        </>
                      )}
                      {formState.trackingProfile !== 'MEDICAMENTO' && formState.trackingProfile !== 'ALIMENTO' && (
                        <>
                          <div>
                            <label>Presentación</label>
                            <input value={formState.trackingMeta.presentation} onChange={e => onTrackingMetaChange('presentation', e.target.value)} />
                          </div>
                          <div>
                            <label>Notas de almacenamiento</label>
                            <input value={formState.trackingMeta.storageNotes} onChange={e => onTrackingMetaChange('storageNotes', e.target.value)} />
                          </div>
                        </>
                      )}
                      <div style={{ gridColumn: '1 / -1' }}>
                        <label>Notas regulatorias u observaciones</label>
                        <input value={formState.trackingMeta.regulatoryNotes} onChange={e => onTrackingMetaChange('regulatoryNotes', e.target.value)} />
                      </div>
                    </div>
                    <div style={{ marginTop: 12, padding: 12, background: '#eff6ff', borderRadius: 14, fontSize: 13, color: '#1e40af' }}>
                      El stock, los lotes y las fechas de vencimiento se siguen ingresando desde <strong>Compras</strong> o <strong>Ajustes de Stock</strong>. Este bloque solo define los datos base segun el rubro.
                    </div>
                  </div>
                )}

                {formState.productType === 'IMEI' && (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 20, padding: 16, background: 'var(--modal)' }}>
                    <div style={{ fontWeight: 700, marginBottom: 10 }}>Control por IMEI</div>
                    <div style={{ padding: 12, background: '#eff6ff', borderRadius: 14, fontSize: 13, color: '#1e40af' }}>
                      Los codigos IMEI se ingresan desde <strong>Compras</strong> o <strong>Ajustes de Stock</strong>.
                    </div>
                  </div>
                )}

                {formState.productType === 'SERIAL' && (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 20, padding: 16, background: 'var(--modal)' }}>
                    <div style={{ fontWeight: 700, marginBottom: 10 }}>Control por serial</div>
                    <div style={{ padding: 12, background: '#eff6ff', borderRadius: 14, fontSize: 13, color: '#1e40af' }}>
                      Los numeros de serie se ingresan desde <strong>Compras</strong> o <strong>Ajustes de Stock</strong>.
                    </div>
                  </div>
                )}

                {formState.productType === 'VARIANT_SERIALIZED' && (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 20, padding: 16, background: 'var(--modal)', display: 'grid', gap: 12 }}>
                    <div style={{ fontWeight: 700 }}>IMEI-SERIAL VARIANTE</div>
                    <div style={{ padding: 12, background: '#eff6ff', borderRadius: 14, fontSize: 13, color: '#1e40af' }}>
                      {editTarget
                        ? <>Este formulario solo actualiza los <strong>datos generales</strong> del producto maestro. Las variantes se gestionan desde el botón <strong>Variantes</strong> en la tarjeta o en el listado.</>
                        : <>Primero se guarda el <strong>producto maestro</strong> con sus datos generales. Después, desde la tarjeta creada, usa el botón <strong>Variantes</strong> para abrir el diálogo y agregar las combinaciones comerciales.</>}
                    </div>
                    <div className="responsive-form-grid">
                      <div>
                        <label>Tipo base del producto serializado</label>
                        <input
                          value={SERIALIZED_DEVICE_PROFILE_OPTIONS.find(option => option.value === formState.serializedDeviceProfile)?.label || serializedVariantIdentifierLabel}
                          readOnly
                          style={{ background: 'var(--surface)', cursor: 'not-allowed', opacity: 0.9 }}
                        />
                      </div>
                      <div>
                        <label>Gestión de stock</label>
                        <input value="Compras y ajustes de inventario" readOnly style={{ background: 'var(--surface)', cursor: 'not-allowed', opacity: 0.9 }} />
                      </div>
                    </div>
                    {editTarget && (
                      <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                        <button type="button" className="small-btn" onClick={() => void openVariantEditor(editTarget)}>
                          Abrir dialogo de variantes
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button onClick={() => { setShowCreate(false); setEditTarget(null); setShowSerializedVariantProfileSelector(false) }} disabled={loading} style={{ padding: '10px 16px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}>
                Cancelar
              </button>
              <button className="primary" onClick={() => (editTarget ? saveEdit() : saveCreate())} disabled={loading} style={{ padding: '10px 18px', borderRadius: 12 }}>
                {editTarget ? 'Guardar cambios' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showVariantEditor && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="responsive-modal" style={{ width: 920, maxWidth: '94vw', background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 24, padding: 20, maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 24px 60px rgba(15, 23, 42, 0.22)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, gap: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 24 }}>Variantes del producto</h3>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                  {variantEditorTarget?.name || formState.name} • Tipo base {serializedVariantIdentifierLabel}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, padding: '7px 12px', borderRadius: 999, border: '1px solid rgba(37,99,235,0.22)', background: '#eff6ff', color: '#1d4ed8', fontWeight: 800 }}>
                  {SERIALIZED_DEVICE_PROFILE_OPTIONS.find(option => option.value === formState.serializedDeviceProfile)?.label || serializedVariantIdentifierLabel}
                </span>
                <button
                  onClick={closeVariantEditor}
                  style={{ width: 38, height: 38, borderRadius: 999, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
                  aria-label="Cerrar dialogo de variantes"
                  title="Cerrar"
                >
                  ×
                </button>
              </div>
            </div>

            <div style={{ border: '1px solid var(--border)', borderRadius: 20, padding: 16, background: 'var(--modal)', display: 'grid', gap: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>Gestión de variantes</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                    Agrega las combinaciones comerciales del producto maestro. Las unidades con {serializedVariantIdentifierLabel === 'IMEI' ? 'IMEI' : 'numero de serie'} se seguirán registrando desde Compras o Ajustes.
                  </div>
                </div>
                <button type="button" className="small-btn" onClick={addSerializedVariant}>
                  Agregar variante
                </button>
              </div>

              <div style={{ padding: 12, background: '#eff6ff', borderRadius: 14, fontSize: 13, color: '#1e40af' }}>
                {formState.serializedDeviceProfile === 'PHONE_IMEI'
                  ? <>Este producto trabaja con <strong>IMEI</strong>. Se habilitan <strong>compañia</strong> y <strong>tipo de SIM</strong> en cada variante.</>
                  : <>Este producto trabaja con <strong>SERIE</strong>. Se ocultan <strong>compañia</strong> y <strong>SIM</strong> para no mezclar atributos de telefonía.</>}
              </div>

              {formState.variants.length === 0 && (
                <div style={{ padding: 14, borderRadius: 14, border: '1px dashed var(--border)', color: 'var(--muted)', fontSize: 13 }}>
                  Aún no hay variantes. Usa el botón <strong>Agregar variante</strong> para registrar la primera.
                </div>
              )}

              {formState.variants.map((variant, variantIndex) => (
                <div key={`variant-dialog-${variantIndex}`} style={{ border: '1px solid var(--border)', borderRadius: 18, padding: 14, background: 'var(--bg)', display: 'grid', gap: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>
                        Variante {variantIndex + 1}: {buildSerializedVariantLabel(variant)}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                        Define la combinacion comercial y los atributos permitidos para {formatSerializedDeviceProfileLabel(formState.serializedDeviceProfile).toLowerCase()}.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeSerializedVariant(variantIndex)}
                      style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(239,68,68,0.28)', background: 'rgba(239,68,68,0.08)', color: '#b91c1c' }}
                    >
                      Quitar variante
                    </button>
                  </div>

                  <div className="responsive-form-grid">
                    <div>
                      <label>Nombre visible</label>
                      <input value={variant.name} onChange={e => onVariantChange(variantIndex, 'name', e.target.value)} placeholder="Ej. Negro / 8GB / 256GB" />
                    </div>
                    <div>
                      <label>SKU de variante</label>
                      <input value={variant.sku} onChange={e => onVariantChange(variantIndex, 'sku', e.target.value)} placeholder="SKU opcional" />
                    </div>
                    <div>
                      <label>Color</label>
                      <input value={variant.color} onChange={e => onVariantChange(variantIndex, 'color', e.target.value)} />
                    </div>
                    <div>
                      <label>RAM</label>
                      <input value={variant.ram} onChange={e => onVariantChange(variantIndex, 'ram', e.target.value)} placeholder="Ej. 8 GB" />
                    </div>
                    <div>
                      <label>Almacenamiento</label>
                      <input value={variant.storage} onChange={e => onVariantChange(variantIndex, 'storage', e.target.value)} placeholder="Ej. 256 GB" />
                    </div>
                    {formState.serializedDeviceProfile === 'PHONE_IMEI' && (
                      <>
                        <div>
                          <label>Compañía</label>
                          <input value={variant.carrier} onChange={e => onVariantChange(variantIndex, 'carrier', e.target.value)} placeholder="Ej. Claro, Tigo, Liberado" />
                        </div>
                        <div>
                          <label>Tipo SIM</label>
                          <select value={variant.simType} onChange={e => onVariantChange(variantIndex, 'simType', e.target.value)}>
                            <option value="">No aplica</option>
                            <option value="UNA SIM">Una SIM</option>
                            <option value="DOBLE SIM">Doble SIM</option>
                          </select>
                        </div>
                      </>
                    )}
                    <div>
                      <label>Identificador principal</label>
                      <input value={serializedVariantIdentifierLabel} readOnly style={{ background: 'var(--surface)', cursor: 'not-allowed' }} />
                    </div>
                    <div>
                      <label>Precio de variante</label>
                      <input type="number" min="0" step="0.01" value={variant.price} onChange={e => onVariantChange(variantIndex, 'price', e.target.value)} />
                    </div>
                    <div>
                      <label>Costo de variante</label>
                      <input type="number" min="0" step="0.01" value={variant.cost} onChange={e => onVariantChange(variantIndex, 'cost', e.target.value)} />
                    </div>
                    <div>
                      <label>Orden</label>
                      <input type="number" min="0" step="1" value={variant.sortOrder} onChange={e => onVariantChange(variantIndex, 'sortOrder', e.target.value)} />
                    </div>
                    <div>
                      <label>Código de modelo</label>
                      <input value={variant.meta.modelCode} onChange={e => onVariantMetaChange(variantIndex, 'modelCode', e.target.value)} placeholder="Ej. A17-4G-256" />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label>Notas de variante</label>
                      <input value={variant.meta.notes} onChange={e => onVariantMetaChange(variantIndex, 'notes', e.target.value)} placeholder="Observaciones comerciales o técnicas" />
                    </div>
                  </div>
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, fontSize: 13, color: '#1e40af', background: '#eff6ff', borderRadius: 14, padding: 12 }}>
                    Los {serializedVariantIdentifierLabel === 'IMEI' ? 'IMEI' : 'numeros de serie'} de esta variante se registran desde <strong>Compras</strong> o <strong>Ajustes de Stock</strong> cuando ingresa inventario real.
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button onClick={closeVariantEditor} disabled={loading} style={{ padding: '10px 16px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}>
                Cerrar
              </button>
              <button className="primary" onClick={() => void saveVariantEditor()} disabled={loading} style={{ padding: '10px 18px', borderRadius: 12 }}>
                Guardar variantes
              </button>
            </div>
          </div>
        </div>
      )}

      {quickAddModal !== 'none' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1001 }}>
          <div className="responsive-modal" style={{ width: 420, background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
            <h3 style={{ margin: 0, marginBottom: 12 }}>
              {quickAddModal === 'unit' ? 'Nueva unidad' 
                : quickAddModal === 'brand' ? 'Nueva marca' 
                : quickAddModal === 'supplier' ? 'Nuevo proveedor' 
                : quickAddModal === 'subcategory' ? 'Nueva subcategoría' 
                : quickAddModal === 'department' ? 'Nuevo departamento'
                : 'Nueva categoría general'}
            </h3>

            {quickAddModal === 'unit' && (
              <>
                <input placeholder="Código (ej: KG, LT, PZ)" value={newUnitCode} onChange={e => setNewUnitCode(e.target.value)} />
                <input placeholder="Nombre (ej: Kilogramo, Litro, Pieza)" value={newUnitName} onChange={e => setNewUnitName(e.target.value)} />
              </>
            )}

            {quickAddModal === 'brand' && (
              <>
                <input placeholder="Nombre" value={newBrandName} onChange={e => setNewBrandName(e.target.value)} />
              </>
            )}

            {quickAddModal === 'supplier' && (
              <>
                <input placeholder="Nombre" value={newSupplierName} onChange={e => setNewSupplierName(e.target.value)} />
              </>
            )}

            {quickAddModal === 'category' && (
              <>
                <input placeholder="Nombre" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} />
              </>
            )}

            {quickAddModal === 'subcategory' && (
              <>
                <input placeholder="Nombre" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} />
              </>
            )}

            {quickAddModal === 'department' && (
              <>
                <input placeholder="Nombre" value={newDepartmentName} onChange={e => setNewDepartmentName(e.target.value)} />
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button onClick={() => { setQuickAddModal('none'); setNewUnitCode(''); setNewUnitName(''); setNewBrandName(''); setNewSupplierName(''); setNewCategoryName(''); setNewDepartmentName(''); }} disabled={savingQuickAdd}>Cancelar</button>
              <button className="primary" onClick={() => {
                if (quickAddModal === 'unit') createUnitQuick();
                else if (quickAddModal === 'brand') createBrandQuick();
                else if (quickAddModal === 'supplier') createSupplierQuick();
                else if (quickAddModal === 'subcategory') createSubcategoryQuick();
                else if (quickAddModal === 'department') createDepartmentQuick();
                else createCategoryQuick();
              }} disabled={savingQuickAdd}>{savingQuickAdd ? 'Guardando...' : 'Crear'}</button>
            </div>
          </div>
        </div>
      )}

      {showDetails && (
        <>
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="responsive-detail-modal" style={{ width: 760, maxWidth: '92vw', maxHeight: '86vh', overflowY: 'auto', background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 22, padding: 18, boxShadow: '0 20px 54px rgba(15, 23, 42, 0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 22 }}>Detalle de producto</h3>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                  Vista resumida de informacion comercial e inventario.
                </div>
              </div>
              <button
                onClick={() => { setShowDetails(false); setDetails(null); setDetailsError(null); }}
                style={{ width: 38, height: 38, borderRadius: 999, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
                aria-label="Cerrar detalle"
                title="Cerrar"
              >
                ×
              </button>
            </div>
            {detailsLoading && <div>Cargando detalles...</div>}
            {detailsError && <div style={{ color: '#ef4444' }}>{detailsError}</div>}
            {!detailsLoading && !detailsError && details && (
                <div style={{ display: 'grid', gap: 10 }}>
                  <div className="responsive-two-col" style={{ alignItems: 'stretch' }}>
                    <div style={{ background: 'linear-gradient(180deg, var(--bg), var(--surface))', border: '1px solid var(--border)', borderRadius: 20, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div
                        role="button"
                        tabIndex={0}
                        title="Ver galeria ampliada"
                        aria-label={`Ver galeria ampliada de ${details.name}`}
                        onClick={() => openImageViewer(details, details.imageUrl || 'https://via.placeholder.com/800x800?text=IMG')}
                        onKeyDown={e => { if (e.key === 'Enter') openImageViewer(details, details.imageUrl || 'https://via.placeholder.com/800x800?text=IMG') }}
                        style={{ width: '100%', height: 190, borderRadius: 16, overflow: 'hidden', background: 'var(--bg)', border: '1px solid var(--border)', cursor: 'zoom-in' }}
                      >
                        <img src={details.imageUrl || 'https://via.placeholder.com/800x800?text=IMG'} alt={details.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        <span style={{ fontSize: 10, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 999, background: 'var(--modal)' }}>
                          {formatProductTypeLabel(details.productType)}
                        </span>
                        <span style={{ fontSize: 10, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 999, background: 'var(--modal)' }}>
                          {resolveUnitName(unitNameByCode, details.unit)}
                        </span>
                      </div>
                      <div style={{ padding: 10, borderRadius: 14, background: 'var(--modal)', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>SKU</div>
                        <div style={{ fontWeight: 700, fontSize: 13, color: '#60A5FA', wordBreak: 'break-word' }}>{details.sku || '—'}</div>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gap: 12 }}>
                      <div style={{ background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 20, padding: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                          <div>
                            <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.2, color: 'var(--text)', marginBottom: 6 }}>
                              {details.name}
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 10, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 999, background: 'var(--bg)' }}>
                                Cat: {detailsCatName ?? '—'}
                              </span>
                              <span style={{ fontSize: 10, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 999, background: 'var(--bg)' }}>
                                Sub: {detailsSubName ?? '—'}
                              </span>
                              <span style={{ fontSize: 10, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 999, background: 'var(--bg)' }}>
                                Dept: {detailsDeptName ?? '—'}
                              </span>
                            </div>
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              padding: '7px 10px',
                              borderRadius: 999,
                              ...(details.minStock !== undefined && details.minStock !== null
                                ? ((Number(details.stock ?? 0) < Number(details.minStock))
                                    ? { border: '1px solid #FCA5A5', background: '#FEE2E2', color: '#991B1B', fontWeight: 700 }
                                    : (Number(details.stock ?? 0) <= Number(details.minStock) * 1.2)
                                      ? { border: '1px solid #F59E0B', background: '#FEF3C7', color: '#92400E', fontWeight: 700 }
                                      : { border: '1px solid #34D399', background: '#ECFDF5', color: '#065F46', fontWeight: 700 })
                                : { border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontWeight: 700 })
                            }}
                          >
                            Stock actual: {details.stock ?? '—'}
                          </div>
                        </div>
                      </div>

                      <div className="responsive-three-col">
                        <div style={{ padding: 14, borderRadius: 16, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>Precio venta</div>
                          <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--text)' }}>{formatMoney(details.price ?? 0, currency)}</div>
                        </div>
                        {canViewSensitiveProductData && (
                        <div style={{ padding: 14, borderRadius: 16, background: 'rgba(245, 158, 11, 0.10)', border: '1px solid rgba(245, 158, 11, 0.22)' }}>
                          <div style={{ fontSize: 11, color: '#92400E', marginBottom: 6 }}>Costo</div>
                          <div style={{ fontWeight: 800, fontSize: 17, color: '#92400E' }}>{formatMoney(details.cost ?? 0, currency)}</div>
                          <button
                            type="button"
                            onClick={() => void openCostHistory(details)}
                            style={{ marginTop: 10, padding: '7px 10px', borderRadius: 10, border: '1px solid rgba(245, 158, 11, 0.32)', background: 'rgba(255,255,255,0.75)', color: '#92400E', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                          >
                            Historial de costos
                          </button>
                        </div>
                        )}
                        <div style={{ padding: 14, borderRadius: 16, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>Stock minimo</div>
                          <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--text)' }}>{details.minStock ?? '—'}</div>
                        </div>
                      </div>

                      <div className="responsive-three-col">
                        <div style={{ padding: 12, borderRadius: 16, background: 'var(--modal)', border: '1px solid var(--border)' }}>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Precio 2</div>
                          <div style={{ fontWeight: 700, fontSize: 16 }}>{formatMoney(details.price2 ?? 0, currency)}</div>
                        </div>
                        <div style={{ padding: 12, borderRadius: 16, background: 'var(--modal)', border: '1px solid var(--border)' }}>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Precio 3</div>
                          <div style={{ fontWeight: 700, fontSize: 16 }}>{formatMoney(details.price3 ?? 0, currency)}</div>
                        </div>
                        <div style={{ padding: 12, borderRadius: 16, background: 'var(--modal)', border: '1px solid var(--border)' }}>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Stock inicial</div>
                          <div style={{ fontWeight: 700, fontSize: 16 }}>{details.initialStock ?? '—'}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                    <div style={{ gridColumn: '1 / -1', marginTop: 2, background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 20, padding: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                        <div>
                          <div style={{ fontWeight: 700 }}>Stock por almacen</div>
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Distribucion actual del inventario</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 12, padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 999, background: 'var(--bg)', opacity: 0.8 }}>
                            Total: {warehouseTotal}
                          </span>
                          <button onClick={() => setShowWarehouseStock(v => !v)} style={{ fontSize: 12, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}>
                            {showWarehouseStock ? 'Ocultar' : 'Mostrar'}
                          </button>
                          <button onClick={refreshWarehouseStock} style={{ fontSize: 12, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}>
                            Refrescar
                          </button>
                        </div>
                      </div>

                      {warehouseStock.length === 0 ? (
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>Sin registro por almacén</div>
                      ) : showWarehouseStock ? (
                        <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 14 }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr>
                                <th style={{ textAlign: 'left', borderBottom: '1px solid var(--border)', padding: '6px 8px', position: 'sticky', top: 0, background: 'var(--modal)' }}>Almacén</th>
                                <th style={{ textAlign: 'right', borderBottom: '1px solid var(--border)', padding: '6px 8px', position: 'sticky', top: 0, background: 'var(--modal)' }}>Cantidad</th>
                              </tr>
                            </thead>
                            <tbody>
                              {warehouseStock.map(ws => (
                                <tr key={ws.warehouseId}>
                                  <td style={{ padding: '6px 8px' }}><span className="warehouse-highlight" style={getWarehouseHighlightStyle(ws.warehouseName)}>{ws.warehouseName}</span></td>
                                  <td style={{ padding: '6px 8px', textAlign: 'right', ...(Number(ws.quantity) === 0 ? { color: '#991B1B', background: '#FEE2E2' } : {}) }}>{ws.quantity}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, color: '#64748b' }}>Sección oculta</div>
                      )}


                    </div>
                    
                    <div style={{ gridColumn: '1 / -1', border: '1px solid var(--border)', borderRadius: 20, padding: 16, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginTop: 2, background: 'var(--modal)' }}>
                      <div style={{ padding: 12, borderRadius: 14, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Codigo de producto</div>
                        <div style={{ fontWeight: 700 }}>{details.productCode || '—'}</div>
                      </div>
                      <div style={{ padding: 12, borderRadius: 14, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Marca</div>
                        <div style={{ fontWeight: 700 }}>{details.brandId ? (brandMap[details.brandId] || '-') : '-'}</div>
                      </div>
                      {canViewSensitiveProductData && (
                        <div style={{ padding: 12, borderRadius: 14, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Proveedor</div>
                          <div style={{ fontWeight: 700 }}>{details.supplierId ? (supplierMap[details.supplierId] || '-') : '-'}</div>
                        </div>
                      )}
                      <div style={{ padding: 12, borderRadius: 14, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Ubicacion</div>
                        <div style={{ fontWeight: 700 }}>{details.shelfLocation || '—'}</div>
                      </div>
                      {String(details.productType || 'GENERAL').toUpperCase() === 'MEDICINAL' && (
                        <div style={{ padding: 12, borderRadius: 14, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Perfil lote/vencimiento</div>
                          <div style={{ fontWeight: 700 }}>{formatTrackingProfileLabel(details.trackingProfile)}</div>
                        </div>
                      )}
                      {details.altName && (
                        <div style={{ padding: 12, borderRadius: 14, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Nombre alternativo</div>
                          <div style={{ fontWeight: 700 }}>{details.altName}</div>
                        </div>
                      )}
                      {details.genericName && (
                        <div style={{ padding: 12, borderRadius: 14, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Nombre generico</div>
                          <div style={{ fontWeight: 700 }}>{details.genericName}</div>
                        </div>
                      )}
                    </div>

                    {String(details.productType || 'GENERAL').toUpperCase() === 'MEDICINAL' && (
                      <div style={{ gridColumn: '1 / -1', border: '1px solid var(--border)', borderRadius: 20, padding: 16, background: 'var(--modal)' }}>
                        <div style={{ fontWeight: 700, marginBottom: 12 }}>Datos base por rubro</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                          {details.trackingProfile === 'MEDICAMENTO' && details.genericName && (
                            <div style={{ padding: 12, borderRadius: 14, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Nombre generico</div>
                              <div style={{ fontWeight: 700 }}>{details.genericName}</div>
                            </div>
                          )}
                          {details.trackingMeta?.activeIngredient && (
                            <div style={{ padding: 12, borderRadius: 14, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Principio activo</div>
                              <div style={{ fontWeight: 700 }}>{details.trackingMeta.activeIngredient}</div>
                            </div>
                          )}
                          {details.trackingMeta?.concentration && (
                            <div style={{ padding: 12, borderRadius: 14, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Concentración</div>
                              <div style={{ fontWeight: 700 }}>{details.trackingMeta.concentration}</div>
                            </div>
                          )}
                          {details.trackingMeta?.dosageForm && (
                            <div style={{ padding: 12, borderRadius: 14, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Forma farmacéutica</div>
                              <div style={{ fontWeight: 700 }}>{details.trackingMeta.dosageForm}</div>
                            </div>
                          )}
                          {details.trackingMeta?.sanitaryRegistry && (
                            <div style={{ padding: 12, borderRadius: 14, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Registro sanitario</div>
                              <div style={{ fontWeight: 700 }}>{details.trackingMeta.sanitaryRegistry}</div>
                            </div>
                          )}
                          {details.trackingMeta?.presentation && (
                            <div style={{ padding: 12, borderRadius: 14, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Presentación</div>
                              <div style={{ fontWeight: 700 }}>{details.trackingMeta.presentation}</div>
                            </div>
                          )}
                          {details.trackingMeta?.packageType && (
                            <div style={{ padding: 12, borderRadius: 14, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Empaque</div>
                              <div style={{ fontWeight: 700 }}>{details.trackingMeta.packageType}</div>
                            </div>
                          )}
                          {details.trackingMeta?.originInfo && (
                            <div style={{ padding: 12, borderRadius: 14, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Origen o línea</div>
                              <div style={{ fontWeight: 700 }}>{details.trackingMeta.originInfo}</div>
                            </div>
                          )}
                          {details.trackingMeta?.storageNotes && (
                            <div style={{ padding: 12, borderRadius: 14, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Almacenamiento</div>
                              <div style={{ fontWeight: 700 }}>{details.trackingMeta.storageNotes}</div>
                            </div>
                          )}
                          {details.trackingMeta?.regulatoryNotes && (
                            <div style={{ gridColumn: '1 / -1', padding: 12, borderRadius: 14, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Notas regulatorias</div>
                              <div style={{ fontWeight: 700 }}>{details.trackingMeta.regulatoryNotes}</div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {details.description && (
                      <div style={{ gridColumn: '1 / -1', border: '1px solid var(--border)', borderRadius: 20, padding: 16, background: 'var(--modal)' }}>
                        <div style={{ fontWeight: 700, marginBottom: 8 }}>Descripcion</div>
                        <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text)' }}>{details.description}</div>
                      </div>
                    )}

                    {String(details.productType || 'GENERAL').toUpperCase() === 'MEDICINAL' && (
                      <div style={{ gridColumn: '1 / -1', border: '1px solid var(--border)', borderRadius: 20, padding: 16, background: 'var(--modal)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <strong>Lotes</strong>
                          <button
                            onClick={() => setShowBatches(v => !v)}
                            style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, background: showBatches ? 'var(--surface-hover)' : 'var(--bg)', color: showBatches ? '#fff' : 'var(--text)', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                          >
                            <svg viewBox="0 0 24 24" width="12" height="12" style={{ transform: showBatches ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                              <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            {showBatches ? 'Ocultar' : 'Ver'} ({details.batches?.length ?? 0})
                          </button>
                        </div>
                        {showBatches && (
                          <>
                            {(!details.batches || details.batches.length === 0) && (
                              <div style={{ fontSize: 12, color: '#94a3b8' }}>Sin lotes</div>
                            )}
                            {details.batches?.map((b: any, idx: number) => (
                              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 0.8fr', gap: 8, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                                <div><span style={{ opacity: 0.8 }}>Lote:</span> {b.batchNo || b.batch_no || '-'}</div>
                                <div><span style={{ opacity: 0.8 }}>Vence:</span> {b.expiryDate || b.expiry_date || '-'}</div>
                                <div><span style={{ opacity: 0.8 }}>Cantidad:</span> {b.quantity ?? '-'}</div>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    )}

                    {String(details.productType || 'GENERAL').toUpperCase() === 'IMEI' && (
                      <div style={{ gridColumn: '1 / -1', border: '1px solid var(--border)', borderRadius: 20, padding: 16, background: 'var(--modal)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <strong>IMEIs</strong>
                          <button
                            onClick={() => setShowImeis(v => !v)}
                            style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, background: showImeis ? 'var(--surface-hover)' : 'var(--bg)', color: showImeis ? '#fff' : 'var(--text)', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                          >
                            <svg viewBox="0 0 24 24" width="12" height="12" style={{ transform: showImeis ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                              <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            {showImeis ? 'Ocultar' : 'Ver'} ({detailImeis.length})
                          </button>
                        </div>
                        {showImeis && (
                          <>
                            {detailImeis.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8' }}>Sin IMEIs disponibles</div>}
                            {detailImeis.map((im, idx: number) => (
                              <div key={`${im.value}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                                <div style={{ fontWeight: 700, wordBreak: 'break-word' }}>{im.value}</div>
                                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Almacen: <span className="warehouse-highlight" style={getWarehouseHighlightStyle(im.warehouseName)}>{im.warehouseName}</span></div>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    )}

                    {String(details.productType || 'GENERAL').toUpperCase() === 'SERIAL' && (
                      <div style={{ gridColumn: '1 / -1', border: '1px solid var(--border)', borderRadius: 20, padding: 16, background: 'var(--modal)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <strong>Series</strong>
                          <button
                            onClick={() => setShowSerials(v => !v)}
                            style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, background: showSerials ? 'var(--surface-hover)' : 'var(--bg)', color: showSerials ? '#fff' : 'var(--text)', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                          >
                            <svg viewBox="0 0 24 24" width="12" height="12" style={{ transform: showSerials ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                              <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            {showSerials ? 'Ocultar' : 'Ver'} ({detailSerials.length})
                          </button>
                        </div>
                        {showSerials && (
                          <>
                            {detailSerials.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8' }}>Sin series disponibles</div>}
                            {detailSerials.map((sr, idx: number) => (
                              <div key={`${sr.value}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                                <div style={{ fontWeight: 700, wordBreak: 'break-word' }}>{sr.value}</div>
                                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Almacen: <span className="warehouse-highlight" style={getWarehouseHighlightStyle(sr.warehouseName)}>{sr.warehouseName}</span></div>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    )}

                    {String(details.productType || 'GENERAL').toUpperCase() === 'VARIANT_SERIALIZED' && (
                      <div style={{ gridColumn: '1 / -1', border: '1px solid var(--border)', borderRadius: 20, padding: 16, background: 'var(--modal)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                          <div>
                            <strong>IMEI-SERIAL VARIANTE</strong>
                            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                              {detailVariants.length} variante{detailVariants.length === 1 ? '' : 's'} registradas
                            </div>
                          </div>
                          <button
                            onClick={() => setShowVariants(v => !v)}
                            style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, background: showVariants ? 'var(--surface-hover)' : 'var(--bg)', color: showVariants ? '#fff' : 'var(--text)', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                          >
                            <svg viewBox="0 0 24 24" width="12" height="12" style={{ transform: showVariants ? 'rotate(90deg)' : 'rotate(0deg)' }}>
                              <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            {showVariants ? 'Ocultar' : 'Ver'} ({detailVariants.reduce((sum: number, variant: any) => sum + Number(variant?.stock || 0), 0)} unidades)
                          </button>
                        </div>
                        {showVariants && (
                          <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
                            {detailVariants.length === 0 && (
                              <div style={{ fontSize: 12, color: '#94a3b8' }}>No hay variantes registradas.</div>
                            )}
                            {detailVariants.map((variant: any, variantIndex: number) => (
                              <div key={`detail-variant-${variant.id || variantIndex}`} style={{ border: '1px solid var(--border)', borderRadius: 16, padding: 14, background: 'var(--bg)', display: 'grid', gap: 10 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                  <div>
                                    <div style={{ fontWeight: 800 }}>{buildSerializedVariantLabel(variant)}</div>
                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                                      {variant.sku && (
                                        <span style={{ fontSize: 11, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 999, background: 'var(--modal)' }}>
                                          SKU: {variant.sku}
                                        </span>
                                      )}
                                      <span style={{ fontSize: 11, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 999, background: 'var(--modal)' }}>
                                        {formatSerializedDeviceProfileLabel(variant.meta?.deviceCategory || (variant.identifierMode === 'SERIAL' ? 'DEVICE_SERIAL' : 'PHONE_IMEI'))}
                                      </span>
                                      <span style={{ fontSize: 11, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 999, background: 'var(--modal)' }}>
                                        {variant.identifierMode === 'SERIAL' ? 'Serie' : 'IMEI'}
                                      </span>
                                      <span style={{ fontSize: 11, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 999, background: 'var(--modal)' }}>
                                        Stock: {variant.stock || 0}
                                      </span>
                                    </div>
                                  </div>
                                  <div style={{ display: 'grid', gap: 6, minWidth: 180 }}>
                                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Precio: <strong style={{ color: 'var(--text)' }}>{formatMoney(variant.price ?? 0, currency)}</strong></div>
                                    {canViewSensitiveProductData && (
                                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Costo: <strong style={{ color: 'var(--text)' }}>{formatMoney(variant.cost ?? 0, currency)}</strong></div>
                                    )}
                                  </div>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                                  {variant.color && <div style={{ padding: 10, borderRadius: 12, background: 'var(--modal)', border: '1px solid var(--border)' }}><div style={{ fontSize: 11, color: 'var(--muted)' }}>Color</div><div style={{ fontWeight: 700 }}>{variant.color}</div></div>}
                                  {variant.ram && <div style={{ padding: 10, borderRadius: 12, background: 'var(--modal)', border: '1px solid var(--border)' }}><div style={{ fontSize: 11, color: 'var(--muted)' }}>RAM</div><div style={{ fontWeight: 700 }}>{variant.ram}</div></div>}
                                  {variant.storage && <div style={{ padding: 10, borderRadius: 12, background: 'var(--modal)', border: '1px solid var(--border)' }}><div style={{ fontSize: 11, color: 'var(--muted)' }}>Almacenamiento</div><div style={{ fontWeight: 700 }}>{variant.storage}</div></div>}
                                  {variant.carrier && <div style={{ padding: 10, borderRadius: 12, background: 'var(--modal)', border: '1px solid var(--border)' }}><div style={{ fontSize: 11, color: 'var(--muted)' }}>Compañía</div><div style={{ fontWeight: 700 }}>{variant.carrier}</div></div>}
                                  {variant.simType && <div style={{ padding: 10, borderRadius: 12, background: 'var(--modal)', border: '1px solid var(--border)' }}><div style={{ fontSize: 11, color: 'var(--muted)' }}>SIM</div><div style={{ fontWeight: 700 }}>{variant.simType}</div></div>}
                                  {variant.meta?.modelCode && <div style={{ padding: 10, borderRadius: 12, background: 'var(--modal)', border: '1px solid var(--border)' }}><div style={{ fontSize: 11, color: 'var(--muted)' }}>Modelo</div><div style={{ fontWeight: 700 }}>{variant.meta.modelCode}</div></div>}
                                </div>

                                {variant.meta?.notes && (
                                  <div style={{ padding: 12, borderRadius: 14, background: 'var(--modal)', border: '1px solid var(--border)' }}>
                                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Notas de variante</div>
                                    <div style={{ fontWeight: 700 }}>{variant.meta.notes}</div>
                                  </div>
                                )}

                                <div style={{ display: 'grid', gap: 8 }}>
                                  <div style={{ fontWeight: 700 }}>Unidades registradas</div>
                                  {Array.isArray(variant.units) && variant.units.length > 0 ? (
                                    variant.units.map((unit: any, unitIndex: number) => (
                                      <div key={`detail-variant-${variant.id || variantIndex}-unit-${unit.id || unitIndex}`} style={{ display: 'grid', gap: 8, padding: 12, borderRadius: 14, background: 'var(--modal)', border: '1px solid var(--border)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                                          <div style={{ fontWeight: 700, wordBreak: 'break-word' }}>
                                            {variant.identifierMode === 'SERIAL' ? (unit.serialNo || 'Sin serie') : (unit.imei || 'Sin IMEI')}
                                          </div>
                                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                                            Almacén: <span className="warehouse-highlight" style={getWarehouseHighlightStyle(unit.warehouseName || 'Sin almacén')}>{unit.warehouseName || 'Sin almacén'}</span>
                                          </div>
                                        </div>
                                        {(unit.meta?.supplierName || unit.meta?.purchaseReference || unit.meta?.notes) && (
                                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
                                            {unit.meta?.supplierName && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Proveedor: <strong style={{ color: 'var(--text)' }}>{unit.meta.supplierName}</strong></div>}
                                            {unit.meta?.purchaseReference && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Referencia: <strong style={{ color: 'var(--text)' }}>{unit.meta.purchaseReference}</strong></div>}
                                            {unit.meta?.notes && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Notas: <strong style={{ color: 'var(--text)' }}>{unit.meta.notes}</strong></div>}
                                          </div>
                                        )}
                                      </div>
                                    ))
                                  ) : (
                                    <div style={{ fontSize: 12, color: '#94a3b8' }}>Sin unidades registradas.</div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                      <button onClick={() => { setShowDetails(false); setDetails(null); setDetailsError(null); }} style={{ padding: '10px 16px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}>Cerrar</button>
                    </div>
                  </div>
              )}
            </div>
          </div>
        </>
      )}

      {catalogStockProduct && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: 16 }}
          onClick={() => {
            setCatalogStockProduct(null)
            setCatalogStockError(null)
            setCatalogWarehouseStock([])
            setCatalogVariantSummaries([])
            setCatalogSerials([])
            setShowCatalogSerials(false)
          }}
        >
          <div
            style={{ width: 560, maxWidth: '96vw', maxHeight: '85vh', overflowY: 'auto', background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 22, padding: 18, boxShadow: '0 20px 54px rgba(15, 23, 42, 0.2)' }}
            onClick={event => event.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 22 }}>Existencias por tienda</h3>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                  {catalogStockProduct.name}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCatalogStockProduct(null)
                  setCatalogStockError(null)
                  setCatalogWarehouseStock([])
                  setCatalogVariantSummaries([])
                  setCatalogSerials([])
                  setShowCatalogSerials(false)
                }}
                style={{ width: 38, height: 38, borderRadius: 999, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
                aria-label="Cerrar existencias por tienda"
                title="Cerrar"
              >
                ×
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 14 }}>
              <div style={{ padding: 12, borderRadius: 14, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Tienda actual</div>
                <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--text)' }}>
                  {catalogCurrentWarehouseStock?.quantity ?? catalogStockProduct.stock ?? 0}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  <span className="warehouse-highlight current" style={getWarehouseHighlightStyle(user?.warehouseName || 'Tienda asignada', true)}>{user?.warehouseName || 'Tienda asignada'}</span>
                </div>
              </div>
              <div style={{ padding: 12, borderRadius: 14, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Otras tiendas</div>
                <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--text)' }}>{catalogOtherWarehouseTotal}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Existencia fuera de la tienda actual</div>
              </div>
            </div>

            {catalogStockLoading && <div style={{ color: 'var(--muted)' }}>Cargando existencias...</div>}
            {catalogStockError && <div style={{ color: '#ef4444' }}>{catalogStockError}</div>}

            {!catalogStockLoading && !catalogStockError && (
              <>
                {catalogWarehouseStock.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>No hay existencias registradas por tienda para este producto.</div>
                ) : (
                  <div style={{ display: 'grid', gap: 8 }}>
                    {catalogWarehouseStock.map(item => {
                      const isCurrentWarehouse = currentWarehouseId !== null && Number(item.warehouseId) === currentWarehouseId
                      return (
                        <div
                          key={item.warehouseId}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 12,
                            padding: '12px 14px',
                            borderRadius: 14,
                            border: `1px solid ${isCurrentWarehouse ? 'rgba(37, 99, 235, 0.28)' : 'var(--border)'}`,
                            background: isCurrentWarehouse ? 'rgba(37, 99, 235, 0.08)' : 'var(--bg)'
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 700, color: 'var(--text)' }}>
                              <span className={`warehouse-highlight${isCurrentWarehouse ? ' current' : ''}`} style={getWarehouseHighlightStyle(item.warehouseName, isCurrentWarehouse)}>{item.warehouseName}</span>
                              {isCurrentWarehouse && (
                                <span style={{ marginLeft: 8, fontSize: 11, color: '#2563eb' }}>(Actual)</span>
                              )}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                              {Number(item.quantity || 0) > 0 ? 'Con existencia disponible' : 'Sin existencia disponible'}
                            </div>
                          </div>
                          <div style={{ fontWeight: 800, fontSize: 18, color: Number(item.quantity || 0) > 0 ? '#059669' : '#dc2626' }}>
                            {item.quantity}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {canShowCatalogVariantSummary && (
                  <div
                    style={{
                      marginTop: 14,
                      border: '1px solid rgba(37, 99, 235, 0.18)',
                      borderRadius: 16,
                      background: 'var(--bg)',
                      padding: 14,
                      display: 'grid',
                      gap: 10
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontWeight: 800, color: 'var(--text)' }}>Resumen de variantes</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                          {catalogVariantSummaries.length} variante{catalogVariantSummaries.length === 1 ? '' : 's'} registradas
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: '#2563eb', fontWeight: 700 }}>
                        {catalogVariantSummaries.reduce((sum, variant) => sum + Number(variant?.stock || 0), 0)} unidades
                      </div>
                    </div>

                    {catalogVariantSummaries.length === 0 ? (
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>No hay variantes registradas para este producto.</div>
                    ) : (
                      <div style={{ display: 'grid', gap: 8 }}>
                        {catalogVariantSummaries.map((variant, index) => (
                          <div
                            key={`catalog-variant-summary-${variant.id || index}`}
                            style={{
                              padding: '12px 14px',
                              borderRadius: 14,
                              border: '1px solid var(--border)',
                              background: 'var(--modal)',
                              display: 'grid',
                              gap: 8
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                              <div>
                                <div style={{ fontWeight: 800, color: 'var(--text)' }}>{buildSerializedVariantLabel(variant)}</div>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                                  {variant.sku && (
                                    <span style={{ fontSize: 11, padding: '4px 8px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--bg)' }}>
                                      SKU: {variant.sku}
                                    </span>
                                  )}
                                  <span style={{ fontSize: 11, padding: '4px 8px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--bg)' }}>
                                    {variant.identifierMode === 'SERIAL' ? 'Serie' : 'IMEI'}
                                  </span>
                                </div>
                              </div>
                              <div style={{ fontWeight: 800, color: Number(variant?.stock || 0) > 0 ? '#059669' : '#dc2626' }}>
                                Stock: {Number(variant?.stock || 0)}
                              </div>
                            </div>

                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              {variant.color && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Color: <strong style={{ color: 'var(--text)' }}>{variant.color}</strong></span>}
                              {variant.ram && <span style={{ fontSize: 12, color: 'var(--muted)' }}>RAM: <strong style={{ color: 'var(--text)' }}>{variant.ram}</strong></span>}
                              {variant.storage && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Almacenamiento: <strong style={{ color: 'var(--text)' }}>{variant.storage}</strong></span>}
                              {variant.carrier && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Compañía: <strong style={{ color: 'var(--text)' }}>{variant.carrier}</strong></span>}
                              {variant.simType && <span style={{ fontSize: 12, color: 'var(--muted)' }}>SIM: <strong style={{ color: 'var(--text)' }}>{variant.simType}</strong></span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {canShowCatalogSerials && (
                  <div
                    style={{
                      marginTop: 14,
                      border: `1px solid ${showCatalogSerials ? 'rgba(37, 99, 235, 0.42)' : 'rgba(37, 99, 235, 0.28)'}`,
                      borderRadius: 16,
                      background: showCatalogSerials ? 'rgba(37, 99, 235, 0.05)' : 'var(--bg)',
                      boxShadow: showCatalogSerials ? '0 10px 24px rgba(37, 99, 235, 0.08)' : 'none',
                      overflow: 'hidden'
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setShowCatalogSerials(prev => !prev)}
                      style={{
                        width: '100%',
                        padding: '12px 14px',
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--text)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        cursor: 'pointer',
                        fontWeight: 700
                      }}
                    >
                      <span style={{ color: showCatalogSerials ? '#1d4ed8' : 'var(--text)' }}>Numeros de serie</span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 12 }}>
                        {catalogSerials.length}
                        <span style={{ transform: showCatalogSerials ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 180ms ease', display: 'inline-block' }}>▸</span>
                      </span>
                    </button>

                    {showCatalogSerials && (
                      <div style={{ borderTop: '1px solid rgba(37, 99, 235, 0.24)', padding: 14, display: 'grid', gap: 8 }}>
                        {catalogSerials.length === 0 ? (
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>No hay numeros de serie disponibles.</div>
                        ) : (
                          catalogSerials.map((serial, idx) => (
                            <div
                              key={`${serial.value}-${idx}`}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: 12,
                                padding: '10px 12px',
                                borderRadius: 12,
                                border: '1px solid rgba(37, 99, 235, 0.18)',
                                background: 'var(--modal)',
                                flexWrap: 'wrap'
                              }}
                            >
                              <div
                                style={{
                                  fontWeight: 800,
                                  color: '#1d4ed8',
                                  background: 'rgba(37, 99, 235, 0.10)',
                                  border: '1px solid rgba(37, 99, 235, 0.22)',
                                  borderRadius: 10,
                                  padding: '6px 10px',
                                  wordBreak: 'break-word',
                                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                                  letterSpacing: '0.03em'
                                }}
                              >
                                {serial.value}
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Almacen: <span className="warehouse-highlight" style={getWarehouseHighlightStyle(serial.warehouseName)}>{serial.warehouseName}</span></div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}

                {currentWarehouseId !== null && !catalogCurrentWarehouseStock && (
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>
                    La tienda actual no apareció en el desglose devuelto por el servidor.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {costHistoryProduct && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1250, padding: 16 }}
          onClick={closeCostHistory}
        >
          <div
            style={{ width: 760, maxWidth: '96vw', maxHeight: '88vh', overflowY: 'auto', background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 22, padding: 18, boxShadow: '0 20px 54px rgba(15, 23, 42, 0.22)' }}
            onClick={event => event.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 22 }}>Historial de costos</h3>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                  {costHistoryProduct.name} {costHistoryProduct.productCode ? `• ${costHistoryProduct.productCode}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={closeCostHistory}
                style={{ width: 38, height: 38, borderRadius: 999, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
                aria-label="Cerrar historial de costos"
                title="Cerrar"
              >
                ×
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
              <div style={{ padding: 12, borderRadius: 14, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Costo actual</div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>{formatMoney(costHistoryProduct.cost ?? 0, currency)}</div>
              </div>
              <div style={{ padding: 12, borderRadius: 14, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Costo ponderado</div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>{formatMoney(costHistoryProduct.avgCost ?? costHistoryProduct.cost ?? 0, currency)}</div>
              </div>
              <div style={{ padding: 12, borderRadius: 14, background: 'rgba(245, 158, 11, 0.10)', border: '1px solid rgba(245, 158, 11, 0.25)' }}>
                <div style={{ fontSize: 11, color: '#92400E', marginBottom: 4 }}>Ultimo costo</div>
                <div style={{ fontWeight: 800, fontSize: 18, color: '#92400E' }}>{formatMoney(costHistoryProduct.lastCost ?? costHistoryProduct.cost ?? 0, currency)}</div>
              </div>
              <div style={{ padding: 12, borderRadius: 14, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Compras registradas</div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>{costHistoryRows.length}</div>
              </div>
            </div>

            {costHistoryLoading && <div style={{ color: 'var(--muted)' }}>Cargando historial de costos...</div>}
            {costHistoryError && <div style={{ color: '#dc2626', marginBottom: 8 }}>{costHistoryError}</div>}

            {!costHistoryLoading && !costHistoryError && (
              <>
                {costHistoryRows.length === 0 ? (
                  <div style={{ padding: 18, borderRadius: 14, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--muted)' }}>
                    No hay compras registradas para este producto.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 10 }}>
                    {costHistoryRows.map(row => (
                      <div
                        key={`${row.purchaseId}-${row.createdAt}-${row.unitCost}`}
                        style={{ padding: 14, borderRadius: 16, border: '1px solid var(--border)', background: 'linear-gradient(180deg, var(--bg), var(--modal))', display: 'grid', gap: 10 }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                          <div>
                            <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>{row.purchaseNumber}</div>
                            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                              {formatCostHistoryDate(row.createdAt)}
                            </div>
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                            {row.warehouseName ? <span className="warehouse-highlight" style={getWarehouseHighlightStyle(row.warehouseName)}>{row.warehouseName}</span> : 'Sin tienda'}
                          </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
                          <div style={{ padding: 10, borderRadius: 12, background: 'var(--modal)', border: '1px solid var(--border)' }}>
                            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Cantidad</div>
                            <div style={{ fontWeight: 700 }}>{row.quantity}</div>
                          </div>
                          <div style={{ padding: 10, borderRadius: 12, background: 'var(--modal)', border: '1px solid var(--border)' }}>
                            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Costo unitario</div>
                            <div style={{ fontWeight: 700, color: '#92400E' }}>{formatMoney(row.unitCost, currency)}</div>
                          </div>
                          <div style={{ padding: 10, borderRadius: 12, background: 'var(--modal)', border: '1px solid var(--border)' }}>
                            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Total compra</div>
                            <div style={{ fontWeight: 700 }}>{formatMoney(row.totalCost, currency)}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {deleteTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 420, background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
            <h3 style={{ margin: 0, marginBottom: 12 }}>Confirmar eliminación</h3>
            <div style={{ marginBottom: 12 }}>
              Esta acción eliminará el producto <strong>{deleteTarget.name}</strong> de forma permanente. ¿Confirmar?
            </div>
            <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'rgba(245, 158, 11, 0.12)', color: 'var(--text)' }}>
              Solo se puede eliminar un producto cuando su stock esté en <strong>0</strong>.
              Stock actual: <strong>{Number(deleteTarget.stock || 0)}</strong>.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setDeleteTarget(null)} disabled={loading}>Cancelar</button>
              <button className="danger" onClick={confirmDelete} disabled={loading}>Eliminar</button>
            </div>
          </div>
        </div>
      )}
      <CatalogPdfModal
        open={showCatalogPdfModal}
        loading={catalogPdfLoading}
        generating={catalogPdfGenerating}
        progress={catalogPdfProgress}
        progressLabel={catalogPdfProgressLabel}
        error={catalogPdfError}
        departments={departments}
        categories={catalogPdfParentCategories}
        subcategories={catalogPdfSubcategories}
        brands={brands}
        selectedDepartmentId={catalogPdfDepartmentId}
        selectedCategoryId={catalogPdfCategoryId}
        selectedSubcategoryId={catalogPdfSubcategoryId}
        selectedBrandId={catalogPdfBrandId}
        title={catalogPdfTitle}
        subtitle={catalogPdfSubtitle}
        onlyWithImage={catalogPdfOnlyWithImage}
        products={catalogPdfVisibleProducts}
        selectedIds={catalogPdfSelectedIds}
        currency={currency}
        onClose={closeCatalogPdfBuilder}
        onChangeTitle={setCatalogPdfTitle}
        onChangeSubtitle={setCatalogPdfSubtitle}
        onToggleOnlyWithImage={setCatalogPdfOnlyWithImage}
        onChangeDepartmentId={handleCatalogPdfDepartmentChange}
        onChangeCategoryId={handleCatalogPdfCategoryChange}
        onChangeSubcategoryId={setCatalogPdfSubcategoryId}
        onChangeBrandId={setCatalogPdfBrandId}
        onResetFilters={resetCatalogPdfFilters}
        onToggleProduct={toggleCatalogPdfProduct}
        onSelectAll={selectAllCatalogPdfVisibleProducts}
        onClearSelection={clearCatalogPdfSelection}
        onGenerate={() => void generateCatalogPdfFile()}
      />
      {imageViewer && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setImageViewer(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ position: 'relative', width: 'min(1024px, 92vw)', maxHeight: '90vh', borderRadius: 20, background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.12)', padding: 18, display: 'grid', gap: 14 }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', color: '#fff' }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{imageViewer.name || 'Galeria de producto'}</div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>
                {imageViewer.activeIndex + 1} de {imageViewer.images.length}
              </div>
            </div>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320, width: '100%' }}>
              {imageViewer.images.length > 1 && (
                <button
                  type="button"
                  className="icon-btn"
                  title="Imagen anterior"
                  aria-label="Imagen anterior"
                  onClick={() => moveImageViewer(-1)}
                  style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.45)', color: '#fff', zIndex: 1 }}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18"><path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              )}
              <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 56px' }}>
                <img
                  src={imageViewer.images[imageViewer.activeIndex] || ''}
                  alt={imageViewer.name || 'Imagen de producto'}
                  style={{
                    display: 'block',
                    width: 'auto',
                    maxWidth: '100%',
                    maxHeight: '62vh',
                    borderRadius: 14,
                    objectFit: 'contain',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                    margin: '0 auto',
                  }}
                />
              </div>
              {imageViewer.images.length > 1 && (
                <button
                  type="button"
                  className="icon-btn"
                  title="Imagen siguiente"
                  aria-label="Imagen siguiente"
                  onClick={() => moveImageViewer(1)}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.45)', color: '#fff', zIndex: 1 }}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              )}
            </div>
            <div
              style={{
                display: 'grid',
                gap: 10,
                padding: '14px 16px',
                borderRadius: 16,
                background: 'linear-gradient(180deg, rgba(15,23,42,0.78), rgba(30,41,59,0.92))',
                border: '1px solid rgba(255,255,255,0.12)',
                color: '#f8fafc',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0, flex: '1 1 340px', display: 'grid', gap: 6 }}>
                  <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(191,219,254,0.92)', fontWeight: 700 }}>
                    Descripcion
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      lineHeight: 1.55,
                      color: 'rgba(248,250,252,0.96)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      maxHeight: 132,
                      overflowY: 'auto',
                      paddingRight: 4,
                    }}
                  >
                    {imageViewer.description || 'Sin descripcion registrada para este producto.'}
                  </div>
                </div>
                <div
                  style={{
                    flex: '0 0 220px',
                    alignSelf: 'stretch',
                    display: 'grid',
                    alignContent: 'center',
                    justifyItems: 'center',
                    gap: 6,
                    padding: '12px 14px',
                    borderRadius: 14,
                    background: 'rgba(15, 118, 110, 0.18)',
                    border: '1px solid rgba(45, 212, 191, 0.28)',
                  }}
                >
                  <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.1, color: '#ffffff', textAlign: 'center' }}>
                    {imageViewer.price !== null ? formatMoney(imageViewer.price, currency) : 'No definido'}
                  </div>
                </div>
              </div>
            </div>
            {imageViewer.images.length > 1 && (
              <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4, justifyContent: 'center', margin: '0 auto', maxWidth: '100%' }}>
                  {imageViewer.images.map((imageUrl, index) => (
                    <button
                      key={`${imageUrl}-${index}`}
                      type="button"
                      onClick={() => setImageViewer(prev => prev ? { ...prev, activeIndex: index } : prev)}
                      title={`Ver imagen ${index + 1}`}
                      aria-label={`Ver imagen ${index + 1}`}
                      style={{
                        border: index === imageViewer.activeIndex ? '2px solid #38bdf8' : '1px solid rgba(255,255,255,0.16)',
                        borderRadius: 12,
                        padding: 0,
                        minWidth: 84,
                        width: 84,
                        height: 84,
                        overflow: 'hidden',
                        background: 'rgba(255,255,255,0.04)',
                        cursor: 'pointer',
                        flex: '0 0 auto',
                      }}
                    >
                      <img src={imageUrl} alt={`Miniatura ${index + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button
              className="icon-btn"
              title="Cerrar imagen"
              aria-label="Cerrar imagen"
              onClick={() => setImageViewer(null)}
              style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.5)', color: '#fff' }}
            >
              <svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2"/></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
