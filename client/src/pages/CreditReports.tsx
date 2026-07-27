import { useState, useEffect, useMemo } from 'react'
import { getCredits } from '../api'
import { useConfigStore } from '../store/config'
import { formatDate } from '../utils/date'
import { formatNumber } from '../utils/currency'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { addLogoToPdf } from '../utils/printBranding'

interface Credit {
  id: number
  sale_id: number
  due_date: string
  total_amount: number | string
  paid: number
  doc_no: string
  sale_date: string
  customer_name: string
  paid_amount: number | string
}

export default function CreditReports() {
  const [credits, setCredits] = useState<Credit[]>([])
  const [loading, setLoading] = useState(false)
  const [isMobileViewport, setIsMobileViewport] = useState(false)
  
  // Filters
  const [status, setStatus] = useState('pending') // Default to pending as per request priority
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [search, setSearch] = useState('')

  const config = useConfigStore(s => s.config)

  useEffect(() => {
    loadCredits()
  }, [status, startDate, endDate, search])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)')
    const syncViewport = () => setIsMobileViewport(mediaQuery.matches)
    syncViewport()
    mediaQuery.addEventListener('change', syncViewport)
    return () => mediaQuery.removeEventListener('change', syncViewport)
  }, [])

  async function loadCredits() {
    setLoading(true)
    try {
      const data = await getCredits({ 
        search, 
        status: status === 'all' ? undefined : status,
        startDate: startDate || undefined,
        endDate: endDate || undefined
      })
      setCredits(data)
    } catch (err) {
      console.error(err)
      alert('Error cargando reporte de créditos')
    } finally {
      setLoading(false)
    }
  }

  const clearFilters = () => {
    setStatus('')
    setStartDate('')
    setEndDate('')
    setSearch('')
  }

  const totalPending = useMemo(() => {
    return credits.reduce((acc, curr) => {
      if (curr.paid) return acc
      const pending = Number(curr.total_amount || 0) - Number(curr.paid_amount || 0)
      return acc + pending
    }, 0)
  }, [credits])

  const totalPaid = useMemo(() => {
    return credits.reduce((acc, curr) => {
        return acc + Number(curr.paid_amount || 0)
    }, 0)
  }, [credits])

  const formatCurrency = (amount: number | string) => {
    try {
      return new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(Number(amount))
    } catch (e) {
      return `Q${formatNumber(Number(amount))}`
    }
  }

  const exportPDF = async () => {
    try {
      const doc = new jsPDF()
      const logoHeight = await addLogoToPdf(doc, config?.logoUrl, { x: 14, y: 10, maxWidth: 28, maxHeight: 18 })
      const titleY = logoHeight > 0 ? 24 : 22

      doc.setFontSize(18)
      doc.text('Reporte de Créditos', 14, titleY)
      
      doc.setFontSize(11)
      const statusText = status === 'PENDIENTE' ? 'Pendientes' : status === 'PAGADO' ? 'Pagados' : 'Todos'
      doc.text(`Estado: ${statusText}`, 14, titleY + 8)
      if (startDate || endDate) {
        doc.text(`Fecha: ${startDate || 'Inicio'} - ${endDate || 'Fin'}`, 14, titleY + 14)
      }

      const tableColumn = ["Fecha Venta", "Cliente", "Folio", "Estado", "Total", "Pagado", "Pendiente"]
    const tableRows: any[] = []

    if (Array.isArray(credits)) {
      credits.forEach(credit => {
        if (!credit) return
        const pending = Number(credit.total_amount || 0) - Number(credit.paid_amount || 0)
        const creditStatus = credit.paid ? 'Pagado' : 'Pendiente'
        
        const creditData = [
          formatDate(credit.sale_date),
          credit.customer_name || 'General',
          credit.doc_no || credit.sale_id || '-',
          creditStatus,
          formatCurrency(credit.total_amount || 0),
          formatCurrency(credit.paid_amount || 0),
          formatCurrency(pending)
        ]
        tableRows.push(creditData)
      })
    }

      // @ts-ignore
      autoTable(doc, {
        head: [tableColumn],
        body: tableRows,
        startY: titleY + 22,
      })

      const finalY = (doc as any).lastAutoTable.finalY + 10
      
      doc.setFontSize(12)
      doc.text(`Total Deuda Pendiente: ${formatCurrency(totalPending)}`, 14, finalY)
      doc.text(`Total Abonado: ${formatCurrency(totalPaid)}`, 14, finalY + 6)

      doc.save(`reporte_creditos_${new Date().toISOString().slice(0, 10)}.pdf`)
    } catch (error) {
      console.error('Error exporting PDF:', error)
      alert('Error al generar el PDF. Por favor revise la consola.')
    }
  }

  return (
    <div style={{ padding: isMobileViewport ? 12 : 20, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobileViewport ? 'stretch' : 'center', flexDirection: isMobileViewport ? 'column' : 'row', gap: 12, marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Reporte de Créditos</h2>
        <div style={{ display: 'flex', gap: 8, flexDirection: isMobileViewport ? 'column' : 'row', width: isMobileViewport ? '100%' : 'auto' }}>
            <button 
                onClick={clearFilters}
                className="icon-btn"
                style={{ width: isMobileViewport ? '100%' : 'auto', padding: '0 12px' }}
            >
                Limpiar Filtros
            </button>
            <button 
                className="primary-btn" 
                onClick={exportPDF}
                style={{ width: isMobileViewport ? '100%' : 'auto' }}
            >
                Exportar PDF
            </button>
        </div>
      </div>

      <div style={{ 
          background: 'var(--modal)', 
          padding: isMobileViewport ? 12 : 16,
          borderRadius: 12, 
          border: '1px solid var(--border)',
          marginBottom: 20,
          boxSizing: 'border-box'
        }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', flexDirection: isMobileViewport ? 'column' : 'row' }}>
          <div style={{ minWidth: 150, width: isMobileViewport ? '100%' : undefined }}>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 13 }}>Estado</label>
            <select 
              value={status} 
              onChange={(e) => setStatus(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box' }}
            >
              <option value="">Todos (Pendientes y Pagados)</option>
              <option value="PENDIENTE">Solo Pendientes</option>
              <option value="PAGADO">Solo Pagados</option>
            </select>
          </div>

          <div style={{ width: isMobileViewport ? '100%' : undefined }}>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 13 }}>Desde</label>
            <input 
              type="date" 
              value={startDate} 
              onChange={(e) => setStartDate(e.target.value)}
              style={{ width: isMobileViewport ? '100%' : undefined, boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ width: isMobileViewport ? '100%' : undefined }}>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 13 }}>Hasta</label>
            <input 
              type="date" 
              value={endDate} 
              onChange={(e) => setEndDate(e.target.value)}
              style={{ width: isMobileViewport ? '100%' : undefined, boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ flex: 1, width: isMobileViewport ? '100%' : undefined }}>
            <label style={{ display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 13 }}>Buscar Cliente / Folio</label>
            <input 
              type="text" 
              value={search} 
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nombre cliente..." 
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </div>
        </div>
      </div>

      <div style={{ 
          display: 'grid', 
          gridTemplateColumns: isMobileViewport ? '1fr' : 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 20, 
          marginBottom: 20 
        }}>
        <div style={{ 
            background: 'var(--modal)', 
            padding: isMobileViewport ? 14 : 16,
            borderRadius: 12, 
            border: '1px solid var(--border)',
            boxSizing: 'border-box'
        }}>
          <h3 style={{ margin: '0 0 8px 0', fontSize: 14, color: 'var(--muted)' }}>Total Pendiente por Abonar</h3>
          <div style={{ color: '#ef4444', fontSize: 24, fontWeight: 'bold' }}>{formatCurrency(totalPending)}</div>
        </div>
        <div style={{ 
            background: 'var(--modal)', 
            padding: isMobileViewport ? 14 : 16,
            borderRadius: 12, 
            border: '1px solid var(--border)',
            boxSizing: 'border-box'
        }}>
          <h3 style={{ margin: '0 0 8px 0', fontSize: 14, color: 'var(--muted)' }}>Total Pagado / Abonado</h3>
          <div style={{ color: '#22c55e', fontSize: 24, fontWeight: 'bold' }}>{formatCurrency(totalPaid)}</div>
        </div>
      </div>

      {isMobileViewport ? (
        <div style={{ display: 'grid', gap: 12, width: '100%' }}>
          {loading ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', background: 'var(--modal)', borderRadius: 12, border: '1px solid var(--border)' }}>Cargando...</div>
          ) : credits.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--muted)', background: 'var(--modal)', borderRadius: 12, border: '1px solid var(--border)' }}>
              No se encontraron registros
            </div>
          ) : (
            credits.map(credit => {
              const pending = Number(credit.total_amount || 0) - Number(credit.paid_amount || 0)
              return (
                <div key={credit.id} style={{ background: 'var(--modal)', borderRadius: 12, border: '1px solid var(--border)', padding: 12, display: 'grid', gap: 10, width: '100%', boxSizing: 'border-box', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 800, wordBreak: 'break-word' }}>{credit.customer_name || 'General'}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Folio: {credit.doc_no || credit.sale_id || '-'}</div>
                    </div>
                    <span style={{
                      background: credit.paid ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                      color: credit.paid ? '#22c55e' : '#ef4444',
                      padding: '4px 10px',
                      borderRadius: 10,
                      fontSize: 11,
                      fontWeight: 700,
                      border: `1px solid ${credit.paid ? '#22c55e' : '#ef4444'}`
                    }}>
                      {credit.paid ? 'PAGADO' : 'PENDIENTE'}
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, fontSize: '0.9rem' }}>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Fecha venta</div>
                      <div>{formatDate(credit.sale_date)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Vencimiento</div>
                      <div>{formatDate(credit.due_date)}</div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, background: 'var(--bg)' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Total</div>
                      <div style={{ fontWeight: 700 }}>{formatCurrency(credit.total_amount || 0)}</div>
                    </div>
                    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, background: 'var(--bg)' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Pagado</div>
                      <div style={{ fontWeight: 700, color: '#22c55e' }}>{formatCurrency(credit.paid_amount || 0)}</div>
                    </div>
                    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, background: 'var(--bg)' }}>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>Pendiente</div>
                      <div style={{ fontWeight: 700, color: pending > 0 ? '#ef4444' : 'inherit' }}>{formatCurrency(pending)}</div>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      ) : (
      <div style={{
          background: 'var(--modal)',
          borderRadius: 12,
          border: '1px solid var(--border)',
          overflow: 'hidden'
        }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>Cargando...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--modal)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: 12, textAlign: 'left' }}>Fecha Venta</th>
                <th style={{ padding: 12, textAlign: 'left' }}>Vencimiento</th>
                <th style={{ padding: 12, textAlign: 'left' }}>Cliente</th>
                <th style={{ padding: 12, textAlign: 'left' }}>Folio</th>
                <th style={{ padding: 12, textAlign: 'center' }}>Estado</th>
                <th style={{ padding: 12, textAlign: 'right' }}>Total</th>
                <th style={{ padding: 12, textAlign: 'right' }}>Pagado</th>
                <th style={{ padding: 12, textAlign: 'right' }}>Pendiente</th>
              </tr>
            </thead>
            <tbody>
              {credits.map(credit => {
                const pending = Number(credit.total_amount || 0) - Number(credit.paid_amount || 0)
                return (
                  <tr key={credit.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: 12 }}>{formatDate(credit.sale_date)}</td>
                    <td style={{ padding: 12 }}>{formatDate(credit.due_date)}</td>
                    <td style={{ padding: 12 }}>{credit.customer_name || 'General'}</td>
                    <td style={{ padding: 12 }}>{credit.doc_no || credit.sale_id || '-'}</td>
                    <td style={{ padding: 12, textAlign: 'center' }}>
                      <span style={{ 
                          background: credit.paid ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)', 
                          color: credit.paid ? '#22c55e' : '#ef4444', 
                          padding: '2px 8px', 
                          borderRadius: 10, 
                          fontSize: 11,
                          fontWeight: 600,
                          border: `1px solid ${credit.paid ? '#22c55e' : '#ef4444'}`
                      }}>
                        {credit.paid ? 'PAGADO' : 'PENDIENTE'}
                      </span>
                    </td>
                    <td style={{ padding: 12, textAlign: 'right' }}>{formatCurrency(credit.total_amount || 0)}</td>
                    <td style={{ padding: 12, textAlign: 'right' }}>{formatCurrency(credit.paid_amount || 0)}</td>
                    <td style={{ padding: 12, textAlign: 'right', fontWeight: 'bold', color: pending > 0 ? '#ef4444' : 'inherit' }}>
                      {formatCurrency(pending)}
                    </td>
                  </tr>
                )
              })}
              {credits.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
                    No se encontraron registros
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      )}
    </div>
  )
}
