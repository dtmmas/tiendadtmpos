import { useEffect, useState } from 'react'
import { api } from '../api'
import { useConfigStore } from '../store/config'
import { formatMoney, formatNumber } from '../utils/currency'
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

export default function InventoryReport() {
  const [items, setItems] = useState<StockItem[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const config = useConfigStore(s => s.config)
  const currency = config?.currency || '$'

  // Totals
  const totalItems = items.reduce((acc, item) => acc + Number(item.quantity), 0)
  const totalCost = items.reduce((acc, item) => acc + (Number(item.quantity) * Number(item.cost || 0)), 0)
  const totalPrice = items.reduce((acc, item) => acc + (Number(item.quantity) * Number(item.price || 0)), 0)

  useEffect(() => {
    api.get('/warehouses').then(res => setWarehouses(res.data)).catch(console.error)
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
    <div className="page-container" style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20, alignItems: 'center' }}>
        <h2>Reporte de Inventario Actual</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label>Almacén:</label>
          <select 
            value={selectedWarehouse} 
            onChange={e => setSelectedWarehouse(e.target.value)}
            style={{ padding: 8, borderRadius: 4, border: '1px solid var(--border)' }}
          >
            <option value="">Todos los Almacenes</option>
            {warehouses.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
          <button onClick={loadStock} className="primary-btn">Actualizar</button>
          <button onClick={exportToPDF} className="secondary-btn" style={{ background: '#d32f2f', color: 'white', border: 'none' }}>PDF</button>
          <button onClick={exportToExcel} className="secondary-btn" style={{ background: '#2e7d32', color: 'white', border: 'none' }}>Excel</button>
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20, marginBottom: 20 }}>
        <div className="kpi-card" style={{ background: 'var(--surface)', padding: 15, borderRadius: 8, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 14, color: 'gray' }}>Total Unidades</div>
          <div style={{ fontSize: 24, fontWeight: 'bold' }}>{totalItems}</div>
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
                  {item.warehouse_name}
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
    </div>
  )
}
