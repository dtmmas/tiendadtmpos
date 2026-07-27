import { useState, useEffect } from 'react'
import { api } from '../api'
import { useAuthStore } from '../store/auth'
import { useConfigStore } from '../store/config'
import { formatDateTime } from '../utils/date'
import { getWarehouseHighlightStyle } from '../utils/warehouseHighlight'
import { buildPrintLogoHtml } from '../utils/printBranding'
import MobileBarcodeScannerButton from '../components/MobileBarcodeScannerButton'

function escapePrintHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

interface Warehouse {
  id: number
  name: string
}

interface Product {
  id: number
  name: string
  sku: string
  stock: number
  imageUrl?: string
  productCode?: string
  description?: string
  productType?: string
}

interface TransferItem {
  productId: number
  name: string
  sku?: string
  productCode?: string
  description?: string
  quantity: number
  stockAtSource: number
  batchNo?: string
  expiryDate?: string
  imei?: string
  serial?: string
  // UI helpers
  availableBatches?: any[]
  availableImeis?: any[]
  availableSerials?: any[]
}

interface ProductBatchOption {
  batchNo: string
  expiryDate?: string
  quantity: number
}

interface ProductDetailResponse {
  id: number
  name: string
  sku?: string
  productCode?: string
  description?: string
  productType?: string
  stock: number
  batches?: ProductBatchOption[]
  imeis?: string[]
  serials?: string[]
}

interface TrackedProductSelection {
  product: Product
  productType: 'IMEI' | 'SERIAL'
  availableImeis: string[]
  availableSerials: string[]
  selectedImeis: string[]
  selectedSerials: string[]
}

interface Transfer {
  id: number
  source_warehouse_id: number
  destination_warehouse_id: number
  source_warehouse_name: string
  destination_warehouse_name: string
  status: string
  created_at: string
  notes?: string
  created_by_user?: string
  total_quantity: number
  destination_movement_summary?: string
}

interface TransferDetailItem {
  id: number
  product_id: number
  product_name: string
  sku?: string
  product_code?: string
  description?: string
  quantity: number
  batch_no?: string
  imei?: string
  serial?: string
  destination_movement_type?: string
}

interface TransferDetail extends Transfer {
  items: TransferDetailItem[]
}

