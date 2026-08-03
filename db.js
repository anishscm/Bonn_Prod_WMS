const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;
let isPg = false;
let pool = null;
let sqliteDb = null;

if (connectionString) {
  isPg = true;
  pool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false }
  });
  console.log('[DB] Bonn_Prod_WMS connected to Supabase PostgreSQL Database');
} else {
  const dbPath = path.join(__dirname, 'bonn_wms_database.db');
  sqliteDb = new sqlite3.Database(dbPath);
  console.log('[DB] Bonn_Prod_WMS running on local SQLite Database');
}

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    if (isPg) {
      let pgSql = sql;
      let paramCount = 1;
      while (pgSql.includes('?')) {
        pgSql = pgSql.replace('?', `$${paramCount++}`);
      }
      pool.query(pgSql, params, (err, res) => {
        if (err) return reject(err);
        resolve(res.rows);
      });
    } else {
      const trimmed = sql.trim().toUpperCase();
      if (trimmed.startsWith('SELECT')) {
        sqliteDb.all(sql, params, (err, rows) => {
          if (err) return reject(err);
          resolve(rows || []);
        });
      } else {
        sqliteDb.run(sql, params, function(err) {
          if (err) return reject(err);
          resolve([{ id: this.lastID, changes: this.changes }]);
        });
      }
    }
  });
}

function initDb() {
  return Promise.resolve();
}

module.exports = { query, isPg, initDb };
