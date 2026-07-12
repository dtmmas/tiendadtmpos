import { useEffect, useMemo, useRef, useState } from 'react'

type CameraCaptureButtonProps = {
  onCapture: (file: File) => void
  disabled?: boolean
  buttonLabel?: string
  buttonTitle?: string
  modalTitle?: string
  fileNamePrefix?: string
}

type VideoInputDevice = {
  deviceId: string
  label: string
}

function hasCameraSupport() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
  return Boolean(navigator.mediaDevices?.getUserMedia)
}

function pickPreferredDevice(devices: VideoInputDevice[]) {
  return devices.find(device => /back|rear|environment|trasera|traseira/i.test(device.label))
    || devices[0]
    || null
}

async function getVideoDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter(device => device.kind === 'videoinput')
    .map(device => ({
      deviceId: device.deviceId,
      label: device.label || 'Camara'
    }))
}

async function blobFromCanvas(canvas: HTMLCanvasElement) {
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
      } else {
        reject(new Error('No se pudo capturar la imagen'))
      }
    }, 'image/jpeg', 0.92)
  })
}

export default function CameraCaptureButton({
  onCapture,
  disabled = false,
  buttonLabel = 'Tomar foto',
  buttonTitle = 'Capturar imagen desde camara',
  modalTitle = 'Capturar imagen',
  fileNamePrefix = 'captura',
}: CameraCaptureButtonProps) {
  const isSupported = useMemo(() => hasCameraSupport(), [])
  const [isOpen, setIsOpen] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [isCapturing, setIsCapturing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [devices, setDevices] = useState<VideoInputDevice[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [capturedFile, setCapturedFile] = useState<File | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    if (!isOpen) {
      stopCamera()
      setPreviewUrl(null)
      setCapturedFile(null)
      setError(null)
      return
    }

    let cancelled = false

    const start = async () => {
      setIsStarting(true)
      setError(null)
      try {
        await startCamera(selectedDeviceId)
        const nextDevices = await getVideoDevices()
        if (cancelled) return
        setDevices(nextDevices)
        if (!selectedDeviceId) {
          const preferred = pickPreferredDevice(nextDevices)
          if (preferred && preferred.deviceId) {
            setSelectedDeviceId(preferred.deviceId)
          }
        }
      } catch (cameraError: any) {
        if (!cancelled) {
          setError(cameraError?.message || 'No se pudo abrir la camara')
        }
      } finally {
        if (!cancelled) {
          setIsStarting(false)
        }
      }
    }

    void start()

    return () => {
      cancelled = true
      stopCamera()
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !selectedDeviceId || previewUrl) return
    void startCamera(selectedDeviceId).catch((cameraError: any) => {
      setError(cameraError?.message || 'No se pudo cambiar de camara')
    })
  }, [selectedDeviceId, isOpen, previewUrl])

  const stopCamera = () => {
    const stream = streamRef.current
    if (stream) {
      stream.getTracks().forEach(track => track.stop())
    }
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }

  const startCamera = async (deviceId?: string) => {
    stopCamera()

    const constraints: MediaStreamConstraints = {
      audio: false,
      video: deviceId
        ? { deviceId: { exact: deviceId } }
        : { facingMode: { ideal: 'environment' } }
    }

    const stream = await navigator.mediaDevices.getUserMedia(constraints)
    streamRef.current = stream
    if (videoRef.current) {
      videoRef.current.srcObject = stream
      await videoRef.current.play()
    }
  }

  const handleCapture = async () => {
    if (!videoRef.current) return
    try {
      setIsCapturing(true)
      setError(null)
      const video = videoRef.current
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth || 1280
      canvas.height = video.videoHeight || 720
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('No se pudo preparar la captura')
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const blob = await blobFromCanvas(canvas)
      const file = new File(
        [blob],
        `${fileNamePrefix}-${Date.now()}.jpg`,
        { type: 'image/jpeg' }
      )
      setPreviewUrl(canvas.toDataURL('image/jpeg', 0.92))
      setCapturedFile(file)
      stopCamera()
    } catch (captureError: any) {
      setError(captureError?.message || 'No se pudo capturar la foto')
    } finally {
      setIsCapturing(false)
    }
  }

  const handleRetake = async () => {
    setPreviewUrl(null)
    setCapturedFile(null)
    setError(null)
    try {
      setIsStarting(true)
      await startCamera(selectedDeviceId)
    } catch (cameraError: any) {
      setError(cameraError?.message || 'No se pudo reabrir la camara')
    } finally {
      setIsStarting(false)
    }
  }

  const handleUsePhoto = () => {
    if (!capturedFile) return
    onCapture(capturedFile)
    setIsOpen(false)
  }

  if (!isSupported) {
    return null
  }

  return (
    <>
      <button
        type="button"
        className="icon-btn"
        title={buttonTitle}
        aria-label={buttonTitle}
        disabled={disabled}
        onClick={() => setIsOpen(true)}
        style={{ width: 'auto', padding: '0 14px', whiteSpace: 'nowrap' }}
      >
        Tomar foto
      </button>

      {isOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1200,
            padding: 16
          }}
        >
          <div
            className="responsive-modal"
            style={{
              width: 'min(720px, 96vw)',
              background: 'var(--modal)',
              border: '1px solid var(--border)',
              borderRadius: 18,
              padding: 18,
              display: 'grid',
              gap: 14
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>{modalTitle}</div>
                <div style={{ color: 'var(--muted)', fontSize: 12 }}>
                  Funciona con camara del telefono o webcam USB.
                </div>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setIsOpen(false)}
                style={{ width: 'auto', padding: '0 14px' }}
              >
                Cerrar
              </button>
            </div>

            {devices.length > 1 && !previewUrl && (
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Camara</label>
                <select
                  value={selectedDeviceId}
                  onChange={e => setSelectedDeviceId(e.target.value)}
                  style={{ width: '100%' }}
                >
                  {devices.map(device => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div
              style={{
                borderRadius: 16,
                overflow: 'hidden',
                border: '1px solid var(--border)',
                background: '#0f172a',
                minHeight: 260,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              {previewUrl ? (
                <img src={previewUrl} alt="Captura previa" style={{ width: '100%', maxHeight: '70vh', objectFit: 'contain' }} />
              ) : (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{ width: '100%', maxHeight: '70vh', objectFit: 'contain' }}
                />
              )}
            </div>

            {error && (
              <div style={{ color: '#ef4444', fontSize: 13 }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
              {!previewUrl ? (
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => void handleCapture()}
                  disabled={disabled || isStarting || isCapturing}
                >
                  {isStarting ? 'Abriendo camara...' : isCapturing ? 'Capturando...' : 'Capturar foto'}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => void handleRetake()}
                    style={{ width: 'auto', padding: '0 14px' }}
                  >
                    Volver a tomar
                  </button>
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={handleUsePhoto}
                    disabled={!capturedFile}
                  >
                    Usar foto
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
