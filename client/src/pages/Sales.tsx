import { useState, useEffect, useRef } from 'react'
import { Navigate } from 'react-router-dom'
import { api, getSales, getSaleDetails, cancelSale } from '../api'
import { useConfigStore } from '../store/config'
import { useAuthStore } from '../store/auth'
import { formatDate, formatDateTime } from '../utils/date'
import jsPDF from 'jspdf'
import { formatCompanyName } from '../utils/text'
import { addLogoToPdf } from '../utils/printBranding'

interface Sale {
  id: number
  doc_no: string
  total: number
  created_at: string
  credit_fully_paid_at?: string | null
  payment_method: string
  customer_name?: string
  received_amount?: number
  change_amount?: number
  reference_number?: string
  is_credit?: number
  credit_fully_paid?: number
  status?: string
  cancellation_reason?: string
  seller_id?: number | null
  seller_name?: string | null
  cost_total?: number
  profit?: number
}

interface SaleItem {
  id: number
  product_name: string
  sku?: string
  quantity: number
  unit_price: number
  total: number
}

interface SaleDetail extends Sale {
  items: SaleItem[]
  customer_document?: string
  customer_address?: string
  customer_phone?: string
}

interface SalesSummary {
  records: number
  grossTotal: number
  netTotal: number
  totalProfit: number
  cancelledCount: number
  byMethod: Record<string, number>
}

interface UserSalesSummary {
  userId: number | null
  userName: string
  salesCount: number
  grossTotal: number
  total: number
  profit: number
  cancelledCount: number
}

interface UserOption {
  id: number
  name: string
}

type PeriodMode = 'all' | 'day' | 'month' | 'year' | 'range'
const EMPTY_SUMMARY: SalesSummary = {
  records: 0,
  grossTotal: 0,
  netTotal: 0,
  totalProfit: 0,
  cancelledCount: 0,
  byMethod: {},
}

type PaymentFilter = 'NON_CREDIT' | 'CASH' | 'CARD' | 'DEPOSIT' | 'CREDIT' | 'CREDIT_PAID' | 'REALIZED' | 'ALL'
type StatusFilter = 'ACTIVE' | 'CANCELLED' | 'ALL'

function getPaymentFilterLabel(filter: PaymentFilter) {
  if (filter === 'NON_CREDIT') return 'Sin crédito'
  if (filter === 'CASH') return 'Efectivo'
  if (filter === 'CARD') return 'Tarjeta'
  if (filter === 'DEPOSIT') return 'Depósito'
  if (filter === 'CREDIT') return 'Crédito'
  if (filter === 'CREDIT_PAID') return 'Crédito liquidado'
  if (filter === 'REALIZED') return 'Cobrado + liquidados'
  return 'Todos'
}

function getStatusFilterLabel(filter: StatusFilter) {
  if (filter === 'ACTIVE') return 'Activas'
  if (filter === 'CANCELLED') return 'Canceladas'
  return 'Todas'
}

function isCreditSale(sale?: Pick<Sale, 'payment_method' | 'is_credit'> | null) {
  return sale?.payment_method === 'CREDIT' || Boolean(sale?.is_credit)
}

function getSaleStatusLabel(sale: Pick<Sale, 'status' | 'payment_method' | 'is_credit' | 'credit_fully_paid'>, filter: PaymentFilter) {
  if (sale.status === 'CANCELLED') return 'CANCELADO'
  if (filter === 'CREDIT_PAID') return 'LIQUIDADO'
  if (filter === 'REALIZED' && isCreditSale(sale)) return 'LIQUIDADO'
  if (isCreditSale(sale) && !sale.credit_fully_paid) return 'PENDIENTE'
  if (isCreditSale(sale)) return 'LIQUIDADO'
  return 'PAGADO'
}

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function formatInputDate(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function getMonthBounds(value: string) {
  const [yearRaw, monthRaw] = value.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  if (!year || !month) return { startDate: '', endDate: '', label: 'Todas las fechas' }
  const lastDay = new Date(year, month, 0).getDate()
  return {
    startDate: `${year}-${pad2(month)}-01`,
    endDate: `${year}-${pad2(month)}-${pad2(lastDay)}`,
    label: `Mes ${pad2(month)}/${year}`,
  }
}

function getYearBounds(value: string) {
  const year = Number(value)
  if (!year) return { startDate: '', endDate: '', label: 'Todas las fechas' }
  return {
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
    label: `Año ${year}`,
  }
}

function getDateRangeLabel(startDate: string, endDate: string) {
  if (startDate && endDate) {
    return `${startDate} a ${endDate}`
  }
  if (startDate) return `Desde ${startDate}`
  if (endDate) return `Hasta ${endDate}`
  return 'Todas las fechas'
}

function getPaymentMethodLabel(method?: string, isCredit?: number) {
  if (method === 'CASH') return 'Efectivo'
  if (method === 'CARD') return 'Tarjeta'
  if (method === 'DEPOSIT') return 'Depósito'
  if (method === 'CREDIT' || isCredit) return 'Crédito'
  return method || 'N/D'
}

function DateField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 140 }}>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
      {children}
    </label>
  )
}

