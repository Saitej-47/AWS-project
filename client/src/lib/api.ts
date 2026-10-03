import type { Recommendation, Resource } from './mockData';

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  provider: 'demo' | 'google' | 'email';
  role: 'Platform Admin' | 'Viewer';
  emailVerified: boolean;
};

export type RecommendationAnalysis = {
  recommendation_priority: 'High' | 'Medium' | 'Low';
  opportunity_score: number;
  risk_level: 'Low' | 'Medium' | 'High';
  estimated_savings: { monthly: number; annual: number };
  confidence: number;
  recommended_action: 'Review' | 'Require approval' | 'Ready for review';
  explanation: string;
  score_reasons: string[];
  recommendation_source: string;
};

export type WorkflowAction = {
  id: string;
  recommendationId: string;
  actionType: 'Rightsize';
  oldConfiguration: string;
  newConfiguration: string;
  requestedBy: string;
  approvedBy: string;
  status: 'Approved' | 'Scheduled' | 'Simulated';
  createdAt: string;
  scheduledAt?: string;
  executedAt?: string;
};

export type WorkflowPolicy = {
  id: string;
  environment: 'Production' | 'Staging' | 'Development';
  autoExecution: boolean;
  approvalRequired: boolean;
  maximumRisk: 'Low' | 'Medium' | 'High';
};

export type AuditEvent = {
  id: string;
  time: string;
  action: string;
  resource: string;
  user: string;
  status: string;
  details?: string;
};

export type OptimizationReport = {
  id: string;
  name: string;
  createdAt: string;
  createdBy: string;
  summary: {
    totalResources: number;
    totalRecommendations: number;
    openRecommendations: number;
    currentMonthlySpend: number;
    potentialMonthlySavings: number;
    projectedAnnualSavings: number;
    verifiedSavings: number;
  };
};

export type RecommendationDetail = {
  recommendation: Recommendation;
  resource: Resource;
  analysis: RecommendationAnalysis;
};

export type ResourceRecord = {
  id: string;
  name: string;
  service: 'EC2' | 'RDS' | 'EBS' | 'Lambda';
  region: string;
  instanceType: string;
  cpu: number;
  memory: number;
  network: number;
  storage: number;
  monthlyCost: number;
  status: string;
  risk: 'Low' | 'Medium' | 'High';
  env: 'Production' | 'Staging' | 'Development';
  instanceId: string;
  recommendationId?: string;
  peakCpu: number;
  peakMemory: number;
};

