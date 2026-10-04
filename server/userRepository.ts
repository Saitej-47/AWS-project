import crypto from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDatabasePool } from "./database";
import { store, type User } from "./store";

type UserRow = RowDataPacket & {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  provider: User["provider"];
  role: User["role"];
  password_hash: string | null;
  email_verified: number | boolean;
  verification_token: string | null;
  verification_token_expires_at: Date | string | null;
  reset_token: string | null;
  reset_token_expires_at: Date | string | null;
  session_version: number;
  workspace_name: string | null;
  environment_mode: User["environmentMode"] | null;
  created_at: Date | string;
};

function asIsoString(value: Date | string | null) {
  if (!value) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function fromRow(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatar: row.avatar ?? undefined,
    provider: row.provider,
    role: row.role,
    passwordHash: row.password_hash ?? undefined,
    emailVerified: Boolean(row.email_verified),
    verificationToken: row.verification_token,
    verificationTokenExpiresAt: asIsoString(row.verification_token_expires_at),
    resetToken: row.reset_token,
    resetTokenExpiresAt: asIsoString(row.reset_token_expires_at),
    sessionVersion: row.session_version,
    workspaceName: row.workspace_name ?? undefined,
    environmentMode: row.environment_mode ?? undefined,
    createdAt: asIsoString(row.created_at)!,
  };
}

const columns = `
  id, email, name, avatar, provider, role, password_hash, email_verified,
  verification_token, verification_token_expires_at, reset_token,
  reset_token_expires_at, session_version, workspace_name, environment_mode, created_at
`;

export const userRepository = {
  async migrateLegacyUsers() {
    if (!getDatabasePool()) return;
    for (const user of store.getUsers()) await this.save(user);
  },

  async getByEmail(email: string) {
    const pool = getDatabasePool();
    if (!pool) return store.getUserByEmail(email);
    const [rows] = await pool.execute<UserRow[]>(`SELECT ${columns} FROM smartsize_users WHERE email = ? LIMIT 1`, [email.toLowerCase()]);
    return rows[0] ? fromRow(rows[0]) : undefined;
  },

  async getById(id: string) {
    const pool = getDatabasePool();
    if (!pool) return store.getUserById(id);
    const [rows] = await pool.execute<UserRow[]>(`SELECT ${columns} FROM smartsize_users WHERE id = ? LIMIT 1`, [id]);
    return rows[0] ? fromRow(rows[0]) : undefined;
  },

  async findByVerificationToken(token: string) {
    const pool = getDatabasePool();
    if (!pool) return store.findUserByVerificationToken(token);
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const [rows] = await pool.execute<UserRow[]>(
      `SELECT ${columns} FROM smartsize_users
       WHERE verification_token = ? AND (verification_token_expires_at IS NULL OR verification_token_expires_at > UTC_TIMESTAMP(3))
       LIMIT 1`,
      [hash],
    );
    return rows[0] ? fromRow(rows[0]) : undefined;
  },

  async findByResetToken(token: string) {
    const pool = getDatabasePool();
    if (!pool) return store.findUserByResetToken(token);
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const [rows] = await pool.execute<UserRow[]>(
      `SELECT ${columns} FROM smartsize_users
       WHERE reset_token = ? AND (reset_token_expires_at IS NULL OR reset_token_expires_at > UTC_TIMESTAMP(3))
       LIMIT 1`,
      [hash],
    );
    return rows[0] ? fromRow(rows[0]) : undefined;
  },

  async save(user: User) {
    const pool = getDatabasePool();
    if (!pool) return store.saveUser(user);
    try {
      await pool.execute<ResultSetHeader>(
        `INSERT INTO smartsize_users (
          id, email, name, avatar, provider, role, password_hash, email_verified,
          verification_token, verification_token_expires_at, reset_token,
          reset_token_expires_at, session_version, workspace_name, environment_mode, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user.id,
          user.email.toLowerCase(),
          user.name,
          user.avatar ?? null,
          user.provider,
          user.role,
          user.passwordHash ?? null,
          user.emailVerified,
          user.verificationToken ?? null,
          user.verificationTokenExpiresAt ? new Date(user.verificationTokenExpiresAt) : null,
          user.resetToken ?? null,
          user.resetTokenExpiresAt ? new Date(user.resetTokenExpiresAt) : null,
          user.sessionVersion ?? 0,
          user.workspaceName ?? null,
          user.environmentMode ?? null,
          new Date(user.createdAt),
          new Date(user.createdAt),
        ],
      );
      return user;
    } catch (error) {
      if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ER_DUP_ENTRY") throw error;
      const existing = await this.getByEmail(user.email);
      if (existing) return existing;
      throw error;
    }
  },

  async delete(id: string) {
    const pool = getDatabasePool();
    if (!pool) return store.deleteUser(id);
    const [result] = await pool.execute<ResultSetHeader>("DELETE FROM smartsize_users WHERE id = ?", [id]);
    return result.affectedRows > 0;
  },

  async update(id: string, updates: Partial<User>) {
    const pool = getDatabasePool();
    if (!pool) return store.updateUser(id, updates);
    const fields: Partial<Record<keyof User, string>> = {
      email: "email",
      name: "name",
      avatar: "avatar",
      provider: "provider",
      role: "role",
      passwordHash: "password_hash",
      emailVerified: "email_verified",
      verificationToken: "verification_token",
      verificationTokenExpiresAt: "verification_token_expires_at",
      resetToken: "reset_token",
      resetTokenExpiresAt: "reset_token_expires_at",
      sessionVersion: "session_version",
      workspaceName: "workspace_name",
      environmentMode: "environment_mode",
    };
    const assignments: string[] = [];
    const values: Array<string | number | boolean | Date | null> = [];
    for (const [key, column] of Object.entries(fields) as Array<[keyof User, string]>) {
      if (!(key in updates)) continue;
      let value: unknown = updates[key];
      if (key === "email" && typeof value === "string") value = value.toLowerCase();
      if ((key === "verificationTokenExpiresAt" || key === "resetTokenExpiresAt") && typeof value === "string") value = new Date(value);
      if (value === undefined) value = null;
      if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean" && !(value instanceof Date)) {
        throw new TypeError(`Unsupported user field value for ${key}.`);
      }
      assignments.push(`${column} = ?`);
      values.push(value);
    }
    if (!assignments.length) return this.getById(id);
    values.push(id);
    assignments.push("updated_at = UTC_TIMESTAMP(3)");
    await pool.execute(`UPDATE smartsize_users SET ${assignments.join(", ")} WHERE id = ?`, values);
    return this.getById(id);
  },
};
