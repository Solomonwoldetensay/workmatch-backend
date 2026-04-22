
// ─────────────────────────────────────────────
// WorkMatch — Database Connection
// Uses PostgreSQL via the 'pg' library
// Supports both local DB and Supabase cloud DB
// ─────────────────────────────────────────────
 
const { Pool } = require('pg');
require('dotenv').config();
 
// Use DATABASE_URL if provided (Supabase), otherwise use individual vars
const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }, // Required for Supabase
      }
    : {
        host:     process.env.DB_HOST     || 'localhost',
        port:     process.env.DB_PORT     || 5432,
        database: process.env.DB_NAME     || 'workmatch',
        user:     process.env.DB_USER     || 'postgres',
        password: process.env.DB_PASSWORD || '',
      }
);
 
// Test connection on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌  Database connection failed:', err.message);
    console.error('    Check your .env file and make sure PostgreSQL is running.');
  } else {
    console.log('✅  Database connected successfully');
    release();
  }
});
 
// Helper — run a query with automatic error handling
const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.log(`  DB query (${duration}ms):`, text.slice(0, 60));
    }
    return result;
  } catch (error) {
    console.error('Database query error:', error.message);
    console.error('Query:', text);
    throw error;
  }
};
 
module.exports = { pool, query };