export type RecommendationRecord = {
  id: string;
  resourceId: string;
  resourceName: string;
  current: string;
  recommended: string;
  currentCost: number;
  optimizedCost: number;
  savings: number;
  risk: 'Low' | 'Medium' | 'High';
  confidence: number;
  status: 'Open' | 'Reviewed' | 'Approved' | 'Rejected';
  rationale: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }, ...init });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText })) as { error?: string; verificationRequired?: boolean };
    throw new Error(body.error || response.statusText);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export const api = {
  authProviders: () => request<{ google: boolean }>('/api/auth/providers'),
  session: () => request<{ user: SessionUser | null }>('/api/auth/session'),
  register: (values: { name: string; email: string; password: string; confirmPassword: string }) => request<{ user: SessionUser; verificationRequired: boolean; developmentToken?: string; developmentOnly?: boolean; emailDeliveryConfigured: boolean; authMode: string; message: string }>('/api/auth/register', { method: 'POST', body: JSON.stringify(values) }),
  login: (values: { email: string; password: string }) => request<{ user: SessionUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify(values) }),
  verifyEmail: (token: string) => request<{ user: SessionUser; message: string }>('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }),
  requestPasswordReset: (email: string) => request<{ message: string; developmentToken?: string; developmentOnly?: boolean }>('/api/auth/request-password-reset', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token: string, password: string, confirmPassword: string) => request<{ message: string }>('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password, confirmPassword }) }),
  demoLogin: (email: string, password: string) => request<{ user: SessionUser }>('/api/auth/demo', { method: 'POST', body: JSON.stringify({ email, password }) }),
  demoSession: () => request<{ user: SessionUser }>('/api/auth/demo-session', { method: 'POST', body: JSON.stringify({}) }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  dashboard: () => request<{ recommendations: Array<{ id: string; status: string; updatedAt?: string }>; simulations: unknown[]; activity: unknown[] }>('/api/dashboard'),
  resources: () => request<ResourceRecord[]>('/api/resources'),
  resourceDetail: (id: string) => request<{ resource: ResourceRecord; recommendation: RecommendationRecord | null }>(`/api/resources/${encodeURIComponent(id)}`),
  recommendations: () => request<RecommendationRecord[]>('/api/recommendations'),
  recommendationDetail: (id: string) => request<RecommendationDetail>(`/api/recommendations/${encodeURIComponent(id)}`),
  simulateRecommendation: (id: string) => request<{ currentMonthlyCost: number; estimatedMonthlyCost: number; monthlySavings: number; annualizedSavings: number; risk: string; opportunityScore: number; result: string }>(`/api/recommendations/${encodeURIComponent(id)}/simulate`, { method: 'POST', body: JSON.stringify({}) }),
  decision: (id: string, status: 'Approved' | 'Rejected', note?: string) => request(`/api/recommendations/${id}/decision`, { method: 'POST', body: JSON.stringify({ status, note }) }),
  simulation: (recommendationIds: string[], name?: string) => request('/api/simulations', { method: 'POST', body: JSON.stringify({ recommendationIds, name }) }),
  simulations: () => request<Array<{ id: string; name: string; recommendationIds: string[]; monthlySavings: number; optimizedSpend: number; createdAt: string; createdBy: string }>>('/api/simulations'),
  actions: () => request<WorkflowAction[]>('/api/actions'),
  scheduleAction: (id: string, scheduledAt: string) => request<{ action: WorkflowAction; message: string }>(`/api/actions/${encodeURIComponent(id)}/schedule`, { method: 'POST', body: JSON.stringify({ scheduledAt }) }),
  simulateExecution: (id: string) => request<{ action: WorkflowAction; message: string }>(`/api/actions/${encodeURIComponent(id)}/simulate-execution`, { method: 'POST', body: JSON.stringify({}) }),
  savings: () => request<{ currency: string; currentMonthlySpend: number; potentialMonthlySavings: number; projectedAnnualSavings: number; simulatedMonthlySavings: number; verifiedSavings: number; verifiedSavingsNote: string; actions: WorkflowAction[] }>('/api/savings'),
  audit: () => request<AuditEvent[]>('/api/audit'),
  reports: () => request<OptimizationReport[]>('/api/reports'),
  createReport: (name?: string) => request<OptimizationReport>('/api/reports', { method: 'POST', body: JSON.stringify({ name }) }),
  exportReportCsv: async () => {
    const response = await fetch('/api/reports/export.csv', { credentials: 'include' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
      throw new Error(body.error || response.statusText);
    }
    return response.blob();
  },
  policies: () => request<WorkflowPolicy[]>('/api/policies'),
  updatePolicy: (id: string, updates: Partial<Pick<WorkflowPolicy, 'autoExecution' | 'approvalRequired' | 'maximumRisk'>>) => request<WorkflowPolicy>(`/api/policies/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(updates) }),
  simulatePolicy: (id: string) => request<{ environment: string; eligibleCount: number; potentialMonthlySavings: number; approvalRequiredCount: number; blockedCount: number; executionMode: string }>(`/api/policies/${encodeURIComponent(id)}/simulate`, { method: 'POST', body: JSON.stringify({}) }),
  awsStatus: () => request<{ source: 'demo' | 'aws'; status: string; message: string; accountId: string | null; region: string | null; syncedAt: string | null; sources: string[] }>('/api/aws/status'),
  syncAws: () => request<{ source: 'demo' | 'aws'; status: string; message: string; accountId: string | null; region: string | null; syncedAt: string | null; sources: string[] }>('/api/aws/sync', { method: 'POST', body: JSON.stringify({}) }),
  advisor: (message: string) => request<{ answer: string; mode: 'openai' | 'demo-grounded'; source: 'aws' | 'demo' }>('/api/ai/advisor', { method: 'POST', body: JSON.stringify({ message }) }),
};