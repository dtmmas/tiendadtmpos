import { useEffect, useMemo, useState } from 'react'
import { getCashHistoryShiftDetail, getCashHistoryShifts, getCashHistorySummary } from '../api'
import { useConfigStore } from '../store/config'
import { formatMoney } from '../utils/currency'
import { formatDateTime } from '../utils/date'

type Period = 'day' | 'month' | 'year'

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10)
}

export default function CashHistory() {
  const currency = useConfigStore(s => s.config?.currency || 'USD')
  const [period, setPeriod] = useState<Period>('day')
  const [start, setStart] = useState(() => {
    const now = new Date()
    const first = new Date(now.getFullYear(), now.getMonth(), 1)
    return isoDate(first)
  })
  const [end, setEnd] = useState(() => isoDate(new Date()))
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<Array<any>>([])
  const [shifts, setShifts] = useState<Array<any>>([])
  const [selectedShift, setSelectedShift] = useState<any>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const params = useMemo(() => ({ start, end }), [start, end])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [s, list] = await Promise.all([
          getCashHistorySummary({ period, ...params }),
          getCashHistoryShifts({ ...params, limit: 200 }),
        ])
        setSummary(Array.isArray(s?.summary) ? s.summary : [])
        setShifts(Array.isArray(list?.items) ? list.items : [])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [period, params])

  const openShiftDetail = async (shiftId: number) => {
    try {
      setDetailLoading(true)
      const detail = await getCashHistoryShiftDetail(shiftId)
      setSelectedShift(detail)
    } catch (err: any) {
      alert(err?.response?.data?.error || 'No se pudo cargar el detalle del cierre')
    } finally {
      setDetailLoading(false)
    }
  }

  const printShiftDetail = (shift: any) => {
    if (!shift) return
    const methods = Object.entries(shift.salesByMethod || {}) as Array<[string, unknown]>
    const creditMethods = Object.entries(shift.creditPaymentsByMethod || {}) as Array<[string, unknown]>
    const movementRows = (shift.movements || []).map((movement: any) => `
      <tr>
        <td>${escapeHtml(formatDateTime(movement.createdAt))}</td>
        <td>${escapeHtml(movement.type === 'IN' ? 'ENTRADA' : 'SALIDA')}</td>
        <td>${escapeHtml(movement.description || '')}</td>
        <td>${escapeHtml(translateRefType(movement.refType))}</td>
        <td style="text-align:right;">${formatMoney(Number(movement.amount || 0), currency)}</td>
      </tr>
    `).join('')

    const printWindow = window.open('about:blank', '_blank', 'width=900,height=700')
    if (!printWindow) {
      alert('No se pudo abrir la ventana de impresion. Verifica si el navegador bloqueo el popup.')
      return
    }

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Detalle de Cierre de Caja</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
            h1, h2, h3 { margin: 0 0 12px; }
            .meta, .grid { margin-bottom: 20px; }
            .meta div { margin-bottom: 6px; }
            .grid { display: grid; grid-template-columns: repeat(2, minmax(220px, 1fr)); gap: 12px; }
            .card { border: 1px solid #d1d5db; border-radius: 8px; padding: 12px; }
            .label { font-size: 12px; color: #6b7280; margin-bottom: 4px; }
            .value { font-size: 22px; font-weight: 700; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; }
            th, td { border: 1px solid #d1d5db; padding: 8px; font-size: 12px; }
            th { background: #f3f4f6; text-align: left; }
            .section { margin-top: 20px; }
          </style>
        </head>
        <body>
          <h1>Detalle de Cierre de Caja</h1>
          <div class="meta">
            <div><strong>Cierre:</strong> ${escapeHtml(formatDateTime(shift.closedAt))}</div>
            <div><strong>Apertura:</strong> ${escapeHtml(formatDateTime(shift.openedAt))}</div>
            <div><strong>Abrió:</strong> ${escapeHtml(shift.openedByName || '-')}</div>
            <div><strong>Cerró:</strong> ${escapeHtml(shift.closedByName || '-')}</div>
            <div><strong>Impreso:</strong> ${escapeHtml(formatDateTime(new Date()))}</div>
          </div>

          <div class="grid">
            <div class="card"><div class="label">Saldo Inicial</div><div class="value">${formatMoney(Number(shift.openingBalance || 0), currency)}</div></div>
            <div class="card"><div class="label">Ventas (Efectivo)</div><div class="value">${formatMoney(Number(shift.salesCash || 0), currency)}</div></div>
            <div class="card"><div class="label">Abonos Crédito (Efectivo)</div><div class="value">${formatMoney(Number(shift.creditPaymentsCash || 0), currency)}</div></div>
            <div class="card"><div class="label">Abonos Crédito (Depósito)</div><div class="value">${formatMoney(Number(shift.creditPaymentsByMethod?.DEPOSIT || 0), currency)}</div></div>
            <div class="card"><div class="label">Abonos Crédito (Tarjeta)</div><div class="value">${formatMoney(Number(shift.creditPaymentsByMethod?.CARD || 0), currency)}</div></div>
            <div class="card"><div class="label">Entradas Extra</div><div class="value">${formatMoney(Number(shift.movementsIn || 0), currency)}</div></div>
            <div class="card"><div class="label">Salidas / Gastos</div><div class="value">${formatMoney(Number(shift.movementsOut || 0), currency)}</div></div>
            <div class="card"><div class="label">Total Esperado</div><div class="value">${formatMoney(Number(shift.expected || 0), currency)}</div></div>
            <div class="card"><div class="label">Monto Real</div><div class="value">${formatMoney(Number(shift.closingBalance || 0), currency)}</div></div>
            <div class="card"><div class="label">Diferencia</div><div class="value">${formatMoney(Number(shift.difference || 0), currency)}</div></div>
          </div>

          <div class="section">
            <h3>Ventas por Metodo</h3>
            <table>
              <thead>
                <tr>
                  <th>Metodo</th>
                  <th style="text-align:right;">Monto</th>
                </tr>
              </thead>
              <tbody>
                ${methods.map(([method, total]) => `
                  <tr>
                    <td>${escapeHtml(translateMethod(method))}</td>
                    <td style="text-align:right;">${formatMoney(Number(total || 0), currency)}</td>
                  </tr>
                `).join('')}
                <tr>
                  <td><strong>Total Ventas</strong></td>
                  <td style="text-align:right;"><strong>${formatMoney(Number(shift.totalSales || 0), currency)}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="section">
            <h3>Abonos a Crédito por Método</h3>
            <table>
              <thead>
                <tr>
                  <th>Metodo</th>
                  <th style="text-align:right;">Monto</th>
                </tr>
              </thead>
              <tbody>
                ${creditMethods.map(([method, total]) => `
                  <tr>
                    <td>${escapeHtml(translateMethod(method))}</td>
                    <td style="text-align:right;">${formatMoney(Number(total || 0), currency)}</td>
                  </tr>
                `).join('') || '<tr><td colspan="2" style="text-align:center;">Sin abonos de crédito</td></tr>'}
              </tbody>
            </table>
          </div>

          <div class="section">
            <h3>Movimientos</h3>
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Descripcion</th>
                  <th>Referencia</th>
                  <th style="text-align:right;">Monto</th>
                </tr>
              </thead>
              <tbody>
                ${movementRows || '<tr><td colspan="5" style="text-align:center;">Sin movimientos</td></tr>'}
              </tbody>
            </table>
          </div>
        </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  return (
    <div style={{ padding: 20, maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0 }}>Historial de Cierre de Caja</h2>
          <div style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
            Resumen por día, mes o año, y detalle de cierres
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', background: 'var(--modal)', padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)' }}>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '6px 8px', fontWeight: 600 }}
          >
            <option value="day">Diario</option>
            <option value="month">Mensual</option>
            <option value="year">Anual</option>
          </select>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '6px 8px' }}
          />
          <span style={{ color: 'var(--muted)' }}>a</span>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '6px 8px' }}
          />
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Cargando...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 20 }}>
          <div className="card">
            <h3>Resumen</h3>
            {summary.length === 0 ? (
              <div style={{ color: 'var(--muted)' }}>Sin cierres en el rango seleccionado.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left', fontSize: '0.85rem' }}>
                    <th style={{ padding: 8 }}>{period === 'day' ? 'Día' : period === 'month' ? 'Mes' : 'Año'}</th>
                    <th style={{ padding: 8, textAlign: 'right' }}>Cierres</th>
                    <th style={{ padding: 8, textAlign: 'right' }}>Esperado</th>
                    <th style={{ padding: 8, textAlign: 'right' }}>Real</th>
                    <th style={{ padding: 8, textAlign: 'right' }}>Dif.</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((r: any) => (
                    <tr key={r.period} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: 8, fontWeight: 600 }}>{r.period}</td>
                      <td style={{ padding: 8, textAlign: 'right' }}>{r.shifts}</td>
                      <td style={{ padding: 8, textAlign: 'right' }}>{formatMoney(Number(r.expected || 0), currency)}</td>
                      <td style={{ padding: 8, textAlign: 'right' }}>{formatMoney(Number(r.closing || 0), currency)}</td>
                      <td style={{ padding: 8, textAlign: 'right', fontWeight: 700, color: Number(r.difference || 0) === 0 ? '#22c55e' : Number(r.difference || 0) > 0 ? '#3b82f6' : '#ef4444' }}>
                        {formatMoney(Number(r.difference || 0), currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <h3>Detalle de Cierres</h3>
            {shifts.length === 0 ? (
              <div style={{ color: 'var(--muted)' }}>Sin cierres en el rango seleccionado.</div>
            ) : (
              <div style={{ maxHeight: 520, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left', fontSize: '0.85rem' }}>
                      <th style={{ padding: 8 }}>Cierre</th>
                      <th style={{ padding: 8 }}>Responsable</th>
                      <th style={{ padding: 8, textAlign: 'right' }}>Inicial</th>
                      <th style={{ padding: 8, textAlign: 'right' }}>Esperado</th>
                      <th style={{ padding: 8, textAlign: 'right' }}>Real</th>
                      <th style={{ padding: 8, textAlign: 'right' }}>Dif.</th>
                      <th style={{ padding: 8, textAlign: 'center' }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shifts.map((s: any) => (
                      <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: 8 }}>
                          <div style={{ fontWeight: 600 }}>{formatDateTime(s.closedAt)}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                            Apertura: {formatDateTime(s.openedAt)}
                          </div>
                        </td>
                        <td style={{ padding: 8 }}>
                          <div style={{ fontWeight: 600 }}>{s.closedByName || '-'}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                            Abrió: {s.openedByName || '-'}
                          </div>
                        </td>
                        <td style={{ padding: 8, textAlign: 'right' }}>{formatMoney(Number(s.openingBalance || 0), currency)}</td>
                        <td style={{ padding: 8, textAlign: 'right' }}>{formatMoney(Number(s.expected || 0), currency)}</td>
                        <td style={{ padding: 8, textAlign: 'right' }}>{formatMoney(Number(s.closingBalance || 0), currency)}</td>
                        <td style={{ padding: 8, textAlign: 'right', fontWeight: 700, color: Number(s.difference || 0) === 0 ? '#22c55e' : Number(s.difference || 0) > 0 ? '#3b82f6' : '#ef4444' }}>
                          {formatMoney(Number(s.difference || 0), currency)}
                        </td>
                        <td style={{ padding: 8, textAlign: 'center' }}>
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                            onClick={() => openShiftDetail(s.id)}
                            disabled={detailLoading}
                          >
                            {detailLoading && selectedShift?.id !== s.id ? 'Cargando...' : 'Ver detalle'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {selectedShift && (
        <Modal
          title={`Detalle de Cierre #${selectedShift.id}`}
          onClose={() => setSelectedShift(null)}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <div style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
              Cerrado: {formatDateTime(selectedShift.closedAt)}
            </div>
            <button type="button" className="btn-secondary" onClick={() => printShiftDetail(selectedShift)}>
              Imprimir Cierre
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 16 }}>
            <DetailCard label="Abrió" value={selectedShift.openedByName || '-'} />
            <DetailCard label="Cerró" value={selectedShift.closedByName || '-'} />
            <DetailCard label="Saldo Inicial" value={formatMoney(Number(selectedShift.openingBalance || 0), currency)} />
            <DetailCard label="Ventas (Efectivo)" value={formatMoney(Number(selectedShift.salesCash || 0), currency)} />
            <DetailCard label="Abonos Crédito (Efectivo)" value={formatMoney(Number(selectedShift.creditPaymentsCash || 0), currency)} />
            <DetailCard label="Abonos Crédito (Depósito)" value={formatMoney(Number(selectedShift.creditPaymentsByMethod?.DEPOSIT || 0), currency)} />
            <DetailCard label="Abonos Crédito (Tarjeta)" value={formatMoney(Number(selectedShift.creditPaymentsByMethod?.CARD || 0), currency)} />
            <DetailCard label="Entradas Extra" value={formatMoney(Number(selectedShift.movementsIn || 0), currency)} />
            <DetailCard label="Salidas / Gastos" value={formatMoney(Number(selectedShift.movementsOut || 0), currency)} />
            <DetailCard label="Esperado" value={formatMoney(Number(selectedShift.expected || 0), currency)} />
            <DetailCard label="Real" value={formatMoney(Number(selectedShift.closingBalance || 0), currency)} />
            <DetailCard label="Diferencia" value={formatMoney(Number(selectedShift.difference || 0), currency)} />
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h4 style={{ marginTop: 0 }}>Ventas por Método</h4>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {Object.entries(selectedShift.salesByMethod || {}).map(([method, total]: any) => (
                  <tr key={method} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: 8 }}>{translateMethod(method)}</td>
                    <td style={{ padding: 8, textAlign: 'right' }}>{formatMoney(Number(total || 0), currency)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 700 }}>
                  <td style={{ padding: 8 }}>Total Ventas</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>{formatMoney(Number(selectedShift.totalSales || 0), currency)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h4 style={{ marginTop: 0 }}>Abonos a Crédito por Método</h4>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {Object.keys(selectedShift.creditPaymentsByMethod || {}).length === 0 ? (
                  <tr>
                    <td colSpan={2} style={{ padding: 12, textAlign: 'center', color: 'var(--muted)' }}>
                      Sin abonos de crédito en este cierre.
                    </td>
                  </tr>
                ) : (
                  Object.entries(selectedShift.creditPaymentsByMethod || {}).map(([method, total]: any) => (
                    <tr key={method} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: 8 }}>{translateMethod(method)}</td>
                      <td style={{ padding: 8, textAlign: 'right' }}>{formatMoney(Number(total || 0), currency)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h4 style={{ marginTop: 0 }}>Movimientos del Cierre</h4>
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left', fontSize: '0.85rem' }}>
                    <th style={{ padding: 8 }}>Fecha</th>
                    <th style={{ padding: 8 }}>Tipo</th>
                    <th style={{ padding: 8 }}>Descripción</th>
                    <th style={{ padding: 8 }}>Ref.</th>
                    <th style={{ padding: 8, textAlign: 'right' }}>Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedShift.movements || []).length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: 12, textAlign: 'center', color: 'var(--muted)' }}>Sin movimientos</td>
                    </tr>
                  ) : (
                    selectedShift.movements.map((movement: any) => (
                      <tr key={movement.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: 8 }}>{formatDateTime(movement.createdAt)}</td>
                        <td style={{ padding: 8 }}>{movement.type === 'IN' ? 'Entrada' : 'Salida'}</td>
                        <td style={{ padding: 8 }}>{movement.description || '-'}</td>
                        <td style={{ padding: 8 }}>{translateRefType(movement.refType)}</td>
                        <td style={{ padding: 8, textAlign: 'right' }}>{formatMoney(Number(movement.amount || 0), currency)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontWeight: 700 }}>{value}</div>
    </div>
  )
}

function Modal({ children, onClose, title }: any) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: 'var(--modal)', padding: 20, borderRadius: 12, width: 960, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 15, gap: 12 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: 'var(--text)' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function translateMethod(method: string) {
  const map: Record<string, string> = {
    CASH: 'Efectivo',
    CARD: 'Tarjeta',
    DEPOSIT: 'Depósito',
    CREDIT: 'Crédito',
  }
  return map[method] || method
}

function translateRefType(refType: string) {
  const map: Record<string, string> = {
    SALE: 'Venta',
    MANUAL: 'Manual',
    CREDIT_PAYMENT: 'Abono Crédito',
    PAYMENT: 'Pago',
  }
  return map[refType] || refType || '-'
}

function escapeHtml(value: string) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
