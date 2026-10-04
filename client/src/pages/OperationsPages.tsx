import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, ArrowDown, ArrowRight, CalendarClock, CheckCircle2, Cloud, Database, Download, Eye, FlaskConical, RefreshCw, Server, ShieldCheck, Wallet } from 'lucide-react';
import { api, type AuditEvent, type ManualAnalysisRecord, type WorkflowAction, type WorkflowPolicy } from '../lib/api';
import type { Recommendation, Resource } from '../lib/mockData';

type Toast = (title: string, body: string, tone?: 'success' | 'info') => void;
const money = (value: number | null) => value === null ? 'Unavailable' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
const dateTime = (value: string) => new Date(value).toLocaleString();

export function OverviewDashboardPage({ navigate }: { navigate: (path: string) => void }) {
  const [resources, setResources] = useState<Awaited<ReturnType<typeof api.resources>>>([]);
  const [recommendations, setRecommendations] = useState<Awaited<ReturnType<typeof api.recommendations>>>([]);
  const [savings, setSavings] = useState<Awaited<ReturnType<typeof api.savings>> | null>(null);
  const [actions, setActions] = useState<WorkflowAction[]>([]);
  const [environment, setEnvironment] = useState<'loading' | 'demo' | 'aws' | 'manual'>('loading');
  const [awsStatus, setAwsStatus] = useState<Awaited<ReturnType<typeof api.awsStatus>> | null>(null);
  const [awsInventory, setAwsInventory] = useState<Awaited<ReturnType<typeof api.awsInventory>> | null>(null);
  const [manualAnalyses, setManualAnalyses] = useState<ManualAnalysisRecord[]>([]);
  const [executiveView, setExecutiveView] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { user } = await api.session();
        const mode = user?.environmentMode ?? 'demo';
        if (!active) return;
        setEnvironment(mode);
        if (mode === 'aws') {
          const nextStatus = await api.awsStatus();
          if (!active) return;
          setAwsStatus(nextStatus);
          try {
            setAwsInventory(await api.awsInventory());
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'AWS inventory has not been synchronized.');
          }
          return;
        }
        if (mode === 'manual') {
          setManualAnalyses(await api.manualAnalyses());
          return;
        }
        const [nextResources, nextRecommendations, nextSavings, nextActions] = await Promise.all([api.resources(), api.recommendations(), api.savings(), api.actions()]);
        if (!active) return;
        setResources(nextResources);
        setRecommendations(nextRecommendations);
        setSavings(nextSavings);
        setActions(nextActions);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load the overview data.');
      }
    })();
    return () => { active = false; };
  }, []);
  const active = recommendations.filter((item) => item.status !== 'Rejected');
  const topFive = [...active].sort((a, b) => b.savings - a.savings).slice(0, 5);
  const journey = [
    ['Discovered', recommendations.length],
    ['Reviewed', recommendations.filter((item) => item.status === 'Reviewed').length],
    ['Approved', actions.filter((item) => item.status === 'Approved' || item.status === 'Scheduled' || item.status === 'Simulated').length],
    ['Scheduled', actions.filter((item) => item.status === 'Scheduled').length],
    ['Completed', actions.filter((item) => item.status === 'Simulated').length],
  ] as const;
  const optimizedSpend = savings ? Math.max(0, savings.currentMonthlySpend - savings.potentialMonthlySavings) : 0;
  if (environment === 'manual') {
    const activeAnalyses = manualAnalyses.filter((item) => item.status !== 'Rejected');
    const monthlyOpportunity = activeAnalyses.reduce((sum, item) => sum + (item.result.potentialMonthlySavings ?? 0), 0);
    return <div className="page-wrap fade-up"><Header title="Manual Analysis Overview" subtitle="Workspace estimates based on infrastructure details you provide; no AWS account or live pricing is assumed." action={<button className="btn btn-primary" onClick={() => navigate('/manual')}><Database size={14} /> Open Manual Analysis</button>} />
      <div className="mb-5 flex items-center gap-2 text-[11px] text-slate-500"><span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 font-semibold text-blue-800">MANUAL ANALYSIS</span><span>SmartSize estimates · User-provided inputs · No infrastructure changes</span></div>
      {error && <div role="alert" className="mb-5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
      <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4"><Metric label="Resources assessed" value={manualAnalyses.length} icon={<Server size={16} />} /><Metric label="Analysis opportunities" value={activeAnalyses.filter((item) => item.result.potentialMonthlySavings !== null && item.result.potentialMonthlySavings > 0).length} icon={<Activity size={16} />} /><Metric label="Potential monthly savings" value={money(monthlyOpportunity)} icon={<ArrowDown size={16} />} /><Metric label="High-risk assessments" value={manualAnalyses.filter((item) => item.result.risk === 'High').length} icon={<AlertTriangle size={16} />} /></div>
      <section className="card p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold text-slate-800">Recent manual analyses</h2><p className="mt-1 text-xs text-slate-500">Potential estimates are not guaranteed savings.</p></div><button className="btn btn-ghost" onClick={() => navigate('/manual')}>Manage analyses <ArrowRight size={14} /></button></div>
        {!manualAnalyses.length ? <div className="mt-5 text-sm text-slate-500">No analyses yet. Enter infrastructure details to begin.</div> : <div className="mt-4 divide-y divide-slate-100">{manualAnalyses.slice(0, 8).map((analysis) => <button key={analysis.id} className="flex w-full flex-wrap items-center justify-between gap-2 py-3 text-left" onClick={() => navigate('/manual')}><span><span className="block text-sm font-medium text-slate-800">{analysis.input.resourceName}</span><span className="mt-1 block text-xs text-slate-500">{analysis.input.resourceType} · {analysis.result.classification.replaceAll('-', ' ')} · {analysis.status}</span></span><span className="text-xs font-semibold text-emerald-700">{analysis.result.potentialMonthlySavings === null ? 'Cost unavailable' : `${money(analysis.result.potentialMonthlySavings)} potential / month`}</span></button>)}</div>}
      </section>
    </div>;
  }
  if (environment !== 'demo') {
    if (environment === 'loading') return <div className="page-wrap fade-up"><Header title="Rightsizing Overview" subtitle="Loading workspace data…" /><div className="card p-8 text-center text-sm text-slate-500">Loading workspace…</div></div>;
    const resourcesByService = new Map<string, number>();
    for (const resource of awsInventory?.resources ?? []) {
      const service = typeof resource.service === 'string' ? resource.service : 'AWS';
      resourcesByService.set(service, (resourcesByService.get(service) ?? 0) + 1);
    }
    return <div className="page-wrap fade-up">
      <Header title="AWS Workspace Overview" subtitle="Live AWS data synchronized through the backend's read-only AWS integration." action={<button className="btn btn-primary" onClick={() => navigate('/aws')}><RefreshCw size={14} /> Connect or sync AWS</button>} />
      <div className="mb-5 flex items-center gap-2 text-[11px] text-slate-500"><span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800">LIVE AWS</span><span>Resource fields remain unavailable until AWS supplies them.</span></div>
      {error && <div role="alert" className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{error}</div>}
      {!awsStatus ? <div className="card p-6 text-sm text-slate-500">Checking AWS account identity…</div> : <>
        <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Metric label="AWS account" value={awsStatus.accountId ?? 'Not verified'} icon={<Cloud size={16} />} />
          <Metric label="EC2 and EBS resources" value={awsInventory?.resources.length ?? '—'} icon={<Server size={16} />} />
          <Metric label="CloudWatch data points" value={awsInventory?.metrics.length ?? '—'} icon={<Activity size={16} />} />
          <Metric label="Compute Optimizer options" value={awsInventory?.recommendations.length ?? '—'} icon={<ArrowDown size={16} />} />
        </div>
        <section className="card mb-5 p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold text-slate-800">AWS service health</h2><p className="mt-1 text-xs text-slate-500">Region: {awsStatus.region} · Workspace: {awsStatus.workspaceEnvironment ?? 'not selected'}</p></div><span className="text-xs font-semibold text-slate-600">{awsStatus.status.replace('_', ' ')}</span></div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 md:grid-cols-3">{Object.entries(awsStatus.services).map(([name, service]) => <div className="rounded-lg border border-slate-100 p-3 text-xs" key={name}><div className="font-medium text-slate-700">{name}</div><div className={`mt-1 ${service.status === 'available' ? 'text-emerald-700' : 'text-amber-700'}`}>{service.status.replace('_', ' ')}{service.category ? ` · ${service.category.replaceAll('_', ' ').toLowerCase()}` : ''}</div></div>)}</div>
        </section>
        <section className="card p-5"><h2 className="font-semibold text-slate-800">Discovered AWS resources</h2><p className="mt-1 text-xs text-slate-500">Actual inventory only; unsupported cost, memory, and utilization values are not estimated.</p>
          {!awsInventory?.resources.length ? <div className="mt-4 text-sm text-slate-500">No AWS snapshot is available yet. Connect and run a read-only sync to load account resources.</div> : <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-4">{Array.from(resourcesByService, ([service, count]) => <Metric label={`${service} resources`} value={count} icon={<Database size={16} />} key={service} />)}</div>}
          {awsInventory?.cost && <div className="mt-4 text-xs text-slate-600">Cost Explorer ({awsInventory.cost.period.start}–{awsInventory.cost.period.end}): {awsInventory.cost.amount === null ? 'Unavailable' : `${awsInventory.cost.currency ?? ''} ${awsInventory.cost.amount.toFixed(2)}`}</div>}
        </section>
      </>}
    </div>;
  }
  return <div className="page-wrap fade-up">
    <Header title={executiveView ? 'Cloud Optimization Executive Summary' : 'Rightsizing Overview'} subtitle="Prioritize cloud efficiency with transparent cost estimates, risk context, and a human-controlled action workflow." action={<button className="btn btn-ghost" onClick={() => setExecutiveView((value) => !value)}><Eye size={14} /> {executiveView ? 'Workspace view' : 'Executive view'}</button>} />
    <div className="mb-5 flex items-center gap-2 text-[11px] text-slate-500"><span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 font-semibold text-blue-800">DEMO ENVIRONMENT</span><span>Sample cloud infrastructure · Illustrative estimates</span></div>
    {error && <div role="alert" className="mb-5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
    {!savings ? <div className="card p-8 text-center text-sm text-slate-500">Loading overview…</div> : <>
      <div className="mb-6 grid grid-cols-4 gap-4 grid-cols-2 md:grid-cols-4">
        <Metric label="Resources" value={resources.length} icon={<Server size={16} />} />
        <Metric label="Optimization opportunities" value={active.length} icon={<Activity size={16} />} />
        <Metric label="Monthly opportunity" value={money(savings.potentialMonthlySavings)} icon={<ArrowDown size={16} />} />
        <Metric label="Verified savings" value={money(savings.verifiedSavings)} icon={<CheckCircle2 size={16} />} />
      </div>
      <div className="mb-5 grid grid-cols-2 gap-5">
        <section className="card p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold text-slate-800">Estimated monthly spend</h2><p className="mt-1 text-xs text-slate-500">Based on the sample environment</p></div><div className="font-mono text-2xl font-semibold text-slate-800">{money(savings.currentMonthlySpend)}</div></div><div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-lg bg-orange-50 p-3"><div className="text-xs text-orange-700">Annual opportunity</div><div className="mt-1 font-mono text-lg font-semibold text-orange-800">{money(savings.projectedAnnualSavings)}</div></div><div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Completed</div><div className="mt-1 font-mono text-lg font-semibold text-slate-800">{actions.filter((item) => item.status === 'Simulated').length}</div></div></div></section>
        {!executiveView && <section className="card p-5"><h2 className="font-semibold text-slate-800">Optimization progress</h2><p className="mt-1 text-xs text-slate-500">Current workflow status</p><div className="mt-4 grid grid-cols-5 gap-2 grid-cols-2 sm:grid-cols-5">{journey.map(([label, count]) => <div className="rounded-lg bg-slate-50 p-3" key={label}><div className="font-mono text-xl font-semibold text-slate-800">{count}</div><div className="mt-1 text-[10px] leading-4 text-slate-500">{label}</div></div>)}</div></section>}
      </div>
      <section className="card mb-5 overflow-hidden"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><div className="eyebrow !text-[9px]">Cloud efficiency</div><h2 className="mt-1 font-semibold text-slate-800">Cost opportunity</h2></div><span className="text-[10px] text-slate-500">Illustrative · Sample environment</span></div><div className="grid gap-0 md:grid-cols-[1fr_auto_1fr]"><div className="p-5"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current infrastructure</div><div className="mt-5 flex items-end justify-between gap-3"><span className="text-sm text-slate-600">Estimated monthly cost</span><strong className="font-mono text-xl text-slate-900">{money(savings.currentMonthlySpend)}</strong></div><div className="mt-3 text-xs text-slate-500">{resources.length} resources · {new Set(resources.map((item) => item.service)).size} services</div></div><div className="flex items-center justify-center border-y border-slate-100 px-5 py-3 text-blue-600 md:border-x md:border-y-0"><ArrowRight size={18} /></div><div className="bg-slate-50/70 p-5"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Optimized estimate</div><div className="mt-5 flex items-end justify-between gap-3"><span className="text-sm text-slate-600">Estimated monthly cost</span><strong className="font-mono text-xl text-slate-900">{money(optimizedSpend)}</strong></div><div className="mt-3 flex items-center justify-between text-xs"><span className="text-slate-500">Potential opportunity</span><span className="font-semibold text-emerald-700">{money(savings.potentialMonthlySavings)} / month</span></div><div className="mt-1 text-right text-[10px] text-slate-500">{money(savings.projectedAnnualSavings)} annualized</div></div></div></section>
      <section className="card overflow-hidden"><div className="flex items-start justify-between border-b border-slate-100 p-5"><div><h2 className="font-semibold text-slate-800">{executiveView ? 'Top optimization opportunities' : 'Highest-value recommendations'}</h2><p className="mt-1 text-xs text-slate-500">Sample recommendations with estimated savings and risk context.</p></div><button className="btn btn-ghost" onClick={() => navigate('/recommendations')}>View recommendations <ArrowRight size={14} /></button></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Resource</th><th>Current → recommended</th><th>Monthly opportunity</th><th>Risk</th><th>Status</th><th></th></tr></thead><tbody>{topFive.map((item) => <tr key={item.id}><td>{item.resourceName}</td><td><span className="font-mono">{item.current} → {item.recommended}</span></td><td className="font-semibold text-emerald-700">{money(item.savings)}</td><td>{item.risk}</td><td>{item.status}</td><td><button className="btn btn-ghost !min-h-7 !px-2 text-[10px]" onClick={() => navigate(`/recommendations/${item.id}`)}>Review</button></td></tr>)}</tbody></table></div></section>
      <div className="mt-5 flex flex-wrap gap-2"><button className="btn btn-ghost" onClick={() => navigate('/resources')}>Browse {resources.length} resources</button><button className="btn btn-ghost" onClick={() => navigate('/aws')}>AWS connection status</button><button className="btn btn-ghost" onClick={() => navigate('/activity')}>Review audit trail</button></div>
    </>}
  </div>;
}

function Header({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return <div className="mb-7 flex items-start justify-between gap-4 mobile-stack"><div><div className="eyebrow mb-2">SmartSize · Cloud optimization</div><h1 className="page-title">{title}</h1><p className="page-subtitle mt-2 max-w-2xl">{subtitle}</p></div>{action}</div>;
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
      const { user } = await api.session();
      const nextActions = await api.actions();
      const nextRecommendations = user?.environmentMode === 'manual' ? [] : await api.recommendations();
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
      toast('Execution simulation recorded', result.message, 'success');
      await refresh();
    } catch (reason) { toast('Simulation failed', reason instanceof Error ? reason.message : 'The action could not be simulated.'); }
  };

  const statusCount = (status: WorkflowAction['status']) => actions.filter((action) => action.status === status).length;
  return <div className="page-wrap fade-up">
    <Header title="Action Center" subtitle="Follow approved recommendations through scheduling and a safe execution simulation." action={<button className="btn btn-ghost" onClick={() => void refresh()}><RefreshCw size={14} /> Refresh</button>} />
    <Notice tone="amber"><strong>Execution simulation:</strong> scheduling and completion are recorded in SmartSize. They never call AWS write APIs or change infrastructure.</Notice>
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
            <div><div className="eyebrow">Rightsizing · {recommendation?.resourceName ?? action.resourceName ?? action.recommendationId}</div><div className="mt-2 flex items-center gap-2 font-mono text-sm text-slate-700"><span>{action.oldConfiguration}</span><ArrowRight size={14} className="text-orange-500" /><span className="font-semibold">{action.newConfiguration}</span></div><div className="mt-2 text-xs text-slate-500">Approved by {action.approvedBy} · {dateTime(action.createdAt)}</div></div>
            <span className={`status-pill ${action.status === 'Simulated' ? 'status-healthy' : action.status === 'Scheduled' ? 'status-over' : 'status-review'}`}>{action.status === 'Simulated' ? 'Execution simulated' : action.status}</span>
          </div>
          {action.scheduledAt && <div className="mt-3 text-xs text-slate-600">Scheduled for <strong>{dateTime(action.scheduledAt)}</strong></div>}
          {action.status === 'Approved' && <div className="mt-4 flex flex-wrap items-center gap-2"><input aria-label={`Schedule time for ${action.recommendationId}`} className="input !w-auto" type="datetime-local" min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)} value={scheduleValues[action.id] ?? ''} onChange={(event) => setScheduleValues((current) => ({ ...current, [action.id]: event.target.value }))} /><button className="btn btn-primary" onClick={() => void schedule(action.id)}><CalendarClock size={14} /> Schedule</button></div>}
          {action.status === 'Scheduled' && <button className="btn btn-ghost mt-4" onClick={() => void simulate(action.id)}><FlaskConical size={14} /> Simulate completion</button>}
          {action.status === 'Simulated' && <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Workflow simulation complete. No infrastructure change was made.</div>}
        </article>;
      })}
    </div>}
    <div className="mt-6 card p-5"><h2 className="font-semibold text-slate-800">Optimization journey</h2><div className="mt-4 grid grid-cols-4 gap-3 grid-cols-2 sm:grid-cols-4">{[['Approved actions', actions.length], ['Scheduled', statusCount('Scheduled')], ['Execution simulated', statusCount('Simulated')]].map(([label, count]) => <div key={label} className="rounded-lg bg-slate-50 p-3"><div className="font-mono text-xl font-semibold text-slate-800">{count}</div><div className="mt-1 text-xs text-slate-500">{label}</div></div>)}</div></div>
  </div>;
}

