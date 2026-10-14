import React, { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ProductImageManager from './ProductImageManager'
import { ProductImageDraft } from './productImageManagerUtils'

vi.mock('./CameraCaptureButton', () => ({
  default: ({ onCapture }: { onCapture: (file: File) => void }) => (
    <button
      type="button"
      onClick={() => onCapture(new File(['cam'], 'camara.jpg', { type: 'image/jpeg' }))}
    >
      Captura mock
    </button>
  ),
}))

function TestHarness({ initialValue = [] }: { initialValue?: ProductImageDraft[] }) {
  const [value, setValue] = useState<ProductImageDraft[]>(initialValue)
  return (
    <div>
      <ProductImageManager value={value} onChange={setValue} uploadProgress={null} />
      <div data-testid="count">{value.length}</div>
      <div data-testid="first-name">{value[0]?.fileName || ''}</div>
    </div>
  )
}

describe('ProductImageManager', () => {
  it('agrega, reemplaza y elimina imagenes desde la interfaz', async () => {
    const existingImage: ProductImageDraft = {
      id: 15,
      imageUrl: '/uploads/original.jpg',
      previewUrl: '/uploads/original.jpg',
      fileName: 'original.jpg',
      isExisting: true,
    }

    const { container } = render(<TestHarness initialValue={[existingImage]} />)
    const fileInputs = container.querySelectorAll('input[type="file"]')

    fireEvent.change(fileInputs[0], {
      target: {
        files: [new File(['img-1'], 'nueva-1.jpg', { type: 'image/jpeg' })],
      },
    })

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('2'))

    const replaceButtons = screen.getAllByRole('button', { name: /reemplazar/i })
    fireEvent.click(replaceButtons[0])
    fireEvent.change(fileInputs[1], {
      target: {
        files: [new File(['img-2'], 'reemplazo.png', { type: 'image/png' })],
      },
    })

    await waitFor(() => expect(screen.getByTestId('first-name')).toHaveTextContent('reemplazo.png'))

    const deleteButtons = screen.getAllByRole('button', { name: /eliminar/i })
    fireEvent.click(deleteButtons[1])

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'))
  })

  it('muestra error cuando se intenta subir un formato invalido', async () => {
    const { container } = render(<TestHarness />)
    const fileInputs = container.querySelectorAll('input[type="file"]')

    fireEvent.change(fileInputs[0], {
      target: {
        files: [new File(['txt'], 'nota.txt', { type: 'text/plain' })],
      },
    })

    await waitFor(() => expect(screen.getByText(/no es compatible/i)).toBeInTheDocument())
  })
})
