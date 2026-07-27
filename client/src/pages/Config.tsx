import { useEffect, useMemo, useState } from 'react'
import type { AxiosProgressEvent } from 'axios'
import { api } from '../api'
import { useAuthStore } from '../store/auth'
import { useConfigStore } from '../store/config'
import { getWarehouseHighlightStyle } from '../utils/warehouseHighlight'

interface TrackedInventoryAuditDifference {
  warehouseId: number
  warehouseName: string
  stockQty: number
  trackedQty: number
  trackedItems?: string
}

interface TrackedInventoryAuditItem {
  productId: number
  productType: string
  productCode?: string
  sku?: string
  name: string
  differences: TrackedInventoryAuditDifference[]
}

interface TrackedInventoryAuditResponse {
  generatedAt: string
  productCount: number
  mismatchCount: number
  mismatches: TrackedInventoryAuditItem[]
}

interface TrackedInventoryAutoCorrectedItem {
  productId: number
  productType: string
  productCode?: string
  sku?: string
  name: string
  targetWarehouseId: number
  targetWarehouseName: string
  movedCount: number
  trackedItems: string[]
}

interface TrackedInventoryAutoCorrectSkippedItem {
  productId: number
  productCode?: string
  sku?: string
  name: string
  reason: string
}

interface TrackedInventoryAutoCorrectResponse {
  generatedAt: string
  correctedCount: number
  skippedCount: number
  corrected: TrackedInventoryAutoCorrectedItem[]
  skipped: TrackedInventoryAutoCorrectSkippedItem[]
  auditAfter: TrackedInventoryAuditResponse
}

interface RestoreBackupResponse {
  ok: boolean
  message: string
  restored: {
    database: boolean
    uploads: boolean
    config: boolean
  }
  safetyBackup?: {
    archiveName: string
    archivePath: string
  }
}

interface TransferProgressState {
  loaded: number
  total: number | null
  percent: number | null
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  const digits = size >= 10 || unitIndex === 0 ? 0 : 1
  return `${size.toFixed(digits)} ${units[unitIndex]}`
}

function buildTransferProgress(event?: AxiosProgressEvent): TransferProgressState {
  const loaded = Math.max(0, Number(event?.loaded || 0))
  const total = Number(event?.total || 0) > 0 ? Number(event?.total) : null
  const percent = total ? Math.min(100, Math.round((loaded / total) * 100)) : null

  return {
    loaded,
    total,
    percent
  }
}

function ProgressBar({
  title,
  progress,
  active
}: {
  title: string
  progress: TransferProgressState | null
  active: boolean
}) {
  if (!active && !progress) return null

  const percent = progress?.percent ?? (active ? 10 : 0)
  const safePercent = Math.max(0, Math.min(100, percent))
  const label = progress?.percent != null
    ? `${progress.percent}% completado`
    : active
      ? 'Calculando progreso...'
      : 'Listo'
  const details = progress
    ? progress.total
      ? `${formatBytes(progress.loaded)} de ${formatBytes(progress.total)}`
      : progress.loaded > 0
        ? `${formatBytes(progress.loaded)} transferidos`
        : ''
    : ''

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
        <span>{title}</span>
        <span>{label}</span>
      </div>
      <div style={{ width: '100%', height: 10, borderRadius: 999, overflow: 'hidden', background: 'var(--border)' }}>
        <div
          style={{
            width: `${safePercent}%`,
            height: '100%',
            background: 'linear-gradient(90deg, #2563eb, #06b6d4)',
            transition: 'width 0.2s ease'
          }}
        />
      </div>
      {details && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
          {details}
        </div>
      )}
    </div>
  )
}

