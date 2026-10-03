import { describe, expect, it } from "vitest";
import { recommendations, resources } from "../../client/src/lib/mockData";
import { analyzeRecommendation } from "./rightsizingEngine";

describe("analyzeRecommendation", () => {
  it("returns a bounded score with a reason for each score component", () => {
    const recommendation = recommendations[0];
    const resource = resources.find((item) => item.id === recommendation.resourceId)!;
    const analysis = analyzeRecommendation(recommendation, resource);

    expect(analysis.opportunity_score).toBeGreaterThanOrEqual(0);
    expect(analysis.opportunity_score).toBeLessThanOrEqual(100);
    expect(analysis.score_reasons).toHaveLength(4);
    expect(analysis.estimated_savings).toEqual({ monthly: recommendation.savings, annual: recommendation.savings * 12 });
  });

  it("requires human approval for production recommendations", () => {
    const recommendation = recommendations[0];
    const resource = resources.find((item) => item.id === recommendation.resourceId)!;

    expect(resource.env).toBe("Production");
    expect(analyzeRecommendation(recommendation, resource).recommended_action).toBe("Require approval");
  });

  it("identifies its data as synthetic rather than connected AWS data", () => {
    const recommendation = recommendations[0];
    const resource = resources.find((item) => item.id === recommendation.resourceId)!;

    expect(analyzeRecommendation(recommendation, resource).recommendation_source).toContain("not connected");
  });
});