export default function Sales() {
  const today = new Date()
  const todayString = formatInputDate(today)
  const currentMonth = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}`
  const defaultMonthRange = getMonthBounds(currentMonth)

  const [sales, setSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(false)
  const [pagination, setPagination] = useState({ total: 0, limit: 20, offset: 0 })
  const [summary, setSummary] = useState<SalesSummary>(EMPTY_SUMMARY)
  const [byUser, setByUser] = useState<UserSalesSummary[]>([])
  const [userOptions, setUserOptions] = useState<UserOption[]>([])
  const [searchInput, setSearchInput] = useState('')
  const [periodMode, setPeriodMode] = useState<PeriodMode>('day')
  const [selectedDay, setSelectedDay] = useState(todayString)
  const [selectedMonth, setSelectedMonth] = useState(currentMonth)
  const [selectedYear, setSelectedYear] = useState(String(today.getFullYear()))
  const [rangeStart, setRangeStart] = useState(todayString)
  const [rangeEnd, setRangeEnd] = useState(todayString)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('ALL')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ACTIVE')
  const [appliedFilters, setAppliedFilters] = useState({
    search: '',
    startDate: todayString,
    endDate: todayString,
    userId: '',
    paymentMethod: 'ALL' as PaymentFilter,
    statusFilter: 'ACTIVE' as StatusFilter,
    label: `${todayString} | Método: ${getPaymentFilterLabel('ALL')} | Estado: ${getStatusFilterLabel('ACTIVE')}`,
  })
  const [selectedSale, setSelectedSale] = useState<SaleDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [saleToCancel, setSaleToCancel] = useState<Sale | null>(null)
  const [cancellingSale, setCancellingSale] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const config = useConfigStore(s => s.config)
  const companyName = formatCompanyName(config?.name)
  const user = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'ADMIN'

  if (user && !isAdmin) {
    return <Navigate to="/my-sales" replace />
  }

  useEffect(() => {
    loadSales()
  }, [pagination.offset, appliedFilters])

  useEffect(() => {
    if (!isAdmin) return
    let ignore = false

    async function loadUsers() {
      try {
        const { data } = await api.get('/users')
        if (ignore) return
        setUserOptions(
          (Array.isArray(data) ? data : [])
            .map(item => ({ id: Number(item.id), name: String(item.name || '') }))
            .filter(item => item.id > 0 && item.name)
        )
      } catch (err) {
        console.error('Error loading users:', err)
      }
    }

    loadUsers()
    return () => {
      ignore = true
    }
  }, [isAdmin])

  const loadSales = async () => {
    setLoading(true)
    try {
      const res = await getSales({
        limit: pagination.limit,
        offset: pagination.offset,
        search: appliedFilters.search,
        startDate: appliedFilters.startDate || undefined,
        endDate: appliedFilters.endDate || undefined,
        userId: appliedFilters.userId || undefined,
        paymentMethod: appliedFilters.paymentMethod !== 'ALL' ? appliedFilters.paymentMethod : undefined,
        statusFilter: appliedFilters.statusFilter,
      })
      setSales(res.data)
      setPagination(prev => ({ ...prev, total: res.pagination.total }))
      setSummary(res.summary ?? EMPTY_SUMMARY)
      setByUser(Array.isArray(res.byUser) ? res.byUser : [])
    } catch (err) {
      console.error('Error loading sales:', err)
      setSummary(EMPTY_SUMMARY)
      setByUser([])
    } finally {
      setLoading(false)
    }
  }

  const applyFilters = (e?: React.FormEvent) => {
    e?.preventDefault()

    let nextStartDate = ''
    let nextEndDate = ''
    let label = 'Todas las fechas'

    if (periodMode === 'day') {
      nextStartDate = selectedDay
      nextEndDate = selectedDay
      label = selectedDay || 'Día seleccionado'
    } else if (periodMode === 'month') {
      const monthRange = getMonthBounds(selectedMonth)
      nextStartDate = monthRange.startDate
      nextEndDate = monthRange.endDate
      label = monthRange.label
    } else if (periodMode === 'year') {
      const yearRange = getYearBounds(selectedYear)
      nextStartDate = yearRange.startDate
      nextEndDate = yearRange.endDate
      label = yearRange.label
    } else if (periodMode === 'range') {
      nextStartDate = rangeStart
      nextEndDate = rangeEnd
      label = getDateRangeLabel(rangeStart, rangeEnd)
    }

    setPagination(prev => ({ ...prev, offset: 0 }))
    setAppliedFilters({
      search: searchInput.trim(),
      startDate: nextStartDate,
      endDate: nextEndDate,
      userId: selectedUserId,
      paymentMethod: paymentFilter,
      statusFilter,
      label: `${label} | Método: ${getPaymentFilterLabel(paymentFilter)} | Estado: ${getStatusFilterLabel(statusFilter)}`,
    })
  }

  const resetFilters = () => {
    setSearchInput('')
    setSelectedUserId('')
    setPaymentFilter('ALL')
    setStatusFilter('ACTIVE')
    setPeriodMode('day')
    setSelectedDay(todayString)
    setSelectedMonth(currentMonth)
    setSelectedYear(String(today.getFullYear()))
    setRangeStart(todayString)
    setRangeEnd(todayString)
    setPagination(prev => ({ ...prev, offset: 0 }))
    setAppliedFilters({
      search: '',
      startDate: todayString,
      endDate: todayString,
      userId: '',
      paymentMethod: 'ALL',
      statusFilter: 'ACTIVE',
      label: `${todayString} | Método: ${getPaymentFilterLabel('ALL')} | Estado: ${getStatusFilterLabel('ACTIVE')}`,
    })
  }

  const handleViewDetails = async (saleId: number) => {
    setDetailLoading(true)
    setIsModalOpen(true)
    try {
      const data = await getSaleDetails(saleId)
      setSelectedSale(data)
    } catch (err) {
      console.error('Error details:', err)
      alert('Error cargando detalles')
      setIsModalOpen(false)
    } finally {
      setDetailLoading(false)
    }
  }

  const handleCancelClick = (sale: Sale) => {
    setSaleToCancel(sale)
    setCancelReason('')
    setIsCancelModalOpen(true)
  }

  const confirmCancel = async () => {
    if (!saleToCancel || !cancelReason.trim()) return
    if (cancellingSale) return
    try {
      setCancellingSale(true)
      await cancelSale(saleToCancel.id, cancelReason)
      setIsCancelModalOpen(false)
      setSaleToCancel(null)
      loadSales()
    } catch (err: any) {
      alert(err.response?.data?.error || 'Error al cancelar venta')
    } finally {
      setCancellingSale(false)
    }
  }

  const formatMoney = (value?: number) => `${config?.currency ?? '$'} ${Number(value || 0).toFixed(2)}`

  const downloadTicketPdf = (blobUrl: string, saleId: number) => {
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = `ticket-venta-${saleId}.pdf`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
  }

  const generateTicket = async (sale: SaleDetail) => {
     // Calcular altura dinámica
     const headerHeight = 58
     const itemHeight = 5
     const footerHeight = 40
     const totalHeight = headerHeight + (sale.items.length * itemHeight) + footerHeight
     
     const doc = new jsPDF({
       orientation: 'portrait',
       unit: 'mm',
       format: [80, Math.max(200, totalHeight)]
     })
 
     const logoHeight = await addLogoToPdf(doc, config?.logoUrl, { x: 28, y: 4, maxWidth: 24, maxHeight: 18 })
     const headerTextY = logoHeight > 0 ? 27 : 5

     doc.setFontSize(10)
     doc.text(companyName, 40, headerTextY, { align: 'center' })
     doc.setFontSize(8)
     doc.text(`Fecha: ${formatDateTime(sale.created_at)}`, 5, headerTextY + 10)
     doc.text(`Venta #${sale.id}`, 5, headerTextY + 15)
     
     if (sale.customer_name) {
       doc.text(`Cliente: ${sale.customer_name}`, 5, headerTextY + 20)
     }
 
     const dividerY = headerTextY + (sale.customer_name ? 25 : 20)
     doc.line(5, dividerY, 75, dividerY)
     
     let y = dividerY + 5
     sale.items.forEach(item => {
       const lineTotal = item.unit_price * item.quantity
       doc.text(`${item.product_name.substring(0, 20)}`, 5, y)
       doc.text(`${item.quantity} x ${Number(item.unit_price).toFixed(2)}`, 50, y, { align: 'right' })
       doc.text(`${Number(lineTotal).toFixed(2)}`, 75, y, { align: 'right' })
       y += 5
     })
 
     doc.line(5, y, 75, y)
     y += 5
     doc.setFontSize(10)
     doc.text(`TOTAL: ${config?.currency} ${Number(sale.total).toFixed(2)}`, 75, y, { align: 'right' })
     
     y += 5
     doc.setFontSize(8)
     
    if (sale.payment_method === 'CASH') {
        doc.text(`Efectivo: ${Number(sale.received_amount || 0).toFixed(2)}`, 5, y)
        y += 4
        doc.text(`Cambio: ${Number(sale.change_amount || 0).toFixed(2)}`, 5, y)
    } else if (sale.payment_method === 'CARD') {
        doc.text(`Tarjeta Ref: ${sale.reference_number || ''}`, 5, y)
    } else if (sale.payment_method === 'DEPOSIT') {
        doc.text(`Depósito Ref: ${sale.reference_number || ''}`, 5, y)
    } else if (sale.payment_method === 'CREDIT' || sale.is_credit) {
        doc.text(`Venta a Crédito`, 5, y)
    }
 
     // Imprimir
     const blob = doc.output('blob')
     const blobUrl = URL.createObjectURL(blob)
     
    downloadTicketPdf(blobUrl, sale.id)
   }

  const totalPages = Math.ceil(pagination.total / pagination.limit)
  const currentPage = Math.floor(pagination.offset / pagination.limit) + 1

  return (
    <div className="page-shell">
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
      <div className="page-toolbar" style={{ marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0 }}>Historial General de Ventas</h2>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>
            Periodo: {appliedFilters.label} | Responsable: {appliedFilters.userId ? (userOptions.find(item => String(item.id) === appliedFilters.userId)?.name || 'Filtrado') : 'Todos'}
          </div>
        </div>
        <form onSubmit={applyFilters} className="page-toolbar-actions" style={{ width: '100%' }}>
          <input
            type="text"
            placeholder="Buscar por Doc / Cliente / ID / Responsable"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'inherit', minWidth: 220, maxWidth: '100%' }}
          />
          {isAdmin && (
            <select
              value={selectedUserId}
              onChange={e => setSelectedUserId(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'inherit' }}
            >
              <option value="">Todos los usuarios</option>
              {userOptions.map(option => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
            </select>
          )}
          <DateField label="Método de pago">
            <select
              value={paymentFilter}
              onChange={e => setPaymentFilter(e.target.value as PaymentFilter)}
              style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'inherit' }}
            >
              <option value="NON_CREDIT">Sin crédito</option>
              <option value="CASH">Efectivo</option>
              <option value="DEPOSIT">Depósito</option>
              <option value="CARD">Tarjeta</option>
              <option value="CREDIT">Crédito</option>
              <option value="CREDIT_PAID">Crédito liquidado</option>
              <option value="REALIZED">Efectivo/Depósito/Tarjeta + Créditos liquidados</option>
              <option value="ALL">Todos</option>
            </select>
          </DateField>
          <DateField label="Estado">
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as StatusFilter)}
              style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'inherit' }}
            >
              <option value="ACTIVE">Activas</option>
              <option value="CANCELLED">Canceladas</option>
              <option value="ALL">Todas</option>
            </select>
          </DateField>
          <DateField label="Tipo de filtro">
            <select
              value={periodMode}
              onChange={e => setPeriodMode(e.target.value as PeriodMode)}
              style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'inherit' }}
            >
              <option value="all">Todas las fechas</option>
              <option value="day">Día específico</option>
              <option value="month">Mes</option>
              <option value="year">Año</option>
              <option value="range">Fecha inicial / final</option>
            </select>
          </DateField>
          {periodMode === 'day' && (
            <DateField label="Fecha del día">
              <input
                type="date"
                value={selectedDay}
                onChange={e => setSelectedDay(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'inherit' }}
              />
            </DateField>
          )}
          {periodMode === 'month' && (
            <DateField label="Mes seleccionado">
              <input
                type="month"
                value={selectedMonth}
                onChange={e => setSelectedMonth(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'inherit' }}
              />
            </DateField>
          )}
          {periodMode === 'year' && (
            <DateField label="Año seleccionado">
              <input
                type="number"
                min="2020"
                max="2100"
                step="1"
                value={selectedYear}
                onChange={e => setSelectedYear(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'inherit', width: 120 }}
              />
            </DateField>
          )}
          {periodMode === 'range' && (
            <>
              <DateField label="Fecha inicial">
                <input
                  type="date"
                  value={rangeStart}
                  onChange={e => setRangeStart(e.target.value)}
                  style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'inherit' }}
                />
              </DateField>
              <DateField label="Fecha final">
                <input
                  type="date"
                  value={rangeEnd}
                  onChange={e => setRangeEnd(e.target.value)}
                  style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'inherit' }}
                />
              </DateField>
            </>
          )}
          <button type="submit" className="primary-btn">Filtrar</button>
          <button type="button" className="secondary-btn" onClick={resetFilters}>Limpiar</button>
        </form>
      </div>

      <div className="responsive-form-grid" style={{ marginBottom: 20 }}>
        <div style={{ background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 6 }}>Total vendido</div>
          <div style={{ fontWeight: 700, fontSize: 22 }}>{formatMoney(summary.netTotal)}</div>
        </div>
        <div style={{ background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 6 }}>Utilidad</div>
          <div style={{ fontWeight: 700, fontSize: 22, color: '#22c55e' }}>{formatMoney(summary.totalProfit)}</div>
        </div>
        <div style={{ background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 6 }}>Ventas registradas</div>
          <div style={{ fontWeight: 700, fontSize: 22 }}>{summary.records}</div>
        </div>
        <div style={{ background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 6 }}>Canceladas</div>
          <div style={{ fontWeight: 700, fontSize: 22, color: summary.cancelledCount ? '#ef4444' : 'inherit' }}>{summary.cancelledCount}</div>
        </div>
      </div>

      <div className="responsive-form-grid" style={{ marginBottom: 20 }}>
        <div style={{ background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 6 }}>Efectivo</div>
          <div style={{ fontWeight: 700, fontSize: 22 }}>{formatMoney(summary.byMethod.CASH)}</div>
        </div>
        <div style={{ background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 6 }}>Depósito</div>
          <div style={{ fontWeight: 700, fontSize: 22 }}>{formatMoney(summary.byMethod.DEPOSIT)}</div>
        </div>
        <div style={{ background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 6 }}>Tarjeta</div>
          <div style={{ fontWeight: 700, fontSize: 22 }}>{formatMoney(summary.byMethod.CARD)}</div>
        </div>
        <div style={{ background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 6 }}>Crédito</div>
          <div style={{ fontWeight: 700, fontSize: 22 }}>{formatMoney(summary.byMethod.CREDIT)}</div>
        </div>
      </div>

      {isAdmin && (
        <div style={{ marginBottom: 20, background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Ventas por Usuario</h3>
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
              Resumen del mismo periodo filtrado
            </div>
          </div>
          <div className="table-scroll">
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: 12, textAlign: 'left' }}>Responsable</th>
                  <th style={{ padding: 12, textAlign: 'right' }}>Ventas</th>
                  <th style={{ padding: 12, textAlign: 'right' }}>Total</th>
                  <th style={{ padding: 12, textAlign: 'right' }}>Utilidad</th>
                  <th style={{ padding: 12, textAlign: 'right' }}>Canceladas</th>
                </tr>
              </thead>
              <tbody>
                {byUser.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 18, textAlign: 'center', color: 'var(--muted)' }}>
                      No hay datos por usuario para este filtro.
                    </td>
                  </tr>
                ) : (
                  byUser.map(item => (
                    <tr key={`${item.userId ?? 'unknown'}-${item.userName}`} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: 12 }}>{item.userName}</td>
                      <td style={{ padding: 12, textAlign: 'right' }}>{item.salesCount}</td>
                      <td style={{ padding: 12, textAlign: 'right', fontWeight: 600 }}>{formatMoney(item.total)}</td>
                      <td style={{ padding: 12, textAlign: 'right', color: '#22c55e', fontWeight: 600 }}>{formatMoney(item.profit)}</td>
                      <td style={{ padding: 12, textAlign: 'right' }}>{item.cancelledCount}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="table-scroll" style={{ background: 'var(--modal)', borderRadius: 12, border: '1px solid var(--border)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: 12, textAlign: 'left' }}>ID</th>
              <th style={{ padding: 12, textAlign: 'left' }}>Fecha</th>
              <th style={{ padding: 12, textAlign: 'left' }}>Responsable</th>
              <th style={{ padding: 12, textAlign: 'left' }}>Cliente</th>
              <th style={{ padding: 12, textAlign: 'left' }}>Método</th>
              <th style={{ padding: 12, textAlign: 'center' }}>Estado</th>
              <th style={{ padding: 12, textAlign: 'right' }}>Total</th>
              <th style={{ padding: 12, textAlign: 'right' }}>Utilidad</th>
              <th style={{ padding: 12, textAlign: 'center' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>Cargando...</td></tr>
            ) : sales.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>No se encontraron ventas</td></tr>
            ) : (
              sales.map(sale => (
                <tr key={sale.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 12 }}>#{sale.id}</td>
                  <td style={{ padding: 12 }}>
                    <div>{formatDateTime((appliedFilters.paymentMethod === 'CREDIT_PAID' || (appliedFilters.paymentMethod === 'REALIZED' && isCreditSale(sale))) ? (sale.credit_fully_paid_at || sale.created_at) : sale.created_at)}</div>
                    {isCreditSale(sale) && sale.credit_fully_paid_at && (
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                        Liquidado: {formatDateTime(sale.credit_fully_paid_at)}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: 12 }}>{sale.seller_name || 'SIN USUARIO'}</td>
                  <td style={{ padding: 12 }}>{sale.customer_name || 'General'}</td>
                  <td style={{ padding: 12 }}>{getPaymentMethodLabel(sale.payment_method, sale.is_credit)}</td>
                  <td style={{ padding: 12, textAlign: 'center' }}>
                    {getSaleStatusLabel(sale, appliedFilters.paymentMethod) === 'CANCELADO' ? (
                        <span style={{ 
                            backgroundColor: 'rgba(231, 76, 60, 0.2)', 
                            color: '#e74c3c', 
                            padding: '4px 8px', 
                            borderRadius: 12, 
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            border: '1px solid rgba(231, 76, 60, 0.3)'
                        }}>
                            CANCELADO
                        </span>
                    ) : getSaleStatusLabel(sale, appliedFilters.paymentMethod) === 'PENDIENTE' ? (
                        <span style={{ 
                            backgroundColor: 'rgba(231, 76, 60, 0.2)', 
                            color: '#e74c3c', 
                            padding: '4px 8px', 
                            borderRadius: 12, 
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            border: '1px solid rgba(231, 76, 60, 0.3)'
                        }}>
                            PENDIENTE
                        </span>
                    ) : getSaleStatusLabel(sale, appliedFilters.paymentMethod) === 'LIQUIDADO' ? (
                        <span style={{ 
                            backgroundColor: 'rgba(46, 204, 113, 0.2)', 
                            color: '#2ecc71', 
                            padding: '4px 8px', 
                            borderRadius: 12, 
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            border: '1px solid rgba(46, 204, 113, 0.3)'
                        }}>
                            LIQUIDADO
                        </span>
                    ) : (
                        <span style={{ 
                            backgroundColor: 'rgba(46, 204, 113, 0.2)', 
                            color: '#2ecc71', 
                            padding: '4px 8px', 
                            borderRadius: 12, 
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            border: '1px solid rgba(46, 204, 113, 0.3)'
                        }}>
                            PAGADO
                        </span>
                    )}
                  </td>
                  <td style={{ padding: 12, textAlign: 'right', fontWeight: 600 }}>
                    {formatMoney(sale.total)}
                  </td>
                  <td style={{ padding: 12, textAlign: 'right', fontWeight: 600, color: '#22c55e' }}>
                    {formatMoney(sale.profit)}
                  </td>
                  <td style={{ padding: 12, textAlign: 'center', display: 'flex', gap: 5, justifyContent: 'center' }}>
                    <button 
                      onClick={() => handleViewDetails(sale.id)}
                      className="icon-btn primary"
                      title="Ver detalles"
                    >
                      <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" fill="currentColor"/></svg>
                    </button>
                    {sale.status !== 'CANCELLED' && (
                        <button
                        onClick={() => handleCancelClick(sale)}
                        className="icon-btn danger"
                        title="Cancelar venta"
                        >
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="15" y1="9" x2="9" y2="15" />
                            <line x1="9" y1="9" x2="15" y2="15" />
                        </svg>
                        </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button 
          className="icon-btn"
          disabled={pagination.offset === 0}
          onClick={() => setPagination(prev => ({ ...prev, offset: prev.offset - prev.limit }))}
          style={{ opacity: pagination.offset === 0 ? 0.5 : 1 }}
        >
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" fill="currentColor"/></svg>
        </button>
        <span style={{ color: 'var(--muted)' }}>Página {currentPage} de {totalPages || 1}</span>
        <button 
          className="icon-btn"
          disabled={pagination.offset + pagination.limit >= pagination.total}
          onClick={() => setPagination(prev => ({ ...prev, offset: prev.offset + prev.limit }))}
          style={{ opacity: (pagination.offset + pagination.limit >= pagination.total) ? 0.5 : 1 }}
        >
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" fill="currentColor"/></svg>
        </button>
      </div>

      {isModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="responsive-modal" style={{ background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, width: '90%', maxWidth: 700, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20, alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>Detalle de Venta #{selectedSale?.id}</h3>
              <button onClick={() => setIsModalOpen(false)} className="icon-btn" title="Cerrar">
                <svg viewBox="0 0 24 24" width="20" height="20"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              </button>
            </div>

            {detailLoading || !selectedSale ? (
              <p style={{ textAlign: 'center', color: 'var(--muted)', padding: 20 }}>Cargando detalles...</p>
            ) : (
              <div>
                <div className="responsive-form-grid" style={{ marginBottom: 24, background: 'var(--bg)', padding: 16, borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div>
                    <strong style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 2 }}>Fecha</strong>
                    {formatDate(selectedSale.created_at)}
                  </div>
                  {isCreditSale(selectedSale) && selectedSale.credit_fully_paid_at && (
                    <div>
                      <strong style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 2 }}>Liquidado el</strong>
                      {formatDateTime(selectedSale.credit_fully_paid_at)}
                    </div>
                  )}
                  <div>
                    <strong style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 2 }}>Cliente</strong>
                    {selectedSale.customer_name || 'General'}
                  </div>
                  <div>
                    <strong style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 2 }}>Método Pago</strong>
                    {getPaymentMethodLabel(selectedSale.payment_method, selectedSale.is_credit)}
                  </div>
                  <div>
                    <strong style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 2 }}>Total</strong>
                    <span style={{ fontWeight: 600, fontSize: 16 }}>{formatMoney(selectedSale.total)}</span>
                  </div>
                  <div>
                    <strong style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 2 }}>Responsable</strong>
                    {selectedSale.seller_name || 'SIN USUARIO'}
                  </div>
                  <div>
                    <strong style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 2 }}>Utilidad</strong>
                    <span style={{ fontWeight: 600, fontSize: 16, color: '#22c55e' }}>{formatMoney(selectedSale.profit)}</span>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <strong style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>Estado</strong>
                    {selectedSale.status === 'CANCELLED' ? (
                        <div>
                            <span style={{ color: '#e74c3c', fontWeight: 600 }}>CANCELADO</span>
                            {selectedSale.cancellation_reason && (
                                <div style={{ marginTop: 8, padding: 8, background: 'rgba(231, 76, 60, 0.1)', borderRadius: 6, border: '1px solid rgba(231, 76, 60, 0.2)' }}>
                                    <strong style={{ fontSize: 12, color: '#c0392b', display: 'block' }}>Motivo:</strong>
                                    <span style={{ fontSize: 13, color: '#c0392b' }}>{selectedSale.cancellation_reason}</span>
                                </div>
                            )}
                        </div>
                    ) : isCreditSale(selectedSale) && !selectedSale.credit_fully_paid ? (
                        <span style={{ color: '#e74c3c', fontWeight: 600 }}>PENDIENTE DE PAGO</span>
                    ) : isCreditSale(selectedSale) ? (
                        <div>
                          <span style={{ color: '#2ecc71', fontWeight: 600 }}>CRÉDITO LIQUIDADO</span>
                          {selectedSale.credit_fully_paid_at && (
                            <div style={{ marginTop: 6, fontSize: 13, color: 'var(--muted)' }}>
                              Fecha de liquidación: {formatDateTime(selectedSale.credit_fully_paid_at)}
                            </div>
                          )}
                        </div>
                    ) : (
                        <span style={{ color: '#2ecc71', fontWeight: 600 }}>PAGADO</span>
                    )}
                  </div>
                </div>

                <div className="table-scroll" style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 24 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ background: 'var(--bg)' }}>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 13 }}>Producto</th>
                        <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 13 }}>Cant.</th>
                        <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 13 }}>Precio</th>
                        <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 13 }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedSale.items.map(item => (
                        <tr key={item.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '10px 16px' }}>{item.product_name}</td>
                          <td style={{ padding: '10px 16px', textAlign: 'right' }}>{item.quantity}</td>
                          <td style={{ padding: '10px 16px', textAlign: 'right' }}>{Number(item.unit_price).toFixed(2)}</td>
                          <td style={{ padding: '10px 16px', textAlign: 'right' }}>{Number(item.total).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
                   <button 
                     onClick={() => setIsModalOpen(false)}
                     style={{ 
                       padding: '8px 16px', 
                       background: 'transparent', 
                       color: 'inherit', 
                       border: '1px solid var(--border)', 
                       borderRadius: 6, 
                       cursor: 'pointer' 
                     }}
                   >
                     Cerrar
                   </button>
                   <button 
                     onClick={() => generateTicket(selectedSale)}
                     className="primary-btn"
                     style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                   >
                     <span>Imprimir</span> Reimprimir Ticket
                   </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {isCancelModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}>
          <div className="responsive-modal" style={{ background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, width: '90%', maxWidth: 500, boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}>
            <h3 style={{ marginTop: 0 }}>Cancelar Venta #{saleToCancel?.id}</h3>
            <p style={{ color: 'var(--muted)' }}>¿Está seguro de que desea cancelar esta venta? Esta acción restaurará el stock y no se puede deshacer.</p>
            
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', marginBottom: 8 }}>Motivo de cancelación:</label>
              <textarea
                value={cancelReason}
                onChange={e => setCancelReason(e.target.value)}
                style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', minHeight: 80 }}
                placeholder="Especifique el motivo..."
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
              <button 
                onClick={() => setIsCancelModalOpen(false)}
                className="secondary-btn"
                disabled={cancellingSale}
              >
                Cerrar
              </button>
              <button 
                onClick={confirmCancel}
                className="danger-btn"
                disabled={cancellingSale || !cancelReason.trim()}
              >
                {cancellingSale ? 'Cancelando venta...' : 'Confirmar Cancelación'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