export default function Config() {
  const { config, fetchConfig } = useConfigStore()
  const user = useAuthStore(s => s.user)
  const isAdmin = String(user?.role || '').toUpperCase() === 'ADMIN'
  const [isMobileViewport, setIsMobileViewport] = useState(false)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [logoUrl, setLogoUrl] = useState('')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [downloadingBackup, setDownloadingBackup] = useState(false)
  const [downloadingFullBackup, setDownloadingFullBackup] = useState(false)
  const [downloadBackupProgress, setDownloadBackupProgress] = useState<TransferProgressState | null>(null)
  const [downloadFullBackupProgress, setDownloadFullBackupProgress] = useState<TransferProgressState | null>(null)
  const [sqlRestoreFile, setSqlRestoreFile] = useState<File | null>(null)
  const [fullRestoreFile, setFullRestoreFile] = useState<File | null>(null)
  const [restoringSqlBackup, setRestoringSqlBackup] = useState(false)
  const [restoringFullBackup, setRestoringFullBackup] = useState(false)
  const [restoreSqlBackupProgress, setRestoreSqlBackupProgress] = useState<TransferProgressState | null>(null)
  const [restoreFullBackupProgress, setRestoreFullBackupProgress] = useState<TransferProgressState | null>(null)
  const [lastRestoreResult, setLastRestoreResult] = useState<RestoreBackupResponse | null>(null)
  const [runningTrackedAudit, setRunningTrackedAudit] = useState(false)
  const [runningTrackedAutoCorrect, setRunningTrackedAutoCorrect] = useState(false)
  const [trackedAudit, setTrackedAudit] = useState<TrackedInventoryAuditResponse | null>(null)
  const [trackedAutoCorrect, setTrackedAutoCorrect] = useState<TrackedInventoryAutoCorrectResponse | null>(null)

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  useEffect(() => {
    if (config) {
      setName(config.name)
      setCurrency(config.currency)
      setLogoUrl(config.logoUrl || '')
    }
  }, [config])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 768px)')
    const syncViewport = () => setIsMobileViewport(mediaQuery.matches)
    syncViewport()
    mediaQuery.addEventListener('change', syncViewport)
    return () => mediaQuery.removeEventListener('change', syncViewport)
  }, [])

  const logoPreview = useMemo(() => {
    if (logoFile) return URL.createObjectURL(logoFile)
    return logoUrl || ''
  }, [logoFile, logoUrl])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const fd = new FormData()
      fd.append('name', name)
      fd.append('currency', currency)
      if (logoFile) fd.append('logo', logoFile)
      else if (logoUrl) fd.append('logoUrl', logoUrl)
      await api.put('/config', fd)
      await fetchConfig()
      alert('Configuración guardada')
      setLogoFile(null)
    } finally {
      setSaving(false)
    }
  }

  const downloadFile = async (
    url: string,
    fallbackFilename: string,
    defaultError: string,
    setProgress: (value: TransferProgressState | null) => void
  ) => {
    try {
      setProgress({ loaded: 0, total: null, percent: 0 })
      const response = await api.get(url, {
        responseType: 'blob',
        onDownloadProgress: (event) => {
          setProgress(buildTransferProgress(event))
        }
      })
      const blob = new Blob([response.data], { type: String(response.headers?.['content-type'] || 'application/octet-stream') })
      const downloadUrl = URL.createObjectURL(blob)
      const contentDisposition = String(response.headers?.['content-disposition'] || '')
      const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/)
      const filename = filenameMatch?.[1] || fallbackFilename
      setProgress({
        loaded: blob.size,
        total: blob.size || null,
        percent: 100
      })

      const anchor = document.createElement('a')
      anchor.href = downloadUrl
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(downloadUrl)
    } catch (err: any) {
      console.error(err)
      let errorMessage = defaultError

      try {
        const data = err?.response?.data
        if (data instanceof Blob) {
          const text = await data.text()
          try {
            const parsed = JSON.parse(text)
            errorMessage = parsed?.error || parsed?.message || text || errorMessage
          } catch {
            errorMessage = text || errorMessage
          }
        } else if (typeof data === 'string' && data.trim()) {
          errorMessage = data
        } else if (data?.error) {
          errorMessage = data.error
        }
      } catch {
        // noop
      }

      alert(errorMessage)
    }
  }

  const downloadBackup = async () => {
    setDownloadingBackup(true)
    try {
      await downloadFile('/config/backup', `backup-${Date.now()}.sql`, 'No se pudo generar el backup SQL', setDownloadBackupProgress)
    } finally {
      setDownloadingBackup(false)
    }
  }

  const downloadFullBackup = async () => {
    setDownloadingFullBackup(true)
    try {
      await downloadFile('/config/backup/full', `backup-completo-${Date.now()}.tar.gz`, 'No se pudo generar el backup completo', setDownloadFullBackupProgress)
    } finally {
      setDownloadingFullBackup(false)
    }
  }

  const restoreBackupFile = async ({
    file,
    endpoint,
    defaultError,
    confirmMessage,
    setProgress
  }: {
    file: File | null
    endpoint: string
    defaultError: string
    confirmMessage: string
    setProgress: (value: TransferProgressState | null) => void
  }) => {
    if (!file) {
      alert('Debes seleccionar un archivo antes de restaurar')
      return null
    }

    const confirmed = window.confirm(confirmMessage)
    if (!confirmed) return null

    try {
      const fd = new FormData()
      fd.append('backup', file)
      setProgress({
        loaded: 0,
        total: file.size || null,
        percent: file.size ? 0 : null
      })
      const response = await api.post(endpoint, fd, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        onUploadProgress: (event) => {
          setProgress(buildTransferProgress(event))
        }
      })

      setProgress({
        loaded: file.size || 0,
        total: file.size || null,
        percent: 100
      })
      const result = response.data as RestoreBackupResponse
      setLastRestoreResult(result)
      await fetchConfig()
      return result
    } catch (err: any) {
      console.error(err)
      let errorMessage = defaultError
      if (err?.response?.data?.error) {
        errorMessage = err.response.data.error
      }
      alert(errorMessage)
      return null
    }
  }

  const restoreSqlBackup = async () => {
    setRestoringSqlBackup(true)
    try {
      const result = await restoreBackupFile({
        file: sqlRestoreFile,
        endpoint: '/config/backup/restore/sql',
        defaultError: 'No se pudo restaurar el backup SQL',
        confirmMessage: 'Se restaurará la base de datos desde el archivo SQL seleccionado. Antes de continuar, el sistema generará un backup de seguridad. Deseas continuar?',
        setProgress: setRestoreSqlBackupProgress
      })

      if (result?.ok) {
        alert(`${result.message}. Backup de seguridad creado: ${result.safetyBackup?.archiveName || 'si'}`)
        setSqlRestoreFile(null)
      }
    } finally {
      setRestoringSqlBackup(false)
    }
  }

  const restoreFullBackup = async () => {
    setRestoringFullBackup(true)
    try {
      const result = await restoreBackupFile({
        file: fullRestoreFile,
        endpoint: '/config/backup/restore/full',
        defaultError: 'No se pudo restaurar el backup completo',
        confirmMessage: 'Se restaurará la base de datos, uploads y config.json desde el backup completo seleccionado. Antes de continuar, el sistema generará un backup de seguridad. Deseas continuar?',
        setProgress: setRestoreFullBackupProgress
      })

      if (result?.ok) {
        alert(`${result.message}. Backup de seguridad creado: ${result.safetyBackup?.archiveName || 'si'}`)
        setFullRestoreFile(null)
      }
    } finally {
      setRestoringFullBackup(false)
    }
  }

  const runTrackedInventoryAudit = async () => {
    setRunningTrackedAudit(true)
    try {
      const response = await api.get('/config/audit/tracked-inventory')
      setTrackedAudit(response.data as TrackedInventoryAuditResponse)
      setTrackedAutoCorrect(null)
      if (Number(response.data?.mismatchCount || 0) === 0) {
        alert('No se detectaron inconsistencias entre stock y series/IMEI disponibles')
      }
    } catch (err: any) {
      console.error(err)
      alert(err?.response?.data?.error || 'No se pudo ejecutar la auditoria de series e IMEI')
    } finally {
      setRunningTrackedAudit(false)
    }
  }

  const runTrackedInventoryAutoCorrect = async () => {
    const confirmed = window.confirm('Se intentaran corregir solo los casos faciles y seguros de series e IMEI. Deseas continuar?')
    if (!confirmed) return

    setRunningTrackedAutoCorrect(true)
    try {
      const response = await api.post('/config/audit/tracked-inventory/autocorrect')
      const result = response.data as TrackedInventoryAutoCorrectResponse
      setTrackedAutoCorrect(result)
      setTrackedAudit(result.auditAfter)

      if (Number(result.correctedCount || 0) === 0 && Number(result.skippedCount || 0) === 0) {
        alert('No se detectaron inconsistencias para autocorregir')
      } else if (Number(result.correctedCount || 0) === 0) {
        alert('No se realizaron correcciones automaticas. Revisa los casos omitidos.')
      } else {
        alert(`Autocorreccion completada. Casos corregidos: ${result.correctedCount}`)
      }
    } catch (err: any) {
      console.error(err)
      alert(err?.response?.data?.error || 'No se pudo autocorregir los casos faciles de series e IMEI')
    } finally {
      setRunningTrackedAutoCorrect(false)
    }
  }

  return (
    <div style={{ padding: isMobileViewport ? 12 : 20, width: '100%', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', maxWidth: 1280, margin: '0 auto', display: 'grid', gap: 20 }}>
        <div style={{ background: 'linear-gradient(180deg, var(--modal), var(--card))', border: '1px solid var(--border)', borderRadius: 16, padding: isMobileViewport ? 16 : 20 }}>
          <h2 style={{ margin: 0 }}>Configuración del sistema</h2>
          <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>
            Centraliza identidad visual, respaldos y herramientas administrativas del sistema.
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 20 }}>
          <div style={{ background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 16, padding: isMobileViewport ? 16 : 20 }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 18 }}>Información general</div>
              <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                Ajusta nombre comercial, moneda base e imagen principal del sistema.
              </div>
            </div>

            <form onSubmit={save} style={{ display: 'grid', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: isMobileViewport ? '1fr' : 'minmax(0, 1.1fr) minmax(280px, 0.9fr)', gap: 16, alignItems: 'start' }}>
                <div style={{ display: 'grid', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Nombre</label>
                    <input value={name} onChange={e=>setName(e.target.value)} required style={{ width: '100%', boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Moneda</label>
                    <input value={currency} onChange={e=>setCurrency(e.target.value)} required style={{ width: '100%', boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Subir nuevo logo</label>
                    <input type="file" accept="image/*" onChange={(e)=> setLogoFile(e.target.files?.[0] || null)} style={{ width: '100%' }} />
                    {logoFile && <div className="file-name" style={{ marginTop: 4 }}>{logoFile.name}</div>}
                    <small style={{ color: 'var(--muted)', display: 'block', marginTop: 6 }}>Opcional: también puedes usar una URL.</small>
                    <input placeholder="Logo URL" value={logoUrl} onChange={e=>setLogoUrl(e.target.value)} style={{ width: '100%', marginTop: 6, padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'inherit', boxSizing: 'border-box' }} />
                  </div>
                </div>

                <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 14, background: 'var(--bg)', minHeight: isMobileViewport ? 'auto' : 220, display: 'grid', alignContent: 'start', gap: 10 }}>
                  <div style={{ fontWeight: 600 }}>Vista previa del logo</div>
                  {logoPreview ? (
                    <img src={logoPreview} alt="logo" style={{ width: '100%', maxWidth: 220, height: isMobileViewport ? 140 : 180, objectFit: 'contain', display: 'block', border: '1px solid var(--border)', borderRadius: 10, padding: 8, background: 'var(--modal)' }} />
                  ) : (
                    <div style={{ border: '1px dashed var(--border)', borderRadius: 10, padding: 20, color: 'var(--muted)', textAlign: 'center' }}>
                      Aún no hay logo configurado.
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    La vista previa usa el archivo local seleccionado o el logo actual guardado.
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: isMobileViewport ? 'stretch' : 'flex-end', marginTop: 4 }}>
                <button type="submit" className="primary-btn" style={{ width: isMobileViewport ? '100%' : 'auto' }} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
              </div>
            </form>
          </div>

          {isAdmin && (
          <div style={{ display: 'grid', gap: 20 }}>
            <div style={{ background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 16, padding: isMobileViewport ? 16 : 20 }}>
              <h3 style={{ marginTop: 0, marginBottom: 10 }}>Backups del sistema</h3>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
                Descarga respaldos SQL o completos, y ejecuta herramientas de auditoría para inventario serializado.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobileViewport ? '1fr' : 'repeat(2, minmax(220px, 1fr))', gap: 10 }}>
                <button type="button" className="secondary-btn" onClick={downloadBackup} style={{ width: '100%' }} disabled={downloadingBackup || downloadingFullBackup}>
                  {downloadingBackup ? 'Generando backup SQL...' : 'Descargar backup SQL'}
                </button>
                <button type="button" className="primary-btn" onClick={downloadFullBackup} style={{ width: '100%' }} disabled={downloadingBackup || downloadingFullBackup}>
                  {downloadingFullBackup ? 'Generando backup completo...' : 'Descargar backup completo'}
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={runTrackedInventoryAudit}
                  style={{ width: '100%' }}
                  disabled={downloadingBackup || downloadingFullBackup || runningTrackedAudit || runningTrackedAutoCorrect}
                >
                  {runningTrackedAudit ? 'Auditando series e IMEI...' : 'Auditar series e IMEI'}
                </button>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={runTrackedInventoryAutoCorrect}
                  style={{ width: '100%' }}
                  disabled={downloadingBackup || downloadingFullBackup || runningTrackedAudit || runningTrackedAutoCorrect}
                >
                  {runningTrackedAutoCorrect ? 'Autocorrigiendo casos faciles...' : 'Autocorregir casos faciles'}
                </button>
              </div>
              <ProgressBar
                title="Descargar backup SQL"
                progress={downloadBackupProgress}
                active={downloadingBackup}
              />
              <ProgressBar
                title="Descargar backup completo"
                progress={downloadFullBackupProgress}
                active={downloadingFullBackup}
              />
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
                El backup completo incluye `database.sql`, carpeta `uploads` y `config.json`, para restaurar también las imágenes del sistema.
              </div>
            </div>

            <div style={{ background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 16, padding: isMobileViewport ? 16 : 20 }}>
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 6 }}>Restaurar backup</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
                Antes de aplicar el archivo seleccionado, el sistema crea automáticamente un backup de seguridad del estado actual.
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isMobileViewport ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
                <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, background: 'var(--bg)' }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Restaurar solo base de datos</div>
                  <input
                    type="file"
                    accept=".sql"
                    onChange={e => setSqlRestoreFile(e.target.files?.[0] || null)}
                    disabled={restoringSqlBackup || restoringFullBackup}
                    style={{ width: '100%' }}
                  />
                  {sqlRestoreFile && (
                    <div className="file-name" style={{ marginTop: 6 }}>{sqlRestoreFile.name}</div>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                    Usa un archivo `.sql` generado por el sistema si solo quieres restaurar la base de datos.
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      className="secondary-btn"
                      style={{ width: isMobileViewport ? '100%' : 'auto' }}
                      onClick={restoreSqlBackup}
                      disabled={!sqlRestoreFile || restoringSqlBackup || restoringFullBackup || downloadingBackup || downloadingFullBackup}
                    >
                      {restoringSqlBackup ? 'Restaurando backup SQL...' : 'Restaurar backup SQL'}
                    </button>
                    <ProgressBar
                      title="Cargar backup SQL"
                      progress={restoreSqlBackupProgress}
                      active={restoringSqlBackup}
                    />
                  </div>
                </div>

                <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, background: 'var(--bg)' }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Restaurar backup completo</div>
                  <input
                    type="file"
                    accept=".tar.gz,.tgz"
                    onChange={e => setFullRestoreFile(e.target.files?.[0] || null)}
                    disabled={restoringSqlBackup || restoringFullBackup}
                    style={{ width: '100%' }}
                  />
                  {fullRestoreFile && (
                    <div className="file-name" style={{ marginTop: 6 }}>{fullRestoreFile.name}</div>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                    Usa un `.tar.gz` o `.tgz` generado por el backup completo para restaurar base de datos, imágenes y configuración.
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      className="primary-btn"
                      style={{ width: isMobileViewport ? '100%' : 'auto' }}
                      onClick={restoreFullBackup}
                      disabled={!fullRestoreFile || restoringSqlBackup || restoringFullBackup || downloadingBackup || downloadingFullBackup}
                    >
                      {restoringFullBackup ? 'Restaurando backup completo...' : 'Restaurar backup completo'}
                    </button>
                    <ProgressBar
                      title="Cargar backup completo"
                      progress={restoreFullBackupProgress}
                      active={restoringFullBackup}
                    />
                  </div>
                </div>
              </div>

              {lastRestoreResult && (
                <div style={{ marginTop: 14, border: '1px solid var(--border)', borderRadius: 12, padding: 12, background: 'var(--card)' }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Última restauración</div>
                  <div style={{ fontSize: 13 }}>{lastRestoreResult.message}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                    Base de datos: {lastRestoreResult.restored.database ? 'sí' : 'no'} | Uploads: {lastRestoreResult.restored.uploads ? 'sí' : 'no'} | Config: {lastRestoreResult.restored.config ? 'sí' : 'no'}
                  </div>
                  {lastRestoreResult.safetyBackup?.archiveName && (
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                      Backup de seguridad: {lastRestoreResult.safetyBackup.archiveName}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ background: 'var(--modal)', border: '1px solid var(--border)', borderRadius: 16, padding: isMobileViewport ? 16 : 20 }}>
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 6 }}>Control de series e IMEI</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                La autocorrección solo mueve series o IMEI `AVAILABLE` cuando todo el stock positivo del producto está concentrado en un solo almacén y la cantidad coincide exactamente.
              </div>

              {trackedAudit && (
                <div style={{ marginTop: 6, padding: 14, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg)' }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Auditoría de series e IMEI</div>
                  <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>
                    Generada: {new Date(trackedAudit.generatedAt).toLocaleString()} | Productos revisados: {trackedAudit.productCount} | Inconsistencias: {trackedAudit.mismatchCount}
                  </div>

                  {trackedAudit.mismatchCount === 0 ? (
                    <div style={{ fontSize: 13 }}>No se detectaron inconsistencias entre stock y series/IMEI disponibles.</div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: isMobileViewport ? '1fr' : 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
                      {trackedAudit.mismatches.map(item => (
                        <div key={item.productId} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, background: 'var(--card)' }}>
                          <div style={{ fontWeight: 600 }}>{item.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                            {item.productCode ? `COD: ${item.productCode}` : 'Sin codigo'} | {item.sku ? `SKU: ${item.sku}` : 'Sin SKU'} | Tipo: {item.productType}
                          </div>
                          <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                            {item.differences.map(diff => (
                              <div key={`${item.productId}-${diff.warehouseId}`} style={{ fontSize: 13 }}>
                                <span className="warehouse-highlight" style={getWarehouseHighlightStyle(diff.warehouseName)}>{diff.warehouseName}</span>: stock {diff.stockQty} | disponibles {diff.trackedQty}
                                {diff.trackedItems ? ` | ${diff.trackedItems}` : ''}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {trackedAutoCorrect && (
                <div style={{ marginTop: 16, padding: 14, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg)' }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Resultado de autocorrección</div>
                  <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>
                    Ejecutada: {new Date(trackedAutoCorrect.generatedAt).toLocaleString()} | Corregidos: {trackedAutoCorrect.correctedCount} | Omitidos: {trackedAutoCorrect.skippedCount} | Inconsistencias restantes: {trackedAutoCorrect.auditAfter.mismatchCount}
                  </div>

                  {trackedAutoCorrect.corrected.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontWeight: 600, marginBottom: 8 }}>Casos corregidos</div>
                      <div style={{ display: 'grid', gridTemplateColumns: isMobileViewport ? '1fr' : 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
                        {trackedAutoCorrect.corrected.map(item => (
                          <div key={item.productId} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, background: 'var(--card)' }}>
                            <div style={{ fontWeight: 600 }}>{item.name}</div>
                            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                              {item.productCode ? `COD: ${item.productCode}` : 'Sin codigo'} | {item.sku ? `SKU: ${item.sku}` : 'Sin SKU'} | Tipo: {item.productType}
                            </div>
                            <div style={{ fontSize: 13, marginTop: 8 }}>
                              Movidos: {item.movedCount} | Destino: {item.targetWarehouseName}
                            </div>
                            {item.trackedItems.length > 0 && (
                              <div style={{ fontSize: 13, marginTop: 6, wordBreak: 'break-word' }}>
                                {item.trackedItems.join(', ')}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {trackedAutoCorrect.skipped.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontWeight: 600, marginBottom: 8 }}>Casos omitidos</div>
                      <div style={{ display: 'grid', gridTemplateColumns: isMobileViewport ? '1fr' : 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
                        {trackedAutoCorrect.skipped.map(item => (
                          <div key={item.productId} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, background: 'var(--card)' }}>
                            <div style={{ fontWeight: 600 }}>{item.name}</div>
                            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                              {item.productCode ? `COD: ${item.productCode}` : 'Sin codigo'} | {item.sku ? `SKU: ${item.sku}` : 'Sin SKU'}
                            </div>
                            <div style={{ fontSize: 13, marginTop: 8 }}>{item.reason}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {trackedAutoCorrect.corrected.length === 0 && trackedAutoCorrect.skipped.length === 0 && (
                    <div style={{ fontSize: 13 }}>No hubo inconsistencias que requirieran autocorrección.</div>
                  )}
                </div>
              )}
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  )
}
