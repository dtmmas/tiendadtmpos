import React from 'react'
import { formatMoney } from '../utils/currency'
import { CatalogPdfProduct, getCatalogProductPrimaryImageUrl } from '../utils/catalogPdf'

type NamedOption = { id: number; name: string }
type CategoryOption = { id: number; name: string; parentId?: number | null; departmentId?: number | null }

type Props = {
  open: boolean
  loading: boolean
  generating: boolean
  progress: number
  progressLabel: string
  error: string | null
  departments: NamedOption[]
  categories: CategoryOption[]
  subcategories: CategoryOption[]
  brands: NamedOption[]
  selectedDepartmentId: number | null
  selectedCategoryId: number | null
  selectedSubcategoryId: number | null
  selectedBrandId: number | null
  title: string
  subtitle: string
  onlyWithImage: boolean
  products: CatalogPdfProduct[]
  selectedIds: number[]
  currency: string
  onClose: () => void
  onChangeTitle: (value: string) => void
  onChangeSubtitle: (value: string) => void
  onToggleOnlyWithImage: (value: boolean) => void
  onChangeDepartmentId: (value: number | null) => void
  onChangeCategoryId: (value: number | null) => void
  onChangeSubcategoryId: (value: number | null) => void
  onChangeBrandId: (value: number | null) => void
  onResetFilters: () => void
  onToggleProduct: (productId: number) => void
  onSelectAll: () => void
  onClearSelection: () => void
  onGenerate: () => void
}

