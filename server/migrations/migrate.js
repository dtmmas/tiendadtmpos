import dotenv from 'dotenv'
import mysql from 'mysql2/promise'

dotenv.config()

async function migrate() {
  const host = process.env.DB_HOST || 'localhost'
  const port = Number(process.env.DB_PORT || 3306)
  const user = process.env.DB_USER || 'root'
  const password = process.env.DB_PASSWORD || ''
  const database = process.env.DB_NAME || 'dtmpos'

  const conn = await mysql.createConnection({ host, port, user, password, database })

  async function columnExists(table, column) {
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS\n       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [database, table, column]
    )
    return (rows?.[0]?.c || 0) > 0
  }

  async function ensureColumn(table, column, definition) {
    if (!(await columnExists(table, column))) {
      await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`)
      console.log(`Added column ${table}.${column}`)
    } else {
      console.log(`Column ${table}.${column} exists`)
    }
  }

  async function fkExists(table, column, referencedTable) {
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE\n       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? AND REFERENCED_TABLE_NAME = ?`,
      [database, table, column, referencedTable]
    )
    return (rows?.[0]?.c || 0) > 0
  }

  async function ensureForeignKey(table, column, referencedTable, fkName, onDeleteAction = null) {
    try {
      if (!(await fkExists(table, column, referencedTable))) {
        const onDeleteClause = onDeleteAction ? ` ON DELETE ${onDeleteAction}` : ''
        await conn.query(
          `ALTER TABLE \`${table}\` ADD CONSTRAINT \`${fkName}\` FOREIGN KEY (\`${column}\`) REFERENCES \`${referencedTable}\`(id)${onDeleteClause}`
        )
        console.log(`Added FK ${fkName} on ${table}.${column} -> ${referencedTable}.id${onDeleteAction ? ` (ON DELETE ${onDeleteAction})` : ''}`)
      } else {
        console.log(`FK exists for ${table}.${column} -> ${referencedTable}.id`)
      }
    } catch (err) {
      console.warn(`Skipping FK ${fkName} on ${table}.${column} -> ${referencedTable}.id due to error: ${err.code || err.message}`)
    }
  }

  async function indexExists(table, indexName) {
    const [rows] = await conn.query(`SHOW INDEX FROM \`${table}\` WHERE Key_name = ?`, [indexName])
    return Array.isArray(rows) && rows.length > 0
  }

  async function ensureIndex(table, indexName, columnsExpr) {
    if (!(await indexExists(table, indexName))) {
      await conn.query(`CREATE INDEX \`${indexName}\` ON \`${table}\` (${columnsExpr})`)
      console.log(`Created index ${indexName} on ${table}(${columnsExpr})`)
    } else {
      console.log(`Index ${indexName} exists`)
    }
  }

  // Create units catalog table
  await conn.query(`CREATE TABLE IF NOT EXISTS units (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(16) NOT NULL UNIQUE,
    name VARCHAR(64) NOT NULL
  )`)
  console.log('Ensured units table')
  // Seed default units if empty
  const [urows] = await conn.query('SELECT COUNT(*) AS c FROM units')
  const ucount = urows?.[0]?.c || 0
  if (ucount === 0) {
    await conn.query('INSERT INTO units (code, name) VALUES ?', [
      [
        ['UND','Unidad'],
        ['CJ','Caja'],
        ['PAQ','Paquete'],
        ['BOT','Botella'],
        ['KG','Kilogramo'],
        ['G','Gramo'],
        ['L','Litro'],
        ['ML','Mililitro']
      ]
    ])
    console.log('Seeded default units')
  }

  // Ensure new columns in products
  // Ensure core lookup tables exist (brands, suppliers)
  await conn.query(`CREATE TABLE IF NOT EXISTS brands (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL
  )`)
  console.log('Ensured brands table')
  await conn.query(`CREATE TABLE IF NOT EXISTS suppliers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    document VARCHAR(50),
    phone VARCHAR(50),
    email VARCHAR(160),
    address VARCHAR(255)
  )`)
  console.log('Ensured suppliers table')

  // Ensure new columns in products
  await ensureColumn('products', 'brand_id', 'INT NULL')
  await ensureColumn('products', 'supplier_id', 'INT NULL')
  await ensureColumn('products', 'price2', 'DECIMAL(12,2) NOT NULL DEFAULT 0')
  await ensureColumn('products', 'price3', 'DECIMAL(12,2) NOT NULL DEFAULT 0')
  await ensureColumn('products', 'cost', 'DECIMAL(12,2) NOT NULL DEFAULT 0')
  await ensureColumn('products', 'avg_cost', 'DECIMAL(12,2) NOT NULL DEFAULT 0')
  await ensureColumn('products', 'last_cost', 'DECIMAL(12,2) NOT NULL DEFAULT 0')
  await ensureColumn('products', 'initial_stock', 'INT NOT NULL DEFAULT 0')
  await ensureColumn('products', 'min_stock', 'INT NOT NULL DEFAULT 0')
  await ensureColumn('products', 'unit', 'VARCHAR(50) NULL')
  await ensureColumn('products', 'description', 'TEXT NULL')
  await ensureColumn('products', 'image_url', 'VARCHAR(255) NULL')
  await ensureColumn('products', 'product_code', 'VARCHAR(80) NULL')
  await conn.query(`
    UPDATE products
    SET avg_cost = cost
    WHERE avg_cost IS NULL OR avg_cost = 0
  `)
  await conn.query(`
    UPDATE products
    SET last_cost = cost
    WHERE last_cost IS NULL OR last_cost = 0
  `)
  // Drop legacy store/warehouse stock columns if present
  async function dropColumnIfExists(table, column) {
    const exists = await columnExists(table, column)
    if (exists) {
      await conn.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``)
      console.log(`Dropped column ${table}.${column}`)
    } else {
      console.log(`Column ${table}.${column} not found (nothing to drop)`)    
    }
  }
  await dropColumnIfExists('products', 'store_stock')
  await dropColumnIfExists('products', 'warehouse_stock')

  // New columns for product types and medicinal meta
  await ensureColumn('products', 'product_type', 'VARCHAR(20) NOT NULL DEFAULT "GENERAL"')
  await ensureColumn('products', 'alt_name', 'VARCHAR(255) NULL')
  await ensureColumn('products', 'generic_name', 'VARCHAR(255) NULL')
  await ensureColumn('products', 'shelf_location', 'VARCHAR(255) NULL')

  // Ensure FKs
  await ensureForeignKey('products', 'brand_id', 'brands', 'fk_products_brand')
  await ensureForeignKey('products', 'supplier_id', 'suppliers', 'fk_products_supplier')

  // Helpful indices for filtering
  await ensureIndex('products', 'idx_products_brand', 'brand_id')
  await ensureIndex('products', 'idx_products_supplier', 'supplier_id')
  await ensureIndex('products', 'idx_products_type', 'product_type')

  // NEW: Categories parent-child hierarchy
  await ensureColumn('categories', 'parent_id', 'INT NULL')
  await ensureForeignKey('categories', 'parent_id', 'categories', 'fk_categories_parent', 'SET NULL')
  await ensureIndex('categories', 'idx_categories_parent', 'parent_id')

  // NEW: Departments table and category.department_id
  await conn.query(`CREATE TABLE IF NOT EXISTS departments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL UNIQUE
  )`)
  console.log('Ensured departments table')
  await ensureColumn('categories', 'department_id', 'INT NULL')
  await ensureForeignKey('categories', 'department_id', 'departments', 'fk_categories_department', 'SET NULL')
  await ensureIndex('categories', 'idx_categories_department', 'department_id')

  await ensureColumn('sale_items', 'unit_cost_snapshot', 'DECIMAL(12,2) NULL')
  await ensureColumn('sale_items', 'total_cost_snapshot', 'DECIMAL(12,2) NULL')
  await conn.query(`
    UPDATE sale_items si
    JOIN products p ON p.id = si.product_id
    SET si.unit_cost_snapshot = COALESCE(si.unit_cost_snapshot, p.avg_cost, p.cost, 0),
        si.total_cost_snapshot = COALESCE(si.total_cost_snapshot, si.quantity * COALESCE(si.unit_cost_snapshot, p.avg_cost, p.cost, 0))
    WHERE si.unit_cost_snapshot IS NULL OR si.total_cost_snapshot IS NULL
  `)

  // Ensure detail tables for medicinal, IMEI, serial, and variants
  await conn.query(`CREATE TABLE IF NOT EXISTS product_batches (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    batch_no VARCHAR(100) NOT NULL,
    expiry_date DATE,
    quantity INT NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_batches_product FOREIGN KEY (product_id) REFERENCES products(id)
  )`)
  await ensureIndex('product_batches', 'idx_batches_product', 'product_id')
  await ensureIndex('product_batches', 'idx_batches_expiry', 'expiry_date')

  // Migrate legacy lot_code -> batch_no if needed
  const [pbCols] = await conn.query(`SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'product_batches'`, [database])
  const pbHasBatchNo = pbCols.some((c) => c.COLUMN_NAME === 'batch_no')
  const pbHasLotCode = pbCols.some((c) => c.COLUMN_NAME === 'lot_code')
  if (!pbHasBatchNo && pbHasLotCode) {
    await conn.query(`ALTER TABLE product_batches ADD COLUMN batch_no VARCHAR(100) NULL`)
    await conn.query(`UPDATE product_batches SET batch_no = lot_code WHERE batch_no IS NULL`)
    await conn.query(`ALTER TABLE product_batches MODIFY COLUMN batch_no VARCHAR(100) NOT NULL`)
    console.log('Migrated product_batches: added batch_no and copied from lot_code')
  }

  await conn.query(`CREATE TABLE IF NOT EXISTS product_imeis (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    imei VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'AVAILABLE',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_imeis_product FOREIGN KEY (product_id) REFERENCES products(id),
    UNIQUE KEY uniq_imei (imei)
  )`)
  await ensureIndex('product_imeis', 'idx_imeis_product', 'product_id')

  await conn.query(`CREATE TABLE IF NOT EXISTS product_serials (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    serial_no VARCHAR(100) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'AVAILABLE',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_serials_product FOREIGN KEY (product_id) REFERENCES products(id),
    UNIQUE KEY uniq_serial (serial_no)
  )`)
  await ensureIndex('product_serials', 'idx_serials_product', 'product_id')

  // Migrate legacy serial -> serial_no if needed
  const [psCols] = await conn.query(`SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'product_serials'`, [database])
  const psHasSerialNo = psCols.some((c) => c.COLUMN_NAME === 'serial_no')
  const psHasSerial = psCols.some((c) => c.COLUMN_NAME === 'serial')
  if (!psHasSerialNo && psHasSerial) {
    await conn.query(`ALTER TABLE product_serials ADD COLUMN serial_no VARCHAR(100) NULL`)
    await conn.query(`UPDATE product_serials SET serial_no = serial WHERE serial_no IS NULL`)
    await conn.query(`ALTER TABLE product_serials MODIFY COLUMN serial_no VARCHAR(100) NOT NULL`)
    // Ensure unique index on serial_no
    const [idxRows] = await conn.query(`SHOW INDEX FROM product_serials WHERE Key_name = 'uniq_serial'`)
    if (!Array.isArray(idxRows) || idxRows.length === 0) {
      await conn.query(`ALTER TABLE product_serials ADD UNIQUE KEY uniq_serial (serial_no)`) 
    }
    console.log('Migrated product_serials: added serial_no and copied from serial')
  }

  // Adjust unique index on product_serials to be composite (product_id, serial_no)
  {
    const [idxRows] = await conn.query(`SHOW INDEX FROM product_serials WHERE Key_name = 'uniq_serial'`)
    const uniqSerialCols = Array.isArray(idxRows) ? idxRows.map(r => r.Column_name) : []
    const hasComposite = uniqSerialCols.includes('product_id') && uniqSerialCols.includes('serial_no')
    const hasOnlySerialNo = uniqSerialCols.length > 0 && uniqSerialCols.every(c => c === 'serial_no')
    if (!hasComposite) {
      // Drop old unique index if present and only on serial_no
      if (hasOnlySerialNo) {
        await conn.query(`ALTER TABLE product_serials DROP INDEX uniq_serial`)
      }
      // Create composite unique index to allow same serial across different products but not within the same product
      await conn.query(`ALTER TABLE product_serials ADD UNIQUE KEY uniq_serial (product_id, serial_no)`)
      console.log('Adjusted product_serials uniq_serial to composite (product_id, serial_no)')
    } else {
      console.log('Composite unique index on product_serials already set')
    }
  }

  // Ensure transactional engine (InnoDB) for consistency on rollback
  async function ensureInnoDb(table) {
    const [rows] = await conn.query(`SELECT ENGINE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, [database, table])
    const engine = rows?.[0]?.ENGINE || null
    if (engine && engine.toUpperCase() !== 'INNODB') {
      await conn.query(`ALTER TABLE \`${table}\` ENGINE=InnoDB`)
      console.log(`Altered ${table} engine to InnoDB`)
    } else {
      console.log(`${table} already uses InnoDB`)
    }
  }
  await ensureInnoDb('products')
  await ensureInnoDb('product_serials')

  await conn.query(`CREATE TABLE IF NOT EXISTS product_variants (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    name VARCHAR(160) NOT NULL,
    sku VARCHAR(80) UNIQUE,
    stock INT NOT NULL DEFAULT 0,
    price DECIMAL(12,2) NOT NULL DEFAULT 0,
    cost DECIMAL(12,2) NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_variants_product FOREIGN KEY (product_id) REFERENCES products(id)
  )`)
  await ensureIndex('product_variants', 'idx_variants_product', 'product_id')

  // Ensure products.product_type is VARCHAR
  const [ptRows] = await conn.query(`SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'products' AND COLUMN_NAME = 'product_type'`, [database])
  const ptType = ptRows?.[0]?.DATA_TYPE || null
  if (ptType && ptType.toLowerCase() !== 'varchar') {
    await conn.query(`ALTER TABLE products MODIFY COLUMN product_type VARCHAR(20) NOT NULL DEFAULT 'GENERAL'`)
    console.log('Altered products.product_type to VARCHAR(20)')
  }

  // Ensure sales table and payment_method
  await conn.query(`CREATE TABLE IF NOT EXISTS sales (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NULL,
    user_id INT NULL,
    doc_no VARCHAR(50) NULL,
    total DECIMAL(12,2) NOT NULL DEFAULT 0,
    is_credit TINYINT(1) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`)
  await ensureColumn('sales', 'payment_method', 'VARCHAR(50) DEFAULT "CASH"')
  console.log('Ensured sales table and payment_method')

  // Create units catalog table
  await conn.query(`CREATE TABLE IF NOT EXISTS units (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(16) NOT NULL UNIQUE,
    name VARCHAR(64) NOT NULL
  )`)
  console.log('Ensured units table')

  // DROP: eliminar tabla almacen si existe
  await conn.query('DROP TABLE IF EXISTS almacen')

  await conn.end()
  console.log('Migration finished.')
}

migrate().catch(err => {
  console.error('Migration error:', err)
  process.exit(1)
})
