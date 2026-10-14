import { describe, expect, it } from 'vitest'
import {
  buildCatalogPdfProductQuery,
  getCatalogPdfParentCategories,
  getCatalogPdfSubcategories,
} from './catalogPdfFilters'

const categories = [
  { id: 1, name: 'Telefonia', parentId: null, departmentId: 10 },
  { id: 2, name: 'Computacion', parentId: null, departmentId: 20 },
  { id: 3, name: 'Accesorios', parentId: 1, departmentId: 10 },
  { id: 4, name: 'Laptops', parentId: 2, departmentId: 20 },
]

describe('catalogPdfFilters helpers', () => {
  it('filtra categorias padre por departamento', () => {
    expect(getCatalogPdfParentCategories(categories, 10).map(item => item.id)).toEqual([1])
    expect(getCatalogPdfParentCategories(categories, null).map(item => item.id)).toEqual([1, 2])
  })

  it('obtiene subcategorias segun la categoria seleccionada', () => {
    expect(getCatalogPdfSubcategories(categories, 2).map(item => item.id)).toEqual([4])
    expect(getCatalogPdfSubcategories(categories, null)).toEqual([])
  })

  it('arma query combinada respetando categoria y subcategoria', () => {
    expect(buildCatalogPdfProductQuery({
      departmentId: 10,
      categoryId: 1,
      subcategoryId: null,
      brandId: 5,
    })).toEqual({
      paged: false,
      departmentId: 10,
      categoryId: 1,
      subcategoryId: undefined,
      brandId: 5,
    })

    expect(buildCatalogPdfProductQuery({
      departmentId: 20,
      categoryId: 2,
      subcategoryId: 4,
      brandId: null,
    })).toEqual({
      paged: false,
      departmentId: 20,
      categoryId: undefined,
      subcategoryId: 4,
      brandId: undefined,
    })
  })
})
