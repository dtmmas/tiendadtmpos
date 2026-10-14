import React, { useRef, useState } from 'react'
import CameraCaptureButton from './CameraCaptureButton'
import { resolveUploadedAssetUrl } from '../utils/assets'
import {
  PRODUCT_IMAGE_ACCEPT,
  PRODUCT_IMAGE_LIMIT,
  ProductImageDraft,
  createProductImageDraft,
  createProductImageDrafts,
  validateProductImageFiles,
} from './productImageManagerUtils'

type Props = {
  value: ProductImageDraft[]
  onChange: (nextValue: ProductImageDraft[]) => void
  uploadProgress?: number | null
}

export default function ProductImageManager({ value, onChange, uploadProgress = null }: Props) {
  const addInputRef = useRef<HTMLInputElement | null>(null)
  const replaceIndexRef = useRef<number | null>(null)
  const replaceInputRef = useRef<HTMLInputElement | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  async function addFiles(files: FileList | File[] | null) {
    const nextFiles = Array.from(files || [])
    if (nextFiles.length === 0) return

    const nextErrors = validateProductImageFiles(nextFiles, value.length + nextFiles.length)
    if (nextErrors.length > 0) {
      setErrors(nextErrors)
      return
    }

    setBusy(true)
    try {
      const drafts = await createProductImageDrafts(nextFiles)
      onChange([...value, ...drafts].slice(0, PRODUCT_IMAGE_LIMIT))
      setErrors([])
    } catch (error: any) {
      setErrors([error?.message || 'No se pudieron preparar las imagenes seleccionadas.'])
    } finally {
      setBusy(false)
      if (addInputRef.current) addInputRef.current.value = ''
    }
  }

  async function replaceFile(file: File | null) {
    const targetIndex = replaceIndexRef.current
    replaceIndexRef.current = null
    if (!file || targetIndex === null || targetIndex < 0 || targetIndex >= value.length) {
      if (replaceInputRef.current) replaceInputRef.current.value = ''
      return
    }

    const nextErrors = validateProductImageFiles([file], value.length)
    if (nextErrors.length > 0) {
      setErrors(nextErrors)
      if (replaceInputRef.current) replaceInputRef.current.value = ''
      return
    }

    setBusy(true)
    try {
      const replacement = await createProductImageDraft(file)
      const next = value.map((item, index) => (index === targetIndex ? replacement : item))
      onChange(next)
      setErrors([])
    } catch (error: any) {
      setErrors([error?.message || 'No se pudo reemplazar la imagen seleccionada.'])
    } finally {
      setBusy(false)
      if (replaceInputRef.current) replaceInputRef.current.value = ''
    }
  }

  async function handleCapturedImage(file: File) {
    await addFiles([file])
  }

  function removeImage(index: number) {
    onChange(value.filter((_, itemIndex) => itemIndex !== index))
    setErrors([])
  }

  function openReplacePicker(index: number) {
    replaceIndexRef.current = index
    replaceInputRef.current?.click()
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div
        onDragEnter={(event) => {
          event.preventDefault()
          setDragActive(true)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={(event) => {
          event.preventDefault()
          if (event.currentTarget === event.target) setDragActive(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragActive(false)
          void addFiles(event.dataTransfer?.files || null)
        }}
        style={{
          border: `2px dashed ${dragActive ? '#2563eb' : 'var(--border)'}`,
          background: dragActive ? 'rgba(37,99,235,0.08)' : 'linear-gradient(180deg, var(--bg), var(--surface))',
          borderRadius: 22,
          padding: 18,
          display: 'grid',
          gap: 12,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 18 }}>Fotografias del producto</div>
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>
          Arrastra imagenes aqui o usa los botones para agregar hasta {PRODUCT_IMAGE_LIMIT} fotos. La primera quedara como imagen principal.
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="primary-btn" onClick={() => addInputRef.current?.click()} disabled={busy || value.length >= PRODUCT_IMAGE_LIMIT}>
            Agregar imagenes
          </button>
          <CameraCaptureButton
            onCapture={handleCapturedImage}
            modalTitle="Capturar imagen del producto"
            buttonTitle="Tomar foto del producto"
            fileNamePrefix="producto"
          />
          <div style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>
            JPG, PNG o WebP. Maximo 5 MB por archivo.
          </div>
        </div>
        <input
          ref={addInputRef}
          type="file"
          accept={PRODUCT_IMAGE_ACCEPT}
          multiple
          onChange={event => void addFiles(event.target.files)}
          style={{ display: 'none' }}
        />
        <input
          ref={replaceInputRef}
          type="file"
          accept={PRODUCT_IMAGE_ACCEPT}
          onChange={event => void replaceFile(event.target.files?.[0] || null)}
          style={{ display: 'none' }}
        />
      </div>

      {uploadProgress !== null && (
        <div style={{ borderRadius: 16, border: '1px solid var(--border)', padding: 12, background: 'var(--modal)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, marginBottom: 8 }}>
            <span>Subiendo imagenes...</span>
            <strong>{uploadProgress}%</strong>
          </div>
          <div style={{ height: 10, borderRadius: 999, background: 'rgba(148,163,184,0.18)', overflow: 'hidden' }}>
            <div style={{ width: `${uploadProgress}%`, height: '100%', background: 'linear-gradient(90deg, #2563eb, #38bdf8)' }} />
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div style={{ borderRadius: 16, border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.08)', color: '#991b1b', padding: 12, display: 'grid', gap: 4 }}>
          {errors.map(error => (
            <div key={error} style={{ fontSize: 12 }}>{error}</div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        {value.map((image, index) => {
          const imageSource = image.isExisting ? resolveUploadedAssetUrl(image.imageUrl || image.previewUrl) : image.previewUrl
          return (
            <div key={`${image.id || image.fileName}-${index}`} style={{ border: '1px solid var(--border)', borderRadius: 18, overflow: 'hidden', background: 'var(--surface)', display: 'grid' }}>
              <div style={{ position: 'relative', height: 170, background: 'var(--bg)' }}>
                <img src={imageSource} alt={`Producto ${index + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                {index === 0 && (
                  <div style={{ position: 'absolute', top: 10, left: 10, padding: '6px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: 'rgba(37,99,235,0.9)', color: '#fff' }}>
                    Principal
                  </div>
                )}
              </div>
              <div style={{ padding: 12, display: 'grid', gap: 10 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', wordBreak: 'break-word' }}>{image.fileName || `Imagen ${index + 1}`}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="secondary-btn" onClick={() => openReplacePicker(index)} disabled={busy}>
                    Reemplazar
                  </button>
                  <button type="button" className="secondary-btn" onClick={() => removeImage(index)} disabled={busy}>
                    Eliminar
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {value.length === 0 && (
        <div style={{ borderRadius: 18, border: '1px dashed var(--border)', padding: 18, color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>
          No hay fotografias cargadas todavia.
        </div>
      )}
    </div>
  )
}
