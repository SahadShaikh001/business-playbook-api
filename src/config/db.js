const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DATABASE_HOST || "127.0.0.1",
  port: Number(process.env.DATABASE_PORT || 3306),
  user: process.env.DATABASE_USER || "root",
  password: process.env.DATABASE_PASSWORD || "",
  database: process.env.DATABASE_NAME || "business_playbook",

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function testDatabaseConnection() {
  const connection = await pool.getConnection();

  try {
    await connection.query("SELECT 1");
    console.log("✅ MySQL database connected successfully");
  } finally {
    connection.release();
  }
}

module.exports = {
  pool,
  testDatabaseConnection,
};