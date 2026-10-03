export type SessionUser = {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  provider: 'demo' | 'google' | 'email';
  role: 'Platform Admin' | 'Viewer';
  emailVerified: boolean;
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
  session: () => request<{ user: SessionUser | null }>('/api/auth/session'),
  register: (values: { name: string; email: string; password: string; confirmPassword: string }) => request<{ user: SessionUser; verificationRequired: boolean; verificationToken?: string; verificationCode?: string; emailDeliveryConfigured: boolean; authMode: string; message: string }>('/api/auth/register', { method: 'POST', body: JSON.stringify(values) }),
  login: (values: { email: string; password: string }) => request<{ user: SessionUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify(values) }),
  verifyEmail: (token: string) => request<{ user: SessionUser; message: string }>('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }),
  requestPasswordReset: (email: string) => request<{ message: string }>('/api/auth/request-password-reset', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token: string, password: string) => request<{ message: string }>('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
  demoLogin: (email: string, password: string) => request<{ user: SessionUser }>('/api/auth/demo', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  dashboard: () => request<{ recommendations: Array<{ id: string; status: string; updatedAt?: string }>; simulations: unknown[]; activity: unknown[] }>('/api/dashboard'),
  decision: (id: string, status: 'Approved' | 'Rejected', note?: string) => request(`/api/recommendations/${id}/decision`, { method: 'POST', body: JSON.stringify({ status, note }) }),
  simulation: (recommendationIds: string[], name?: string) => request('/api/simulations', { method: 'POST', body: JSON.stringify({ recommendationIds, name }) }),
  advisor: (message: string) => request<{ answer: string; mode: 'openai' | 'demo-grounded'; source: 'aws' | 'demo' }>('/api/ai/advisor', { method: 'POST', body: JSON.stringify({ message }) }),
};