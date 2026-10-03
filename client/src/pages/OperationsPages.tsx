import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, ArrowDown, ArrowRight, CalendarClock, CheckCircle2, Cloud, Download, Eye, FlaskConical, RefreshCw, Server, ShieldCheck, Wallet } from 'lucide-react';
import { api, type AuditEvent, type WorkflowAction, type WorkflowPolicy } from '../lib/api';
import type { Recommendation, Resource } from '../lib/mockData';

type Toast = (title: string, body: string, tone?: 'success' | 'info') => void;
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
const dateTime = (value: string) => new Date(value).toLocaleString();

export function OverviewDashboardPage({ navigate }: { navigate: (path: string) => void }) {
  const [resources, setResources] = useState<Awaited<ReturnType<typeof api.resources>>>([]);
  const [recommendations, setRecommendations] = useState<Awaited<ReturnType<typeof api.recommendations>>>([]);
  const [savings, setSavings] = useState<Awaited<ReturnType<typeof api.savings>> | null>(null);
  const [actions, setActions] = useState<WorkflowAction[]>([]);
  const [executiveView, setExecutiveView] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void Promise.all([api.resources(), api.recommendations(), api.savings(), api.actions()]).then(([nextResources, nextRecommendations, nextSavings, nextActions]) => {
      setResources(nextResources);
      setRecommendations(nextRecommendations);
      setSavings(nextSavings);
      setActions(nextActions);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not load the overview data.'));
  }, []);
  const active = recommendations.filter((item) => item.status !== 'Rejected');
  const topFive = [...active].sort((a, b) => b.savings - a.savings).slice(0, 5);
  const journey = [
    ['Discovered', recommendations.length],
    ['Reviewed', recommendations.filter((item) => item.status === 'Reviewed').length],
    ['Approved', actions.length],
    ['Scheduled', actions.filter((item) => item.status === 'Scheduled').length],
    ['Demo simulated', actions.filter((item) => item.status === 'Simulated').length],
  ] as const;
  return <div className="page-wrap fade-up">
    <Header title={executiveView ? 'Executive Overview' : 'Rightsizing Overview'} subtitle="AWS provides the infrastructure recommendations. SmartSize adds transparent savings analysis, policy, and a human-controlled action workflow." action={<button className="btn btn-ghost" onClick={() => setExecutiveView((value) => !value)}><Eye size={14} /> {executiveView ? 'Workspace view' : 'Executive view'}</button>} />
    <Notice tone="amber"><strong>DEMO DATASET</strong> — {savings ? `${resources.length} synthetic resources and ${recommendations.length} synthetic recommendation fixtures` : 'Loading synthetic resource and recommendation fixtures'}. Live AWS is not connected; no savings or resource changes are represented as real.</Notice>
    {error && <div role="alert" className="mb-5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
    {!savings ? <div className="card p-8 text-center text-sm text-slate-500">Loading overview…</div> : <>
      <div className="mb-6 grid grid-cols-4 gap-4 grid-cols-2 md:grid-cols-4">
        <Metric label="Resources analyzed" value={resources.length} icon={<Server size={16} />} />
        <Metric label="Recommendations" value={recommendations.length} icon={<Activity size={16} />} />
        <Metric label="Potential monthly savings" value={money(savings.potentialMonthlySavings)} icon={<ArrowDown size={16} />} />
        <Metric label="Verified savings" value={money(savings.verifiedSavings)} icon={<CheckCircle2 size={16} />} />
      </div>
      <div className="mb-5 grid grid-cols-2 gap-5">
        <section className="card p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold text-slate-800">Current demo spend</h2><p className="mt-1 text-xs text-slate-500">Sum of synthetic resource monthly estimates</p></div><div className="font-mono text-2xl font-semibold text-slate-800">{money(savings.currentMonthlySpend)}</div></div><div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-lg bg-orange-50 p-3"><div className="text-xs text-orange-700">Potential annual opportunity</div><div className="mt-1 font-mono text-lg font-semibold text-orange-800">{money(savings.projectedAnnualSavings)}</div></div><div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Demo-completed actions</div><div className="mt-1 font-mono text-lg font-semibold text-slate-800">{actions.filter((item) => item.status === 'Simulated').length}</div></div></div></section>
        {!executiveView && <section className="card p-5"><h2 className="font-semibold text-slate-800">Optimization journey</h2><p className="mt-1 text-xs text-slate-500">Persisted workspace workflow counts.</p><div className="mt-4 grid grid-cols-5 gap-2 grid-cols-2 sm:grid-cols-5">{journey.map(([label, count]) => <div className="rounded-lg bg-slate-50 p-3" key={label}><div className="font-mono text-xl font-semibold text-slate-800">{count}</div><div className="mt-1 text-[10px] leading-4 text-slate-500">{label}</div></div>)}</div></section>}
      </div>
      <section className="card overflow-hidden"><div className="flex items-start justify-between border-b border-slate-100 p-5"><div><h2 className="font-semibold text-slate-800">{executiveView ? 'Top five opportunities' : 'Highest-value recommendations'}</h2><p className="mt-1 text-xs text-slate-500">Estimated amounts from the synthetic fixtures; review the evidence before making a decision.</p></div><button className="btn btn-ghost" onClick={() => navigate('/recommendations')}>View recommendations <ArrowRight size={14} /></button></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Resource</th><th>Current → recommended</th><th>Monthly opportunity</th><th>Risk</th><th>Status</th><th></th></tr></thead><tbody>{topFive.map((item) => <tr key={item.id}><td>{item.resourceName}</td><td><span className="font-mono">{item.current} → {item.recommended}</span></td><td className="font-semibold text-emerald-700">{money(item.savings)}</td><td>{item.risk}</td><td>{item.status}</td><td><button className="btn btn-ghost !min-h-7 !px-2 text-[10px]" onClick={() => navigate(`/recommendations/${item.id}`)}>Why?</button></td></tr>)}</tbody></table></div></section>
      <div className="mt-5 flex flex-wrap gap-2"><button className="btn btn-ghost" onClick={() => navigate('/resources')}>Browse {resources.length} resources</button><button className="btn btn-ghost" onClick={() => navigate('/aws')}>AWS connection status</button><button className="btn btn-ghost" onClick={() => navigate('/activity')}>Review audit trail</button></div>
    </>}
  </div>;
}

function Header({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return <div className="mb-7 flex items-start justify-between gap-4 mobile-stack"><div><div className="eyebrow mb-2">SmartSize · Demo workspace</div><h1 className="page-title">{title}</h1><p className="page-subtitle mt-2 max-w-2xl">{subtitle}</p></div>{action}</div>;
}

function Notice({ children, tone = 'blue' }: { children: React.ReactNode; tone?: 'blue' | 'amber' }) {
  return <div className={`mb-5 flex items-start gap-2 rounded-lg border px-3.5 py-3 text-xs ${tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-blue-100 bg-blue-50 text-blue-900'}`}>{tone === 'amber' ? <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" /> : <ShieldCheck size={15} className="mt-0.5 shrink-0 text-blue-600" />}<div>{children}</div></div>;
}

export function ActionCenterPage({ toast }: { toast: Toast }) {
  const [actions, setActions] = useState<WorkflowAction[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [scheduleValues, setScheduleValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = async () => {
    setLoading(true);
    try {
      const [nextActions, nextRecommendations] = await Promise.all([api.actions(), api.recommendations()]);
      setActions(nextActions);
      setRecommendations(nextRecommendations as Recommendation[]);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load the action workflow.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, []);

  const schedule = async (id: string) => {
    const localTime = scheduleValues[id];
    if (!localTime) { toast('Choose a schedule time', 'Select a future date and time before scheduling.'); return; }
    try {
      const result = await api.scheduleAction(id, new Date(localTime).toISOString());
      toast('Action scheduled', result.message, 'success');
      await refresh();
    } catch (reason) { toast('Scheduling failed', reason instanceof Error ? reason.message : 'The action could not be scheduled.'); }
  };
  const simulate = async (id: string) => {
    try {
      const result = await api.simulateExecution(id);
      toast('Demo action simulated', result.message, 'success');
      await refresh();
    } catch (reason) { toast('Simulation failed', reason instanceof Error ? reason.message : 'The action could not be simulated.'); }
  };

  const statusCount = (status: WorkflowAction['status']) => actions.filter((action) => action.status === status).length;
  return <div className="page-wrap fade-up">
    <Header title="Action Center" subtitle="Follow each approved recommendation through scheduling and a safe demo execution simulation." action={<button className="btn btn-ghost" onClick={() => void refresh()}><RefreshCw size={14} /> Refresh</button>} />
    <Notice tone="amber"><strong>Demo workflow only:</strong> scheduling and simulated completion are recorded for the walkthrough. They never call AWS APIs or change AWS resources.</Notice>
    {error && <div role="alert" className="mb-5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
    <div className="mb-6 grid grid-cols-3 gap-4 grid-cols-2 sm:grid-cols-3">
      <Metric label="Awaiting schedule" value={statusCount('Approved')} icon={<Activity size={16} />} />
      <Metric label="Scheduled" value={statusCount('Scheduled')} icon={<CalendarClock size={16} />} />
      <Metric label="Simulated" value={statusCount('Simulated')} icon={<CheckCircle2 size={16} />} />
    </div>
    {loading ? <div className="card p-8 text-center text-sm text-slate-500">Loading actions…</div> : actions.length === 0 ? <div className="card p-8 text-center"><div className="font-semibold text-slate-800">No approved actions yet</div><p className="mt-2 text-sm text-slate-500">Review a recommendation and approve it to begin a controlled workflow.</p></div> : <div className="space-y-4">
      {actions.map((action) => {
        const recommendation = recommendations.find((item) => item.id === action.recommendationId);
        return <article className="card p-5" key={action.id}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><div className="eyebrow">Rightsizing · {recommendation?.resourceName ?? action.recommendationId}</div><div className="mt-2 flex items-center gap-2 font-mono text-sm text-slate-700"><span>{action.oldConfiguration}</span><ArrowRight size={14} className="text-orange-500" /><span className="font-semibold">{action.newConfiguration}</span></div><div className="mt-2 text-xs text-slate-500">Approved by {action.approvedBy} · {dateTime(action.createdAt)}</div></div>
            <span className={`status-pill ${action.status === 'Simulated' ? 'status-healthy' : action.status === 'Scheduled' ? 'status-over' : 'status-review'}`}>{action.status === 'Simulated' ? 'Demo simulated' : action.status}</span>
          </div>
          {action.scheduledAt && <div className="mt-3 text-xs text-slate-600">Scheduled for <strong>{dateTime(action.scheduledAt)}</strong></div>}
          {action.status === 'Approved' && <div className="mt-4 flex flex-wrap items-center gap-2"><input aria-label={`Schedule time for ${action.recommendationId}`} className="input !w-auto" type="datetime-local" min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)} value={scheduleValues[action.id] ?? ''} onChange={(event) => setScheduleValues((current) => ({ ...current, [action.id]: event.target.value }))} /><button className="btn btn-primary" onClick={() => void schedule(action.id)}><CalendarClock size={14} /> Schedule</button></div>}
          {action.status === 'Scheduled' && <button className="btn btn-ghost mt-4" onClick={() => void simulate(action.id)}><FlaskConical size={14} /> Simulate completion</button>}
          {action.status === 'Simulated' && <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Demo lifecycle complete. This is not verified AWS savings; no infrastructure change was made.</div>}
        </article>;
      })}
    </div>}
    <div className="mt-6 card p-5"><h2 className="font-semibold text-slate-800">Optimization journey</h2><div className="mt-4 grid grid-cols-4 gap-3 grid-cols-2 sm:grid-cols-4">{[['Discovered', recommendations.length], ['Approved', actions.length], ['Scheduled', statusCount('Scheduled')], ['Demo simulated', statusCount('Simulated')]].map(([label, count]) => <div key={label} className="rounded-lg bg-slate-50 p-3"><div className="font-mono text-xl font-semibold text-slate-800">{count}</div><div className="mt-1 text-xs text-slate-500">{label}</div></div>)}</div></div>
  </div>;
}

export function SavingsPage({ toast }: { toast: Toast }) {
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof api.savings>> | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    void Promise.all([api.savings(), api.recommendations(), api.resources()]).then(([nextSummary, nextRecommendations, nextResources]) => {
      setSummary(nextSummary);
      setRecommendations(nextRecommendations as Recommendation[]);
      setResources(nextResources as Resource[]);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not load savings data.'));
  }, []);
  const exportReport = async () => {
    try {
      const response = await fetch('/api/reports/export.csv', { credentials: 'include' });
      if (!response.ok) throw new Error(`Report export failed (${response.status}).`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'smartsize-optimization-report.csv';
      link.click();
      URL.revokeObjectURL(url);
      toast('Report exported', 'The current recommendation snapshot was downloaded as CSV.', 'success');
    } catch (reason) { toast('Export failed', reason instanceof Error ? reason.message : 'The report could not be exported.'); }
  };
  const serviceSavings = recommendations.filter((item) => item.status !== 'Rejected').reduce<Record<string, number>>((totals, item) => {
    const service = resources.find((resource) => resource.id === item.resourceId)?.service ?? 'Other';
    totals[service] = (totals[service] ?? 0) + item.savings;
    return totals;
  }, {});
  return <div className="page-wrap fade-up">
    <Header title="Savings Overview" subtitle="Separate opportunity from simulated outcomes. Values are derived from the synthetic demo recommendations; verified live savings remain zero." action={<button className="btn btn-primary" onClick={() => void exportReport()}><Download size={14} /> Export CSV</button>} />
    <Notice><strong>Source:</strong> demo recommendation fixtures in INR. Projected opportunity is not realized savings. Simulated savings are workflow demonstrations, not verified AWS billing results.</Notice>
    {error && <div role="alert" className="mb-5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
    {!summary ? <div className="card p-8 text-center text-sm text-slate-500">Loading savings…</div> : <>
      <div className="mb-6 grid grid-cols-4 gap-4 grid-cols-2 sm:grid-cols-4">
        <Metric label="Current monthly spend" value={money(summary.currentMonthlySpend)} icon={<Wallet size={16} />} />
        <Metric label="Potential monthly savings" value={money(summary.potentialMonthlySavings)} icon={<ArrowDown size={16} />} />
        <Metric label="Projected annual opportunity" value={money(summary.projectedAnnualSavings)} icon={<Activity size={16} />} />
        <Metric label="Verified savings" value={money(summary.verifiedSavings)} icon={<CheckCircle2 size={16} />} />
      </div>
      <div className="mb-5 grid grid-cols-2 gap-5">
        <section className="card p-5"><h2 className="font-semibold text-slate-800">Savings waterfall</h2><p className="mt-1 text-xs text-slate-500">A transparent demo run-rate view; no actual spend reduction is claimed.</p><div className="mt-5 space-y-3">
          <Waterfall label="Current monthly demo spend" amount={summary.currentMonthlySpend} max={summary.currentMonthlySpend} tone="slate" />
          <Waterfall label="Potential opportunities" amount={summary.potentialMonthlySavings} max={summary.currentMonthlySpend} tone="orange" />
          <Waterfall label="Demo-simulated opportunity" amount={summary.simulatedMonthlySavings} max={summary.currentMonthlySpend} tone="green" />
          <div className="border-t border-slate-100 pt-3"><Waterfall label="Verified AWS savings" amount={summary.verifiedSavings} max={summary.currentMonthlySpend} tone="blue" /></div>
        </div></section>
        <section className="card p-5"><h2 className="font-semibold text-slate-800">Opportunity by service</h2><p className="mt-1 text-xs text-slate-500">Summed from current non-rejected recommendations.</p><div className="mt-5 space-y-4">{Object.entries(serviceSavings).map(([service, amount]) => <div key={service}><div className="mb-1 flex justify-between text-xs"><span className="font-semibold text-slate-600">{service}</span><span className="text-slate-700">{money(amount)}</span></div><div className="progress-track"><div className="progress-fill bg-orange-400" style={{ width: `${Math.min(100, (amount / Math.max(1, summary.potentialMonthlySavings)) * 100)}%` }} /></div></div>)}</div></section>
      </div>
      <div className="card overflow-hidden"><div className="border-b border-slate-100 p-5"><h2 className="font-semibold text-slate-800">Largest opportunities</h2><p className="mt-1 text-xs text-slate-500">Per-resource estimates provided by the demo fixtures.</p></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Resource</th><th>Service</th><th>Estimated monthly savings</th><th>Risk</th><th>Status</th></tr></thead><tbody>{recommendations.filter((item) => item.status !== 'Rejected').sort((a, b) => b.savings - a.savings).slice(0, 8).map((item) => <tr key={item.id}><td>{item.resourceName}</td><td>{resources.find((resource) => resource.id === item.resourceId)?.service ?? '—'}</td><td className="font-semibold text-emerald-700">{money(item.savings)}</td><td>{item.risk}</td><td>{item.status}</td></tr>)}</tbody></table></div></div>
    </>}
  </div>;
}

function Waterfall({ label, amount, max, tone }: { label: string; amount: number; max: number; tone: string }) {
  const colors: Record<string, string> = { slate: 'bg-slate-500', orange: 'bg-orange-400', green: 'bg-emerald-500', blue: 'bg-blue-500' };
  return <div><div className="mb-1 flex justify-between gap-2 text-xs"><span className="text-slate-500">{label}</span><strong className="text-slate-700">{money(amount)}</strong></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${colors[tone]}`} style={{ width: `${max ? Math.min(100, amount / max * 100) : 0}%` }} /></div></div>;
}

export function AuditTrailPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { void api.audit().then(setEvents).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not load audit events.')); }, []);
  return <div className="page-wrap fade-up"><Header title="Audit Trail" subtitle="A persistent record of decisions, simulations, schedules, and policy changes made in this workspace." />
    <Notice>Audit records are stored locally in the demo workspace data file. Events describe demo operations only, not AWS activity.</Notice>
    {error && <div role="alert" className="mb-5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
    <section className="card overflow-hidden"><div className="border-b border-slate-100 p-5"><h2 className="font-semibold text-slate-800">Workspace events <span className="ml-1 text-xs font-normal text-slate-400">{events.length}</span></h2></div>{events.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Resource</th><th>Status</th><th>Details</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td>{dateTime(event.time)}</td><td>{event.user}</td><td className="font-semibold text-slate-700">{event.action}</td><td>{event.resource}</td><td>{event.status}</td><td className="max-w-xs truncate">{event.details || '—'}</td></tr>)}</tbody></table></div> : <div className="p-8 text-center text-sm text-slate-500">No recorded workspace events yet. Approvals, simulations, schedules, and policy changes will appear here.</div>}</section>
  </div>;
}

export function PolicyCenterPage({ toast }: { toast: Toast }) {
  const [policies, setPolicies] = useState<WorkflowPolicy[]>([]);
  const [results, setResults] = useState<Record<string, Awaited<ReturnType<typeof api.simulatePolicy>>>>({});
  const [error, setError] = useState('');
  useEffect(() => { void api.policies().then(setPolicies).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not load policies.')); }, []);
  const save = async (policy: WorkflowPolicy, change: Partial<WorkflowPolicy>) => {
    try {
      const updated = await api.updatePolicy(policy.id, change);
      setPolicies((current) => current.map((item) => item.id === updated.id ? updated : item));
      toast('Policy saved', `${updated.environment} policy has been updated.`, 'success');
    } catch (reason) { toast('Policy update failed', reason instanceof Error ? reason.message : 'The policy could not be saved.'); }
  };
  const test = async (id: string) => {
    try {
      const result = await api.simulatePolicy(id);
      setResults((current) => ({ ...current, [id]: result }));
    }
    catch (reason) { toast('Policy test failed', reason instanceof Error ? reason.message : 'The policy could not be tested.'); }
  };
  return <div className="page-wrap fade-up"><Header title="Policy Center" subtitle="Set risk boundaries and approval requirements, then preview their impact against current demo recommendations." />
    <Notice tone="amber">Policy settings only control this prototype's workflow. Auto-execution is not implemented; no policy can modify live infrastructure.</Notice>
    {error && <div role="alert" className="mb-5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
    <div className="grid grid-cols-3 gap-4 grid-cols-1 md:grid-cols-3">{policies.map((policy) => <section className="card p-5" key={policy.id}>
      <div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-50 text-orange-600"><ShieldCheck size={17} /></span><div><div className="font-semibold text-slate-800">{policy.environment}</div><div className="text-xs text-slate-500">Environment policy</div></div></div>
      <label className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4 text-xs text-slate-600"><span>Approval required</span><input type="checkbox" checked={policy.approvalRequired} onChange={(event) => void save(policy, { approvalRequired: event.target.checked })} /></label>
      <label className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-600"><span>Auto-execution policy flag</span><input type="checkbox" checked={policy.autoExecution} onChange={(event) => void save(policy, { autoExecution: event.target.checked })} /></label>
      <label className="mt-4 block text-xs text-slate-600">Maximum allowed risk<select className="input mt-1.5" value={policy.maximumRisk} onChange={(event) => void save(policy, { maximumRisk: event.target.value as WorkflowPolicy['maximumRisk'] })}><option>Low</option><option>Medium</option><option>High</option></select></label>
      <button className="btn btn-ghost mt-4 w-full" onClick={() => void test(policy.id)}><FlaskConical size={14} /> Test policy</button>
      {results[policy.id] && <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs"><div><strong>{results[policy.id].eligibleCount}</strong> eligible · <strong>{results[policy.id].blockedCount}</strong> blocked</div><div className="mt-1">Potential savings: <strong>{money(results[policy.id].potentialMonthlySavings)}/mo</strong></div><div className="mt-1 text-slate-500">{results[policy.id].approvalRequiredCount} require approval</div><div className="mt-2 text-[10px] text-slate-400">{results[policy.id].executionMode}</div></div>}
    </section>)}</div>
  </div>;
}

export function AwsConnectionPage({ toast }: { toast: Toast }) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.awsStatus>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = async () => { try { setStatus(await api.awsStatus()); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not read AWS connection state.'); } };
  useEffect(() => { void refresh(); }, []);
  const sync = async () => {
    setBusy(true);
    try {
      const result = await api.syncAws();
      setStatus(result);
      toast(result.status === 'ready' ? 'Demo data ready' : 'AWS sync unavailable', result.message, result.status === 'ready' ? 'success' : 'info');
    } catch (reason) { toast('Sync failed', reason instanceof Error ? reason.message : 'The sync request failed.'); }
    finally { setBusy(false); }
  };
  return <div className="page-wrap fade-up"><Header title="AWS Connection" subtitle="Inspect the configured data source and synchronize demo snapshots safely." action={<button className="btn btn-primary" onClick={() => void sync()} disabled={busy}>{busy ? <RefreshCw className="animate-spin" size={14} /> : <RefreshCw size={14} />} Sync data</button>} />
    <Notice tone="amber"><strong>Live AWS is not connected.</strong> This project currently provides a safe demo data source only. Sync does not call AWS APIs or imply a live connection.</Notice>
    {error && <div role="alert" className="mb-5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
    {!status ? <div className="card p-8 text-center text-sm text-slate-500">Checking configured data source…</div> : <div className="grid grid-cols-2 gap-5">
      <section className="card p-5"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><Cloud size={18} /></span><div><div className="font-semibold text-slate-800">{status.source === 'demo' ? 'Demo Dataset' : 'Live AWS'}</div><div className="mt-1 text-xs text-slate-500">{status.status.replace('_', ' ')}</div></div></div><p className="mt-4 text-sm leading-6 text-slate-600">{status.message}</p><div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div className="rounded-lg bg-slate-50 p-3"><div className="text-slate-400">AWS account ID</div><div className="mt-1 font-semibold text-slate-700">{status.accountId ?? 'Not connected'}</div></div><div className="rounded-lg bg-slate-50 p-3"><div className="text-slate-400">Region</div><div className="mt-1 font-semibold text-slate-700">{status.region ?? 'Not configured'}</div></div><div className="rounded-lg bg-slate-50 p-3 col-span-2"><div className="text-slate-400">Last sync</div><div className="mt-1 font-semibold text-slate-700">{status.syncedAt ? dateTime(status.syncedAt) : 'No synchronization recorded'}</div></div></div></section>
      <section className="card p-5"><h2 className="font-semibold text-slate-800">Service integrations</h2><p className="mt-1 text-xs text-slate-500">Capabilities listed by the configured demo data source.</p><div className="mt-4 space-y-2">{status.sources.map((source) => <div className="flex items-center justify-between rounded-lg border border-slate-100 p-3 text-sm" key={source}><span className="text-slate-700">{source}</span><span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">Demo data</span></div>)}</div><div className="mt-4 text-xs leading-5 text-slate-500">AWS Compute Optimizer is not connected. Live recommendations require a configured backend AWS SDK integration and IAM permissions.</div></section>
    </div>}
  </div>;
}

function Metric({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return <div className="card flex items-center gap-3 p-4"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-50 text-orange-600">{icon}</span><div className="min-w-0"><div className="truncate font-mono text-lg font-semibold text-slate-800">{value}</div><div className="text-xs text-slate-500">{label}</div></div></div>;
}
