import crypto from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { getDatabasePool } from "./database";
import { store, type User } from "./store";
import type { AwsIdentityResult } from "./services/aws/contracts";

export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
export type WorkspaceEnvironment = "demo" | "aws" | "manual" | null;

export type WorkspaceMembership = {
  id: string;
  name: string;
  environment: WorkspaceEnvironment;
  role: WorkspaceRole;
  createdBy: string;
};

type WorkspaceRow = RowDataPacket & {
  id: string;
  name: string;
  environment: WorkspaceEnvironment;
  role: WorkspaceRole;
  created_by: string;
};

const defaultPolicies = [
  { id: "production", environment: "Production", autoExecution: false, approvalRequired: true, maximumRisk: "Low" },
  { id: "staging", environment: "Staging", autoExecution: false, approvalRequired: true, maximumRisk: "Medium" },
  { id: "development", environment: "Development", autoExecution: false, approvalRequired: false, maximumRisk: "Medium" },
] as const;

export const workspaceRepository = {
  async createForUser(user: Pick<User, "id" | "name">, name: string) {
    const pool = getDatabasePool();
    const id = crypto.randomUUID();
    const now = new Date();
    if (pool) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.execute(
          "INSERT INTO smartsize_workspaces (id, name, environment, created_by, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)",
          [id, name, user.id, now, now],
        );
        await connection.execute(
          "INSERT INTO smartsize_workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 'OWNER', ?)",
          [crypto.randomUUID(), id, user.id, now],
        );
        for (const policy of defaultPolicies) {
          await connection.execute(
            "INSERT INTO smartsize_policies (workspace_id, id, environment, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            [id, policy.id, policy.environment, JSON.stringify(policy), now, now],
          );
        }
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    } else {
      store.updateUser(user.id, { workspaceId: id, workspaceName: name, environmentMode: null });
    }
    return { id, name, environment: null, role: "OWNER" as const, createdBy: user.id };
  },

  async getDefaultForUser(userId: string): Promise<WorkspaceMembership | undefined> {
    const pool = getDatabasePool();
    if (!pool) {
      const user = store.getUserById(userId);
      if (!user?.workspaceId) return undefined;
      return {
        id: user.workspaceId,
        name: user.workspaceName ?? `${user.name}'s Workspace`,
        environment: user.environmentMode ?? null,
        role: "OWNER",
        createdBy: user.id,
      };
    }
    const [rows] = await pool.execute<WorkspaceRow[]>(
      `SELECT w.id, w.name, w.environment, w.created_by, m.role
       FROM smartsize_workspace_members m
       JOIN smartsize_workspaces w ON w.id = m.workspace_id
       WHERE m.user_id = ?
       ORDER BY CASE m.role WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 ELSE 2 END, w.created_at
       LIMIT 1`,
      [userId],
    );
    const row = rows[0];
    return row ? { id: row.id, name: row.name, environment: row.environment, role: row.role, createdBy: row.created_by } : undefined;
  },

  async updateForUser(userId: string, workspaceId: string, updates: { name?: string; environment?: Exclude<WorkspaceEnvironment, null> }) {
    const pool = getDatabasePool();
    if (!pool) {
      const user = store.getUserById(userId);
      if (!user || user.workspaceId !== workspaceId) return undefined;
      const accountUpdates: Partial<User> = {};
      if (updates.name !== undefined) accountUpdates.workspaceName = updates.name;
      if (updates.environment !== undefined) accountUpdates.environmentMode = updates.environment;
      const updated = store.updateUser(userId, accountUpdates);
      if (!updated) return undefined;
      return this.getDefaultForUser(userId);
    }
    const [membership] = await pool.execute<RowDataPacket[]>(
      "SELECT role FROM smartsize_workspace_members WHERE workspace_id = ? AND user_id = ? LIMIT 1",
      [workspaceId, userId],
    );
    if (!membership[0] || !["OWNER", "ADMIN"].includes(String(membership[0].role))) return undefined;
    const assignments: string[] = [];
    const values: Array<string | Date> = [];
    if (updates.name !== undefined) {
      assignments.push("name = ?");
      values.push(updates.name);
    }
    if (updates.environment !== undefined) {
      assignments.push("environment = ?");
      values.push(updates.environment);
    }
    if (!assignments.length) return this.getDefaultForUser(userId);
    assignments.push("updated_at = ?");
    values.push(new Date());
    values.push(workspaceId);
    await pool.execute(`UPDATE smartsize_workspaces SET ${assignments.join(", ")} WHERE id = ?`, values);
    const [result] = await pool.execute<RowDataPacket[]>(
      `SELECT w.id, w.name, w.environment, w.created_by, m.role
       FROM smartsize_workspace_members m
       JOIN smartsize_workspaces w ON w.id = m.workspace_id
       WHERE m.workspace_id = ? AND m.user_id = ? LIMIT 1`,
      [workspaceId, userId],
    );
    const row = result[0] as WorkspaceRow | undefined;
    return row ? { id: row.id, name: row.name, environment: row.environment, role: row.role, createdBy: row.created_by } : undefined;
  },

  async saveAwsIdentity(userId: string, workspaceId: string, identity: Extract<AwsIdentityResult, { status: "ready" }>) {
    const pool = getDatabasePool();
    if (!pool) {
      const user = store.getUserById(userId);
      if (!user || user.workspaceId !== workspaceId) return undefined;
      store.updateUser(userId, {
        environmentMode: "aws",
        awsAccountId: identity.accountId,
        awsRegion: identity.region,
        awsArn: identity.arn,
        awsConnectedAt: new Date().toISOString(),
      });
      return this.getDefaultForUser(userId);
    }
    const connection = await pool.getConnection();
    const timestamp = new Date();
    try {
      await connection.beginTransaction();
      const [membership] = await connection.execute<RowDataPacket[]>(
        "SELECT role FROM smartsize_workspace_members WHERE workspace_id = ? AND user_id = ? LIMIT 1 FOR UPDATE",
        [workspaceId, userId],
      );
      if (!membership[0] || !["OWNER", "ADMIN"].includes(String(membership[0].role))) {
        await connection.rollback();
        return undefined;
      }
      await connection.execute(
        "UPDATE smartsize_workspaces SET environment = 'aws', updated_at = ? WHERE id = ?",
        [timestamp, workspaceId],
      );
      await connection.execute(
        `INSERT INTO smartsize_aws_accounts (id, workspace_id, account_id, region, status, metadata, last_synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'connected', ?, NULL, ?, ?)
         ON DUPLICATE KEY UPDATE account_id = VALUES(account_id), region = VALUES(region),
           status = VALUES(status), metadata = VALUES(metadata), updated_at = VALUES(updated_at)`,
        [crypto.randomUUID(), workspaceId, identity.accountId, identity.region, JSON.stringify({ arn: identity.arn, verifiedAt: timestamp.toISOString() }), timestamp, timestamp],
      );
      await connection.commit();
      return this.getDefaultForUser(userId);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async getAwsAccount(workspaceId: string) {
    const pool = getDatabasePool();
    if (!pool) {
      const user = store.getUsers().find((item) => item.workspaceId === workspaceId);
      if (!user?.awsAccountId || !user.awsRegion || !user.awsConnectedAt) return undefined;
      return {
        accountId: user.awsAccountId,
        region: user.awsRegion,
        status: "connected",
        arn: user.awsArn ?? null,
        syncedAt: null,
      };
    }
    const [rows] = await pool.execute<Array<RowDataPacket & { account_id: string | null; region: string; status: string; metadata: string | object | null; last_synced_at: Date | null }>>(
      "SELECT account_id, region, status, metadata, last_synced_at FROM smartsize_aws_accounts WHERE workspace_id = ? LIMIT 1",
      [workspaceId],
    );
    const row = rows[0];
    if (!row) return undefined;
    const metadata = row.metadata
      ? (typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata) as { arn?: string }
      : {};
    return {
      accountId: row.account_id,
      region: row.region,
      status: row.status,
      arn: metadata.arn ?? null,
      syncedAt: row.last_synced_at?.toISOString() ?? null,
    };
  },

  async hasMembership(workspaceId: string, userId: string) {
    const pool = getDatabasePool();
    if (!pool) {
      const user = store.getUserById(userId);
      return user?.workspaceId === workspaceId;
    }
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT 1 FROM smartsize_workspace_members WHERE workspace_id = ? AND user_id = ? LIMIT 1",
      [workspaceId, userId],
    );
    return rows.length > 0;
  },

  async migrateLegacyWorkspaces() {
    const pool = getDatabasePool();
    if (!pool) return;
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT u.id, u.name, u.workspace_name
       FROM smartsize_users u
       LEFT JOIN smartsize_workspace_members m ON m.user_id = u.id
       WHERE m.user_id IS NULL`,
    );
    for (const row of rows) {
      await this.createForUser(
        { id: String(row.id), name: String(row.name) },
        typeof row.workspace_name === "string" && row.workspace_name.trim()
          ? row.workspace_name
          : `${String(row.name)}'s Workspace`,
      );
    }
  },
};
