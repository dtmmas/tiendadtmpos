import { useState, useEffect, useMemo, useRef } from 'react'
import { api, getCashStatus, getProducts } from '../api'
import { useConfigStore } from '../store/config'
import { useAuthStore } from '../store/auth'
import { useNavigate } from 'react-router-dom'
import jsPDF from 'jspdf'
import { formatDateTime } from '../utils/date'
import { formatCompanyName } from '../utils/text'
import MobileBarcodeScannerButton from '../components/MobileBarcodeScannerButton'

interface Product {
  id: number
  name: string
  price: number
  price2?: number
  price3?: number
  stock: number
  otherStock?: number
  imageUrl?: string
  categoryId?: number
  brandId?: number
  sku?: string
  productCode?: string
  productType?: 'GENERAL' | 'MEDICINAL' | 'IMEI' | 'SERIAL'
}

interface CartItem extends Product {
  quantity: number
  originalPrice?: number
  priceSource?: 'BASE' | 'PRICE2' | 'PRICE3' | 'MANUAL'
  batchNo?: string
  expiryDate?: string
  maxQuantity?: number
  imei?: string
  serial?: string
}

interface Category {
  id: number
  name: string
  departmentId?: number
}

interface Brand {
  id: number
  name: string
}

interface Department {
  id: number
  name: string
}

interface Customer {
  id: number
  name: string
  document?: string
}

interface HeldSale {
  id: string
  name: string
  savedAt: string
  customerId: number | null
  customerName?: string
  cart: CartItem[]
  paymentMethod: 'CASH' | 'CARD' | 'DEPOSIT' | 'CREDIT'
  receivedAmount: string
  referenceNumber: string
  total: number
}

type CompletedSale = {
  saleId: number
  date: string
  items: CartItem[]
  total: number
  paymentDetails: any
  customer?: Customer
}

