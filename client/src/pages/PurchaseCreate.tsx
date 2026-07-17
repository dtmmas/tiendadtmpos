import React, { useState, useEffect, useMemo } from 'react'
import { api, getSuppliers, getProducts } from '../api'
import { useConfigStore } from '../store/config'
import { useNavigate } from 'react-router-dom'

interface Product {
  id: number
  name: string
  sku?: string
  productCode?: string
  description?: string
  altName?: string
  genericName?: string
  cost?: number
  stock: number
  productType?: string
}

interface PurchaseItem {
  productId: number
  name: string
  code: string
  quantity: number
  unitCost: number
  productType?: string
  // Medicinal
  batches?: { batchNo: string; expiryDate: string; quantity: number }[]
  // Legacy single batch fields (optional, kept for compatibility if needed temporarily)
  batchNo?: string
  expiryDate?: string
  // IMEI/Serial
  serials?: string // for backend compatibility (payload)
  imeiEntries?: string[] // for UI handling
}

interface Warehouse {
    id: number
    name: string
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
  const [items, setItems] = useState<PurchaseItem[]>([])
  
  // Product Search State
  const [isProductModalOpen, setIsProductModalOpen] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [debouncedProductSearch, setDebouncedProductSearch] = useState('')
  
  const navigate = useNavigate()
  const config = useConfigStore(s => s.config)

  useEffect(() => {
    loadData()
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
    return product.productCode || product.sku || ''
  }

  async function addItem(product: Product) {
    const existing = items.find(i => i.productId === product.id)

    if (existing) {
        alert('El producto ya está en la lista')
        return
    }

    setItems([...items, {
      productId: product.id,
      name: product.name,
      code: getProductCode(product),
      quantity: 1,
      unitCost: product.cost || 0,
      productType: product.productType,
      batches: product.productType === 'MEDICINAL' ? [{ batchNo: '', expiryDate: '', quantity: 1 }] : undefined,
      imeiEntries: (product.productType === 'IMEI' || product.productType === 'SERIAL') ? [''] : undefined,
    }])
    setIsProductModalOpen(false)
    setProductSearch('')
    setDebouncedProductSearch('')
  }

  function updateItem(index: number, field: keyof PurchaseItem, value: any) {
    const newItems = [...items]
    const item = { ...newItems[index], [field]: value }
    
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

  async function handleSubmit() {
    if (!supplierId) return alert('Seleccione un proveedor')
    if (items.length === 0) return alert('Agregue productos a la compra')

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
    }

    setLoading(true)
    try {
      // Prepare items payload (avoid mutating state)
      const payloadItems = items.map(item => {
        const newItem = { ...item }
        if ((item.productType === 'IMEI' || item.productType === 'SERIAL') && item.imeiEntries) {
            newItem.serials = item.imeiEntries.join('\n')
        }
        return newItem
      })

      const formData = new FormData()
      formData.append('supplierId', String(supplierId))
      if (warehouseId) formData.append('warehouseId', String(warehouseId))
      formData.append('docNo', docNo)
      formData.append('notes', notes)
      formData.append('total', String(total))
      formData.append('items', JSON.stringify(payloadItems))
      if (file) {
        formData.append('document', file)
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
    <div style={{ padding: 20, maxWidth: 1200, margin: '0 auto', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1>Nueva Compra</h1>
        <button className="btn-secondary" onClick={() => navigate('/purchases')}>Cancelar</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20, marginBottom: 20, padding: 20, backgroundColor: 'var(--modal)', borderRadius: 8, border: '1px solid var(--border)' }}>
        <div>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>Proveedor</label>
          <select 
            value={supplierId} 
            onChange={e => setSupplierId(Number(e.target.value))}
            style={{ width: '100%', padding: 8, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
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
                style={{ width: '100%', padding: 8, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
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
            style={{ width: '100%', padding: 8, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
            placeholder="Ej. F001-12345"
          />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>Notas</label>
          <input 
            type="text" 
            value={notes} 
            onChange={e => setNotes(e.target.value)}
            style={{ width: '100%', padding: 8, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
            placeholder="Observaciones..."
          />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>Documento (PDF/Img)</label>
          <input 
            type="file" 
            accept=".pdf,image/*"
            onChange={e => setFile(e.target.files?.[0] || null)}
            style={{ width: '100%', padding: 5, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
          />
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Detalle de Productos</h3>
          <button className="btn-primary" onClick={() => setIsProductModalOpen(true)}>+ Agregar Producto</button>
        </div>

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
                  </td>
                  <td style={{ padding: 10, verticalAlign: 'top' }}>
                    <input 
                      type="number" 
                      min="1"
                      value={item.quantity}
                      onChange={e => updateItem(i, 'quantity', Number(e.target.value))}
                      style={{ width: '100%', textAlign: 'center', padding: 4, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
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
                    {config?.currency} {(item.quantity * item.unitCost).toFixed(2)}
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

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 20, padding: 20, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: '1.5em', fontWeight: 'bold' }}>
            Total: {config?.currency} {total.toFixed(2)}
          </div>
          <button 
            className="btn-primary" 
            style={{ fontSize: '1.2em', padding: '10px 30px' }}
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? 'Procesando...' : 'Registrar Compra'}
          </button>
        </div>
      </div>

      {isProductModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 }}>
          <div style={{ background: 'var(--modal)', padding: 20, borderRadius: 8, width: 600, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <h3>Buscar Producto</h3>
            <input 
              autoFocus
              type="text" 
              placeholder="Buscar por nombre, SKU, código, descripción, alterno o genérico..." 
              value={productSearch}
              onChange={e => setProductSearch(e.target.value)}
              style={{ width: '100%', padding: 10, marginBottom: 10, borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
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
                        {(getProductCode(p) || 'Sin codigo')} - Stock: {p.stock}
                      </div>
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
