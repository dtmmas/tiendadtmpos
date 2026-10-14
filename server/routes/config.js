import express from 'express'
import fs from 'fs'
import os from 'os'
import path from 'path'
import multer from 'multer'
import mysql from 'mysql2'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { authMiddleware, roleMiddleware } from '../auth.js'
import { getPool } from '../db.js'
import { dataDir, uploadsDir } from '../paths.js'
import { auditTrackedInventoryConsistency, autoCorrectTrackedInventoryEasyCases } from '../services/tracked_inventory_audit.js'

const router = express.Router()
const cfgPath = path.join(dataDir, 'config.json')
const backupsDir = path.join(dataDir, 'backups')
const restoreUploadsDir = path.join(backupsDir, 'incoming')
const upload = multer({ dest: uploadsDir })
const restoreUpload = multer({
  dest: restoreUploadsDir,
  limits: {
    fileSize: 1024 * 1024 * 1024
  }
})
const execFileAsync = promisify(execFile)
const DEFAULT_ENABLED_PRODUCT_TYPES = ['GENERAL', 'MEDICINAL', 'IMEI', 'SERIAL', 'VARIANT_SERIALIZED']

function normalizeEnabledProductTypes(input) {
  let values = input
  if (typeof values === 'string') {
    try {
      values = JSON.parse(values)
    } catch {
      values = values.split(',').map(item => item.trim()).filter(Boolean)
    }
  }

  const allowed = new Set(DEFAULT_ENABLED_PRODUCT_TYPES)
  const normalized = Array.isArray(values)
    ? values
      .map(value => String(value || '').trim().toUpperCase())
      .filter(value => allowed.has(value))
    : []

  const unique = [...new Set(normalized)]
  return unique.length > 0 ? unique : ['GENERAL']
}

function parseStoredEnabledProductTypes(raw) {
  if (!raw) return [...DEFAULT_ENABLED_PRODUCT_TYPES]
  try {
    return normalizeEnabledProductTypes(JSON.parse(raw))
  } catch {
    return normalizeEnabledProductTypes(raw)
  }
}

async function getStoreEnabled(pool) {
  try {
    const [rows] = await pool.query('SELECT enabled FROM store_settings WHERE id = 1 LIMIT 1')
    return Boolean(Number(rows?.[0]?.enabled ?? 1))
  } catch {
    return true
  }
}

