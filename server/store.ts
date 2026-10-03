import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { recommendations as seedRecommendations, resources as seedResources } from "../client/src/lib/mockData";

export type User = {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  provider: "demo" | "google" | "email";
  role: "Platform Admin" | "Viewer";
  passwordHash?: string;
  emailVerified: boolean;
  verificationToken?: string | null;
  verificationTokenExpiresAt?: string | null;
  resetToken?: string | null;
  resetTokenExpiresAt?: string | null;
  sessionVersion?: number;
  createdAt: string;
};

export type StoredRecommendation = (typeof seedRecommendations)[number] & {
  updatedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  decisionNote?: string;
};

export type Simulation = {
  id: string;
  name: string;
  recommendationIds: string[];
  monthlySavings: number;
  optimizedSpend: number;
  createdAt: string;
  createdBy: string;
};

export type OptimizationReport = {
  id: string;
  name: string;
  createdAt: string;
  createdBy: string;
  summary: {
    totalResources: number;
    totalRecommendations: number;
    openRecommendations: number;
    currentMonthlySpend: number;
    potentialMonthlySavings: number;
    projectedAnnualSavings: number;
    verifiedSavings: number;
  };
};

export type Activity = {
  id: string;
  time: string;
  action: string;
  resource: string;
  user: string;
  status: string;
  details?: string;
};

export type RightsizingAction = {
  id: string;
  recommendationId: string;
  actionType: "Rightsize";
  oldConfiguration: string;
  newConfiguration: string;
  requestedBy: string;
  approvedBy: string;
  status: "Approved" | "Scheduled" | "Simulated";
  createdAt: string;
  scheduledAt?: string;
  executedAt?: string;
};

export type RightsizingPolicy = {
  id: string;
  environment: "Production" | "Staging" | "Development";
  autoExecution: boolean;
  approvalRequired: boolean;
  maximumRisk: "Low" | "Medium" | "High";
};

type Database = {
  recommendations: StoredRecommendation[];
  simulations: Simulation[];
  reports: OptimizationReport[];
  activity: Activity[];
  actions: RightsizingAction[];
  policies: RightsizingPolicy[];
  users: User[];
};

const dataDirectory = path.resolve(process.env.DATA_DIRECTORY || process.cwd(), "data");
const dataPath = path.join(dataDirectory, "smartsize.json");

function initialDatabase(): Database {
  return {
    recommendations: seedRecommendations.map((recommendation) => ({ ...recommendation })),
    simulations: [],
    reports: [],
    activity: [],
    actions: [],
    policies: [
      { id: "production", environment: "Production", autoExecution: false, approvalRequired: true, maximumRisk: "Low" },
      { id: "staging", environment: "Staging", autoExecution: false, approvalRequired: true, maximumRisk: "Medium" },
      { id: "development", environment: "Development", autoExecution: false, approvalRequired: false, maximumRisk: "Medium" },
    ],
    users: [],
  };
}

function readDatabase(): Database {
  if (!fs.existsSync(dataPath)) return initialDatabase();
  try {
    const parsed = JSON.parse(fs.readFileSync(dataPath, "utf8")) as Partial<Database>;
    return { ...initialDatabase(), ...parsed };
  } catch (error) {
    console.error(`Unable to read workspace data at ${dataPath}`, error);
    throw error;
  }
}

let database = readDatabase();

