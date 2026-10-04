import {
  CloudWatchClient,
  GetMetricDataCommand,
  ListMetricsCommand,
} from "@aws-sdk/client-cloudwatch";
import {
  ComputeOptimizerClient,
  GetEC2InstanceRecommendationsCommand,
  GetEnrollmentStatusCommand,
} from "@aws-sdk/client-compute-optimizer";
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
} from "@aws-sdk/client-cost-explorer";
import {
  DescribeInstancesCommand,
  DescribeVolumesCommand,
  EC2Client,
} from "@aws-sdk/client-ec2";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import type {
  AwsErrorCategory,
  AwsHealthResult,
  AwsHealthServiceStatus,
  AwsIdentityResult,
  AwsOperationResult,
  CloudWatchMetric,
  CloudWatchMetricName,
  CloudWatchMetrics,
  ComputeOptimizerRecommendation,
  ComputeOptimizerResult,
  CostExplorerResult,
  Ec2Instance,
  Ec2Inventory,
  Ec2Volume,
} from "./contracts";

export type ReadOnlyAwsClient = {
  send(command: object): Promise<unknown>;
};

export type AwsClientFactories = {
  sts: () => ReadOnlyAwsClient;
  ec2: () => ReadOnlyAwsClient;
  cloudWatch: () => ReadOnlyAwsClient;
  computeOptimizer: () => ReadOnlyAwsClient;
  costExplorer: () => ReadOnlyAwsClient;
};

export type AwsReadOnlyServiceOptions = {
  region?: string;
  env?: Record<string, string | undefined>;
  factories?: Partial<AwsClientFactories>;
  now?: () => Date;
};

export type CloudWatchQueryOptions = {
  periodSeconds?: number;
  lookbackHours?: number;
};

export type CostQueryOptions = { lookbackDays?: number };

type AwsErrorLike = {
  name?: unknown;
  code?: unknown;
  Code?: unknown;
  message?: unknown;
  $metadata?: { httpStatusCode?: unknown };
};

const safeMessages: Record<AwsErrorCategory, string> = {
  NO_CREDENTIALS:
    "AWS credentials were not found in the configured credential chain.",
  INVALID_CREDENTIALS: "AWS rejected the configured credentials.",
  ACCESS_DENIED:
    "The configured AWS identity does not have permission for this operation.",
  SERVICE_ERROR: "The AWS service request could not be completed.",
};

const METRIC_NAMES: CloudWatchMetricName[] = [
  "CPUUtilization",
  "NetworkIn",
  "NetworkOut",
];

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

function validPeriod(value: number): boolean {
  return (
    Number.isInteger(value) && value >= 60 && value <= 86400 && value % 60 === 0
  );
}

export function classifyAwsError(error: unknown): AwsErrorCategory {
  const candidate = (error ?? {}) as AwsErrorLike;
  const name = String(
    candidate.name ?? candidate.code ?? candidate.Code ?? ""
  ).toLowerCase();
  const message =
    typeof candidate.message === "string"
      ? candidate.message.toLowerCase()
      : "";
  const status = candidate.$metadata?.httpStatusCode;

  if (
    name.includes("credentialprovider") ||
    name.includes("credentialsprovider") ||
    name.includes("credential_unavailable") ||
    message.includes("could not load credentials") ||
    message.includes("unable to locate credentials") ||
    message.includes("no credential providers")
  ) {
    return "NO_CREDENTIALS";
  }
  if (
    name.includes("expiredtoken") ||
    name.includes("invalidclienttokenid") ||
    name.includes("signaturedoesnotmatch") ||
    name.includes("unrecognizedclient") ||
    name.includes("invalididentitytoken") ||
    name.includes("tokenrefreshrequired") ||
    name.includes("invalidaccesskey")
  ) {
    return "INVALID_CREDENTIALS";
  }
  if (
    name.includes("accessdenied") ||
    name.includes("unauthorizedoperation") ||
    name.includes("notauthorized") ||
    name.includes("forbidden") ||
    status === 403
  ) {
    return "ACCESS_DENIED";
  }
  return "SERVICE_ERROR";
}

