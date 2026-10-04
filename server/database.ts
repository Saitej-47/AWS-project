import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";

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
      workspace_name VARCHAR(120) NULL,
      environment_mode VARCHAR(16) NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      UNIQUE KEY smartsize_users_email_unique (email),
      UNIQUE KEY smartsize_users_verification_token_unique (verification_token),
      UNIQUE KEY smartsize_users_reset_token_unique (reset_token)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [workspaceColumn] = await pool.query<Array<RowDataPacket & { count: number }>>(
    "SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'smartsize_users' AND column_name = 'workspace_name'",
  );
  if (workspaceColumn[0].count === 0) await pool.query("ALTER TABLE smartsize_users ADD COLUMN workspace_name VARCHAR(120) NULL");
  const [environmentColumn] = await pool.query<Array<RowDataPacket & { count: number }>>(
    "SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'smartsize_users' AND column_name = 'environment_mode'",
  );
  if (environmentColumn[0].count === 0) await pool.query("ALTER TABLE smartsize_users ADD COLUMN environment_mode VARCHAR(16) NULL");
  const [updatedAtColumn] = await pool.query<Array<RowDataPacket & { count: number }>>(
    "SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'smartsize_users' AND column_name = 'updated_at'",
  );
  if (updatedAtColumn[0].count === 0) {
    await pool.query("ALTER TABLE smartsize_users ADD COLUMN updated_at DATETIME(3) NULL");
    await pool.query("UPDATE smartsize_users SET updated_at = created_at WHERE updated_at IS NULL");
    await pool.query("ALTER TABLE smartsize_users MODIFY COLUMN updated_at DATETIME(3) NOT NULL");
  }

  const schema = [
    `CREATE TABLE IF NOT EXISTS smartsize_workspaces (
      id CHAR(36) NOT NULL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      environment VARCHAR(16) NULL,
      created_by VARCHAR(191) NOT NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      INDEX smartsize_workspaces_creator_idx (created_by),
      CONSTRAINT smartsize_workspaces_creator_fk FOREIGN KEY (created_by) REFERENCES smartsize_users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS smartsize_workspace_members (
      id CHAR(36) NOT NULL PRIMARY KEY,
      workspace_id CHAR(36) NOT NULL,
      user_id VARCHAR(191) NOT NULL,
      role VARCHAR(16) NOT NULL,
      created_at DATETIME(3) NOT NULL,
      UNIQUE KEY smartsize_workspace_members_unique (workspace_id, user_id),
      INDEX smartsize_workspace_members_user_idx (user_id),
      CONSTRAINT smartsize_workspace_members_workspace_fk FOREIGN KEY (workspace_id) REFERENCES smartsize_workspaces(id) ON DELETE CASCADE,
      CONSTRAINT smartsize_workspace_members_user_fk FOREIGN KEY (user_id) REFERENCES smartsize_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS smartsize_aws_accounts (
      id CHAR(36) NOT NULL PRIMARY KEY,
      workspace_id CHAR(36) NOT NULL,
      account_id VARCHAR(32) NULL,
      region VARCHAR(64) NOT NULL,
      status VARCHAR(32) NOT NULL,
      metadata JSON NULL,
      last_synced_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      UNIQUE KEY smartsize_aws_accounts_workspace_unique (workspace_id),
      INDEX smartsize_aws_accounts_workspace_idx (workspace_id),
      CONSTRAINT smartsize_aws_accounts_workspace_fk FOREIGN KEY (workspace_id) REFERENCES smartsize_workspaces(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS smartsize_workspace_demo_seeds (
      workspace_id CHAR(36) NOT NULL PRIMARY KEY,
      created_at DATETIME(3) NOT NULL,
      CONSTRAINT smartsize_workspace_demo_seeds_workspace_fk FOREIGN KEY (workspace_id) REFERENCES smartsize_workspaces(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS smartsize_resources (
      workspace_id CHAR(36) NOT NULL,
      id VARCHAR(191) NOT NULL,
      source VARCHAR(48) NOT NULL,
      resource_type VARCHAR(48) NOT NULL,
      region VARCHAR(64) NULL,
      status VARCHAR(48) NULL,
      data JSON NOT NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      PRIMARY KEY (workspace_id, id),
      INDEX smartsize_resources_workspace_idx (workspace_id),
      INDEX smartsize_resources_type_idx (workspace_id, resource_type),
      INDEX smartsize_resources_status_idx (workspace_id, status),
      CONSTRAINT smartsize_resources_workspace_fk FOREIGN KEY (workspace_id) REFERENCES smartsize_workspaces(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS smartsize_utilization_metrics (
      id CHAR(36) NOT NULL PRIMARY KEY,
      workspace_id CHAR(36) NOT NULL,
      resource_id VARCHAR(191) NOT NULL,
      metric_name VARCHAR(64) NOT NULL,
      metric_time DATETIME(3) NOT NULL,
      value DOUBLE NULL,
      unit VARCHAR(32) NULL,
      status VARCHAR(32) NOT NULL,
      created_at DATETIME(3) NOT NULL,
      UNIQUE KEY smartsize_metrics_unique (workspace_id, resource_id, metric_name, metric_time),
      INDEX smartsize_metrics_workspace_idx (workspace_id),
      INDEX smartsize_metrics_resource_idx (workspace_id, resource_id),
      CONSTRAINT smartsize_metrics_resource_fk FOREIGN KEY (workspace_id, resource_id) REFERENCES smartsize_resources(workspace_id, id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS smartsize_recommendations (
      workspace_id CHAR(36) NOT NULL,
      id VARCHAR(191) NOT NULL,
      resource_id VARCHAR(191) NOT NULL,
      source VARCHAR(48) NOT NULL,
      status VARCHAR(32) NOT NULL,
      data JSON NOT NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      PRIMARY KEY (workspace_id, id),
      INDEX smartsize_recommendations_workspace_idx (workspace_id),
      INDEX smartsize_recommendations_resource_idx (workspace_id, resource_id),
      INDEX smartsize_recommendations_status_idx (workspace_id, status),
      CONSTRAINT smartsize_recommendations_resource_fk FOREIGN KEY (workspace_id, resource_id) REFERENCES smartsize_resources(workspace_id, id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS smartsize_simulations (
      workspace_id CHAR(36) NOT NULL,
      id CHAR(36) NOT NULL,
      user_id VARCHAR(191) NOT NULL,
      data JSON NOT NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      PRIMARY KEY (workspace_id, id),
      INDEX smartsize_simulations_workspace_idx (workspace_id),
      INDEX smartsize_simulations_user_idx (user_id),
      CONSTRAINT smartsize_simulations_workspace_fk FOREIGN KEY (workspace_id) REFERENCES smartsize_workspaces(id) ON DELETE CASCADE,
      CONSTRAINT smartsize_simulations_user_fk FOREIGN KEY (user_id) REFERENCES smartsize_users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS smartsize_rightsizing_actions (
      workspace_id CHAR(36) NOT NULL,
      id CHAR(36) NOT NULL,
      recommendation_id VARCHAR(191) NOT NULL,
      user_id VARCHAR(191) NOT NULL,
      status VARCHAR(32) NOT NULL,
      data JSON NOT NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      PRIMARY KEY (workspace_id, id),
      INDEX smartsize_actions_workspace_idx (workspace_id),
      INDEX smartsize_actions_recommendation_idx (workspace_id, recommendation_id),
      INDEX smartsize_actions_user_idx (user_id),
      INDEX smartsize_actions_status_idx (workspace_id, status),
      CONSTRAINT smartsize_actions_recommendation_fk FOREIGN KEY (workspace_id, recommendation_id) REFERENCES smartsize_recommendations(workspace_id, id) ON DELETE CASCADE,
      CONSTRAINT smartsize_actions_user_fk FOREIGN KEY (user_id) REFERENCES smartsize_users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS smartsize_savings_records (
      workspace_id CHAR(36) NOT NULL,
      id CHAR(36) NOT NULL,
      source VARCHAR(32) NOT NULL,
      amount DECIMAL(18, 2) NOT NULL,
      currency CHAR(3) NOT NULL,
      data JSON NOT NULL,
      created_at DATETIME(3) NOT NULL,
      PRIMARY KEY (workspace_id, id),
      INDEX smartsize_savings_workspace_idx (workspace_id),
      CONSTRAINT smartsize_savings_workspace_fk FOREIGN KEY (workspace_id) REFERENCES smartsize_workspaces(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS smartsize_audit_logs (
      workspace_id CHAR(36) NOT NULL,
      id CHAR(36) NOT NULL,
      actor_user_id VARCHAR(191) NOT NULL,
      event_type VARCHAR(64) NOT NULL,
      resource_id VARCHAR(191) NULL,
      metadata JSON NULL,
      created_at DATETIME(3) NOT NULL,
      PRIMARY KEY (workspace_id, id),
      INDEX smartsize_audit_workspace_idx (workspace_id, created_at),
      INDEX smartsize_audit_actor_idx (actor_user_id),
      INDEX smartsize_audit_resource_idx (workspace_id, resource_id),
      CONSTRAINT smartsize_audit_workspace_fk FOREIGN KEY (workspace_id) REFERENCES smartsize_workspaces(id) ON DELETE CASCADE,
      CONSTRAINT smartsize_audit_actor_fk FOREIGN KEY (actor_user_id) REFERENCES smartsize_users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS smartsize_policies (
      workspace_id CHAR(36) NOT NULL,
      id VARCHAR(64) NOT NULL,
      environment VARCHAR(32) NOT NULL,
      data JSON NOT NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      PRIMARY KEY (workspace_id, id),
      UNIQUE KEY smartsize_policies_environment_unique (workspace_id, environment),
      INDEX smartsize_policies_workspace_idx (workspace_id),
      CONSTRAINT smartsize_policies_workspace_fk FOREIGN KEY (workspace_id) REFERENCES smartsize_workspaces(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS smartsize_reports (
      workspace_id CHAR(36) NOT NULL,
      id CHAR(36) NOT NULL,
      user_id VARCHAR(191) NOT NULL,
      data JSON NOT NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      PRIMARY KEY (workspace_id, id),
      INDEX smartsize_reports_workspace_idx (workspace_id),
      CONSTRAINT smartsize_reports_workspace_fk FOREIGN KEY (workspace_id) REFERENCES smartsize_workspaces(id) ON DELETE CASCADE,
      CONSTRAINT smartsize_reports_user_fk FOREIGN KEY (user_id) REFERENCES smartsize_users(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS smartsize_manual_analyses (
      workspace_id CHAR(36) NOT NULL,
      id CHAR(36) NOT NULL,
      resource_id VARCHAR(191) NOT NULL,
      recommendation_id VARCHAR(191) NOT NULL,
      user_id VARCHAR(191) NOT NULL,
      status VARCHAR(32) NOT NULL,
      data JSON NOT NULL,
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      PRIMARY KEY (workspace_id, id),
      INDEX smartsize_manual_analyses_workspace_idx (workspace_id, created_at),
      INDEX smartsize_manual_analyses_resource_idx (workspace_id, resource_id),
      CONSTRAINT smartsize_manual_analyses_workspace_fk FOREIGN KEY (workspace_id) REFERENCES smartsize_workspaces(id) ON DELETE CASCADE,
      CONSTRAINT smartsize_manual_analyses_user_fk FOREIGN KEY (user_id) REFERENCES smartsize_users(id) ON DELETE RESTRICT,
      CONSTRAINT smartsize_manual_analyses_resource_fk FOREIGN KEY (workspace_id, resource_id) REFERENCES smartsize_resources(workspace_id, id) ON DELETE CASCADE,
      CONSTRAINT smartsize_manual_analyses_recommendation_fk FOREIGN KEY (workspace_id, recommendation_id) REFERENCES smartsize_recommendations(workspace_id, id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS smartsize_schema_migrations (
      version VARCHAR(64) NOT NULL PRIMARY KEY,
      applied_at DATETIME(3) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ];
  for (const statement of schema) await pool.query(statement);
  const [awsSyncColumn] = await pool.query<Array<RowDataPacket & { count: number }>>(
    "SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'smartsize_aws_accounts' AND column_name = 'last_synced_at'",
  );
  if (awsSyncColumn[0].count === 0) {
    await pool.query("ALTER TABLE smartsize_aws_accounts ADD COLUMN last_synced_at DATETIME(3) NULL");
  }
  await pool.execute(
    "INSERT IGNORE INTO smartsize_schema_migrations (version, applied_at) VALUES (?, ?)",
    ["2026-10-04-workspace-workflow-schema", new Date()],
  );

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