export default function Transfers() {
  const [view, setView] = useState<'list' | 'create'>('list')
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [isMobileViewport, setIsMobileViewport] = useState(false)
  
  const [searchTerm, setSearchTerm] = useState('')
  const [filterWarehouse, setFilterWarehouse] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  // Create Form State
  const [sourceId, setSourceId] = useState<number | null>(null)
  const [destId, setDestId] = useState<number | null>(null)
  const [items, setItems] = useState<TransferItem[]>([])
  const [notes, setNotes] = useState('')
  const [destinationEntryMode, setDestinationEntryMode] = useState<'AUTO' | 'TRANSFER'>('AUTO')
  
  // Product Search State
  const [loadingSearch, setLoadingSearch] = useState(false)
  const [loadingProductId, setLoadingProductId] = useState<number | null>(null)
  
  // Create Form Product Search
  const [createSearchTerm, setCreateSearchTerm] = useState('')
  const [createSearchNotice, setCreateSearchNotice] = useState('')
  const [createSearchResults, setCreateSearchResults] = useState<Product[]>([])
  const [trackedSelection, setTrackedSelection] = useState<TrackedProductSelection | null>(null)
  const [selectedTransferDetail, setSelectedTransferDetail] = useState<TransferDetail | null>(null)
  const [loadingTransferDetailId, setLoadingTransferDetailId] = useState<number | null>(null)
  const [submittingTransfer, setSubmittingTransfer] = useState(false)

  const getDestinationMovementLabel = (summary?: string) => {
    const normalized = String(summary || '').toUpperCase()
    if (!normalized) return 'TRASLADO'
    if (normalized === 'INITIAL') return 'INICIAL'
    if (normalized === 'TRANSFER_IN') return 'TRASLADO'
    return normalized.includes('INITIAL') && normalized.includes('TRANSFER_IN') ? 'MIXTO' : normalized
  }

  const getDestinationItemLabel = (movementType?: string) => {
    const normalized = String(movementType || '').toUpperCase()
    if (normalized === 'INITIAL') return 'INICIAL'
    return 'TRASLADO'
  }

  const printTransferDetail = (detail: TransferDetail) => {
    if (typeof window === 'undefined') return
    const logoBlock = buildPrintLogoHtml(config?.logoUrl, config?.name || 'Logo empresa', { maxWidth: 150, maxHeight: 56, marginBottom: 8, align: 'left' })

    const printWindow = window.open('', '_blank', 'width=1100,height=800')
    if (!printWindow) {
      alert('El navegador bloqueó la ventana de impresión')
      return
    }

    const itemsRows = detail.items.map(item => `
      <tr>
        <td>${escapePrintHtml(item.product_name)}</td>
        <td>${escapePrintHtml(item.sku || 'Sin SKU')}</td>
        <td>${escapePrintHtml(item.product_code || 'Sin codigo')}</td>
        <td>${escapePrintHtml(item.description || 'Sin descripcion')}</td>
        <td>${escapePrintHtml([
          item.batch_no ? `Lote: ${item.batch_no}` : '',
          item.imei ? `IMEI: ${item.imei}` : '',
          item.serial ? `Serie: ${item.serial}` : ''
        ].filter(Boolean).join(' | ') || 'Sin detalle adicional')}</td>
        <td style="text-align:right;">${Number(item.quantity || 0)}</td>
        <td style="text-align:center;">${escapePrintHtml(getDestinationItemLabel(item.destination_movement_type))}</td>
      </tr>
    `).join('')

    const notesBlock = detail.notes
      ? `
        <div class="section">
          <div class="section-title">Notas</div>
          <div class="notes">${escapePrintHtml(detail.notes)}</div>
        </div>
      `
      : ''

    printWindow.document.open()
    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="es">
        <head>
          <meta charset="UTF-8" />
          <title>Transferencia #${detail.id}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
            h1 { margin: 0 0 6px; font-size: 24px; }
            .subtitle { color: #4b5563; margin-bottom: 20px; }
            .grid { display: grid; grid-template-columns: repeat(2, minmax(220px, 1fr)); gap: 12px; margin-bottom: 20px; }
            .card { border: 1px solid #d1d5db; border-radius: 8px; padding: 12px; }
            .label { font-size: 12px; color: #6b7280; margin-bottom: 4px; }
            .value { font-size: 14px; font-weight: 700; }
            .section { margin-top: 18px; }
            .section-title { font-size: 14px; font-weight: 700; margin-bottom: 8px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border: 1px solid #d1d5db; padding: 10px; font-size: 13px; vertical-align: top; }
            th { background: #f3f4f6; text-align: left; }
            .notes { border: 1px solid #d1d5db; border-radius: 8px; padding: 12px; white-space: pre-wrap; }
            @media print {
              body { margin: 12px; }
            }
          </style>
        </head>
        <body>
          ${logoBlock}
          <h1>Detalle de Transferencia #${detail.id}</h1>
          <div class="subtitle">${escapePrintHtml(detail.source_warehouse_name)} -> ${escapePrintHtml(detail.destination_warehouse_name)} | ${escapePrintHtml(formatDateTime(detail.created_at))}</div>

          <div class="grid">
            <div class="card">
              <div class="label">Origen</div>
              <div class="value">${escapePrintHtml(detail.source_warehouse_name)}</div>
            </div>
            <div class="card">
              <div class="label">Destino</div>
              <div class="value">${escapePrintHtml(detail.destination_warehouse_name)}</div>
            </div>
            <div class="card">
              <div class="label">Estado</div>
              <div class="value">${escapePrintHtml(detail.status)}</div>
            </div>
            <div class="card">
              <div class="label">Usuario</div>
              <div class="value">${escapePrintHtml(detail.created_by_user || 'N/A')}</div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Items trasladados</div>
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>SKU</th>
                  <th>Codigo</th>
                  <th>Descripcion</th>
                  <th>Detalle</th>
                  <th style="text-align:right;">Cantidad</th>
                  <th style="text-align:center;">Registro destino</th>
                </tr>
              </thead>
              <tbody>
                ${itemsRows || '<tr><td colspan="7" style="text-align:center;">Sin items</td></tr>'}
              </tbody>
            </table>
          </div>

          ${notesBlock}
        </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  const filteredTransfers = transfers.filter(t => {
    const term = searchTerm.toLowerCase()
    const matchesSearch = 
      t.id.toString().includes(term) ||
      t.source_warehouse_name?.toLowerCase().includes(term) ||
      t.destination_warehouse_name?.toLowerCase().includes(term) ||
      t.notes?.toLowerCase().includes(term) ||
      t.created_by_user?.toLowerCase().includes(term)
    
    const matchesWarehouse = !filterWarehouse || 
      t.source_warehouse_id.toString() === filterWarehouse || 
      t.destination_warehouse_id.toString() === filterWarehouse

    const matchesStatus = !filterStatus || t.status === filterStatus

    return matchesSearch && matchesWarehouse && matchesStatus
  })

  const user = useAuthStore(s => s.user)
  const config = useConfigStore(s => s.config)
  const isAdmin = String(user?.role || '').toUpperCase() === 'ADMIN'
  const userWarehouseId = user?.warehouseId ? Number(user.warehouseId) : null
  const filterWarehouses = isAdmin
    ? warehouses
    : warehouses.filter(w => w.id === userWarehouseId)
  const sourceWarehouse = warehouses.find(w => w.id === userWarehouseId) || null
  const destinationWarehouses = warehouses.filter(w => w.id !== sourceId)
  const selectedImeisInItems = items
    .map(item => item.imei)
    .filter((value): value is string => Boolean(value))
  const selectedSerialsInItems = items
    .map(item => item.serial)
    .filter((value): value is string => Boolean(value))
  const availableTrackedImeis = trackedSelection
    ? trackedSelection.availableImeis.filter(imei => !selectedImeisInItems.includes(imei))
    : []
  const availableTrackedSerials = trackedSelection
    ? trackedSelection.availableSerials.filter(serial => !selectedSerialsInItems.includes(serial))
    : []

  useEffect(() => {
    loadWarehouses()
    loadTransfers()
  }, [])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)')
    const syncViewport = () => setIsMobileViewport(mediaQuery.matches)
    syncViewport()
    mediaQuery.addEventListener('change', syncViewport)
    return () => mediaQuery.removeEventListener('change', syncViewport)
  }, [])

  useEffect(() => {
    if (!isAdmin && userWarehouseId) {
      setSourceId(userWarehouseId)
    }
  }, [isAdmin, userWarehouseId])

  const resetCreateProductSearch = () => {
    setCreateSearchTerm('')
    setCreateSearchNotice('')
    setCreateSearchResults([])
    setTrackedSelection(null)
    setLoadingProductId(null)
  }

  const fetchProductDetail = async (productId: number) => {
    if (!sourceId) return null
    const res = await api.get(`/products/${productId}`, { params: { warehouseId: sourceId } })
    return res.data as ProductDetailResponse
  }

  const refreshItemAvailability = async (productId: number) => {
    const detail = await fetchProductDetail(productId)
    if (!detail) return null

    setItems(prev => prev.map(item => {
      if (item.productId !== productId) return item

      const nextImeis = Array.isArray(detail.imeis) ? detail.imeis : []
      const nextSerials = Array.isArray(detail.serials) ? detail.serials : []
      const nextBatches = Array.isArray(detail.batches) ? detail.batches : []
      const selectedBatch = nextBatches.find(batch => batch.batchNo === item.batchNo)

      return {
        ...item,
        availableImeis: nextImeis,
        availableSerials: nextSerials,
        availableBatches: nextBatches,
        imei: item.imei && !nextImeis.includes(item.imei) ? '' : item.imei,
        serial: item.serial && !nextSerials.includes(item.serial) ? '' : item.serial,
        batchNo: item.batchNo && !nextBatches.some(batch => batch.batchNo === item.batchNo) ? '' : item.batchNo,
        stockAtSource: selectedBatch ? selectedBatch.quantity : Number(detail.stock || item.stockAtSource || 0)
      }
    }))

    if (trackedSelection?.product.id === productId) {
      setTrackedSelection(prev => prev ? {
        ...prev,
        availableImeis: Array.isArray(detail.imeis) ? detail.imeis : [],
        availableSerials: Array.isArray(detail.serials) ? detail.serials : [],
        selectedImeis: prev.selectedImeis.filter(imei => Array.isArray(detail.imeis) && detail.imeis.includes(imei)),
        selectedSerials: prev.selectedSerials.filter(serial => Array.isArray(detail.serials) && detail.serials.includes(serial))
      } : prev)
    }

    return detail
  }

  const addNormalProductItem = (product: Product, detail: ProductDetailResponse) => {
    const hasBatchTracking = Array.isArray(detail.batches) && detail.batches.length > 0
    const alreadyExists = items.some(item => item.productId === product.id && !item.imei && !item.serial)
    if (alreadyExists) {
      const existingIndex = items.findIndex(item => item.productId === product.id && !item.imei && !item.serial)
      const existingItem = existingIndex >= 0 ? items[existingIndex] : null

      if (hasBatchTracking) {
        const message = `El producto ${product.name} ya está en la lista. Como maneja lotes, ajusta el lote y cantidad en la fila existente o elimínala antes de volverlo a agregar.`
        setCreateSearchNotice(message)
        alert(message)
        return
      }

      if (!existingItem) {
        const message = `El producto ${product.name} ya está en la lista.`
        setCreateSearchNotice(message)
        alert(message)
        return
      }

      const maxQty = Number(detail.stock || existingItem.stockAtSource || product.stock || 0)
      if (existingItem.quantity >= maxQty) {
        const message = `El producto ${product.name} ya alcanzó el stock disponible en la fila actual.`
        setCreateSearchNotice(message)
        alert(message)
        return
      }

      const shouldMerge = window.confirm(`El producto ${product.name} ya está en la lista. ¿Deseas sumar 1 unidad a la fila existente?`)
      if (!shouldMerge) {
        setCreateSearchNotice(`El producto ${product.name} ya estaba en la lista. Puedes editar manualmente su cantidad.`)
        return
      }

      setItems(prev => prev.map((item, index) => {
        if (index !== existingIndex) return item
        return {
          ...item,
          stockAtSource: maxQty,
          quantity: Math.min(maxQty, Number(item.quantity || 0) + 1),
        }
      }))
      setCreateSearchNotice(`Se sumó 1 unidad al producto ${product.name} en la fila existente.`)
      resetCreateProductSearch()
      return
    }

    setItems(prev => [
      ...prev,
      {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        productCode: product.productCode,
        description: product.description,
        quantity: 1,
        stockAtSource: Number(detail.stock || product.stock || 0),
        availableBatches: detail.batches || [],
        availableImeis: detail.imeis || [],
        availableSerials: detail.serials || []
      }
    ])
    resetCreateProductSearch()
  }

  const addTrackedItems = () => {
    if (!trackedSelection) return

    const selectedValues = trackedSelection.productType === 'IMEI'
      ? trackedSelection.selectedImeis
      : trackedSelection.selectedSerials

    if (selectedValues.length === 0) {
      return alert(`Seleccione al menos un ${trackedSelection.productType === 'IMEI' ? 'IMEI' : 'serie'}`)
    }

    const duplicatedSelections = selectedValues.filter(value =>
      trackedSelection?.productType === 'IMEI'
        ? items.some(item => item.productId === trackedSelection.product.id && item.imei === value)
        : items.some(item => item.productId === trackedSelection.product.id && item.serial === value)
    )

    if (duplicatedSelections.length > 0) {
      const message = `Algunos ${trackedSelection.productType === 'IMEI' ? 'IMEIs' : 'series'} ya estaban agregados en la lista. Selecciona solo identificadores nuevos para continuar.`
      setCreateSearchNotice(message)
      alert(message)
      return
    }

    setItems(prev => [
      ...prev,
      ...selectedValues.map(value => ({
        productId: trackedSelection.product.id,
        name: trackedSelection.product.name,
        sku: trackedSelection.product.sku,
        productCode: trackedSelection.product.productCode,
        description: trackedSelection.product.description,
        quantity: 1,
        stockAtSource: 1,
        imei: trackedSelection.productType === 'IMEI' ? value : undefined,
        serial: trackedSelection.productType === 'SERIAL' ? value : undefined,
        availableImeis: trackedSelection.availableImeis,
        availableSerials: trackedSelection.availableSerials
      }))
    ])

    resetCreateProductSearch()
  }

  const loadWarehouses = async () => {
    try {
      const res = await api.get('/warehouses', { params: { mode: 'transfer' } })
      setWarehouses(res.data)
    } catch (err) {
      console.error(err)
    }
  }

  const loadTransfers = async () => {
    try {
      const res = await api.get('/transfers')
      setTransfers(res.data)
    } catch (err) {
      console.error(err)
    }
  }

  const openTransferDetail = async (transferId: number) => {
    setLoadingTransferDetailId(transferId)
    try {
      const res = await api.get(`/transfers/${transferId}`)
      setSelectedTransferDetail(res.data as TransferDetail)
    } catch (err) {
      console.error(err)
      alert('No se pudo cargar el detalle de la transferencia')
    } finally {
      setLoadingTransferDetailId(null)
    }
  }

  const handleCreateSearchProducts = async (term: string) => {
    setCreateSearchTerm(term)
    setTrackedSelection(null)
    if (!term || term.length < 2) {
      setCreateSearchResults([])
      return
    }
    
    if (!sourceId) {
        // Can't search stock correctly without source warehouse
        return
    }

    setLoadingSearch(true)
    try {
      const res = await api.get('/products', { 
          params: { 
              search: term, 
              warehouseId: sourceId 
          } 
      })
      const filtered = (res.data as Product[]).filter((p: Product) => Number(p.stock || 0) > 0)
      setCreateSearchResults(filtered)
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingSearch(false)
    }
  }

  const addItem = async (product: Product) => {
    if (!sourceId) return

    setLoadingProductId(product.id)
    setCreateSearchNotice('')
    try {
      const productDetail = await fetchProductDetail(product.id)
      if (!productDetail) {
        return
      }
      const productType = String(productDetail.productType || product.productType || 'GENERAL').toUpperCase()

      if (productType === 'IMEI') {
        const existingItemsForProduct = items.filter(item => item.productId === product.id)
        if (existingItemsForProduct.length > 0) {
          setCreateSearchNotice(`El producto ${product.name} ya tiene IMEIs agregados. Solo se mostrarán IMEIs que aún no estén en la lista.`)
        }
        setTrackedSelection({
          product,
          productType: 'IMEI',
          availableImeis: productDetail.imeis || [],
          availableSerials: [],
          selectedImeis: [],
          selectedSerials: []
        })
        return
      }

      if (productType === 'SERIAL') {
        const existingItemsForProduct = items.filter(item => item.productId === product.id)
        if (existingItemsForProduct.length > 0) {
          setCreateSearchNotice(`El producto ${product.name} ya tiene series agregadas. Solo se mostrarán series que aún no estén en la lista.`)
        }
        setTrackedSelection({
          product,
          productType: 'SERIAL',
          availableImeis: [],
          availableSerials: productDetail.serials || [],
          selectedImeis: [],
          selectedSerials: []
        })
        return
      }

      addNormalProductItem(product, productDetail)
    } catch (err) {
      console.error(err)
      alert('Error al cargar detalles del producto')
    } finally {
      setLoadingProductId(null)
    }
  }

  const updateItemDetail = (index: number, field: string, value: any) => {
      setItems(prev => prev.map((item, i) => {
          if (i === index) {
              return { ...item, [field]: value }
          }
          return item
      }))
  }

  const toggleTrackedValue = (value: string) => {
    if (!trackedSelection) return

    if (trackedSelection.productType === 'IMEI') {
      setTrackedSelection(prev => prev ? {
        ...prev,
        selectedImeis: prev.selectedImeis.includes(value)
          ? prev.selectedImeis.filter(current => current !== value)
          : [...prev.selectedImeis, value]
      } : prev)
      return
    }

    setTrackedSelection(prev => prev ? {
      ...prev,
      selectedSerials: prev.selectedSerials.includes(value)
        ? prev.selectedSerials.filter(current => current !== value)
        : [...prev.selectedSerials, value]
    } : prev)
  }

  const handleSubmit = async () => {
    if (submittingTransfer) {
      alert('La transferencia ya se está procesando, espera un momento')
      return
    }
    if (!sourceId || !destId) return alert('Seleccione almacenes')
    if (sourceId === destId) return alert('Almacenes deben ser distintos')
    if (items.length === 0) return alert('Agregue productos')
    if (!isAdmin && userWarehouseId && sourceId !== userWarehouseId) {
      return alert('Solo puedes transferir desde tu tienda asignada')
    }
    
    // Validate selections
    const selectedImeis = items.map(item => item.imei).filter((value): value is string => Boolean(value))
    const selectedSerials = items.map(item => item.serial).filter((value): value is string => Boolean(value))
    if (new Set(selectedImeis).size !== selectedImeis.length) {
      return alert('Hay IMEIs repetidos en la transferencia')
    }
    if (new Set(selectedSerials).size !== selectedSerials.length) {
      return alert('Hay series repetidas en la transferencia')
    }
    for (const item of items) {
        if (item.availableBatches?.length && !item.batchNo) {
            return alert(`Seleccione lote para ${item.name}`)
        }
        if (item.availableImeis?.length && !item.imei) {
            return alert(`Seleccione IMEI para ${item.name}`)
        }
        if (item.availableSerials?.length && !item.serial) {
            return alert(`Seleccione Serie para ${item.name}`)
        }
    }

    try {
      setSubmittingTransfer(true)
      const uniqueProductIds = [...new Set(items.map(item => item.productId))]
      for (const productId of uniqueProductIds) {
        const freshDetail = await refreshItemAvailability(productId)
        if (!freshDetail) {
          return alert('No se pudo validar disponibilidad actual del producto')
        }
      }

      for (const item of items) {
        if (item.imei) {
          const freshDetail = await fetchProductDetail(item.productId)
          const latestImeis = Array.isArray(freshDetail?.imeis) ? freshDetail.imeis : []
          if (!latestImeis.includes(item.imei)) {
            return alert(`El IMEI ${item.imei} ya no está disponible para transferir`)
          }
        }
        if (item.serial) {
          const freshDetail = await fetchProductDetail(item.productId)
          const latestSerials = Array.isArray(freshDetail?.serials) ? freshDetail.serials : []
          if (!latestSerials.includes(item.serial)) {
            return alert(`La serie ${item.serial} ya no está disponible para transferir`)
          }
        }
      }

      const payload = {
        source_warehouse_id: sourceId,
        destination_warehouse_id: destId,
        destination_entry_mode: destinationEntryMode,
        items: items.map(i => ({ 
            product_id: i.productId, 
            quantity: i.quantity, 
            batch_no: i.batchNo, 
            imei: i.imei, 
            serial: i.serial
        })),
        notes
      }
      
      await api.post('/transfers', payload)
      alert('Transferencia realizada con éxito')
      setView('list')
      loadTransfers()
      // Reset form
      setSourceId(isAdmin ? null : userWarehouseId)
      setDestId(null)
      setItems([])
      setNotes('')
      setDestinationEntryMode('AUTO')
      resetCreateProductSearch()
    } catch (err: any) {
      console.error(err)
      alert(err.response?.data?.error || 'Error al realizar transferencia')
    } finally {
      setSubmittingTransfer(false)
    }
  }

  return (
    <div className="page-container" style={{ padding: isMobileViewport ? 14 : 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20, alignItems: isMobileViewport ? 'stretch' : 'center', flexDirection: isMobileViewport ? 'column' : 'row', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Transferencias de Inventario</h2>
        
        {view === 'list' ? (
          <div style={{ display: 'flex', gap: 10, alignItems: isMobileViewport ? 'stretch' : 'center', flexWrap: 'wrap', flexDirection: isMobileViewport ? 'column' : 'row', width: isMobileViewport ? '100%' : 'auto' }}>
            <input 
              placeholder={isAdmin ? 'Buscar...' : 'Buscar traslados recibidos...'} 
              value={searchTerm} 
              onChange={e => setSearchTerm(e.target.value)} 
              style={{ padding: 8, borderRadius: 6, border: '1px solid var(--border)', width: isMobileViewport ? '100%' : 200 }}
            />
            
            <select 
              value={filterWarehouse} 
              onChange={e => setFilterWarehouse(e.target.value)}
              style={{ padding: 8, borderRadius: 6, border: '1px solid var(--border)', width: isMobileViewport ? '100%' : 'auto' }}
            >
              <option value="">{isAdmin ? 'Todos los almacenes' : 'Mis transferencias'}</option>
              {filterWarehouses.map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>

            <select 
              value={filterStatus} 
              onChange={e => setFilterStatus(e.target.value)}
              style={{ padding: 8, borderRadius: 6, border: '1px solid var(--border)', width: isMobileViewport ? '100%' : 'auto' }}
            >
              <option value="">Todos los estados</option>
              <option value="COMPLETED">Completado</option>
              <option value="PENDING">Pendiente</option>
              <option value="CANCELLED">Cancelado</option>
            </select>

            <button className="primary-btn" onClick={() => setView('create')} style={{ width: isMobileViewport ? '100%' : 'auto' }}>Nueva Transferencia</button>
          </div>
        ) : (
          <button className="secondary-btn" onClick={() => setView('list')} style={{ width: isMobileViewport ? '100%' : 'auto' }}>Volver al Historial</button>
        )}
      </div>

      {view === 'list' ? (
        isMobileViewport ? (
          <div style={{ display: 'grid', gap: 12 }}>
            {!isAdmin && (
              <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--modal)', fontSize: 13, color: 'var(--muted)' }}>
                Solo se muestran los traslados recibidos en tu tienda.
              </div>
            )}
            {filteredTransfers.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }}>
                No se encontraron transferencias
              </div>
            ) : (
              filteredTransfers.map(t => (
                <div key={t.id} style={{ border: '1px solid var(--border)', borderRadius: 14, background: 'linear-gradient(180deg, var(--surface), var(--modal))', padding: 14, display: 'grid', gap: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 800 }}>Transferencia #{t.id}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{formatDateTime(t.created_at)}</div>
                    </div>
                    <span style={{
                      padding: '4px 8px',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      background: t.status === 'COMPLETED' ? '#dcfce7' : t.status === 'PENDING' ? '#fef9c3' : '#fee2e2',
                      color: t.status === 'COMPLETED' ? '#166534' : t.status === 'PENDING' ? '#854d0e' : '#991b1b'
                    }}>
                      {t.status === 'COMPLETED' ? 'COMPLETADO' : t.status === 'PENDING' ? 'PENDIENTE' : 'CANCELADO'}
                    </span>
                  </div>

                  <div style={{ display: 'grid', gap: 8 }}>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Origen</div>
                    <div><span className="warehouse-highlight" style={getWarehouseHighlightStyle(t.source_warehouse_name)}>{t.source_warehouse_name}</span></div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>Destino</div>
                    <div><span className="warehouse-highlight" style={getWarehouseHighlightStyle(t.destination_warehouse_name)}>{t.destination_warehouse_name}</span></div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, background: 'var(--bg)' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Registro destino</div>
                      <div style={{ marginTop: 4 }}>
                        <span style={{
                          padding: '4px 8px',
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 600,
                          background: getDestinationMovementLabel(t.destination_movement_summary) === 'INICIAL'
                            ? '#dbeafe'
                            : getDestinationMovementLabel(t.destination_movement_summary) === 'MIXTO'
                              ? '#ede9fe'
                              : '#dcfce7',
                          color: getDestinationMovementLabel(t.destination_movement_summary) === 'INICIAL'
                            ? '#1d4ed8'
                            : getDestinationMovementLabel(t.destination_movement_summary) === 'MIXTO'
                              ? '#6d28d9'
                              : '#166534'
                        }}>
                          {getDestinationMovementLabel(t.destination_movement_summary)}
                        </span>
                      </div>
                    </div>
                    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, background: 'var(--bg)' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Items</div>
                      <div style={{ marginTop: 4, fontWeight: 800 }}>{t.total_quantity}</div>
                    </div>
                  </div>

                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>Usuario: {t.created_by_user || 'N/A'}</div>

                  <button
                    className="icon-btn"
                    title="Ver detalles"
                    onClick={() => void openTransferDetail(t.id)}
                    disabled={loadingTransferDetailId === t.id}
                    style={{ width: '100%', justifyContent: 'center', padding: '0 16px' }}
                  >
                    {loadingTransferDetailId === t.id ? 'Cargando...' : 'Ver detalles'}
                  </button>
                </div>
              ))
            )}
          </div>
        ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          {!isAdmin && (
            <div style={{ padding: 12, borderBottom: '1px solid var(--border)', background: 'var(--modal)', fontSize: 13, color: 'var(--muted)' }}>
              Solo se muestran los traslados recibidos en tu tienda.
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: 'var(--modal)' }}>
              <tr>
                <th style={{ textAlign: 'left', padding: 12 }}>ID</th>
                <th style={{ textAlign: 'left', padding: 12 }}>Fecha</th>
                <th style={{ textAlign: 'left', padding: 12 }}>Origen</th>
                <th style={{ textAlign: 'left', padding: 12 }}>Destino</th>
                <th style={{ textAlign: 'center', padding: 12 }}>Registro Destino</th>
                <th style={{ textAlign: 'right', padding: 12 }}>Items</th>
                <th style={{ textAlign: 'left', padding: 12 }}>Usuario</th>
                <th style={{ textAlign: 'center', padding: 12 }}>Estado</th>
                <th style={{ textAlign: 'center', padding: 12 }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransfers.map(t => (
                <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 12, fontWeight: 'bold' }}>#{t.id}</td>
                  <td style={{ padding: 12 }}>{formatDateTime(t.created_at)}</td>
                  <td style={{ padding: 12 }}>
                    <span className="warehouse-highlight" style={getWarehouseHighlightStyle(t.source_warehouse_name)}>
                      {t.source_warehouse_name}
                    </span>
                  </td>
                  <td style={{ padding: 12 }}>
                    <span className="warehouse-highlight" style={getWarehouseHighlightStyle(t.destination_warehouse_name)}>
                      {t.destination_warehouse_name}
                    </span>
                  </td>
                  <td style={{ padding: 12, textAlign: 'center' }}>
                    <span style={{
                      padding: '4px 8px',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      background: getDestinationMovementLabel(t.destination_movement_summary) === 'INICIAL'
                        ? '#dbeafe'
                        : getDestinationMovementLabel(t.destination_movement_summary) === 'MIXTO'
                          ? '#ede9fe'
                          : '#dcfce7',
                      color: getDestinationMovementLabel(t.destination_movement_summary) === 'INICIAL'
                        ? '#1d4ed8'
                        : getDestinationMovementLabel(t.destination_movement_summary) === 'MIXTO'
                          ? '#6d28d9'
                          : '#166534'
                    }}>
                      {getDestinationMovementLabel(t.destination_movement_summary)}
                    </span>
                  </td>
                  <td style={{ padding: 12, textAlign: 'right', fontWeight: 600 }}>{t.total_quantity}</td>
                  <td style={{ padding: 12, fontSize: 13, color: 'var(--muted)' }}>{t.created_by_user || 'N/A'}</td>
                  <td style={{ padding: 12, textAlign: 'center' }}>
                    <span style={{ 
                      padding: '4px 8px', 
                      borderRadius: 6, 
                      fontSize: 12, 
                      fontWeight: 600,
                      background: t.status === 'COMPLETED' ? '#dcfce7' : t.status === 'PENDING' ? '#fef9c3' : '#fee2e2',
                      color: t.status === 'COMPLETED' ? '#166534' : t.status === 'PENDING' ? '#854d0e' : '#991b1b'
                    }}>
                      {t.status === 'COMPLETED' ? 'COMPLETADO' : t.status === 'PENDING' ? 'PENDIENTE' : 'CANCELADO'}
                    </span>
                  </td>
                  <td style={{ padding: 12, textAlign: 'center' }}>
                    <button
                      className="icon-btn"
                      title="Ver detalles"
                      onClick={() => void openTransferDetail(t.id)}
                      disabled={loadingTransferDetailId === t.id}
                    >
                       <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 5c-7 0-11 7-11 7s4 7 11 7 11-7 11-7-4-7-11-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z" fill="currentColor"/></svg>
                    </button>
                  </td>
                </tr>
              ))}
              {filteredTransfers.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>No se encontraron transferencias</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        )
      ) : (
        <div className="card" style={{ maxWidth: 800, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobileViewport ? '1fr' : '1fr 1fr', gap: 20, marginBottom: 20 }}>
            <div>
              <label className="label">Almacén Origen</label>
              {isAdmin ? (
                <select 
                  className="input" 
                  value={sourceId || ''} 
                  onChange={e => {
                      setSourceId(Number(e.target.value))
                      setItems([])
                      resetCreateProductSearch()
                  }}
                >
                  <option value="">Seleccionar...</option>
                  {warehouses.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              ) : (
                <div
                  className="input"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    minHeight: 42,
                    background: 'var(--bg)',
                    color: 'var(--text)'
                  }}
                >
                  <span className="warehouse-highlight current" style={getWarehouseHighlightStyle(sourceWarehouse?.name || user?.warehouseName || 'Sin tienda asignada', true)}>{sourceWarehouse?.name || user?.warehouseName || 'Sin tienda asignada'}</span>
                </div>
              )}
            </div>
            <div>
              <label className="label">Almacén Destino</label>
              <select 
                className="input" 
                value={destId || ''} 
                onChange={e => setDestId(Number(e.target.value))}
              >
                <option value="">Seleccionar...</option>
                {destinationWarehouses.map(w => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label className="label">Registro en destino</label>
            <select
              className="input"
              value={destinationEntryMode}
              onChange={e => setDestinationEntryMode(e.target.value as 'AUTO' | 'TRANSFER')}
            >
              <option value="AUTO">Automatico: inicial si no existe, traslado si ya existe</option>
              <option value="TRANSFER">Siempre registrar como traslado</option>
            </select>
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>
              En modo automatico, si la tienda destino aun no tiene existencia de ese producto se guardara como movimiento inicial.
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <label className="label">Agregar Productos (Búsqueda en Origen)</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flexDirection: isMobileViewport ? 'column' : 'row' }}>
              <input 
                className="input"
                placeholder={sourceId ? "Buscar por código, nombre, SKU o descripción..." : "Seleccione almacén origen primero"}
                value={createSearchTerm}
                onChange={e => handleCreateSearchProducts(e.target.value)}
                disabled={!sourceId}
                style={{ flex: isMobileViewport ? '1 1 auto' : '0 1 420px', width: isMobileViewport ? '100%' : 'min(420px, 100%)', maxWidth: isMobileViewport ? '100%' : 420 }}
              />
              <MobileBarcodeScannerButton
                buttonLabel="Escanear"
                modalTitle="Escanear producto para transferencia"
                disabled={!sourceId}
                onDetected={value => void handleCreateSearchProducts(value)}
              />
            </div>
            {loadingSearch && <div>Buscando...</div>}
            {createSearchResults.length > 0 && (
              <div style={{ border: '1px solid var(--border)', maxHeight: 200, overflowY: 'auto', marginTop: 5 }}>
                {createSearchResults.map(p => (
                  <div 
                    key={p.id} 
                    style={{ padding: 8, borderBottom: '1px solid var(--border)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: isMobileViewport ? 'stretch' : 'flex-start', flexDirection: isMobileViewport ? 'column' : 'row', gap: 12 }}
                    onClick={() => void addItem(p)}
                    className="hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {[p.productCode ? `COD: ${p.productCode}` : '', p.sku ? `SKU: ${p.sku}` : '']
                          .filter(Boolean)
                          .join(' | ') || 'Sin código'}
                      </div>
                      {p.description && (
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.description}</div>
                      )}
                    </div>
                    <span style={{ fontWeight: 'bold' }}>Stock: {p.stock}</span>
                  </div>
                ))}
              </div>
            )}
            {createSearchTerm.length >= 2 && !loadingSearch && createSearchResults.length === 0 && (
              <div style={{ marginTop: 8, color: 'var(--muted)', fontSize: 13 }}>
                No se encontraron productos con stock disponible para esa búsqueda.
              </div>
            )}
            {createSearchNotice && (
              <div style={{ marginTop: 8, color: '#854d0e', background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8, padding: '8px 10px', fontSize: 13 }}>
                {createSearchNotice}
              </div>
            )}
            {trackedSelection && (
              <div style={{ marginTop: 12, border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--card, var(--panel, transparent))' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: isMobileViewport ? 'stretch' : 'center', flexDirection: isMobileViewport ? 'column' : 'row', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>
                      Seleccionar {trackedSelection.productType === 'IMEI' ? 'IMEIs' : 'series'} para {trackedSelection.product.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      Elija varios {trackedSelection.productType === 'IMEI' ? 'IMEIs' : 'series'} disponibles y agréguelos en una sola vez.
                    </div>
                  </div>
                  <button className="btn-secondary" type="button" onClick={resetCreateProductSearch} style={{ width: isMobileViewport ? '100%' : 'auto' }}>
                    Cerrar
                  </button>
                </div>

                <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
                  {trackedSelection.productType === 'IMEI' && availableTrackedImeis.length === 0 && (
                    <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                      No hay IMEIs disponibles para agregar o ya fueron seleccionados en la transferencia.
                    </div>
                  )}
                  {trackedSelection.productType === 'SERIAL' && availableTrackedSerials.length === 0 && (
                    <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                      No hay series disponibles para agregar o ya fueron seleccionadas en la transferencia.
                    </div>
                  )}

                  {trackedSelection.productType === 'IMEI' && availableTrackedImeis.map(imei => (
                    <label key={imei} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={trackedSelection.selectedImeis.includes(imei)}
                        onChange={() => toggleTrackedValue(imei)}
                      />
                      <span>{imei}</span>
                    </label>
                  ))}

                  {trackedSelection.productType === 'SERIAL' && availableTrackedSerials.map(serial => (
                    <label key={serial} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={trackedSelection.selectedSerials.includes(serial)}
                        onChange={() => toggleTrackedValue(serial)}
                      />
                      <span>{serial}</span>
                    </label>
                  ))}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: isMobileViewport ? 'stretch' : 'center', flexDirection: isMobileViewport ? 'column' : 'row', marginTop: 10 }}>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                    Seleccionados: {trackedSelection.productType === 'IMEI' ? trackedSelection.selectedImeis.length : trackedSelection.selectedSerials.length}
                  </div>
                  <button className="btn-primary" type="button" onClick={addTrackedItems} style={{ width: isMobileViewport ? '100%' : 'auto' }}>
                    Agregar seleccionados
                  </button>
                </div>
              </div>
            )}
          </div>

          <div style={{ marginBottom: 20 }}>
            <h3>Items a Transferir</h3>
            {isMobileViewport ? (
              <div style={{ display: 'grid', gap: 12 }}>
                {items.map((item, index) => (
                  <div key={`${item.productId}-${index}`} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, background: 'var(--bg)', display: 'grid', gap: 10 }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{item.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {[item.productCode ? `COD: ${item.productCode}` : '', item.sku ? `SKU: ${item.sku}` : '']
                          .filter(Boolean)
                          .join(' | ') || 'Sin codigo'}
                      </div>
                      {item.description && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{item.description}</div>}
                      {item.imei && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>IMEI: {item.imei}</div>}
                      {item.serial && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Serie: {item.serial}</div>}
                    </div>

                    <div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Detalle</div>
                      {item.availableBatches && item.availableBatches.length > 0 && (
                        <select
                          className="input small"
                          value={item.batchNo || ''}
                          onChange={e => {
                            const batch = item.availableBatches?.find(b => b.batchNo === e.target.value)
                            updateItemDetail(index, 'batchNo', e.target.value)
                            if (batch) updateItemDetail(index, 'stockAtSource', batch.quantity)
                          }}
                        >
                          <option value="">Seleccionar Lote...</option>
                          {item.availableBatches.map((b: any) => (
                            <option key={b.batchNo} value={b.batchNo}>{b.batchNo} (Exp: {b.expiryDate}) - Stock: {b.quantity}</option>
                          ))}
                        </select>
                      )}

                      {item.availableImeis && item.availableImeis.length > 0 && (
                        <select
                          className="input small"
                          value={item.imei || ''}
                          onClick={e => e.stopPropagation()}
                          onFocus={() => { void refreshItemAvailability(item.productId) }}
                          onChange={e => {
                            updateItemDetail(index, 'imei', e.target.value)
                            updateItemDetail(index, 'quantity', 1)
                            updateItemDetail(index, 'stockAtSource', 1)
                          }}
                        >
                          <option value="">Seleccionar IMEI...</option>
                          {item.availableImeis
                            .filter((i: string) => !items.some((other, otherIdx) => otherIdx !== index && other.imei === i))
                            .map((i: string) => (
                              <option key={i} value={i}>{i}</option>
                            ))}
                        </select>
                      )}

                      {item.availableSerials && item.availableSerials.length > 0 && (
                        <select
                          className="input small"
                          value={item.serial || ''}
                          onClick={e => e.stopPropagation()}
                          onFocus={() => { void refreshItemAvailability(item.productId) }}
                          onChange={e => {
                            updateItemDetail(index, 'serial', e.target.value)
                            updateItemDetail(index, 'quantity', 1)
                            updateItemDetail(index, 'stockAtSource', 1)
                          }}
                        >
                          <option value="">Seleccionar Serie...</option>
                          {item.availableSerials
                            .filter((s: string) => !items.some((other, otherIdx) => otherIdx !== index && other.serial === s))
                            .map((s: string) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                      )}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Stock origen</div>
                        <div style={{ fontWeight: 700 }}>{item.stockAtSource}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>Cantidad</div>
                        <input
                          type="number"
                          min="1"
                          max={item.stockAtSource}
                          value={item.quantity}
                          onChange={e => {
                            const val = parseInt(e.target.value) || 0
                            if (val > item.stockAtSource) {
                              alert(`Stock insuficiente. Máximo ${item.stockAtSource}`)
                              updateItemDetail(index, 'quantity', item.stockAtSource)
                            } else {
                              updateItemDetail(index, 'quantity', val)
                            }
                          }}
                          disabled={!!item.imei || !!item.serial}
                          style={{ width: '100%', padding: 8 }}
                        />
                      </div>
                    </div>

                    <button className="btn-danger small" onClick={() => setItems(prev => prev.filter((_, i) => i !== index))} style={{ width: '100%' }}>
                      Quitar item
                    </button>
                  </div>
                ))}
                {items.length === 0 && (
                  <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 18, border: '1px dashed var(--border)', borderRadius: 12 }}>
                    Agregue productos a la lista
                  </div>
                )}
              </div>
            ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Detalle (Lote/Serie)</th>
                  <th>Stock Origen</th>
                  <th>Cantidad</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={`${item.productId}-${index}`}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{item.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {[item.productCode ? `COD: ${item.productCode}` : '', item.sku ? `SKU: ${item.sku}` : '']
                          .filter(Boolean)
                          .join(' | ') || 'Sin codigo'}
                      </div>
                      {item.description && (
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{item.description}</div>
                      )}
                      {item.imei && <div style={{ fontSize: 12, color: 'var(--muted)' }}>IMEI: {item.imei}</div>}
                      {item.serial && <div style={{ fontSize: 12, color: 'var(--muted)' }}>Serie: {item.serial}</div>}
                    </td>
                    <td>
                        {item.availableBatches && item.availableBatches.length > 0 && (
                            <select 
                                className="input small"
                                value={item.batchNo || ''}
                                onChange={e => {
                                    const batch = item.availableBatches?.find(b => b.batchNo === e.target.value)
                                    updateItemDetail(index, 'batchNo', e.target.value)
                                    // Update max qty based on batch
                                    if (batch) updateItemDetail(index, 'stockAtSource', batch.quantity)
                                }}
                            >
                                <option value="">Seleccionar Lote...</option>
                                {item.availableBatches.map((b: any) => (
                                    <option key={b.batchNo} value={b.batchNo}>{b.batchNo} (Exp: {b.expiryDate}) - Stock: {b.quantity}</option>
                                ))}
                            </select>
                        )}
                        
                        {item.availableImeis && item.availableImeis.length > 0 && (
                            <select 
                                className="input small"
                                value={item.imei || ''}
                                onClick={e => e.stopPropagation()}
                                onFocus={() => { void refreshItemAvailability(item.productId) }}
                                onChange={e => {
                                    updateItemDetail(index, 'imei', e.target.value)
                                    updateItemDetail(index, 'quantity', 1) // IMEI is always 1
                                    updateItemDetail(index, 'stockAtSource', 1)
                                }}
                            >
                                <option value="">Seleccionar IMEI...</option>
                                {item.availableImeis
                                  .filter((i: string) => !items.some((other, otherIdx) => otherIdx !== index && other.imei === i))
                                  .map((i: string) => (
                                    <option key={i} value={i}>{i}</option>
                                  ))}
                            </select>
                        )}

                        {item.availableSerials && item.availableSerials.length > 0 && (
                            <select 
                                className="input small"
                                value={item.serial || ''}
                                onClick={e => e.stopPropagation()}
                                onFocus={() => { void refreshItemAvailability(item.productId) }}
                                onChange={e => {
                                    updateItemDetail(index, 'serial', e.target.value)
                                    updateItemDetail(index, 'quantity', 1)
                                    updateItemDetail(index, 'stockAtSource', 1)
                                }}
                            >
                                <option value="">Seleccionar Serie...</option>
                                {item.availableSerials
                                  .filter((s: string) => !items.some((other, otherIdx) => otherIdx !== index && other.serial === s))
                                  .map((s: string) => (
                                    <option key={s} value={s}>{s}</option>
                                  ))}
                            </select>
                        )}

                    </td>
                    <td>{item.stockAtSource}</td>
                    <td>
                      <input 
                        type="number" 
                        min="1" 
                        max={item.stockAtSource}
                        value={item.quantity} 
                        onChange={e => {
                            const val = parseInt(e.target.value) || 0
                            if (val > item.stockAtSource) {
                                alert(`Stock insuficiente. Máximo ${item.stockAtSource}`)
                                updateItemDetail(index, 'quantity', item.stockAtSource)
                            } else {
                                updateItemDetail(index, 'quantity', val)
                            }
                        }}
                        disabled={!!item.imei || !!item.serial} // Locked for IMEI/Serial
                        style={{ width: 80, padding: 4 }}
                      />
                    </td>
                    <td>
                      <button className="btn-danger small" onClick={() => {
                          setItems(prev => prev.filter((_, i) => i !== index))
                      }}>X</button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                    <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--muted)' }}>Agregue productos a la lista</td></tr>
                )}
              </tbody>
            </table>
            )}
          </div>

          <div style={{ marginBottom: 20 }}>
            <label className="label">Notas / Observaciones</label>
            <textarea 
              className="input" 
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexDirection: isMobileViewport ? 'column' : 'row' }}>
            <button className="btn-secondary" onClick={() => setView('list')} style={{ width: isMobileViewport ? '100%' : 'auto' }} disabled={submittingTransfer}>Cancelar</button>
            <button 
                className="btn-primary" 
                onClick={handleSubmit}
                style={{ width: isMobileViewport ? '100%' : 'auto' }}
                disabled={submittingTransfer || !sourceId || !destId || items.length === 0 || (!isAdmin && !userWarehouseId)}
            >
                {submittingTransfer ? 'Procesando transferencia...' : 'Confirmar Transferencia'}
            </button>
          </div>
        </div>
      )}

      {selectedTransferDetail && (
        <div
          onClick={() => setSelectedTransferDetail(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: isMobileViewport ? 'flex-end' : 'center',
            justifyContent: 'center',
            padding: isMobileViewport ? 0 : 20,
            zIndex: 1000
          }}
        >
          <div
            className="card"
            onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: isMobileViewport ? '100%' : 980, maxHeight: isMobileViewport ? '90vh' : '85vh', overflowY: 'auto', borderRadius: isMobileViewport ? '18px 18px 0 0' : undefined }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: isMobileViewport ? 'stretch' : 'center', flexDirection: isMobileViewport ? 'column' : 'row', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0 }}>Detalle de Transferencia #{selectedTransferDetail.id}</h3>
                <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>
                  <span className="warehouse-highlight" style={getWarehouseHighlightStyle(selectedTransferDetail.source_warehouse_name)}>{selectedTransferDetail.source_warehouse_name}</span> {'->'} <span className="warehouse-highlight" style={getWarehouseHighlightStyle(selectedTransferDetail.destination_warehouse_name)}>{selectedTransferDetail.destination_warehouse_name}</span> | {formatDateTime(selectedTransferDetail.created_at)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexDirection: isMobileViewport ? 'column' : 'row', width: isMobileViewport ? '100%' : 'auto' }}>
                <button className="btn-primary" type="button" onClick={() => printTransferDetail(selectedTransferDetail)} style={{ width: isMobileViewport ? '100%' : 'auto' }}>
                  Imprimir detalle
                </button>
                <button className="btn-secondary" type="button" onClick={() => setSelectedTransferDetail(null)} style={{ width: isMobileViewport ? '100%' : 'auto' }}>
                  Cerrar
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Origen</div>
                <div style={{ fontWeight: 700 }}><span className="warehouse-highlight" style={getWarehouseHighlightStyle(selectedTransferDetail.source_warehouse_name)}>{selectedTransferDetail.source_warehouse_name}</span></div>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Destino</div>
                <div style={{ fontWeight: 700 }}><span className="warehouse-highlight" style={getWarehouseHighlightStyle(selectedTransferDetail.destination_warehouse_name)}>{selectedTransferDetail.destination_warehouse_name}</span></div>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Estado</div>
                <div style={{ fontWeight: 700 }}>{selectedTransferDetail.status}</div>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Usuario</div>
                <div style={{ fontWeight: 700 }}>{selectedTransferDetail.created_by_user || 'N/A'}</div>
              </div>
            </div>

            {isMobileViewport ? (
              <div style={{ display: 'grid', gap: 12 }}>
                {selectedTransferDetail.items.map(item => (
                  <div key={item.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, background: 'var(--bg)', display: 'grid', gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{item.product_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {[item.product_code ? `COD: ${item.product_code}` : '', item.sku ? `SKU: ${item.sku}` : '']
                          .filter(Boolean)
                          .join(' | ') || 'Sin codigo'}
                      </div>
                      {item.description && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{item.description}</div>}
                    </div>
                    <div style={{ fontSize: 13 }}>
                      {[
                        item.batch_no ? `Lote: ${item.batch_no}` : '',
                        item.imei ? `IMEI: ${item.imei}` : '',
                        item.serial ? `Serie: ${item.serial}` : ''
                      ].filter(Boolean).join(' | ') || 'Sin detalle adicional'}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                      <div style={{ fontWeight: 700 }}>Cantidad: {item.quantity}</div>
                      <span style={{
                        padding: '4px 8px',
                        borderRadius: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        background: getDestinationItemLabel(item.destination_movement_type) === 'INICIAL' ? '#dbeafe' : '#dcfce7',
                        color: getDestinationItemLabel(item.destination_movement_type) === 'INICIAL' ? '#1d4ed8' : '#166534'
                      }}>
                        {getDestinationItemLabel(item.destination_movement_type)}
                      </span>
                    </div>
                  </div>
                ))}
                {selectedTransferDetail.items.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 24, color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 12 }}>
                    No hay items registrados para esta transferencia.
                  </div>
                )}
              </div>
            ) : (
            <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ background: 'var(--modal)' }}>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 12 }}>Producto</th>
                    <th style={{ textAlign: 'left', padding: 12 }}>Detalle</th>
                    <th style={{ textAlign: 'right', padding: 12 }}>Cantidad</th>
                    <th style={{ textAlign: 'center', padding: 12 }}>Registro Destino</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedTransferDetail.items.map(item => (
                    <tr key={item.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: 12 }}>
                        <div style={{ fontWeight: 600 }}>{item.product_name}</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                          {[item.product_code ? `COD: ${item.product_code}` : '', item.sku ? `SKU: ${item.sku}` : '']
                            .filter(Boolean)
                            .join(' | ') || 'Sin codigo'}
                        </div>
                        {item.description && (
                          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{item.description}</div>
                        )}
                      </td>
                      <td style={{ padding: 12, fontSize: 13 }}>
                        {[
                          item.batch_no ? `Lote: ${item.batch_no}` : '',
                          item.imei ? `IMEI: ${item.imei}` : '',
                          item.serial ? `Serie: ${item.serial}` : ''
                        ].filter(Boolean).join(' | ') || 'Sin detalle adicional'}
                      </td>
                      <td style={{ padding: 12, textAlign: 'right', fontWeight: 600 }}>{item.quantity}</td>
                      <td style={{ padding: 12, textAlign: 'center' }}>
                        <span style={{
                          padding: '4px 8px',
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 600,
                          background: getDestinationItemLabel(item.destination_movement_type) === 'INICIAL' ? '#dbeafe' : '#dcfce7',
                          color: getDestinationItemLabel(item.destination_movement_type) === 'INICIAL' ? '#1d4ed8' : '#166534'
                        }}>
                          {getDestinationItemLabel(item.destination_movement_type)}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {selectedTransferDetail.items.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>
                        No hay items registrados para esta transferencia.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            )}

            {selectedTransferDetail.notes && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>Notas</div>
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                  {selectedTransferDetail.notes}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
