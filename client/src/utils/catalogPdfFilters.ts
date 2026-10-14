export interface CatalogPdfFilterCategory {
  id: number
  name: string
  parentId?: number | null
  departmentId?: number | null
}

export type CatalogPdfFilterState = {
  departmentId: number | null
  categoryId: number | null
  subcategoryId: number | null
  brandId: number | null
}

export function getCatalogPdfParentCategories(
  categories: CatalogPdfFilterCategory[],
  departmentId: number | null
) {
  return (Array.isArray(categories) ? categories : []).filter(category => {
    if (category.parentId) return false
    if (departmentId === null) return true
    return Number(category.departmentId || 0) === Number(departmentId)
  })
}

export function getCatalogPdfSubcategories(
  categories: CatalogPdfFilterCategory[],
  categoryId: number | null
) {
  if (categoryId === null) return []
  return (Array.isArray(categories) ? categories : []).filter(category => Number(category.parentId || 0) === Number(categoryId))
}

export function buildCatalogPdfProductQuery(filters: CatalogPdfFilterState) {
  return {
    paged: false as const,
    departmentId: filters.departmentId ?? undefined,
    categoryId: filters.subcategoryId === null ? (filters.categoryId ?? undefined) : undefined,
    subcategoryId: filters.subcategoryId ?? undefined,
    brandId: filters.brandId ?? undefined,
  }
}
