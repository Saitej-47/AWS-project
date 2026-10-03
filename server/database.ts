import mysql, { type Pool } from "mysql2/promise";

let pool: Pool | undefined;

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export async function initializeDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Production requires DATABASE_URL for persistent account storage.");
    }
    return;
  }

  const url = new URL(connectionString);
  if (url.protocol !== "mysql:" && url.protocol !== "mysql2:") {
    throw new Error("DATABASE_URL must use the mysql:// scheme.");
  }
  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!databaseName) throw new Error("DATABASE_URL must include a database name.");

  pool = mysql.createPool({
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: databaseName,
    timezone: "Z",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    ...(url.searchParams.get("ssl") === "true" ? { ssl: {} } : {}),
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS smartsize_users (
      id VARCHAR(191) NOT NULL PRIMARY KEY,
      email VARCHAR(254) NOT NULL,
      name VARCHAR(100) NOT NULL,
      avatar TEXT NULL,
      provider VARCHAR(16) NOT NULL,
      role VARCHAR(32) NOT NULL,
      password_hash VARCHAR(255) NULL,
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      verification_token CHAR(64) NULL,
      verification_token_expires_at DATETIME(3) NULL,
      reset_token CHAR(64) NULL,
      reset_token_expires_at DATETIME(3) NULL,
      session_version INT UNSIGNED NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL,
      UNIQUE KEY smartsize_users_email_unique (email),
      UNIQUE KEY smartsize_users_verification_token_unique (verification_token),
      UNIQUE KEY smartsize_users_reset_token_unique (reset_token)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await pool.query("SELECT 1");
}

export function getDatabasePool() {
  return pool;
}

export async function closeDatabase() {
  if (!pool) return;
  const currentPool = pool;
  pool = undefined;
  await currentPool.end();
}
