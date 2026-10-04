import { describe, expect, it } from "vitest";
import {
  analyzeManualInfrastructure,
  validateManualAnalysisInput,
  type ManualAnalysisInput,
} from "./manualAnalysisEngine";

const baseInput: ManualAnalysisInput = {
  resourceName: "Production API",
  resourceType: "EC2",
  provider: "AWS",
  region: "ap-south-1",
  currentConfiguration: "m5.2xlarge",
  averageCpu: 18,
  peakCpu: 42,
  averageMemory: 35,
  peakMemory: 48,
  averageNetwork: null,
  peakNetwork: null,
  observationDays: 30,
  storageGiB: 500,
  storageType: "gp3",
  storageIops: 3000,
  storageThroughput: 125,
  averageStorageUtilization: 35,
  peakStorageUtilization: 46,
  storageUtilizationUnknown: false,
  hourlyCost: null,
  monthlyCost: 28500,
  workloadType: "general",
  availability: "standard",
  environment: "Development",
};

describe("SmartSize manual analysis engine", () => {
  it("estimates lower capacity and savings without reporting more than the supplied cost", () => {
    const result = analyzeManualInfrastructure(baseInput);
    expect(result.classification).toBe("storage-optimization");
    expect(result.estimatedStorageGiB).toBe(234);
    expect(result.currentMonthlyCost).toBe(28500);
    expect(result.potentialMonthlySavings).toBe(7125);
    expect(result.estimatedOptimizedMonthlyCost).toBe(21375);
    expect(result.potentialAnnualSavings).toBe(85500);
    expect(result.source).toBe("SmartSize Optimization Engine");
  });

  it("does not recommend downsizing when low average CPU masks a high peak", () => {
    const result = analyzeManualInfrastructure({ ...baseInput, averageStorageUtilization: 80, peakStorageUtilization: 92, averageCpu: 18, peakCpu: 92 });
    expect(result.classification).toBe("underutilized");
    expect(result.suggestedConfiguration).toBe("m5.2xlarge");
    expect(result.potentialMonthlySavings).toBe(0);
    expect(result.risk).toBe("High");
    expect(result.explanation).toMatch(/peak utilization is high/i);
  });

  it("uses an explicit conservative storage assumption and avoids invented memory", () => {
    const result = analyzeManualInfrastructure({
      ...baseInput,
      averageMemory: null,
      peakMemory: null,
      averageStorageUtilization: null,
      peakStorageUtilization: null,
      storageUtilizationUnknown: true,
    });
    expect(result.estimatedStorageGiB).toBe(467);
    expect(result.assumptions).toContain("Storage sizing uses a conservative 70% utilization assumption because utilization was not supplied.");
    expect(result.assumptions).toContain("Memory data unavailable; memory utilization was not inferred.");
  });

  it("does not fabricate savings when cost is unknown or a lower configuration is not indicated", () => {
    const unknownCost = analyzeManualInfrastructure({ ...baseInput, monthlyCost: null, averageStorageUtilization: 80 });
    expect(unknownCost.currentMonthlyCost).toBeNull();
    expect(unknownCost.potentialMonthlySavings).toBeNull();
    const highLoad = analyzeManualInfrastructure({ ...baseInput, averageCpu: 90, peakCpu: 96, averageStorageUtilization: 80 });
    expect(highLoad.classification).toBe("potentially-undersized");
    expect(highLoad.potentialMonthlySavings).toBe(0);
  });

  it("rejects invalid input ranges and conflicting pricing", () => {
    expect(validateManualAnalysisInput({ ...baseInput, averageCpu: 101 })).toBe(false);
    expect(validateManualAnalysisInput({ ...baseInput, hourlyCost: 1 })).toBe(false);
    expect(validateManualAnalysisInput({ ...baseInput, observationDays: 10 })).toBe(false);
    expect(validateManualAnalysisInput(baseInput)).toBe(true);
  });
});
