import React, { useState, useEffect, useMemo } from 'react'
import { api, getSuppliers, getProducts, getProductDetails } from '../api'
import { useConfigStore } from '../store/config'
import { useNavigate } from 'react-router-dom'
import { formatMoney } from '../utils/currency'

interface Product {
  id: number
  name: string
  code?: string
  sku?: string
  productCode?: string
  description?: string
  altName?: string
  genericName?: string
  cost?: number
  avgCost?: number
  lastCost?: number
  stock: number
  productType?: string
  trackingProfile?: string
  trackingMeta?: Partial<TrackingMeta>
  shelfLocation?: string
  variants?: SerializedVariantPurchase[]
}

interface TrackingMeta {
  storageNotes?: string
  presentation?: string
  activeIngredient?: string
  concentration?: string
  dosageForm?: string
  sanitaryRegistry?: string
  packageType?: string
  originInfo?: string
  regulatoryNotes?: string
}

interface PurchaseItem {
  productId: number
  name: string
  code: string
  quantity: number
  unitCost: number
  productType?: string
  trackingProfile?: string
  trackingMeta?: Partial<TrackingMeta>
  genericName?: string
  shelfLocation?: string
  altName?: string
  // Medicinal
  batches?: { batchNo: string; expiryDate: string; quantity: number }[]
  // Legacy single batch fields (optional, kept for compatibility if needed temporarily)
  batchNo?: string
  expiryDate?: string
  // IMEI/Serial
  serials?: string // for backend compatibility (payload)
  imeiEntries?: string[] // for UI handling
  variants?: SerializedVariantPurchase[]
  selectedVariantId?: number
}

interface SerializedVariantPurchaseUnit {
  imei: string
  serialNo: string
}

interface SerializedVariantPurchase {
  variantId: number
  name: string
  sku?: string
  color?: string
  ram?: string
  storage?: string
  carrier?: string
  simType?: string
  identifierMode: 'IMEI' | 'SERIAL'
  units: SerializedVariantPurchaseUnit[]
}

interface Warehouse {
    id: number
    name: string
}

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

function normalizeVariantIdentifierMode(value?: string): 'IMEI' | 'SERIAL' {
  return String(value || '').trim().toUpperCase() === 'SERIAL' ? 'SERIAL' : 'IMEI'
}

function buildVariantLabel(variant: Partial<SerializedVariantPurchase> | any) {
  const explicitName = String(variant?.name || '').trim()
  if (explicitName) return explicitName
  const parts = [variant?.color, variant?.ram, variant?.storage, variant?.carrier, variant?.simType]
    .map(value => String(value || '').trim())
    .filter(Boolean)
  return parts.length > 0 ? parts.join(' / ') : 'Variante'
}

function buildVariantDisplayLabel(variant: Partial<SerializedVariantPurchase> | any) {
  const baseLabel = buildVariantLabel(variant)
  const sku = String(variant?.sku || '').trim()
  if (baseLabel !== 'Variante') {
    return sku ? `${baseLabel} (${sku})` : baseLabel
  }
  if (sku) return `SKU ${sku}`
  const variantId = Number(variant?.variantId || variant?.id || 0)
  return variantId > 0 ? `Variante #${variantId}` : 'Variante sin identificar'
}

