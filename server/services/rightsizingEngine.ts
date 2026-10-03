import type { Recommendation, Resource } from "../../client/src/lib/mockData";

export type RecommendationAnalysis = {
  recommendation_priority: "High" | "Medium" | "Low";
  opportunity_score: number;
  risk_level: Resource["risk"];
  estimated_savings: { monthly: number; annual: number };
  confidence: number;
  recommended_action: "Review" | "Require approval" | "Ready for review";
  explanation: string;
  score_reasons: string[];
  recommendation_source: string;
};

export function analyzeRecommendation(
  recommendation: Recommendation,
  resource: Resource,
): RecommendationAnalysis {
  const savingsScore = Math.min(35, Math.round((recommendation.savings / 12_000) * 35));
  const confidenceScore = Math.round((recommendation.confidence / 100) * 30);
  const riskScore = recommendation.risk === "Low" ? 20 : recommendation.risk === "Medium" ? 10 : 0;
  const peakUtilization = Math.max(resource.peakCpu, resource.peakMemory);
  const headroomScore = peakUtilization < 50 ? 15 : peakUtilization < 70 ? 8 : 0;
  const opportunityScore = savingsScore + confidenceScore + riskScore + headroomScore;
  const recommendationPriority = opportunityScore >= 70 ? "High" : opportunityScore >= 45 ? "Medium" : "Low";

  const scoreReasons = [
    `Savings opportunity contributes ${savingsScore}/35 points (${recommendation.savings.toLocaleString()} monthly).`,
    `Recommendation confidence contributes ${confidenceScore}/30 points (${recommendation.confidence}%).`,
    `${recommendation.risk} performance risk contributes ${riskScore}/20 points.`,
    `Peak observed CPU/memory utilization is ${peakUtilization}%, contributing ${headroomScore}/15 headroom points.`,
  ];
  const environmentNote = resource.env === "Production"
    ? " Production environment: human review is required before any action."
    : "";
  const explanation = `Observed demo metrics show average CPU at ${resource.cpu}% (peak ${resource.peakCpu}%) and average memory at ${resource.memory}% (peak ${resource.peakMemory}%). The supplied recommendation proposes ${recommendation.current} to ${recommendation.recommended}, with estimated monthly savings of ${recommendation.savings.toLocaleString()} and ${recommendation.risk.toLowerCase()} performance risk.${environmentNote}`;

  return {
    recommendation_priority: recommendationPriority,
    opportunity_score: opportunityScore,
    risk_level: recommendation.risk,
    estimated_savings: { monthly: recommendation.savings, annual: recommendation.savings * 12 },
    confidence: recommendation.confidence,
    recommended_action: resource.env === "Production" ? "Require approval" : "Ready for review",
    explanation,
    score_reasons: scoreReasons,
    recommendation_source: "Synthetic demo fixture; AWS Compute Optimizer is not connected",
  };
}
