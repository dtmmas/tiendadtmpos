import express from 'express'
import multer from 'multer'
import { authMiddleware, roleMiddleware } from '../auth.js'
import { getPool } from '../db.js'
import { uploadsDir } from '../paths.js'

const router = express.Router()
const upload = multer({ dest: uploadsDir })

function optionalBrandUpload(req, res, next) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase()
  if (contentType.includes('multipart/form-data')) {
    return upload.single('logo')(req, res, next)
  }
  return next()
}

async function ensureBrandLogoColumn(pool) {
  const [rows] = await pool.query(
    `SELECT 1
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'brands'
       AND COLUMN_NAME = 'logo_url'
     LIMIT 1`
  )
  if (Array.isArray(rows) && rows.length > 0) return
  await pool.query('ALTER TABLE brands ADD COLUMN logo_url VARCHAR(255) NULL DEFAULT NULL AFTER name')
}

function normalizeLogoValue(value) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return null
  if (trimmed.startsWith('/uploads/')) return trimmed
  if (trimmed.startsWith('uploads/')) return `/${trimmed}`
  const uploadsIndex = trimmed.indexOf('/uploads/')
  if (uploadsIndex >= 0) return trimmed.slice(uploadsIndex)
  return trimmed
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const pool = await getPool()
    await ensureBrandLogoColumn(pool)
    const [rows] = await pool.query('SELECT id, name, logo_url AS logoUrl FROM brands ORDER BY name ASC')
    return res.json(rows.map(r => ({ id: r.id, name: r.name, logoUrl: r.logoUrl || null })))
  } catch (err) {
    console.error('Brands GET error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

router.post('/', authMiddleware, roleMiddleware(['ADMIN']), optionalBrandUpload, async (req, res) => {
  try {
    let { name } = req.body
    name = (name || '').trim()
    if (!name) return res.status(400).json({ error: 'Nombre requerido' })
    const pool = await getPool()
    await ensureBrandLogoColumn(pool)
    const [exists] = await pool.query('SELECT id FROM brands WHERE LOWER(name) = LOWER(?) LIMIT 1', [name])
    if (Array.isArray(exists) && exists.length > 0) {
      return res.status(409).json({ error: 'Ya existe una marca con ese nombre' })
    }
    const logoUrl = req.file ? `/uploads/${req.file.filename}` : normalizeLogoValue(req.body?.logoUrl)
    const [result] = await pool.query('INSERT INTO brands (name, logo_url) VALUES (?, ?)', [name, logoUrl])
    return res.json({ id: result.insertId, name, logoUrl })
  } catch (err) {
    console.error('Brands POST error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

router.put('/:id', authMiddleware, roleMiddleware(['ADMIN']), optionalBrandUpload, async (req, res) => {
  try {
    const id = Number(req.params.id)
    let { name } = req.body
    name = (name || '').trim()
    if (!name) return res.status(400).json({ error: 'Nombre requerido' })
    const pool = await getPool()
    await ensureBrandLogoColumn(pool)
    const [exists] = await pool.query('SELECT id FROM brands WHERE LOWER(name) = LOWER(?) AND id <> ? LIMIT 1', [name, id])
    if (Array.isArray(exists) && exists.length > 0) {
      return res.status(409).json({ error: 'Ya existe una marca con ese nombre' })
    }
    const [currentRows] = await pool.query('SELECT logo_url FROM brands WHERE id = ? LIMIT 1', [id])
    const current = currentRows?.[0] || null
    const removeLogo = ['1', 'true', 'yes', 'on'].includes(String(req.body?.removeLogo || '').trim().toLowerCase())
    let nextLogo = current?.logo_url || null
    if (req.file) nextLogo = `/uploads/${req.file.filename}`
    else if (removeLogo) nextLogo = null
    else if (req.body?.logoUrl !== undefined) nextLogo = normalizeLogoValue(req.body.logoUrl)
    await pool.query('UPDATE brands SET name = ?, logo_url = ? WHERE id = ?', [name, nextLogo, id])
    return res.json({ id, name, logoUrl: nextLogo })
  } catch (err) {
    console.error('Brands PUT error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

// New endpoint: usage count for a brand
router.get('/:id/usage', authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id)
    const pool = await getPool()
    await ensureBrandLogoColumn(pool)
    const [rows] = await pool.query('SELECT COUNT(*) AS c FROM products WHERE brand_id = ?', [id])
    const count = rows?.[0]?.c ?? 0
    return res.json({ count })
  } catch (err) {
    console.error('Brands usage GET error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

router.delete('/:id', authMiddleware, roleMiddleware(['ADMIN']), async (req, res) => {
  try {
    const id = Number(req.params.id)
    const pool = await getPool()
    await ensureBrandLogoColumn(pool)
    const [rows] = await pool.query('SELECT COUNT(*) AS c FROM products WHERE brand_id = ?', [id])
    const count = rows?.[0]?.c ?? 0
    if (count > 0) {
      return res.status(409).json({ error: `No se puede eliminar: la marca está asignada a ${count} producto(s).`, count })
    }
    await pool.query('DELETE FROM brands WHERE id = ?', [id])
    return res.json({ ok: true })
  } catch (err) {
    console.error('Brands DELETE error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
})

export default router
