import { getPool } from '../db.js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.join(process.cwd(), '.env') })

async function ensureColumn(conn, table, column, definition) {
  const [rows] = await conn.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [column])
  if (!Array.isArray(rows) || rows.length === 0) {
    await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`)
  }
}

async function migrate() {
  const pool = await getPool()
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    console.log('Migrating transfers tables...')

    // Create transfers table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS transfers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        source_warehouse_id INT NOT NULL,
        destination_warehouse_id INT NOT NULL,
        status ENUM('PENDING', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'COMPLETED',
        user_id INT NULL,
        notes TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (source_warehouse_id) REFERENCES warehouses(id),
        FOREIGN KEY (destination_warehouse_id) REFERENCES warehouses(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `)

    // Create transfer_items table
    await conn.query(`
      CREATE TABLE IF NOT EXISTS transfer_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        transfer_id INT NOT NULL,
        product_id INT NOT NULL,
        quantity INT NOT NULL,
        FOREIGN KEY (transfer_id) REFERENCES transfers(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `)

    await ensureColumn(conn, 'transfer_items', 'destination_movement_type', 'VARCHAR(20) NULL')
    await ensureColumn(conn, 'transfer_items', 'batch_no', 'VARCHAR(100) NULL')
    await ensureColumn(conn, 'transfer_items', 'imei', 'VARCHAR(100) NULL')
    await ensureColumn(conn, 'transfer_items', 'serial', 'VARCHAR(100) NULL')

    console.log('Transfers migration completed.')
    await conn.commit()
  } catch (err) {
    await conn.rollback()
    console.error('Error in transfers migration:', err)
  } finally {
    conn.release()
    process.exit()
  }
}

migrate()
