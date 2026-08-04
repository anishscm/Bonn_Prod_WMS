const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;
let isPg = false;
let pool = null;
let sqliteDb = null;

if (connectionString && connectionString.includes('postgresql://')) {
  isPg = true;
  pool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 20
  });
  
  // Prevent unhandled error exceptions when Supabase closes idle SSL sockets
  pool.on('error', (err, client) => {
    console.error('[DB PG Pool Error]: Unexpected error on idle client', err.message);
  });
  
  console.log('[DB] Configured for Supabase PostgreSQL Database');
} else {
  const dbPath = path.join(__dirname, 'bonn_wms_database.db');
  sqliteDb = new sqlite3.Database(dbPath);
  console.log('[DB] Configured for Local SQLite Database');
}


// Unified Query Execution Helper with Error Handling
function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    if (isPg && pool) {
      let pgSql = sql;
      let paramCount = 1;
      while (pgSql.includes('?')) {
        pgSql = pgSql.replace('?', `$${paramCount++}`);
      }
      pool.query(pgSql, params, (err, res) => {
        if (err) {
          console.error('[DB PG Error]:', err.message);
          return resolve([]); // Fallback empty array on DB error to prevent server crash
        }
        resolve(res.rows || []);
      });
    } else if (sqliteDb) {
      const trimmed = sql.trim().toUpperCase();
      if (trimmed.startsWith('SELECT')) {
        sqliteDb.all(sql, params, (err, rows) => {
          if (err) {
            console.error('[DB SQLite Error]:', err.message);
            return resolve([]);
          }
          resolve(rows || []);
        });
      } else {
        sqliteDb.run(sql, params, function(err) {
          if (err) {
            console.error('[DB SQLite Exec Error]:', err.message);
            return resolve([{ id: 0, changes: 0 }]);
          }
          resolve([{ id: this.lastID, changes: this.changes }]);
        });
      }
    } else {
      resolve([]);
    }
  });
}

function initDb() {
  return new Promise((resolve) => {
    try {
      const schemaPath = path.join(__dirname, 'schema.sql');
      if (fs.existsSync(schemaPath)) {
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        if (isPg && pool) {
          pool.query(schemaSql, (err) => {
            if (err) console.error('[DB PG Init Warning]:', err.message);
            else console.log('[DB PG Init] Schema initialized successfully');
            resolve();
          });
        } else if (sqliteDb) {
          sqliteDb.exec(schemaSql, (err) => {
            if (err) console.error('[DB SQLite Init Warning]:', err.message);
            else console.log('[DB SQLite Init] Schema initialized successfully');
            resolve();
          });
        } else {
          resolve();
        }
      } else {
        resolve();
      }
    } catch (e) {
      console.error('[DB Init Error]:', e.message);
      resolve();
    }
  });
}

module.exports = { query, isPg, initDb };