export function SavingsPage({ toast }: { toast: Toast }) {
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof api.savings>> | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [manualAnalyses, setManualAnalyses] = useState<ManualAnalysisRecord[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void (async () => {
      try {
        const { user } = await api.session();
        if (user?.environmentMode === 'manual') {
          const [nextSummary, nextAnalyses] = await Promise.all([api.savings(), api.manualAnalyses()]);
          setSummary(nextSummary);
          setManualAnalyses(nextAnalyses);
          return;
        }
        const [nextSummary, nextRecommendations, nextResources] = await Promise.all([api.savings(), api.recommendations(), api.resources()]);
        setSummary(nextSummary);
        setRecommendations(nextRecommendations as Recommendation[]);
        setResources(nextResources as Resource[]);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Could not load savings data.');
      }
    })();
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
  if (manualAnalyses) {
    const opportunities = manualAnalyses.filter((item) => item.status !== 'Rejected');
    const currentCost = opportunities.reduce((total, item) => total + (item.result.currentMonthlyCost ?? 0), 0);
    const potential = opportunities.reduce((total, item) => total + (item.result.potentialMonthlySavings ?? 0), 0);
    const annual = opportunities.reduce((total, item) => total + (item.result.potentialAnnualSavings ?? 0), 0);
    return <div className="page-wrap fade-up">
      <Header title="Potential Savings" subtitle="Manual estimates based on user-provided costs and utilization. These amounts are not verified or guaranteed." action={<button className="btn btn-primary" onClick={() => void exportReport()}><Download size={14} /> Export CSV</button>} />
      <Notice><strong>Manual Analysis:</strong> cost inputs are user-provided. No official provider price, billing connection, realized savings, or infrastructure change is claimed.</Notice>
      {error && <div role="alert" className="mb-5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4"><Metric label="Assessed resources" value={manualAnalyses.length} icon={<Database size={16} />} /><Metric label="Current cost supplied / month" value={money(currentCost)} icon={<Wallet size={16} />} /><Metric label="Potential monthly savings" value={money(potential)} icon={<ArrowDown size={16} />} /><Metric label="Potential annual savings" value={money(annual)} icon={<Activity size={16} />} /></div>
      <section className="card overflow-hidden"><div className="border-b border-slate-100 p-5"><h2 className="font-semibold text-slate-800">Manual estimates</h2><p className="mt-1 text-xs text-slate-500">Unknown costs remain unavailable and are excluded from the total.</p></div>
        {opportunities.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Resource</th><th>Current / optimized estimate</th><th>Potential / month</th><th>Potential / year</th><th>Risk</th><th>Status</th></tr></thead><tbody>{opportunities.map((item) => <tr key={item.id}><td>{item.input.resourceName}<div className="mt-1 text-[10px] text-slate-500">{item.result.source}</div></td><td>{money(item.result.currentMonthlyCost)} / {money(item.result.estimatedOptimizedMonthlyCost)}</td><td>{money(item.result.potentialMonthlySavings)}</td><td>{money(item.result.potentialAnnualSavings)}</td><td>{item.result.risk}</td><td>{item.status}</td></tr>)}</tbody></table></div> : <div className="p-8 text-center text-sm text-slate-500">No manual analyses yet.</div>}
        <div className="border-t border-slate-100 p-4 text-xs text-slate-500">Annual figures are monthly estimates × 12. Verified savings remain zero until actual outcomes can be confirmed.</div>
      </section>
    </div>;
  }
  return <div className="page-wrap fade-up">
    <Header title="Savings Overview" subtitle="Review illustrative opportunity separately from modeled workflow outcomes. Verified savings require confirmed AWS billing data." action={<button className="btn btn-primary" onClick={() => void exportReport()}><Download size={14} /> Export CSV</button>} />
    <Notice><strong>Sample environment:</strong> estimates are in INR and do not represent realized savings. No AWS billing connection is available.</Notice>
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
          <Waterfall label="Estimated current monthly spend" amount={summary.currentMonthlySpend} max={summary.currentMonthlySpend} tone="slate" />
          <Waterfall label="Potential opportunities" amount={summary.potentialMonthlySavings} max={summary.currentMonthlySpend} tone="orange" />
          <Waterfall label="Modeled workflow savings" amount={summary.simulatedMonthlySavings} max={summary.currentMonthlySpend} tone="green" />
          <div className="border-t border-slate-100 pt-3"><Waterfall label="Verified AWS savings" amount={summary.verifiedSavings} max={summary.currentMonthlySpend} tone="blue" /></div>
        </div></section>
        <section className="card p-5"><h2 className="font-semibold text-slate-800">Opportunity by service</h2><p className="mt-1 text-xs text-slate-500">Summed from current non-rejected recommendations.</p><div className="mt-5 space-y-4">{Object.entries(serviceSavings).map(([service, amount]) => <div key={service}><div className="mb-1 flex justify-between text-xs"><span className="font-semibold text-slate-600">{service}</span><span className="text-slate-700">{money(amount)}</span></div><div className="progress-track"><div className="progress-fill bg-orange-400" style={{ width: `${Math.min(100, (amount / Math.max(1, summary.potentialMonthlySavings)) * 100)}%` }} /></div></div>)}</div></section>
      </div>
      <div className="card overflow-hidden"><div className="border-b border-slate-100 p-5"><h2 className="font-semibold text-slate-800">Largest opportunities</h2><p className="mt-1 text-xs text-slate-500">Per-resource estimates for the selected sample environment.</p></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Resource</th><th>Service</th><th>Estimated monthly savings</th><th>Risk</th><th>Status</th></tr></thead><tbody>{recommendations.filter((item) => item.status !== 'Rejected').sort((a, b) => b.savings - a.savings).slice(0, 8).map((item) => <tr key={item.id}><td>{item.resourceName}</td><td>{resources.find((resource) => resource.id === item.resourceId)?.service ?? '—'}</td><td className="font-semibold text-emerald-700">{money(item.savings)}</td><td>{item.risk}</td><td>{item.status}</td></tr>)}</tbody></table></div></div>
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
  const [environment, setEnvironment] = useState<'demo' | 'manual' | 'aws'>('demo');
  useEffect(() => {
    void api.session().then(({ user }) => setEnvironment(user?.environmentMode ?? 'demo')).catch(() => undefined);
    void api.audit().then(setEvents).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not load audit events.'));
  }, []);
  return <div className="page-wrap fade-up"><Header title="Audit Trail" subtitle="A persistent record of decisions, simulations, schedules, and policy changes made in this workspace." />
    <Notice>{environment === 'manual' ? 'Events describe SmartSize Manual Analysis and workflow activity. They are not a record of cloud account activity.' : environment === 'aws' ? 'Events describe SmartSize workflow actions, not cloud-provider actions. No infrastructure was modified.' : 'Events describe activity in the Demo Environment. They are simulated, not records of AWS account activity.'}</Notice>
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
  return <div className="page-wrap fade-up"><Header title="Policy Center" subtitle="Set risk boundaries and approval requirements, then preview their impact against sample recommendations." />
    <Notice tone="amber">Policies guide the sample approval workflow. Automated execution is unavailable; no policy can modify AWS infrastructure.</Notice>
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
  const [region, setRegion] = useState('ap-south-1');
  const [syncResult, setSyncResult] = useState<Awaited<ReturnType<typeof api.syncAws>> | null>(null);
  const [error, setError] = useState('');
  const refresh = async () => { try { const next = await api.awsStatus(); setStatus(next); setRegion(next.region); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not read AWS connection state.'); } };
  useEffect(() => { void refresh(); }, []);
  const connect = async () => {
    setBusy(true);
    try {
      await api.connectAws(region);
      await refresh();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'AWS connection is unavailable.';
      setError(message);
      toast('AWS connection unavailable', message);
    }
    finally { setBusy(false); }
  };
  const sync = async () => {
    setBusy(true);
    try {
      const result = await api.syncAws(region);
      setSyncResult(result);
      await refresh();
      toast('AWS inventory synchronized', `${result.inventory.instanceCount} EC2 instances and ${result.inventory.volumeCount} EBS volumes stored.`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'AWS inventory synchronization failed.';
      setError(message);
      toast('AWS sync failed', message);
    } finally { setBusy(false); }
  };
  const serviceLabels: Array<[keyof NonNullable<typeof status>['services'], string]> = [
    ['sts', 'STS'], ['ec2', 'EC2'], ['ebs', 'EBS'], ['cloudWatch', 'CloudWatch'],
    ['computeOptimizer', 'Compute Optimizer'], ['costExplorer', 'Cost Explorer'],
  ];
  return <div className="page-wrap fade-up"><Header title="Connect AWS" subtitle="Connect an AWS environment securely through a backend-managed identity. No access keys are entered in the browser." />
    {error && <div role="alert" className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{error}</div>}
    {!status ? <div className="card p-8 text-center text-sm text-slate-500">Checking AWS connection status…</div> : <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
      <section className="card p-6">
        <div className="flex items-start justify-between gap-4"><div><div className="eyebrow">AWS environment</div><h2 className="mt-1 text-xl font-semibold text-slate-900">Account connection</h2></div><span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${status.status === 'connected' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>{status.status.replace('_', ' ')}</span></div>
        <p className="mt-3 max-w-lg text-sm leading-6 text-slate-600">Link an AWS account to analyze inventory, utilization, recommendations, and cost data. SmartSize will use backend credential resolution or an IAM role; credentials are never collected in this interface.</p>
        <label className="mt-6 block max-w-sm text-xs font-semibold text-slate-700">Default region<select className="input mt-2" value={region} onChange={(event) => setRegion(event.target.value)}><option value="ap-south-1">Asia Pacific · Mumbai (ap-south-1)</option><option value="us-east-1">US East · N. Virginia (us-east-1)</option><option value="eu-west-1">Europe · Ireland (eu-west-1)</option></select></label>
        {status.identity.status === 'ready' && <div className="mt-3 text-xs text-slate-600">Verified account <strong className="font-mono">{status.identity.accountId}</strong> · {status.identity.arn}</div>}
        <div className="mt-6 grid gap-2 sm:grid-cols-2">{serviceLabels.map(([key, label]) => {
          const service = status.services[key];
          return <div key={key} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2.5 text-xs"><span className="font-medium text-slate-700">{label}</span><span className={service.status === 'available' ? 'text-emerald-700' : 'text-amber-700'}>{service.status.replace('_', ' ')}{service.category ? ` · ${service.category.replaceAll('_', ' ').toLowerCase()}` : ''}</span></div>;
        })}</div>
        <button className="btn btn-primary mt-6" onClick={() => void connect()} disabled={busy}>{busy ? <RefreshCw size={14} className="animate-spin" /> : <Cloud size={14} />} Connect AWS</button>
        {status.status === 'connected' && <button className="btn btn-ghost ml-2 mt-6" onClick={() => void sync()} disabled={busy}>{busy ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />} Sync read-only inventory</button>}
        <div className="mt-3 text-[11px] leading-5 text-slate-500">{status.identity.status === 'error' ? status.identity.message : `Workspace environment: ${status.workspaceEnvironment ?? 'not selected'}. No AWS resource changes are made.`}</div>
        {syncResult && <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-900"><strong>Last sync:</strong> {syncResult.inventory.instanceCount} EC2 instances · {syncResult.inventory.volumeCount} EBS volumes · {syncResult.inventory.metricPointCount} CloudWatch data points · {syncResult.inventory.recommendationCount} Compute Optimizer options. {syncResult.messages.join(' ')}</div>}
      </section>
      <section className="card h-fit p-6"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><ShieldCheck size={18} /></div><h2 className="mt-4 font-semibold text-slate-900">Secure by design</h2><ul className="mt-3 space-y-3 text-xs leading-5 text-slate-600"><li>Use an IAM role or the standard AWS credential provider chain.</li><li>Grant only the read permissions needed for inventory, telemetry, recommendations, and cost visibility.</li><li>No AWS access key or secret key fields are provided by SmartSize.</li><li>Live mode remains unavailable until account identity and permissions can be verified.</li></ul></section>
    </div>}
  </div>;
}

function Metric({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return <div className="card flex items-center gap-3 p-4"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-50 text-orange-600">{icon}</span><div className="min-w-0"><div className="truncate font-mono text-lg font-semibold text-slate-800">{value}</div><div className="text-xs text-slate-500">{label}</div></div></div>;
}
