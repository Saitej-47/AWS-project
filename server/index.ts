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
import { getDataSource } from "./services/dataSource";
import { isEmailDeliveryConfigured, sendAccountEmail } from "./services/email";
import { analyzeRecommendation } from "./services/rightsizingEngine";
import { serializeUser, store, type RightsizingPolicy } from "./store";
import { initializeDatabase, isDatabaseConfigured } from "./database";
import { userRepository } from "./userRepository";
import { resources as seedResources } from "../client/src/lib/mockData";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    const dataSource = getDataSource();
    const status = dataSource.getStatus();
    return res.json({
      ok: true,
      service: "smartsize-api",
      mode: dataSource.kind,
      accountStorage: isDatabaseConfigured() ? "mysql" : "json-development-fallback",
      awsConnected: status.status === "ready" && dataSource.kind === "aws",
      dataSource: status,
    });
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

    store.recordAudit("User registered", user.name, "SmartSize workspace", "Created");

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
      user: serializeUser(user),
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
    store.recordAudit("Email verified", updatedUser.name, "Account", "Verified");
    return res.json({ message: "Email verified successfully. You can now sign in.", user: serializeUser(updatedUser) });
  });

  app.post("/api/auth/login", authLimiter, async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!emailPattern.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
    if (!password) return res.status(400).json({ error: "Password is required." });

    const user = await userRepository.getByEmail(email);
    if (!user || !user.passwordHash) {
      store.recordAudit("Failed login attempt", email, "Authentication", "Blocked");
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      store.recordAudit("Failed login attempt", user.email, "Authentication", "Blocked");
      return res.status(401).json({ error: "Invalid email or password." });
    }

    if (!user.emailVerified) {
      return res.status(403).json({
        error: "Email verification required.",
        verificationRequired: true,
      });
    }

    setSession(res, user);
    store.recordAudit("Login", user.name, "SmartSize workspace", "Authenticated");
    return res.json({ user: serializeUser(user) });
  });

  app.post("/api/auth/logout", async (req, res, next) => {
    clearSession(res);
    try {
      const user = await readSession(req);
      if (user) {
        await invalidateSession(user);
        store.recordAudit("Logout", user.name, "SmartSize workspace", "Signed out");
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
      store.recordAudit("Password reset requested", user.name, "Account", "Pending");
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
    store.recordAudit("Password reset", updatedUser.name, "Account", "Updated");
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
    store.recordAudit("Demo login", user.name, "SmartSize workspace", "Authenticated");
    return res.json({ user: serializeUser(user) });
  });

  app.post("/api/auth/demo-session", authLimiter, async (_req, res) => {
    if (getDataSource().kind !== "demo") return res.status(409).json({ error: "The demo workspace is unavailable while live mode is selected." });
    const user = await createDemoUser();
    setSession(res, user);
    store.recordAudit("Entered demo workspace", user.name, "Demo dataset", "Authenticated");
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

  app.use("/api", (req, res, next) => {
    const demoOnlyPaths = ["/dashboard", "/resources", "/recommendations", "/activity", "/audit", "/actions", "/policies", "/savings", "/simulations", "/reports"];
    const isDemoDataRoute = demoOnlyPaths.some((route) => req.path === route || req.path.startsWith(`${route}/`));
    if (isDemoDataRoute && getDataSource().kind === "aws") {
      return res.status(503).json({ error: "Live AWS is not connected; the demo dataset is not served in live mode." });
    }
    return next();
  });

  app.get("/api/dashboard", requireVerifiedSession, (_req, res) => res.json({ resources: store.getResources(), recommendations: store.getRecommendations(), simulations: store.getSimulations(), activity: store.getActivity() }));
  app.get("/api/resources", requireVerifiedSession, (_req, res) => res.json(store.getResources()));
  app.get("/api/resources/:id", requireVerifiedSession, (req, res) => {
    const resource = seedResources.find((item) => item.id === req.params.id);
    if (!resource) return res.status(404).json({ error: "Resource not found" });
    const recommendation = store.getRecommendations().find((item) => item.resourceId === resource.id);
    return res.json({ resource, recommendation: recommendation ? { ...recommendation, analysis: analyzeRecommendation(recommendation, resource) } : null });
  });
  app.get("/api/recommendations", requireVerifiedSession, (_req, res) => res.json(store.getRecommendations()));
  app.get("/api/recommendations/:id", requireVerifiedSession, (req, res) => {
    const recommendation = store.getRecommendations().find((item) => item.id === req.params.id);
    if (!recommendation) return res.status(404).json({ error: "Recommendation not found" });
    const resource = seedResources.find((item) => item.id === recommendation.resourceId);
    if (!resource) return res.status(404).json({ error: "Recommendation resource not found" });
    return res.json({ recommendation, resource, analysis: analyzeRecommendation(recommendation, resource) });
  });
  app.get("/api/activity", requireVerifiedSession, (_req, res) => res.json(store.getActivity()));
  app.get("/api/audit", requireVerifiedSession, (_req, res) => res.json(store.getActivity()));
  app.get("/api/actions", requireVerifiedSession, (_req, res) => res.json(store.getActions()));
  app.get("/api/policies", requireVerifiedSession, (_req, res) => res.json(store.getPolicies()));
  app.put("/api/policies/:id", requireVerifiedSession, (req, res) => {
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
    const policy = store.updatePolicy(req.params.id, updates, req.user!);
    return policy ? res.json(policy) : res.status(404).json({ error: "Policy not found" });
  });
  app.post("/api/policies/:id/simulate", requireVerifiedSession, (req, res) => {
    const policy = store.getPolicies().find((item) => item.id === req.params.id);
    if (!policy) return res.status(404).json({ error: "Policy not found" });
    const riskRank = { Low: 1, Medium: 2, High: 3 };
    const eligible = store.getRecommendations().filter((recommendation) => {
      const resource = seedResources.find((item) => item.id === recommendation.resourceId);
      return Boolean(resource && resource.env === policy.environment && recommendation.status !== "Rejected" && riskRank[recommendation.risk] <= riskRank[policy.maximumRisk]);
    });
    const blocked = store.getRecommendations().filter((recommendation) => {
      const resource = seedResources.find((item) => item.id === recommendation.resourceId);
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
  app.get("/api/savings", requireVerifiedSession, (_req, res) => {
    const recommendations = store.getRecommendations();
    const actions = store.getActions();
    const potentialMonthly = recommendations.filter((item) => item.status !== "Rejected").reduce((sum, item) => sum + item.savings, 0);
    const simulatedMonthly = actions.filter((item) => item.status === "Simulated").reduce((sum, action) => sum + (recommendations.find((item) => item.id === action.recommendationId)?.savings ?? 0), 0);
    return res.json({
      currency: "INR",
      currentMonthlySpend: seedResources.reduce((sum, item) => sum + item.monthlyCost, 0),
      potentialMonthlySavings: potentialMonthly,
      projectedAnnualSavings: potentialMonthly * 12,
      simulatedMonthlySavings: simulatedMonthly,
      verifiedSavings: 0,
      verifiedSavingsNote: "No live AWS changes have been executed or verified.",
      actions,
    });
  });
  app.get("/api/reports", requireVerifiedSession, (_req, res) => res.json(store.getReports()));
  app.post("/api/reports", requireVerifiedSession, (req, res) => {
    const requestedName = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    if (requestedName.length > 120) return res.status(400).json({ error: "Report name must be 120 characters or fewer." });
    const recommendations = store.getRecommendations();
    const potentialMonthlySavings = recommendations
      .filter((item) => item.status !== "Rejected")
      .reduce((sum, item) => sum + item.savings, 0);
    const report = store.createReport({
      name: requestedName || `Optimization Report · ${new Date().toLocaleDateString("en-IN")}`,
      createdBy: req.user!.email,
      summary: {
        totalResources: store.getResources().length,
        totalRecommendations: recommendations.length,
        openRecommendations: recommendations.filter((item) => item.status === "Open" || item.status === "Reviewed").length,
        currentMonthlySpend: store.getResources().reduce((sum, item) => sum + item.monthlyCost, 0),
        potentialMonthlySavings,
        projectedAnnualSavings: potentialMonthlySavings * 12,
        verifiedSavings: 0,
      },
    }, req.user!);
    return res.status(201).json(report);
  });
  app.get("/api/reports/export.csv", requireVerifiedSession, (_req, res) => {
    const quote = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const rows = [
      ["Resource", "AWS resource ID", "Region", "Environment", "Current configuration", "Recommended configuration", "Monthly savings (INR)", "Risk", "Confidence", "Status"],
      ...store.getRecommendations().map((item) => {
        const resource = seedResources.find((candidate) => candidate.id === item.resourceId);
        return [item.resourceName, resource?.instanceId ?? "", resource?.region ?? "", resource?.env ?? "", item.current, item.recommended, item.savings, item.risk, `${item.confidence}%`, item.status];
      }),
    ];
    res.type("text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="smartsize-optimization-report.csv"');
    return res.send(rows.map((row) => row.map(quote).join(",")).join("\r\n"));
  });
  app.post("/api/ai/advisor", requireVerifiedSession, async (req, res) => {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message) return res.status(400).json({ error: "Ask a question about your SmartSize data." });
    if (message.length > 1000) return res.status(400).json({ error: "Advisor questions must be 1000 characters or fewer." });
    try {
      return res.json(await answerAdvisor(message));
    } catch {
      return res.status(502).json({ error: "The AI Advisor is temporarily unavailable. Your SmartSize data is still available for review." });
    }
  });
  app.post("/api/recommendations/:id/decision", requireVerifiedSession, (req, res) => {
    const status = req.body?.status;
    if (status !== "Approved" && status !== "Rejected") return res.status(400).json({ error: "Decision must be Approved or Rejected" });
    if (req.body?.note !== undefined && (typeof req.body.note !== "string" || req.body.note.length > 500)) return res.status(400).json({ error: "Decision note must be a string of 500 characters or fewer" });
    const current = store.getRecommendations().find((item) => item.id === req.params.id);
    if (!current) return res.status(404).json({ error: "Recommendation not found" });
    if (current.status === "Approved" || current.status === "Rejected") return res.status(409).json({ error: `Recommendation is already ${current.status.toLowerCase()}` });
    const recommendation = store.decideRecommendation(req.params.id, status, req.user!, req.body?.note);
    return recommendation ? res.json(recommendation) : res.status(404).json({ error: "Recommendation not found" });
  });
  app.post("/api/recommendations/:id/simulate", requireVerifiedSession, (req, res) => {
    const recommendation = store.getRecommendations().find((item) => item.id === req.params.id);
    if (!recommendation) return res.status(404).json({ error: "Recommendation not found" });
    const resource = seedResources.find((item) => item.id === recommendation.resourceId);
    if (!resource) return res.status(404).json({ error: "Recommendation resource not found" });
    const analysis = analyzeRecommendation(recommendation, resource);
    store.recordAudit("Simulated rightsizing recommendation", req.user!.name, recommendation.resourceName, "Simulation only", "No AWS resource was modified.");
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
  app.post("/api/simulations", requireVerifiedSession, (req, res) => {
    const recommendationIds = req.body?.recommendationIds;
    if (!Array.isArray(recommendationIds) || recommendationIds.some((id: unknown) => typeof id !== "string")) {
      return res.status(400).json({ error: "recommendationIds must be an array of recommendation IDs." });
    }
    if (!recommendationIds.length) return res.status(400).json({ error: "Select at least one recommendation" });
    const recommendations = store.getRecommendations().filter((item) => recommendationIds.includes(item.id));
    if (recommendations.length !== new Set(recommendationIds).size) return res.status(404).json({ error: "One or more recommendations were not found" });
    if (typeof req.body?.name === "string" && req.body.name.trim().length > 120) return res.status(400).json({ error: "Scenario name must be 120 characters or fewer." });
    if (req.body?.name !== undefined && typeof req.body.name !== "string") return res.status(400).json({ error: "Scenario name must be a string." });
    const monthlySavings = recommendations.reduce((total, item) => total + item.savings, 0);
    const currentSpend = seedResources.reduce((sum, resource) => sum + resource.monthlyCost, 0);
    const simulation = store.createSimulation({ name: typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim() : `Scenario ${new Date().toLocaleDateString("en-IN")}`, recommendationIds, monthlySavings, optimizedSpend: Math.max(0, currentSpend - monthlySavings), createdBy: req.user!.email }, req.user!);
    return res.status(201).json(simulation);
  });
  app.get("/api/simulations", requireVerifiedSession, (_req, res) => res.json(store.getSimulations()));
  app.get("/api/simulations/:id", requireVerifiedSession, (req, res) => {
    const simulation = store.getSimulations().find((item) => item.id === req.params.id);
    return simulation ? res.json(simulation) : res.status(404).json({ error: "Simulation not found." });
  });

  app.post("/api/actions/:id/schedule", requireVerifiedSession, (req, res) => {
    const scheduledAt = typeof req.body?.scheduledAt === "string" ? req.body.scheduledAt : "";
    const timestamp = Date.parse(scheduledAt);
    if (!Number.isFinite(timestamp) || timestamp <= Date.now()) return res.status(400).json({ error: "Choose a valid future schedule time." });
    const action = store.scheduleAction(req.params.id, new Date(timestamp).toISOString(), req.user!);
    return action ? res.json({ action, message: "Scheduled in the demo workflow. No AWS resources will be modified." }) : res.status(409).json({ error: "Only approved actions can be scheduled." });
  });
  app.post("/api/actions/:id/simulate-execution", requireVerifiedSession, (req, res) => {
    const source = getDataSource();
    if (source.kind !== "demo") return res.status(409).json({ error: "Live AWS execution is not implemented. No resource was modified." });
    const action = store.simulateAction(req.params.id, req.user!);
    return action ? res.json({ action, message: "Demo action simulated. No AWS resource was modified." }) : res.status(409).json({ error: "Only scheduled actions can be simulated." });
  });
  app.get("/api/aws/status", requireVerifiedSession, (_req, res) => res.json(getDataSource().getStatus()));
  app.post("/api/aws/sync", requireVerifiedSession, (req, res) => {
    const result = getDataSource().sync();
    store.recordAudit("Data source sync requested", req.user!.name, `${result.source.toUpperCase()} connection`, result.status === "ready" ? "Demo data ready" : "Not connected", result.message);
    return res.json(result);
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
