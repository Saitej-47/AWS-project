import crypto from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { recommendations as seedRecommendations, resources as seedResources, type Resource } from "../client/src/lib/mockData";
import { getDatabasePool } from "./database";
import type {
  CloudWatchMetrics,
  ComputeOptimizerRecommendation,
  CostExplorerResult,
  Ec2Inventory,
} from "./services/aws/contracts";
import type { ManualAnalysisRecord } from "./services/manualAnalysisEngine";
import { store, type Activity, type OptimizationReport, type RightsizingAction, type RightsizingPolicy, type Simulation, type StoredRecommendation, type User } from "./store";

type JsonRow = RowDataPacket & { data: string | object; id: string };

function decode<T>(value: string | object): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

const now = () => new Date();

async function seedWorkspace(workspaceId: string) {
  const pool = getDatabasePool();
  if (!pool) return;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const timestamp = now();
    const [seedResult] = await connection.execute(
      "INSERT IGNORE INTO smartsize_workspace_demo_seeds (workspace_id, created_at) VALUES (?, ?)",
      [workspaceId, timestamp],
    );
    if ("affectedRows" in seedResult && seedResult.affectedRows === 0) {
      await connection.commit();
      return;
    }
    for (const resource of seedResources) {
      await connection.execute(
        `INSERT INTO smartsize_resources
         (workspace_id, id, source, resource_type, region, status, data, created_at, updated_at)
         VALUES (?, ?, 'DEMO', ?, ?, ?, ?, ?, ?)`,
        [workspaceId, resource.id, resource.service, resource.region, resource.status, JSON.stringify(resource), timestamp, timestamp],
      );
    }
    for (const recommendation of seedRecommendations) {
      await connection.execute(
        `INSERT INTO smartsize_recommendations
         (workspace_id, id, resource_id, source, status, data, created_at, updated_at)
         VALUES (?, ?, ?, 'DEMO', ?, ?, ?, ?)`,
        [workspaceId, recommendation.id, recommendation.resourceId, recommendation.status, JSON.stringify(recommendation), timestamp, timestamp],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY") return;
    throw error;
  } finally {
    connection.release();
  }
}

async function listJson<T>(table: "smartsize_simulations" | "smartsize_reports" | "smartsize_rightsizing_actions" | "smartsize_policies", workspaceId: string): Promise<T[]> {
  const pool = getDatabasePool();
  if (!pool) return [];
  const [rows] = await pool.execute<JsonRow[]>(`SELECT id, data FROM ${table} WHERE workspace_id = ? ORDER BY created_at DESC`, [workspaceId]);
  return rows.map((row) => decode<T>(row.data));
}

async function writeAudit(workspaceId: string, actor: User, action: string, resource: string, status: string, details?: string) {
  const pool = getDatabasePool();
  if (!pool) {
    store.recordAudit(action, actor.name, resource, status, details, workspaceId);
    return;
  }
  await pool.execute(
    `INSERT INTO smartsize_audit_logs
     (workspace_id, id, actor_user_id, event_type, resource_id, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [workspaceId, crypto.randomUUID(), actor.id, action, resource, JSON.stringify({ status, details: details ?? null }), now()],
  );
}

export const workspaceDataRepository = {
  async getManualAnalyses(workspaceId: string): Promise<ManualAnalysisRecord[]> {
    const pool = getDatabasePool();
    if (!pool) return store.getManualAnalyses(workspaceId);
    const [rows] = await pool.execute<Array<RowDataPacket & { data: string | object }>>(
      "SELECT data FROM smartsize_manual_analyses WHERE workspace_id = ? ORDER BY created_at DESC",
      [workspaceId],
    );
    return rows.map((row) => decode<ManualAnalysisRecord>(row.data));
  },

  async getManualAnalysis(workspaceId: string, id: string): Promise<ManualAnalysisRecord | undefined> {
    const pool = getDatabasePool();
    if (!pool) return store.getManualAnalysis(workspaceId, id);
    const [rows] = await pool.execute<Array<RowDataPacket & { data: string | object }>>(
      "SELECT data FROM smartsize_manual_analyses WHERE workspace_id = ? AND id = ? LIMIT 1",
      [workspaceId, id],
    );
    return rows[0] ? decode<ManualAnalysisRecord>(rows[0].data) : undefined;
  },

  async createManualAnalysis(workspaceId: string, actor: User, analysis: ManualAnalysisRecord) {
    const pool = getDatabasePool();
    const resourceData = {
      id: analysis.resourceId,
      name: analysis.input.resourceName,
      service: analysis.input.resourceType,
      region: analysis.input.region || null,
      instanceType: analysis.input.currentConfiguration,
      cpu: analysis.input.averageCpu,
      peakCpu: analysis.input.peakCpu,
      memory: analysis.input.averageMemory,
      peakMemory: analysis.input.peakMemory,
      network: analysis.input.averageNetwork,
      storage: analysis.input.averageStorageUtilization,
      monthlyCost: analysis.result.currentMonthlyCost,
      status: analysis.result.classification,
      risk: analysis.result.risk,
      env: analysis.input.environment,
      instanceId: analysis.resourceId,
      recommendationId: analysis.recommendationId,
      source: "MANUAL_ANALYSIS",
    };
    const recommendationData = {
      id: analysis.recommendationId,
      resourceId: analysis.resourceId,
      resourceName: analysis.input.resourceName,
      current: analysis.input.currentConfiguration,
      recommended: analysis.result.suggestedConfiguration,
      currentCost: analysis.result.currentMonthlyCost,
      optimizedCost: analysis.result.estimatedOptimizedMonthlyCost,
      savings: analysis.result.potentialMonthlySavings,
      risk: analysis.result.risk,
      confidence: analysis.result.analysisConfidence,
      status: "Open",
      rationale: analysis.result.explanation,
      source: analysis.result.source,
    };
    if (!pool) {
      store.saveManualAnalysis(workspaceId, analysis);
      store.recordAudit("MANUAL_ANALYSIS_CREATED", actor.name, analysis.input.resourceName, "Analyzed", analysis.result.source, workspaceId);
      return analysis;
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const [id, source, type, data, status] of [
        [analysis.resourceId, "MANUAL_ANALYSIS", analysis.input.resourceType, resourceData, analysis.result.classification],
        [analysis.recommendationId, "SMARTSIZE_MANUAL", analysis.input.resourceType, recommendationData, "Open"],
      ] as const) {
        if (source === "MANUAL_ANALYSIS") {
          await connection.execute(
            `INSERT INTO smartsize_resources
             (workspace_id, id, source, resource_type, region, status, data, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [workspaceId, id, source, type, analysis.input.region || null, status, JSON.stringify(data), now(), now()],
          );
        } else {
          await connection.execute(
            `INSERT INTO smartsize_recommendations
             (workspace_id, id, resource_id, source, status, data, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [workspaceId, id, analysis.resourceId, source, status, JSON.stringify(data), now(), now()],
          );
        }
      }
      await connection.execute(
        `INSERT INTO smartsize_manual_analyses
         (workspace_id, id, resource_id, recommendation_id, user_id, status, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [workspaceId, analysis.id, analysis.resourceId, analysis.recommendationId, actor.id, analysis.status, JSON.stringify(analysis), now(), now()],
      );
      await connection.execute(
        `INSERT INTO smartsize_audit_logs (workspace_id, id, actor_user_id, event_type, resource_id, metadata, created_at)
         VALUES (?, ?, ?, 'MANUAL_ANALYSIS_CREATED', ?, ?, ?)`,
        [workspaceId, crypto.randomUUID(), actor.id, analysis.resourceId, JSON.stringify({ recommendationId: analysis.recommendationId, source: analysis.result.source }), now()],
      );
      await connection.commit();
      return analysis;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async simulateManualAnalysis(workspaceId: string, id: string, actor: User) {
    const analysis = await this.getManualAnalysis(workspaceId, id);
    if (!analysis || analysis.status === "Approved" || analysis.status === "Rejected") return undefined;
    const updatedAt = now().toISOString();
    const updated: ManualAnalysisRecord = {
      ...analysis,
      status: "Simulated",
      updatedAt,
      simulation: {
        monthlySavings: analysis.result.potentialMonthlySavings,
        annualSavings: analysis.result.potentialAnnualSavings,
        estimatedReductionPercent: analysis.result.estimatedReductionPercent,
        simulatedAt: updatedAt,
      },
    };
    const pool = getDatabasePool();
    if (!pool) {
      store.updateManualAnalysis(workspaceId, id, updated);
      store.createSimulation({
        name: `Manual analysis: ${analysis.input.resourceName}`,
        recommendationIds: [analysis.recommendationId],
        monthlySavings: analysis.result.potentialMonthlySavings ?? 0,
        optimizedSpend: analysis.result.estimatedOptimizedMonthlyCost ?? 0,
        createdBy: actor.email,
      }, actor, workspaceId);
      store.recordAudit("MANUAL_ANALYSIS_SIMULATED", actor.name, analysis.input.resourceName, "Simulation only", "No infrastructure was modified.", workspaceId);
      return updated;
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        "UPDATE smartsize_manual_analyses SET status = 'Simulated', data = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
        [JSON.stringify(updated), now(), workspaceId, id],
      );
      await connection.execute(
        "UPDATE smartsize_recommendations SET status = 'Reviewed', updated_at = ? WHERE workspace_id = ? AND id = ?",
        [now(), workspaceId, analysis.recommendationId],
      );
      await connection.execute(
        `INSERT INTO smartsize_simulations (workspace_id, id, user_id, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [workspaceId, crypto.randomUUID(), actor.id, JSON.stringify({
          id: crypto.randomUUID(),
          name: `Manual analysis: ${analysis.input.resourceName}`,
          recommendationIds: [analysis.recommendationId],
          monthlySavings: analysis.result.potentialMonthlySavings ?? 0,
          optimizedSpend: analysis.result.estimatedOptimizedMonthlyCost ?? 0,
          createdAt: updatedAt,
          createdBy: actor.email,
        }), now(), now()],
      );
      await connection.execute(
        `INSERT INTO smartsize_audit_logs (workspace_id, id, actor_user_id, event_type, resource_id, metadata, created_at)
         VALUES (?, ?, ?, 'MANUAL_ANALYSIS_SIMULATED', ?, ?, ?)`,
        [workspaceId, crypto.randomUUID(), actor.id, analysis.resourceId, JSON.stringify({ note: "No infrastructure was modified." }), now()],
      );
      await connection.commit();
      return updated;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async decideManualAnalysis(workspaceId: string, id: string, status: "Approved" | "Rejected", actor: User, note?: string) {
    const analysis = await this.getManualAnalysis(workspaceId, id);
    if (!analysis || analysis.status !== "Simulated") return undefined;
    const updated: ManualAnalysisRecord = { ...analysis, status, updatedAt: now().toISOString() };
    const pool = getDatabasePool();
    if (!pool) {
      store.updateManualAnalysis(workspaceId, id, updated);
      if (status === "Approved") {
        store.addWorkspaceAction(workspaceId, {
          id: crypto.randomUUID(),
          recommendationId: analysis.recommendationId,
          resourceName: analysis.input.resourceName,
          actionType: "Rightsize",
          oldConfiguration: analysis.input.currentConfiguration,
          newConfiguration: analysis.result.suggestedConfiguration,
          requestedBy: actor.email,
          approvedBy: actor.email,
          status: "Approved",
          createdAt: updated.updatedAt,
        });
      }
      store.recordAudit(status === "Approved" ? "MANUAL_RECOMMENDATION_APPROVED" : "MANUAL_RECOMMENDATION_REJECTED", actor.name, analysis.input.resourceName, status, note, workspaceId);
      return updated;
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<Array<RowDataPacket & { status: ManualAnalysisRecord["status"] }>>(
        "SELECT status FROM smartsize_manual_analyses WHERE workspace_id = ? AND id = ? FOR UPDATE",
        [workspaceId, id],
      );
      if (!rows[0] || rows[0].status !== "Simulated") {
        await connection.rollback();
        return undefined;
      }
      await connection.execute(
        "UPDATE smartsize_manual_analyses SET status = ?, data = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
        [status, JSON.stringify(updated), now(), workspaceId, id],
      );
      await connection.execute(
        "UPDATE smartsize_recommendations SET status = ?, data = JSON_SET(data, '$.status', ?) , updated_at = ? WHERE workspace_id = ? AND id = ?",
        [status, status, now(), workspaceId, analysis.recommendationId],
      );
      if (status === "Approved") {
        const action: RightsizingAction = {
          id: crypto.randomUUID(),
          recommendationId: analysis.recommendationId,
          resourceName: analysis.input.resourceName,
          actionType: "Rightsize",
          oldConfiguration: analysis.input.currentConfiguration,
          newConfiguration: analysis.result.suggestedConfiguration,
          requestedBy: actor.email,
          approvedBy: actor.email,
          status: "Approved",
          createdAt: updated.updatedAt,
        };
        await connection.execute(
          `INSERT INTO smartsize_rightsizing_actions
           (workspace_id, id, recommendation_id, user_id, status, data, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'Approved', ?, ?, ?)`,
          [workspaceId, action.id, analysis.recommendationId, actor.id, JSON.stringify(action), now(), now()],
        );
      }
      await connection.execute(
        `INSERT INTO smartsize_audit_logs (workspace_id, id, actor_user_id, event_type, resource_id, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [workspaceId, crypto.randomUUID(), actor.id, `MANUAL_RECOMMENDATION_${status.toUpperCase()}`, analysis.resourceId, JSON.stringify({ note: note ?? null }), now()],
      );
      await connection.commit();
      return updated;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },
  async persistAwsSync(
    workspaceId: string,
    inventory: Ec2Inventory,
    metrics: CloudWatchMetrics,
    recommendations: ComputeOptimizerRecommendation[],
    region: string,
    cost?: Extract<CostExplorerResult, { status: "ready" }>,
  ) {
    const pool = getDatabasePool();
    if (!pool) throw new Error("Live AWS synchronization requires DATABASE_URL so workspace inventory can be persisted.");
    const timestamp = now();
    const knownInstanceIds = new Set(inventory.instances.map((instance) => instance.instanceId));
    const metricsByInstance = new Map<string, typeof metrics.metrics>();
    for (const metric of metrics.metrics) {
      const current = metricsByInstance.get(metric.instanceId) ?? [];
      current.push(metric);
      metricsByInstance.set(metric.instanceId, current);
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const instance of inventory.instances) {
        const instanceMetrics = metricsByInstance.get(instance.instanceId) ?? [];
        const cpuValues = instanceMetrics
          .filter((metric) => metric.metricName === "CPUUtilization")
          .flatMap((metric) => metric.datapoints.map((point) => point.value));
        const data = {
          id: instance.instanceId,
          name: instance.name ?? instance.instanceId,
          service: "EC2",
          region,
          instanceType: instance.instanceType,
          state: instance.state,
          availabilityZone: instance.availabilityZone,
          vpcId: instance.vpcId,
          subnetId: instance.subnetId,
          privateIpAddress: instance.privateIpAddress,
          publicIpAddress: instance.publicIpAddress,
          launchTime: instance.launchTime,
          cpu: cpuValues.length ? cpuValues.reduce((sum, value) => sum + value, 0) / cpuValues.length : null,
          peakCpu: cpuValues.length ? Math.max(...cpuValues) : null,
          memory: null,
          peakMemory: null,
          network: null,
          monthlyCost: null,
          metricsAvailable: cpuValues.length > 0,
          source: "AWS_EC2",
        };
        await connection.execute(
          `INSERT INTO smartsize_resources
           (workspace_id, id, source, resource_type, region, status, data, created_at, updated_at)
           VALUES (?, ?, 'AWS_EC2', 'EC2', ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE source = VALUES(source), resource_type = VALUES(resource_type),
             region = VALUES(region), status = VALUES(status), data = VALUES(data), updated_at = VALUES(updated_at)`,
          [workspaceId, instance.instanceId, data.region, instance.state, JSON.stringify(data), timestamp, timestamp],
        );
      }
      for (const volume of inventory.volumes) {
        const data = {
          id: volume.volumeId,
          name: volume.volumeId,
          service: "EBS",
          region,
          instanceType: volume.volumeType,
          state: volume.state,
          sizeGiB: volume.sizeGiB,
          iops: volume.iops,
          throughput: volume.throughput,
          encrypted: volume.encrypted,
          attachments: volume.attachments,
          createTime: volume.createTime,
          cpu: null,
          memory: null,
          network: null,
          monthlyCost: null,
          metricsAvailable: false,
          source: "AWS_EBS",
        };
        await connection.execute(
          `INSERT INTO smartsize_resources
           (workspace_id, id, source, resource_type, region, status, data, created_at, updated_at)
           VALUES (?, ?, 'AWS_EBS', 'EBS', ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE source = VALUES(source), resource_type = VALUES(resource_type),
             region = VALUES(region), status = VALUES(status), data = VALUES(data), updated_at = VALUES(updated_at)`,
          [workspaceId, volume.volumeId, data.region, volume.state, JSON.stringify(data), timestamp, timestamp],
        );
      }
      for (const metric of metrics.metrics) {
        if (!knownInstanceIds.has(metric.instanceId)) continue;
        for (const point of metric.datapoints) {
          await connection.execute(
            `INSERT INTO smartsize_utilization_metrics
             (id, workspace_id, resource_id, metric_name, metric_time, value, unit, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'available', ?)
             ON DUPLICATE KEY UPDATE value = VALUES(value), unit = VALUES(unit), status = VALUES(status)`,
            [crypto.randomUUID(), workspaceId, metric.instanceId, metric.metricName, new Date(point.timestamp), point.value, metric.unit, timestamp],
          );
        }
      }
      let persistedRecommendationCount = 0;
      for (const recommendation of recommendations) {
        const match = recommendation.instanceArn?.match(/:instance\/(i-[a-f0-9]+)$/i);
        const resourceId = match?.[1];
        if (!resourceId || !knownInstanceIds.has(resourceId)) continue;
        for (const option of recommendation.recommendations) {
          if (!option.instanceType) continue;
          const id = crypto.createHash("sha256")
            .update(`${resourceId}:${option.instanceType}`)
            .digest("hex")
            .slice(0, 32);
          const data = { ...recommendation, resourceId, recommendationId: id, option, source: "AWS_COMPUTE_OPTIMIZER" };
          await connection.execute(
            `INSERT INTO smartsize_recommendations
             (workspace_id, id, resource_id, source, status, data, created_at, updated_at)
             VALUES (?, ?, ?, 'AWS_COMPUTE_OPTIMIZER', 'Open', ?, ?, ?)
             ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = VALUES(updated_at)`,
            [workspaceId, id, resourceId, JSON.stringify(data), timestamp, timestamp],
          );
          persistedRecommendationCount += 1;
        }
        if (cost?.amount !== null && cost?.amount !== undefined && cost.currency) {
          await connection.execute(
            `INSERT INTO smartsize_savings_records
             (workspace_id, id, source, amount, currency, data, created_at)
             VALUES (?, ?, 'AWS_COST_EXPLORER', ?, ?, ?, ?)`,
            [workspaceId, crypto.randomUUID(), cost.amount, cost.currency, JSON.stringify(cost), timestamp],
          );
        }
      }
      await connection.execute(
        "UPDATE smartsize_aws_accounts SET last_synced_at = ?, updated_at = ? WHERE workspace_id = ?",
        [timestamp, timestamp, workspaceId],
      );
      await connection.commit();
      return {
        instanceCount: inventory.instances.length,
        volumeCount: inventory.volumes.length,
        metricPointCount: metrics.metrics.reduce((count, metric) => count + metric.datapoints.length, 0),
        recommendationCount: persistedRecommendationCount,
        syncedAt: timestamp.toISOString(),
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async getAwsSnapshot(workspaceId: string) {
    const pool = getDatabasePool();
    if (!pool) throw new Error("Live AWS inventory requires DATABASE_URL.");
    const [resources, recommendations, metrics, savings] = await Promise.all([
      pool.execute<JsonRow[]>(
        "SELECT id, data FROM smartsize_resources WHERE workspace_id = ? AND source IN ('AWS_EC2', 'AWS_EBS') ORDER BY id",
        [workspaceId],
      ),
      pool.execute<JsonRow[]>(
        "SELECT id, data FROM smartsize_recommendations WHERE workspace_id = ? AND source = 'AWS_COMPUTE_OPTIMIZER' ORDER BY id",
        [workspaceId],
      ),
      pool.execute<Array<RowDataPacket & { resource_id: string; metric_name: string; metric_time: Date; value: number | null; unit: string | null; status: string }>>(
        `SELECT resource_id, metric_name, metric_time, value, unit, status
         FROM smartsize_utilization_metrics WHERE workspace_id = ? ORDER BY metric_time DESC LIMIT 10000`,
        [workspaceId],
      ),
      pool.execute<Array<RowDataPacket & { data: string | object }>>(
        "SELECT data FROM smartsize_savings_records WHERE workspace_id = ? AND source = 'AWS_COST_EXPLORER' ORDER BY created_at DESC LIMIT 1",
        [workspaceId],
      ),
    ]);
    return {
      resources: resources[0].map((row) => decode<Record<string, unknown>>(row.data)),
      recommendations: recommendations[0].map((row) => decode<Record<string, unknown>>(row.data)),
      metrics: metrics[0].map((row) => ({
        resourceId: row.resource_id,
        name: row.metric_name,
        timestamp: row.metric_time.toISOString(),
        value: row.value,
        unit: row.unit,
        status: row.status,
      })),
      cost: savings[0][0] ? decode<Record<string, unknown>>(savings[0][0].data) : null,
    };
  },

  async getResources(workspaceId: string): Promise<Resource[]> {
    const pool = getDatabasePool();
    if (!pool) return store.getResources();
    await seedWorkspace(workspaceId);
    const [rows] = await pool.execute<JsonRow[]>(
      "SELECT id, data FROM smartsize_resources WHERE workspace_id = ? ORDER BY id",
      [workspaceId],
    );
    return rows.map((row) => decode<Resource>(row.data));
  },

  async getResource(workspaceId: string, resourceId: string): Promise<Resource | undefined> {
    const resources = await this.getResources(workspaceId);
    return resources.find((resource) => resource.id === resourceId);
  },

  async getRecommendations(workspaceId: string): Promise<StoredRecommendation[]> {
    const pool = getDatabasePool();
    if (!pool) return store.getRecommendations(workspaceId);
    await seedWorkspace(workspaceId);
    const [rows] = await pool.execute<JsonRow[]>(
      "SELECT id, data FROM smartsize_recommendations WHERE workspace_id = ? ORDER BY id",
      [workspaceId],
    );
    return rows.map((row) => decode<StoredRecommendation>(row.data));
  },

  async getSimulations(workspaceId: string): Promise<Simulation[]> {
    const pool = getDatabasePool();
    return pool ? listJson<Simulation>("smartsize_simulations", workspaceId) : store.getSimulations(workspaceId);
  },

  async getReports(workspaceId: string, environmentMode?: "demo" | "manual"): Promise<OptimizationReport[]> {
    const pool = getDatabasePool();
    if (!pool) return store.getReports(workspaceId, environmentMode);
    if (!environmentMode) return listJson<OptimizationReport>("smartsize_reports", workspaceId);
    const [rows] = await pool.execute<JsonRow[]>(
      `SELECT id, data FROM smartsize_reports
       WHERE workspace_id = ? AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data, '$.environmentMode')), 'demo') = ?
       ORDER BY created_at DESC`,
      [workspaceId, environmentMode],
    );
    return rows.map((row) => decode<OptimizationReport>(row.data));
  },

  async getActions(workspaceId: string, source?: "DEMO" | "SMARTSIZE_MANUAL"): Promise<RightsizingAction[]> {
    const pool = getDatabasePool();
    if (!pool) return store.getActions(workspaceId, source);
    if (!source) return listJson<RightsizingAction>("smartsize_rightsizing_actions", workspaceId);
    const [rows] = await pool.execute<JsonRow[]>(
      `SELECT a.id, a.data FROM smartsize_rightsizing_actions a
       JOIN smartsize_recommendations r ON r.workspace_id = a.workspace_id AND r.id = a.recommendation_id
       WHERE a.workspace_id = ? AND r.source = ? ORDER BY a.created_at DESC`,
      [workspaceId, source],
    );
    return rows.map((row) => decode<RightsizingAction>(row.data));
  },

  async getPolicies(workspaceId: string): Promise<RightsizingPolicy[]> {
    const pool = getDatabasePool();
    if (!pool) return store.getPolicies(workspaceId);
    const [rows] = await pool.execute<JsonRow[]>(
      "SELECT id, data FROM smartsize_policies WHERE workspace_id = ? ORDER BY id",
      [workspaceId],
    );
    return rows.map((row) => decode<RightsizingPolicy>(row.data));
  },

  async getAudit(workspaceId: string): Promise<Activity[]> {
    const pool = getDatabasePool();
    if (!pool) return store.getActivity(workspaceId);
    const [rows] = await pool.execute<Array<RowDataPacket & { id: string; actor_user_id: string; event_type: string; resource_id: string | null; metadata: string | object | null; created_at: Date }>>(
      `SELECT a.id, a.actor_user_id, a.event_type, a.resource_id, a.metadata, a.created_at, u.name
       FROM smartsize_audit_logs a JOIN smartsize_users u ON u.id = a.actor_user_id
       WHERE a.workspace_id = ? ORDER BY a.created_at DESC LIMIT 1000`,
      [workspaceId],
    );
    return rows.map((row) => {
      const metadata = row.metadata ? decode<{ status?: string; details?: string }>(row.metadata) : {};
      return {
        id: row.id,
        time: row.created_at.toISOString(),
        action: row.event_type,
        resource: row.resource_id ?? "",
        user: String(row.name),
        status: metadata.status ?? "Recorded",
        details: metadata.details,
      };
    });
  },

  async updateRecommendation(workspaceId: string, id: string, status: "Approved" | "Rejected", actor: User, decisionNote?: string) {
    const pool = getDatabasePool();
    if (!pool) return store.decideRecommendation(id, status, actor, decisionNote, workspaceId);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<JsonRow[]>(
        "SELECT id, data FROM smartsize_recommendations WHERE workspace_id = ? AND id = ? FOR UPDATE",
        [workspaceId, id],
      );
      if (!rows[0]) {
        await connection.rollback();
        return undefined;
      }
      const recommendation = decode<StoredRecommendation>(rows[0].data);
      if (recommendation.status === "Approved" || recommendation.status === "Rejected") {
        await connection.rollback();
        return undefined;
      }
      recommendation.status = status;
      recommendation.updatedAt = now().toISOString();
      recommendation.approvedBy = status === "Approved" ? actor.email : undefined;
      recommendation.approvedAt = status === "Approved" ? recommendation.updatedAt : undefined;
      recommendation.decisionNote = decisionNote;
      await connection.execute(
        "UPDATE smartsize_recommendations SET status = ?, data = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
        [status, JSON.stringify(recommendation), now(), workspaceId, id],
      );
      if (status === "Approved") {
        const action: RightsizingAction = {
          id: crypto.randomUUID(),
          recommendationId: recommendation.id,
          actionType: "Rightsize",
          oldConfiguration: recommendation.current,
          newConfiguration: recommendation.recommended,
          requestedBy: actor.email,
          approvedBy: actor.email,
          status: "Approved",
          createdAt: recommendation.updatedAt,
        };
        await connection.execute(
          `INSERT INTO smartsize_rightsizing_actions
           (workspace_id, id, recommendation_id, user_id, status, data, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [workspaceId, action.id, recommendation.id, actor.id, action.status, JSON.stringify(action), now(), now()],
        );
      }
      await connection.execute(
        `INSERT INTO smartsize_audit_logs
         (workspace_id, id, actor_user_id, event_type, resource_id, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [workspaceId, crypto.randomUUID(), actor.id, status === "Approved" ? "RECOMMENDATION_APPROVED" : "RECOMMENDATION_REJECTED", recommendation.resourceId, JSON.stringify({ status, decisionNote: decisionNote ?? null }), now()],
      );
      await connection.commit();
      return recommendation;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async createSimulation(workspaceId: string, input: Omit<Simulation, "id" | "createdAt">, actor: User) {
    const pool = getDatabasePool();
    if (!pool) return store.createSimulation(input, actor, workspaceId);
    const simulation: Simulation = { ...input, id: crypto.randomUUID(), createdAt: now().toISOString() };
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `INSERT INTO smartsize_simulations (workspace_id, id, user_id, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [workspaceId, simulation.id, actor.id, JSON.stringify(simulation), now(), now()],
      );
      await connection.execute(
        `INSERT INTO smartsize_audit_logs (workspace_id, id, actor_user_id, event_type, metadata, created_at)
         VALUES (?, ?, ?, 'SIMULATION_CREATED', ?, ?)`,
        [workspaceId, crypto.randomUUID(), actor.id, JSON.stringify({ simulationId: simulation.id }), now()],
      );
      await connection.commit();
      return simulation;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async createReport(workspaceId: string, input: Omit<OptimizationReport, "id" | "createdAt">, actor: User) {
    const pool = getDatabasePool();
    if (!pool) return store.createReport(input, actor, workspaceId);
    const report: OptimizationReport = { ...input, id: crypto.randomUUID(), createdAt: now().toISOString() };
    await pool.execute(
      `INSERT INTO smartsize_reports (workspace_id, id, user_id, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [workspaceId, report.id, actor.id, JSON.stringify(report), now(), now()],
    );
    await writeAudit(workspaceId, actor, "REPORT_CREATED", report.name, "Generated");
    return report;
  },

  async updatePolicy(workspaceId: string, id: string, updates: Partial<Omit<RightsizingPolicy, "id" | "environment">>, actor: User) {
    const pool = getDatabasePool();
    if (!pool) return store.updatePolicy(id, updates, actor, workspaceId);
    const [rows] = await pool.execute<JsonRow[]>(
      "SELECT id, data FROM smartsize_policies WHERE workspace_id = ? AND id = ? LIMIT 1",
      [workspaceId, id],
    );
    if (!rows[0]) return undefined;
    const policy = { ...decode<RightsizingPolicy>(rows[0].data), ...updates };
    await pool.execute(
      "UPDATE smartsize_policies SET data = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
      [JSON.stringify(policy), now(), workspaceId, id],
    );
    await writeAudit(workspaceId, actor, "POLICY_UPDATED", id, "Updated", JSON.stringify(updates));
    return policy;
  },

  async scheduleAction(workspaceId: string, id: string, scheduledAt: string, actor: User) {
    const pool = getDatabasePool();
    if (!pool) return store.scheduleAction(id, scheduledAt, actor, workspaceId);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<JsonRow[]>(
        "SELECT id, data FROM smartsize_rightsizing_actions WHERE workspace_id = ? AND id = ? FOR UPDATE",
        [workspaceId, id],
      );
      if (!rows[0]) {
        await connection.rollback();
        return undefined;
      }
      const action = decode<RightsizingAction>(rows[0].data);
      if (action.status !== "Approved") {
        await connection.rollback();
        return undefined;
      }
      action.status = "Scheduled";
      action.scheduledAt = scheduledAt;
      await connection.execute(
        "UPDATE smartsize_rightsizing_actions SET status = ?, data = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
        [action.status, JSON.stringify(action), now(), workspaceId, id],
      );
      await connection.execute(
        `INSERT INTO smartsize_audit_logs
         (workspace_id, id, actor_user_id, event_type, resource_id, metadata, created_at)
         VALUES (?, ?, ?, 'ACTION_SCHEDULED', ?, ?, ?)`,
        [workspaceId, crypto.randomUUID(), actor.id, action.recommendationId, JSON.stringify({ actionId: id, scheduledAt }), now()],
      );
      await connection.commit();
      return action;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async simulateAction(workspaceId: string, id: string, actor: User) {
    const pool = getDatabasePool();
    if (!pool) return store.simulateAction(id, actor, workspaceId);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.execute<JsonRow[]>(
        "SELECT id, data FROM smartsize_rightsizing_actions WHERE workspace_id = ? AND id = ? FOR UPDATE",
        [workspaceId, id],
      );
      if (!rows[0]) {
        await connection.rollback();
        return undefined;
      }
      const action = decode<RightsizingAction>(rows[0].data);
      if (action.status !== "Scheduled") {
        await connection.rollback();
        return undefined;
      }
      action.status = "Simulated";
      action.executedAt = now().toISOString();
      await connection.execute(
        "UPDATE smartsize_rightsizing_actions SET status = ?, data = ?, updated_at = ? WHERE workspace_id = ? AND id = ?",
        [action.status, JSON.stringify(action), now(), workspaceId, id],
      );
      await connection.execute(
        `INSERT INTO smartsize_audit_logs
         (workspace_id, id, actor_user_id, event_type, resource_id, metadata, created_at)
         VALUES (?, ?, ?, 'ACTION_SIMULATED', ?, ?, ?)`,
        [workspaceId, crypto.randomUUID(), actor.id, action.recommendationId, JSON.stringify({ actionId: id, note: "No AWS resource was modified." }), now()],
      );
      await connection.commit();
      return action;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async recordAudit(workspaceId: string, actor: User, action: string, resource: string, status: string, details?: string) {
    await writeAudit(workspaceId, actor, action, resource, status, details);
  },
};
