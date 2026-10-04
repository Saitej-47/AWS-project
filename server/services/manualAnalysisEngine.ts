export type ManualAnalysisInput = {
  resourceName: string;
  resourceType: "EC2" | "EBS" | "RDS" | "Lambda" | "Other";
  provider: "AWS" | "Azure" | "GCP" | "Other";
  region: string;
  currentConfiguration: string;
  averageCpu: number | null;
  peakCpu: number | null;
  averageMemory: number | null;
  peakMemory: number | null;
  averageNetwork: number | null;
  peakNetwork: number | null;
  observationDays: 7 | 14 | 30 | 90;
  storageGiB: number | null;
  storageType: "gp3" | "gp2" | "io2" | "other" | null;
  storageIops: number | null;
  storageThroughput: number | null;
  averageStorageUtilization: number | null;
  peakStorageUtilization: number | null;
  storageUtilizationUnknown: boolean;
  hourlyCost: number | null;
  monthlyCost: number | null;
  workloadType: "general" | "compute" | "memory" | "storage" | "burstable" | "other";
  availability: "standard" | "high" | "mission-critical";
  environment: "Production" | "Development" | "Test";
};

export type ManualAnalysisResult = {
  classification: "underutilized" | "right-sized" | "potentially-undersized" | "storage-optimization" | "insufficient-data";
  suggestedConfiguration: string;
  currentMonthlyCost: number | null;
  estimatedOptimizedMonthlyCost: number | null;
  potentialMonthlySavings: number | null;
  potentialAnnualSavings: number | null;
  estimatedReductionPercent: number | null;
  estimatedStorageGiB: number | null;
  risk: "Low" | "Medium" | "High";
  analysisConfidence: number;
  confidenceFactors: string[];
  source: "SmartSize Optimization Engine";
  explanation: string;
  assumptions: string[];
};

export type ManualAnalysisRecord = {
  id: string;
  resourceId: string;
  recommendationId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  input: ManualAnalysisInput;
  result: ManualAnalysisResult;
  status: "Analyzed" | "Simulated" | "Approved" | "Rejected";
  simulation: {
    monthlySavings: number | null;
    annualSavings: number | null;
    estimatedReductionPercent: number | null;
    simulatedAt: string;
  } | null;
};

const utilizationFields = [
  "averageCpu",
  "peakCpu",
  "averageMemory",
  "peakMemory",
  "averageNetwork",
  "peakNetwork",
  "averageStorageUtilization",
  "peakStorageUtilization",
] as const;

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function nextSmallerConfiguration(current: string): string {
  const sizes = ["nano", "micro", "small", "medium", "large", "xlarge", "2xlarge", "4xlarge", "8xlarge", "12xlarge", "16xlarge", "24xlarge", "32xlarge"];
  const match = current.match(/^(.*?)(nano|micro|small|medium|[1-9]\d*xlarge)$/i);
  if (!match) return current;
  const index = sizes.indexOf(match[2].toLowerCase());
  return index > 0 ? `${match[1]}${sizes[index - 1]}` : current;
}

export function validateManualAnalysisInput(value: unknown): value is ManualAnalysisInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<ManualAnalysisInput>;
  if (typeof input.resourceName !== "string" || input.resourceName.trim().length < 2 || input.resourceName.length > 120) return false;
  if (!["EC2", "EBS", "RDS", "Lambda", "Other"].includes(input.resourceType as string)) return false;
  if (!["AWS", "Azure", "GCP", "Other"].includes(input.provider as string)) return false;
  if (typeof input.region !== "string" || input.region.length > 64) return false;
  if (typeof input.currentConfiguration !== "string" || input.currentConfiguration.trim().length < 1 || input.currentConfiguration.length > 80) return false;
  if (![7, 14, 30, 90].includes(input.observationDays as number)) return false;
  if (!["general", "compute", "memory", "storage", "burstable", "other"].includes(input.workloadType as string)) return false;
  if (!["standard", "high", "mission-critical"].includes(input.availability as string)) return false;
  if (!["Production", "Development", "Test"].includes(input.environment as string)) return false;
  if (input.storageType !== null && input.storageType !== undefined && !["gp3", "gp2", "io2", "other"].includes(input.storageType)) return false;
  if (typeof input.storageUtilizationUnknown !== "boolean") return false;
  for (const field of utilizationFields) {
    const number = input[field];
    if (number === undefined) return false;
    if (number !== null && number !== undefined && (typeof number !== "number" || !Number.isFinite(number) || number < 0 || number > 100)) return false;
  }
  for (const field of ["storageGiB", "storageIops", "storageThroughput", "hourlyCost", "monthlyCost"] as const) {
    const number = input[field];
    if (number === undefined) return false;
    if (number !== null && number !== undefined && (typeof number !== "number" || !Number.isFinite(number) || number < 0)) return false;
  }
  if (input.storageUtilizationUnknown && (input.averageStorageUtilization !== null || input.peakStorageUtilization !== null)) return false;
  if (input.hourlyCost !== null && input.hourlyCost !== undefined && input.monthlyCost !== null && input.monthlyCost !== undefined) return false;
  return true;
}

