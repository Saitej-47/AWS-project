export type AwsErrorCategory =
  "NO_CREDENTIALS" | "INVALID_CREDENTIALS" | "ACCESS_DENIED" | "SERVICE_ERROR";

export type AwsOperationResult<T> =
  | { status: "ready"; data: T; region: string }
  | {
      status: "unavailable";
      category: AwsErrorCategory;
      message: string;
      region: string;
    };

export type AwsIdentityResult =
  | {
      status: "ready";
      accountId: string;
      arn: string;
      userId: string;
      region: string;
    }
  | {
      status: "error";
      category: AwsErrorCategory;
      message: string;
      region: string;
    };

export type AwsHealthServiceStatus =
  | { status: "available" }
  | { status: "unavailable"; category: AwsErrorCategory; message: string }
  | { status: "not_checked"; category: AwsErrorCategory };

export type AwsHealthResult = {
  status: "ready" | "error";
  region: string;
  identity: AwsIdentityResult;
  services: {
    sts: AwsHealthServiceStatus;
    ec2: AwsHealthServiceStatus;
    ebs: AwsHealthServiceStatus;
    cloudWatch: AwsHealthServiceStatus;
    computeOptimizer: AwsHealthServiceStatus;
    costExplorer: AwsHealthServiceStatus;
  };
};

export type Ec2Instance = {
  instanceId: string;
  instanceType: string | null;
  state: string | null;
  name: string | null;
  launchTime: string | null;
  availabilityZone: string | null;
  vpcId: string | null;
  subnetId: string | null;
  privateIpAddress: string | null;
  publicIpAddress: string | null;
};

export type Ec2Volume = {
  volumeId: string;
  state: string | null;
  sizeGiB: number | null;
  volumeType: string | null;
  iops: number | null;
  throughput: number | null;
  availabilityZone: string | null;
  encrypted: boolean | null;
  createTime: string | null;
  attachments: Array<{
    instanceId: string | null;
    device: string | null;
    state: string | null;
  }>;
};

export type Ec2Inventory = {
  instances: Ec2Instance[];
  volumes: Ec2Volume[];
};

export type CloudWatchMetricName =
  "CPUUtilization" | "NetworkIn" | "NetworkOut";

export type CloudWatchMetric = {
  instanceId: string;
  metricName: CloudWatchMetricName;
  unit: string | null;
  datapoints: Array<{ timestamp: string; value: number }>;
};

export type CloudWatchMetrics = {
  periodSeconds: number;
  startTime: string;
  endTime: string;
  metrics: CloudWatchMetric[];
};

export type ComputeOptimizerRecommendation = {
  instanceArn: string | null;
  instanceName: string | null;
  currentInstanceType: string | null;
  finding: string | null;
  findingReasonCodes: string[];
  recommendations: Array<{
    instanceType: string | null;
    performanceRisk: string | null;
    projectedUtilization: Array<{ name: string | null; value: number | null }>;
    estimatedMonthlySavings: {
      amount: number | null;
      currency: string | null;
    } | null;
    savingsOpportunityPercentage: number | null;
  }>;
};

export type ComputeOptimizerResult =
  | {
      status: "ready";
      source: "AWS_COMPUTE_OPTIMIZER";
      enrollmentStatus: string;
      recommendations: ComputeOptimizerRecommendation[];
      region: string;
    }
  | {
      status: "analysis_not_ready";
      source: "AWS_COMPUTE_OPTIMIZER";
      enrollmentStatus: string | null;
      recommendations: [];
      message: string;
      region: string;
    }
  | {
      status: "unavailable";
      source: "AWS_COMPUTE_OPTIMIZER";
      category: AwsErrorCategory;
      message: string;
      region: string;
    };

export type CostExplorerResult =
  | {
      status: "ready";
      period: { start: string; end: string };
      currency: string | null;
      amount: number | null;
      region: string;
    }
  | {
      status: "unavailable";
      category: AwsErrorCategory;
      message: string;
      period: { start: string; end: string };
      region: string;
    };
