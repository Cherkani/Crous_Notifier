const fs = require('fs/promises')
const path = require('path')
const config = require('../src/config')
const { createPool } = require('../src/db/pool')

const migrationsDir = path.resolve(__dirname, '..', 'migrations')

async function ensureDatabase() {
  if (config.db.uri) return
  const pool = createPool(null)
  try {
    // Many production users can connect to an existing schema but are not
    // allowed to create databases globally. Prefer using the target DB first.
    await pool.query(`USE \`${config.db.database}\``)
    return
  } catch (error) {
    if (error.code !== 'ER_BAD_DB_ERROR') {
      throw error
    }
    await pool.query(
      `CREATE DATABASE IF NOT EXISTS \`${config.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    )
  } finally {
    await pool.end()
  }
}

async function runMigrations({ log = console.log } = {}) {
  await ensureDatabase()
  const pool = createPool()
  const connection = await pool.getConnection()
  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename VARCHAR(191) NOT NULL PRIMARY KEY,
        executed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    const files = (await fs.readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort()

    for (const file of files) {
      const [existing] = await connection.query('SELECT filename FROM schema_migrations WHERE filename = ?', [file])
      if (existing.length) continue

      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8')
      await connection.beginTransaction()
      try {
        const statements = sql
          .split(/;\s*(?:\r?\n|$)/)
          .map((statement) => statement.trim())
          .filter(Boolean)

        for (const statement of statements) {
          await connection.query(statement)
        }
        await connection.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file])
        await connection.commit()
        log(`Applied ${file}`)
      } catch (error) {
        await connection.rollback()
        throw error
      }
    }

    log('Database migrations are up to date.')
  } finally {
    connection.release()
    await pool.end()
  }
}

if (require.main === module) {
  runMigrations().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}

module.exports = {
  runMigrations,
}
