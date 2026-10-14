import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CatalogPdfModal from './CatalogPdfModal'

const baseFilterProps = {
  departments: [
    { id: 10, name: 'Telefonia' },
    { id: 20, name: 'Computacion' },
  ],
  categories: [
    { id: 1, name: 'Celulares', parentId: null, departmentId: 10 },
    { id: 2, name: 'Laptops', parentId: null, departmentId: 20 },
  ],
  subcategories: [
    { id: 11, name: 'Android', parentId: 1, departmentId: 10 },
  ],
  brands: [
    { id: 100, name: 'Samsung' },
    { id: 200, name: 'Lenovo' },
  ],
  selectedDepartmentId: null,
  selectedCategoryId: null,
  selectedSubcategoryId: null,
  selectedBrandId: null,
}

describe('CatalogPdfModal', () => {
  it('muestra productos, permite marcar y dispara la generacion', () => {
    const onToggleProduct = vi.fn()
    const onGenerate = vi.fn()

    render(
      <CatalogPdfModal
        open
        loading={false}
        generating={false}
        progress={0}
        progressLabel=""
        error={null}
        {...baseFilterProps}
        title="Catalogo demo"
        subtitle="Subtitulo demo"
        onlyWithImage
        products={[
          { id: 1, name: 'Producto A', price: 125, description: 'Descripcion A', imageUrl: '/uploads/a.jpg' },
          { id: 2, name: 'Producto B', price: 225, description: 'Descripcion B', imageUrl: '/uploads/b.jpg' },
        ]}
        selectedIds={[1]}
        currency="GTQ"
        onClose={() => {}}
        onChangeTitle={() => {}}
        onChangeSubtitle={() => {}}
        onToggleOnlyWithImage={() => {}}
        onChangeDepartmentId={() => {}}
        onChangeCategoryId={() => {}}
        onChangeSubcategoryId={() => {}}
        onChangeBrandId={() => {}}
        onResetFilters={() => {}}
        onToggleProduct={onToggleProduct}
        onSelectAll={() => {}}
        onClearSelection={() => {}}
        onGenerate={onGenerate}
      />
    )

    fireEvent.click(screen.getByText('Producto B'))
    expect(onToggleProduct).toHaveBeenCalledWith(2)

    fireEvent.click(screen.getByRole('button', { name: /descargar pdf/i }))
    expect(onGenerate).toHaveBeenCalled()
  })

  it('deshabilita la descarga si no hay seleccion', () => {
    render(
      <CatalogPdfModal
        open
        loading={false}
        generating={false}
        progress={0}
        progressLabel=""
        error={null}
        {...baseFilterProps}
        title="Catalogo demo"
        subtitle="Subtitulo demo"
        onlyWithImage={false}
        products={[
          { id: 1, name: 'Producto A', price: 125, description: 'Descripcion A', imageUrl: '/uploads/a.jpg' },
        ]}
        selectedIds={[]}
        currency="GTQ"
        onClose={() => {}}
        onChangeTitle={() => {}}
        onChangeSubtitle={() => {}}
        onToggleOnlyWithImage={() => {}}
        onChangeDepartmentId={() => {}}
        onChangeCategoryId={() => {}}
        onChangeSubcategoryId={() => {}}
        onChangeBrandId={() => {}}
        onResetFilters={() => {}}
        onToggleProduct={() => {}}
        onSelectAll={() => {}}
        onClearSelection={() => {}}
        onGenerate={() => {}}
      />
    )

    expect(screen.getByRole('button', { name: /descargar pdf/i })).toBeDisabled()
  })

  it('muestra barra de progreso durante la generacion', () => {
    render(
      <CatalogPdfModal
        open
        loading={false}
        generating
        progress={64}
        progressLabel="Renderizando productos..."
        error={null}
        {...baseFilterProps}
        title="Catalogo demo"
        subtitle="Subtitulo demo"
        onlyWithImage={false}
        products={[
          { id: 1, name: 'Producto A', price: 125, description: 'Descripcion A', imageUrl: '/uploads/a.jpg' },
        ]}
        selectedIds={[1]}
        currency="GTQ"
        onClose={() => {}}
        onChangeTitle={() => {}}
        onChangeSubtitle={() => {}}
        onToggleOnlyWithImage={() => {}}
        onChangeDepartmentId={() => {}}
        onChangeCategoryId={() => {}}
        onChangeSubcategoryId={() => {}}
        onChangeBrandId={() => {}}
        onResetFilters={() => {}}
        onToggleProduct={() => {}}
        onSelectAll={() => {}}
        onClearSelection={() => {}}
        onGenerate={() => {}}
      />
    )

    expect(screen.getByText(/renderizando productos/i)).toBeInTheDocument()
    expect(screen.getByText('64%')).toBeInTheDocument()
  })

  it('expone filtros jerarquicos y dispara callbacks', () => {
    const onChangeDepartmentId = vi.fn()
    const onChangeCategoryId = vi.fn()
    const onChangeSubcategoryId = vi.fn()
    const onChangeBrandId = vi.fn()
    const onResetFilters = vi.fn()

    render(
      <CatalogPdfModal
        open
        loading={false}
        generating={false}
        progress={0}
        progressLabel=""
        error={null}
        {...baseFilterProps}
        selectedDepartmentId={10}
        selectedCategoryId={1}
        selectedSubcategoryId={11}
        selectedBrandId={100}
        title="Catalogo demo"
        subtitle="Subtitulo demo"
        onlyWithImage={false}
        products={[
          { id: 1, name: 'Producto A', price: 125, description: 'Descripcion A', imageUrl: '/uploads/a.jpg', productCode: 'P-001' },
        ]}
        selectedIds={[1]}
        currency="GTQ"
        onClose={() => {}}
        onChangeTitle={() => {}}
        onChangeSubtitle={() => {}}
        onToggleOnlyWithImage={() => {}}
        onChangeDepartmentId={onChangeDepartmentId}
        onChangeCategoryId={onChangeCategoryId}
        onChangeSubcategoryId={onChangeSubcategoryId}
        onChangeBrandId={onChangeBrandId}
        onResetFilters={onResetFilters}
        onToggleProduct={() => {}}
        onSelectAll={() => {}}
        onClearSelection={() => {}}
        onGenerate={() => {}}
      />
    )

    fireEvent.change(screen.getByLabelText(/filtro departamento catálogo pdf/i), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText(/filtro categoría catálogo pdf/i), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText(/filtro subcategoría catálogo pdf/i), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText(/filtro marca catálogo pdf/i), { target: { value: '200' } })
    fireEvent.click(screen.getByRole('button', { name: /limpiar filtros/i }))

    expect(onChangeDepartmentId).toHaveBeenCalledWith(20)
    expect(onChangeCategoryId).toHaveBeenCalledWith(2)
    expect(onChangeSubcategoryId).toHaveBeenCalledWith(null)
    expect(onChangeBrandId).toHaveBeenCalledWith(200)
    expect(onResetFilters).toHaveBeenCalled()
    expect(screen.getByText('P-001')).toBeInTheDocument()
  })
})
