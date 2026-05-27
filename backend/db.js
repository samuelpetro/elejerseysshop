const mysql = require("mysql2/promise");
require("dotenv").config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function testConnection() {
  try {
    const conn = await pool.getConnection();
    console.log("✅ Conectado a MySQL:", process.env.DB_NAME);
    conn.release();
  } catch (err) {
    console.error("❌ Error MySQL:", err.message);
    process.exit(1);
  }
}
testConnection();

module.exports = pool;