function writeDatabase() {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const temporaryPath = `${dataPath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(database, null, 2), "utf8");
  fs.renameSync(temporaryPath, dataPath);
}

export function serializeUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar: user.avatar,
    provider: user.provider,
    role: user.role,
    emailVerified: user.emailVerified,
  };
}

export const store = {
  getResources() { return seedResources; },
  getRecommendations() { return database.recommendations; },
  getSimulations() { return database.simulations; },
  getReports() { return database.reports; },
  getActivity() { return database.activity; },
  getActions() { return database.actions; },
  getPolicies() { return database.policies; },
  getUsers() { return database.users; },
  getUserByEmail(email: string) { return database.users.find((user) => user.email.toLowerCase() === email.toLowerCase()); },
  getUserById(id: string) { return database.users.find((user) => user.id === id); },
  findUserByVerificationToken(token: string) {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    return database.users.find((user) => {
      if (!user.verificationToken || user.verificationToken !== tokenHash) return false;
      if (!user.verificationTokenExpiresAt) return true;
      return new Date(user.verificationTokenExpiresAt).getTime() > Date.now();
    });
  },
  findUserByResetToken(token: string) {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    return database.users.find((user) => {
      if (!user.resetToken || user.resetToken !== tokenHash) return false;
      if (!user.resetTokenExpiresAt) return true;
      return new Date(user.resetTokenExpiresAt).getTime() > Date.now();
    });
  },
  deleteUser(userId: string) {
    const index = database.users.findIndex((user) => user.id === userId);
    if (index === -1) return false;
    database.users.splice(index, 1);
    writeDatabase();
    return true;
  },
  saveUser(user: User) {
    const existing = store.getUserByEmail(user.email);
    if (existing) return existing;
    database.users.push(user);
    writeDatabase();
    return user;
  },
  updateUser(userId: string, updates: Partial<User>) {
    const index = database.users.findIndex((user) => user.id === userId);
    if (index === -1) return undefined;
    database.users[index] = { ...database.users[index], ...updates };
    writeDatabase();
    return database.users[index];
  },
  recordAudit(action: string, user: string, resource: string, status: string, details?: string) {
    database.activity.unshift({
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      action,
      resource,
      user,
      status,
      details,
    });
    writeDatabase();
  },
  decideRecommendation(id: string, status: "Approved" | "Rejected", user: User, decisionNote?: string) {
    const recommendation = database.recommendations.find((item) => item.id === id);
    if (!recommendation) return undefined;
    recommendation.status = status;
    recommendation.updatedAt = new Date().toISOString();
    recommendation.approvedBy = status === "Approved" ? user.email : undefined;
    recommendation.approvedAt = status === "Approved" ? recommendation.updatedAt : undefined;
    recommendation.decisionNote = decisionNote;
    if (status === "Approved") {
      database.actions.unshift({
        id: crypto.randomUUID(),
        recommendationId: recommendation.id,
        actionType: "Rightsize",
        oldConfiguration: recommendation.current,
        newConfiguration: recommendation.recommended,
        requestedBy: user.email,
        approvedBy: user.email,
        status: "Approved",
        createdAt: recommendation.updatedAt,
      });
    }
    store.recordAudit(
      status === "Approved" ? "Approved recommendation" : "Rejected recommendation",
      user.name,
      recommendation.resourceName,
      status,
      decisionNote,
    );
    writeDatabase();
    return recommendation;
  },
  createSimulation(input: Omit<Simulation, "id" | "createdAt">, user: User) {
    const simulation: Simulation = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    database.simulations.unshift(simulation);
    store.recordAudit("Created simulation", user.name, `${simulation.recommendationIds.length} recommendations`, "Simulated");
    writeDatabase();
    return simulation;
  },
  createReport(input: Omit<OptimizationReport, "id" | "createdAt">, user: User) {
    const report: OptimizationReport = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    database.reports.unshift(report);
    store.recordAudit("Generated optimization report", user.name, report.name, "Generated");
    writeDatabase();
    return report;
  },
  scheduleAction(actionId: string, scheduledAt: string, user: User) {
    const action = database.actions.find((item) => item.id === actionId);
    if (!action || action.status !== "Approved") return undefined;
    action.status = "Scheduled";
    action.scheduledAt = scheduledAt;
    const recommendation = database.recommendations.find((item) => item.id === action.recommendationId);
    store.recordAudit("Scheduled rightsizing action", user.name, recommendation?.resourceName ?? action.recommendationId, "Scheduled", scheduledAt);
    writeDatabase();
    return action;
  },
  simulateAction(actionId: string, user: User) {
    const action = database.actions.find((item) => item.id === actionId);
    if (!action || action.status !== "Scheduled") return undefined;
    action.status = "Simulated";
    action.executedAt = new Date().toISOString();
    const recommendation = database.recommendations.find((item) => item.id === action.recommendationId);
    store.recordAudit("Simulated scheduled rightsizing action", user.name, recommendation?.resourceName ?? action.recommendationId, "Simulated", "No AWS resource was modified.");
    writeDatabase();
    return action;
  },
  updatePolicy(id: string, updates: Partial<Omit<RightsizingPolicy, "id" | "environment">>, user: User) {
    const policy = database.policies.find((item) => item.id === id);
    if (!policy) return undefined;
    Object.assign(policy, updates);
    store.recordAudit("Updated rightsizing policy", user.name, policy.environment, "Updated", JSON.stringify(updates));
    writeDatabase();
    return policy;
  },
};