const mysql = require("mysql2/promise");
require("dotenv").config();

// Soporta nombres Railway (MYSQLHOST) y personalizados (DB_HOST)
const cfg = {
  host: process.env.DB_HOST || process.env.MYSQLHOST,
  port: process.env.DB_PORT || process.env.MYSQLPORT,
  user: process.env.DB_USER || process.env.MYSQLUSER,
  password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD,
  database: process.env.DB_NAME || process.env.MYSQLDATABASE,
};

const pool = mysql.createPool({
  ...cfg,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function testConnection() {
  try {
    const conn = await pool.getConnection();
    console.log("✅ Conectado a MySQL:", cfg.database, "en", cfg.host);
    conn.release();
  } catch (err) {
    console.error("⚠️  MySQL no disponible:", err.message);
    console.error("   El servidor arrancará igual");
  }
}
testConnection();

module.exports = pool;
