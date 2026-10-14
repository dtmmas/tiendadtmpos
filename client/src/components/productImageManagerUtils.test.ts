import { describe, expect, it } from 'vitest'
import {
  PRODUCT_IMAGE_LIMIT,
  buildProductImagesUploadPayload,
  validateProductImageFiles,
} from './productImageManagerUtils'

describe('productImageManagerUtils', () => {
  it('valida formato, peso y limite de imagenes', () => {
    const invalidType = new File(['hola'], 'nota.txt', { type: 'text/plain' })
    const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'grande.png', { type: 'image/png' })
    const errors = validateProductImageFiles([invalidType, oversized], PRODUCT_IMAGE_LIMIT + 1)

    expect(errors.some(message => message.includes('hasta 10 fotografias'))).toBe(true)
    expect(errors.some(message => message.includes('nota.txt'))).toBe(true)
    expect(errors.some(message => message.includes('grande.png'))).toBe(true)
  })

  it('serializa imagenes existentes y nuevas para enviar al backend', () => {
    const newFile = new File(['abc'], 'foto.jpg', { type: 'image/jpeg' })
    const payload = buildProductImagesUploadPayload([
      {
        id: 8,
        imageUrl: '/uploads/existente.jpg',
        previewUrl: '/uploads/existente.jpg',
        fileName: 'existente.jpg',
        isExisting: true,
      },
      {
        imageUrl: '/uploads/legacy.jpg',
        previewUrl: '/uploads/legacy.jpg',
        fileName: 'legacy.jpg',
        isExisting: true,
      },
      {
        file: newFile,
        imageUrl: null,
        previewUrl: 'data:image/jpeg;base64,abc',
        fileName: 'foto.jpg',
        isExisting: false,
      },
    ])

    expect(payload.productImages).toEqual([
      { id: 8 },
      { legacyImageUrl: '/uploads/legacy.jpg' },
      { uploadIndex: 0 },
    ])
    expect(payload.newFiles).toHaveLength(1)
    expect(payload.newFiles[0].name).toBe('foto.jpg')
  })
})
