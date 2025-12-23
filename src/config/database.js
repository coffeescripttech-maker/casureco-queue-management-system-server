/**
 * Database Configuration - MariaDB/MySQL Connection Pool
 */

const mysql = require('mysql2/promise');

// Create connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'naga_queue_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  charset: 'utf8mb4',
  supportBigNumbers: true,
  bigNumberStrings: true,
  dateStrings: true,
  // Ensure TEXT/VARCHAR fields are returned as strings, not Buffers
  typeCast: function(field, next) {
    if (field.type === 'VAR_STRING' || field.type === 'STRING' || field.type === 'BLOB') {
      return field.string();
    }
    return next();
  }
});

// Test connection
pool.getConnection()
  .then(connection => {
    console.log('✅ Database connected successfully');
    connection.release();
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  });

/**
 * Execute a query with parameters
 */
async function query(sql, params = []) {
  try {
    const [rows] = await pool.execute(sql, params);
    return rows;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

/**
 * Execute a stored procedure
 */
async function callProcedure(procedureName, params = []) {
  try {
    const placeholders = params.map(() => '?').join(',');
    const sql = `CALL ${procedureName}(${placeholders})`;
    const [rows] = await pool.execute(sql, params);
    return rows[0]; // First result set
  } catch (error) {
    console.error('Stored procedure error:', error);
    throw error;
  }
}

/**
 * Begin transaction
 */
async function beginTransaction() {
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  return connection;
}

/**
 * Commit transaction
 */
async function commit(connection) {
  await connection.commit();
  connection.release();
}

/**
 * Rollback transaction
 */
async function rollback(connection) {
  await connection.rollback();
  connection.release();
}

module.exports = {
  pool,
  query,
  callProcedure,
  beginTransaction,
  commit,
  rollback
};
