import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { answerAdvisor } from "./ai";
import { clearSession, createDemoUser, createOAuthState, readSession, requireSession, requireVerifiedSession, setSession, verifyOAuthState } from "./auth";
import { getDataSource } from "./services/dataSource";
import { serializeUser, store } from "./store";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isEmailDeliveryConfigured() {
  const provider = (process.env.EMAIL_PROVIDER || "").toLowerCase();
  if (!provider || provider === "none" || provider === "disabled") return false;
  if (provider === "smtp") {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASSWORD && process.env.EMAIL_FROM);
  }
  if (provider === "sendgrid") {
    return Boolean(process.env.SENDGRID_API_KEY);
  }
  return false;
}

function createDevelopmentVerificationCode() {
  return crypto.randomInt(100000, 1000000).toString().padStart(6, "0");
}

function getAuthMode() {
  return (process.env.AUTH_MODE || (process.env.NODE_ENV === "production" ? "production" : "demo")).toLowerCase();
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    const dataSource = getDataSource();
    const status = dataSource.getStatus();
    return res.json({ ok: true, service: "smartsize-api", mode: dataSource.kind, awsConnected: status.status === "ready" && dataSource.kind === "aws", dataSource: status });
  });
  app.get("/api/auth/session", (req, res) => res.json({ user: readSession(req) || null }));

  app.post("/api/auth/register", async (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const confirmPassword = typeof req.body?.confirmPassword === "string" ? req.body.confirmPassword : "";

    if (!name || name.length < 2) return res.status(400).json({ error: "Provide your full name." });
    if (!emailPattern.test(email)) return res.status(400).json({ error: "Enter a valid work email address." });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters long." });
    if (password !== confirmPassword) return res.status(400).json({ error: "Passwords do not match." });

    const existing = store.getUserByEmail(email);
    if (existing) return res.status(409).json({ error: "An account with this email already exists." });

    const authMode = getAuthMode();
    const emailConfigured = isEmailDeliveryConfigured();
    if (authMode === "production" && !emailConfigured) {
      return res.status(503).json({ error: "Production email verification is not configured. Set EMAIL_PROVIDER and the provider credentials before accepting registrations." });
    }

    const requiresVerification = authMode === "production";
    const verificationToken = requiresVerification ? crypto.randomBytes(32).toString("hex") : null;
    const user = store.saveUser({
      id: crypto.randomUUID(),
      email,
      name,
      provider: "email",
      role: "Platform Admin",
      passwordHash: await bcrypt.hash(password, 12),
      emailVerified: !requiresVerification,
      verificationToken,
      verificationTokenExpiresAt: requiresVerification ? new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString() : null,
      createdAt: new Date().toISOString(),
    });

    store.recordAudit("User registered", user.name, "SmartSize workspace", "Created");

    return res.status(201).json({
      message: requiresVerification
        ? "Account created. Verify your email to activate your SmartSize workspace."
        : "Account created successfully. You can now sign in to the demo workspace.",
      verificationRequired: requiresVerification,
      verificationToken: undefined,
      verificationCode: undefined,
      emailDeliveryConfigured: emailConfigured,
      authMode,
      user: serializeUser(user),
    });
  });

  app.post("/api/auth/verify-email", (req, res) => {
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (!token) return res.status(400).json({ error: "Verification code is required." });

    const user = store.findUserByVerificationToken(token);
    if (!user) return res.status(400).json({ error: "Verification code is invalid or expired." });

    const updatedUser = store.updateUser(user.id, {
      emailVerified: true,
      verificationToken: null,
      verificationTokenExpiresAt: null,
    });

    if (!updatedUser) return res.status(500).json({ error: "Unable to verify account." });
    store.recordAudit("Email verified", updatedUser.name, "Account", "Verified");
    return res.json({ message: "Email verified successfully. You can now sign in.", user: serializeUser(updatedUser) });
  });

  app.post("/api/auth/login", async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!emailPattern.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
    if (!password) return res.status(400).json({ error: "Password is required." });

    const user = store.getUserByEmail(email);
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

  app.post("/api/auth/logout", (_req, res) => {
    clearSession(res);
    res.status(204).end();
  });

  app.post("/api/auth/request-password-reset", (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!emailPattern.test(email)) return res.status(400).json({ error: "Enter a valid email address." });

    const user = store.getUserByEmail(email);
    if (user) {
      const resetToken = crypto.randomBytes(24).toString("hex");
      store.updateUser(user.id, {
        resetToken,
        resetTokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
      });
      store.recordAudit("Password reset requested", user.name, "Account", "Pending");
    }

    return res.json({ message: "If an account exists for that email, a secure reset link has been issued." });
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!token) return res.status(400).json({ error: "Reset token is required." });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters long." });

    const user = store.findUserByResetToken(token);
    if (!user) return res.status(400).json({ error: "Reset token is invalid or expired." });

    const updatedUser = store.updateUser(user.id, {
      passwordHash: await bcrypt.hash(password, 12),
      resetToken: null,
      resetTokenExpiresAt: null,
    });

    if (!updatedUser) return res.status(500).json({ error: "Unable to update password." });
    store.recordAudit("Password reset", updatedUser.name, "Account", "Updated");
    return res.json({ message: "Password updated successfully." });
  });

  app.post("/api/auth/demo", async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!emailPattern.test(email)) return res.status(400).json({ error: "Enter a valid email address." });

    const user = store.getUserByEmail(email);
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

  app.get("/api/auth/google/start", (req, res) => {
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

  app.get("/api/auth/google/callback", async (req, res) => {
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
      const user = store.saveUser({
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

  app.get("/api/dashboard", requireVerifiedSession, (_req, res) => res.json({ resources: store.getResources(), recommendations: store.getRecommendations(), simulations: store.getSimulations(), activity: store.getActivity() }));
  app.get("/api/resources", requireVerifiedSession, (_req, res) => res.json(store.getResources()));
  app.get("/api/recommendations", requireVerifiedSession, (_req, res) => res.json(store.getRecommendations()));
  app.get("/api/activity", requireVerifiedSession, (_req, res) => res.json(store.getActivity()));
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
    const recommendation = store.decideRecommendation(req.params.id, status, req.user!, req.body?.note);
    return recommendation ? res.json(recommendation) : res.status(404).json({ error: "Recommendation not found" });
  });
  app.post("/api/simulations", requireVerifiedSession, (req, res) => {
    const recommendationIds = Array.isArray(req.body?.recommendationIds) ? req.body.recommendationIds.filter((id: unknown): id is string => typeof id === "string") : [];
    if (!recommendationIds.length) return res.status(400).json({ error: "Select at least one recommendation" });
    const recommendations = store.getRecommendations().filter((item) => recommendationIds.includes(item.id));
    const monthlySavings = recommendations.reduce((total, item) => total + item.savings, 0);
    const simulation = store.createSimulation({ name: typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim() : `Scenario ${new Date().toLocaleDateString("en-IN")}`, recommendationIds, monthlySavings, optimizedSpend: 248600 - monthlySavings, createdBy: req.user!.email }, req.user!);
    return res.status(201).json(simulation);
  });

  app.get("/api/aws/status", requireVerifiedSession, (_req, res) => res.json(getDataSource().getStatus()));
  app.post("/api/aws/sync", requireVerifiedSession, (req, res) => {
    const result = getDataSource().sync();
    store.recordAudit("AWS sync completed", req.user!.name, `${result.source.toUpperCase()} connection`, result.status === "ready" ? "Completed" : "Not connected");
    return res.json(result);
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
