import { useEffect, useState, useMemo } from 'react'
import { api, getProducts, getWarehouses, getCategories, getBrands, getProductWarehouseStock } from '../api'
import { useConfigStore } from '../store/config'
import { formatMoney } from '../utils/currency'
import MobileBarcodeScannerButton from '../components/MobileBarcodeScannerButton'

interface Movement {
  id: number
  date: string
  type: string
  quantity: number
  reference_id: number | null
  notes: string
  product_name: string
  product_code: string
  warehouse_name: string
  user_name: string
}

interface Product {
  id: number
  name: string
  sku: string
  productCode?: string
  description?: string
  price: number
  cost?: number
  stock: number
  imageUrl?: string
  categoryId?: number
  brandId?: number
  productType?: string
}

interface Batch {
  batchNo: string
  expiryDate: string
  quantity: number
}

interface WarehouseStock {
  warehouseId: number
  warehouseName: string
  quantity: number
}

export default function InventoryMovements() {
  const productsPerPage = 40
  const [activeTab, setActiveTab] = useState<'products' | 'history' | 'kardex'>('products')
  
  // History state
  const [items, setItems] = useState<Movement[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [filters, setFilters] = useState({
    type: '',
    warehouseId: ''
  })

  // Kardex state
  const [kardexItems, setKardexItems] = useState<(Movement & { balance: number, signedQty: number })[]>([])
  const [loadingKardex, setLoadingKardex] = useState(false)
  const [kardexFilters, setKardexFilters] = useState({
    productId: '',
    warehouseId: '',
    startDate: '',
    endDate: ''
  })
  const [kardexProductSearch, setKardexProductSearch] = useState('')
  const [kardexSelectedProduct, setKardexSelectedProduct] = useState<Product | null>(null)
  const [kardexSearchResults, setKardexSearchResults] = useState<Product[]>([])
  const [loadingKardexSearch, setLoadingKardexSearch] = useState(false)

  // Products state
  const [products, setProducts] = useState<Product[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [productQuery, setProductQuery] = useState('')
  const [debouncedProductQuery, setDebouncedProductQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalProducts, setTotalProducts] = useState(0)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [categories, setCategories] = useState<any[]>([])
  const [brands, setBrands] = useState<any[]>([])

  // Shared state
  const [warehouses, setWarehouses] = useState<any[]>([])
  const currency = useConfigStore(s => s.config?.currency || 'USD')
  
  // Modal state
  const [showAdjust, setShowAdjust] = useState(false)
  const [adjustForm, setAdjustForm] = useState<{
    productId: string
    warehouseId: string
    type: string
    quantity: string
    notes: string
    batches: Batch[]
    imeis: string[]
    serials: string[]
  }>({
    productId: '',
    warehouseId: '',
    type: 'ADJUSTMENT',
    quantity: '',
    notes: '',
    batches: [],
    imeis: [],
    serials: []
  })
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [currentWarehouseStock, setCurrentWarehouseStock] = useState<number | null>(null)
  const [productWarehouseStocks, setProductWarehouseStocks] = useState<WarehouseStock[]>([])
  const [productWarehouseStockMap, setProductWarehouseStockMap] = useState<Record<number, WarehouseStock[]>>({})
  const [loadingWarehouseStockMap, setLoadingWarehouseStockMap] = useState<Record<number, boolean>>({})
  const [availableAdjustImeis, setAvailableAdjustImeis] = useState<string[]>([])
  const [availableAdjustSerials, setAvailableAdjustSerials] = useState<string[]>([])
  const [savingAdjust, setSavingAdjust] = useState(false)

  // Helper for array inputs
  const updateBatch = (idx: number, field: keyof Batch, val: any) => {
    const newBatches = [...adjustForm.batches]
    newBatches[idx] = { ...newBatches[idx], [field]: val }
    setAdjustForm({ ...adjustForm, batches: newBatches })
  }
  const addBatch = () => {
    setAdjustForm({ ...adjustForm, batches: [...adjustForm.batches, { batchNo: '', expiryDate: '', quantity: 0 }] })
  }
  const removeBatch = (idx: number) => {
    const newBatches = [...adjustForm.batches]
    newBatches.splice(idx, 1)
    setAdjustForm({ ...adjustForm, batches: newBatches })
  }
  
  const updateImei = (idx: number, val: string) => {
    const newImeis = [...adjustForm.imeis]
    newImeis[idx] = val
    setAdjustForm({ ...adjustForm, imeis: newImeis })
  }

  const updateSerial = (idx: number, val: string) => {
    const newSerials = [...adjustForm.serials]
    newSerials[idx] = val
    setAdjustForm({ ...adjustForm, serials: newSerials })
  }

  // Effect to sync IMEI/Serial inputs with Quantity
  useEffect(() => {
    if (!showAdjust || !selectedProduct) return
    const qty = Math.abs(Number(adjustForm.quantity))
    if (!qty) return

    const pt = (selectedProduct.productType || 'GENERAL').toUpperCase()
    if (pt === 'IMEI') {
        const currentLen = adjustForm.imeis.length
        if (qty > currentLen) {
            setAdjustForm(prev => ({ ...prev, imeis: [...prev.imeis, ...Array(qty - currentLen).fill('')] }))
        } else if (qty < currentLen) {
            setAdjustForm(prev => ({ ...prev, imeis: prev.imeis.slice(0, qty) }))
        }
    } else if (pt === 'SERIAL') {
        const currentLen = adjustForm.serials.length
        if (qty > currentLen) {
            setAdjustForm(prev => ({ ...prev, serials: [...prev.serials, ...Array(qty - currentLen).fill('')] }))
        } else if (qty < currentLen) {
            setAdjustForm(prev => ({ ...prev, serials: prev.serials.slice(0, qty) }))
        }
    } else if (pt === 'MEDICINAL' && Number(adjustForm.quantity) > 0) {
        // For medicinal, we don't auto-create rows based on quantity, but we could initialize one if empty
        if (adjustForm.batches.length === 0) {
            setAdjustForm(prev => ({ ...prev, batches: [{ batchNo: '', expiryDate: '', quantity: qty }] }))
        }
    }
  }, [adjustForm.quantity, selectedProduct, showAdjust])

  // Load initial data
  useEffect(() => {
    loadWarehouses()
    loadMeta()
  }, [])

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedProductQuery(productQuery.trim())
    }, 250)
    return () => window.clearTimeout(handle)
  }, [productQuery])

  useEffect(() => {
    setCurrentPage(1)
  }, [debouncedProductQuery])

  // Load products when tab is active
  useEffect(() => {
    if (activeTab === 'products') loadProducts()
  }, [activeTab, currentPage, debouncedProductQuery])

  useEffect(() => {
    if (activeTab !== 'products' || products.length === 0) return

    const missingProducts = products.filter(product =>
      !Object.prototype.hasOwnProperty.call(productWarehouseStockMap, product.id) &&
      !loadingWarehouseStockMap[product.id]
    )
    if (missingProducts.length === 0) return

    let cancelled = false

    const loadProductStocks = async () => {
      const missingProductIds = missingProducts.map(product => product.id)
      setLoadingWarehouseStockMap(prev => {
        const next = { ...prev }
        for (const productId of missingProductIds) next[productId] = true
        return next
      })

      try {
        const entries = await Promise.all(
          missingProducts.map(async product => {
            const stocks = await getProductWarehouseStock(product.id)
            return [product.id, Array.isArray(stocks) ? stocks : []] as const
          })
        )

        if (cancelled) return

        setProductWarehouseStockMap(prev => {
          const next = { ...prev }
          for (const [productId, stocks] of entries) {
            next[productId] = stocks
          }
          return next
        })
      } catch (err) {
        if (!cancelled) console.error(err)
      } finally {
        if (cancelled) return
        setLoadingWarehouseStockMap(prev => {
          const next = { ...prev }
          for (const productId of missingProductIds) next[productId] = false
          return next
        })
      }
    }

    void loadProductStocks()

    return () => {
      cancelled = true
    }
  }, [activeTab, products, productWarehouseStockMap, loadingWarehouseStockMap])

  // Load history when tab is active or filters change
  useEffect(() => {
    if (activeTab === 'history') loadHistory()
  }, [activeTab, filters])

  // Load specific warehouse stock when product/warehouse changes in modal
  useEffect(() => {
    if (showAdjust && selectedProduct) {
      let cancelled = false
      setCurrentWarehouseStock(null)
      setProductWarehouseStocks([])
      setAvailableAdjustImeis([])
      setAvailableAdjustSerials([])

      const fetchStockAndDetails = async () => {
        try {
          const requests: Promise<any>[] = [getProductWarehouseStock(selectedProduct.id)]
          if (adjustForm.warehouseId) {
            requests.push(api.get(`/products/${selectedProduct.id}`, { params: { warehouseId: adjustForm.warehouseId } }))
          }

          const [stocks, detailRes] = await Promise.all(requests)
          if (cancelled) return

          const normalizedStocks = Array.isArray(stocks) ? stocks : []
          setProductWarehouseStocks(normalizedStocks)

          if (adjustForm.warehouseId) {
            const whStock = normalizedStocks.find((stock: WarehouseStock) => String(stock.warehouseId) === String(adjustForm.warehouseId))
            setCurrentWarehouseStock(whStock ? whStock.quantity : 0)
            setAvailableAdjustImeis(Array.isArray(detailRes?.data?.imeis) ? detailRes.data.imeis : [])
            setAvailableAdjustSerials(Array.isArray(detailRes?.data?.serials) ? detailRes.data.serials : [])
          } else {
            setCurrentWarehouseStock(null)
            setAvailableAdjustImeis([])
            setAvailableAdjustSerials([])
          }
        } catch (err) {
          if (cancelled) return
          console.error(err)
          setCurrentWarehouseStock(null)
          setProductWarehouseStocks([])
          setAvailableAdjustImeis([])
          setAvailableAdjustSerials([])
        }
      }
      fetchStockAndDetails()
      return () => {
        cancelled = true
      }
    } else {
      setCurrentWarehouseStock(null)
      setProductWarehouseStocks([])
      setAvailableAdjustImeis([])
      setAvailableAdjustSerials([])
    }
  }, [showAdjust, selectedProduct, adjustForm.warehouseId])

  const loadWarehouses = async () => {
    try {
      const data = await getWarehouses()
      setWarehouses(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error(err)
    }
  }

  const loadMeta = async () => {
    try {
      const [c, b] = await Promise.all([getCategories(), getBrands()])
      setCategories(c)
      setBrands(b)
    } catch (err) {
      console.error(err)
    }
  }

  const loadProducts = async () => {
    setLoadingProducts(true)
    try {
      const data = await getProducts({
        paged: true,
        page: currentPage,
        limit: productsPerPage,
        search: debouncedProductQuery || undefined,
      })
      const nextProducts = Array.isArray(data?.data) ? data.data : []
      setProducts(nextProducts)
      setTotalProducts(Number(data?.pagination?.total || 0))
      setProductWarehouseStockMap({})
      setLoadingWarehouseStockMap({})
    } catch (err) {
      console.error(err)
      setProducts([])
      setTotalProducts(0)
    } finally {
      setLoadingProducts(false)
    }
  }

  const refreshProductsWarehouseStock = async (productIds: number[]) => {
    const uniqueProductIds = [...new Set(productIds.map(id => Number(id)).filter(id => id > 0))]
    if (uniqueProductIds.length === 0) return

    setLoadingWarehouseStockMap(prev => {
      const next = { ...prev }
      for (const productId of uniqueProductIds) next[productId] = true
      return next
    })

    try {
      const entries = await Promise.all(
        uniqueProductIds.map(async productId => {
          const stocks = await getProductWarehouseStock(productId)
          return [productId, Array.isArray(stocks) ? stocks : []] as const
        })
      )

      setProductWarehouseStockMap(prev => {
        const next = { ...prev }
        for (const [productId, stocks] of entries) {
          next[productId] = stocks
        }
        return next
      })
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingWarehouseStockMap(prev => {
        const next = { ...prev }
        for (const productId of uniqueProductIds) next[productId] = false
        return next
      })
    }
  }

  const loadHistory = async () => {
    setLoadingHistory(true)
    try {
      let url = '/inventory/movements?limit=100'
      if (filters.type) url += `&type=${filters.type}`
      if (filters.warehouseId) url += `&warehouseId=${filters.warehouseId}`
      
      const { data } = await api.get(url)
      setItems(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingHistory(false)
    }
  }

  const getSignedQuantity = (m: Movement) => {
    const q = Number(m.quantity)
    switch (m.type) {
      case 'SALE':
      case 'TRANSFER_OUT':
      case 'ADJUSTMENT_OUT':
        return -q
      case 'SALE_CANCEL':
      case 'PURCHASE':
      case 'INITIAL':
      case 'TRANSFER_IN':
      case 'ADJUSTMENT_IN':
      case 'ADJUSTMENT':
        return q
      default:
        return q
    }
  }

  const loadKardex = async () => {
    if (!kardexSelectedProduct) return
    setLoadingKardex(true)
    try {
      let url = `/inventory/movements?kardex=true&productId=${kardexSelectedProduct.id}`
      if (kardexFilters.warehouseId) url += `&warehouseId=${kardexFilters.warehouseId}`
      if (kardexFilters.startDate) url += `&startDate=${kardexFilters.startDate}`
      if (kardexFilters.endDate) url += `&endDate=${kardexFilters.endDate}`
      
      const { data } = await api.get(url)
      
      // Calculate running balance
      let balance = 0
      const withBalance = data.map((m: Movement) => {
        const signedQty = getSignedQuantity(m)
        balance += signedQty
        return { ...m, signedQty, balance }
      })
      
      setKardexItems(withBalance)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingKardex(false)
    }
  }

  // Trigger loadKardex when dependencies change
  useEffect(() => {
    if (activeTab === 'kardex' && kardexSelectedProduct) {
      loadKardex()
    }
  }, [activeTab, kardexSelectedProduct, kardexFilters])

  useEffect(() => {
    if (activeTab !== 'kardex' || kardexSelectedProduct) return

    const normalizedSearch = kardexProductSearch.trim()
    if (!normalizedSearch) {
      setKardexSearchResults([])
      setLoadingKardexSearch(false)
      return
    }

    let cancelled = false
    const handle = window.setTimeout(async () => {
      setLoadingKardexSearch(true)
      try {
        const response = await getProducts({
          paged: true,
          page: 1,
          limit: 10,
          search: normalizedSearch,
        })
        if (cancelled) return
        setKardexSearchResults(Array.isArray(response?.data) ? response.data : [])
      } catch (err) {
        if (!cancelled) {
          console.error(err)
          setKardexSearchResults([])
        }
      } finally {
        if (!cancelled) setLoadingKardexSearch(false)
      }
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [activeTab, kardexProductSearch, kardexSelectedProduct])

  const openAdjustModal = (product?: Product) => {
    // Pre-select first warehouse if available
    const defaultWh = warehouses.length > 0 ? String(warehouses[0].id) : ''
    setCurrentWarehouseStock(null)
    setProductWarehouseStocks([])
    setAvailableAdjustImeis([])
    setAvailableAdjustSerials([])
    
    setAdjustForm({
      productId: product ? String(product.id) : '',
      warehouseId: defaultWh,
      type: 'ADJUSTMENT',
      quantity: '',
      notes: '',
      batches: [],
      imeis: [],
      serials: []
    })
    setSelectedProduct(product || null)
    setShowAdjust(true)
  }

  const saveAdjust = async () => {
    if (savingAdjust) {
      alert('El ajuste ya se está procesando, espera un momento')
      return
    }
    if (!adjustForm.productId || !adjustForm.warehouseId || !adjustForm.quantity) {
      alert('Complete los campos requeridos')
      return
    }
    const qty = Number(adjustForm.quantity)
    const pt = (selectedProduct?.productType || 'GENERAL').toUpperCase()
    const debugTraceId = `adj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    // #region debug-point A:adjust-click
    fetch('http://127.0.0.1:7777/event', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 'stock-double-adjust',
        runId: 'pre-fix',
        hypothesisId: 'A',
        traceId: debugTraceId,
        location: 'InventoryMovements.tsx:saveAdjust:start',
        msg: '[DEBUG] saveAdjust invocado desde frontend',
        data: {
          productId: adjustForm.productId,
          warehouseId: adjustForm.warehouseId,
          type: adjustForm.type,
          quantity: adjustForm.quantity,
          productType: pt
        },
        ts: Date.now()
      })
    }).catch(() => {})
    // #endregion

    if (qty > 0) {
        if (pt === 'MEDICINAL') {
            const sum = adjustForm.batches.reduce((acc, b) => acc + Number(b.quantity), 0)
            if (sum !== qty) {
                alert(`La suma de lotes (${sum}) debe coincidir con la cantidad total (${qty})`)
                return
            }
            if (adjustForm.batches.some(b => !b.batchNo || !b.expiryDate)) {
                alert('Complete todos los campos de lote y vencimiento')
                return
            }
        } else if (pt === 'IMEI') {
            if (adjustForm.imeis.some(i => !i.trim())) {
                alert('Complete todos los campos IMEI')
                return
            }
            // Check duplicates in input
            const unique = new Set(adjustForm.imeis.map(i => i.trim().toUpperCase()))
            if (unique.size !== adjustForm.imeis.length) {
                alert('Hay IMEIs duplicados en la entrada')
                return
            }
        } else if (pt === 'SERIAL') {
            if (adjustForm.serials.some(s => !s.trim())) {
                alert('Complete todos los campos de Serie')
                return
            }
            const unique = new Set(adjustForm.serials.map(s => s.trim().toUpperCase()))
            if (unique.size !== adjustForm.serials.length) {
                alert('Hay Series duplicadas en la entrada')
                return
            }
        }
    }

    if (qty < 0) {
      const requiredCount = Math.abs(qty)
      if (pt === 'IMEI') {
        if (adjustForm.imeis.some(i => !i.trim())) {
          alert('Seleccione todos los IMEIs que se van a descontar')
          return
        }
        const unique = new Set(adjustForm.imeis.map(i => i.trim().toUpperCase()))
        if (unique.size !== adjustForm.imeis.length || adjustForm.imeis.length !== requiredCount) {
          alert(`Debes seleccionar exactamente ${requiredCount} IMEI(s) diferentes`)
          return
        }
      } else if (pt === 'SERIAL') {
        if (adjustForm.serials.some(s => !s.trim())) {
          alert('Seleccione todas las series que se van a descontar')
          return
        }
        const unique = new Set(adjustForm.serials.map(s => s.trim().toUpperCase()))
        if (unique.size !== adjustForm.serials.length || adjustForm.serials.length !== requiredCount) {
          alert(`Debes seleccionar exactamente ${requiredCount} serie(s) diferentes`)
          return
        }
      }
    }
    
    try {
      setSavingAdjust(true)
      const adjustedImeis = qty < 0 ? adjustForm.imeis.map(i => i.trim().toUpperCase()).filter(Boolean) : []
      const adjustedSerials = qty < 0 ? adjustForm.serials.map(s => s.trim().toUpperCase()).filter(Boolean) : []

      // #region debug-point A:adjust-request
      fetch('http://127.0.0.1:7777/event', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'stock-double-adjust',
          runId: 'pre-fix',
          hypothesisId: 'A',
          traceId: debugTraceId,
          location: 'InventoryMovements.tsx:saveAdjust:request',
          msg: '[DEBUG] Enviando POST /inventory/adjust',
          data: {
            productId: adjustForm.productId,
            warehouseId: adjustForm.warehouseId,
            type: adjustForm.type,
            quantity: adjustForm.quantity,
            productType: selectedProduct?.productType || 'GENERAL'
          },
          ts: Date.now()
        })
      }).catch(() => {})
      // #endregion
      await api.post('/inventory/adjust', {
        ...adjustForm,
        debugTraceId,
        productType: selectedProduct?.productType || 'GENERAL'
      })

      // #region debug-point A:adjust-success
      fetch('http://127.0.0.1:7777/event', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'stock-double-adjust',
          runId: 'pre-fix',
          hypothesisId: 'A',
          traceId: debugTraceId,
          location: 'InventoryMovements.tsx:saveAdjust:success',
          msg: '[DEBUG] POST /inventory/adjust respondio OK',
          data: {
            productId: adjustForm.productId,
            warehouseId: adjustForm.warehouseId,
            quantity: adjustForm.quantity
          },
          ts: Date.now()
        })
      }).catch(() => {})
      // #endregion

      if (adjustedImeis.length > 0) {
        setAvailableAdjustImeis(prev => prev.filter(imei => !adjustedImeis.includes(String(imei).trim().toUpperCase())))
      }
      if (adjustedSerials.length > 0) {
        setAvailableAdjustSerials(prev => prev.filter(serial => !adjustedSerials.includes(String(serial).trim().toUpperCase())))
      }

      alert('Ajuste registrado correctamente')
      setShowAdjust(false)
      if (activeTab === 'products') {
        await loadProducts()
        await refreshProductsWarehouseStock([Number(adjustForm.productId)])
      }
      if (activeTab === 'history') {
        loadHistory()
      }
    } catch (err: any) {
      // #region debug-point D:adjust-error
      fetch('http://127.0.0.1:7777/event', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'stock-double-adjust',
          runId: 'pre-fix',
          hypothesisId: 'D',
          traceId: debugTraceId,
          location: 'InventoryMovements.tsx:saveAdjust:error',
          msg: '[DEBUG] POST /inventory/adjust fallo en frontend',
          data: {
            productId: adjustForm.productId,
            warehouseId: adjustForm.warehouseId,
            quantity: adjustForm.quantity,
            error: err?.response?.data?.error || err?.message || 'unknown'
          },
          ts: Date.now()
        })
      }).catch(() => {})
      // #endregion
      alert(err?.response?.data?.error || 'Error al registrar ajuste')
    } finally {
      setSavingAdjust(false)
    }
  }

  const getTypeName = (type: string) => {
    switch(type) {
      case 'SALE': return 'VENTA'
      case 'PURCHASE': return 'COMPRA'
      case 'INITIAL': return 'INICIAL'
      case 'TRANSFER': return 'TRANSFERENCIA'
      case 'TRANSFER_IN': return 'TRANSFERENCIA ENTRADA'
      case 'TRANSFER_OUT': return 'TRANSFERENCIA SALIDA'
      case 'ADJUSTMENT': return 'AJUSTE'
      case 'ADJUSTMENT_IN': return 'AJUSTE ENTRADA'
      case 'ADJUSTMENT_OUT': return 'AJUSTE SALIDA'
      case 'SALE_CANCEL': return 'CANCELACIÓN VENTA'
      default: return type
    }
  }

  const getMovementTrackingDetail = (notes?: string) => {
    if (!notes) return ''

    const parts = String(notes)
      .split(' | ')
      .map(part => part.trim())
      .filter(Boolean)

    return parts
      .filter(part =>
        part.startsWith('IMEIs ajustados:') ||
        part.startsWith('Series ajustadas:') ||
        part.startsWith('IMEIs ingresados:') ||
        part.startsWith('Series ingresadas:') ||
        part.startsWith('Lotes:')
      )
      .join(' | ')
  }

  const getMovementGeneralNotes = (notes?: string) => {
    if (!notes) return ''

    const parts = String(notes)
      .split(' | ')
      .map(part => part.trim())
      .filter(Boolean)

    return parts
      .filter(part =>
        !part.startsWith('IMEIs ajustados:') &&
        !part.startsWith('Series ajustadas:') &&
        !part.startsWith('IMEIs ingresados:') &&
        !part.startsWith('Series ingresadas:') &&
        !part.startsWith('Lotes:')
      )
      .join(' | ')
  }

  const totalPages = useMemo(() => Math.max(1, Math.ceil(totalProducts / productsPerPage)), [totalProducts])

  const categoryMap = useMemo(() => {
    const map: Record<number, string> = {}
    categories.forEach(c => map[c.id] = c.name)
    return map
  }, [categories])

  const brandMap = useMemo(() => {
    const map: Record<number, string> = {}
    brands.forEach(b => map[b.id] = b.name)
    return map
  }, [brands])

  const renderWarehouseStockBreakdown = (productId: number, globalStock: number, compact = false) => {
    const hasLoadedStocks = Object.prototype.hasOwnProperty.call(productWarehouseStockMap, productId)
    const stocks = productWarehouseStockMap[productId] || []
    const isLoadingStocks = Boolean(loadingWarehouseStockMap[productId]) || !hasLoadedStocks

    return (
      <div style={{ display: 'grid', gap: compact ? 2 : 4 }}>
        {isLoadingStocks ? (
          <div style={{ fontSize: compact ? 11 : 12, color: 'var(--muted)' }}>
            Cargando stock por tienda...
          </div>
        ) : stocks.length > 0 ? (
          stocks.map(stock => (
            <div
              key={`${productId}-${stock.warehouseId}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                fontSize: compact ? 11 : 12,
                color: 'var(--muted)'
              }}
            >
              <span>{stock.warehouseName}</span>
              <strong style={{ color: Number(stock.quantity || 0) > 0 ? '#10b981' : '#ef4444' }}>
                {stock.quantity}
              </strong>
            </div>
          ))
        ) : (
          <div style={{ fontSize: compact ? 11 : 12, color: 'var(--muted)' }}>
            Sin stock por tienda registrado
          </div>
        )}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            fontSize: compact ? 11 : 12,
            paddingTop: compact ? 4 : 6,
            borderTop: '1px dashed var(--border)'
          }}
        >
          <span style={{ color: 'var(--muted)', fontWeight: 600 }}>Stock Global</span>
          <strong style={{ color: globalStock > 0 ? '#10b981' : '#ef4444' }}>{globalStock}</strong>
        </div>
      </div>
    )
  }

  const totalAdjustStock = useMemo(() => {
    if (productWarehouseStocks.length > 0) {
      return productWarehouseStocks.reduce((sum, stock) => sum + Number(stock.quantity || 0), 0)
    }
    return Number(selectedProduct?.stock || 0)
  }, [productWarehouseStocks, selectedProduct])

  return (
    <div className="page-container" style={{ padding: 20 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ marginBottom: 16 }}>Gestión de Inventario</h2>
        
        <div style={{ 
          display: 'flex', 
          gap: 12, 
          paddingBottom: 0,
          marginBottom: 20,
          borderBottom: '1px solid var(--border)',
          overflowX: 'auto'
        }}>
          <button 
            onClick={() => setActiveTab('products')}
            style={{ 
              padding: '12px 20px', 
              border: 'none',
              background: 'transparent',
              color: activeTab === 'products' ? 'var(--primary)' : 'var(--muted)',
              borderBottom: activeTab === 'products' ? '2px solid var(--primary)' : '2px solid transparent',
              cursor: 'pointer',
              fontWeight: activeTab === 'products' ? 600 : 500,
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.2s ease',
              marginBottom: -1
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24, borderRadius: 6,
              background: activeTab === 'products' ? 'rgba(var(--primary-rgb), 0.1)' : 'var(--surface)',
              color: 'inherit'
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                <line x1="12" y1="22.08" x2="12" y2="12"></line>
              </svg>
            </div>
            Ajustar Stock
          </button>
          
          <button 
            onClick={() => setActiveTab('history')}
            style={{ 
              padding: '12px 20px', 
              border: 'none',
              background: 'transparent',
              color: activeTab === 'history' ? '#f59e0b' : 'var(--muted)',
              borderBottom: activeTab === 'history' ? '2px solid #f59e0b' : '2px solid transparent',
              cursor: 'pointer',
              fontWeight: activeTab === 'history' ? 600 : 500,
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.2s ease',
              marginBottom: -1
            }}
          >
             <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24, borderRadius: 6,
              background: activeTab === 'history' ? '#fef3c7' : 'var(--surface)',
              color: 'inherit'
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"></circle>
                <polyline points="12 6 12 12 16 14"></polyline>
              </svg>
            </div>
            Historial de Movimientos
          </button>
          
          <button 
            onClick={() => setActiveTab('kardex')}
            style={{ 
              padding: '12px 20px', 
              border: 'none',
              background: 'transparent',
              color: activeTab === 'kardex' ? '#10b981' : 'var(--muted)',
              borderBottom: activeTab === 'kardex' ? '2px solid #10b981' : '2px solid transparent',
              cursor: 'pointer',
              fontWeight: activeTab === 'kardex' ? 600 : 500,
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.2s ease',
              marginBottom: -1
            }}
          >
             <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24, borderRadius: 6,
              background: activeTab === 'kardex' ? '#d1fae5' : 'var(--surface)',
              color: 'inherit'
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
            </div>
            Kardex (Auditoría)
          </button>
        </div>
      </div>

      {activeTab === 'products' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input 
                placeholder="Buscar por codigo, SKU, nombre o detalle..." 
                value={productQuery} 
                onChange={e => setProductQuery(e.target.value)} 
                style={{ width: 400, maxWidth: '100%', padding: 8, borderRadius: 6, border: '1px solid var(--border)' }}
              />
              <MobileBarcodeScannerButton
                buttonLabel="Escanear"
                modalTitle="Escanear producto para ajuste"
                onDetected={value => setProductQuery(value)}
              />
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {loadingProducts
                  ? 'Buscando productos...'
                  : `${products.length > 0 ? ((currentPage - 1) * productsPerPage) + 1 : 0} - ${Math.min(currentPage * productsPerPage, totalProducts)} de ${totalProducts}`}
              </div>
            </div>
            <div className="view-toggle">
              <button
                className={`toggle-btn ${view === 'grid' ? 'active' : ''}`}
                onClick={() => setView('grid')}
                aria-label="Vista grid"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z" /></svg>
              </button>
              <button
                className={`toggle-btn ${view === 'list' ? 'active' : ''}`}
                onClick={() => setView('list')}
                aria-label="Vista lista"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z" /></svg>
              </button>
            </div>
          </div>

          {loadingProducts ? (
            <div style={{ textAlign: 'center', padding: 40 }}>Cargando productos...</div>
          ) : (
            <>
              {totalProducts > productsPerPage && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Pagina {currentPage} de {totalPages} - {productsPerPage} productos por pagina
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="small-btn" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>Primera</button>
                    <button className="small-btn" onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1}>Anterior</button>
                    <button className="small-btn" onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages}>Siguiente</button>
                    <button className="small-btn" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}>Ultima</button>
                  </div>
                </div>
              )}
              {view === 'grid' ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 16 }}>
                  {products.map(p => (
                    <div key={p.id} style={{ background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ display: 'flex', gap: 10 }}>
                        <img 
                          src={p.imageUrl || 'https://via.placeholder.com/64x64?text=IMG'} 
                          alt={p.name} 
                          style={{ width: 64, height: 64, borderRadius: 8, objectFit: 'cover' }}
                        />
                        <div style={{ flex: 1, overflow: 'hidden' }}>
                          <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={p.name}>{p.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>SKU: {p.sku}</div>
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>COD: {p.productCode || '-'}</div>
                          <div style={{ fontSize: 12, color: 'var(--muted)', display: '-webkit-box', WebkitLineClamp: 2 as any, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} title={p.description || ''}>
                            DETALLE: {p.description || '-'}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                            {p.categoryId ? categoryMap[p.categoryId] : ''} 
                            {p.brandId ? ` • ${brandMap[p.brandId]}` : ''}
                          </div>
                        </div>
                      </div>
                      
                      <div style={{ background: 'var(--surface)', padding: '8px 10px', borderRadius: 8 }}>
                        <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginBottom: 6 }}>Stock por tienda</div>
                        {renderWarehouseStockBreakdown(p.id, p.stock)}
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{formatMoney(p.price, currency)}</div>
                        <button 
                          onClick={() => openAdjustModal(p)}
                          style={{ 
                            padding: '6px 12px', 
                            borderRadius: 6, 
                            background: '#e65100', 
                            color: 'white', 
                            border: 'none', 
                            fontSize: 12,
                            cursor: 'pointer',
                            fontWeight: 500
                          }}
                        >
                          Ajustar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ background: 'var(--surface)' }}>
                      <tr>
                        <th style={{ padding: 10, textAlign: 'left' }}>Producto</th>
                        <th style={{ padding: 10, textAlign: 'left' }}>Categoría / Marca</th>
                        <th style={{ padding: 10, textAlign: 'right' }}>Costo</th>
                        <th style={{ padding: 10, textAlign: 'right' }}>Precio</th>
                        <th style={{ padding: 10, textAlign: 'left' }}>Stock por tienda / Global</th>
                        <th style={{ padding: 10, textAlign: 'right' }}>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                  {products.map(p => (
                        <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: 10 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <img src={p.imageUrl || 'https://via.placeholder.com/32x32?text=IMG'} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover' }} />
                              <div>
                                <div style={{ fontWeight: 500 }}>{p.name}</div>
                                <div style={{ fontSize: 11, color: 'var(--muted)' }}>SKU: {p.sku}</div>
                                <div style={{ fontSize: 11, color: 'var(--muted)' }}>COD: {p.productCode || '-'}</div>
                                <div style={{ fontSize: 11, color: 'var(--muted)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.description || ''}>
                                  DETALLE: {p.description || '-'}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: 10, fontSize: 13 }}>
                            {p.categoryId ? categoryMap[p.categoryId] : '-'}
                            <br />
                            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{p.brandId ? brandMap[p.brandId] : '-'}</span>
                          </td>
                          <td style={{ padding: 10, textAlign: 'right', fontSize: 13 }}>{formatMoney(p.cost || 0, currency)}</td>
                          <td style={{ padding: 10, textAlign: 'right', fontSize: 13 }}>{formatMoney(p.price, currency)}</td>
                          <td style={{ padding: 10, minWidth: 260 }}>
                            {renderWarehouseStockBreakdown(p.id, p.stock, true)}
                          </td>
                          <td style={{ padding: 10, textAlign: 'right' }}>
                            <button 
                              onClick={() => openAdjustModal(p)}
                              style={{ 
                                padding: '6px 12px', 
                                borderRadius: 6, 
                                background: '#e65100', 
                                color: 'white', 
                                border: 'none', 
                                fontSize: 12,
                                cursor: 'pointer'
                              }}
                            >
                              Ajustar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <select 
                value={filters.type} 
                onChange={e => setFilters({...filters, type: e.target.value})}
                style={{ padding: 8, borderRadius: 4, border: '1px solid var(--border)' }}
              >
                <option value="">Todos los Tipos</option>
                <option value="INITIAL">INICIAL</option>
                <option value="PURCHASE">COMPRA</option>
                <option value="SALE">VENTA</option>
                <option value="TRANSFER">TRANSFERENCIA</option>
                <option value="ADJUSTMENT">AJUSTE</option>
                <option value="SALE_CANCEL">CANCELACIÓN VENTA</option>
              </select>
              <select
                value={filters.warehouseId}
                onChange={e => setFilters({...filters, warehouseId: e.target.value})}
                style={{ padding: 8, borderRadius: 4, border: '1px solid var(--border)' }}
              >
                <option value="">Todos los Almacenes</option>
                {warehouses.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
            <button onClick={loadHistory} className="primary-btn">Refrescar</button>
          </div>

          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
              <thead style={{ background: 'var(--surface)' }}>
                <tr>
                  <th style={{ padding: 12, textAlign: 'left' }}>Fecha</th>
                  <th style={{ padding: 12, textAlign: 'left' }}>Tipo</th>
                  <th style={{ padding: 12, textAlign: 'left' }}>Producto</th>
                  <th style={{ padding: 12, textAlign: 'left' }}>Almacén</th>
                  <th style={{ padding: 12, textAlign: 'right' }}>Cantidad</th>
                  <th style={{ padding: 12, textAlign: 'left' }}>Detalle</th>
                  <th style={{ padding: 12, textAlign: 'left' }}>Referencia</th>
                  <th style={{ padding: 12, textAlign: 'left' }}>Usuario</th>
                </tr>
              </thead>
              <tbody>
                {loadingHistory ? (
                  <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center' }}>Cargando...</td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center' }}>No hay movimientos recientes</td></tr>
                ) : items.map(m => (
                  <tr key={m.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: 12, fontSize: 13 }}>
                      {new Date(m.date).toLocaleString()}
                    </td>
                    <td style={{ padding: 12 }}>
                      <span style={{ 
                        padding: '4px 8px', 
                        borderRadius: 4, 
                        fontSize: 12, 
                        fontWeight: 600,
                        background: 
                          m.type === 'SALE' ? '#ffebee' : 
                          m.type === 'PURCHASE' ? '#e8f5e9' : 
                          m.type === 'INITIAL' ? '#e3f2fd' : 
                          '#f5f5f5',
                        color: 
                          m.type === 'SALE' ? '#c62828' : 
                          m.type === 'PURCHASE' ? '#2e7d32' : 
                          m.type === 'INITIAL' ? '#1565c0' : 
                          '#616161'
                      }}>
                        {getTypeName(m.type)}
                      </span>
                    </td>
                    <td style={{ padding: 12 }}>
                      <div style={{ fontWeight: 500 }}>{m.product_name}</div>
                      <div style={{ fontSize: 12, color: 'gray' }}>{m.product_code}</div>
                    </td>
                    <td style={{ padding: 12 }}>{m.warehouse_name}</td>
                    <td style={{ padding: 12, textAlign: 'right', fontWeight: 'bold', color: m.quantity > 0 ? 'green' : 'red' }}>
                      {m.quantity > 0 ? '+' : ''}{m.quantity}
                    </td>
                    <td style={{ padding: 12, fontSize: 12, maxWidth: 260 }}>
                      <div
                        style={{
                          color: getMovementTrackingDetail(m.notes) ? 'var(--text)' : 'var(--muted)',
                          whiteSpace: 'normal',
                          wordBreak: 'break-word'
                        }}
                        title={getMovementTrackingDetail(m.notes)}
                      >
                        {getMovementTrackingDetail(m.notes) || '-'}
                      </div>
                    </td>
                    <td style={{ padding: 12, fontSize: 13 }}>
                      {m.reference_id ? `#${m.reference_id}` : '-'}
                      {getMovementGeneralNotes(m.notes) && <div style={{ fontSize: 11, color: 'gray' }}>{getMovementGeneralNotes(m.notes)}</div>}
                    </td>
                    <td style={{ padding: 12, fontSize: 13 }}>{m.user_name || 'Sistema'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'kardex' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ background: 'var(--modal)', padding: 20, borderRadius: 12, border: '1px solid var(--border)' }}>
            <h3 style={{ marginTop: 0, marginBottom: 16 }}>Filtros del Kardex</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              {/* Product Selector */}
              <div style={{ position: 'relative' }}>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 6, fontWeight: 500 }}>Producto (Requerido)</label>
                <input
                  placeholder="Buscar producto..."
                  value={kardexSelectedProduct ? `${kardexSelectedProduct.name} (${kardexSelectedProduct.sku})` : kardexProductSearch}
                  onChange={e => {
                    setKardexProductSearch(e.target.value)
                    setKardexSelectedProduct(null)
                  }}
                  style={{ width: '100%', padding: '10px', borderRadius: 6, border: '1px solid var(--border)' }}
                />
                {kardexSelectedProduct && (
                  <button 
                    onClick={() => { setKardexSelectedProduct(null); setKardexProductSearch(''); }}
                    style={{ position: 'absolute', right: 10, top: 32, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}
                  >✕</button>
                )}
                {!kardexSelectedProduct && kardexProductSearch && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: 200, overflowY: 'auto', background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 6, zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                    {loadingKardexSearch ? (
                      <div style={{ padding: '12px', color: 'var(--muted)', fontSize: 12 }}>
                        Buscando productos...
                      </div>
                    ) : kardexSearchResults.length === 0 ? (
                      <div style={{ padding: '12px', color: 'var(--muted)', fontSize: 12 }}>
                        Sin resultados
                      </div>
                    ) : kardexSearchResults.map(p => (
                        <div 
                          key={p.id}
                          onClick={() => { setKardexSelectedProduct(p); setKardexProductSearch(''); setKardexSearchResults([]) }}
                          style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                          onMouseOver={e => e.currentTarget.style.background = 'var(--surface)'}
                          onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <div style={{ fontWeight: 500 }}>{p.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.sku}</div>
                        </div>
                      ))
                    }
                  </div>
                )}
              </div>

              {/* Warehouse Selector */}
              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 6, fontWeight: 500 }}>Almacén</label>
                <select
                  value={kardexFilters.warehouseId}
                  onChange={e => setKardexFilters({...kardexFilters, warehouseId: e.target.value})}
                  style={{ width: '100%', padding: '10px', borderRadius: 6, border: '1px solid var(--border)' }}
                >
                  <option value="">Todos los Almacenes</option>
                  {warehouses.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>

              {/* Date Range */}
              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 6, fontWeight: 500 }}>Desde</label>
                <input 
                  type="date" 
                  value={kardexFilters.startDate}
                  onChange={e => setKardexFilters({...kardexFilters, startDate: e.target.value})}
                  style={{ width: '100%', padding: '10px', borderRadius: 6, border: '1px solid var(--border)' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 6, fontWeight: 500 }}>Hasta</label>
                <input 
                  type="date" 
                  value={kardexFilters.endDate}
                  onChange={e => setKardexFilters({...kardexFilters, endDate: e.target.value})}
                  style={{ width: '100%', padding: '10px', borderRadius: 6, border: '1px solid var(--border)' }}
                />
              </div>
            </div>
          </div>

          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1120 }}>
              <thead style={{ background: 'var(--surface)' }}>
                <tr>
                  <th style={{ padding: 12, textAlign: 'left' }}>Fecha</th>
                  <th style={{ padding: 12, textAlign: 'left' }}>Tipo</th>
                  <th style={{ padding: 12, textAlign: 'left' }}>Doc / Ref</th>
                  <th style={{ padding: 12, textAlign: 'right' }}>Entrada</th>
                  <th style={{ padding: 12, textAlign: 'right' }}>Salida</th>
                  <th style={{ padding: 12, textAlign: 'right', background: 'rgba(0,0,0,0.03)' }}>Saldo</th>
                  <th style={{ padding: 12, textAlign: 'left' }}>Detalle</th>
                  <th style={{ padding: 12, textAlign: 'left' }}>Almacén</th>
                  <th style={{ padding: 12, textAlign: 'left' }}>Usuario</th>
                  <th style={{ padding: 12, textAlign: 'left' }}>Notas</th>
                </tr>
              </thead>
              <tbody>
                {!kardexSelectedProduct ? (
                  <tr><td colSpan={10} style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Seleccione un producto para ver su Kardex</td></tr>
                ) : loadingKardex ? (
                  <tr><td colSpan={10} style={{ padding: 40, textAlign: 'center' }}>Cargando Kardex...</td></tr>
                ) : kardexItems.length === 0 ? (
                  <tr><td colSpan={10} style={{ padding: 40, textAlign: 'center' }}>No hay movimientos registrados en este periodo</td></tr>
                ) : kardexItems.map(m => (
                  <tr key={m.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: 12, fontSize: 13 }}>{new Date(m.date).toLocaleString()}</td>
                    <td style={{ padding: 12 }}>
                      <span style={{ 
                        padding: '4px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                        background: m.type.includes('IN') || m.type === 'PURCHASE' || m.type === 'INITIAL' || m.type === 'SALE_CANCEL' ? '#e8f5e9' : '#ffebee',
                        color: m.type.includes('IN') || m.type === 'PURCHASE' || m.type === 'INITIAL' || m.type === 'SALE_CANCEL' ? '#2e7d32' : '#c62828'
                      }}>
                        {getTypeName(m.type)}
                      </span>
                    </td>
                    <td style={{ padding: 12, fontSize: 13 }}>{m.reference_id ? `#${m.reference_id}` : '-'}</td>
                    <td style={{ padding: 12, textAlign: 'right', color: 'green', fontWeight: m.signedQty > 0 ? 600 : 400 }}>
                      {m.signedQty > 0 ? m.signedQty : '-'}
                    </td>
                    <td style={{ padding: 12, textAlign: 'right', color: 'red', fontWeight: m.signedQty < 0 ? 600 : 400 }}>
                      {m.signedQty < 0 ? Math.abs(m.signedQty) : '-'}
                    </td>
                    <td style={{ padding: 12, textAlign: 'right', fontWeight: 'bold', background: 'rgba(0,0,0,0.03)' }}>
                      {m.balance}
                    </td>
                    <td style={{ padding: 12, fontSize: 12, maxWidth: 260 }}>
                      <div
                        style={{
                          color: getMovementTrackingDetail(m.notes) ? 'var(--text)' : 'var(--muted)',
                          whiteSpace: 'normal',
                          wordBreak: 'break-word'
                        }}
                        title={getMovementTrackingDetail(m.notes)}
                      >
                        {getMovementTrackingDetail(m.notes) || '-'}
                      </div>
                    </td>
                    <td style={{ padding: 12, fontSize: 13 }}>{m.warehouse_name}</td>
                    <td style={{ padding: 12, fontSize: 13 }}>{m.user_name || 'Sistema'}</td>
                    <td style={{ padding: 12, fontSize: 12, color: 'var(--muted)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={getMovementGeneralNotes(m.notes)}>
                      {getMovementGeneralNotes(m.notes) || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      {showAdjust && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--modal)', width: 400, padding: 20, borderRadius: 12, border: '1px solid var(--border)' }}>
            <h3 style={{ margin: 0, marginBottom: 16 }}>Nuevo Ajuste de Inventario</h3>
            
            <div style={{ display: 'grid', gap: 12 }}>
              {selectedProduct ? (
                <div style={{ background: 'var(--surface)', padding: 10, borderRadius: 8, display: 'flex', gap: 10 }}>
                   <img 
                      src={selectedProduct.imageUrl || 'https://via.placeholder.com/48x48?text=IMG'} 
                      alt="" 
                      style={{ width: 48, height: 48, borderRadius: 6, objectFit: 'cover' }}
                    />
                    <div>
                      <div style={{ fontWeight: 600 }}>{selectedProduct.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>SKU: {selectedProduct.sku}</div>
                      {productWarehouseStocks.length > 0 && (
                        <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>
                            Stock por tienda
                          </div>
                          {productWarehouseStocks.map(stock => (
                            <div
                              key={stock.warehouseId}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: 12,
                                fontSize: 12,
                                padding: '4px 0',
                                borderBottom: '1px dashed var(--border)'
                              }}
                            >
                              <span>{stock.warehouseName}</span>
                              <strong style={{ color: Number(stock.quantity || 0) > 0 ? '#10b981' : '#ef4444' }}>
                                {stock.quantity}
                              </strong>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ fontSize: 12, fontWeight: 'bold', color: totalAdjustStock > 0 ? '#10b981' : '#ef4444', marginTop: 8 }}>
                        Stock Global: {totalAdjustStock}
                      </div>
                    </div>
                </div>
              ) : (
                <div>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Producto ID (Error: No seleccionado)</label>
                  <input value={adjustForm.productId} readOnly style={{ width: '100%', padding: 8 }} />
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Almacén</label>
                <select 
                  style={{ width: '100%', padding: 8 }}
                  value={adjustForm.warehouseId}
                  onChange={e => setAdjustForm({...adjustForm, warehouseId: e.target.value})}
                >
                  <option value="">-- Seleccionar --</option>
                  {warehouses.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
                {currentWarehouseStock !== null && (
                  <div style={{ fontSize: 12, marginTop: 4, color: 'var(--muted)' }}>
                    Stock actual en este almacén: <strong>{currentWarehouseStock}</strong>
                  </div>
                )}
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Tipo</label>
                <select 
                  style={{ width: '100%', padding: 8 }}
                  value={adjustForm.type}
                  onChange={e => setAdjustForm({...adjustForm, type: e.target.value})}
                >
                  <option value="INITIAL">INICIAL (Stock de apertura)</option>
                  <option value="ADJUSTMENT">AJUSTE (Corrección +/-)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Cantidad (Positiva o Negativa)</label>
                <input 
                  type="number"
                  style={{ width: '100%', padding: 8 }}
                  placeholder="Ej: 10 o -5"
                  value={adjustForm.quantity}
                  onChange={e => setAdjustForm({...adjustForm, quantity: e.target.value})}
                />
              </div>

              {/* Dynamic inputs for tracked product details */}
              {selectedProduct && Number(adjustForm.quantity) > 0 && (
                <>
                  {(selectedProduct.productType === 'MEDICINAL') && (
                    <div style={{ background: 'var(--surface)', padding: 10, borderRadius: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <label style={{ fontSize: 12, fontWeight: 600 }}>Lotes</label>
                        <button onClick={addBatch} style={{ fontSize: 11, padding: '2px 6px' }}>+ Agregar Lote</button>
                      </div>
                      {adjustForm.batches.map((b, idx) => (
                        <div key={idx} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                          <input 
                            placeholder="Lote" 
                            value={b.batchNo} 
                            onChange={e => updateBatch(idx, 'batchNo', e.target.value)}
                            style={{ width: '35%', padding: 6, fontSize: 12 }} 
                          />
                          <input 
                            type="date" 
                            value={b.expiryDate} 
                            onChange={e => updateBatch(idx, 'expiryDate', e.target.value)}
                            style={{ width: '35%', padding: 6, fontSize: 12 }} 
                          />
                          <input 
                            type="number" 
                            placeholder="Cant." 
                            value={b.quantity} 
                            onChange={e => updateBatch(idx, 'quantity', e.target.value)}
                            style={{ width: '20%', padding: 6, fontSize: 12 }} 
                          />
                          <button onClick={() => removeBatch(idx)} style={{ color: 'red', border: 'none', background: 'none' }}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {(selectedProduct.productType === 'IMEI') && (
                    <div style={{ background: 'var(--surface)', padding: 10, borderRadius: 8 }}>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Códigos IMEI ({adjustForm.imeis.length})</label>
                      {adjustForm.imeis.map((imei, idx) => (
                        <input 
                          key={idx}
                          placeholder={`IMEI #${idx + 1}`}
                          value={imei}
                          onChange={e => updateImei(idx, e.target.value)}
                          style={{ width: '100%', padding: 6, fontSize: 12, marginBottom: 6, display: 'block' }}
                        />
                      ))}
                    </div>
                  )}

                  {(selectedProduct.productType === 'SERIAL') && (
                    <div style={{ background: 'var(--surface)', padding: 10, borderRadius: 8 }}>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Números de Serie ({adjustForm.serials.length})</label>
                      {adjustForm.serials.map((serial, idx) => (
                        <input 
                          key={idx}
                          placeholder={`Serie #${idx + 1}`}
                          value={serial}
                          onChange={e => updateSerial(idx, e.target.value)}
                          style={{ width: '100%', padding: 6, fontSize: 12, marginBottom: 6, display: 'block' }}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}

              {selectedProduct && Number(adjustForm.quantity) < 0 && selectedProduct.productType === 'IMEI' && (
                <div style={{ background: 'var(--surface)', padding: 10, borderRadius: 8 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                    IMEIs a descontar ({adjustForm.imeis.length})
                  </label>
                  {adjustForm.imeis.map((imei, idx) => {
                    const selectedValues = adjustForm.imeis.filter((value, valueIdx) => valueIdx !== idx && value)
                    const options = availableAdjustImeis.filter(option => !selectedValues.includes(option) || option === imei)
                    return (
                      <select
                        key={idx}
                        value={imei}
                        onChange={e => updateImei(idx, e.target.value)}
                        style={{ width: '100%', padding: 6, fontSize: 12, marginBottom: 6, display: 'block' }}
                      >
                        <option value="">Seleccionar IMEI...</option>
                        {options.map(option => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    )
                  })}
                </div>
              )}

              {selectedProduct && Number(adjustForm.quantity) < 0 && selectedProduct.productType === 'SERIAL' && (
                <div style={{ background: 'var(--surface)', padding: 10, borderRadius: 8 }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                    Series a descontar ({adjustForm.serials.length})
                  </label>
                  {adjustForm.serials.map((serial, idx) => {
                    const selectedValues = adjustForm.serials.filter((value, valueIdx) => valueIdx !== idx && value)
                    const options = availableAdjustSerials.filter(option => !selectedValues.includes(option) || option === serial)
                    return (
                      <select
                        key={idx}
                        value={serial}
                        onChange={e => updateSerial(idx, e.target.value)}
                        style={{ width: '100%', padding: 6, fontSize: 12, marginBottom: 6, display: 'block' }}
                      >
                        <option value="">Seleccionar Serie...</option>
                        {options.map(option => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    )
                  })}
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Notas</label>
                <textarea 
                  rows={2}
                  style={{ width: '100%', padding: 8 }}
                  value={adjustForm.notes}
                  onChange={e => setAdjustForm({...adjustForm, notes: e.target.value})}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowAdjust(false)} disabled={savingAdjust}>Cancelar</button>
              <button className="primary-btn" onClick={saveAdjust} disabled={savingAdjust}>
                {savingAdjust ? 'Guardando ajuste...' : 'Guardar Ajuste'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
