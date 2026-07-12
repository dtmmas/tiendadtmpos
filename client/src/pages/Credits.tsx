import { useState, useEffect } from 'react'
import { getCredits, payCredit, getConfig, getCreditPayments } from '../api'
import { formatDate, formatDateTime } from '../utils/date'
import CameraCaptureButton from '../components/CameraCaptureButton'

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

interface Payment {
  id: number
  amount: string | number
  payment_method: string
  reference: string
  created_at: string
  received_by: string
  document_url?: string
}

interface Config {
  currency: string
}

export default function Credits() {
  const [credits, setCredits] = useState<Credit[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [config, setConfig] = useState<Config | null>(null)
  
  // Modal state
  const [selectedCredit, setSelectedCredit] = useState<Credit | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('CASH')
  const [reference, setReference] = useState('')
  const [paymentDate, setPaymentDate] = useState('')
  const [responsible, setResponsible] = useState('')
  const [documentFile, setDocumentFile] = useState<File | null>(null)
  const [processingPayment, setProcessingPayment] = useState(false)

  // History state
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [historyPayments, setHistoryPayments] = useState<Payment[]>([])
  const [selectedCreditHistory, setSelectedCreditHistory] = useState<Credit | null>(null)

  useEffect(() => {
    loadCredits()
    getConfig().then(setConfig)
  }, [])

  async function loadCredits() {
    setLoading(true)
    try {
      const data = await getCredits({ search })
      setCredits(data)
    } catch (err) {
      console.error(err)
      alert('Error cargando créditos')
    } finally {
      setLoading(false)
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    loadCredits()
  }

  function openPayModal(credit: Credit) {
    setSelectedCredit(credit)
    const pending = Number(credit.total_amount) - Number(credit.paid_amount)
    setPayAmount(pending.toFixed(2))
    setPaymentMethod('CASH')
    setReference('')
    setPaymentDate('')
    setResponsible('')
    setDocumentFile(null)
  }

  function closePayModal() {
    setSelectedCredit(null)
    setPayAmount('')
    setPaymentMethod('CASH')
    setReference('')
    setPaymentDate('')
    setResponsible('')
    setDocumentFile(null)
  }

  async function openHistoryModal(credit: Credit) {
    setSelectedCreditHistory(credit)
    setHistoryPayments([])
    setHistoryError('')
    setHistoryModalOpen(true)
    setHistoryLoading(true)
    try {
      const payments = await getCreditPayments(credit.id)
      setHistoryPayments(payments)
    } catch (err) {
      console.error(err)
      setHistoryError((err as any)?.response?.data?.error || 'Error cargando historial')
    } finally {
      setHistoryLoading(false)
    }
  }

  function closeHistoryModal() {
    setHistoryModalOpen(false)
    setHistoryLoading(false)
    setHistoryError('')
    setHistoryPayments([])
    setSelectedCreditHistory(null)
  }

  function printPayment(payment: Payment, credit: Credit) {
    const printWindow = window.open('', '_blank', 'width=400,height=600')
    if (!printWindow) return

    const html = `
      <html>
        <head>
          <title>Comprobante de Pago</title>
          <style>
            body { font-family: monospace; padding: 20px; }
            .header { text-align: center; margin-bottom: 20px; }
            .row { display: flex; justify-content: space-between; margin-bottom: 5px; }
            .divider { border-top: 1px dashed #000; margin: 10px 0; }
            .footer { text-align: center; margin-top: 20px; font-size: 0.8em; }
          </style>
        </head>
        <body>
          <div class="header">
            <h3>COMPROBANTE DE PAGO</h3>
            <p>${formatDateTime(payment.created_at)}</p>
          </div>
          
          <div class="row">
            <span>Recibo N°:</span>
            <span>${payment.id}</span>
          </div>
          <div class="row">
            <span>Cliente:</span>
            <span>${credit.customer_name}</span>
          </div>
          <div class="row">
            <span>Venta Ref:</span>
            <span>${credit.doc_no}</span>
          </div>
          
          <div class="divider"></div>
          
          <div class="row">
            <strong>MONTO ABONADO:</strong>
            <strong>${config?.currency || '$'} ${Number(payment.amount).toFixed(2)}</strong>
          </div>
          
          <div class="divider"></div>
          
          <div class="row">
            <span>Método:</span>
            <span>${payment.payment_method === 'CASH' ? 'Efectivo' : payment.payment_method === 'CARD' ? 'Tarjeta' : 'Depósito'}</span>
          </div>
          ${payment.reference ? `
          <div class="row">
            <span>Referencia:</span>
            <span>${payment.reference}</span>
          </div>` : ''}
          ${payment.received_by ? `
          <div class="row">
            <span>Recibido por:</span>
            <span>${payment.received_by}</span>
          </div>` : ''}
          
          <div class="divider"></div>
          
          <div class="row">
            <span>Deuda Total:</span>
            <span>${config?.currency || '$'} ${Number(credit.total_amount).toFixed(2)}</span>
          </div>
          
          <div class="footer">
            <p>Gracias por su pago</p>
          </div>
          
          <script>
            window.onload = function() { window.print(); window.close(); }
          </script>
        </body>
      </html>
    `
    printWindow.document.write(html)
    printWindow.document.close()
  }

  async function handlePayment(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedCredit) return

    const amount = parseFloat(payAmount)
    if (isNaN(amount) || amount <= 0) {
      alert('Monto inválido')
      return
    }

    const pending = Number(selectedCredit.total_amount) - Number(selectedCredit.paid_amount)
    if (amount > pending + 0.01) { // small epsilon
      alert('El monto excede la deuda pendiente')
      return
    }

    if ((paymentMethod === 'CARD' || paymentMethod === 'DEPOSIT') && !reference.trim()) {
      alert('Debe ingresar una referencia para pagos con tarjeta o depósito')
      return
    }

    setProcessingPayment(true)
    try {
      const formData = new FormData()
      formData.append('installmentId', String(selectedCredit.id))
      formData.append('amount', String(amount))
      formData.append('paymentMethod', paymentMethod)
      if (reference) formData.append('reference', reference)
      if (paymentMethod !== 'CASH' && paymentDate) formData.append('paymentDate', paymentDate)
      if (responsible) formData.append('responsible', responsible)
      if (documentFile) formData.append('document', documentFile)

      const result = await payCredit(formData)
      alert('Pago registrado exitosamente')
      
      // Auto-print receipt
      const payment: Payment = {
        id: result.paymentId,
        amount: amount,
        payment_method: paymentMethod,
        reference: reference,
        created_at: new Date().toISOString(),
        received_by: responsible
      }
      printPayment(payment, selectedCredit)

      closePayModal()
      loadCredits()
    } catch (err) {
      console.error(err)
      alert((err as any)?.response?.data?.error || 'Error registrando pago')
    } finally {
      setProcessingPayment(false)
    }
  }

  return (
    <div className="page-shell">
      <div className="page-toolbar" style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Gestión de Créditos</h2>
        <form onSubmit={handleSearch} className="page-toolbar-actions" style={{ flex: 1, justifyContent: 'flex-end' }}>
          <input
            type="text"
            placeholder="Buscar por cliente o No. documento..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              flex: 1,
              maxWidth: 400
            }}
          />
          <button 
            type="submit"
            className="primary-btn"
          >
            Buscar
          </button>
        </form>
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Cargando créditos...</p>
      ) : (
        <div className="table-scroll" style={{ background: 'var(--modal)', borderRadius: 12, border: '1px solid var(--border)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--modal)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: 12, textAlign: 'left' }}>Fecha Venta</th>
                <th style={{ padding: 12, textAlign: 'left' }}>Vence</th>
                <th style={{ padding: 12, textAlign: 'left' }}>Cliente</th>
                <th style={{ padding: 12, textAlign: 'left' }}>Documento</th>
                <th style={{ padding: 12, textAlign: 'right' }}>Total</th>
                <th style={{ padding: 12, textAlign: 'right' }}>Pagado</th>
                <th style={{ padding: 12, textAlign: 'right' }}>Pendiente</th>
                <th style={{ padding: 12, textAlign: 'center' }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {credits.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
                    No hay créditos pendientes
                  </td>
                </tr>
              ) : (
                credits.map(credit => {
                  const total = Number(credit.total_amount)
                  const paid = Number(credit.paid_amount)
                  const pending = total - paid
                  const isFullyPaid = credit.paid === 1 || pending < 0.01
                  
                  return (
                    <tr key={credit.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: 12 }}>{formatDate(credit.sale_date)}</td>
                      <td style={{ padding: 12 }}>{formatDate(credit.due_date)}</td>
                      <td style={{ padding: 12, fontWeight: 600 }}>{credit.customer_name || 'Consumidor Final'}</td>
                      <td style={{ padding: 12 }}>{credit.doc_no || `#${credit.sale_id}`}</td>
                      <td style={{ padding: 12, textAlign: 'right' }}>
                        {config?.currency} {total.toFixed(2)}
                      </td>
                      <td style={{ padding: 12, textAlign: 'right', color: '#22c55e' }}>
                        {config?.currency} {paid.toFixed(2)}
                      </td>
                      <td style={{ padding: 12, textAlign: 'right', color: isFullyPaid ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                        {isFullyPaid ? 'COMPLETADO' : `${config?.currency} ${pending.toFixed(2)}`}
                      </td>
                      <td style={{ padding: 12, textAlign: 'center', display: 'flex', gap: 8, justifyContent: 'center' }}>
                        <button
                          className="icon-btn"
                          onClick={() => openHistoryModal(credit)}
                          title="Ver historial de pagos"
                        >
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                          </svg>
                        </button>
                        {!isFullyPaid && (
                        <button
                          className="icon-btn primary"
                          onClick={() => openPayModal(credit)}
                          title="Abonar"
                        >
                          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="2" y="6" width="20" height="12" rx="2" />
                            <circle cx="12" cy="12" r="2" />
                            <path d="M6 12h.01M18 12h.01" />
                          </svg>
                        </button>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {selectedCredit && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div className="responsive-modal" style={{
            background: 'var(--modal)',
            padding: 20,
            borderRadius: 12,
            border: '1px solid var(--border)',
            width: '90%',
            maxWidth: 500
          }}>
            <h2 style={{ marginTop: 0, marginBottom: 16 }}>Registrar Abono</h2>
            <div style={{ marginBottom: 20, lineHeight: '1.6' }}>
              <p><strong>Cliente:</strong> {selectedCredit.customer_name}</p>
              <p><strong>Documento:</strong> {selectedCredit.doc_no || `#${selectedCredit.sale_id}`}</p>
              <p><strong>Total Deuda:</strong> {config?.currency} {Number(selectedCredit.total_amount).toFixed(2)}</p>
              <p><strong>Pagado:</strong> {config?.currency} {Number(selectedCredit.paid_amount).toFixed(2)}</p>
              <p style={{ fontSize: '1.2rem', color: '#ef4444' }}>
                <strong>Pendiente: {config?.currency} {(Number(selectedCredit.total_amount) - Number(selectedCredit.paid_amount)).toFixed(2)}</strong>
              </p>
            </div>

            <form onSubmit={handlePayment}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Monto a Abonar</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={payAmount}
                  onChange={e => setPayAmount(e.target.value)}
                  style={{
                    width: '100%',
                    fontSize: '1.2rem'
                  }}
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Método de Pago</label>
                <select
                  value={paymentMethod}
                  onChange={e => setPaymentMethod(e.target.value)}
                  style={{
                    width: '100%'
                  }}
                >
                  <option value="CASH">Efectivo</option>
                  <option value="CARD">Tarjeta</option>
                  <option value="DEPOSIT">Depósito</option>
                </select>
              </div>

              {(paymentMethod === 'CARD' || paymentMethod === 'DEPOSIT') && (
                <>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>
                      Fecha de Pago
                    </label>
                    <input
                      type="datetime-local"
                      value={paymentDate}
                      onChange={e => setPaymentDate(e.target.value)}
                      style={{
                        width: '100%'
                      }}
                    />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>
                      Referencia {paymentMethod === 'CARD' ? '(Voucher)' : '(No. Operación)'} <span style={{ color: 'red' }}>*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={reference}
                      onChange={e => setReference(e.target.value)}
                      placeholder="Ingrese número de referencia"
                      style={{
                        width: '100%'
                      }}
                    />
                  </div>
                </>
              )}

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Responsable (Quién realiza el pago)</label>
                <input
                  type="text"
                  value={responsible}
                  onChange={e => setResponsible(e.target.value)}
                  placeholder="Nombre de quien realiza el pago"
                  style={{
                    width: '100%'
                  }}
                />
              </div>

              {paymentMethod !== 'CASH' && (
                <div style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Comprobante (Opcional)</label>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      onChange={e => setDocumentFile(e.target.files ? e.target.files[0] : null)}
                      style={{
                        width: '100%'
                      }}
                    />
                    <CameraCaptureButton
                      onCapture={file => setDocumentFile(file)}
                      modalTitle="Capturar comprobante del pago"
                      buttonTitle="Tomar foto del comprobante"
                      fileNamePrefix="comprobante"
                    />
                  </div>
                  {documentFile && (
                    <div className="file-name" style={{ marginTop: 6 }}>
                      {documentFile.name}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                    Puedes subir un PDF/imagen o tomar una foto desde el telefono o webcam USB.
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={closePayModal}
                  disabled={processingPayment}
                  className="icon-btn"
                  style={{ width: 'auto', padding: '0 16px' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={processingPayment}
                  className="primary-btn"
                >
                  {processingPayment ? 'Procesando...' : 'Confirmar Pago'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {historyModalOpen && selectedCreditHistory && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div className="responsive-modal" style={{
            backgroundColor: 'var(--modal)',
            color: 'var(--text)',
            padding: '2rem',
            borderRadius: '12px',
            border: '1px solid var(--border)',
            width: '95%',
            maxWidth: '900px',
            maxHeight: '80vh',
            overflowY: 'auto',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
              <h2 style={{ margin: 0 }}>Historial de Pagos</h2>
              <button
                onClick={closeHistoryModal}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  color: 'var(--text)'
                }}
              >
                &times;
              </button>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <p><strong>Cliente:</strong> {selectedCreditHistory.customer_name}</p>
              <p><strong>Documento:</strong> {selectedCreditHistory.doc_no}</p>
            </div>

            <div className="table-scroll">
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1.5rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', backgroundColor: 'var(--bg)' }}>
                    <th style={{ padding: '1rem', textAlign: 'left', minWidth: '100px' }}>Fecha</th>
                    <th style={{ padding: '1rem', textAlign: 'right', minWidth: '100px' }}>Monto</th>
                    <th style={{ padding: '1rem', textAlign: 'center', minWidth: '100px' }}>Método</th>
                    <th style={{ padding: '1rem', textAlign: 'left', minWidth: '120px' }}>Ref.</th>
                    <th style={{ padding: '1rem', textAlign: 'left', minWidth: '150px' }}>Responsable</th>
                    <th style={{ padding: '1rem', textAlign: 'center', minWidth: '60px' }}>Doc</th>
                    <th style={{ padding: '1rem', textAlign: 'center', minWidth: '100px' }}>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {historyLoading ? (
                    <tr>
                      <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
                        Cargando historial...
                      </td>
                    </tr>
                  ) : historyError ? (
                    <tr>
                      <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#ef4444' }}>
                        {historyError}
                      </td>
                    </tr>
                  ) : historyPayments.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>
                        No hay pagos registrados
                      </td>
                    </tr>
                  ) : (
                    historyPayments.map(payment => (
                      <tr key={payment.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '1rem' }}>
                          {formatDate(payment.created_at)}
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'right', fontWeight: 'bold' }}>
                          {config?.currency} {Number(payment.amount).toFixed(2)}
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                          <span style={{
                            padding: '4px 8px',
                            borderRadius: '12px',
                            backgroundColor: payment.payment_method === 'CASH' ? 'rgba(52, 152, 219, 0.1)' : 'rgba(241, 196, 15, 0.1)',
                            color: payment.payment_method === 'CASH' ? '#3498db' : '#f1c40f',
                            fontSize: '0.85rem',
                            fontWeight: 'bold',
                            border: `1px solid ${payment.payment_method === 'CASH' ? '#3498db' : '#f1c40f'}`
                          }}>
                            {payment.payment_method === 'CASH' ? 'Efectivo' : 
                             payment.payment_method === 'CARD' ? 'Tarjeta' : 'Depósito'}
                          </span>
                        </td>
                        <td style={{ padding: '1rem', color: 'var(--muted)' }}>{payment.reference || '-'}</td>
                        <td style={{ padding: '1rem', color: 'var(--muted)' }}>{payment.received_by || '-'}</td>
                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                          {payment.document_url ? (
                            <a 
                              href={payment.document_url}
                              target="_blank" 
                              rel="noopener noreferrer"
                              style={{ 
                                color: 'var(--accent)', 
                                textDecoration: 'none', 
                                fontWeight: 'bold',
                                border: '1px solid var(--accent)',
                                padding: '2px 8px',
                                borderRadius: '4px'
                              }}
                            >
                              Ver
                            </a>
                          ) : '-'}
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                          <button
                            className="icon-btn"
                            onClick={() => printPayment(payment, selectedCreditHistory)}
                            title="Imprimir comprobante"
                            style={{ margin: '0 auto' }}
                          >
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="6 9 6 2 18 2 18 9" />
                              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                              <rect x="6" y="14" width="12" height="8" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ textAlign: 'right' }}>
              <button
                onClick={closeHistoryModal}
                style={{
                  padding: '0.5rem 1rem',
                  background: 'transparent',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  cursor: 'pointer'
                }}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
