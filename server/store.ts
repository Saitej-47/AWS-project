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

export type Activity = {
  id: string;
  time: string;
  action: string;
  resource: string;
  user: string;
  status: string;
};

type Database = {
  recommendations: StoredRecommendation[];
  simulations: Simulation[];
  activity: Activity[];
  users: User[];
};

const dataDirectory = path.resolve(process.cwd(), "data");
const dataPath = path.join(dataDirectory, "smartsize.json");

function initialDatabase(): Database {
  return { recommendations: seedRecommendations.map((recommendation) => ({ ...recommendation })), simulations: [], activity: [], users: [] };
}

function readDatabase(): Database {
  if (!fs.existsSync(dataPath)) return initialDatabase();
  try {
    return { ...initialDatabase(), ...JSON.parse(fs.readFileSync(dataPath, "utf8")) } as Database;
  } catch {
    return initialDatabase();
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
  getActivity() { return database.activity; },
  getUserByEmail(email: string) { return database.users.find((user) => user.email.toLowerCase() === email.toLowerCase()); },
  getUserById(id: string) { return database.users.find((user) => user.id === id); },
  findUserByVerificationToken(token: string) {
    return database.users.find((user) => {
      if (!user.verificationToken || user.verificationToken !== token) return false;
      if (!user.verificationTokenExpiresAt) return true;
      return new Date(user.verificationTokenExpiresAt).getTime() > Date.now();
    });
  },
  findUserByResetToken(token: string) {
    return database.users.find((user) => {
      if (!user.resetToken || user.resetToken !== token) return false;
      if (!user.resetTokenExpiresAt) return true;
      return new Date(user.resetTokenExpiresAt).getTime() > Date.now();
    });
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
  recordAudit(action: string, user: string, resource: string, status: string) {
    database.activity.unshift({
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      action,
      resource,
      user,
      status,
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
    store.recordAudit(status === "Approved" ? "Approved recommendation" : "Rejected recommendation", user.name, recommendation.resourceName, status);
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
};