export function analyzeManualInfrastructure(input: ManualAnalysisInput): ManualAnalysisResult {
  const assumptions: string[] = [];
  const monthlyCost = input.monthlyCost ?? (input.hourlyCost === null ? null : input.hourlyCost * 24 * 30);
  if (input.hourlyCost !== null) assumptions.push("Hourly cost was annualized using 24 hours per day and a 30-day month.");
  let storageUtilization = input.averageStorageUtilization;
  if (input.storageUtilizationUnknown && input.storageGiB !== null) {
    storageUtilization = 70;
    assumptions.push("Storage sizing uses a conservative 70% utilization assumption because utilization was not supplied.");
  }

  const cpuAverage = input.averageCpu;
  const cpuPeak = input.peakCpu;
  const requiredSignalMissing =
    (input.workloadType === "memory" && input.averageMemory === null) ||
    (input.workloadType === "compute" && cpuAverage === null) ||
    (input.workloadType === "storage" && (input.storageGiB === null || storageUtilization === null));
  const computeSignalAvailable = !requiredSignalMissing && (cpuAverage !== null || input.averageMemory !== null);
  let classification: ManualAnalysisResult["classification"] = "insufficient-data";
  let suggestedConfiguration = input.currentConfiguration;
  let risk: ManualAnalysisResult["risk"] = "Medium";
  let explanation = "Insufficient utilization data is available to support a defensible rightsizing recommendation.";
  let reductionFactor = 0;

  if (computeSignalAvailable || (cpuAverage !== null && cpuAverage >= 70) || (input.averageMemory !== null && input.averageMemory >= 80)) {
    const peak = Math.max(cpuPeak ?? 0, input.peakMemory ?? 0, input.peakNetwork ?? 0);
    const highAverage = (cpuAverage ?? 0) >= 70 || (input.averageMemory ?? 0) >= 80;
    const highPeak = peak >= 85;
    const lowCpu = cpuAverage !== null && cpuAverage < 20;
    const moderateCpu = cpuAverage !== null && cpuAverage < 40;
    const lowMemory = input.averageMemory !== null && input.averageMemory < 55;
    const moderateMemory = input.averageMemory !== null && input.averageMemory < 70;
    const lowAverage = input.workloadType === "memory"
      ? lowMemory
      : input.workloadType === "compute" || input.workloadType === "burstable"
        ? lowCpu
        : input.workloadType === "storage"
          ? false
          : (cpuAverage === null || lowCpu) && (input.averageMemory === null || lowMemory);
    const moderateAverage = input.workloadType === "memory"
      ? moderateMemory
      : input.workloadType === "compute" || input.workloadType === "burstable"
        ? moderateCpu
        : input.workloadType === "storage"
          ? false
          : (cpuAverage === null || moderateCpu) && (input.averageMemory === null || moderateMemory);
    if (highAverage || (highPeak && input.availability !== "standard")) {
      classification = "potentially-undersized";
      risk = "High";
      explanation = highPeak
        ? "Average utilization may be low, but peak utilization reaches a capacity-sensitive level. Downsizing is not recommended without further workload review."
        : "Utilization is elevated; downsizing could increase capacity risk. Review headroom or consider a larger configuration.";
    } else if (lowAverage || moderateAverage) {
      classification = "underutilized";
      const peakRisk = highPeak || peak >= 70;
      risk = peakRisk || input.availability === "mission-critical" ? "High" : input.availability === "high" || input.environment === "Production" ? "Medium" : "Low";
      if (peakRisk) {
        explanation = "Average utilization is low, but peak utilization is high. Rightsizing carries elevated performance risk; review peak windows before reducing capacity.";
      } else {
        suggestedConfiguration = input.resourceType === "EC2" ? nextSmallerConfiguration(input.currentConfiguration) : `${input.currentConfiguration} (smaller capacity estimate)`;
        reductionFactor = lowAverage ? 0.25 : 0.12;
        if (input.availability === "high") reductionFactor *= 0.5;
        if (input.availability === "mission-critical") reductionFactor *= 0.25;
        explanation = "The supplied utilization suggests sustained headroom. A smaller capacity may be appropriate, subject to workload-specific testing and availability requirements.";
      }
    } else {
      classification = "right-sized";
      risk = peak >= 85 ? "High" : peak >= 70 ? "Medium" : "Low";
      explanation = "The supplied utilization does not show a clear, low-risk capacity reduction opportunity. No compute downsizing is recommended.";
    }
  }

  let estimatedStorageGiB: number | null = null;
  if (input.storageGiB !== null && storageUtilization !== null) {
    const usedGiB = input.storageGiB * storageUtilization / 100;
    estimatedStorageGiB = Math.ceil(usedGiB / 0.75);
    const storagePeakSafe = input.peakStorageUtilization === null || input.peakStorageUtilization < 85;
    if (estimatedStorageGiB < input.storageGiB * 0.85 && storagePeakSafe && classification !== "potentially-undersized") {
      classification = "storage-optimization";
      explanation = "Storage appears to have reducible headroom based on the supplied utilization. The size shown is a SmartSize estimate using 25% capacity headroom.";
      if (reductionFactor === 0) reductionFactor = 0.1;
      suggestedConfiguration = `${input.storageType ?? "current storage tier"} · ${estimatedStorageGiB} GiB (SmartSize Storage Estimate)`;
      if (risk !== "High") risk = input.peakStorageUtilization !== null && input.peakStorageUtilization >= 85 ? "High" : "Medium";
    } else if (input.peakStorageUtilization !== null && input.peakStorageUtilization >= 85) {
      risk = "High";
      assumptions.push("Peak storage utilization is high; reducing storage capacity is not recommended.");
    }
  } else if (input.storageGiB !== null) {
    assumptions.push("Storage size is recorded, but utilization is unavailable; no storage reduction is inferred.");
  }

  if (classification === "potentially-undersized") {
    suggestedConfiguration = input.currentConfiguration;
    reductionFactor = 0;
  }
  const savings = monthlyCost === null ? null : roundMoney(Math.max(0, monthlyCost * reductionFactor));
  const optimizedCost = monthlyCost === null ? null : roundMoney(Math.max(0, monthlyCost - (savings ?? 0)));
  const reductionPercent = monthlyCost && savings !== null ? roundMoney(savings / monthlyCost * 100) : null;
  if (monthlyCost === null) assumptions.push("Cost was not supplied, so financial savings are unavailable.");
  else if (reductionFactor > 0) assumptions.push("Optimized cost is a SmartSize capacity-reduction estimate, not a provider price quote.");
  if (input.averageMemory === null) assumptions.push("Memory data unavailable; memory utilization was not inferred.");
  if (requiredSignalMissing) assumptions.push(`More workload-specific utilization data is required for a ${input.workloadType} workload.`);
  if (input.workloadType === "other") assumptions.push("Workload type is unspecified; validate the recommendation against workload-specific behavior.");

  const availableSignals = utilizationFields.filter((field) => input[field] !== null).length;
  const completeness = Math.round(
    30 +
    availableSignals / utilizationFields.length * 35 +
    (input.storageGiB !== null ? 10 : 0) +
    (monthlyCost !== null ? 10 : 0) +
    (input.observationDays >= 30 ? 10 : input.observationDays >= 14 ? 5 : 0) +
    (input.workloadType !== "other" ? 3 : 0) +
    (input.availability !== "standard" ? 2 : 0),
  );
  const confidenceFactors = [
    `${availableSignals} of ${utilizationFields.length} utilization fields supplied`,
    input.storageGiB !== null ? "Storage size supplied" : "Storage size unavailable",
    monthlyCost !== null ? "User-provided cost available" : "Cost unavailable",
    `${input.observationDays}-day observation period`,
    input.averageMemory !== null ? "Memory is user-provided" : "Memory data unavailable",
  ];

  return {
    classification,
    suggestedConfiguration,
    currentMonthlyCost: monthlyCost,
    estimatedOptimizedMonthlyCost: optimizedCost,
    potentialMonthlySavings: savings,
    potentialAnnualSavings: savings === null ? null : roundMoney(savings * 12),
    estimatedReductionPercent: reductionPercent,
    estimatedStorageGiB,
    risk,
    analysisConfidence: Math.min(100, completeness),
    confidenceFactors,
    source: "SmartSize Optimization Engine",
    explanation,
    assumptions,
  };
}