function categoryFromServiceErrorCode(code: unknown): AwsErrorCategory {
  if (typeof code !== "string") return "SERVICE_ERROR";
  const normalized = code.toLowerCase();
  if (
    normalized.includes("access_denied") ||
    normalized.includes("accessdenied")
  ) {
    return "ACCESS_DENIED";
  }
  if (
    normalized.includes("opt_in_required") ||
    normalized.includes("not_enrolled")
  ) {
    return "SERVICE_ERROR";
  }
  return classifyAwsError({ name: code });
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function mapInstance(value: Record<string, unknown>): Ec2Instance | null {
  const instanceId = stringField(value.InstanceId);
  if (!instanceId) return null;
  const state = value.State as Record<string, unknown> | undefined;
  const placement = value.Placement as Record<string, unknown> | undefined;
  const tags = Array.isArray(value.Tags)
    ? (value.Tags as Array<Record<string, unknown>>)
    : [];
  const name = tags.find(tag => tag.Key === "Name");
  const launchTime =
    value.LaunchTime instanceof Date
      ? value.LaunchTime.toISOString()
      : stringField(value.LaunchTime);
  return {
    instanceId,
    instanceType: stringField(value.InstanceType),
    state: stringField(state?.Name),
    name: stringField(name?.Value),
    launchTime,
    availabilityZone: stringField(placement?.AvailabilityZone),
    vpcId: stringField(value.VpcId),
    subnetId: stringField(value.SubnetId),
    privateIpAddress: stringField(value.PrivateIpAddress),
    publicIpAddress: stringField(value.PublicIpAddress),
  };
}

function mapVolume(value: Record<string, unknown>): Ec2Volume | null {
  const volumeId = stringField(value.VolumeId);
  if (!volumeId) return null;
  const attachments = Array.isArray(value.Attachments)
    ? (value.Attachments as Array<Record<string, unknown>>)
    : [];
  const createTime =
    value.CreateTime instanceof Date
      ? value.CreateTime.toISOString()
      : stringField(value.CreateTime);
  return {
    volumeId,
    state: stringField(value.State),
    sizeGiB: numberField(value.Size),
    volumeType: stringField(value.VolumeType),
    iops: numberField(value.Iops),
    throughput: numberField(value.Throughput),
    availabilityZone: stringField(value.AvailabilityZone),
    encrypted: typeof value.Encrypted === "boolean" ? value.Encrypted : null,
    createTime,
    attachments: attachments.map(attachment => ({
      instanceId: stringField(attachment.InstanceId),
      device: stringField(attachment.Device),
      state: stringField(attachment.State),
    })),
  };
}

function mapRecommendation(
  value: Record<string, unknown>
): ComputeOptimizerRecommendation {
  const options = Array.isArray(value.RecommendationOptions)
    ? (value.RecommendationOptions as Array<Record<string, unknown>>)
    : [];
  return {
    instanceArn: stringField(value.InstanceArn),
    instanceName: stringField(value.InstanceName),
    currentInstanceType: stringField(value.CurrentInstanceType),
    finding: stringField(value.Finding),
    findingReasonCodes: Array.isArray(value.FindingReasonCodes)
      ? value.FindingReasonCodes.filter(
          (code): code is string => typeof code === "string"
        )
      : [],
    recommendations: options.map(option => {
      const savings = option.SavingsOpportunity as
        Record<string, unknown> | undefined;
      const savingsEstimate = savings?.EstimatedMonthlySavings as
        Record<string, unknown> | undefined;
      const utilization = Array.isArray(option.ProjectedUtilizationMetrics)
        ? (option.ProjectedUtilizationMetrics as Array<Record<string, unknown>>)
        : [];
      return {
        instanceType: stringField(option.InstanceType),
        performanceRisk: stringField(option.PerformanceRisk),
        projectedUtilization: utilization.map(metric => ({
          name: stringField(metric.Name),
          value: numberField(metric.Value),
        })),
        estimatedMonthlySavings: savingsEstimate
          ? {
              amount: numericValue(savingsEstimate.Value),
              currency: stringField(savingsEstimate.Currency),
            }
          : null,
        savingsOpportunityPercentage: numberField(
          savings?.SavingsOpportunityPercentage
        ),
      };
    }),
  };
}

export class AwsReadOnlyService {
  readonly region: string;
  private readonly factories: AwsClientFactories;
  private readonly env: Record<string, string | undefined>;
  private readonly now: () => Date;

  constructor(options: AwsReadOnlyServiceOptions = {}) {
    this.env = options.env ?? process.env;
    this.region = options.region || this.env.AWS_REGION || "ap-south-1";
    this.now = options.now ?? (() => new Date());
    this.factories = {
      sts:
        options.factories?.sts ??
        (() =>
          new STSClient({
            region: this.region,
          }) as unknown as ReadOnlyAwsClient),
      ec2:
        options.factories?.ec2 ??
        (() =>
          new EC2Client({
            region: this.region,
          }) as unknown as ReadOnlyAwsClient),
      cloudWatch:
        options.factories?.cloudWatch ??
        (() =>
          new CloudWatchClient({
            region: this.region,
          }) as unknown as ReadOnlyAwsClient),
      computeOptimizer:
        options.factories?.computeOptimizer ??
        (() =>
          new ComputeOptimizerClient({
            region: this.region,
          }) as unknown as ReadOnlyAwsClient),
      costExplorer:
        options.factories?.costExplorer ??
        (() =>
          new CostExplorerClient({
            region: this.env.AWS_COST_EXPLORER_REGION || "us-east-1",
          }) as unknown as ReadOnlyAwsClient),
    };
  }

  async getIdentity(): Promise<AwsIdentityResult> {
    try {
      const result = (await this.factories
        .sts()
        .send(new GetCallerIdentityCommand({}))) as Record<string, unknown>;
      const accountId = stringField(result.Account);
      const arn = stringField(result.Arn);
      const userId = stringField(result.UserId);
      if (!accountId || !arn || !userId) {
        return {
          status: "error",
          category: "SERVICE_ERROR",
          message: safeMessages.SERVICE_ERROR,
          region: this.region,
        };
      }
      return { status: "ready", accountId, arn, userId, region: this.region };
    } catch (error) {
      const category = classifyAwsError(error);
      return {
        status: "error",
        category,
        message: safeMessages[category],
        region: this.region,
      };
    }
  }

  async getHealth(): Promise<AwsHealthResult> {
    const identity = await this.getIdentity();
    if (identity.status !== "ready") {
      const services = {
        sts: {
          status: "unavailable",
          category: identity.category,
          message: identity.message,
        } as const,
        ec2: { status: "not_checked", category: identity.category } as const,
        ebs: { status: "not_checked", category: identity.category } as const,
        cloudWatch: {
          status: "not_checked",
          category: identity.category,
        } as const,
        computeOptimizer: {
          status: "not_checked",
          category: identity.category,
        } as const,
        costExplorer: {
          status: "not_checked",
          category: identity.category,
        } as const,
      };
      return { status: "error", region: this.region, identity, services };
    }

    const [sts, ec2, ebs, cloudWatch, computeOptimizer, costExplorer] = await Promise.all(
      [
        Promise.resolve({ status: "available" as const }),
        this.probe(async () =>
          this.factories
            .ec2()
            .send(new DescribeInstancesCommand({ MaxResults: 5 }))
        ),
        this.probe(async () =>
          this.factories
            .ec2()
            .send(new DescribeVolumesCommand({ MaxResults: 5 }))
        ),
        this.probe(async () =>
          this.factories
            .cloudWatch()
            .send(new ListMetricsCommand({ Namespace: "AWS/EC2" }))
        ),
        this.probe(async () =>
          this.factories
            .computeOptimizer()
            .send(new GetEnrollmentStatusCommand({}))
        ),
        this.probe(async () => {
          const { start, end } = this.getCostPeriod(1);
          return this.factories.costExplorer().send(
            new GetCostAndUsageCommand({
              TimePeriod: { Start: start, End: end },
              Granularity: "DAILY",
              Metrics: ["UnblendedCost"],
            })
          );
        }),
      ]
    );
    const services = { sts, ec2, ebs, cloudWatch, computeOptimizer, costExplorer };
    return {
      status: Object.values(services).every(
        service => service.status === "available"
      )
        ? "ready"
        : "error",
      region: this.region,
      identity,
      services,
    };
  }

  async getEc2Inventory(): Promise<AwsOperationResult<Ec2Inventory>> {
    try {
      const ec2 = this.factories.ec2();
      const instances: Ec2Instance[] = [];
      let instanceToken: string | undefined;
      const seenInstanceTokens = new Set<string>();
      do {
        const response = (await ec2.send(
          new DescribeInstancesCommand({
            ...(instanceToken ? { NextToken: instanceToken } : {}),
          })
        )) as {
          Reservations?: Array<{ Instances?: Array<Record<string, unknown>> }>;
          NextToken?: string;
        };
        for (const reservation of response.Reservations ?? []) {
          for (const item of reservation.Instances ?? []) {
            const instance = mapInstance(item);
            if (instance) instances.push(instance);
          }
        }
        instanceToken = response.NextToken;
        if (instanceToken && seenInstanceTokens.has(instanceToken)) break;
        if (instanceToken) seenInstanceTokens.add(instanceToken);
      } while (instanceToken);

      const volumes: Ec2Volume[] = [];
      let volumeToken: string | undefined;
      const seenVolumeTokens = new Set<string>();
      do {
        const response = (await ec2.send(
          new DescribeVolumesCommand({
            ...(volumeToken ? { NextToken: volumeToken } : {}),
          })
        )) as { Volumes?: Array<Record<string, unknown>>; NextToken?: string };
        for (const item of response.Volumes ?? []) {
          const volume = mapVolume(item);
          if (volume) volumes.push(volume);
        }
        volumeToken = response.NextToken;
        if (volumeToken && seenVolumeTokens.has(volumeToken)) break;
        if (volumeToken) seenVolumeTokens.add(volumeToken);
      } while (volumeToken);

      return {
        status: "ready",
        data: { instances, volumes },
        region: this.region,
      };
    } catch (error) {
      return this.unavailable(error);
    }
  }

  async getCloudWatchMetrics(
    instanceIds: string[],
    options: CloudWatchQueryOptions = {}
  ): Promise<AwsOperationResult<CloudWatchMetrics>> {
    const configuredPeriod =
      options.periodSeconds ??
      safeInteger(this.env.AWS_CLOUDWATCH_PERIOD_SECONDS, 3600, 60, 86400);
    const periodSeconds = validPeriod(configuredPeriod)
      ? configuredPeriod
      : 3600;
    const configuredLookbackHours =
      options.lookbackHours ??
      safeInteger(this.env.AWS_CLOUDWATCH_LOOKBACK_HOURS, 24, 1, 8760);
    const lookbackHours =
      Number.isInteger(configuredLookbackHours) &&
      configuredLookbackHours >= 1 &&
      configuredLookbackHours <= 8760
        ? configuredLookbackHours
        : 24;
    const endTime = this.now();
    const startTime = new Date(
      endTime.getTime() - lookbackHours * 60 * 60 * 1000
    );
    const range = {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
    };
    if (instanceIds.length === 0) {
      return {
        status: "ready",
        data: { periodSeconds, ...range, metrics: [] },
        region: this.region,
      };
    }

    const queries: Array<{
      Id: string;
      MetricStat: {
        Metric: {
          Namespace: string;
          MetricName: CloudWatchMetricName;
          Dimensions: Array<{ Name: string; Value: string }>;
        };
        Period: number;
        Stat: "Average" | "Sum";
      };
      ReturnData: true;
    }> = [];
    const metadata = new Map<
      string,
      { instanceId: string; metricName: CloudWatchMetricName }
    >();
    let queryIndex = 0;
    for (const instanceId of Array.from(new Set(instanceIds))) {
      for (const metricName of METRIC_NAMES) {
        const id = `q${queryIndex++}`;
        metadata.set(id, { instanceId, metricName });
        queries.push({
          Id: id,
          MetricStat: {
            Metric: {
              Namespace: "AWS/EC2",
              MetricName: metricName,
              Dimensions: [{ Name: "InstanceId", Value: instanceId }],
            },
            Period: periodSeconds,
            Stat: metricName === "CPUUtilization" ? "Average" : "Sum",
          },
          ReturnData: true,
        });
      }
    }

    try {
      const cloudWatch = this.factories.cloudWatch();
      const metricResults = new Map<
        string,
        {
          unit: string | null;
          datapoints: Array<{ timestamp: string; value: number }>;
        }
      >();
      for (let offset = 0; offset < queries.length; offset += 500) {
        const queryBatch = queries.slice(offset, offset + 500);
        let nextToken: string | undefined;
        const seenTokens = new Set<string>();
        do {
          const response = (await cloudWatch.send(
            new GetMetricDataCommand({
              MetricDataQueries: queryBatch,
              StartTime: startTime,
              EndTime: endTime,
              ScanBy: "TimestampAscending",
              ...(nextToken ? { NextToken: nextToken } : {}),
            })
          )) as {
            MetricDataResults?: Array<{
              Id?: string;
              StatusCode?: string;
              Timestamps?: Date[];
              Values?: number[];
              Label?: string;
            }>;
            NextToken?: string;
          };
          for (const result of response.MetricDataResults ?? []) {
            if (!result.Id || !metadata.has(result.Id)) continue;
            const current = metricResults.get(result.Id) ?? {
              unit: null,
              datapoints: [],
            };
            for (let i = 0; i < (result.Timestamps?.length ?? 0); i += 1) {
              const timestamp = result.Timestamps?.[i];
              const value = result.Values?.[i];
              if (
                timestamp instanceof Date &&
                typeof value === "number" &&
                Number.isFinite(value)
              ) {
                current.datapoints.push({
                  timestamp: timestamp.toISOString(),
                  value,
                });
              }
            }
            metricResults.set(result.Id, current);
          }
          nextToken = response.NextToken;
          if (nextToken && seenTokens.has(nextToken)) break;
          if (nextToken) seenTokens.add(nextToken);
        } while (nextToken);
      }

      const metrics: CloudWatchMetric[] = [];
      for (const [id, info] of Array.from(metadata)) {
        const result = metricResults.get(id);
        metrics.push({
          ...info,
          unit: result?.unit ?? null,
          datapoints: result?.datapoints ?? [],
        });
      }
      return {
        status: "ready",
        data: { periodSeconds, ...range, metrics },
        region: this.region,
      };
    } catch (error) {
      return this.unavailable(error);
    }
  }

  async getComputeOptimizerRecommendations(): Promise<ComputeOptimizerResult> {
    const source = "AWS_COMPUTE_OPTIMIZER" as const;
    try {
      const client = this.factories.computeOptimizer();
      const enrollment = (await client.send(
        new GetEnrollmentStatusCommand({})
      )) as {
        status?: string;
        Status?: string;
      };
      const enrollmentStatus = enrollment.status ?? enrollment.Status ?? null;
      if (enrollmentStatus !== "Active") {
        return {
          status: "analysis_not_ready",
          source,
          enrollmentStatus,
          recommendations: [],
          message:
            "Compute Optimizer analysis is not ready because the account is not actively enrolled.",
          region: this.region,
        };
      }

      const recommendations: ComputeOptimizerRecommendation[] = [];
      let nextToken: string | undefined;
      const seenTokens = new Set<string>();
      do {
        const response = (await client.send(
          new GetEC2InstanceRecommendationsCommand({
            ...(nextToken ? { nextToken } : {}),
          })
        )) as {
          instanceRecommendations?: Array<Record<string, unknown>>;
          nextToken?: string;
          errors?: Array<{ errorCode?: string }>;
        };
        const firstError = response.errors?.[0]?.errorCode;
        if (firstError) {
          const category = categoryFromServiceErrorCode(firstError);
          return {
            status: "unavailable",
            source,
            category,
            message: safeMessages[category],
            region: this.region,
          };
        }
        for (const recommendation of response.instanceRecommendations ?? []) {
          recommendations.push(mapRecommendation(recommendation));
        }
        nextToken = response.nextToken;
        if (nextToken && seenTokens.has(nextToken)) break;
        if (nextToken) seenTokens.add(nextToken);
      } while (nextToken);

      return {
        status: "ready",
        source,
        enrollmentStatus,
        recommendations,
        region: this.region,
      };
    } catch (error) {
      const category = classifyAwsError(error);
      return {
        status: "unavailable",
        source,
        category,
        message: safeMessages[category],
        region: this.region,
      };
    }
  }

  async getCostExplorer(
    options: CostQueryOptions = {}
  ): Promise<CostExplorerResult> {
    const configuredLookbackDays =
      options.lookbackDays ??
      safeInteger(this.env.AWS_COST_LOOKBACK_DAYS, 30, 1, 365);
    const lookbackDays =
      Number.isInteger(configuredLookbackDays) &&
      configuredLookbackDays >= 1 &&
      configuredLookbackDays <= 365
        ? configuredLookbackDays
        : 30;
    const period = this.getCostPeriod(lookbackDays);
    try {
      const response = (await this.factories.costExplorer().send(
        new GetCostAndUsageCommand({
          TimePeriod: { Start: period.start, End: period.end },
          Granularity: "DAILY",
          Metrics: ["UnblendedCost"],
        })
      )) as {
        ResultsByTime?: Array<{
          Total?: Record<string, { Amount?: string; Unit?: string }>;
        }>;
      };
      let amount = 0;
      let currency: string | null = null;
      let found = false;
      for (const result of response.ResultsByTime ?? []) {
        const cost = result.Total?.UnblendedCost;
        if (!cost) continue;
        const parsed = Number(cost.Amount);
        if (Number.isFinite(parsed)) {
          amount += parsed;
          found = true;
        }
        currency = currency ?? stringField(cost.Unit);
      }
      return {
        status: "ready",
        period,
        currency,
        amount: found ? amount : null,
        region: this.region,
      };
    } catch (error) {
      const category = classifyAwsError(error);
      return {
        status: "unavailable",
        category,
        message: safeMessages[category],
        period,
        region: this.region,
      };
    }
  }

  private getCostPeriod(lookbackDays: number): { start: string; end: string } {
    const endDate = this.now();
    const startDate = new Date(
      endDate.getTime() - lookbackDays * 24 * 60 * 60 * 1000
    );
    return { start: dateOnly(startDate), end: dateOnly(endDate) };
  }

  private async probe(
    operation: () => Promise<unknown>
  ): Promise<AwsHealthServiceStatus> {
    try {
      await operation();
      return { status: "available" };
    } catch (error) {
      const category = classifyAwsError(error);
      return {
        status: "unavailable",
        category,
        message: safeMessages[category],
      };
    }
  }

  private unavailable<T>(error: unknown): AwsOperationResult<T> {
    const category = classifyAwsError(error);
    return {
      status: "unavailable",
      category,
      message: safeMessages[category],
      region: this.region,
    };
  }
}

export function createAwsReadOnlyService(
  options?: AwsReadOnlyServiceOptions
): AwsReadOnlyService {
  return new AwsReadOnlyService(options);
}