export default function POS() {
  const productsPerPage = 40
  const [products, setProducts] = useState<Product[]>([])
  const [loadedImages, setLoadedImages] = useState<Record<number, boolean>>({})
  const [categories, setCategories] = useState<Category[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [cart, setCart] = useState<CartItem[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null)
  const [selectedBrand, setSelectedBrand] = useState<number | null>(null)
  const [selectedDepartment, setSelectedDepartment] = useState<number | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalProducts, setTotalProducts] = useState(0)
  const [selectedCustomer, setSelectedCustomer] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD' | 'DEPOSIT' | 'CREDIT'>('CASH')
  const [receivedAmount, setReceivedAmount] = useState<string>('')
  const [referenceNumber, setReferenceNumber] = useState<string>('')
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false)

  // Batch Selection State
  const [selectedProductForBatch, setSelectedProductForBatch] = useState<Product | null>(null)
  const [availableBatches, setAvailableBatches] = useState<{batchNo: string, expiryDate: string, quantity: number}[]>([])
  const [loadingBatches, setLoadingBatches] = useState(false)

  // IMEI/Serial Selection State
  const [selectedProductForImei, setSelectedProductForImei] = useState<Product | null>(null)
  const [availableImeis, setAvailableImeis] = useState<string[]>([])

  const [selectedProductForSerial, setSelectedProductForSerial] = useState<Product | null>(null)
  const [availableSerials, setAvailableSerials] = useState<string[]>([])

  // Modal Search State
  const [modalSearchTerm, setModalSearchTerm] = useState('')

  // Warehouse Stock View
  const [viewStockProduct, setViewStockProduct] = useState<Product | null>(null)
  const [warehouseStocks, setWarehouseStocks] = useState<{warehouseId: number, warehouseName: string, quantity: number}[]>([])
  const [loadingStocks, setLoadingStocks] = useState(false)
  const [isCashOpen, setIsCashOpen] = useState<boolean | null>(null)

  const user = useAuthStore(s => s.user)
  const hasPermission = useAuthStore(s => s.hasPermission)
  const hasExplicitPermission = useAuthStore(s => s.hasExplicitPermission)
  const isAdmin = String(user?.role || '').toUpperCase() === 'ADMIN'
  const canChangePosPrice = hasExplicitPermission('pos:change_price')
  const canUseManualPosPrice = hasExplicitPermission('pos:manual_price')
  // Print Settings
  const [shouldPrintTicket, setShouldPrintTicket] = useState(true)
  const [lastSale, setLastSale] = useState<CompletedSale | null>(null)
  const [heldSales, setHeldSales] = useState<HeldSale[]>([])
  const [heldSalesLoaded, setHeldSalesLoaded] = useState(false)

  const iframeRef = useRef<HTMLIFrameElement>(null)

  const config = useConfigStore(s => s.config)
  const companyName = formatCompanyName(config?.name)
    const [newCustomer, setNewCustomer] = useState({
    name: '',
    document: '',
    phone: '',
    email: '',
    address: ''
  })

  const navigate = useNavigate()
  const heldSalesStorageKey = `dtmpos_pos_held_sales_${user?.id || 'guest'}`

  useEffect(() => {
    checkCashStatus()
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim())
    }, 300)

    return () => window.clearTimeout(timeoutId)
  }, [searchTerm])

  useEffect(() => {
    setCurrentPage(1)
  }, [debouncedSearchTerm, selectedCategory, selectedBrand, selectedDepartment, user?.warehouseId])

  useEffect(() => {
    loadData()
  }, [user?.warehouseId, currentPage, debouncedSearchTerm, selectedCategory, selectedBrand, selectedDepartment])

  useEffect(() => {
    setHeldSalesLoaded(false)
    try {
      const raw = localStorage.getItem(heldSalesStorageKey)
      const parsed = raw ? JSON.parse(raw) : []
      setHeldSales(Array.isArray(parsed) ? parsed : [])
    } catch (err) {
      console.error('Error loading held POS sales:', err)
      setHeldSales([])
    } finally {
      setHeldSalesLoaded(true)
    }
  }, [heldSalesStorageKey])

  useEffect(() => {
    if (!heldSalesLoaded) return
    try {
      localStorage.setItem(heldSalesStorageKey, JSON.stringify(heldSales))
    } catch (err) {
      console.error('Error saving held POS sales:', err)
    }
  }, [heldSales, heldSalesStorageKey, heldSalesLoaded])

  useEffect(() => {
    const refreshCashStatus = () => {
      checkCashStatus()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshCashStatus()
      }
    }

    window.addEventListener('focus', refreshCashStatus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    const intervalId = window.setInterval(refreshCashStatus, 15000)

    return () => {
      window.removeEventListener('focus', refreshCashStatus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.clearInterval(intervalId)
    }
  }, [])

  const checkCashStatus = async () => {
    try {
      const status = await getCashStatus()
      setIsCashOpen(status.isOpen)
    } catch (err) {
      console.error(err)
    }
  }

  const loadData = async () => {
    try {
      const wId = user?.warehouseId ? Number(user.warehouseId) : null
      if (!isAdmin && !wId) {
        setProducts([])
        setTotalProducts(0)
        return
      }

      const categoryIdsForDepartment = selectedDepartment
        ? categories.filter(c => c.departmentId === selectedDepartment).map(c => c.id)
        : []
      const effectiveCategoryId = selectedCategory || (categoryIdsForDepartment.length === 1 ? categoryIdsForDepartment[0] : null)

      const [prodRes, catRes, brandRes, deptRes, custRes] = await Promise.all([
        getProducts({
          paged: true,
          page: currentPage,
          limit: productsPerPage,
          search: debouncedSearchTerm || undefined,
          categoryId: effectiveCategoryId,
          brandId: selectedBrand,
          departmentId: selectedDepartment,
          stockFilter: 'with_stock',
          warehouseId: wId,
        }),
        api.get('/categories'),
        api.get('/brands'),
        api.get('/departments'),
        api.get('/customers')
      ])
      const nextProducts = Array.isArray(prodRes?.data) ? prodRes.data : []
      setProducts(nextProducts)
      setTotalProducts(Number(prodRes?.pagination?.total || 0))
      setCategories(catRes.data)
      setBrands(brandRes.data)
      setDepartments(deptRes.data)
      setCustomers(custRes.data)
    } catch (err) {
      console.error('Error loading POS data:', err)
      setProducts([])
      setTotalProducts(0)
    }
  }

  const handleViewStock = async (e: React.MouseEvent, product: Product) => {
    e.stopPropagation()
    setViewStockProduct(product)
    setLoadingStocks(true)
    try {
      const res = await api.get(`/products/${product.id}/warehouse-stock`)
      setWarehouseStocks(res.data)
    } catch (err) {
      console.error(err)
      alert('Error al cargar existencias')
    } finally {
      setLoadingStocks(false)
    }
  }

  const addToCart = async (product: Product) => {
    if (product.stock <= 0) {
      alert('Producto sin stock disponible')
      return
    }

        if (product.productType === 'MEDICINAL') {
            setLoadingBatches(true)
            try {
                const wId = user?.warehouseId ? Number(user.warehouseId) : null
                if (!wId && !isAdmin) {
                    alert('Tu usuario no tiene una tienda asignada')
                    return
                }
                const res = await api.get(`/products/${product.id}`, wId ? { params: { warehouseId: wId } } : undefined)
                if (res.data.batches && res.data.batches.length > 0) {
                    // Filter batches with positive quantity and sort by expiry date (ASC)
                    const validBatches = res.data.batches
                        .filter((b: any) => b.quantity > 0)
                        .sort((a: any, b: any) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime())

                    if (validBatches.length > 0) {
                        setAvailableBatches(validBatches)
                        setSelectedProductForBatch(product)
                        setModalSearchTerm('')
                    } else {
                        // Check if stock exists but in other warehouse
                        if (product.otherStock && product.otherStock > 0) {
                             alert(`No hay lotes en este almacén. Disponibles ${product.otherStock} en otros almacenes.`)
                        } else {
                             alert('No hay lotes con stock disponible para este producto')
                        }
                    }
                } else {
                    alert('No hay lotes registrados para este producto')
                }
            } catch (err) {
                console.error(err)
                alert('Error al cargar lotes')
            } finally {
                setLoadingBatches(false)
            }
            return
        }

    if (product.productType === 'IMEI') {
        try {
            const wId = user?.warehouseId ? Number(user.warehouseId) : null
            if (!wId && !isAdmin) {
                alert('Tu usuario no tiene una tienda asignada')
                return
            }
            const res = await api.get(`/products/${product.id}`, wId ? { params: { warehouseId: wId } } : undefined)
            if (res.data.imeis && res.data.imeis.length > 0) {
                // Filter out IMEIs already in cart
                const usedImeis = cart.filter(c => c.id === product.id && c.imei).map(c => c.imei)
                const available = res.data.imeis.filter((i: string) => !usedImeis.includes(i))

                if (available.length > 0) {
                    setAvailableImeis(available)
                    setSelectedProductForImei(product)
                    setModalSearchTerm('')
                } else {
                     if (product.otherStock && product.otherStock > 0) {
                          alert(`No hay IMEIs en este almacén. Disponibles ${product.otherStock} en otros.`)
                     } else {
                          alert('Todos los IMEIs ya están en el carrito o no hay disponibles en este almacén')
                     }
                }
            } else {
                if (product.otherStock && product.otherStock > 0) {
                    alert(`No hay IMEIs en este almacén. Disponibles ${product.otherStock} en otros.`)
                } else {
                    alert('No hay IMEIs registrados para este producto en este almacén')
                }
            }
        } catch (err) {
            console.error(err)
            alert('Error al cargar IMEIs')
        }
        return
    }

    if (product.productType === 'SERIAL') {
        try {
            const wId = user?.warehouseId ? Number(user.warehouseId) : null
            if (!wId && !isAdmin) {
                alert('Tu usuario no tiene una tienda asignada')
                return
            }
            const res = await api.get(`/products/${product.id}`, wId ? { params: { warehouseId: wId } } : undefined)
            if (res.data.serials && res.data.serials.length > 0) {
                 // Filter out Serials already in cart
                 const usedSerials = cart.filter(c => c.id === product.id && c.serial).map(c => c.serial)
                 const available = res.data.serials.filter((s: string) => !usedSerials.includes(s))

                if (available.length > 0) {
                    setAvailableSerials(available)
                    setSelectedProductForSerial(product)
                    setModalSearchTerm('')
                } else {
                     if (product.otherStock && product.otherStock > 0) {
                          alert(`No hay Seriales en este almacén. Disponibles ${product.otherStock} en otros.`)
                     } else {
                          alert('Todos los Seriales ya están en el carrito o no hay disponibles en este almacén')
                     }
                }
            } else {
                if (product.otherStock && product.otherStock > 0) {
                    alert(`No hay Seriales en este almacén. Disponibles ${product.otherStock} en otros.`)
                } else {
                    alert('No hay Seriales registrados para este producto en este almacén')
                }
            }
        } catch (err) {
            console.error(err)
            alert('Error al cargar Seriales')
        }
        return
    }

    setCart(prev => {
      // General product logic
      const existing = prev.find(item => item.id === product.id && !item.batchNo && !item.imei && !item.serial)
      if (existing) {
        if (existing.quantity >= product.stock) {
          alert(`Stock insuficiente. Solo hay ${product.stock} disponibles.`)
          return prev
        }
        return prev.map(item =>
          (item.id === product.id && !item.batchNo && !item.imei && !item.serial)
            ? { ...item, quantity: item.quantity + 1 }
            : item
        )
      }
      return [...prev, { ...product, quantity: 1, originalPrice: product.price, priceSource: 'BASE' }]
    })
  }

  const handleScannedProductCode = async (rawValue: string) => {
    const scannedValue = String(rawValue || '').trim()
    if (!scannedValue) return

    setSearchTerm(scannedValue)

    const normalizedValue = scannedValue.toLowerCase()
    let exactMatches = products.filter(product => {
      const productCode = String(product.productCode || '').trim().toLowerCase()
      const sku = String(product.sku || '').trim().toLowerCase()
      return productCode === normalizedValue || sku === normalizedValue
    })

    if (exactMatches.length === 0) {
      try {
        const wId = user?.warehouseId ? Number(user.warehouseId) : null
        const response = await getProducts({
          paged: true,
          page: 1,
          limit: 10,
          search: scannedValue,
          stockFilter: 'with_stock',
          warehouseId: wId,
        })
        const remoteProducts = Array.isArray(response?.data) ? response.data : []
        exactMatches = remoteProducts.filter(product => {
          const productCode = String(product.productCode || '').trim().toLowerCase()
          const sku = String(product.sku || '').trim().toLowerCase()
          return productCode === normalizedValue || sku === normalizedValue
        })
      } catch (error) {
        console.error('Error searching scanned product:', error)
      }
    }

    if (exactMatches.length === 1) {
      await addToCart(exactMatches[0])
    }
  }

  const addBatchToCart = (product: Product, batch: {batchNo: string, expiryDate: string, quantity: number}, qty: number) => {
      setCart(prev => {
          const existing = prev.find(item => item.id === product.id && item.batchNo === batch.batchNo)
          if (existing) {
              const newQty = existing.quantity + qty
              if (newQty > batch.quantity) {
                  alert(`Stock insuficiente en lote. Solo hay ${batch.quantity} disponibles.`)
                  return prev
              }
              return prev.map(item =>
                  (item.id === product.id && item.batchNo === batch.batchNo)
                  ? { ...item, quantity: newQty }
                  : item
              )
          }
          return [...prev, {
              ...product,
              quantity: qty,
              originalPrice: product.price,
              priceSource: 'BASE',
              batchNo: batch.batchNo,
              expiryDate: batch.expiryDate,
              maxQuantity: batch.quantity
          }]
      })
      setSelectedProductForBatch(null)
  }

  const addImeiToCart = (product: Product, imei: string) => {
      setCart(prev => {
          // Check uniqueness just in case
          if (prev.some(item => item.id === product.id && item.imei === imei)) {
              return prev
          }
          return [...prev, {
              ...product,
              quantity: 1,
              originalPrice: product.price,
              priceSource: 'BASE',
              imei: imei,
              maxQuantity: 1 // Unique item
          }]
      })
      setSelectedProductForImei(null)
  }

  const addSerialToCart = (product: Product, serial: string) => {
      setCart(prev => {
          if (prev.some(item => item.id === product.id && item.serial === serial)) {
              return prev
          }
          return [...prev, {
              ...product,
              quantity: 1,
              originalPrice: product.price,
              priceSource: 'BASE',
              serial: serial,
              maxQuantity: 1 // Unique item
          }]
      })
      setSelectedProductForSerial(null)
  }

  const updatePrice = (
    productId: number,
    newPrice: number,
    batchNo?: string,
    imei?: string,
    serial?: string,
    priceSource: CartItem['priceSource'] = 'BASE'
  ) => {
    setCart(prev => prev.map(item => {
      const isTarget = item.id === productId &&
                       item.batchNo === batchNo &&
                       item.imei === imei &&
                       item.serial === serial

      if (isTarget) {
        return { ...item, price: newPrice, priceSource }
      }
      return item
    }))
  }

  const handleManualPriceChange = (productId: number, value: string, batchNo?: string, imei?: string, serial?: string) => {
    const manualPrice = Number(value)
    if (!Number.isFinite(manualPrice) || manualPrice <= 0) return
    updatePrice(productId, manualPrice, batchNo, imei, serial, 'MANUAL')
  }

  const updateQuantity = (productId: number, delta: number, batchNo?: string, imei?: string, serial?: string) => {
    setCart(prev => prev.map(item => {
      const isTarget = item.id === productId &&
                       item.batchNo === batchNo &&
                       item.imei === imei &&
                       item.serial === serial

      if (isTarget) {
        const newQty = item.quantity + delta
        if (newQty < 1) return item

        const limit = item.maxQuantity || item.stock
        if (newQty > limit) {
          alert(`Stock insuficiente. Solo hay ${limit} disponibles.`)
          return item
        }
        return { ...item, quantity: newQty }
      }
      return item
    }))
  }

  const handleQuantityChange = (productId: number, value: string, batchNo?: string, imei?: string, serial?: string) => {
    const newQty = parseInt(value)
    if (isNaN(newQty)) return

    setCart(prev => prev.map(item => {
      const isTarget = item.id === productId &&
                       item.batchNo === batchNo &&
                       item.imei === imei &&
                       item.serial === serial

      if (isTarget) {
        if (newQty < 1) return item

        const limit = item.maxQuantity || item.stock
        if (newQty > limit) {
          alert(`Stock insuficiente. Solo hay ${limit} disponibles.`)
          return { ...item, quantity: limit }
        }
        return { ...item, quantity: newQty }
      }
      return item
    }))
  }

  const removeFromCart = (productId: number, batchNo?: string, imei?: string, serial?: string) => {
    setCart(prev => prev.filter(item => !(
        item.id === productId &&
        item.batchNo === batchNo &&
        item.imei === imei &&
        item.serial === serial
    )))
  }

  const clearFilters = () => {
    setSearchTerm('')
    setSelectedCategory(null)
    setSelectedBrand(null)
    setSelectedDepartment(null)
    setCurrentPage(1)
  }

  const totalPages = Math.max(1, Math.ceil(totalProducts / productsPerPage))

  const total = useMemo(() => {
    return cart.reduce((sum, item) => sum + (item.price * item.quantity), 0)
  }, [cart])

  const resetCurrentSale = () => {
    setCart([])
    setSelectedCustomer(null)
    setPaymentMethod('CASH')
    setReceivedAmount('')
    setReferenceNumber('')
  }

  const downloadTicketPdf = (blobUrl: string, saleId: number) => {
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = `ticket-venta-${saleId}.pdf`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
  }

  const escapeHtml = (value: unknown) =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')

  const buildPrintableTicketHtml = (
    saleId: number,
    date: string,
    items: CartItem[],
    totalAmount: number,
    paymentDetails?: any,
    customer?: Customer
  ) => {
    const paymentLines: string[] = []
    if (paymentDetails?.paymentMethod === 'CASH') {
      paymentLines.push(`Efectivo: ${Number(paymentDetails.receivedAmount || 0).toFixed(2)}`)
      paymentLines.push(`Cambio: ${Number(paymentDetails.changeAmount || 0).toFixed(2)}`)
    } else if (paymentDetails?.paymentMethod === 'CARD') {
      paymentLines.push(`Tarjeta Ref: ${paymentDetails.referenceNumber || ''}`)
    } else if (paymentDetails?.paymentMethod === 'DEPOSIT') {
      paymentLines.push(`Deposito Ref: ${paymentDetails.referenceNumber || ''}`)
    } else if (paymentDetails?.paymentMethod === 'CREDIT') {
      paymentLines.push('Venta a credito')
    }

    const itemsHtml = items
      .map(item => {
        const lineTotal = item.price * item.quantity
        return `
          <div class="row item">
            <div class="name">${escapeHtml(item.name)}</div>
            <div class="qty">${escapeHtml(item.quantity)} x ${escapeHtml(item.price.toFixed(2))}</div>
            <div class="line-total">${escapeHtml(lineTotal.toFixed(2))}</div>
          </div>
        `
      })
      .join('')

    const paymentHtml = paymentLines
      .map(line => `<div class="payment-line">${escapeHtml(line)}</div>`)
      .join('')

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Ticket Venta ${escapeHtml(saleId)}</title>
    <style>
      @page { size: 80mm auto; margin: 4mm; }
      html, body { margin: 0; padding: 0; background: #fff; }
      body { font-family: Arial, sans-serif; font-size: 11px; color: #000; }
      .ticket { width: 72mm; margin: 0 auto; padding: 2mm 0; }
      .center { text-align: center; }
      .muted { margin-top: 2mm; }
      .divider { border-top: 1px dashed #000; margin: 3mm 0; }
      .row { display: flex; gap: 2mm; align-items: flex-start; }
      .item { margin-bottom: 2mm; }
      .name { flex: 1; word-break: break-word; }
      .qty, .line-total { white-space: nowrap; }
      .line-total { margin-left: auto; }
      .total { font-weight: 700; font-size: 12px; text-align: right; }
      .payment-line { margin-top: 1mm; }
    </style>
  </head>
  <body>
    <div class="ticket">
      <div class="center"><strong>${escapeHtml(companyName)}</strong></div>
      <div class="center muted">Fecha: ${escapeHtml(date)}</div>
      <div class="center muted">Venta #${escapeHtml(saleId)}</div>
      ${customer ? `<div class="center muted">Cliente: ${escapeHtml(customer.name)}</div>` : ''}
      <div class="divider"></div>
      ${itemsHtml}
      <div class="divider"></div>
      <div class="total">TOTAL: ${escapeHtml(config?.currency || '')} ${escapeHtml(totalAmount.toFixed(2))}</div>
      ${paymentHtml ? `<div class="divider"></div>${paymentHtml}` : ''}
    </div>
    <script>
      window.onload = function () {
        setTimeout(function () {
          try {
            window.focus();
            window.print();
          } catch (error) {}
        }, 150);
      };
    </script>
  </body>
</html>`
  }

  const printTicketHtml = (
    blobUrl: string,
    saleId: number,
    date: string,
    items: CartItem[],
    totalAmount: number,
    paymentDetails?: any,
    customer?: Customer,
    printWindow?: Window | null
  ) => {
    const printableHtml = buildPrintableTicketHtml(saleId, date, items, totalAmount, paymentDetails, customer)

    if (printWindow && !printWindow.closed) {
      try {
        printWindow.document.open()
        printWindow.document.write(printableHtml)
        printWindow.document.close()
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
        return
      } catch (error) {
        try {
          printWindow.close()
        } catch {}
      }
    }

    const iframe = iframeRef.current
    const frameWindow = iframe?.contentWindow
    const frameDocument = frameWindow?.document

    if (!iframe || !frameWindow || !frameDocument) {
      downloadTicketPdf(blobUrl, saleId)
      return
    }

    try {
      frameDocument.open()
      frameDocument.write(printableHtml)
      frameDocument.close()


      window.setTimeout(() => {
        try {
          frameWindow.focus()
          frameWindow.print()
        } catch (error) {
          downloadTicketPdf(blobUrl, saleId)
          return
        }
      }, 300)

      window.setTimeout(() => {
        try {
          iframe.src = 'about:blank'
        } catch {}
        URL.revokeObjectURL(blobUrl)
      }, 60000)
    } catch (error) {
      downloadTicketPdf(blobUrl, saleId)
    }
  }

  const buildHeldSale = (): HeldSale => {
    const customer = selectedCustomer ? customers.find(c => c.id === selectedCustomer) : undefined
    const now = new Date()
    return {
      id: `${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
      name: `Espera ${now.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })}`,
      savedAt: now.toISOString(),
      customerId: selectedCustomer,
      customerName: customer?.name,
      cart: [...cart],
      paymentMethod,
      receivedAmount,
      referenceNumber,
      total
    }
  }

  const holdCurrentSale = (silent = false) => {
    if (cart.length === 0) {
      if (!silent) alert('No hay una venta activa para poner en espera')
      return false
    }

    const heldSale = buildHeldSale()
    setHeldSales(prev => [heldSale, ...prev])
    resetCurrentSale()

    if (!silent) {
      alert(`Venta guardada en espera: ${heldSale.name}`)
    }
    return true
  }

  const deleteHeldSale = (heldSaleId: string) => {
    setHeldSales(prev => prev.filter(sale => sale.id !== heldSaleId))
  }

  const resumeHeldSale = (heldSaleId: string) => {
    const heldSale = heldSales.find(sale => sale.id === heldSaleId)
    if (!heldSale) return

    let currentHeldSale: HeldSale | null = null
    if (cart.length > 0) {
      const confirmSwap = window.confirm('Ya tienes una venta activa. Aceptar guardara la actual en espera y retomara la seleccionada.')
      if (!confirmSwap) return
      currentHeldSale = buildHeldSale()
    }

    setHeldSales(prev => {
      const remaining = prev.filter(sale => sale.id !== heldSaleId)
      return currentHeldSale ? [currentHeldSale, ...remaining] : remaining
    })

    setCart(heldSale.cart)
    setSelectedCustomer(heldSale.customerId)
    setPaymentMethod(heldSale.paymentMethod)
    setReceivedAmount(heldSale.receivedAmount)
    setReferenceNumber(heldSale.referenceNumber)
    alert(`Venta retomada: ${heldSale.name}`)
  }

  const generateTicket = (saleId: number, date: string, items: CartItem[], totalAmount: number, paymentDetails?: any, customer?: Customer, printWindow?: Window | null) => {
    // Calcular altura dinámica
    const headerHeight = 40
    const itemHeight = 5
    const footerHeight = 40
    const totalHeight = headerHeight + (items.length * itemHeight) + footerHeight

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: [80, Math.max(200, totalHeight)]
    })

    doc.setFontSize(10)
    doc.text(companyName, 40, 5, { align: 'center' })
    doc.setFontSize(8)
    doc.text(`Fecha: ${date}`, 5, 15)
    doc.text(`Venta #${saleId}`, 5, 20)

    if (customer) {
      doc.text(`Cliente: ${customer.name}`, 5, 25)
    }

    doc.line(5, 30, 75, 30)

    let y = 35
    items.forEach(item => {
      const lineTotal = item.price * item.quantity
      doc.text(`${item.name.substring(0, 20)}`, 5, y)
      doc.text(`${item.quantity} x ${item.price.toFixed(2)}`, 50, y, { align: 'right' })
      doc.text(`${lineTotal.toFixed(2)}`, 75, y, { align: 'right' })
      y += 5
    })

    doc.line(5, y, 75, y)
    y += 5
    doc.setFontSize(10)
    doc.text(`TOTAL: ${config?.currency} ${totalAmount.toFixed(2)}`, 75, y, { align: 'right' })

    y += 5
    doc.setFontSize(8)
    if (paymentDetails) {
       if (paymentDetails.paymentMethod === 'CASH') {
          doc.text(`Efectivo: ${Number(paymentDetails.receivedAmount).toFixed(2)}`, 5, y)
          y += 4
          doc.text(`Cambio: ${Number(paymentDetails.changeAmount).toFixed(2)}`, 5, y)
       } else if (paymentDetails.paymentMethod === 'CARD') {
          doc.text(`Tarjeta Ref: ${paymentDetails.referenceNumber}`, 5, y)
       } else if (paymentDetails.paymentMethod === 'DEPOSIT') {
          doc.text(`Depósito Ref: ${paymentDetails.referenceNumber}`, 5, y)
       } else if (paymentDetails.paymentMethod === 'CREDIT') {
          doc.text(`Venta a Crédito`, 5, y)
       }
    }

    // Imprimir usando iframe para evitar bloqueo de popups
    const blob = doc.output('blob')
    const blobUrl = URL.createObjectURL(blob)

    if (shouldPrintTicket) {
      printTicketHtml(blobUrl, saleId, date, items, totalAmount, paymentDetails, customer, printWindow)
      return
    }

    downloadTicketPdf(blobUrl, saleId)
  }

  const handleCheckout = async () => {
    if (cart.length === 0) return

    if (isCashOpen === false) {
      alert('Caja cerrada. Debes abrir caja antes de vender.')
      navigate('/cash-register')
      return
    }

    // Validaciones de pago
    if (paymentMethod === 'CASH') {
       const received = parseFloat(receivedAmount) || 0
       if (received < total) {
         alert(`El monto recibido (${received}) es menor al total (${total.toFixed(2)})`)
         return
       }
    } else if (paymentMethod === 'CARD' || paymentMethod === 'DEPOSIT') {
       if (!referenceNumber.trim()) {
         alert('Por favor ingrese el número de referencia')
         return
       }
    }

    let printWindow: Window | null = null
    if (shouldPrintTicket) {
      try {
        printWindow = window.open('', `dtmpos-print-${Date.now()}`, 'width=420,height=640,left=120,top=120')
      } catch (error) {
      }
    }

    setLoading(true)
    try {
      if (isCashOpen === null) {
        try {
          const status = await getCashStatus()
          setIsCashOpen(status.isOpen)
          if (!status.isOpen) {
            alert('Caja cerrada. Debes abrir caja antes de vender.')
            navigate('/cash-register')
            return
          }
        } catch {}
      }

      const isCreditSale = paymentMethod === 'CREDIT'
      const received = parseFloat(receivedAmount) || 0
      const change = received - total

      const res = await api.post('/sales', {
        customerId: selectedCustomer,
        items: cart.map(item => ({
          productId: item.id,
          quantity: item.quantity,
          price: item.price,
          priceSource: item.priceSource || 'BASE',
          batchNo: item.batchNo,
          expiryDate: item.expiryDate,
          imei: item.imei,
          serial: item.serial
        })),
        total,
        isCredit: isCreditSale,
        paymentMethod,
        receivedAmount: paymentMethod === 'CASH' ? received : 0,
        changeAmount: paymentMethod === 'CASH' ? change : 0,
        referenceNumber: (paymentMethod === 'CARD' || paymentMethod === 'DEPOSIT') ? referenceNumber : null
      })

      if (res.data.success) {
        const saleData: CompletedSale = {
          saleId: res.data.saleId,
          date: formatDateTime(new Date()),
          items: [...cart],
          total: total,
          paymentDetails: {
             paymentMethod,
             receivedAmount: paymentMethod === 'CASH' ? received : 0,
             changeAmount: paymentMethod === 'CASH' ? change : 0,
             referenceNumber: (paymentMethod === 'CARD' || paymentMethod === 'DEPOSIT') ? referenceNumber : null
          },
          customer: selectedCustomer ? customers.find(c => c.id === selectedCustomer) : undefined
        }

        setLastSale(saleData)
        if (shouldPrintTicket) {
          generateTicket(
            saleData.saleId,
            saleData.date,
            saleData.items,
            saleData.total,
            saleData.paymentDetails,
            saleData.customer,
            printWindow
          )
        }
        resetCurrentSale()
        void loadData()
        return
      }
    } catch (err) {
      console.error(err)
      const msg = (err as any)?.response?.data?.error
      if (msg) {
        alert(msg)
        if (String(msg).toLowerCase().includes('caja cerrada')) {
          setIsCashOpen(false)
          navigate('/cash-register')
        }
      } else {
        alert('Error al procesar la venta')
      }
      if (printWindow && !printWindow.closed) {
        try {
          printWindow.close()
        } catch {}
      }
    } finally {
      setLoading(false)
    }
  }

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newCustomer.name) return alert('El nombre es obligatorio')

    setLoading(true)
    try {
      const res = await api.post('/customers', newCustomer)
      const createdCustomer = res.data

      // Refresh customers list
      const custRes = await api.get('/customers')
      setCustomers(custRes.data)

      // Select the new customer
      setSelectedCustomer(createdCustomer.id)

      // Reset and close modal
      setNewCustomer({ name: '', document: '', phone: '', email: '', address: '' })
      setIsCustomerModalOpen(false)
      alert('Cliente creado y seleccionado')
    } catch (err) {
      console.error('Error creating customer:', err)
      alert('Error al crear cliente')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="pos-container">
      <div className="pos-floating-actions">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => navigate('/')}
          style={{ padding: '10px 14px' }}
        >
          Volver
        </button>
        <button
          type="button"
          className="btn-danger"
          onClick={() => {
            window.close()
            setTimeout(() => navigate('/'), 200)
          }}
          style={{ padding: '10px 14px' }}
        >
          Cerrar POS
        </button>
      </div>
      {/* Left: Products */}
      <div className="pos-left-panel">
        {/* Header: Search & Filter */}
        <div className="pos-filters">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: '1 1 250px' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  position: 'absolute',
                  left: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--muted)'
                }}
              >
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                type="text"
                placeholder="Buscar por nombre, SKU o codigo..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 10px 10px 40px',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  fontSize: '1rem',
                  outline: 'none',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  transition: 'border-color 0.2s'
                }}
                onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
                onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
              />
            </div>
            <MobileBarcodeScannerButton
              buttonLabel="Escanear"
              modalTitle="Escanear producto en POS"
              onDetected={value => {
                void handleScannedProductCode(value)
              }}
            />
          </div>

          <div style={{ position: 'relative', flex: '1 1 150px' }}>
            <select
              value={selectedDepartment || ''}
              onChange={e => {
                setSelectedDepartment(e.target.value ? Number(e.target.value) : null)
                setSelectedCategory(null)
              }}
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: '1rem',
                outline: 'none',
                cursor: 'pointer',
                backgroundColor: 'var(--bg)',
                color: 'var(--text)',
                appearance: 'none',
                backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%239ca3af%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 12px center',
                backgroundSize: '12px'
              }}
            >
              <option value="">Deptos</option>
              {departments.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          <div style={{ position: 'relative', flex: '1 1 150px' }}>
            <select
              value={selectedCategory || ''}
              onChange={e => setSelectedCategory(e.target.value ? Number(e.target.value) : null)}
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: '1rem',
                outline: 'none',
                cursor: 'pointer',
                backgroundColor: 'var(--bg)',
                color: 'var(--text)',
                appearance: 'none',
                backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%239ca3af%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 12px center',
                backgroundSize: '12px'
              }}
            >
              <option value="">Categorías</option>
              {categories
                .filter(c => !selectedDepartment || c.departmentId === selectedDepartment)
                .map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div style={{ position: 'relative', flex: '1 1 150px' }}>
            <select
              value={selectedBrand || ''}
              onChange={e => setSelectedBrand(e.target.value ? Number(e.target.value) : null)}
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: '1rem',
                outline: 'none',
                cursor: 'pointer',
                backgroundColor: 'var(--bg)',
                color: 'var(--text)',
                appearance: 'none',
                backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%239ca3af%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 12px center',
                backgroundSize: '12px'
              }}
            >
              <option value="">Marcas</option>
              {brands.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          <button
            onClick={clearFilters}
            className="icon-btn danger"
            style={{
              width: 42,
              height: 42,
              borderRadius: 8
            }}
            title="Borrar filtros"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
               <line x1="18" y1="6" x2="6" y2="18"></line>
               <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* Grid */}
        <div className="pos-grid">
          {products.map(p => (
            <div
              key={p.id}
              onClick={() => addToCart(p)}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 16,
                padding: 16,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                backgroundColor: 'var(--modal)',
                transition: 'transform 0.1s',
                height: '100%',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
              }}
              className="product-card"
            >
              <div style={{ position: 'relative', width: '100%', height: 140, marginBottom: 12, borderRadius: 12, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {p.imageUrl ? (
                  <>
                    {!loadedImages[p.id] && (
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          borderRadius: 12,
                          background: 'linear-gradient(90deg, var(--bg) 0%, var(--surface) 50%, var(--bg) 100%)'
                        }}
                        aria-hidden="true"
                      />
                    )}
                    <img
                      src={p.imageUrl}
                      alt={p.name}
                      loading="lazy"
                      onLoad={() => setLoadedImages(prev => ({ ...prev, [p.id]: true }))}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                        borderRadius: 12,
                        opacity: loadedImages[p.id] ? 1 : 0,
                        transition: 'opacity 200ms'
                      }}
                    />
                  </>
                ) : (
                  <div style={{ color: 'var(--muted)' }}>Sin Imagen</div>
                )}
              </div>
              <div>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: '1rem',
                    marginBottom: 4,
                    color: 'var(--text)',
                    lineHeight: 1.3,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                  title={p.name}
                >
                  {p.name}
                </div>
                <div style={{ color: 'var(--muted)', fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                     <span>Stock ({user?.warehouseName || 'Tienda'}): {p.stock}</span>
                     <button
                        onClick={(e) => handleViewStock(e, p)}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: 'var(--accent)', display: 'flex', alignItems: 'center' }}
                        title="Ver detalle"
                     >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 21h18"/>
                          <path d="M5 21V7l8-4 8 4v14"/>
                          <path d="M13 21V11"/>
                        </svg>
                     </button>
                  </div>
                  <div>Otras tiendas: {Number(p.otherStock ?? 0)}</div>
                </div>
                <div style={{ color: 'var(--accent)', fontWeight: 700, fontSize: '1.1rem', marginTop: 8 }}>{config?.currency} {p.price.toFixed(2)}</div>
              </div>
            </div>
          ))}
        </div>
        {products.length === 0 && !loading && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
            No se encontraron productos para los filtros actuales.
          </div>
        )}
        {totalProducts > productsPerPage && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginTop: 20, padding: '14px 16px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--modal)' }}>
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
              Mostrando {products.length} de {totalProducts} productos. Pagina {currentPage} de {totalPages}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
              <button
                className="icon-btn"
                disabled={currentPage === 1 || loading}
                onClick={() => setCurrentPage(1)}
                style={{ minWidth: 88, padding: '10px 14px', borderRadius: 10, opacity: currentPage === 1 || loading ? 0.5 : 1 }}
              >
                Primera
              </button>
              <button
                className="icon-btn"
                disabled={currentPage === 1 || loading}
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                style={{ minWidth: 88, padding: '10px 14px', borderRadius: 10, opacity: currentPage === 1 || loading ? 0.5 : 1 }}
              >
                Anterior
              </button>
              <div style={{ minWidth: 110, padding: '10px 14px', borderRadius: 10, background: 'var(--bg)', border: '1px solid var(--border)', textAlign: 'center', fontWeight: 600, color: 'var(--text)' }}>
                {currentPage} / {totalPages}
              </div>
              <button
                className="icon-btn"
                disabled={currentPage >= totalPages || loading}
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                style={{ minWidth: 88, padding: '10px 14px', borderRadius: 10, opacity: currentPage >= totalPages || loading ? 0.5 : 1 }}
              >
                Siguiente
              </button>
              <button
                className="icon-btn"
                disabled={currentPage >= totalPages || loading}
                onClick={() => setCurrentPage(totalPages)}
                style={{ minWidth: 88, padding: '10px 14px', borderRadius: 10, opacity: currentPage >= totalPages || loading ? 0.5 : 1 }}
              >
                Ultima
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Right: Cart */}
      <div className="pos-cart">
        <div style={{ padding: 16, borderBottom: '1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontWeight: 600, fontSize: '1.2rem', color: 'var(--text)' }}>Orden Actual</span>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              onClick={() => holdCurrentSale()}
              disabled={cart.length === 0}
              style={{
                color: cart.length === 0 ? 'var(--muted)' : '#f59e0b',
                background: 'none',
                border: 'none',
                cursor: cart.length === 0 ? 'not-allowed' : 'pointer',
                fontWeight: 600
              }}
            >
              En espera
            </button>
            <button onClick={resetCurrentSale} style={{color: '#ef4444', background:'none', border:'none', cursor:'pointer', fontWeight: 600}}>Vaciar</button>
          </div>
        </div>

        {/* Customer Selection */}
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', backgroundColor: 'var(--bg)', display: 'flex', gap: 8 }}>
           <select
             style={{
               flex: 1,
               padding: 8,
               borderRadius: 6,
               border: '1px solid var(--border)',
               background: 'var(--modal)',
               color: 'var(--text)'
             }}
             value={selectedCustomer || ''}
             onChange={e => setSelectedCustomer(e.target.value ? Number(e.target.value) : null)}
           >
             <option value="">Seleccionar Cliente (General)</option>
             {customers.map(c => (
               <option key={c.id} value={c.id}>{c.name}</option>
             ))}
           </select>
           <button
             onClick={() => setIsCustomerModalOpen(true)}
             className="icon-btn primary"
             style={{
               width: 38,
               height: 38,
               borderRadius: 6
             }}
             title="Agregar Cliente"
           >
             <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
               <line x1="12" y1="5" x2="12" y2="19"></line>
               <line x1="5" y1="12" x2="19" y2="12"></line>
             </svg>
           </button>
        </div>

        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', backgroundColor: 'var(--bg)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: heldSales.length ? 10 : 0 }}>
            <div style={{ fontWeight: 700, color: 'var(--text)' }}>Ventas En Espera</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{heldSales.length}</div>
          </div>
          {heldSales.length === 0 ? (
            <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>
              No hay ventas guardadas en espera.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 170, overflowY: 'auto' }}>
              {heldSales.map(sale => (
                <div key={sale.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: 'var(--modal)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--text)' }}>{sale.name}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                        {sale.customerName || 'Cliente general'} | {sale.cart.length} item(s)
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                        {formatDateTime(new Date(sale.savedAt))}
                      </div>
                    </div>
                    <div style={{ fontWeight: 700, color: 'var(--accent)' }}>
                      {config?.currency} {sale.total.toFixed(2)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button
                      type="button"
                      onClick={() => resumeHeldSale(sale.id)}
                      style={{
                        flex: 1,
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: '1px solid var(--border)',
                        background: 'var(--surface)',
                        color: 'var(--text)',
                        cursor: 'pointer',
                        fontWeight: 600
                      }}
                    >
                      Retomar
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteHeldSale(sale.id)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: '1px solid rgba(239, 68, 68, 0.35)',
                        background: 'transparent',
                        color: '#ef4444',
                        cursor: 'pointer',
                        fontWeight: 600
                      }}
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {cart.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', marginTop: 32 }}>
              Carrito vacío
            </div>
          ) : (
            cart.map(item => (
              <div key={`${item.id}-${item.batchNo || ''}-${item.imei || ''}-${item.serial || ''}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, color: 'var(--text)' }}>{item.name}</div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>{config?.currency}</span>
                    {(item.price2 || item.price3) && canChangePosPrice ? (
                        <select
                            value={item.priceSource === 'MANUAL' ? (item.originalPrice ?? item.price) : item.price}
                            onChange={(e) => {
                              const nextPrice = Number(e.target.value)
                              let nextSource: CartItem['priceSource'] = 'BASE'
                              if (item.price2 && Math.abs(nextPrice - Number(item.price2)) <= 0.0001) nextSource = 'PRICE2'
                              else if (item.price3 && Math.abs(nextPrice - Number(item.price3)) <= 0.0001) nextSource = 'PRICE3'
                              updatePrice(item.id, nextPrice, item.batchNo, item.imei, item.serial, nextSource)
                            }}
                            style={{
                                background: 'var(--modal)',
                                border: '1px solid var(--border)',
                                borderRadius: 4,
                                color: 'var(--text)',
                                fontSize: '0.85rem',
                                padding: '0 2px',
                                cursor: 'pointer'
                            }}
                        >
                            <option value={item.originalPrice ?? item.price}>{Number(item.originalPrice ?? item.price).toFixed(2)}</option>
                            {item.price2 && <option value={item.price2}>{Number(item.price2).toFixed(2)} (P2)</option>}
                            {item.price3 && <option value={item.price3}>{Number(item.price3).toFixed(2)} (P3)</option>}
                        </select>
                    ) : (
                        <span>{item.price.toFixed(2)}</span>
                    )}
                    <span>x {item.quantity}</span>
                  </div>
                  {canUseManualPosPrice && (
                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Precio manual:</span>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        defaultValue={item.priceSource === 'MANUAL' ? item.price.toFixed(2) : ''}
                        placeholder="0.00"
                        onBlur={(e) => handleManualPriceChange(item.id, e.target.value, item.batchNo, item.imei, item.serial)}
                        style={{
                          width: 96,
                          padding: '4px 8px',
                          fontSize: '0.8rem'
                        }}
                      />
                      {item.priceSource === 'MANUAL' && (
                        <span style={{ fontSize: '0.75rem', color: '#f59e0b', fontWeight: 700 }}>
                          Manual
                        </span>
                      )}
                    </div>
                  )}
                  {item.batchNo && (
                     <div style={{ fontSize: '0.75rem', color: '#3b82f6', marginTop: 2 }}>
                        Lote: {item.batchNo} (Vence: {item.expiryDate})
                     </div>
                  )}
                  {item.imei && (
                     <div style={{ fontSize: '0.75rem', color: '#8b5cf6', marginTop: 2 }}>
                        IMEI: {item.imei}
                     </div>
                  )}
                  {item.serial && (
                     <div style={{ fontSize: '0.75rem', color: '#ec4899', marginTop: 2 }}>
                        Serial: {item.serial}
                     </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    onClick={() => updateQuantity(item.id, -1, item.batchNo, item.imei, item.serial)}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text)'
                    }}
                  >
                    <svg width="12" height="2" viewBox="0 0 12 2" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M0 1H12" stroke="currentColor" strokeWidth="2"/>
                    </svg>
                  </button>
                  <input
                    type="number"
                    min="1"
                    max={item.maxQuantity || item.stock}
                    value={item.quantity}
                    onChange={(e) => handleQuantityChange(item.id, e.target.value, item.batchNo, item.imei, item.serial)}
                    style={{
                      width: 40,
                      height: 28,
                      textAlign: 'center',
                      border: 'none',
                      background: 'transparent',
                      fontWeight: 'bold',
                      fontSize: '1rem',
                      padding: 0,
                      margin: 0,
                      color: 'var(--text)'
                    }}
                  />
                  <button
                    onClick={() => updateQuantity(item.id, 1, item.batchNo, item.imei, item.serial)}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text)'
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M6 0V12M0 6H12" stroke="currentColor" strokeWidth="2"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => removeFromCart(item.id, item.batchNo, item.imei, item.serial)}
                    className="icon-btn danger"
                    style={{
                      marginLeft: 8,
                      width: 32,
                      height: 32,
                      borderRadius: 8
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div style={{ padding: 16, borderTop: '1px solid var(--border)', backgroundColor: 'var(--bg)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.2rem', fontWeight: 'bold', marginBottom: 16, color: 'var(--text)' }}>
            <span>Total:</span>
            <span>{config?.currency} {total.toFixed(2)}</span>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold', color: 'var(--muted)' }}>Método de Pago:</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button
                onClick={() => setPaymentMethod('CASH')}
                style={{
                  padding: 8,
                  border: `1px solid ${paymentMethod === 'CASH' ? '#2ecc71' : 'var(--border)'}`,
                  backgroundColor: paymentMethod === 'CASH' ? 'rgba(46, 204, 113, 0.1)' : 'var(--modal)',
                  color: paymentMethod === 'CASH' ? '#2ecc71' : 'var(--muted)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: paymentMethod === 'CASH' ? 'bold' : 'normal'
                }}
              >
                💵 Efectivo
              </button>
              <button
                onClick={() => setPaymentMethod('CARD')}
                style={{
                  padding: 8,
                  border: `1px solid ${paymentMethod === 'CARD' ? '#3498db' : 'var(--border)'}`,
                  backgroundColor: paymentMethod === 'CARD' ? 'rgba(52, 152, 219, 0.1)' : 'var(--modal)',
                  color: paymentMethod === 'CARD' ? '#3498db' : 'var(--muted)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: paymentMethod === 'CARD' ? 'bold' : 'normal'
                }}
              >
                💳 Tarjeta
              </button>
              <button
                onClick={() => setPaymentMethod('DEPOSIT')}
                style={{
                  padding: 8,
                  border: `1px solid ${paymentMethod === 'DEPOSIT' ? '#9b59b6' : 'var(--border)'}`,
                  backgroundColor: paymentMethod === 'DEPOSIT' ? 'rgba(155, 89, 182, 0.1)' : 'var(--modal)',
                  color: paymentMethod === 'DEPOSIT' ? '#9b59b6' : 'var(--muted)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: paymentMethod === 'DEPOSIT' ? 'bold' : 'normal'
                }}
              >
                🏦 Depósito
              </button>
              <button
                onClick={() => setPaymentMethod('CREDIT')}
                style={{
                  padding: 8,
                  border: `1px solid ${paymentMethod === 'CREDIT' ? '#e67e22' : 'var(--border)'}`,
                  backgroundColor: paymentMethod === 'CREDIT' ? 'rgba(230, 126, 34, 0.1)' : 'var(--modal)',
                  color: paymentMethod === 'CREDIT' ? '#e67e22' : 'var(--muted)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: paymentMethod === 'CREDIT' ? 'bold' : 'normal'
                }}
              >
                📝 Crédito
              </button>
            </div>

            <div style={{ marginTop: 16 }}>
              {paymentMethod === 'CASH' && (
                <div>
                  <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold', color: 'var(--muted)' }}>Cantidad Recibida:</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={receivedAmount}
                    onChange={e => setReceivedAmount(e.target.value)}
                    style={{
                      width: '100%',
                      padding: 12,
                      fontSize: '1.2rem',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      background: 'var(--modal)',
                      color: 'var(--text)'
                    }}
                    placeholder="0.00"
                  />
                  <div style={{ marginTop: 8, fontSize: '1.1rem', fontWeight: 'bold', color: (parseFloat(receivedAmount) || 0) >= total ? '#2ecc71' : '#ef4444' }}>
                    Cambio: {config?.currency} {Math.max(0, (parseFloat(receivedAmount) || 0) - total).toFixed(2)}
                  </div>
                </div>
              )}

              {(paymentMethod === 'CARD' || paymentMethod === 'DEPOSIT') && (
                <div>
                  <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold', color: 'var(--muted)' }}>Número de Referencia:</label>
                  <input
                    type="text"
                    value={referenceNumber}
                    onChange={e => setReferenceNumber(e.target.value)}
                    style={{
                      width: '100%',
                      padding: 12,
                      fontSize: '1rem',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      background: 'var(--modal)',
                      color: 'var(--text)'
                    }}
                    placeholder="Ingrese número de referencia / operación"
                  />
                </div>
              )}
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, fontSize: '0.95rem', color: 'var(--text)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={shouldPrintTicket}
              onChange={e => setShouldPrintTicket(e.target.checked)}
            />
            Imprimir ticket automaticamente al completar la venta
          </label>

          <div style={{ marginBottom: 16, fontSize: '0.92rem', color: 'var(--muted)' }}>
            Al pagar se abre el dialogo de impresion. Si el entorno lo bloquea, el sistema descarga el PDF del ticket como respaldo.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button
              onClick={handleCheckout}
              disabled={cart.length === 0 || loading}
              style={{
                width: '100%',
                padding: 16,
                backgroundColor: '#16a34a',
                color: 'white',
                border: 'none',
                borderRadius: 6,
                fontSize: '1.1rem',
                fontWeight: 'bold',
                cursor: cart.length === 0 || loading ? 'not-allowed' : 'pointer',
                opacity: cart.length === 0 || loading ? 0.7 : 1
              }}
            >
              {loading ? 'Procesando...' : 'Pagar'}
            </button>

            {lastSale && (
                <div
                  style={{
                    width: '100%',
                    padding: 12,
                    backgroundColor: 'transparent',
                    color: 'var(--muted)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    fontSize: '0.95rem',
                    fontWeight: 600,
                    textAlign: 'center'
                  }}
                >
                   Ultima venta registrada: #{lastSale.saleId}
                </div>
            )}
          </div>
        </div>
      </div>
      {/* Customer Modal */}
      {isCustomerModalOpen && (
        <div className="modal-overlay" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div className="modal-content" style={{
            backgroundColor: 'var(--modal)',
            padding: 24,
            borderRadius: 16,
            width: '100%',
            maxWidth: 500,
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            border: '1px solid var(--border)',
            color: 'var(--text)'
          }}>
            <h2 style={{ marginTop: 0, marginBottom: 24 }}>Nuevo Cliente</h2>
            <form onSubmit={handleCreateCustomer}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem', color: 'var(--muted)' }}>Nombre *</label>
                  <input
                    required
                    value={newCustomer.name}
                    onChange={e => setNewCustomer({ ...newCustomer, name: e.target.value })}
                    style={{
                      width: '100%',
                      padding: 10,
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      outline: 'none'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem', color: 'var(--muted)' }}>Documento / RUT</label>
                  <input
                    value={newCustomer.document}
                    onChange={e => setNewCustomer({ ...newCustomer, document: e.target.value })}
                    style={{
                      width: '100%',
                      padding: 10,
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      outline: 'none'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem', color: 'var(--muted)' }}>Teléfono</label>
                  <input
                    value={newCustomer.phone}
                    onChange={e => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                    style={{
                      width: '100%',
                      padding: 10,
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      outline: 'none'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem', color: 'var(--muted)' }}>Email</label>
                  <input
                    type="email"
                    value={newCustomer.email}
                    onChange={e => setNewCustomer({ ...newCustomer, email: e.target.value })}
                    style={{
                      width: '100%',
                      padding: 10,
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      outline: 'none'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 8, fontSize: '0.9rem', color: 'var(--muted)' }}>Dirección</label>
                  <input
                    value={newCustomer.address}
                    onChange={e => setNewCustomer({ ...newCustomer, address: e.target.value })}
                    style={{
                      width: '100%',
                      padding: 10,
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      background: 'var(--bg)',
                      color: 'var(--text)',
                      outline: 'none'
                    }}
                  />
                </div>
              </div>
              <div className="modal-footer" style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button
                  type="button"
                  onClick={() => setIsCustomerModalOpen(false)}
                  disabled={loading}
                  style={{
                    padding: '10px 16px',
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--text)',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    opacity: loading ? 0.7 : 1
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    padding: '10px 16px',
                    backgroundColor: 'var(--accent)',
                    color: '#052b35',
                    border: 'none',
                    borderRadius: 8,
                    fontWeight: 700,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    opacity: loading ? 0.7 : 1
                  }}
                >
                  {loading ? 'Guardando...' : 'Guardar y Seleccionar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Batch Selection Modal */}
      {selectedProductForBatch && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100 }}>
          <div style={{ background: 'var(--modal)', padding: 20, borderRadius: 12, width: 500, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
            <h3 style={{ marginTop: 0, marginBottom: 15 }}>Seleccionar Lote para {selectedProductForBatch.name}</h3>

            <input
              type="text"
              placeholder="Buscar lote..."
              value={modalSearchTerm}
              onChange={e => setModalSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '10px',
                marginBottom: 15,
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--bg)',
                color: 'var(--text)',
                outline: 'none'
              }}
              autoFocus
            />

            <div style={{ flex: 1, overflowY: 'auto', marginBottom: 15 }}>
               {availableBatches.filter(b => b.batchNo.toLowerCase().includes(modalSearchTerm.toLowerCase())).length === 0 ? (
                   <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>
                     {availableBatches.length === 0 ? 'No hay lotes disponibles' : 'No se encontraron lotes'}
                   </div>
               ) : (
                   <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                       <thead>
                           <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                               <th style={{ padding: 8 }}>Lote</th>
                               <th style={{ padding: 8 }}>Vence</th>
                               <th style={{ padding: 8, textAlign: 'right' }}>Disp.</th>
                               <th style={{ padding: 8 }}></th>
                           </tr>
                       </thead>
                       <tbody>
                           {availableBatches
                             .filter(b => b.batchNo.toLowerCase().includes(modalSearchTerm.toLowerCase()))
                             .map((b, index) => {
                               const isBest = availableBatches.length > 0 && availableBatches[0].batchNo === b.batchNo
                               return (
                               <tr key={b.batchNo} style={{ borderBottom: '1px solid var(--border)', backgroundColor: isBest ? 'rgba(234, 179, 8, 0.1)' : 'transparent' }}>
                                   <td style={{ padding: 8 }}>
                                       {b.batchNo}
                                       {isBest && (
                                           <span style={{
                                               fontSize: '0.7em',
                                               backgroundColor: '#eab308',
                                               color: '#000',
                                               padding: '2px 6px',
                                               borderRadius: 4,
                                               marginLeft: 8,
                                               fontWeight: 'bold'
                                           }}>
                                               Sugerido
                                           </span>
                                       )}
                                   </td>
                                   <td style={{ padding: 8 }}>{b.expiryDate}</td>
                                   <td style={{ padding: 8, textAlign: 'right' }}>{b.quantity}</td>
                                   <td style={{ padding: 8, textAlign: 'right' }}>
                                       <button
                                           className="btn-primary"
                                           onClick={() => {
                                               addBatchToCart(selectedProductForBatch, b, 1)
                                           }}
                                           style={{ fontSize: '0.8em', padding: '4px 8px' }}
                                       >
                                           Agregar
                                       </button>
                                   </td>
                               </tr>
                               )
                           })}
                       </tbody>
                   </table>
               )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                    onClick={() => setSelectedProductForBatch(null)}
                    style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text)' }}
                >
                    Cancelar
                </button>
            </div>
          </div>
        </div>
      )}

      {/* IMEI Selection Modal */}
      {selectedProductForImei && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100 }}>
          <div style={{ background: 'var(--modal)', padding: 20, borderRadius: 12, width: 400, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
            <h3 style={{ marginTop: 0, marginBottom: 15 }}>Seleccionar IMEI para {selectedProductForImei.name}</h3>

            <input
              type="text"
              placeholder="Buscar IMEI..."
              value={modalSearchTerm}
              onChange={e => setModalSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '10px',
                marginBottom: 15,
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--bg)',
                color: 'var(--text)',
                outline: 'none'
              }}
              autoFocus
            />

            <div style={{ flex: 1, overflowY: 'auto', marginBottom: 15 }}>
               {availableImeis.filter(imei => imei.toLowerCase().includes(modalSearchTerm.toLowerCase())).length === 0 ? (
                   <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>
                     {availableImeis.length === 0 ? 'No hay IMEIs disponibles' : 'No se encontraron IMEIs'}
                   </div>
               ) : (
                   <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                       {availableImeis
                         .filter(imei => imei.toLowerCase().includes(modalSearchTerm.toLowerCase()))
                         .map(imei => (
                           <button
                               key={imei}
                               onClick={() => addImeiToCart(selectedProductForImei, imei)}
                               style={{ padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}
                           >
                               {imei}
                           </button>
                       ))}
                   </div>
               )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                    onClick={() => setSelectedProductForImei(null)}
                    style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text)' }}
                >
                    Cancelar
                </button>
            </div>
          </div>
        </div>
      )}

      {/* Serial Selection Modal */}
      {selectedProductForSerial && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100 }}>
          <div style={{ background: 'var(--modal)', padding: 20, borderRadius: 12, width: 400, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
            <h3 style={{ marginTop: 0, marginBottom: 15 }}>Seleccionar Serial para {selectedProductForSerial.name}</h3>

            <input
              type="text"
              placeholder="Buscar Serial..."
              value={modalSearchTerm}
              onChange={e => setModalSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '10px',
                marginBottom: 15,
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--bg)',
                color: 'var(--text)',
                outline: 'none'
              }}
              autoFocus
            />

            <div style={{ flex: 1, overflowY: 'auto', marginBottom: 15 }}>
               {availableSerials.filter(serial => serial.toLowerCase().includes(modalSearchTerm.toLowerCase())).length === 0 ? (
                   <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)' }}>
                     {availableSerials.length === 0 ? 'No hay Seriales disponibles' : 'No se encontraron Seriales'}
                   </div>
               ) : (
                   <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                       {availableSerials
                         .filter(serial => serial.toLowerCase().includes(modalSearchTerm.toLowerCase()))
                         .map(serial => (
                           <button
                               key={serial}
                               onClick={() => addSerialToCart(selectedProductForSerial, serial)}
                               style={{ padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}
                           >
                               {serial}
                           </button>
                       ))}
                   </div>
               )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                    onClick={() => setSelectedProductForSerial(null)}
                    style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer', color: 'var(--text)' }}
                >
                    Cancelar
                </button>
            </div>
          </div>
        </div>
      )}

      {/* Warehouse Stock Modal */}
      {viewStockProduct && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1200 }}>
          <div style={{ background: 'var(--modal)', padding: 24, borderRadius: 16, width: 400, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, color: 'var(--text)' }}>Existencias por Almacén</h3>
              <button
                onClick={() => setViewStockProduct(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 600, color: 'var(--text)' }}>{viewStockProduct.name}</div>
              <div style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>SKU: {viewStockProduct.sku || 'N/A'}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: 6 }}>
                Consulta informativa. La venta sigue limitada a la tienda asignada.
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {loadingStocks ? (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--muted)' }}>Cargando...</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      <th style={{ textAlign: 'left', padding: '8px 4px', color: 'var(--muted)', fontSize: '0.9rem' }}>Almacén</th>
                      <th style={{ textAlign: 'right', padding: '8px 4px', color: 'var(--muted)', fontSize: '0.9rem' }}>Cantidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {warehouseStocks.map((ws: any, idx) => (
                      <tr
                        key={idx}
                        style={{
                          borderBottom: '1px solid var(--border)',
                          ...(String(user?.warehouseId) === String(ws.warehouseId)
                            ? { background: 'rgba(59, 130, 246, 0.10)' }
                            : {})
                        }}
                      >
                        <td style={{ padding: '12px 4px', color: 'var(--text)' }}>
                          {ws.warehouseName}
                          {String(user?.warehouseId) === String(ws.warehouseId) ? ' (Actual)' : ''}
                        </td>
                        <td style={{ padding: '12px 4px', textAlign: 'right', fontWeight: 600, color: 'var(--text)' }}>
                          {ws.quantity}
                        </td>
                      </tr>
                    ))}
                    {warehouseStocks.length === 0 && (
                      <tr>
                        <td colSpan={2} style={{ textAlign: 'center', padding: 20, color: 'var(--muted)' }}>
                          No hay stock registrado en almacenes
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Cash Register Closed Warning */}
      {isCashOpen === false && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2000 }}>
          <div style={{ background: 'var(--modal)', padding: 30, borderRadius: 16, width: 400, textAlign: 'center', boxShadow: '0 10px 40px rgba(0,0,0,0.5)', border: '1px solid var(--border)' }}>
            <div style={{ marginBottom: 15, display: 'flex', justifyContent: 'center' }}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text)' }}>
                <rect x="3" y="11" width="18" height="11" rx="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
            </div>
            <h2 style={{ marginTop: 0, marginBottom: 15, color: 'var(--text)' }}>Caja Cerrada</h2>
            <p style={{ color: 'var(--muted)', marginBottom: 25, lineHeight: 1.5 }}>
              Debes realizar la apertura de caja antes de poder realizar ventas.
            </p>
            <button
              onClick={() => navigate('/cash-register')}
              className="btn-primary"
              style={{ width: '100%', padding: '12px 0', fontSize: '1.1rem' }}
            >
              Ir a Apertura de Caja
            </button>
          </div>
        </div>
      )}

      {/* Hidden iframe for printing */}
      <iframe
        ref={iframeRef}
        style={{
          position: 'absolute',
          width: '0px',
          height: '0px',
          border: 'none',
          visibility: 'hidden'
        }}
      />
    </div>
  )
}
