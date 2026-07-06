const mysql = require('mysql2/promise')
const config = require('../config')

let pool

function createPool(database = config.db.database) {
  if (config.db.uri) {
    return mysql.createPool({
      uri: config.db.uri,
      waitForConnections: true,
      connectionLimit: config.db.connectionLimit,
      namedPlaceholders: true,
    })
  }

  const options = {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    waitForConnections: true,
    connectionLimit: config.db.connectionLimit,
    namedPlaceholders: true,
    timezone: 'Z',
  }

  if (database) options.database = database
  return mysql.createPool(options)
}

function getPool() {
  if (!pool) pool = createPool()
  return pool
}

async function withTransaction(work) {
  const connection = await getPool().getConnection()
  try {
    await connection.beginTransaction()
    const result = await work(connection)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

module.exports = {
  createPool,
  getPool,
  withTransaction,
}