export default function CatalogPdfModal({
  open,
  loading,
  generating,
  progress,
  progressLabel,
  error,
  departments,
  categories,
  subcategories,
  brands,
  selectedDepartmentId,
  selectedCategoryId,
  selectedSubcategoryId,
  selectedBrandId,
  title,
  subtitle,
  onlyWithImage,
  products,
  selectedIds,
  currency,
  onClose,
  onChangeTitle,
  onChangeSubtitle,
  onToggleOnlyWithImage,
  onChangeDepartmentId,
  onChangeCategoryId,
  onChangeSubcategoryId,
  onChangeBrandId,
  onResetFilters,
  onToggleProduct,
  onSelectAll,
  onClearSelection,
  onGenerate,
}: Props) {
  if (!open) return null

  const selectedSet = new Set(selectedIds.map(id => Number(id)))
  const selectedCount = products.filter(product => selectedSet.has(Number(product.id))).length
  const hasActiveFilters = selectedDepartmentId !== null || selectedCategoryId !== null || selectedSubcategoryId !== null || selectedBrandId !== null

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={() => {
        if (!generating) onClose()
      }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(2, 6, 23, 0.66)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1300, padding: 16 }}
    >
      <div
        onClick={event => event.stopPropagation()}
        style={{ width: 'min(1180px, 96vw)', maxHeight: '92vh', overflow: 'auto', borderRadius: 24, background: 'linear-gradient(180deg, var(--surface), var(--modal))', border: '1px solid var(--border)', padding: 18, display: 'grid', gap: 16 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0 }}>Catálogo PDF de productos</h3>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
              Selecciona los artículos, ajusta el texto comercial y descarga un PDF listo para compartir o imprimir.
            </div>
          </div>
          <button type="button" className="small-btn" onClick={onClose} disabled={generating}>Cerrar</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Título comercial</label>
            <input value={title} onChange={event => onChangeTitle(event.target.value)} placeholder="Catálogo de productos" disabled={generating} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Subtítulo o enfoque de venta</label>
            <textarea value={subtitle} onChange={event => onChangeSubtitle(event.target.value)} rows={3} placeholder="Descubre nuestra selección con imagen, descripción y precio actualizado." disabled={generating} />
          </div>
        </div>

        <div style={{ display: 'grid', gap: 10, padding: 14, borderRadius: 18, border: '1px solid var(--border)', background: 'rgba(148,163,184,0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 800 }}>Filtros del catálogo PDF</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                El PDF se generará únicamente con los productos que coincidan con estos criterios.
              </div>
            </div>
            <button type="button" className="small-btn" onClick={onResetFilters} disabled={generating || loading || !hasActiveFilters}>
              Limpiar filtros
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>Departamento</label>
              <select
                aria-label="Filtro departamento catálogo PDF"
                value={selectedDepartmentId === null ? '' : String(selectedDepartmentId)}
                disabled={generating}
                onChange={event => onChangeDepartmentId(event.target.value ? Number(event.target.value) : null)}
              >
                <option value="">Todos</option>
                {departments.map(item => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>Categoría</label>
              <select
                aria-label="Filtro categoría catálogo PDF"
                value={selectedCategoryId === null ? '' : String(selectedCategoryId)}
                disabled={generating}
                onChange={event => onChangeCategoryId(event.target.value ? Number(event.target.value) : null)}
              >
                <option value="">Todas</option>
                {categories.map(item => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>Subcategoría</label>
              <select
                aria-label="Filtro subcategoría catálogo PDF"
                value={selectedSubcategoryId === null ? '' : String(selectedSubcategoryId)}
                disabled={generating || selectedCategoryId === null}
                onChange={event => onChangeSubcategoryId(event.target.value ? Number(event.target.value) : null)}
              >
                <option value="">Todas</option>
                {subcategories.map(item => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>Marca</label>
              <select
                aria-label="Filtro marca catálogo PDF"
                value={selectedBrandId === null ? '' : String(selectedBrandId)}
                disabled={generating}
                onChange={event => onChangeBrandId(event.target.value ? Number(event.target.value) : null)}
              >
                <option value="">Todas</option>
                {brands.map(item => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {generating && (
          <div style={{ display: 'grid', gap: 8, padding: 14, borderRadius: 16, background: 'linear-gradient(180deg, rgba(37,99,235,0.1), rgba(14,165,233,0.08))', border: '1px solid rgba(37,99,235,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', fontSize: 13 }}>
              <strong style={{ color: '#1d4ed8' }}>{progressLabel || 'Generando PDF...'}</strong>
              <span style={{ color: '#0f172a', fontWeight: 800 }}>{Math.max(0, Math.min(100, Math.round(progress)))}%</span>
            </div>
            <div style={{ height: 12, borderRadius: 999, background: 'rgba(148,163,184,0.2)', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.max(0, Math.min(100, progress))}%`,
                  height: '100%',
                  borderRadius: 999,
                  background: 'linear-gradient(90deg, #2563eb, #0ea5e9)',
                  transition: 'width 180ms ease',
                }}
              />
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input
                type="checkbox"
                checked={onlyWithImage}
                  disabled={generating}
                onChange={event => onToggleOnlyWithImage(event.target.checked)}
              />
              Solo productos con imagen
            </label>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              Disponibles: <strong>{products.length}</strong> • Seleccionados: <strong>{selectedCount}</strong>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="small-btn" onClick={onSelectAll} disabled={loading || generating || products.length === 0}>Seleccionar visibles</button>
            <button type="button" className="small-btn" onClick={onClearSelection} disabled={loading || generating || selectedCount === 0}>Limpiar selección</button>
            <button type="button" className="primary-btn" onClick={onGenerate} disabled={loading || generating || selectedCount === 0}>
              {generating ? 'Generando PDF...' : 'Descargar PDF'}
            </button>
          </div>
        </div>

        {error && (
          <div style={{ padding: 12, borderRadius: 14, border: '1px solid rgba(239,68,68,0.24)', background: 'rgba(239,68,68,0.08)', color: '#991b1b', fontSize: 13 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ padding: 22, textAlign: 'center', color: 'var(--muted)', border: '1px dashed var(--border)', borderRadius: 16 }}>
            Cargando productos para el catálogo...
          </div>
        ) : products.length === 0 ? (
          <div style={{ padding: 22, textAlign: 'center', color: 'var(--muted)', border: '1px dashed var(--border)', borderRadius: 16 }}>
            No hay productos disponibles con los filtros actuales.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {products.map(product => {
              const selected = selectedSet.has(Number(product.id))
              const imageUrl = getCatalogProductPrimaryImageUrl(product)
              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => onToggleProduct(product.id)}
                  disabled={generating}
                  style={{
                    textAlign: 'left',
                    borderRadius: 18,
                    padding: 0,
                    overflow: 'hidden',
                    border: selected ? '2px solid #2563eb' : '1px solid var(--border)',
                    background: 'linear-gradient(180deg, var(--surface), var(--bg))',
                    cursor: 'pointer',
                    boxShadow: selected ? '0 10px 28px rgba(37,99,235,0.18)' : 'none',
                  }}
                >
                  <div style={{ position: 'relative', height: 160, background: 'var(--bg)' }}>
                    {imageUrl ? (
                      <img src={imageUrl} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 13 }}>
                        Sin imagen
                      </div>
                    )}
                    <div style={{ position: 'absolute', top: 10, right: 10, padding: '6px 10px', borderRadius: 999, background: selected ? '#2563eb' : 'rgba(15,23,42,0.72)', color: '#fff', fontSize: 11, fontWeight: 700 }}>
                      {selected ? 'Incluido' : 'Tocar para incluir'}
                    </div>
                  </div>
                  <div style={{ padding: 14, display: 'grid', gap: 8 }}>
                    <div style={{ fontWeight: 800, lineHeight: 1.35 }}>{product.name}</div>
                    <div style={{ fontSize: 11, color: '#2563eb', fontWeight: 700 }}>
                      {String(product.productCode || '').trim() || 'Sin codigo'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', minHeight: 48 }}>
                      {String(product.description || '').trim() || 'Sin descripción registrada.'}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '100%',
                        textAlign: 'center',
                        padding: '8px 12px',
                        borderRadius: 12,
                        background: 'rgba(15,118,110,0.12)',
                        color: '#0f766e',
                        fontWeight: 800,
                        fontSize: 16,
                      }}
                    >
                      {formatMoney(Number(product.price || 0), currency)}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
