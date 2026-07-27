import { useEffect, useState } from 'react'
import { api } from '../api'
import { useConfigStore } from '../store/config'
import { formatMoney, formatNumber } from '../utils/currency'
import { getWarehouseHighlightStyle } from '../utils/warehouseHighlight'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { addLogoToPdf } from '../utils/printBranding'

interface StockItem {
  id: number
  quantity: number
  product_name: string
  product_code: string
  warehouse_name: string
  cost: number
  price: number
  details?: string
}

interface Warehouse {
  id: number
  name: string
}

function getDetailLines(details?: string) {
  return (details || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

export default function InventoryReport() {
  const [items, setItems] = useState<StockItem[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [isMobileViewport, setIsMobileViewport] = useState(false)
  const config = useConfigStore(s => s.config)
  const currency = config?.currency || '$'

  // Totals
  const totalItems = items.reduce((acc, item) => acc + Number(item.quantity), 0)
  const totalCost = items.reduce((acc, item) => acc + (Number(item.quantity) * Number(item.cost || 0)), 0)
  const totalPrice = items.reduce((acc, item) => acc + (Number(item.quantity) * Number(item.price || 0)), 0)

  useEffect(() => {
    api.get('/warehouses').then(res => setWarehouses(res.data)).catch(console.error)
  }, [])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)')
    const syncViewport = () => setIsMobileViewport(mediaQuery.matches)
    syncViewport()
    mediaQuery.addEventListener('change', syncViewport)
    return () => mediaQuery.removeEventListener('change', syncViewport)
  }, [])

  const loadStock = async () => {
    setLoading(true)
    try {
      let url = '/inventory/stock'
      if (selectedWarehouse) url += `?warehouseId=${selectedWarehouse}`
      const { data } = await api.get(url)
      setItems(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const exportToPDF = async () => {
    const doc = new jsPDF()
    const now = new Date().toLocaleString()
    const warehouseName = selectedWarehouse 
      ? warehouses.find(w => w.id === Number(selectedWarehouse))?.name || 'Almacén'
      : 'Todos los Almacenes'

    const logoHeight = await addLogoToPdf(doc, config?.logoUrl, { x: 14, y: 10, maxWidth: 28, maxHeight: 18 })
    const titleY = logoHeight > 0 ? 24 : 22

    doc.setFontSize(18)
    doc.text('Reporte de Inventario Actual', 14, titleY)
    
    doc.setFontSize(11)
    doc.text(`Fecha: ${now}`, 14, titleY + 8)
    doc.text(`Almacén: ${warehouseName}`, 14, titleY + 14)
    
    // Totals
    doc.text(`Total Unidades: ${formatNumber(totalItems, 0)}`, 14, titleY + 24)
    doc.text(`Total Costo: ${formatMoney(totalCost, currency)}`, 80, titleY + 24)
    doc.text(`Total Venta: ${formatMoney(totalPrice, currency)}`, 150, titleY + 24)

    const tableColumn = ["Código", "Producto", "Almacén", "Stock", "Detalle (Lote/IMEI)", "Costo U.", "Total Costo"]
    const tableRows = items.map(item => [
      item.product_code || '-',
      item.product_name,
      item.warehouse_name,
      item.quantity,
      item.details || '-',
      formatMoney(Number(item.cost || 0), currency),
      formatMoney(Number(item.quantity) * Number(item.cost || 0), currency)
    ])

    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      startY: titleY + 30,
      theme: 'grid',
      styles: { fontSize: 8 },
      headStyles: { fillColor: [66, 66, 66] },
      columnStyles: {
        4: { cellWidth: 40 } // Detalles más ancho
      }
    })

    doc.save(`Inventario_${new Date().toISOString().slice(0,10)}.pdf`)
  }

  const exportToExcel = () => {
    const now = new Date().toLocaleString()
    const warehouseName = selectedWarehouse 
      ? warehouses.find(w => w.id === Number(selectedWarehouse))?.name || 'Almacén'
      : 'Todos los Almacenes'

    const data = items.map(item => ({
      'Código': item.product_code || '-',
      'Producto': item.product_name,
      'Almacén': item.warehouse_name,
      'Stock': Number(item.quantity),
      'Detalle (Lote/IMEI/Serie)': item.details || '-',
      'Costo Unitario': Number(item.cost || 0),
      'Precio Unitario': Number(item.price || 0),
      'Total Costo': Number(item.quantity) * Number(item.cost || 0),
      'Total Venta': Number(item.quantity) * Number(item.price || 0)
    }))

    // Add summary row at the top? Or better just data.
    // Let's create a workbook
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(data)

    XLSX.utils.book_append_sheet(wb, ws, "Inventario")
    XLSX.writeFile(wb, `Inventario_${new Date().toISOString().slice(0,10)}.xlsx`)
  }

  useEffect(() => { loadStock() }, [selectedWarehouse])

  return (
    <div className="page-container" style={{ padding: isMobileViewport ? 14 : 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20, alignItems: isMobileViewport ? 'stretch' : 'center', flexDirection: isMobileViewport ? 'column' : 'row', gap: 12 }}>
        <h2>Reporte de Inventario Actual</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: isMobileViewport ? 'stretch' : 'center', flexWrap: 'wrap', flexDirection: isMobileViewport ? 'column' : 'row', width: isMobileViewport ? '100%' : 'auto' }}>
          <label>Almacén:</label>
          <select 
            value={selectedWarehouse} 
            onChange={e => setSelectedWarehouse(e.target.value)}
            style={{ padding: 8, borderRadius: 4, border: '1px solid var(--border)', width: isMobileViewport ? '100%' : 'auto' }}
          >
            <option value="">Todos los Almacenes</option>
            {warehouses.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          <button onClick={loadStock} className="primary-btn" style={{ width: isMobileViewport ? '100%' : 'auto' }}>Actualizar</button>
          <button onClick={exportToPDF} className="secondary-btn" style={{ background: '#d32f2f', color: 'white', border: 'none', width: isMobileViewport ? '100%' : 'auto' }}>PDF</button>
          <button onClick={exportToExcel} className="secondary-btn" style={{ background: '#2e7d32', color: 'white', border: 'none', width: isMobileViewport ? '100%' : 'auto' }}>Excel</button>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobileViewport ? '1fr' : 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20, marginBottom: 20 }}>
        <div className="kpi-card" style={{ background: 'var(--surface)', padding: 15, borderRadius: 8, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 14, color: 'gray' }}>Total Unidades</div>
          <div style={{ fontSize: 24, fontWeight: 'bold' }}>{formatNumber(totalItems, 0)}</div>
        </div>
        <div className="kpi-card" style={{ background: 'var(--surface)', padding: 15, borderRadius: 8, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 14, color: 'gray' }}>Valor Costo Total</div>
          <div style={{ fontSize: 24, fontWeight: 'bold', color: '#1565c0' }}>{formatMoney(totalCost, currency)}</div>
        </div>
        <div className="kpi-card" style={{ background: 'var(--surface)', padding: 15, borderRadius: 8, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 14, color: 'gray' }}>Valor Venta Total</div>
          <div style={{ fontSize: 24, fontWeight: 'bold', color: '#2e7d32' }}>{formatMoney(totalPrice, currency)}</div>
        </div>
      </div>

      {/* Table Layout */}
      {isMobileViewport ? (
        <div style={{ display: 'grid', gap: 12 }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }}>
              Cargando inventario...
            </div>
          ) : items.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' }}>
              No hay stock registrado
            </div>
          ) : items.map((item, idx) => (
            <div key={idx} style={{ border: '1px solid var(--border)', borderRadius: 16, background: 'linear-gradient(180deg, var(--surface), var(--modal))', padding: 14, display: 'grid', gap: 12, boxShadow: '0 10px 24px rgba(15, 23, 42, 0.06)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: '1rem', lineHeight: 1.3 }}>{item.product_name}</div>
                  <div style={{ marginTop: 6 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', fontFamily: 'monospace', background: '#e2e8f0', padding: '4px 8px', borderRadius: 999, fontSize: '11px', color: '#334155', border: '1px solid #cbd5e1' }}>
                      {item.product_code || '-'}
                    </span>
                  </div>
                </div>
                <span className="warehouse-highlight" style={{ ...getWarehouseHighlightStyle(item.warehouse_name), flexShrink: 0 }}>
                  {item.warehouse_name}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                <div style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.14)', borderRadius: 12, padding: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Stock</div>
                  <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#0f172a' }}>{formatNumber(item.quantity, 0)}</div>
                </div>
                <div style={{ background: 'rgba(37, 99, 235, 0.06)', border: '1px solid rgba(37, 99, 235, 0.12)', borderRadius: 12, padding: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Costo U.</div>
                  <div style={{ fontWeight: 700 }}>{formatMoney(Number(item.cost || 0), currency)}</div>
                </div>
                <div style={{ gridColumn: '1 / -1', background: 'rgba(15, 23, 42, 0.04)', border: '1px solid var(--border)', borderRadius: 12, padding: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Total Costo</div>
                  <div style={{ fontWeight: 800, fontSize: '1rem', color: '#0f172a' }}>{formatMoney(Number(item.quantity) * Number(item.cost || 0), currency)}</div>
                </div>
              </div>

              <div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, fontWeight: 700 }}>Detalles (Lote/IMEI/Serie)</div>
                {getDetailLines(item.details).length > 0 ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 10 }}>
                    {getDetailLines(item.details).map((line, i) => (
                      <span key={i} style={{ display: 'inline-flex', alignItems: 'center', maxWidth: '100%', padding: '6px 10px', borderRadius: 999, background: 'rgba(37, 99, 235, 0.08)', border: '1px solid rgba(37, 99, 235, 0.16)', color: '#1d4ed8', fontSize: '11px', fontWeight: 700, lineHeight: 1.35, wordBreak: 'break-word' }}>
                        {line}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: '#94a3b8', background: 'var(--bg)', border: '1px dashed var(--border)', borderRadius: 12, padding: 10, textAlign: 'center' }}>Sin detalles</div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr style={{ background: '#f8fafc', borderBottom: '2px solid var(--border)' }}>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#475569' }}>Código</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#475569' }}>Producto</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#475569', width: '30%' }}>Detalles (Lote/IMEI/Serie)</th>
              <th style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#475569' }}>Almacén</th>
              <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#475569' }}>Stock</th>
              <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#475569' }}>Costo U.</th>
              <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: '#475569' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Cargando inventario...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>No hay stock registrado</td></tr>
            ) : items.map((item, idx) => (
              <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '10px 16px', verticalAlign: 'top' }}>
                  <span style={{ fontFamily: 'monospace', background: '#f1f5f9', padding: '2px 6px', borderRadius: 4, fontSize: '12px', color: '#334155' }}>
                    {item.product_code || '-'}
                  </span>
                </td>
                <td style={{ padding: '10px 16px', verticalAlign: 'top', fontWeight: 500 }}>
                  {item.product_name}
                </td>
                <td style={{ padding: '10px 16px', verticalAlign: 'top' }}>
                    {item.details ? (
                        <div style={{ fontSize: '12px', color: '#64748b', lineHeight: 1.5 }}>
                            {item.details.split('\n').map((line, i) => (
                                <div key={i} style={{ marginBottom: 2 }}>{line}</div>
                            ))}
                        </div>
                    ) : (
                        <span style={{ color: '#cbd5e1' }}>-</span>
                    )}
                </td>
                <td style={{ padding: '10px 16px', verticalAlign: 'top' }}>
                  <span className="warehouse-highlight" style={getWarehouseHighlightStyle(item.warehouse_name)}>{item.warehouse_name}</span>
                </td>
                <td style={{ padding: '10px 16px', verticalAlign: 'top', textAlign: 'right', fontWeight: 600 }}>
                  {item.quantity}
                </td>
                <td style={{ padding: '10px 16px', verticalAlign: 'top', textAlign: 'right', color: '#64748b' }}>
                  {formatMoney(Number(item.cost || 0), currency)}
                </td>
                <td style={{ padding: '10px 16px', verticalAlign: 'top', textAlign: 'right', fontWeight: 600, color: '#0f172a' }}>
                  {formatMoney(Number(item.quantity) * Number(item.cost || 0), currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  )
}
