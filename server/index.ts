import crypto from "node:crypto";
import fs from "node:fs";
import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { answerAdvisor } from "./ai";
import { clearSession, createDemoUser, createOAuthState, invalidateSession, readSession, requireSession, requireVerifiedSession, setSession, verifyOAuthState } from "./auth";
import { isEmailDeliveryConfigured, sendAccountEmail } from "./services/email";
import { analyzeRecommendation } from "./services/rightsizingEngine";
import { serializeUser, store, type RightsizingPolicy } from "./store";
import { initializeDatabase, isDatabaseConfigured } from "./database";
import { userRepository } from "./userRepository";
import { workspaceRepository } from "./workspaceRepository";
import { workspaceDataRepository } from "./workspaceDataRepository";
import { resources as seedResources } from "../client/src/lib/mockData";
import { createAwsReadOnlyService } from "./services/aws/awsReadOnlyService";
import { analyzeManualInfrastructure, validateManualAnalysisInput } from "./services/manualAnalysisEngine";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requireDemoEnvironment(req: express.Request, res: express.Response) {
  if (req.workspace?.environment === "demo") return true;
  res.status(503).json({
    code: "AWS_NOT_CONNECTED",
    error: "The AWS environment is not connected. Demo data is not available in this workspace.",
  });
  return false;
}

function requireDemoOrManualEnvironment(req: express.Request, res: express.Response) {
  if (req.workspace?.environment === "demo" || req.workspace?.environment === "manual") return true;
  res.status(503).json({
    code: "WORKSPACE_DATA_SOURCE_REQUIRED",
    error: "Choose Demo or Manual Analysis to use this workflow. Live AWS data is not substituted here.",
  });
  return false;
}

function getAuthMode() {
  return (process.env.AUTH_MODE || (process.env.NODE_ENV === "production" ? "production" : "demo")).toLowerCase();
}

