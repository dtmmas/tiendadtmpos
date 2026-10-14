import { describe, expect, it } from 'vitest'
import {
  buildCatalogPdfFileName,
  filterCatalogProducts,
  getCatalogCardDescriptionMaxLines,
  getCatalogProductPrimaryImageUrl,
  normalizeCatalogTitleText,
} from './catalogPdf'

describe('catalogPdf helpers', () => {
  it('resuelve la imagen principal priorizando la galeria', () => {
    const url = getCatalogProductPrimaryImageUrl({
      id: 1,
      name: 'Producto demo',
      price: 10,
      imageUrl: '/uploads/principal.jpg',
      images: [
        { imageUrl: '/uploads/galeria-1.jpg' },
        { imageUrl: '/uploads/galeria-2.jpg' },
      ],
    })

    expect(url).toBe('/uploads/galeria-1.jpg')
  })

  it('filtra por imagen y seleccion manual', () => {
    const items = [
      { id: 1, name: 'A', price: 10, imageUrl: '/uploads/a.jpg' },
      { id: 2, name: 'B', price: 20, imageUrl: '' },
      { id: 3, name: 'C', price: 30, imageUrl: '/uploads/c.jpg' },
    ]

    const filtered = filterCatalogProducts(items, { onlyWithImage: true, selectedIds: [3] })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe(3)
  })

  it('genera un nombre de archivo PDF limpio y consistente', () => {
    const fileName = buildCatalogPdfFileName('Catálogo Promoción Octubre 2026')
    expect(fileName).toMatch(/^catalogo-promocion-octubre-2026-\d{4}-\d{2}-\d{2}\.pdf$/)
  })

  it('corrige el error ortografico sitema en los titulos del catalogo', () => {
    expect(normalizeCatalogTitleText('Catalogo de SITEMA')).toBe('Catalogo de SISTEMA')
  })

  it('calcula lineas seguras de descripcion sin invadir el precio', () => {
    expect(getCatalogCardDescriptionMaxLines({
      cardHeight: 116,
      titleLineCount: 2,
      hasCode: true,
    })).toBeLessThanOrEqual(2)

    expect(getCatalogCardDescriptionMaxLines({
      cardHeight: 116,
      titleLineCount: 1,
      hasCode: false,
    })).toBeGreaterThan(0)
  })
})