async function ensureConfigColumns(pool) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'system_config'
       AND COLUMN_NAME IN ('enabled_product_types')`
  )
  const existing = new Set((rows || []).map(row => String(row.COLUMN_NAME || '').toLowerCase()))
  if (!existing.has('enabled_product_types')) {
    await pool.query('ALTER TABLE system_config ADD COLUMN enabled_product_types TEXT NULL AFTER logo_url')
    await pool.query('UPDATE system_config SET enabled_product_types = ? WHERE id = 1 AND (enabled_product_types IS NULL OR enabled_product_types = \'\')', [JSON.stringify(DEFAULT_ENABLED_PRODUCT_TYPES)])
  }
}

function ensureSeed() {
  if (!fs.existsSync(cfgPath)) {
    fs.mkdirSync(path.dirname(cfgPath), { recursive: true })
    const seed = { name: 'DTMPos', currency: 'USD', logoUrl: 'https://placehold.co/64x64?text=LOGO', enabledProductTypes: DEFAULT_ENABLED_PRODUCT_TYPES }
    fs.writeFileSync(cfgPath, JSON.stringify(seed, null, 2))
  }
}
ensureSeed()

function buildBackupFilename() {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate())
  ].join('-') + '_' + [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join('-')

  return `backup-${stamp}.sql`
}

function buildArchiveFilename(prefix) {
  const now = new Date()
  const pad = value => String(value).padStart(2, '0')
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate())
  ].join('-') + '_' + [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join('-')

  return `${prefix}-${stamp}.tar.gz`
}

async function createTarGz({ cwd, outputPath, entries }) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('No hay archivos para incluir en el backup')
  }

  try {
    await execFileAsync('tar', ['-czf', outputPath, ...entries], {
      cwd,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024
    })
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('La utilidad tar no está disponible en el servidor')
    }
    throw error
  }
}

async function extractTarGz({ archivePath, outputDir }) {
  try {
    await execFileAsync('tar', ['-xzf', archivePath, '-C', outputDir], {
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024
    })
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('La utilidad tar no está disponible en el servidor')
    }
    throw error
  }
}

function getDatabaseRuntimeConfig() {
  const host = process.env.DB_HOST || '127.0.0.1'
  const port = Number(process.env.DB_PORT || 3306)
  const user = process.env.DB_USER
  const password = process.env.DB_PASSWORD
  const database = process.env.DB_NAME

  if (!user || !password || !database) {
    throw new Error('Faltan variables de entorno para restaurar la base de datos')
  }

  return { host, port, user, password, database }
}

async function importDatabaseDump(sqlFilePath) {
  if (!fs.existsSync(sqlFilePath)) {
    throw new Error('No se encontró el archivo database.sql para restaurar')
  }

  const { host, port, user, password, database } = getDatabaseRuntimeConfig()

  try {
    await execFileAsync(
      'mysql',
      [
        `--host=${host}`,
        `--port=${port}`,
        `--user=${user}`,
        `--database=${database}`,
        '-e',
        `source ${sqlFilePath}`
      ],
      {
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
        env: {
          ...process.env,
          MYSQL_PWD: password
        }
      }
    )
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('La utilidad mysql no está disponible en el servidor')
    }
    const stderr = String(error?.stderr || '').trim()
    const stdout = String(error?.stdout || '').trim()
    throw new Error(stderr || stdout || error?.message || 'No se pudo restaurar la base de datos')
  }
}

function replacePathIfExists(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) return false

  fs.rmSync(targetPath, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.cpSync(sourcePath, targetPath, { recursive: true })
  return true
}

async function generateDatabaseDump(pool) {
  const [tableRows] = await pool.query('SHOW TABLES')
  const tables = (tableRows || []).map(row => Object.values(row)[0]).filter(Boolean)
  const lines = [
    '-- DTMPos database backup',
    `-- Generated at ${new Date().toISOString()}`,
    '',
    'SET FOREIGN_KEY_CHECKS = 0;',
    ''
  ]

  for (const tableName of tables) {
    const safeTableName = String(tableName).replace(/`/g, '``')
    const [createRows] = await pool.query(`SHOW CREATE TABLE \`${safeTableName}\``)
    const createRow = createRows?.[0]
    const createSql = createRow?.['Create Table']

    if (!createSql) continue

    lines.push(`-- Table structure for \`${safeTableName}\``)
    lines.push(`DROP TABLE IF EXISTS \`${safeTableName}\`;`)
    lines.push(`${createSql};`)
    lines.push('')

    const [dataRows] = await pool.query(`SELECT * FROM \`${safeTableName}\``)
    if (!Array.isArray(dataRows) || dataRows.length === 0) {
      continue
    }

    const columns = Object.keys(dataRows[0]).map(column => `\`${String(column).replace(/`/g, '``')}\``).join(', ')
    lines.push(`-- Data for \`${safeTableName}\``)

    for (let index = 0; index < dataRows.length; index += 100) {
      const batch = dataRows.slice(index, index + 100)
      const valuesSql = batch.map(row => {
        const values = Object.values(row).map(value => mysql.escape(value)).join(', ')
        return `(${values})`
      }).join(',\n')

      lines.push(`INSERT INTO \`${safeTableName}\` (${columns}) VALUES`)
      lines.push(`${valuesSql};`)
    }

    lines.push('')
  }

  lines.push('SET FOREIGN_KEY_CHECKS = 1;')
  lines.push('')
  return lines.join('\n')
}