function parsePurchaseVariants(raw: any): SerializedVariantPurchase[] {
  if (!Array.isArray(raw)) return []
  return raw.map((variant: any) => ({
    variantId: Number(variant?.id || 0),
    name: String(variant?.name || ''),
    sku: variant?.sku ? String(variant.sku) : undefined,
    color: variant?.color ? String(variant.color) : undefined,
    ram: variant?.ram ? String(variant.ram) : undefined,
    storage: variant?.storage ? String(variant.storage) : undefined,
    carrier: variant?.carrier ? String(variant.carrier) : undefined,
    simType: variant?.simType ? String(variant.simType) : undefined,
    identifierMode: normalizeVariantIdentifierMode(variant?.identifierMode),
    units: [],
  })).filter(variant => variant.variantId > 0)
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

function buildTrackingSummary(product: Partial<PurchaseItem> | Partial<Product>) {
  const meta = product.trackingMeta || {}
  const summary: string[] = []
  const profile = normalizeTrackingProfile(product.trackingProfile)
  if (profile !== 'GENERAL') summary.push(`Perfil: ${formatTrackingProfileLabel(profile)}`)
  if (product.genericName) summary.push(`Generico: ${product.genericName}`)
  if (meta.activeIngredient) summary.push(`Activo: ${meta.activeIngredient}`)
  if (meta.concentration) summary.push(`Concentracion: ${meta.concentration}`)
  if (meta.presentation) summary.push(`Presentacion: ${meta.presentation}`)
  if (meta.packageType) summary.push(`Empaque: ${meta.packageType}`)
  if (meta.storageNotes) summary.push(`Almacenaje: ${meta.storageNotes}`)
  if (product.shelfLocation) summary.push(`Ubicacion: ${product.shelfLocation}`)
  return summary
}

export default function PurchaseCreate() {
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [loading, setLoading] = useState(false)
  
  // Form State
  const [supplierId, setSupplierId] = useState<number | ''>('')
  const [warehouseId, setWarehouseId] = useState<number | ''>('')
  const [docNo, setDocNo] = useState('')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [paymentFile, setPaymentFile] = useState<File | null>(null)
  const [items, setItems] = useState<PurchaseItem[]>([])
  const [paymentType, setPaymentType] = useState<'CASH' | 'CREDIT'>('CASH')
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD' | 'DEPOSIT'>('CASH')
  const [initialPayment, setInitialPayment] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [paymentReference, setPaymentReference] = useState('')
  const [paymentNotes, setPaymentNotes] = useState('')
  
  // Product Search State
  const [isProductModalOpen, setIsProductModalOpen] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [debouncedProductSearch, setDebouncedProductSearch] = useState('')
  const [isMobileViewport, setIsMobileViewport] = useState(false)
  
  const navigate = useNavigate()
  const config = useConfigStore(s => s.config)
  const panelPadding = isMobileViewport ? 14 : 20
  const controlPadding = isMobileViewport ? '10px 12px' : 8
  const baseFieldStyle: React.CSSProperties = {
    width: '100%',
    padding: controlPadding,
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text)',
    minHeight: isMobileViewport ? 44 : undefined,
  }
  const mutedFieldStyle: React.CSSProperties = {
    ...baseFieldStyle,
    background: 'var(--surface)',
  }
  const sectionStyle: React.CSSProperties = {
    padding: panelPadding,
    backgroundColor: 'var(--modal)',
    borderRadius: 12,
    border: '1px solid var(--border)',
    display: 'grid',
    gap: isMobileViewport ? 14 : 16,
  }
  const summaryCardStyle: React.CSSProperties = {
    border: '1px solid var(--border)',
    borderRadius: 12,
    background: 'var(--modal)',
    padding: isMobileViewport ? 12 : 14,
    minWidth: 0,
  }

  useEffect(() => {
    loadData()
  }, [])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)')
    const syncViewport = () => setIsMobileViewport(mediaQuery.matches)
    syncViewport()
    mediaQuery.addEventListener('change', syncViewport)
    return () => mediaQuery.removeEventListener('change', syncViewport)
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedProductSearch(productSearch.trim())
    }, 300)

    return () => window.clearTimeout(timeoutId)
  }, [productSearch])

  useEffect(() => {
    if (!isProductModalOpen) return
    let cancelled = false

    const loadProducts = async () => {
      try {
        const response = await getProducts({
          paged: true,
          page: 1,
          limit: 40,
          search: debouncedProductSearch || undefined,
          stockFilter: 'all',
        })
        if (cancelled) return
        const nextProducts = Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : []
        setProducts(nextProducts)
      } catch (err) {
        if (cancelled) return
        console.error('Error loading purchase products:', err)
        setProducts([])
      }
    }

    void loadProducts()

    return () => {
      cancelled = true
    }
  }, [isProductModalOpen, debouncedProductSearch])

  async function loadData() {
    try {
      const [suppData, whRes] = await Promise.all([
        getSuppliers(),
        api.get('/warehouses')
      ])
      setSuppliers(suppData)
      setWarehouses(whRes.data)
      
      // Default to TIENDA (usually ID 1) or first warehouse
      const tienda = whRes.data.find((w: any) => w.name.toUpperCase() === 'TIENDA' || w.name.toUpperCase() === 'PRINCIPAL')
      if (tienda) {
        setWarehouseId(tienda.id)
      } else if (whRes.data.length > 0) {
        setWarehouseId(whRes.data[0].id)
      }
    } catch (err) {
      console.error('Error loading data:', err)
      alert('Error cargando datos iniciales')
    }
  }

  const filteredProducts = useMemo(() => products, [products])

  function getProductCode(product: Product) {
    return product.productCode || product.code || product.sku || ''
  }

  function getProductIdentifierSummary(product: Product) {
    const code = product.productCode || product.code || ''
    const sku = product.sku || ''
    if (code && sku && code !== sku) {
      return `COD: ${code} | SKU: ${sku}`
    }
    if (code) return `COD: ${code}`
    if (sku) return `SKU: ${sku}`
    return 'Sin codigo'
  }

  async function addItem(product: Product) {
    const existing = items.find(i => i.productId === product.id)

    if (existing) {
        alert('El producto ya está en la lista')
        return
    }

    let purchaseVariants: SerializedVariantPurchase[] | undefined
    if (String(product.productType || '').toUpperCase() === 'VARIANT_SERIALIZED') {
      try {
        const details = await getProductDetails(product.id)
        purchaseVariants = parsePurchaseVariants(details?.variants)
        if (purchaseVariants.length === 0) {
          alert('Este producto no tiene variantes configuradas. Primero define sus variantes serializadas en Productos.')
          return
        }
      } catch (err) {
        console.error('Error loading serialized variants for purchase:', err)
        alert('No se pudieron cargar las variantes serializadas del producto')
        return
      }
    }

    setItems([...items, {
      productId: product.id,
      name: product.name,
      code: getProductCode(product),
      quantity: purchaseVariants ? 0 : 1,
      unitCost: product.lastCost ?? product.avgCost ?? product.cost ?? 0,
      productType: product.productType,
      trackingProfile: product.trackingProfile,
      trackingMeta: product.trackingMeta,
      genericName: product.genericName,
      shelfLocation: product.shelfLocation,
      altName: product.altName,
      batches: product.productType === 'MEDICINAL' ? [{ batchNo: '', expiryDate: '', quantity: 1 }] : undefined,
      imeiEntries: (product.productType === 'IMEI' || product.productType === 'SERIAL') ? [''] : undefined,
      variants: purchaseVariants,
      selectedVariantId: purchaseVariants?.[0]?.variantId,
    }])
    setIsProductModalOpen(false)
    setProductSearch('')
    setDebouncedProductSearch('')
  }

  function updateItem(index: number, field: keyof PurchaseItem, value: any) {
    const newItems = [...items]
    const item = { ...newItems[index], [field]: value }

    if (field === 'quantity' && item.productType === 'VARIANT_SERIALIZED') {
        return
    }
    
    // Logic for Medicinal Batches: Add single default batch row if empty, but do NOT auto-expand quantity
    if (field === 'quantity' && item.productType === 'MEDICINAL') {
        const currentBatches = item.batches || [];
        if (currentBatches.length === 0) {
            item.batches = [{ batchNo: '', expiryDate: '', quantity: Number(value) }];
        }
        // Do not force batch rows to match quantity automatically. Let user manage them.
    }

    if (field === 'quantity' && (item.productType === 'IMEI' || item.productType === 'SERIAL')) {
        const newQty = Number(value);
        const currentEntries = item.imeiEntries || [];
        
        if (newQty > currentEntries.length) {
            const diff = newQty - currentEntries.length;
            const newLines = Array(diff).fill('');
            item.imeiEntries = [...currentEntries, ...newLines];
        } else if (newQty < currentEntries.length) {
            // Remove from end
            item.imeiEntries = currentEntries.slice(0, newQty);
        }
    }

    newItems[index] = item
    setItems(newItems)
  }

  function updateVariantUnit(itemIndex: number, variantIndex: number, unitIndex: number, key: 'imei' | 'serialNo', value: string) {
    setItems(prev => prev.map((item, idx) => {
      if (idx !== itemIndex || !item.variants) return item
      const nextVariants = [...item.variants]
      const currentVariant = nextVariants[variantIndex]
      const currentUnit = currentVariant?.units?.[unitIndex]
      if (!currentVariant || !currentUnit) return item
      const nextUnits = [...currentVariant.units]
      nextUnits[unitIndex] = { ...currentUnit, [key]: value }
      nextVariants[variantIndex] = { ...currentVariant, units: nextUnits }
      const quantity = nextVariants.reduce((sum, variant) => sum + variant.units.length, 0)
      return { ...item, variants: nextVariants, quantity }
    }))
  }

  function addVariantUnit(itemIndex: number, variantIndex: number) {
    setItems(prev => prev.map((item, idx) => {
      if (idx !== itemIndex || !item.variants) return item
      const nextVariants = [...item.variants]
      const currentVariant = nextVariants[variantIndex]
      if (!currentVariant) return item
      nextVariants[variantIndex] = {
        ...currentVariant,
        units: [...currentVariant.units, { imei: '', serialNo: '' }]
      }
      const quantity = nextVariants.reduce((sum, variant) => sum + variant.units.length, 0)
      return { ...item, variants: nextVariants, quantity }
    }))
  }

  function addVariantUnitById(itemIndex: number, variantId: number) {
    const item = items[itemIndex]
    const variantIndex = item?.variants?.findIndex(variant => variant.variantId === variantId) ?? -1
    if (variantIndex < 0) {
      alert('Selecciona una variante valida para registrar la unidad')
      return
    }
    addVariantUnit(itemIndex, variantIndex)
  }

  function removeVariantUnit(itemIndex: number, variantIndex: number, unitIndex: number) {
    setItems(prev => prev.map((item, idx) => {
      if (idx !== itemIndex || !item.variants) return item
      const nextVariants = [...item.variants]
      const currentVariant = nextVariants[variantIndex]
      if (!currentVariant) return item
      nextVariants[variantIndex] = {
        ...currentVariant,
        units: currentVariant.units.filter((_, index) => index !== unitIndex)
      }
      const quantity = nextVariants.reduce((sum, variant) => sum + variant.units.length, 0)
      return { ...item, variants: nextVariants, quantity }
    }))
  }

  function updateBatch(itemIndex: number, batchIndex: number, field: string, value: any) {
    const newItems = [...items]
    const item = { ...newItems[itemIndex] }
    if (item.batches) {
        const newBatches = [...item.batches]
        newBatches[batchIndex] = { ...newBatches[batchIndex], [field]: value }
        item.batches = newBatches
        newItems[itemIndex] = item
        setItems(newItems)
    }
  }

  function addBatch(itemIndex: number) {
    const newItems = [...items]
    const item = { ...newItems[itemIndex] }
    if (item.batches) {
        item.batches = [...item.batches, { batchNo: '', expiryDate: '', quantity: 0 }]
        newItems[itemIndex] = item
        setItems(newItems)
    }
  }

  function removeBatch(itemIndex: number, batchIndex: number) {
    const newItems = [...items]
    const item = { ...newItems[itemIndex] }
    if (item.batches && item.batches.length > 1) {
        const newBatches = [...item.batches]
        newBatches.splice(batchIndex, 1)
        item.batches = newBatches
        newItems[itemIndex] = item
        setItems(newItems)
    }
  }

  function updateImeiEntry(itemIndex: number, imeiIndex: number, value: string) {
    const newItems = [...items]
    const item = { ...newItems[itemIndex] }
    if (item.imeiEntries) {
        const newEntries = [...item.imeiEntries]
        newEntries[imeiIndex] = value
        item.imeiEntries = newEntries
        newItems[itemIndex] = item
        setItems(newItems)
    }
  }

  function removeItem(index: number) {
    setItems(items.filter((_, i) => i !== index))
  }

  const total = items.reduce((sum, item) => sum + (item.quantity * item.unitCost), 0)
  const normalizedInitialPayment = useMemo(() => {
    if (paymentType === 'CASH') return total
    const parsed = Number(initialPayment || 0)
    if (!Number.isFinite(parsed)) return 0
    return Math.min(total, Math.max(0, parsed))
  }, [paymentType, initialPayment, total])
  const balanceDue = Math.max(0, total - normalizedInitialPayment)

  async function handleSubmit() {
    if (!supplierId) return alert('Seleccione un proveedor')
    if (items.length === 0) return alert('Agregue productos a la compra')
    if (paymentType === 'CREDIT' && balanceDue > 0 && !dueDate) {
      return alert('Ingrese fecha de vencimiento para compras al credito')
    }
    if ((paymentMethod === 'CARD' || paymentMethod === 'DEPOSIT') && normalizedInitialPayment > 0 && !paymentReference.trim()) {
      return alert('Ingrese referencia para pagos con tarjeta o deposito')
    }

    // Validation for Medicinal products (batches)
    for (const item of items) {
        if (item.productType === 'MEDICINAL') {
            if (!item.batches || item.batches.length === 0) {
                 return alert(`Ingrese lotes para el producto ${item.name}`)
            }
            const batchSum = item.batches.reduce((sum, b) => sum + b.quantity, 0)
            if (batchSum !== item.quantity) {
                 return alert(`La suma de cantidades de los lotes para ${item.name} (${batchSum}) no coincide con la cantidad total (${item.quantity})`)
            }
            for (const batch of item.batches) {
                if (!batch.batchNo || !batch.expiryDate) {
                    return alert(`Complete todos los datos (Lote y Vencimiento) para el producto ${item.name}`)
                }
            }
        }
        
        if (item.productType === 'IMEI' || item.productType === 'SERIAL') {
             const entries = item.imeiEntries || []
             if (entries.length !== item.quantity) {
                 // Should be synced by logic, but just in case
                 return alert(`Cantidad de ${item.productType}s no coincide con la cantidad del producto ${item.name}`)
             }
             if (entries.some(e => !e.trim())) {
                 return alert(`Ingrese todos los ${item.productType}s para el producto ${item.name}`)
             }
        }

        if (item.productType === 'VARIANT_SERIALIZED') {
            const variants = item.variants || []
            const totalUnits = variants.reduce((sum, variant) => sum + variant.units.length, 0)
            if (variants.length === 0) {
                return alert(`El producto ${item.name} no tiene variantes configuradas para la compra`)
            }
            if (totalUnits <= 0) {
                return alert(`Debes ingresar al menos una unidad serializada para el producto ${item.name}`)
            }
            for (const variant of variants) {
                for (const unit of variant.units) {
                    if (variant.identifierMode === 'IMEI' && !String(unit.imei || '').trim()) {
                        return alert(`Completa todos los IMEI de la variante ${buildVariantLabel(variant)} en ${item.name}`)
                    }
                    if (variant.identifierMode === 'SERIAL' && !String(unit.serialNo || '').trim()) {
                        return alert(`Completa todas las series de la variante ${buildVariantLabel(variant)} en ${item.name}`)
                    }
                }
            }
            const variantSkus = variants.map(variant => String(variant.sku || '').trim().toUpperCase()).filter(Boolean)
            const duplicateVariantSkus = [...new Set(variantSkus.filter((value, index, arr) => arr.indexOf(value) !== index))]
            if (duplicateVariantSkus.length > 0) {
                return alert(`Hay SKU de variante duplicados en ${item.name}: ${duplicateVariantSkus.join(', ')}`)
            }
            const imeis = variants.flatMap(variant => variant.units.map(unit => String(unit.imei || '').trim().toUpperCase()).filter(Boolean))
            const serials = variants.flatMap(variant => variant.units.map(unit => String(unit.serialNo || '').trim().toUpperCase()).filter(Boolean))
            const duplicateImeis = [...new Set(imeis.filter((value, index, arr) => arr.indexOf(value) !== index))]
            const duplicateSerials = [...new Set(serials.filter((value, index, arr) => arr.indexOf(value) !== index))]
            if (duplicateImeis.length > 0) {
                return alert(`Hay IMEIs duplicados en ${item.name}: ${duplicateImeis.join(', ')}`)
            }
            if (duplicateSerials.length > 0) {
                return alert(`Hay series duplicadas en ${item.name}: ${duplicateSerials.join(', ')}`)
            }
        }
    }

    setLoading(true)
    try {
      // Prepare items payload (avoid mutating state)
      const payloadItems = items.map(item => {
        const newItem = { ...item }
        delete newItem.selectedVariantId
        if ((item.productType === 'IMEI' || item.productType === 'SERIAL') && item.imeiEntries) {
            newItem.serials = item.imeiEntries.join('\n')
        }
        if (item.productType === 'VARIANT_SERIALIZED' && item.variants) {
            newItem.quantity = item.variants.reduce((sum, variant) => sum + variant.units.length, 0)
            newItem.variants = item.variants.map(variant => ({
              ...variant,
              sku: variant.sku ? String(variant.sku).trim().toUpperCase() : undefined,
              units: variant.units.map(unit => ({
                imei: String(unit.imei || '').trim().toUpperCase(),
                serialNo: String(unit.serialNo || '').trim().toUpperCase(),
              }))
            }))
            newItem.serials = item.variants
              .flatMap(variant => variant.units.map(unit => variant.identifierMode === 'IMEI' ? unit.imei : unit.serialNo))
              .filter(Boolean)
              .join('\n')
        }
        return newItem
      })

      const formData = new FormData()
      formData.append('supplierId', String(supplierId))
      if (warehouseId) formData.append('warehouseId', String(warehouseId))
      formData.append('docNo', docNo)
      formData.append('notes', notes)
      formData.append('total', String(total))
      formData.append('paymentType', paymentType)
      formData.append('paymentMethod', paymentMethod)
      formData.append('initialPayment', String(normalizedInitialPayment))
      if (dueDate) formData.append('dueDate', dueDate)
      if (paymentReference.trim()) formData.append('paymentReference', paymentReference.trim())
      if (paymentNotes.trim()) formData.append('paymentNotes', paymentNotes.trim())
      formData.append('items', JSON.stringify(payloadItems))
      if (file) {
        formData.append('document', file)
      }
      if (paymentFile) {
        formData.append('paymentDocument', paymentFile)
      }

      await api.post('/purchases', formData)
      alert('Compra registrada exitosamente')
      navigate('/purchases')
    } catch (err: any) {
      console.error(err)
      alert(err.response?.data?.error || 'Error al registrar compra')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: isMobileViewport ? 14 : 20, maxWidth: 1200, margin: '0 auto', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobileViewport ? 'stretch' : 'center', flexDirection: isMobileViewport ? 'column' : 'row', gap: 12, marginBottom: 20 }}>
        <h1>Nueva Compra</h1>
        <button className="btn-secondary" style={{ width: isMobileViewport ? '100%' : 'auto' }} onClick={() => navigate('/purchases')}>Cancelar</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobileViewport ? '1fr' : '1.15fr 1fr', gap: 20, marginBottom: 20 }}>
        <section style={sectionStyle}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>Datos de la Compra</h3>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
              Informacion propia de la factura, proveedor y archivo de la compra.
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobileViewport ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>Proveedor</label>
              <select
                value={supplierId}
                onChange={e => setSupplierId(Number(e.target.value))}
                style={baseFieldStyle}
              >
                <option value="">Seleccione Proveedor</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>Almacén Destino (Opcional)</label>
              <select
                value={warehouseId}
                onChange={e => setWarehouseId(e.target.value ? Number(e.target.value) : '')}
                style={baseFieldStyle}
              >
                {warehouses.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>N° Documento / Factura</label>
              <input
                type="text"
                value={docNo}
                onChange={e => setDocNo(e.target.value)}
                style={baseFieldStyle}
                placeholder="Ej. F001-12345"
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>Documento de Compra (PDF/Img)</label>
              <input
                type="file"
                accept=".pdf,image/*"
                onChange={e => setFile(e.target.files?.[0] || null)}
                style={{ ...baseFieldStyle, padding: isMobileViewport ? 10 : 5 }}
              />
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6, wordBreak: 'break-word' }}>
                {file ? `Archivo seleccionado: ${file.name}` : 'Puedes subir factura, orden o imagen del documento.'}
              </div>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>Notas</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={isMobileViewport ? 3 : 2}
              style={{ ...baseFieldStyle, resize: 'vertical', minHeight: isMobileViewport ? 92 : 74 }}
              placeholder="Observaciones..."
            />
          </div>
        </section>

        <section style={sectionStyle}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>Datos del Pago</h3>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
              Define si la factura fue al contado o credito, con su abono, referencia y comprobante.
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: isMobileViewport ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>Tipo de Pago</label>
              <select
                value={paymentType}
                onChange={e => setPaymentType(e.target.value as 'CASH' | 'CREDIT')}
                style={baseFieldStyle}
              >
                <option value="CASH">Contado</option>
                <option value="CREDIT">Credito por pagar</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>Metodo de Pago</label>
              <select
                value={paymentMethod}
                onChange={e => setPaymentMethod(e.target.value as 'CASH' | 'CARD' | 'DEPOSIT')}
                style={baseFieldStyle}
              >
                <option value="CASH">Efectivo</option>
                <option value="CARD">Tarjeta</option>
                <option value="DEPOSIT">Deposito</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>
                {paymentType === 'CASH' ? 'Pagado' : 'Abono Inicial'}
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={paymentType === 'CASH' ? total : initialPayment}
                onChange={e => setInitialPayment(e.target.value)}
                disabled={paymentType === 'CASH'}
                style={paymentType === 'CASH' ? mutedFieldStyle : baseFieldStyle}
                placeholder={paymentType === 'CASH' ? 'Se pagara el total' : '0.00'}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>Vence el</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                disabled={paymentType !== 'CREDIT' || balanceDue <= 0}
                style={paymentType !== 'CREDIT' || balanceDue <= 0 ? mutedFieldStyle : baseFieldStyle}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>Referencia</label>
              <input
                type="text"
                value={paymentReference}
                onChange={e => setPaymentReference(e.target.value)}
                style={baseFieldStyle}
                placeholder={paymentMethod === 'CASH' ? 'Opcional' : 'Requerido para tarjeta/deposito'}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>Comprobante de Pago</label>
              <input
                type="file"
                accept="image/*,.pdf"
                disabled={normalizedInitialPayment <= 0}
                onChange={e => setPaymentFile(e.target.files?.[0] || null)}
                style={{ ...(normalizedInitialPayment <= 0 ? mutedFieldStyle : baseFieldStyle), padding: isMobileViewport ? 10 : 5 }}
              />
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6, wordBreak: 'break-word' }}>
                {paymentFile ? `Comprobante seleccionado: ${paymentFile.name}` : 'Adjunta el comprobante si se realizo pago o abono.'}
              </div>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>Nota de Pago</label>
            <textarea
              value={paymentNotes}
              onChange={e => setPaymentNotes(e.target.value)}
              rows={isMobileViewport ? 3 : 2}
              style={{ ...baseFieldStyle, resize: 'vertical', minHeight: isMobileViewport ? 92 : 74 }}
              placeholder="Ej. abono inicial del proveedor"
            />
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
              Sube imagen o PDF del deposito, transferencia o voucher del pago realizado.
            </div>
          </div>
        </section>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobileViewport ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 20 }}>
        <div style={summaryCardStyle}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Total Factura</div>
          <div style={{ fontWeight: 800, fontSize: isMobileViewport ? '1rem' : '1.1rem', wordBreak: 'break-word' }}>{formatMoney(total, config?.currency)}</div>
        </div>
        <div style={summaryCardStyle}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Pagado al Registrar</div>
          <div style={{ fontWeight: 800, fontSize: isMobileViewport ? '1rem' : '1.1rem', color: '#22c55e', wordBreak: 'break-word' }}>{formatMoney(normalizedInitialPayment, config?.currency)}</div>
        </div>
        <div style={summaryCardStyle}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Saldo Pendiente</div>
          <div style={{ fontWeight: 800, fontSize: isMobileViewport ? '1rem' : '1.1rem', color: balanceDue > 0 ? '#f59e0b' : '#22c55e', wordBreak: 'break-word' }}>{formatMoney(balanceDue, config?.currency)}</div>
        </div>
        <div style={summaryCardStyle}>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Estado de Pago</div>
          <div style={{ fontWeight: 800, fontSize: isMobileViewport ? '0.95rem' : '1.1rem' }}>
            {balanceDue <= 0 ? 'PAGADO' : normalizedInitialPayment > 0 ? 'ABONO PARCIAL' : paymentType === 'CREDIT' ? 'POR PAGAR' : 'PENDIENTE'}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobileViewport ? 'stretch' : 'center', flexDirection: isMobileViewport ? 'column' : 'row', gap: 12 }}>
          <div>
            <h3 style={{ marginBottom: 4 }}>Detalle de Productos</h3>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {items.length} {items.length === 1 ? 'producto agregado' : 'productos agregados'}
            </div>
          </div>
          <button className="btn-primary" style={{ width: isMobileViewport ? '100%' : 'auto' }} onClick={() => setIsProductModalOpen(true)}>+ Agregar Producto</button>
        </div>

        {isMobileViewport ? (
          <div style={{ display: 'grid', gap: 12 }}>
            {items.map((item, i) => (
              <div key={item.productId + '_' + i} style={{ border: '1px solid var(--border)', borderRadius: 12, backgroundColor: 'var(--modal)', padding: 14, display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 'bold' }}>{item.name}</div>
                    <div style={{ fontSize: '0.8em', opacity: 0.7, wordBreak: 'break-word' }}>{item.code}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                      <span style={{ fontSize: 11, padding: '4px 8px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)' }}>
                        {formatProductTypeLabel(item.productType)}
                      </span>
                      {String(item.productType || '').toUpperCase() === 'MEDICINAL' && (
                        <span style={{ fontSize: 11, padding: '4px 8px', borderRadius: 999, border: '1px solid rgba(37,99,235,0.18)', background: 'rgba(37,99,235,0.08)', color: '#1d4ed8' }}>
                          {formatTrackingProfileLabel(item.trackingProfile)}
                        </span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => removeItem(i)} style={{ border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.08)', cursor: 'pointer', color: '#ef4444', padding: '8px 10px', borderRadius: 10, minWidth: 42, minHeight: 42 }}>✕</button>
                </div>
                {String(item.productType || '').toUpperCase() === 'MEDICINAL' && buildTrackingSummary(item).length > 0 && (
                  <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.12)', display: 'grid', gap: 4 }}>
                    {buildTrackingSummary(item).map(line => (
                      <div key={line} style={{ fontSize: 12, color: '#1e3a8a' }}>{line}</div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: 6 }}>Cantidad</label>
                    <input type="number" min="1" value={item.quantity} disabled={item.productType === 'VARIANT_SERIALIZED'} onChange={e => updateItem(i, 'quantity', Number(e.target.value))} style={{ ...(item.productType === 'VARIANT_SERIALIZED' ? mutedFieldStyle : baseFieldStyle), textAlign: 'center', padding: '10px 8px' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: 6 }}>Costo Unit.</label>
                    <input type="number" min="0" step="0.01" value={item.unitCost} onChange={e => updateItem(i, 'unitCost', Number(e.target.value))} style={{ ...baseFieldStyle, textAlign: 'right', padding: '10px 8px' }} />
                  </div>
                </div>
                <div style={{ fontWeight: 700, padding: '8px 10px', borderRadius: 10, background: 'var(--surface)' }}>
                  Subtotal: {formatMoney(item.quantity * item.unitCost, config?.currency)}
                </div>
                {item.productType === 'MEDICINAL' && (
                  <div style={{ marginTop: 5 }}>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Lotes del producto</div>
                    {item.batches?.map((batch, bIdx) => (
                      <div key={bIdx} style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6, marginBottom: 8 }}>
                        <input placeholder="Lote" value={batch.batchNo} onChange={e => updateBatch(i, bIdx, 'batchNo', e.target.value)} style={{ ...baseFieldStyle, fontSize: '0.9em' }} />
                        <input type="date" value={batch.expiryDate} onChange={e => updateBatch(i, bIdx, 'expiryDate', e.target.value)} style={{ ...baseFieldStyle, fontSize: '0.9em' }} />
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input type="number" placeholder="Cant." value={batch.quantity} onChange={e => updateBatch(i, bIdx, 'quantity', Number(e.target.value))} style={{ ...baseFieldStyle, flex: 1, fontSize: '0.9em' }} />
                          {item.batches && item.batches.length > 1 && <button onClick={() => removeBatch(i, bIdx)} style={{ color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.08)', cursor: 'pointer', padding: '0 14px', borderRadius: 10, minHeight: 44 }} title="Eliminar lote">✕</button>}
                        </div>
                      </div>
                    ))}
                    <button onClick={() => addBatch(i)} style={{ fontSize: '0.8em', color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
                      + Agregar otro lote
                    </button>
                  </div>
                )}
                {(item.productType === 'IMEI' || item.productType === 'SERIAL') && (
                  <div style={{ marginTop: 5 }}>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
                      {item.productType === 'IMEI' ? 'IMEIs requeridos' : 'Seriales requeridos'}
                    </div>
                    {item.imeiEntries?.map((entry, idx) => (
                      <input key={idx} placeholder={`Ingrese ${item.productType} #${idx + 1}`} value={entry} onChange={e => updateImeiEntry(i, idx, e.target.value)} style={{ ...baseFieldStyle, display: 'block', fontSize: '0.9em', marginBottom: 6 }} />
                    ))}
                  </div>
                )}
                {item.productType === 'VARIANT_SERIALIZED' && (
                  <div style={{ marginTop: 5, display: 'grid', gap: 10 }}>
                    <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.12)', fontSize: 12, color: '#1e3a8a' }}>
                      La cantidad total se calcula automaticamente segun las unidades cargadas en cada variante. Primero elige la variante y luego registra el IMEI o la serie.
                    </div>
                    {!!item.variants?.length && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, alignItems: 'end' }}>
                        <div>
                          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Variante a recibir</div>
                          <select
                            value={item.selectedVariantId || item.variants[0]?.variantId || ''}
                            onChange={e => updateItem(i, 'selectedVariantId', Number(e.target.value))}
                            style={baseFieldStyle}
                          >
                            {item.variants.map(variant => (
                              <option key={`${item.productId}-variant-selector-mobile-${variant.variantId}`} value={variant.variantId}>
                                {buildVariantDisplayLabel(variant)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <button
                          type="button"
                          onClick={() => addVariantUnitById(i, Number(item.selectedVariantId || item.variants?.[0]?.variantId || 0))}
                          style={{ border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', borderRadius: 10, padding: '10px 12px', minHeight: 44 }}
                        >
                          + Unidad
                        </button>
                      </div>
                    )}
                    {item.variants?.map((variant, variantIndex) => (
                      <div key={`${item.productId}-variant-mobile-${variant.variantId}`} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, background: 'var(--surface)', display: 'grid', gap: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <div style={{ fontWeight: 700 }}>{buildVariantDisplayLabel(variant)}</div>
                          <button type="button" onClick={() => addVariantUnit(i, variantIndex)} style={{ border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', borderRadius: 10, padding: '8px 10px' }}>
                            + Unidad
                          </button>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                          {variant.identifierMode === 'IMEI' ? 'Modo IMEI' : 'Modo Serie'} {variant.sku ? `• SKU: ${variant.sku}` : ''}
                        </div>
                        {variant.units.length === 0 && (
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Sin unidades registradas.</div>
                        )}
                        {variant.units.map((unit, unitIndex) => (
                          <div key={`${item.productId}-variant-mobile-${variant.variantId}-unit-${unitIndex}`} style={{ display: 'grid', gap: 6 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Unidad {unitIndex + 1}</div>
                              <button type="button" onClick={() => removeVariantUnit(i, variantIndex, unitIndex)} style={{ color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.08)', borderRadius: 10, padding: '6px 10px' }}>
                                Quitar
                              </button>
                            </div>
                            {variant.identifierMode === 'IMEI' ? (
                              <input placeholder={`IMEI #${unitIndex + 1}`} value={unit.imei} onChange={e => updateVariantUnit(i, variantIndex, unitIndex, 'imei', e.target.value)} style={{ ...baseFieldStyle, fontSize: '0.9em' }} />
                            ) : (
                              <input placeholder={`Serie #${unitIndex + 1}`} value={unit.serialNo} onChange={e => updateVariantUnit(i, variantIndex, unitIndex, 'serialNo', e.target.value)} style={{ ...baseFieldStyle, fontSize: '0.9em' }} />
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {items.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', opacity: 0.5, border: '1px solid var(--border)', borderRadius: 8, backgroundColor: 'var(--modal)' }}>
                No hay productos agregados
              </div>
            )}
          </div>
        ) : (
        <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, backgroundColor: 'var(--modal)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
              <tr>
                <th style={{ padding: 10, textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Producto</th>
                <th style={{ padding: 10, textAlign: 'center', width: 100, borderBottom: '1px solid var(--border)' }}>Cantidad</th>
                <th style={{ padding: 10, textAlign: 'right', width: 150, borderBottom: '1px solid var(--border)' }}>Costo Unit.</th>
                <th style={{ padding: 10, textAlign: 'right', width: 150, borderBottom: '1px solid var(--border)' }}>Subtotal</th>
                <th style={{ padding: 10, textAlign: 'center', width: 50, borderBottom: '1px solid var(--border)' }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={item.productId + '_' + i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 10 }}>
                    <div style={{ fontWeight: 'bold' }}>{item.name}</div>
                    <div style={{ fontSize: '0.8em', opacity: 0.7 }}>{item.code}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, marginBottom: 6 }}>
                      <span style={{ fontSize: 11, padding: '4px 8px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)' }}>
                        {formatProductTypeLabel(item.productType)}
                      </span>
                      {String(item.productType || '').toUpperCase() === 'MEDICINAL' && (
                        <span style={{ fontSize: 11, padding: '4px 8px', borderRadius: 999, border: '1px solid rgba(37,99,235,0.18)', background: 'rgba(37,99,235,0.08)', color: '#1d4ed8' }}>
                          {formatTrackingProfileLabel(item.trackingProfile)}
                        </span>
                      )}
                    </div>
                    {String(item.productType || '').toUpperCase() === 'MEDICINAL' && buildTrackingSummary(item).length > 0 && (
                        <div style={{ marginBottom: 8, padding: '8px 10px', borderRadius: 10, background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.12)', display: 'grid', gap: 3 }}>
                            {buildTrackingSummary(item).map(line => (
                                <div key={line} style={{ fontSize: 11, color: '#1e3a8a' }}>{line}</div>
                            ))}
                        </div>
                    )}
                    {/* Extra Fields based on Type */}
                    {item.productType === 'MEDICINAL' && (
                        <div style={{ marginTop: 5 }}>
                            {item.batches?.map((batch, bIdx) => (
                                <div key={bIdx} style={{ display: 'flex', gap: 5, marginBottom: 5, alignItems: 'center' }}>
                                    <input 
                                        placeholder="Lote"
                                        value={batch.batchNo}
                                        onChange={e => updateBatch(i, bIdx, 'batchNo', e.target.value)}
                                        style={{ padding: 4, width: 80, fontSize: '0.9em', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                                    />
                                    <input 
                                        type="date"
                                        value={batch.expiryDate}
                                        onChange={e => updateBatch(i, bIdx, 'expiryDate', e.target.value)}
                                        style={{ padding: 4, fontSize: '0.9em', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                                    />
                                    <input 
                                        type="number"
                                        placeholder="Cant."
                                        value={batch.quantity}
                                        onChange={e => updateBatch(i, bIdx, 'quantity', Number(e.target.value))}
                                        style={{ padding: 4, width: 60, fontSize: '0.9em', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                                    />
                                    {item.batches && item.batches.length > 1 && (
                                        <button 
                                            onClick={() => removeBatch(i, bIdx)} 
                                            style={{ color: 'red', border: 'none', background: 'none', cursor: 'pointer', padding: 4 }}
                                            title="Eliminar lote"
                                        >
                                            ✕
                                        </button>
                                    )}
                                </div>
                            ))}
                            <button 
                                onClick={() => addBatch(i)}
                                style={{ fontSize: '0.8em', color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                            >
                                + Agregar otro lote
                            </button>
                            {/* Validation Warning */}
                            {item.batches && item.batches.reduce((sum, b) => sum + b.quantity, 0) !== item.quantity && (
                                <div style={{ color: 'orange', fontSize: '0.8em', marginTop: 2 }}>
                                    ⚠ Total lotes ({item.batches.reduce((sum, b) => sum + b.quantity, 0)}) difiere de cantidad ({item.quantity})
                                </div>
                            )}
                        </div>
                    )}
                    {(item.productType === 'IMEI' || item.productType === 'SERIAL') && (
                        <div style={{ marginTop: 5 }}>
                            {item.imeiEntries?.map((entry, idx) => (
                                <input 
                                    key={idx}
                                    placeholder={`Ingrese ${item.productType} #${idx + 1}`}
                                    value={entry}
                                    onChange={e => updateImeiEntry(i, idx, e.target.value)}
                                    style={{ 
                                        display: 'block', 
                                        width: '100%', 
                                        padding: 4, 
                                        fontSize: '0.9em', 
                                        marginBottom: 4,
                                        borderRadius: 4, 
                                        border: '1px solid var(--border)', 
                                        background: 'var(--bg)', 
                                        color: 'var(--text)' 
                                    }}
                                />
                            ))}
                        </div>
                    )}
                    {item.productType === 'VARIANT_SERIALIZED' && (
                        <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                            <div style={{ padding: '8px 10px', borderRadius: 10, background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.12)', fontSize: 12, color: '#1e3a8a' }}>
                                La cantidad se calcula automaticamente desde las unidades ingresadas en las variantes. Puedes elegir directamente a que variante se agregara cada unidad.
                            </div>
                            {!!item.variants?.length && (
                                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) auto', gap: 8, alignItems: 'end' }}>
                                    <div>
                                        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Variante a recibir</div>
                                        <select
                                            value={item.selectedVariantId || item.variants[0]?.variantId || ''}
                                            onChange={e => updateItem(i, 'selectedVariantId', Number(e.target.value))}
                                            style={{ ...baseFieldStyle, padding: 8, minHeight: undefined }}
                                        >
                                            {item.variants.map(variant => (
                                                <option key={`${item.productId}-variant-selector-desktop-${variant.variantId}`} value={variant.variantId}>
                                                    {buildVariantDisplayLabel(variant)}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => addVariantUnitById(i, Number(item.selectedVariantId || item.variants?.[0]?.variantId || 0))}
                                        style={{ border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}
                                    >
                                        + Unidad
                                    </button>
                                </div>
                            )}
                            {item.variants?.map((variant, variantIndex) => (
                                <div key={`${item.productId}-variant-desktop-${variant.variantId}`} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, background: 'var(--surface)', display: 'grid', gap: 8 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                        <div>
                                            <div style={{ fontWeight: 700 }}>{buildVariantDisplayLabel(variant)}</div>
                                            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                                                {variant.identifierMode === 'IMEI' ? 'Modo IMEI' : 'Modo Serie'} {variant.sku ? `• SKU: ${variant.sku}` : ''}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => addVariantUnit(i, variantIndex)}
                                            style={{ border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}
                                        >
                                            + Unidad
                                        </button>
                                    </div>
                                    {variant.units.length === 0 && (
                                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Sin unidades registradas.</div>
                                    )}
                                    {variant.units.map((unit, unitIndex) => (
                                        <div key={`${item.productId}-variant-desktop-${variant.variantId}-unit-${unitIndex}`} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                            <div style={{ minWidth: 64, fontSize: 12, color: 'var(--muted)' }}>Unidad {unitIndex + 1}</div>
                                            {variant.identifierMode === 'IMEI' ? (
                                                <input
                                                    placeholder={`IMEI #${unitIndex + 1}`}
                                                    value={unit.imei}
                                                    onChange={e => updateVariantUnit(i, variantIndex, unitIndex, 'imei', e.target.value)}
                                                    style={{ flex: 1, padding: 4, fontSize: '0.9em', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                                                />
                                            ) : (
                                                <input
                                                    placeholder={`Serie #${unitIndex + 1}`}
                                                    value={unit.serialNo}
                                                    onChange={e => updateVariantUnit(i, variantIndex, unitIndex, 'serialNo', e.target.value)}
                                                    style={{ flex: 1, padding: 4, fontSize: '0.9em', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                                                />
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => removeVariantUnit(i, variantIndex, unitIndex)}
                                                style={{ color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.08)', cursor: 'pointer', padding: '6px 10px', borderRadius: 8 }}
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    )}
                  </td>
                  <td style={{ padding: 10, verticalAlign: 'top' }}>
                    <input 
                      type="number" 
                      min="1"
                      value={item.quantity}
                      onChange={e => updateItem(i, 'quantity', Number(e.target.value))}
                      disabled={item.productType === 'VARIANT_SERIALIZED'}
                      style={{ width: '100%', textAlign: 'center', padding: 4, borderRadius: 4, border: '1px solid var(--border)', background: item.productType === 'VARIANT_SERIALIZED' ? 'var(--surface)' : 'var(--bg)', color: 'var(--text)' }}
                    />
                  </td>
                  <td style={{ padding: 10 }}>
                    <input 
                      type="number" 
                      min="0"
                      step="0.01"
                      value={item.unitCost}
                      onChange={e => updateItem(i, 'unitCost', Number(e.target.value))}
                      style={{ width: '100%', textAlign: 'right', padding: 4, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
                    />
                  </td>
                  <td style={{ padding: 10, textAlign: 'right' }}>
                    {formatMoney(item.quantity * item.unitCost, config?.currency)}
                  </td>
                  <td style={{ padding: 10, textAlign: 'center' }}>
                    <button 
                      onClick={() => removeItem(i)}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'red' }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 20, textAlign: 'center', opacity: 0.5 }}>
                    No hay productos agregados
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: isMobileViewport ? 'stretch' : 'center', flexDirection: isMobileViewport ? 'column' : 'row', gap: 14, padding: isMobileViewport ? '14px 0 calc(14px + env(safe-area-inset-bottom, 0px))' : 20, borderTop: '1px solid var(--border)', position: isMobileViewport ? 'sticky' : 'static', bottom: 0, background: isMobileViewport ? 'linear-gradient(180deg, rgba(0,0,0,0) 0%, var(--bg) 22%)' : 'transparent' }}>
          <div style={{ fontSize: isMobileViewport ? '1.15rem' : '1.5em', fontWeight: 'bold', textAlign: isMobileViewport ? 'center' : 'right' }}>
            Total: {formatMoney(total, config?.currency)}
          </div>
          <button 
            className="btn-primary" 
            style={{ fontSize: isMobileViewport ? '1rem' : '1.2em', padding: isMobileViewport ? '12px 18px' : '10px 30px', width: isMobileViewport ? '100%' : 'auto', minHeight: isMobileViewport ? 48 : undefined }}
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? 'Procesando...' : 'Registrar Compra'}
          </button>
        </div>
      </div>

      {isProductModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: isMobileViewport ? 'flex-end' : 'center', zIndex: 100, padding: isMobileViewport ? 0 : 16 }}>
          <div style={{ background: 'var(--modal)', padding: isMobileViewport ? 16 : 20, borderRadius: isMobileViewport ? '18px 18px 0 0' : 8, width: isMobileViewport ? '100%' : 600, maxWidth: isMobileViewport ? '100%' : 600, maxHeight: isMobileViewport ? '88vh' : '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ width: 48, height: 5, borderRadius: 999, background: 'var(--border)', alignSelf: 'center', marginBottom: 12 }} />
            <h3 style={{ marginTop: 0 }}>Buscar Producto</h3>
            <input 
              autoFocus
              type="text" 
              placeholder="Buscar por nombre, SKU, código, descripción, alterno o genérico..." 
              value={productSearch}
              onChange={e => setProductSearch(e.target.value)}
              style={{ ...baseFieldStyle, marginBottom: 10 }}
            />
            <div style={{ fontSize: '0.8em', color: 'var(--muted)', marginBottom: 10 }}>
              Usa las mismas variables del catálogo. Puedes escribir varias palabras en cualquier orden.
            </div>
            <div style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 4 }}>
              {filteredProducts.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>
                  No se encontraron productos con ese criterio de busqueda.
                </div>
              ) : (
                filteredProducts.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addItem(p)}
                    style={{
                      width: '100%',
                      padding: 10,
                      border: 'none',
                      borderBottom: '1px solid var(--border)',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      textAlign: 'left',
                      background: 'transparent',
                      color: 'var(--text)'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 'bold' }}>{p.name}</div>
                      <div style={{ fontSize: '0.8em', opacity: 0.7 }}>
                        {getProductIdentifierSummary(p)} - Tipo: {formatProductTypeLabel(p.productType)} - Stock: {p.stock}
                      </div>
                      {String(p.productType || '').toUpperCase() === 'MEDICINAL' && buildTrackingSummary(p).length > 0 && (
                        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          <span style={{ fontSize: 11, padding: '4px 8px', borderRadius: 999, border: '1px solid rgba(37,99,235,0.18)', background: 'rgba(37,99,235,0.08)', color: '#1d4ed8' }}>
                            {formatTrackingProfileLabel(p.trackingProfile)}
                          </span>
                          {buildTrackingSummary(p).slice(0, 3).map(line => (
                            <span key={line} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}>
                              {line}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ color: 'var(--accent)', fontWeight: 700 }}>+ Agregar</div>
                  </button>
                ))
              )}
            </div>
            <button 
              onClick={() => setIsProductModalOpen(false)} 
              style={{ marginTop: 16, padding: 10, border: 'none', background: 'var(--surface)', cursor: 'pointer', borderRadius: 6, color: 'var(--text)' }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
