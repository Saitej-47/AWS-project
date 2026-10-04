import { describe, expect, it, vi } from "vitest";
import {
  GetMetricDataCommand,
  ListMetricsCommand,
} from "@aws-sdk/client-cloudwatch";
import {
  GetEC2InstanceRecommendationsCommand,
  GetEnrollmentStatusCommand,
} from "@aws-sdk/client-compute-optimizer";
import { GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer";
import {
  DescribeInstancesCommand,
  DescribeVolumesCommand,
} from "@aws-sdk/client-ec2";
import { GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import {
  AwsReadOnlyService,
  type ReadOnlyAwsClient,
} from "./awsReadOnlyService";

function client(
  send: (command: object) => Promise<unknown>
): ReadOnlyAwsClient {
  return { send };
}

describe("AwsReadOnlyService", () => {
  it("uses the configured region and returns only caller identity fields", async () => {
    const send = vi.fn(async (command: object) => {
      expect(command).toBeInstanceOf(GetCallerIdentityCommand);
      return {
        Account: "123456789012",
        Arn: "arn:aws:iam::123456789012:user/test",
        UserId: "user-id",
      };
    });
    const service = new AwsReadOnlyService({
      env: { AWS_REGION: "eu-west-1" },
      factories: { sts: () => client(send) },
    });

    await expect(service.getIdentity()).resolves.toEqual({
      status: "ready",
      accountId: "123456789012",
      arn: "arn:aws:iam::123456789012:user/test",
      userId: "user-id",
      region: "eu-west-1",
    });
  });

  it.each([
    [
      new Error("Could not load credentials from any providers"),
      "NO_CREDENTIALS",
    ],
    [
      Object.assign(new Error("expired"), { name: "ExpiredToken" }),
      "INVALID_CREDENTIALS",
    ],
    [
      Object.assign(new Error("denied"), { name: "AccessDeniedException" }),
      "ACCESS_DENIED",
    ],
    [new Error("credential=must-not-escape"), "SERVICE_ERROR"],
  ] as const)(
    "classifies STS errors without returning raw error details",
    async (error, category) => {
      const service = new AwsReadOnlyService({
        factories: { sts: () => client(async () => Promise.reject(error)) },
      });
      const result = await service.getIdentity();

      expect(result).toMatchObject({ status: "error", category });
      expect(JSON.stringify(result)).not.toContain(
        "credential=must-not-escape"
      );
    }
  );

  it("loads readonly EC2 instances and volumes and maps only safe resource fields", async () => {
    const commands: object[] = [];
    const ec2 = client(async command => {
      commands.push(command);
      if (command instanceof DescribeInstancesCommand) {
        return {
          Reservations: [
            {
              Instances: [
                {
                  InstanceId: "i-123",
                  InstanceType: "t3.micro",
                  State: { Name: "running" },
                  Tags: [
                    { Key: "Name", Value: "web" },
                    { Key: "Secret", Value: "do-not-return" },
                  ],
                  Placement: { AvailabilityZone: "ap-south-1a" },
                  PrivateIpAddress: "10.0.0.1",
                  Credentials: "do-not-return",
                },
              ],
            },
          ],
        };
      }
      if (command instanceof DescribeVolumesCommand) {
        return {
          Volumes: [
            {
              VolumeId: "vol-123",
              State: "in-use",
              Size: 20,
              VolumeType: "gp3",
              Encrypted: true,
              Attachments: [
                { InstanceId: "i-123", Device: "/dev/xvda", State: "attached" },
              ],
            },
          ],
        };
      }
      throw new Error("Unexpected command");
    });
    const service = new AwsReadOnlyService({ factories: { ec2: () => ec2 } });
    const result = await service.getEc2Inventory();

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.data.instances).toEqual([
      expect.objectContaining({
        instanceId: "i-123",
        instanceType: "t3.micro",
        state: "running",
        name: "web",
      }),
    ]);
    expect(result.data.volumes[0]).toMatchObject({
      volumeId: "vol-123",
      sizeGiB: 20,
      encrypted: true,
      attachments: [
        { instanceId: "i-123", device: "/dev/xvda", state: "attached" },
      ],
    });
    expect(commands.map(command => command.constructor)).toEqual([
      DescribeInstancesCommand,
      DescribeVolumesCommand,
    ]);
    expect(JSON.stringify(result)).not.toContain("do-not-return");
  });

  it("queries actual EC2 CloudWatch metrics with the requested time range and no memory metric", async () => {
    const now = new Date("2026-10-04T00:00:00.000Z");
    const send = vi.fn(async (command: object) => {
      expect(command).toBeInstanceOf(GetMetricDataCommand);
      const request = (command as GetMetricDataCommand).input;
      expect(request.StartTime).toEqual(new Date("2026-10-03T00:00:00.000Z"));
      expect(request.EndTime).toEqual(now);
      expect(
        request.MetricDataQueries?.map(
          query => query.MetricStat?.Metric.MetricName
        )
      ).toEqual(["CPUUtilization", "NetworkIn", "NetworkOut"]);
      expect(
        request.MetricDataQueries?.every(
          query => query.MetricStat?.Period === 300
        )
      ).toBe(true);
      return {
        MetricDataResults: [
          {
            Id: request.MetricDataQueries?.[0].Id,
            Timestamps: [new Date("2026-10-03T00:05:00.000Z")],
            Values: [12.5],
          },
        ],
      };
    });
    const service = new AwsReadOnlyService({
      now: () => now,
      factories: { cloudWatch: () => client(send) },
    });
    const result = await service.getCloudWatchMetrics(["i-1"], {
      periodSeconds: 300,
      lookbackHours: 24,
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.data.metrics).toHaveLength(3);
    expect(result.data.metrics[0].datapoints).toEqual([
      {
        timestamp: "2026-10-03T00:05:00.000Z",
        value: 12.5,
      },
    ]);
    expect(result.data.metrics.map(metric => metric.metricName)).not.toContain(
      "MemoryUtilization"
    );
  });

  it("returns analysis-not-ready instead of fabricated optimizer recommendations when not enrolled", async () => {
    const send = vi.fn(async (command: object) => {
      expect(command).toBeInstanceOf(GetEnrollmentStatusCommand);
      return { status: "Inactive" };
    });
    const service = new AwsReadOnlyService({
      factories: { computeOptimizer: () => client(send) },
    });

    await expect(
      service.getComputeOptimizerRecommendations()
    ).resolves.toMatchObject({
      status: "analysis_not_ready",
      source: "AWS_COMPUTE_OPTIMIZER",
      enrollmentStatus: "Inactive",
      recommendations: [],
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalledWith(
      expect.any(GetEC2InstanceRecommendationsCommand)
    );
  });

  it("returns real Compute Optimizer recommendations when enrolled", async () => {
    const send = vi.fn(async (command: object) => {
      if (command instanceof GetEnrollmentStatusCommand)
        return { status: "Active" };
      expect(command).toBeInstanceOf(GetEC2InstanceRecommendationsCommand);
      return {
        instanceRecommendations: [
          {
            InstanceArn: "arn:aws:ec2:ap-south-1:123456789012:instance/i-1",
            CurrentInstanceType: "t3.large",
            Finding: "Overprovisioned",
            RecommendationOptions: [
              {
                InstanceType: "t3.medium",
                SavingsOpportunity: {
                  EstimatedMonthlySavings: { Value: "12.50", Currency: "USD" },
                  SavingsOpportunityPercentage: 20,
                },
              },
            ],
          },
        ],
      };
    });
    const service = new AwsReadOnlyService({
      factories: { computeOptimizer: () => client(send) },
    });

    await expect(
      service.getComputeOptimizerRecommendations()
    ).resolves.toMatchObject({
      status: "ready",
      source: "AWS_COMPUTE_OPTIMIZER",
      recommendations: [
        {
          currentInstanceType: "t3.large",
          finding: "Overprovisioned",
          recommendations: [
            {
              instanceType: "t3.medium",
              estimatedMonthlySavings: { amount: 12.5, currency: "USD" },
              savingsOpportunityPercentage: 20,
            },
          ],
        },
      ],
    });
  });

  it("queries Cost Explorer and reports failures as unavailable without exposing AWS error text", async () => {
    const now = new Date("2026-10-04T00:00:00.000Z");
    const send = vi.fn(async (command: object) => {
      expect(command).toBeInstanceOf(GetCostAndUsageCommand);
      const request = (command as GetCostAndUsageCommand).input;
      expect(request.TimePeriod).toEqual({
        Start: "2026-10-01",
        End: "2026-10-04",
      });
      return {
        ResultsByTime: [
          { Total: { UnblendedCost: { Amount: "1.25", Unit: "USD" } } },
          { Total: { UnblendedCost: { Amount: "2.75", Unit: "USD" } } },
        ],
      };
    });
    const service = new AwsReadOnlyService({
      now: () => now,
      factories: { costExplorer: () => client(send) },
    });
    await expect(
      service.getCostExplorer({ lookbackDays: 3 })
    ).resolves.toMatchObject({
      status: "ready",
      period: { start: "2026-10-01", end: "2026-10-04" },
      amount: 4,
      currency: "USD",
    });

    const failing = new AwsReadOnlyService({
      now: () => now,
      factories: {
        costExplorer: () =>
          client(async () => {
            throw Object.assign(new Error("private token string"), {
              name: "AccessDeniedException",
            });
          }),
      },
    });
    const unavailable = await failing.getCostExplorer();
    expect(unavailable).toMatchObject({
      status: "unavailable",
      category: "ACCESS_DENIED",
    });
    expect(JSON.stringify(unavailable)).not.toContain("private token string");
  });

  it("probes AWS service availability using only read operations", async () => {
    const factories = {
      sts: () =>
        client(async () => ({
          Account: "123456789012",
          Arn: "arn:aws:iam::123456789012:role/read-only",
          UserId: "role-id",
        })),
      ec2: () =>
        client(async command => {
          expect([DescribeInstancesCommand, DescribeVolumesCommand].some(Type => command instanceof Type)).toBe(true);
          return {};
        }),
      cloudWatch: () =>
        client(async command => {
          expect(command).toBeInstanceOf(ListMetricsCommand);
          return {};
        }),
      computeOptimizer: () =>
        client(async command => {
          expect(command).toBeInstanceOf(GetEnrollmentStatusCommand);
          return {};
        }),
      costExplorer: () =>
        client(async command => {
          expect(command).toBeInstanceOf(GetCostAndUsageCommand);
          return {};
        }),
    };
    const service = new AwsReadOnlyService({ factories });

    await expect(service.getHealth()).resolves.toMatchObject({
      status: "ready",
      services: {
        sts: { status: "available" },
        ec2: { status: "available" },
        ebs: { status: "available" },
        cloudWatch: { status: "available" },
        computeOptimizer: { status: "available" },
        costExplorer: { status: "available" },
      },
    });
  });
});