async function buildFullBackupArchive(pool) {
  fs.mkdirSync(backupsDir, { recursive: true })

  const archiveName = buildArchiveFilename('backup-completo')
  const archivePath = path.join(backupsDir, archiveName)
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dtmpos-backup-'))
  const packageDir = path.join(tempRoot, 'backup-completo')

  try {
    fs.mkdirSync(packageDir, { recursive: true })

    const dumpContent = await generateDatabaseDump(pool)
    fs.writeFileSync(path.join(packageDir, 'database.sql'), dumpContent, 'utf-8')

    if (fs.existsSync(uploadsDir)) {
      fs.cpSync(uploadsDir, path.join(packageDir, 'uploads'), { recursive: true })
    }

    if (fs.existsSync(cfgPath)) {
      fs.copyFileSync(cfgPath, path.join(packageDir, 'config.json'))
    }

    fs.writeFileSync(
      path.join(packageDir, 'README.txt'),
      [
        'DTMPos backup completo',
        `Generado: ${new Date().toISOString()}`,
        '',
        'Contenido:',
        '- database.sql: respaldo de la base de datos',
        '- uploads/: imagenes y archivos subidos',
        '- config.json: configuracion del sistema',
        '',
        'Para restaurar las imagenes, copia la carpeta uploads dentro de server/uploads del proyecto.'
      ].join('\n'),
      'utf-8'
    )

    await createTarGz({
      cwd: tempRoot,
      outputPath: archivePath,
      entries: ['backup-completo']
    })

    return { archiveName, archivePath }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

async function createSafetyBackup(pool, prefix) {
  fs.mkdirSync(backupsDir, { recursive: true })

  const archiveName = buildArchiveFilename(prefix)
  const archivePath = path.join(backupsDir, archiveName)
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dtmpos-pre-restore-'))
  const packageDir = path.join(tempRoot, prefix)

  try {
    fs.mkdirSync(packageDir, { recursive: true })

    const dumpContent = await generateDatabaseDump(pool)
    fs.writeFileSync(path.join(packageDir, 'database.sql'), dumpContent, 'utf-8')

    if (fs.existsSync(uploadsDir)) {
      fs.cpSync(uploadsDir, path.join(packageDir, 'uploads'), { recursive: true })
    }

    if (fs.existsSync(cfgPath)) {
      fs.copyFileSync(cfgPath, path.join(packageDir, 'config.json'))
    }

    await createTarGz({
      cwd: tempRoot,
      outputPath: archivePath,
      entries: [prefix]
    })

    return { archiveName, archivePath }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

async function restoreSqlBackupFile({ sqlFilePath, pool }) {
  const safetyBackup = await createSafetyBackup(pool, 'pre-restore-sql')
  await importDatabaseDump(sqlFilePath)

  return {
    restored: {
      database: true,
      uploads: false,
      config: false
    },
    safetyBackup
  }
}

function findRestorePackageRoot(extractedRoot) {
  const directSql = path.join(extractedRoot, 'database.sql')
  if (fs.existsSync(directSql)) return extractedRoot

  const entries = fs.readdirSync(extractedRoot, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = path.join(extractedRoot, entry.name)
    if (fs.existsSync(path.join(candidate, 'database.sql'))) {
      return candidate
    }
  }

  return null
}

async function restoreFullBackupFile({ archivePath, pool }) {
  const safetyBackup = await createSafetyBackup(pool, 'pre-restore-full')
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dtmpos-restore-'))

  try {
    await extractTarGz({ archivePath, outputDir: tempRoot })

    const packageRoot = findRestorePackageRoot(tempRoot)
    if (!packageRoot) {
      throw new Error('El backup completo no contiene un database.sql válido')
    }

    const sqlFilePath = path.join(packageRoot, 'database.sql')
    const uploadsSource = path.join(packageRoot, 'uploads')
    const configSource = path.join(packageRoot, 'config.json')

    await importDatabaseDump(sqlFilePath)

    const uploadsRestored = replacePathIfExists(uploadsSource, uploadsDir)
    const configRestored = replacePathIfExists(configSource, cfgPath)

    return {
      restored: {
        database: true,
        uploads: uploadsRestored,
        config: configRestored
      },
      safetyBackup
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

router.get('/', async (req, res) => {
  try {
    const pool = await getPool()
    if (pool) {
      await ensureConfigColumns(pool)
      const [rows] = await pool.query('SELECT id, name, currency, logo_url, enabled_product_types FROM system_config WHERE id = 1 LIMIT 1')
      const row = rows?.[0]
      const storeEnabled = await getStoreEnabled(pool)
      if (!row) return res.json({ name: 'DTMPos', currency: 'USD', logoUrl: '', enabledProductTypes: DEFAULT_ENABLED_PRODUCT_TYPES, storeEnabled })
      return res.json({
        name: row.name,
        currency: row.currency,
        logoUrl: row.logo_url || '',
        enabledProductTypes: parseStoredEnabledProductTypes(row.enabled_product_types),
        storeEnabled
      })
    }
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'))
    return res.json({
      ...cfg,
      enabledProductTypes: normalizeEnabledProductTypes(cfg?.enabledProductTypes || DEFAULT_ENABLED_PRODUCT_TYPES),
      storeEnabled: cfg?.storeEnabled === undefined ? true : Boolean(cfg.storeEnabled)
    })
  } catch (err) {
    console.error('Config GET error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

router.get('/backup', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    const pool = await getPool()
    const filename = buildBackupFilename()
    const dumpContent = await generateDatabaseDump(pool)

    fs.mkdirSync(backupsDir, { recursive: true })
    fs.writeFileSync(path.join(backupsDir, filename), dumpContent, 'utf-8')

    res.setHeader('Content-Type', 'application/sql; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.send(dumpContent)
  } catch (err) {
    console.error('Config BACKUP error:', err)
    const reason = err?.message ? `: ${err.message}` : ''
    return res.status(500).json({ error: `No se pudo generar el backup de la base de datos${reason}` })
  }
})

router.get('/backup/full', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    const pool = await getPool()
    const { archiveName, archivePath } = await buildFullBackupArchive(pool)
    return res.download(archivePath, archiveName)
  } catch (err) {
    console.error('Config FULL BACKUP error:', err)
    const reason = err?.message ? `: ${err.message}` : ''
    return res.status(500).json({ error: `No se pudo generar el backup completo${reason}` })
  }
})

router.post('/backup/restore/sql', authMiddleware, roleMiddleware(['ADMIN']), restoreUpload.single('backup'), async (req, res) => {
  const uploadedFile = req.file

  try {
    if (!uploadedFile) {
      return res.status(400).json({ error: 'Debes seleccionar un archivo SQL para restaurar' })
    }

    if (!String(uploadedFile.originalname || '').toLowerCase().endsWith('.sql')) {
      return res.status(400).json({ error: 'El archivo debe tener extensión .sql' })
    }

    const pool = await getPool()
    const result = await restoreSqlBackupFile({
      sqlFilePath: uploadedFile.path,
      pool
    })

    return res.json({
      ok: true,
      message: 'Base de datos restaurada correctamente',
      restored: result.restored,
      safetyBackup: result.safetyBackup
    })
  } catch (err) {
    console.error('Config SQL RESTORE error:', err)
    const reason = err?.message ? `: ${err.message}` : ''
    return res.status(500).json({ error: `No se pudo restaurar el backup SQL${reason}` })
  } finally {
    if (uploadedFile?.path && fs.existsSync(uploadedFile.path)) {
      fs.rmSync(uploadedFile.path, { force: true })
    }
  }
})

router.post('/backup/restore/full', authMiddleware, roleMiddleware(['ADMIN']), restoreUpload.single('backup'), async (req, res) => {
  const uploadedFile = req.file

  try {
    if (!uploadedFile) {
      return res.status(400).json({ error: 'Debes seleccionar un backup completo para restaurar' })
    }

    const fileName = String(uploadedFile.originalname || '').toLowerCase()
    if (!fileName.endsWith('.tar.gz') && !fileName.endsWith('.tgz')) {
      return res.status(400).json({ error: 'El archivo debe ser un .tar.gz o .tgz generado por el sistema' })
    }

    const pool = await getPool()
    const result = await restoreFullBackupFile({
      archivePath: uploadedFile.path,
      pool
    })

    return res.json({
      ok: true,
      message: 'Backup completo restaurado correctamente',
      restored: result.restored,
      safetyBackup: result.safetyBackup
    })
  } catch (err) {
    console.error('Config FULL RESTORE error:', err)
    const reason = err?.message ? `: ${err.message}` : ''
    return res.status(500).json({ error: `No se pudo restaurar el backup completo${reason}` })
  } finally {
    if (uploadedFile?.path && fs.existsSync(uploadedFile.path)) {
      fs.rmSync(uploadedFile.path, { force: true })
    }
  }
})

router.get('/audit/tracked-inventory', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    const pool = await getPool()
    const result = await auditTrackedInventoryConsistency(pool)
    return res.json(result)
  } catch (err) {
    console.error('Config TRACKED AUDIT error:', err)
    const reason = err?.message ? `: ${err.message}` : ''
    return res.status(500).json({ error: `No se pudo ejecutar la auditoria de series e IMEI${reason}` })
  }
})

router.post('/audit/tracked-inventory/autocorrect', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    const pool = await getPool()
    const result = await autoCorrectTrackedInventoryEasyCases(pool)
    return res.json(result)
  } catch (err) {
    console.error('Config TRACKED AUTO-CORRECT error:', err)
    const reason = err?.message ? `: ${err.message}` : ''
    return res.status(500).json({ error: `No se pudo autocorregir los casos faciles de series e IMEI${reason}` })
  }
})

router.put('/', authMiddleware, roleMiddleware(['ADMIN']), upload.single('logo'), async (req, res) => {
  try {
    const { name, currency } = req.body
    const file = req.file
    const pool = await getPool()
    if (pool) {
      await ensureConfigColumns(pool)
      const [rows] = await pool.query('SELECT logo_url FROM system_config WHERE id = 1 LIMIT 1')
      const current = rows?.[0]
      const nextLogo = file ? `/uploads/${file.filename}` : (req.body.logoUrl || current?.logo_url || null)
      await pool.query('UPDATE system_config SET name = ?, currency = ?, logo_url = ? WHERE id = 1', [name, currency, nextLogo])
      return res.json({ ok: true })
    }
    // Fallback a archivo JSON si USE_MOCK=true
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'))
    const next = { ...cfg, name, currency }
    if (file) next.logoUrl = `/uploads/${file.filename}`
    else if (req.body.logoUrl !== undefined) next.logoUrl = req.body.logoUrl
    fs.writeFileSync(cfgPath, JSON.stringify(next, null, 2))
    return res.json({ ok: true })
  } catch (err) {
    console.error('Config PUT error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

export default router
