import { store } from "../store";

export type DataSourceKind = "demo" | "aws";

export type SyncResult = {
  source: DataSourceKind;
  status: "ready" | "not_connected" | "error";
  message: string;
  accountId: string | null;
  region: string | null;
  syncedAt: string | null;
  sources: string[];
};

export interface OptimizationDataSource {
  readonly kind: DataSourceKind;
  getStatus(): SyncResult;
  sync(): SyncResult;
}

const awsSources = ["EC2", "CloudWatch", "Compute Optimizer", "Cost Explorer"];

const demoDataSource: OptimizationDataSource = {
  kind: "demo",
  getStatus: () => ({
    source: "demo",
    status: "ready",
    message: "Demo mode active. No AWS credentials are required.",
    accountId: null,
    region: "ap-south-1",
    syncedAt: null,
    sources: awsSources,
  }),
  sync: () => ({
    source: "demo",
    status: "ready",
    message: `Demo sync ready. ${store.getResources().length} simulated AWS resources and ${store.getRecommendations().length} simulated recommendations are available.`,
    accountId: null,
    region: "ap-south-1",
    syncedAt: new Date().toISOString(),
    sources: awsSources,
  }),
};

const liveAwsDataSource: OptimizationDataSource = {
  kind: "aws",
  getStatus: () => ({
    source: "aws",
    status: "not_connected",
    message: "Live AWS mode is not connected. Configure the backend AWS SDK integration before requesting live data.",
    accountId: null,
    region: process.env.AWS_REGION || null,
    syncedAt: null,
    sources: awsSources,
  }),
  sync: () => ({
    source: "aws",
    status: "not_connected",
    message: "Live AWS sync is unavailable until the backend AWS SDK integration and IAM role are configured.",
    accountId: null,
    region: process.env.AWS_REGION || null,
    syncedAt: null,
    sources: awsSources,
  }),
};

export function getDataSource(): OptimizationDataSource {
  return (process.env.AWS_MODE || "demo").toLowerCase() === "live" ? liveAwsDataSource : demoDataSource;
}
