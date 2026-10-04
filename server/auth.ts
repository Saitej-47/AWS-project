import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { User } from "./store";
import { userRepository } from "./userRepository";
import { workspaceRepository, type WorkspaceMembership } from "./workspaceRepository";

const sessionCookie = "smartsize_session";
const stateCookie = "smartsize_oauth_state";
let ephemeralDevelopmentSecret: string | undefined;

function sign(value: string) {
  const sessionSecret = process.env.SESSION_SECRET ?? (process.env.NODE_ENV === "production"
    ? undefined
    : (ephemeralDevelopmentSecret ??= crypto.randomBytes(32).toString("hex")));
  if (!sessionSecret) throw new Error("SESSION_SECRET must be configured in production.");
  return crypto.createHmac("sha256", sessionSecret).update(value).digest("base64url");
}

function toSessionUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar: user.avatar,
    provider: user.provider,
    role: user.role,
    emailVerified: user.emailVerified,
    workspaceName: user.workspaceName ?? `${user.name}'s Workspace`,
    environmentMode: user.environmentMode ?? null,
    workspaceId: user.workspaceId,
  };
}

function createToken(user: User) {
  const payload = Buffer.from(JSON.stringify({ user: toSessionUser(user), sessionVersion: user.sessionVersion ?? 0, exp: Date.now() + 1000 * 60 * 60 * 24 * 7 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readCookies(request: Request) {
  return Object.fromEntries((request.headers.cookie || "").split(";").filter(Boolean).map((part) => {
    const [key, ...value] = part.trim().split("=");
    return [key, decodeURIComponent(value.join("="))];
  }));
}

export async function readSession(request: Request): Promise<User | undefined> {
  const token = readCookies(request)[sessionCookie];
  if (!token) return undefined;
  const [payload, signature] = token.split(".");
  const expected = sign(payload || "");
  if (!payload || !signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return undefined;
  }

  let data: { user: User; sessionVersion: number; exp: number };
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as typeof data;
  } catch {
    return undefined;
  }
  if (!data.user?.id || data.exp <= Date.now()) return undefined;
  const currentUser = await userRepository.getById(data.user.id);
  if (!currentUser || (currentUser.sessionVersion ?? 0) !== data.sessionVersion) return undefined;
  const workspace = await workspaceRepository.getDefaultForUser(currentUser.id);
  return {
    ...currentUser,
    ...(workspace ? {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      environmentMode: workspace.environment,
    } : {}),
    passwordHash: undefined,
    verificationToken: undefined,
    resetToken: undefined,
    verificationTokenExpiresAt: undefined,
    resetTokenExpiresAt: undefined,
  };
}

export async function requireSession(request: Request, response: Response, next: NextFunction) {
  try {
    const user = await readSession(request);
    if (!user) return response.status(401).json({ error: "Authentication required" });
    const workspace = await workspaceRepository.getDefaultForUser(user.id);
    if (!workspace) return response.status(403).json({ error: "A workspace membership is required." });
    request.user = user;
    request.workspace = workspace;
    return next();
  } catch (error) {
    return next(error);
  }
}

export async function requireVerifiedSession(request: Request, response: Response, next: NextFunction) {
  try {
    const user = await readSession(request);
    if (!user) return response.status(401).json({ error: "Authentication required" });
    if (!user.emailVerified) return response.status(403).json({ error: "Email verification required", verificationRequired: true });
    const workspace = await workspaceRepository.getDefaultForUser(user.id);
    if (!workspace) return response.status(403).json({ error: "A workspace membership is required." });
    request.user = user;
    request.workspace = workspace;
    return next();
  } catch (error) {
    return next(error);
  }
}

export function setSession(response: Response, user: User) {
  response.cookie(sessionCookie, createToken(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 7,
    path: "/",
  });
}

export function clearSession(response: Response) {
  response.clearCookie(sessionCookie, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
}

export async function invalidateSession(user: User) {
  await userRepository.update(user.id, { sessionVersion: (user.sessionVersion ?? 0) + 1 });
}

export function createOAuthState(response: Response) {
  const state = crypto.randomBytes(24).toString("hex");
  response.cookie(stateCookie, state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 10 * 60 * 1000, path: "/" });
  return state;
}

export function verifyOAuthState(request: Request, state: string) {
  const savedState = readCookies(request)[stateCookie];
  return Boolean(savedState && state && savedState.length === state.length && crypto.timingSafeEqual(Buffer.from(savedState), Buffer.from(state)));
}

export async function createDemoUser(email = "demo@smartsize.local") {
  const { randomUUID } = await import("node:crypto");
  const user = await userRepository.save({
    id: randomUUID(),
    email,
    name: "SmartSize Demo Admin",
    provider: "demo",
    role: "Platform Admin",
    emailVerified: true,
    workspaceName: "SmartSize Demo Environment",
    environmentMode: "demo",
    passwordHash: undefined,
    createdAt: new Date().toISOString(),
  });
  let workspace: WorkspaceMembership | undefined = await workspaceRepository.getDefaultForUser(user.id);
  if (!workspace) {
    workspace = await workspaceRepository.createForUser(user, "SmartSize Demo Environment");
  }
  if (workspace.environment !== "demo") {
    workspace = await workspaceRepository.updateForUser(user.id, workspace.id, { name: "SmartSize Demo Environment", environment: "demo" });
  }
  const updated = await userRepository.update(user.id, {
    workspaceId: workspace?.id,
    workspaceName: workspace?.name ?? "SmartSize Demo Environment",
    environmentMode: "demo",
    emailVerified: true,
  });
  return updated ?? { ...user, workspaceId: workspace?.id, workspaceName: workspace?.name, environmentMode: "demo" };
}

declare global {
  namespace Express {
    interface Request {
      user?: User;
      workspace?: WorkspaceMembership;
    }
  }
}