async function startServer() {
  const envFile = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

  if (process.env.NODE_ENV === "production") {
    const secret = process.env.SESSION_SECRET;
    if (!secret || secret.length < 32 || /^(default|changeme|replace-with)/i.test(secret)) {
      throw new Error("Production requires a unique SESSION_SECRET of at least 32 characters.");
    }
    if (!process.env.APP_ORIGIN) throw new Error("Production requires APP_ORIGIN to be configured.");
  }
  await initializeDatabase();
  await userRepository.migrateLegacyUsers();
  await workspaceRepository.migrateLegacyWorkspaces();

  const app = express();
  const server = createServer(app);

  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY === "true") app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  const allowedOrigins = new Set([
    process.env.APP_ORIGIN,
    ...(process.env.NODE_ENV === "production" ? [] : ["http://localhost:3000", "http://127.0.0.1:3000"]),
  ].filter((origin): origin is string => Boolean(origin)));
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error("Origin is not allowed by the application CORS policy."));
    },
  }));
  app.use(express.json({ limit: "1mb" }));

  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false });
  const resetLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: "draft-8", legacyHeaders: false });

  app.get("/api/health", (_req, res) => {
    return res.json({
      ok: true,
      service: "smartsize-api",
      mode: "workspace",
      accountStorage: isDatabaseConfigured() ? "mysql" : "json-development-fallback",
      awsIntegration: "backend-read-only",
    });
  });
  app.get("/api/workspace", requireVerifiedSession, (req, res) => {
    return res.json({ workspace: req.workspace });
  });
  app.get("/api/workspaces", requireVerifiedSession, async (req, res) => {
    const workspace = await workspaceRepository.getDefaultForUser(req.user!.id);
    return res.json({ workspaces: workspace ? [workspace] : [] });
  });
  app.post("/api/workspaces", requireVerifiedSession, async (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (name.length < 2 || name.length > 120) return res.status(400).json({ error: "Workspace name must be between 2 and 120 characters." });
    const workspace = await workspaceRepository.createForUser(req.user!, name);
    return res.status(201).json({ workspace });
  });
  app.patch("/api/workspace/preferences", requireVerifiedSession, async (req, res) => {
    const updates: { workspaceName?: string; environmentMode?: "demo" | "aws" | "manual" } = {};
    if (req.body?.workspaceName !== undefined) {
      if (typeof req.body.workspaceName !== "string" || req.body.workspaceName.trim().length < 2 || req.body.workspaceName.trim().length > 120) {
        return res.status(400).json({ error: "Workspace name must be between 2 and 120 characters." });
      }
      updates.workspaceName = req.body.workspaceName.trim();
    }
    if (req.body?.environmentMode !== undefined) {
      if (!["demo", "aws", "manual"].includes(req.body.environmentMode)) {
        return res.status(400).json({ error: "Environment must be demo, manual, or aws." });
      }
      if (req.body.environmentMode === "aws") {
        const account = await workspaceRepository.getAwsAccount(req.workspace!.id);
        if (!account || account.status !== "connected") {
          return res.status(409).json({ error: "AWS is not connected. Live mode cannot be selected until a verified AWS integration is available." });
        }
      }
      updates.environmentMode = req.body.environmentMode;
    }
    if (Object.keys(req.body ?? {}).some((key) => !["workspaceName", "environmentMode"].includes(key))) {
      return res.status(400).json({ error: "Unsupported workspace preference." });
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: "No workspace preferences were provided." });
    const workspaceUpdates: { name?: string; environment?: "demo" | "aws" | "manual" } = {};
    if (updates.workspaceName !== undefined) workspaceUpdates.name = updates.workspaceName;
    if (updates.environmentMode !== undefined) workspaceUpdates.environment = updates.environmentMode;
    const workspace = await workspaceRepository.updateForUser(req.user!.id, req.workspace!.id, workspaceUpdates);
    if (!workspace) return res.status(403).json({ error: "Workspace membership or owner/admin permission is required." });
    const user = await userRepository.update(req.user!.id, {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      environmentMode: workspace.environment ?? undefined,
    });
    if (!user) return res.status(404).json({ error: "Workspace account was not found." });
    return res.json({ user: serializeUser({ ...user, workspaceId: workspace.id, workspaceName: workspace.name, environmentMode: workspace.environment ?? undefined }) });
  });
  app.post("/api/aws/connect", requireVerifiedSession, async (req, res) => {
    const requestedRegion = typeof req.body?.region === "string" ? req.body.region : undefined;
    if (requestedRegion && !/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(requestedRegion)) {
      return res.status(400).json({ error: "A valid AWS region is required." });
    }
    const service = createAwsReadOnlyService({ region: requestedRegion });
    const identity = await service.getIdentity();
    if (identity.status !== "ready") {
      return res.status(503).json({
        code: identity.category,
        error: identity.message,
        status: "not_connected",
      });
    }
    const workspace = await workspaceRepository.saveAwsIdentity(req.user!.id, req.workspace!.id, identity);
    if (!workspace) return res.status(403).json({ error: "Workspace owner/admin permission is required to connect AWS." });
    await userRepository.update(req.user!.id, {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      environmentMode: workspace.environment ?? undefined,
    });
    return res.json({
      status: "connected",
      accountId: identity.accountId,
      arn: identity.arn,
      region: identity.region,
      workspace,
    });
  });
  app.get("/api/aws/status", requireVerifiedSession, async (req, res) => {
    const account = await workspaceRepository.getAwsAccount(req.workspace!.id);
    const service = createAwsReadOnlyService({ region: account?.region });
    const health = await service.getHealth();
    const isConnected = health.identity.status === "ready"
      && account?.status === "connected"
      && account.accountId === health.identity.accountId;
    return res.json({
      source: "aws",
      workspaceEnvironment: req.workspace!.environment,
      status: isConnected ? "connected" : "not_connected",
      accountId: health.identity.status === "ready" ? health.identity.accountId : account?.accountId ?? null,
      region: health.region,
      syncedAt: account?.syncedAt ?? null,
      identity: health.identity,
      services: health.services,
    });
  });
  app.post("/api/aws/sync", requireVerifiedSession, async (req, res) => {
    const requestedRegion = typeof req.body?.region === "string" ? req.body.region : undefined;
    if (requestedRegion && !/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(requestedRegion)) {
      return res.status(400).json({ error: "A valid AWS region is required." });
    }
    const existing = await workspaceRepository.getAwsAccount(req.workspace!.id);
    const service = createAwsReadOnlyService({ region: requestedRegion ?? existing?.region });
    const identity = await service.getIdentity();
    if (identity.status !== "ready") {
      return res.status(503).json({ code: identity.category, error: identity.message });
    }
    if (!existing || existing.accountId !== identity.accountId) {
      return res.status(409).json({ error: "Connect this verified AWS account to the workspace before syncing." });
    }
    if (!isDatabaseConfigured()) {
      return res.status(503).json({ error: "Live synchronization requires DATABASE_URL to persist workspace-scoped AWS data." });
    }
    const inventoryResult = await service.getEc2Inventory();
    if (inventoryResult.status !== "ready") {
      return res.status(502).json({ code: inventoryResult.category, error: inventoryResult.message });
    }
    const [metricsResult, optimizerResult, costResult] = await Promise.all([
      service.getCloudWatchMetrics(inventoryResult.data.instances.map((instance) => instance.instanceId)),
      service.getComputeOptimizerRecommendations(),
      service.getCostExplorer(),
    ]);
    const persisted = await workspaceDataRepository.persistAwsSync(
      req.workspace!.id,
      inventoryResult.data,
      metricsResult.status === "ready" ? metricsResult.data : { periodSeconds: 3600, startTime: "", endTime: "", metrics: [] },
      optimizerResult.status === "ready" ? optimizerResult.recommendations : [],
      inventoryResult.region,
      costResult.status === "ready" ? costResult : undefined,
    );
    return res.json({
      status: "synced",
      accountId: identity.accountId,
      region: identity.region,
      inventory: persisted,
      serviceResults: {
        cloudWatch: metricsResult.status === "ready" ? "available" : metricsResult.category,
        computeOptimizer: optimizerResult.status,
        costExplorer: costResult.status === "ready" ? "available" : costResult.category,
      },
      messages: [
        ...(metricsResult.status === "unavailable" ? [metricsResult.message] : []),
        ...(optimizerResult.status !== "ready" ? [optimizerResult.message] : []),
        ...(costResult.status === "unavailable" ? [costResult.message] : []),
      ],
    });
  });
  app.get("/api/aws/inventory", requireVerifiedSession, async (req, res) => {
    if (req.workspace!.environment !== "aws") {
      return res.status(409).json({ error: "Select the connected AWS environment to view live inventory." });
    }
    if (!isDatabaseConfigured()) return res.status(503).json({ error: "Live AWS inventory requires DATABASE_URL." });
    return res.json(await workspaceDataRepository.getAwsSnapshot(req.workspace!.id));
  });
  app.get("/api/manual-analyses", requireVerifiedSession, async (req, res) => {
    if (req.workspace!.environment !== "manual") {
      return res.status(409).json({ code: "MANUAL_MODE_REQUIRED", error: "Select Manual Analysis mode to view manual analyses." });
    }
    return res.json(await workspaceDataRepository.getManualAnalyses(req.workspace!.id));
  });
  app.post("/api/manual-analyses", requireVerifiedSession, async (req, res) => {
    if (req.workspace!.environment !== "manual") {
      return res.status(409).json({ code: "MANUAL_MODE_REQUIRED", error: "Select Manual Analysis mode before submitting infrastructure details." });
    }
    if (!validateManualAnalysisInput(req.body)) {
      return res.status(422).json({ error: "Manual analysis input is invalid. Check required fields, utilization ranges, costs, and selected options." });
    }
    const input = {
      ...req.body,
      resourceName: req.body.resourceName.trim(),
      currentConfiguration: req.body.currentConfiguration.trim(),
      region: req.body.region.trim(),
    };
    const analysisId = crypto.randomUUID();
    const record = {
      id: analysisId,
      resourceId: `manual-resource-${analysisId}`,
      recommendationId: `manual-rec-${analysisId}`,
      createdBy: req.user!.email,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      input,
      result: analyzeManualInfrastructure(input),
      status: "Analyzed" as const,
      simulation: null,
    };
    const created = await workspaceDataRepository.createManualAnalysis(req.workspace!.id, req.user!, record);
    return res.status(201).json(created);
  });
  app.get("/api/manual-analyses/:id", requireVerifiedSession, async (req, res) => {
    if (req.workspace!.environment !== "manual") {
      return res.status(409).json({ code: "MANUAL_MODE_REQUIRED", error: "Select Manual Analysis mode to view this analysis." });
    }
    const analysis = await workspaceDataRepository.getManualAnalysis(req.workspace!.id, req.params.id);
    return analysis ? res.json(analysis) : res.status(404).json({ error: "Manual analysis not found in this workspace." });
  });
  app.post("/api/manual-analyses/:id/simulate", requireVerifiedSession, async (req, res) => {
    if (req.workspace!.environment !== "manual") {
      return res.status(409).json({ code: "MANUAL_MODE_REQUIRED", error: "Select Manual Analysis mode to simulate this recommendation." });
    }
    const analysis = await workspaceDataRepository.simulateManualAnalysis(req.workspace!.id, req.params.id, req.user!);
    return analysis ? res.json(analysis) : res.status(404).json({ error: "Manual analysis was not found or is already finalized." });
  });
  app.post("/api/manual-analyses/:id/decision", requireVerifiedSession, async (req, res) => {
    if (req.workspace!.environment !== "manual") {
      return res.status(409).json({ code: "MANUAL_MODE_REQUIRED", error: "Select Manual Analysis mode to review this recommendation." });
    }
    const status = req.body?.status;
    if (status !== "Approved" && status !== "Rejected") {
      return res.status(422).json({ error: "Decision must be Approved or Rejected." });
    }
    if (req.body?.note !== undefined && (typeof req.body.note !== "string" || req.body.note.length > 500)) {
      return res.status(422).json({ error: "Decision note must be 500 characters or fewer." });
    }
    const analysis = await workspaceDataRepository.decideManualAnalysis(req.workspace!.id, req.params.id, status, req.user!, req.body.note);
    return analysis ? res.json(analysis) : res.status(409).json({ error: "Run the simulation before finalizing the manual recommendation." });
  });
  app.get("/api/auth/providers", (_req, res) => res.json({
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  }));
  app.get("/api/auth/session", async (req, res, next) => {
    try {
      return res.json({ user: await readSession(req) || null });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/auth/register", authLimiter, async (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const confirmPassword = typeof req.body?.confirmPassword === "string" ? req.body.confirmPassword : "";

    if (!name || name.length < 2 || name.length > 100) return res.status(400).json({ error: "Provide a name between 2 and 100 characters." });
    if (!emailPattern.test(email) || email.length > 254) return res.status(400).json({ error: "Enter a valid email address of at most 254 characters." });
    if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) return res.status(400).json({ error: "Password must be at least 8 characters and no more than 72 UTF-8 bytes." });
    if (password !== confirmPassword) return res.status(400).json({ error: "Passwords do not match." });

    const existing = await userRepository.getByEmail(email);
    if (existing) return res.status(409).json({ error: "An account with this email already exists." });

    const authMode = getAuthMode();
    const emailConfigured = isEmailDeliveryConfigured();
    if (authMode === "production" && !emailConfigured) {
      return res.status(503).json({ error: "Production email verification is not configured. Set EMAIL_PROVIDER and the provider credentials before accepting registrations." });
    }

    const requiresVerification = authMode === "production";
    const rawVerificationToken = requiresVerification ? crypto.randomBytes(32).toString("hex") : null;
    const userId = crypto.randomUUID();
    const user = await userRepository.save({
      id: userId,
      email,
      name,
      provider: "email",
      role: "Platform Admin",
      passwordHash: await bcrypt.hash(password, 12),
      emailVerified: !requiresVerification,
      workspaceName: `${name}'s Workspace`,
      verificationToken: rawVerificationToken ? crypto.createHash("sha256").update(rawVerificationToken).digest("hex") : null,
      verificationTokenExpiresAt: requiresVerification ? new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString() : null,
      createdAt: new Date().toISOString(),
    });
    if (user.id !== userId) return res.status(409).json({ error: "An account with this email already exists." });

    if (requiresVerification && rawVerificationToken) {
      try {
        await sendAccountEmail({ email, name, token: rawVerificationToken, purpose: "verification" });
      } catch (error) {
        await userRepository.delete(user.id);
        console.error("Email verification delivery failed.", error);
        return res.status(502).json({ error: "Account verification email could not be delivered. No account was created; please try again later." });
      }
    }

    const workspace = await workspaceRepository.createForUser(user, user.workspaceName ?? `${name}'s Workspace`);
    const userWithWorkspace = await userRepository.update(user.id, {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
    });
    if (!userWithWorkspace) return res.status(500).json({ error: "Account was created, but its workspace could not be loaded." });
    await workspaceDataRepository.recordAudit(workspace.id, userWithWorkspace, "USER_REGISTERED", "SmartSize workspace", "Created");

    const developmentToken = requiresVerification && rawVerificationToken && !emailConfigured && process.env.NODE_ENV !== "production"
      ? rawVerificationToken
      : undefined;
    return res.status(201).json({
      message: requiresVerification
        ? "Account created. Verify your email to activate your SmartSize workspace."
        : "Account created successfully. You can now sign in to the demo workspace.",
      verificationRequired: requiresVerification,
      ...(developmentToken ? { developmentToken, developmentOnly: true } : {}),
      emailDeliveryConfigured: emailConfigured,
      authMode,
      user: serializeUser({ ...userWithWorkspace, workspaceId: workspace.id, workspaceName: workspace.name }),
    });
  });

  app.post("/api/auth/verify-email", authLimiter, async (req, res) => {
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (!token) return res.status(400).json({ error: "Verification code is required." });

    const user = await userRepository.findByVerificationToken(token);
    if (!user) return res.status(400).json({ error: "Verification code is invalid or expired." });

    const updatedUser = await userRepository.update(user.id, {
      emailVerified: true,
      verificationToken: null,
      verificationTokenExpiresAt: null,
    });

    if (!updatedUser) return res.status(500).json({ error: "Unable to verify account." });
    const workspace = await workspaceRepository.getDefaultForUser(updatedUser.id);
    if (workspace) await workspaceDataRepository.recordAudit(workspace.id, updatedUser, "EMAIL_VERIFIED", "Account", "Verified");
    return res.json({ message: "Email verified successfully. You can now sign in.", user: serializeUser(updatedUser) });
  });

  app.post("/api/auth/login", authLimiter, async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!emailPattern.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
    if (!password) return res.status(400).json({ error: "Password is required." });

    const user = await userRepository.getByEmail(email);
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    if (!user.emailVerified) {
      return res.status(403).json({
        error: "Email verification required.",
        verificationRequired: true,
      });
    }

    setSession(res, user);
    const workspace = await workspaceRepository.getDefaultForUser(user.id);
    if (workspace) await workspaceDataRepository.recordAudit(workspace.id, user, "LOGIN", "SmartSize workspace", "Authenticated");
    return res.json({ user: serializeUser(user) });
  });

  app.post("/api/auth/logout", async (req, res, next) => {
    clearSession(res);
    try {
      const user = await readSession(req);
      if (user) {
        await invalidateSession(user);
        if (user.workspaceId) await workspaceDataRepository.recordAudit(user.workspaceId, user, "LOGOUT", "SmartSize workspace", "Signed out");
      }
      return res.status(204).end();
    } catch (error) {
      console.error("Session revocation failed during logout.", error);
      return next(error);
    }
  });

  app.post("/api/auth/request-password-reset", resetLimiter, async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!emailPattern.test(email)) return res.status(400).json({ error: "Enter a valid email address." });

    const user = await userRepository.getByEmail(email);
    let developmentToken: string | undefined;
    if (user) {
      const resetToken = crypto.randomBytes(24).toString("hex");
      await userRepository.update(user.id, {
        resetToken: crypto.createHash("sha256").update(resetToken).digest("hex"),
        resetTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
      });
      try {
        const delivery = await sendAccountEmail({ email, name: user.name, token: resetToken, purpose: "password-reset" });
        if (delivery.delivery === "development") developmentToken = delivery.developmentToken;
      } catch (error) {
        await userRepository.update(user.id, { resetToken: null, resetTokenExpiresAt: null });
        console.error("Password reset email delivery failed.", error);
        return res.status(502).json({ error: "Password reset email could not be delivered. Please try again later." });
      }
      const workspace = await workspaceRepository.getDefaultForUser(user.id);
      if (workspace) await workspaceDataRepository.recordAudit(workspace.id, user, "PASSWORD_RESET_REQUESTED", "Account", "Pending");
    }

    return res.json({
      message: "If an account exists for that email, a secure reset link has been issued.",
      ...(developmentToken && process.env.NODE_ENV !== "production" ? { developmentToken, developmentOnly: true } : {}),
    });
  });

  app.post("/api/auth/reset-password", resetLimiter, async (req, res) => {
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const confirmPassword = typeof req.body?.confirmPassword === "string" ? req.body.confirmPassword : "";

    if (!token) return res.status(400).json({ error: "Reset token is required." });
    if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) return res.status(400).json({ error: "Password must be at least 8 characters and no more than 72 UTF-8 bytes." });
    if (password !== confirmPassword) return res.status(400).json({ error: "Passwords do not match." });

    const user = await userRepository.findByResetToken(token);
    if (!user) return res.status(400).json({ error: "Reset token is invalid or expired." });

    const updatedUser = await userRepository.update(user.id, {
      passwordHash: await bcrypt.hash(password, 12),
      resetToken: null,
      resetTokenExpiresAt: null,
      sessionVersion: (user.sessionVersion ?? 0) + 1,
    });

    if (!updatedUser) return res.status(500).json({ error: "Unable to update password." });
    const workspace = await workspaceRepository.getDefaultForUser(updatedUser.id);
    if (workspace) await workspaceDataRepository.recordAudit(workspace.id, updatedUser, "PASSWORD_RESET", "Account", "Updated");
    return res.json({ message: "Password updated successfully." });
  });

  app.post("/api/auth/demo", authLimiter, async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!emailPattern.test(email)) return res.status(400).json({ error: "Enter a valid email address." });

    const user = await userRepository.getByEmail(email);
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: "This SmartSize account is not available. Please create an account first." });
    }

    const validPassword = await bcrypt.compare(password || "", user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid SmartSize credentials." });
    }

    if (!user.emailVerified) {
      return res.status(403).json({ error: "Email verification required.", verificationRequired: true });
    }

    setSession(res, user);
    const workspace = await workspaceRepository.getDefaultForUser(user.id);
    if (workspace) await workspaceDataRepository.recordAudit(workspace.id, user, "DEMO_LOGIN", "SmartSize workspace", "Authenticated");
    return res.json({ user: serializeUser(user) });
  });

  app.post("/api/auth/demo-session", authLimiter, async (_req, res) => {
    const user = await createDemoUser();
    setSession(res, user);
    const workspace = await workspaceRepository.getDefaultForUser(user.id);
    if (workspace) await workspaceDataRepository.recordAudit(workspace.id, user, "DEMO_ENTERED", "Demo dataset", "Authenticated");
    return res.json({ user: serializeUser(user) });
  });

  app.get("/api/auth/google/start", authLimiter, (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) return res.status(503).json({ error: "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET." });
    const origin = process.env.APP_ORIGIN || `${req.protocol}://${req.get("host")}`;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${origin}/api/auth/google/callback`;
    const state = createOAuthState(res);
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("access_type", "offline");
    return res.redirect(url.toString());
  });

  app.get("/api/auth/google/callback", authLimiter, async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    if (!code || !verifyOAuthState(req, state)) return res.status(400).send("Invalid Google OAuth callback.");

    try {
      const origin = process.env.APP_ORIGIN || `${req.protocol}://${req.get("host")}`;
      const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${origin}/api/auth/google/callback`;
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID || "",
          client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      if (!tokenResponse.ok) return res.status(502).send("Google token exchange failed.");
      const tokens = await tokenResponse.json() as { access_token?: string };
      const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (!profileResponse.ok) return res.status(502).send("Google profile lookup failed.");
      const profile = await profileResponse.json() as { sub: string; email: string; name?: string; picture?: string };
      const user = await userRepository.save({
        id: `google-${profile.sub}`,
        email: profile.email,
        name: profile.name || profile.email,
        avatar: profile.picture,
        provider: "google",
        role: "Platform Admin",
        emailVerified: true,
        createdAt: new Date().toISOString(),
      });
      setSession(res, user);
      return res.redirect(`${origin}/overview`);
    } catch {
      return res.status(502).send("Google sign-in is temporarily unavailable.");
    }
  });

  app.get("/api/dashboard", requireVerifiedSession, async (req, res) => {
    if (!requireDemoEnvironment(req, res)) return;
    const workspaceId = req.workspace!.id;
    return res.json({
      resources: await workspaceDataRepository.getResources(workspaceId),
      recommendations: await workspaceDataRepository.getRecommendations(workspaceId),
      simulations: await workspaceDataRepository.getSimulations(workspaceId),
      activity: await workspaceDataRepository.getAudit(workspaceId),
    });
  });
  app.get("/api/resources", requireVerifiedSession, async (req, res) => {
    if (!requireDemoEnvironment(req, res)) return;
    return res.json(await workspaceDataRepository.getResources(req.workspace!.id));
  });
  app.get("/api/resources/:id", requireVerifiedSession, async (req, res) => {
    if (!requireDemoEnvironment(req, res)) return;
    const workspaceId = req.workspace!.id;
    const resource = await workspaceDataRepository.getResource(workspaceId, req.params.id);
    if (!resource) return res.status(404).json({ error: "Resource not found" });
    const recommendation = (await workspaceDataRepository.getRecommendations(workspaceId)).find((item) => item.resourceId === req.params.id);
    return res.json({ resource, recommendation: recommendation ? { ...recommendation, analysis: analyzeRecommendation(recommendation, resource) } : null });
  });
  app.get("/api/recommendations", requireVerifiedSession, async (req, res) => {
    if (!requireDemoEnvironment(req, res)) return;
    return res.json(await workspaceDataRepository.getRecommendations(req.workspace!.id));
  });
  app.get("/api/recommendations/:id", requireVerifiedSession, async (req, res) => {
    if (!requireDemoEnvironment(req, res)) return;
    const workspaceId = req.workspace!.id;
    const recommendation = (await workspaceDataRepository.getRecommendations(workspaceId)).find((item) => item.id === req.params.id);
    if (!recommendation) return res.status(404).json({ error: "Recommendation not found" });
    const resource = await workspaceDataRepository.getResource(workspaceId, recommendation.resourceId);
    if (!resource) return res.status(404).json({ error: "Recommendation resource not found" });
    return res.json({ recommendation, resource, analysis: analyzeRecommendation(recommendation, resource) });
  });
  app.get("/api/activity", requireVerifiedSession, async (req, res) => {
    if (!requireDemoOrManualEnvironment(req, res)) return;
    return res.json(await workspaceDataRepository.getAudit(req.workspace!.id));
  });
  app.get("/api/audit", requireVerifiedSession, async (req, res) => {
    if (!requireDemoOrManualEnvironment(req, res)) return;
    return res.json(await workspaceDataRepository.getAudit(req.workspace!.id));
  });
  app.get("/api/actions", requireVerifiedSession, async (req, res) => {
    if (!requireDemoOrManualEnvironment(req, res)) return;
    const source = req.workspace!.environment === "manual" ? "SMARTSIZE_MANUAL" : "DEMO";
    return res.json(await workspaceDataRepository.getActions(req.workspace!.id, source));
  });
  app.get("/api/policies", requireVerifiedSession, async (req, res) => {
    if (!requireDemoEnvironment(req, res)) return;
    return res.json(await workspaceDataRepository.getPolicies(req.workspace!.id));
  });
  app.put("/api/policies/:id", requireVerifiedSession, async (req, res) => {
    if (!requireDemoEnvironment(req, res)) return;
    const allowed = ["autoExecution", "approvalRequired", "maximumRisk"] as const;
    const updates: Partial<Omit<RightsizingPolicy, "id" | "environment">> = {};
    if (req.body?.autoExecution !== undefined) {
      if (typeof req.body.autoExecution !== "boolean") return res.status(400).json({ error: "autoExecution must be a boolean" });
      updates.autoExecution = req.body.autoExecution;
    }
    if (req.body?.approvalRequired !== undefined) {
      if (typeof req.body.approvalRequired !== "boolean") return res.status(400).json({ error: "approvalRequired must be a boolean" });
      updates.approvalRequired = req.body.approvalRequired;
    }
    if (req.body?.maximumRisk !== undefined) {
      if (!["Low", "Medium", "High"].includes(req.body.maximumRisk)) return res.status(400).json({ error: "maximumRisk must be Low, Medium, or High" });
      updates.maximumRisk = req.body.maximumRisk;
    }
    if (Object.keys(req.body ?? {}).some((key) => !allowed.includes(key as typeof allowed[number]))) {
      return res.status(400).json({ error: "Policy contains unsupported fields" });
    }
    if (req.params.id === "production" && updates.approvalRequired === false) {
      return res.status(409).json({ error: "Production policy must retain mandatory human approval." });
    }
    const policy = await workspaceDataRepository.updatePolicy(req.workspace!.id, req.params.id, updates, req.user!);
    return policy ? res.json(policy) : res.status(404).json({ error: "Policy not found" });
  });
  app.post("/api/policies/:id/simulate", requireVerifiedSession, async (req, res) => {
    if (!requireDemoEnvironment(req, res)) return;
    const workspaceId = req.workspace!.id;
    const policy = (await workspaceDataRepository.getPolicies(workspaceId)).find((item) => item.id === req.params.id);
    if (!policy) return res.status(404).json({ error: "Policy not found" });
    const riskRank = { Low: 1, Medium: 2, High: 3 };
    const recommendations = await workspaceDataRepository.getRecommendations(workspaceId);
    const resources = await workspaceDataRepository.getResources(workspaceId);
    const eligible = recommendations.filter((recommendation) => {
      const resource = resources.find((item) => item.id === recommendation.resourceId);
      return Boolean(resource && resource.env === policy.environment && recommendation.status !== "Rejected" && riskRank[recommendation.risk] <= riskRank[policy.maximumRisk]);
    });
    const blocked = recommendations.filter((recommendation) => {
      const resource = resources.find((item) => item.id === recommendation.resourceId);
      return Boolean(resource && resource.env === policy.environment && recommendation.status !== "Rejected" && riskRank[recommendation.risk] > riskRank[policy.maximumRisk]);
    });
    return res.json({
      environment: policy.environment,
      eligibleCount: eligible.length,
      potentialMonthlySavings: eligible.reduce((sum, item) => sum + item.savings, 0),
      approvalRequiredCount: policy.approvalRequired ? eligible.length : 0,
      blockedCount: blocked.length,
      executionMode: "Simulation only; no AWS resources will be modified.",
    });
  });
  app.get("/api/savings", requireVerifiedSession, async (req, res) => {
    if (req.workspace!.environment === "manual") {
      const analyses = await workspaceDataRepository.getManualAnalyses(req.workspace!.id);
      const actions = await workspaceDataRepository.getActions(req.workspace!.id, "SMARTSIZE_MANUAL");
      const eligible = analyses.filter((analysis) => analysis.status !== "Rejected");
      const currentMonthlySpend = eligible.reduce((sum, analysis) => sum + (analysis.result.currentMonthlyCost ?? 0), 0);
      const potentialMonthlySavings = eligible.reduce((sum, analysis) => sum + (analysis.result.potentialMonthlySavings ?? 0), 0);
      const simulatedMonthlySavings = analyses
        .filter((analysis) => analysis.status === "Simulated" || analysis.status === "Approved")
        .reduce((sum, analysis) => sum + (analysis.result.potentialMonthlySavings ?? 0), 0);
      return res.json({
        currency: "INR",
        currentMonthlySpend,
        potentialMonthlySavings,
        projectedAnnualSavings: potentialMonthlySavings * 12,
        simulatedMonthlySavings,
        verifiedSavings: 0,
        verifiedSavingsNote: "Manual analyses are estimates. No infrastructure changes or savings have been verified.",
        actions,
      });
    }
    if (!requireDemoEnvironment(req, res)) return;
    const workspaceId = req.workspace!.id;
    const recommendations = await workspaceDataRepository.getRecommendations(workspaceId);
    const actions = await workspaceDataRepository.getActions(workspaceId, "DEMO");
    const potentialMonthly = recommendations.filter((item) => item.status !== "Rejected").reduce((sum, item) => sum + item.savings, 0);
    const simulatedMonthly = actions.filter((item) => item.status === "Simulated").reduce((sum, action) => sum + (recommendations.find((item) => item.id === action.recommendationId)?.savings ?? 0), 0);
    const resources = await workspaceDataRepository.getResources(workspaceId);
    return res.json({
      currency: "INR",
      currentMonthlySpend: resources.reduce((sum, item) => sum + item.monthlyCost, 0),
      potentialMonthlySavings: potentialMonthly,
      projectedAnnualSavings: potentialMonthly * 12,
      simulatedMonthlySavings: simulatedMonthly,
      verifiedSavings: 0,
      verifiedSavingsNote: "No live AWS changes have been executed or verified.",
      actions,
    });
  });
  app.get("/api/reports", requireVerifiedSession, async (req, res) => {
    if (!requireDemoOrManualEnvironment(req, res)) return;
    return res.json(await workspaceDataRepository.getReports(
      req.workspace!.id,
      req.workspace!.environment === "manual" ? "manual" : "demo",
    ));
  });
  app.post("/api/reports", requireVerifiedSession, async (req, res) => {
    if (!requireDemoOrManualEnvironment(req, res)) return;
    const requestedName = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (requestedName.length > 120) return res.status(400).json({ error: "Report name must be 120 characters or fewer." });
    const workspaceId = req.workspace!.id;
    if (req.workspace!.environment === "manual") {
      const analyses = await workspaceDataRepository.getManualAnalyses(workspaceId);
      const eligible = analyses.filter((analysis) => analysis.status !== "Rejected");
      const monthlySavings = eligible.reduce((sum, analysis) => sum + (analysis.result.potentialMonthlySavings ?? 0), 0);
      const report = await workspaceDataRepository.createReport(workspaceId, {
        name: requestedName || `Manual Analysis Report · ${new Date().toLocaleDateString("en-IN")}`,
        createdBy: req.user!.email,
        environmentMode: "manual",
        summary: {
          totalResources: analyses.length,
          totalRecommendations: analyses.length,
          openRecommendations: analyses.filter((analysis) => analysis.status === "Analyzed" || analysis.status === "Simulated").length,
          currentMonthlySpend: eligible.reduce((sum, analysis) => sum + (analysis.result.currentMonthlyCost ?? 0), 0),
          potentialMonthlySavings: monthlySavings,
          projectedAnnualSavings: monthlySavings * 12,
          verifiedSavings: 0,
        },
      }, req.user!);
      return res.status(201).json(report);
    }
    const recommendations = await workspaceDataRepository.getRecommendations(workspaceId);
    const potentialMonthlySavings = recommendations
      .filter((item) => item.status !== "Rejected")
      .reduce((sum, item) => sum + item.savings, 0);
    const resources = await workspaceDataRepository.getResources(workspaceId);
    const report = await workspaceDataRepository.createReport(workspaceId, {
      name: requestedName || `Optimization Report · ${new Date().toLocaleDateString("en-IN")}`,
      createdBy: req.user!.email,
      environmentMode: "demo",
      summary: {
        totalResources: resources.length,
        totalRecommendations: recommendations.length,
        openRecommendations: recommendations.filter((item) => item.status === "Open" || item.status === "Reviewed").length,
        currentMonthlySpend: resources.reduce((sum, item) => sum + item.monthlyCost, 0),
        potentialMonthlySavings,
        projectedAnnualSavings: potentialMonthlySavings * 12,
        verifiedSavings: 0,
      },
    }, req.user!);
    return res.status(201).json(report);
  });
  app.get("/api/reports/export.csv", requireVerifiedSession, async (req, res) => {
    if (!requireDemoOrManualEnvironment(req, res)) return;
    const quote = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    if (req.workspace!.environment === "manual") {
      const rows = [
        ["Resource", "Provider", "Region", "Current configuration", "Suggested configuration", "Current monthly cost", "Estimated optimized monthly cost", "Potential monthly savings", "Annual potential savings", "Risk", "Analysis confidence", "Status", "Source"],
        ...(await workspaceDataRepository.getManualAnalyses(req.workspace!.id)).map((analysis) => [
          analysis.input.resourceName,
          analysis.input.provider,
          analysis.input.region,
          analysis.input.currentConfiguration,
          analysis.result.suggestedConfiguration,
          analysis.result.currentMonthlyCost ?? "",
          analysis.result.estimatedOptimizedMonthlyCost ?? "",
          analysis.result.potentialMonthlySavings ?? "",
          analysis.result.potentialAnnualSavings ?? "",
          analysis.result.risk,
          `${analysis.result.analysisConfidence}%`,
          analysis.status,
          analysis.result.source,
        ]),
      ];
      res.type("text/csv");
      res.setHeader("Content-Disposition", 'attachment; filename="smartsize-manual-analysis-report.csv"');
      return res.send(rows.map((row) => row.map((value) => quote(String(value))).join(",")).join("\r\n"));
    }
    const rows = [
      ["Resource", "AWS resource ID", "Region", "Environment", "Current configuration", "Recommended configuration", "Monthly savings (INR)", "Risk", "Confidence", "Status"],
      ...(await workspaceDataRepository.getRecommendations(req.workspace!.id)).map((item) => {
        const resource = seedResources.find((candidate) => candidate.id === item.resourceId);
        return [item.resourceName, resource?.instanceId ?? "", resource?.region ?? "", resource?.env ?? "", item.current, item.recommended, item.savings, item.risk, `${item.confidence}%`, item.status];
      }),
    ];
    res.type("text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="smartsize-optimization-report.csv"');
    return res.send(rows.map((row) => row.map(quote).join(",")).join("\r\n"));
  });
  app.post("/api/ai/advisor", requireVerifiedSession, async (req, res) => {
    if (!requireDemoEnvironment(req, res)) {
      return res.status(503).json({ code: "AWS_ANALYSIS_NOT_READY", error: "Live AWS analysis is not available yet." });
    }
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message) return res.status(400).json({ error: "Ask a question about your SmartSize data." });
    if (message.length > 1000) return res.status(400).json({ error: "Advisor questions must be 1000 characters or fewer." });
    try {
      return res.json(await answerAdvisor(message));
    } catch {
      return res.status(502).json({ error: "The AI Advisor is temporarily unavailable. Your SmartSize data is still available for review." });
    }
  });
  app.post("/api/recommendations/:id/decision", requireVerifiedSession, async (req, res) => {
    if (!requireDemoEnvironment(req, res)) return;
    const status = req.body?.status;
    if (status !== "Approved" && status !== "Rejected") return res.status(400).json({ error: "Decision must be Approved or Rejected" });
    if (req.body?.note !== undefined && (typeof req.body.note !== "string" || req.body.note.length > 500)) return res.status(400).json({ error: "Decision note must be a string of 500 characters or fewer" });
    const workspaceId = req.workspace!.id;
    const current = (await workspaceDataRepository.getRecommendations(workspaceId)).find((item) => item.id === req.params.id);
    if (!current) return res.status(404).json({ error: "Recommendation not found" });
    if (current.status === "Approved" || current.status === "Rejected") return res.status(409).json({ error: `Recommendation is already ${current.status.toLowerCase()}` });
    const recommendation = await workspaceDataRepository.updateRecommendation(workspaceId, req.params.id, status, req.user!, req.body?.note);
    return recommendation ? res.json(recommendation) : res.status(404).json({ error: "Recommendation not found" });
  });
  app.post("/api/recommendations/:id/simulate", requireVerifiedSession, async (req, res) => {
    if (!requireDemoEnvironment(req, res)) return;
    const workspaceId = req.workspace!.id;
    const recommendation = (await workspaceDataRepository.getRecommendations(workspaceId)).find((item) => item.id === req.params.id);
    if (!recommendation) return res.status(404).json({ error: "Recommendation not found" });
    const resource = await workspaceDataRepository.getResource(workspaceId, recommendation.resourceId);
    if (!resource) return res.status(404).json({ error: "Recommendation resource not found" });
    const analysis = analyzeRecommendation(recommendation, resource);
    await workspaceDataRepository.recordAudit(workspaceId, req.user!, "SIMULATION_PREVIEWED", recommendation.resourceId, "Simulation only", "No AWS resource was modified.");
    return res.json({
      currentMonthlyCost: recommendation.currentCost,
      estimatedMonthlyCost: recommendation.optimizedCost,
      monthlySavings: recommendation.savings,
      annualizedSavings: recommendation.savings * 12,
      estimatedUtilizationImpact: { currentAverageCpu: resource.cpu, currentPeakCpu: resource.peakCpu, currentAverageMemory: resource.memory, currentPeakMemory: resource.peakMemory },
      risk: recommendation.risk,
      opportunityScore: analysis.opportunity_score,
      result: "Simulation only. No AWS resource was modified.",
    });
  });
  app.post("/api/simulations", requireVerifiedSession, async (req, res) => {
    if (!requireDemoEnvironment(req, res)) return;
    const recommendationIds = req.body?.recommendationIds;
    if (!Array.isArray(recommendationIds) || recommendationIds.some((id: unknown) => typeof id !== "string")) {
      return res.status(400).json({ error: "recommendationIds must be an array of recommendation IDs." });
    }
    if (!recommendationIds.length) return res.status(400).json({ error: "Select at least one recommendation" });
    const workspaceId = req.workspace!.id;
    const recommendations = (await workspaceDataRepository.getRecommendations(workspaceId)).filter((item) => recommendationIds.includes(item.id));
    if (recommendations.length !== new Set(recommendationIds).size) return res.status(404).json({ error: "One or more recommendations were not found" });
    if (typeof req.body?.name === "string" && req.body.name.trim().length > 120) return res.status(400).json({ error: "Scenario name must be 120 characters or fewer." });
    if (req.body?.name !== undefined && typeof req.body.name !== "string") return res.status(400).json({ error: "Scenario name must be a string." });
    const monthlySavings = recommendations.reduce((total, item) => total + item.savings, 0);
    const resources = await workspaceDataRepository.getResources(workspaceId);
    const currentSpend = resources.reduce((sum, resource) => sum + resource.monthlyCost, 0);
    const simulation = await workspaceDataRepository.createSimulation(workspaceId, { name: typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim() : `Scenario ${new Date().toLocaleDateString("en-IN")}`, recommendationIds, monthlySavings, optimizedSpend: Math.max(0, currentSpend - monthlySavings), createdBy: req.user!.email }, req.user!);
    return res.status(201).json(simulation);
  });
  app.get("/api/simulations", requireVerifiedSession, async (req, res) => {
    if (!requireDemoEnvironment(req, res)) return;
    return res.json(await workspaceDataRepository.getSimulations(req.workspace!.id));
  });
  app.get("/api/simulations/:id", requireVerifiedSession, async (req, res) => {
    if (!requireDemoEnvironment(req, res)) return;
    const simulation = (await workspaceDataRepository.getSimulations(req.workspace!.id)).find((item) => item.id === req.params.id);
    return simulation ? res.json(simulation) : res.status(404).json({ error: "Simulation not found." });
  });

  app.post("/api/actions/:id/schedule", requireVerifiedSession, async (req, res) => {
    if (!requireDemoOrManualEnvironment(req, res)) return;
    const scheduledAt = typeof req.body?.scheduledAt === "string" ? req.body.scheduledAt : "";
    const timestamp = Date.parse(scheduledAt);
    if (!Number.isFinite(timestamp) || timestamp <= Date.now()) return res.status(400).json({ error: "Choose a valid future schedule time." });
    const action = await workspaceDataRepository.scheduleAction(req.workspace!.id, req.params.id, new Date(timestamp).toISOString(), req.user!);
    const message = req.workspace!.environment === "manual"
      ? "Scheduled in the Manual Analysis workflow. No infrastructure will be modified."
      : "Scheduled in the Demo Environment workflow. No AWS resources will be modified.";
    return action ? res.json({ action, message }) : res.status(409).json({ error: "Only approved actions can be scheduled." });
  });
  app.post("/api/actions/:id/simulate-execution", requireVerifiedSession, async (req, res) => {
    if (req.workspace!.environment !== "demo" && req.workspace!.environment !== "manual") return res.status(409).json({ error: "Live AWS execution is not implemented. No resource was modified." });
    const action = await workspaceDataRepository.simulateAction(req.workspace!.id, req.params.id, req.user!);
    return action ? res.json({ action, message: "Execution simulation recorded. No infrastructure was modified." }) : res.status(409).json({ error: "Only scheduled actions can be simulated." });
  });

  app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found." }));
  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(error);
    const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
      ? error.status
      : 500;
    const message = status === 400
      ? "The request body is invalid."
      : status === 413
        ? "The request body exceeds the 1 MB limit."
        : "The request could not be completed.";
    const code = typeof error === "object" && error !== null && "type" in error && typeof error.type === "string"
      ? error.type
      : "INTERNAL_ERROR";
    console.error("Unhandled API request error.", { status, code });
    return res.status(status).json({ error: message });
  });

  const staticPath = process.env.NODE_ENV === "production" ? path.resolve(__dirname, "public") : path.resolve(__dirname, "..", "dist", "public");
  app.use(express.static(staticPath));

  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3001;

  server.listen(port, () => {
    console.log(`SmartSize API running on http://localhost:${port}/`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start SmartSize API", error);
  process.exit(1);
});
