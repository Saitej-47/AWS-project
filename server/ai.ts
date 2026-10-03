import { store } from "./store";

const advisorSystemPrompt = `You are SmartSize AI Advisor.
You explain AWS cloud resource utilization, AWS Compute Optimizer recommendations, potential savings, risk, and SmartSize analysis.
AWS Compute Optimizer remains the recommendation engine. Do not create infrastructure recommendations independently when AWS recommendation data is available.
Never invent resources, AWS metrics, prices, savings, recommendations, or API responses. If information is unavailable, say so explicitly.
Distinguish AWS-provided information, SmartSize-calculated information, and AI-generated explanation.
Before any infrastructure modification, require human review and approval. Never execute AWS changes from natural language alone.`;

type AdvisorResponse = {
  answer: string;
  mode: "openai" | "demo-grounded";
  source: "aws" | "demo";
};

function buildContext() {
  const recommendations = store.getRecommendations().map((item) => ({
    resource: item.resourceName,
    current: item.current,
    recommended: item.recommended,
    monthlySavings: item.savings,
    risk: item.risk,
    confidence: item.confidence,
    status: item.status,
    rationale: item.rationale,
  }));
  const resources = store.getResources().map((item) => ({
    name: item.name,
    service: item.service,
    region: item.region,
    instanceType: item.instanceType,
    cpu: item.cpu,
    memory: item.memory,
    monthlyCost: item.monthlyCost,
    status: item.status,
    risk: item.risk,
    recommendationId: item.recommendationId,
  }));
  return JSON.stringify({ source: "demo", resources, recommendations }, null, 2);
}

function demoAnswer(message: string): AdvisorResponse {
  const recommendations = store.getRecommendations();
  const highestSavings = [...recommendations].sort((left, right) => right.savings - left.savings).slice(0, 3);
  const totalSavings = recommendations.reduce((total, item) => total + item.savings, 0);
  const normalized = message.toLowerCase();
  if (normalized.includes("highest") || normalized.includes("first") || normalized.includes("save")) {
    return {
      mode: "demo-grounded",
      source: "demo",
      answer: `This demo dataset contains ${recommendations.length} recommendations with ${new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(totalSavings)} in modeled monthly savings. The largest modeled opportunities are ${highestSavings.map((item) => `${item.resourceName} (${new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(item.savings)}/month)`).join(", ")}. Review risk and utilization before approval; these are estimates, not guaranteed savings.`,
    };
  }
  return {
    mode: "demo-grounded",
    source: "demo",
    answer: `I can explain the ${recommendations.length} recommendations and their modeled savings from the SmartSize demo dataset. I do not have live AWS or CloudWatch data in this environment, so I cannot claim a current AWS state. Open a recommendation to inspect its recorded utilization, confidence, risk, and rationale before simulation or human approval.`,
  };
}

async function openAiAnswer(message: string): Promise<AdvisorResponse | undefined> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return undefined;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        { role: "system", content: [{ type: "input_text", text: advisorSystemPrompt }] },
        { role: "user", content: [{ type: "input_text", text: `User question: ${message}\n\nVerified SmartSize context:\n${buildContext()}` }] },
      ],
      temperature: 0.1,
      max_output_tokens: 500,
    }),
  });
  if (!response.ok) throw new Error(`OpenAI advisor request failed with status ${response.status}.`);
  const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const answer = payload.output_text || payload.output?.flatMap((item) => item.content || []).map((item) => item.text || "").join(" ").trim();
  if (!answer) throw new Error("OpenAI returned an empty advisor response.");
  return { answer, mode: "openai", source: "demo" };
}

export async function answerAdvisor(message: string): Promise<AdvisorResponse> {
  try {
    return await openAiAnswer(message) || demoAnswer(message);
  } catch (error) {
    if (process.env.NODE_ENV === "production") throw error;
    return demoAnswer(message);
  }
}
