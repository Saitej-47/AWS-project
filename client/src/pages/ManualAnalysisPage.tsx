import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Cpu, Database, Gauge, Plus, RefreshCw, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { api, type ManualAnalysisInput, type ManualAnalysisRecord } from '../lib/api';

type Props = { toast: (title: string, body: string, tone?: 'success' | 'info') => void };

const emptyInput: ManualAnalysisInput = {
  resourceName: '',
  resourceType: 'EC2',
  provider: 'AWS',
  region: '',
  currentConfiguration: '',
  averageCpu: null,
  peakCpu: null,
  averageMemory: null,
  peakMemory: null,
  averageNetwork: null,
  peakNetwork: null,
  observationDays: 30,
  storageGiB: null,
  storageType: null,
  storageIops: null,
  storageThroughput: null,
  averageStorageUtilization: null,
  peakStorageUtilization: null,
  storageUtilizationUnknown: false,
  hourlyCost: null,
  monthlyCost: null,
  workloadType: 'general',
  availability: 'standard',
  environment: 'Production',
};

const steps = [
  { title: 'Resource', subtitle: 'Identify the infrastructure to assess.', icon: Database },
  { title: 'Utilization', subtitle: 'Provide observed workload signals.', icon: Gauge },
  { title: 'Storage', subtitle: 'Describe capacity and storage performance.', icon: SlidersHorizontal },
  { title: 'Cost', subtitle: 'Add your known infrastructure cost.', icon: Database },
  { title: 'Workload', subtitle: 'Set workload and availability context.', icon: ShieldCheck },
];

const toOptionalNumber = (value: string) => value.trim() === '' ? null : Number(value);
const money = (value: number | null) => value === null ? 'Unavailable' : `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const percent = (value: number | null) => value === null ? 'Unavailable' : `${value}%`;

export function ManualAnalysisPage({ toast }: Props) {
  const [analyses, setAnalyses] = useState<ManualAnalysisRecord[]>([]);
  const [selected, setSelected] = useState<ManualAnalysisRecord | null>(null);
  const [input, setInput] = useState<ManualAnalysisInput>(emptyInput);
  const [step, setStep] = useState(0);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = async () => {
    try {
      const next = await api.manualAnalyses();
      setAnalyses(next);
      setSelected((current) => current ? next.find((item) => item.id === current.id) ?? null : next[0] ?? null);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load workspace analyses.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, []);

  const update = <K extends keyof ManualAnalysisInput>(key: K, value: ManualAnalysisInput[K]) => {
    setInput((current) => ({ ...current, [key]: value }));
  };
  const setNumber = (key: keyof ManualAnalysisInput, value: string) => {
    update(key, toOptionalNumber(value) as ManualAnalysisInput[typeof key]);
  };
  const nextStep = () => {
    if (step === 0 && (input.resourceName.trim().length < 2 || !input.currentConfiguration.trim())) {
      setError('Enter a resource name and current configuration to continue.');
      return;
    }
    if (step === 2 && input.storageUtilizationUnknown) {
      update('averageStorageUtilization', null);
      update('peakStorageUtilization', null);
    }
    setError('');
    setStep((current) => Math.min(steps.length - 1, current + 1));
  };
  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const record = await api.createManualAnalysis(input);
      setAnalyses((current) => [record, ...current]);
      setSelected(record);
      setWizardOpen(false);
      setInput(emptyInput);
      setStep(0);
      toast('Manual analysis complete', 'SmartSize saved the estimate and its assumptions in this workspace.', 'success');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Manual analysis could not be completed.');
    } finally {
      setBusy(false);
    }
  };
  const simulate = async (analysis: ManualAnalysisRecord) => {
    setBusy(true);
    try {
      const updated = await api.simulateManualAnalysis(analysis.id);
      setSelected(updated);
      setAnalyses((current) => current.map((item) => item.id === updated.id ? updated : item));
      toast('What-if simulation recorded', 'This is an estimate only; no infrastructure was changed.', 'success');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'The simulation failed.';
      setError(message);
      toast('Simulation failed', message);
    } finally {
      setBusy(false);
    }
  };
  const decide = async (analysis: ManualAnalysisRecord, status: 'Approved' | 'Rejected') => {
    setBusy(true);
    try {
      const updated = await api.decideManualAnalysis(analysis.id, status);
      setSelected(updated);
      setAnalyses((current) => current.map((item) => item.id === updated.id ? updated : item));
      toast(status === 'Approved' ? 'Recommendation approved' : 'Recommendation rejected', 'The decision is saved in the workspace audit trail.', 'success');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'The decision could not be saved.';
      setError(message);
      toast('Decision could not be saved', message);
    } finally {
      setBusy(false);
    }
  };

  const numberInput = (label: string, key: keyof ManualAnalysisInput, suffix = '%') => {
    const value = input[key] as number | null;
    return <label className="block text-xs font-medium text-slate-700" key={String(key)}>{label}
      <div className="relative mt-1.5"><input className="input pr-12" type="number" min="0" max={suffix === '%' ? 100 : undefined} step="any" value={value ?? ''} onChange={(event) => setNumber(key, event.target.value)} placeholder="Not provided" /><span className="absolute right-3 top-2.5 text-[11px] text-slate-400">{suffix}</span></div>
    </label>;
  };

  if (loading) return <div className="page-wrap"><div className="card p-8 text-center text-sm text-slate-500">Loading workspace analyses…</div></div>;

  return <div className="page-wrap fade-up">
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div><div className="eyebrow mb-2">Manual Analysis · SmartSize Optimization Engine</div><h1 className="page-title">Infrastructure analysis</h1><p className="page-subtitle mt-2">Assess infrastructure without AWS credentials. Estimates are based only on the details you provide.</p></div>
      <button className="btn btn-primary" onClick={() => { setInput(emptyInput); setStep(0); setWizardOpen(true); setError(''); }}><Plus size={15} /> New analysis</button>
    </header>
    <div className="mb-5 flex items-center gap-2 text-[11px] text-slate-500"><span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 font-semibold text-blue-800">MANUAL ANALYSIS</span><span>User-provided inputs · Potential savings only · No infrastructure changes</span></div>
    {error && <div role="alert" className="mb-5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

    {wizardOpen ? <section className="card overflow-hidden">
      <div className="border-b border-slate-100 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">{steps.map((item, index) => <button key={item.title} className={`flex items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold ${index === step ? 'bg-slate-900 text-white' : index < step ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-500'}`} onClick={() => index < step && setStep(index)}><item.icon size={13} />{index + 1}. {item.title}</button>)}</div>
        <h2 className="mt-5 text-lg font-semibold text-slate-900">{steps[step].title}</h2><p className="mt-1 text-sm text-slate-500">{steps[step].subtitle}</p>
      </div>
      <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
        {step === 0 && <>
          <label className="block text-xs font-medium text-slate-700">Resource name<input className="input mt-1.5" maxLength={120} value={input.resourceName} onChange={(event) => update('resourceName', event.target.value)} placeholder="e.g. Production API" /></label>
          <label className="block text-xs font-medium text-slate-700">Resource type<select className="input mt-1.5" value={input.resourceType} onChange={(event) => update('resourceType', event.target.value as ManualAnalysisInput['resourceType'])}>{['EC2', 'EBS', 'RDS', 'Lambda', 'Other'].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="block text-xs font-medium text-slate-700">Cloud / provider<select className="input mt-1.5" value={input.provider} onChange={(event) => update('provider', event.target.value as ManualAnalysisInput['provider'])}>{['AWS', 'Azure', 'GCP', 'Other'].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="block text-xs font-medium text-slate-700">Region<input className="input mt-1.5" maxLength={64} value={input.region} onChange={(event) => update('region', event.target.value)} placeholder="e.g. ap-south-1" /></label>
          <label className="block text-xs font-medium text-slate-700 sm:col-span-2">Current instance / resource configuration<input className="input mt-1.5" maxLength={80} value={input.currentConfiguration} onChange={(event) => update('currentConfiguration', event.target.value)} placeholder="e.g. m5.2xlarge or 500 GiB gp3" /></label>
        </>}
        {step === 1 && <>
          {numberInput('Average CPU utilization', 'averageCpu')}
          {numberInput('Peak CPU utilization', 'peakCpu')}
          {numberInput('Average memory utilization · user-provided', 'averageMemory')}
          {numberInput('Peak memory utilization · user-provided', 'peakMemory')}
          {numberInput('Average network utilization', 'averageNetwork')}
          {numberInput('Peak network utilization', 'peakNetwork')}
          <label className="block text-xs font-medium text-slate-700">Observation period<select className="input mt-1.5" value={input.observationDays} onChange={(event) => update('observationDays', Number(event.target.value) as ManualAnalysisInput['observationDays'])}>{[7, 14, 30, 90].map((days) => <option value={days} key={days}>{days} days</option>)}</select></label>
          <p className="self-end text-[11px] text-slate-500">Memory metrics are user-provided; they are not inferred from CPU or CloudWatch.</p>
        </>}
        {step === 2 && <>
          {numberInput('Current storage size', 'storageGiB', 'GiB')}
          <label className="block text-xs font-medium text-slate-700">Storage type<select className="input mt-1.5" value={input.storageType ?? ''} onChange={(event) => update('storageType', event.target.value ? event.target.value as ManualAnalysisInput['storageType'] : null)}><option value="">Not provided</option><option value="gp3">gp3</option><option value="gp2">gp2</option><option value="io2">io2</option><option value="other">Other</option></select></label>
          {numberInput('Current IOPS', 'storageIops', 'IOPS')}
          {numberInput('Current throughput', 'storageThroughput', 'MiB/s')}
          {numberInput('Average storage utilization', 'averageStorageUtilization')}
          {numberInput('Peak storage utilization', 'peakStorageUtilization')}
          <label className="flex items-center gap-2 text-xs text-slate-700 sm:col-span-2"><input type="checkbox" checked={input.storageUtilizationUnknown} onChange={(event) => { update('storageUtilizationUnknown', event.target.checked); if (event.target.checked) { update('averageStorageUtilization', null); update('peakStorageUtilization', null); } }} /> I don't know storage utilization (use clearly stated conservative assumption)</label>
          <p className="sm:col-span-2 text-[11px] text-slate-500">Storage capacity estimates use 25% headroom and are labelled SmartSize Storage Estimate.</p>
        </>}
        {step === 3 && <>
          <label className="block text-xs font-medium text-slate-700">Current monthly cost · user-provided<input className="input mt-1.5" type="number" min="0" step="any" value={input.monthlyCost ?? ''} disabled={input.hourlyCost !== null} onChange={(event) => update('monthlyCost', toOptionalNumber(event.target.value))} placeholder="₹ per month" /></label>
          <label className="block text-xs font-medium text-slate-700">Or current hourly cost · user-provided<input className="input mt-1.5" type="number" min="0" step="any" value={input.hourlyCost ?? ''} disabled={input.monthlyCost !== null} onChange={(event) => update('hourlyCost', toOptionalNumber(event.target.value))} placeholder="₹ per hour" /></label>
          <p className="sm:col-span-2 text-[11px] text-slate-500">Entered pricing is user-provided, not an official cloud price. Hourly pricing is estimated using 24 hours × 30 days.</p>
        </>}
        {step === 4 && <>
          <label className="block text-xs font-medium text-slate-700">Workload type<select className="input mt-1.5" value={input.workloadType} onChange={(event) => update('workloadType', event.target.value as ManualAnalysisInput['workloadType'])}><option value="general">General Purpose</option><option value="compute">Compute Intensive</option><option value="memory">Memory Intensive</option><option value="storage">Storage Intensive</option><option value="burstable">Burstable</option><option value="other">Other / Unspecified</option></select></label>
          <label className="block text-xs font-medium text-slate-700">Availability requirement<select className="input mt-1.5" value={input.availability} onChange={(event) => update('availability', event.target.value as ManualAnalysisInput['availability'])}><option value="standard">Standard</option><option value="high">High</option><option value="mission-critical">Mission Critical</option></select></label>
          <label className="block text-xs font-medium text-slate-700">Environment<select className="input mt-1.5" value={input.environment} onChange={(event) => update('environment', event.target.value as ManualAnalysisInput['environment'])}><option>Production</option><option>Development</option><option>Test</option></select></label>
          <div className="flex items-center gap-2 rounded-lg bg-blue-50 p-3 text-xs text-blue-900 sm:col-span-2"><Cpu size={15} /> The engine considers peak load, observed memory, availability, and storage. Analysis Confidence describes input completeness, not a validated probability.</div>
        </>}
      </div>
      <div className="flex justify-between border-t border-slate-100 p-5"><button className="btn btn-ghost" onClick={() => step === 0 ? setWizardOpen(false) : setStep((current) => current - 1)}><ArrowLeft size={14} />{step === 0 ? 'Cancel' : 'Back'}</button>{step < steps.length - 1 ? <button className="btn btn-primary" onClick={nextStep}>Continue <ArrowRight size={14} /></button> : <button className="btn btn-primary" disabled={busy} onClick={() => void create()}>{busy ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Analyze infrastructure</button>}</div>
    </section> : <div className="grid items-start gap-5 lg:grid-cols-[.78fr_1.22fr]">
      <section className="card overflow-hidden"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><h2 className="font-semibold text-slate-800">Saved analyses</h2><p className="mt-1 text-xs text-slate-500">Workspace-scoped and persistent</p></div><button className="btn btn-ghost !px-2" onClick={() => void refresh()} aria-label="Refresh analyses"><RefreshCw size={14} /></button></div>
        {!analyses.length ? <div className="p-8 text-center"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Database size={18} /></div><div className="mt-3 text-sm font-semibold text-slate-800">Start with your infrastructure data</div><p className="mt-1 text-xs leading-5 text-slate-500">Create a manual analysis to get a transparent capacity and potential savings estimate.</p><button className="btn btn-primary mt-4" onClick={() => setWizardOpen(true)}><Plus size={14} /> Start analysis</button></div> : <div className="divide-y divide-slate-100">{analyses.map((analysis) => <button key={analysis.id} onClick={() => setSelected(analysis)} className={`w-full p-4 text-left hover:bg-slate-50 ${selected?.id === analysis.id ? 'bg-blue-50/70' : ''}`}><div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold text-slate-800">{analysis.input.resourceName}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-600">{analysis.status}</span></div><div className="mt-1 text-xs text-slate-500">{analysis.input.resourceType} · {analysis.result.classification.replaceAll('-', ' ')} · {new Date(analysis.createdAt).toLocaleDateString()}</div><div className="mt-2 text-xs font-semibold text-emerald-700">{analysis.result.potentialMonthlySavings === null ? 'Cost estimate unavailable' : `${money(analysis.result.potentialMonthlySavings)} potential monthly savings`}</div></button>)}</div>}
      </section>
      <section className="card p-5 sm:p-6">{selected ? <>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="eyebrow">SmartSize Optimization Engine</div><h2 className="mt-1 text-xl font-semibold text-slate-900">{selected.input.resourceName}</h2><p className="mt-1 text-xs text-slate-500">{selected.input.provider} · {selected.input.region || 'Region not provided'} · {selected.input.observationDays}-day observation</p></div><span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-semibold uppercase text-blue-800">{selected.status}</span></div>
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4"><Summary label="Current cost / month" value={money(selected.result.currentMonthlyCost)} /><Summary label="Estimated optimized" value={money(selected.result.estimatedOptimizedMonthlyCost)} /><Summary label="Potential savings / month" value={money(selected.result.potentialMonthlySavings)} /><Summary label="Potential savings / year" value={money(selected.result.potentialAnnualSavings)} /></div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4"><Summary label="Estimated reduction" value={percent(selected.result.estimatedReductionPercent)} /><Summary label="Analysis Confidence" value={`${selected.result.analysisConfidence}%`} /><Summary label="Performance risk" value={selected.result.risk} /><Summary label="Recommendation" value={selected.result.classification.replaceAll('-', ' ')} /></div>
        <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50 p-4"><div className="text-xs font-semibold text-slate-800">Optimization assessment</div><p className="mt-2 text-sm leading-6 text-slate-600">{selected.result.explanation}</p><div className="mt-3 text-xs"><span className="font-semibold text-slate-700">Suggested configuration:</span> <span className="text-slate-600">{selected.result.suggestedConfiguration}</span></div></div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2"><div><div className="text-xs font-semibold text-slate-800">Utilization supplied</div><dl className="mt-2 space-y-1.5 text-xs text-slate-600"><Fact label="Average / peak CPU" value={`${percent(selected.input.averageCpu)} / ${percent(selected.input.peakCpu)}`} /><Fact label="Average / peak memory" value={`${percent(selected.input.averageMemory)} / ${percent(selected.input.peakMemory)} · user-provided`} /><Fact label="Average / peak network" value={`${percent(selected.input.averageNetwork)} / ${percent(selected.input.peakNetwork)}`} /><Fact label="Storage utilization" value={selected.input.storageUtilizationUnknown ? 'Unknown; conservative assumption applied' : `${percent(selected.input.averageStorageUtilization)} / ${percent(selected.input.peakStorageUtilization)}`} /></dl></div><div><div className="text-xs font-semibold text-slate-800">Confidence factors & assumptions</div><ul className="mt-2 space-y-1.5 text-xs text-slate-600">{selected.result.confidenceFactors.map((item) => <li key={item}>• {item}</li>)}{selected.result.assumptions.map((item) => <li key={item} className="text-amber-800">• {item}</li>)}</ul></div></div>
        {selected.result.estimatedStorageGiB !== null && <div className="mt-4 rounded-lg border border-cyan-100 bg-cyan-50 p-3 text-xs text-cyan-900"><strong>SmartSize Storage Estimate:</strong> {selected.result.estimatedStorageGiB} GiB with 25% capacity headroom. This is an estimate, not an AWS recommendation.</div>}
        <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <button className="btn btn-primary" onClick={() => void simulate(selected)} disabled={busy || selected.status === 'Approved' || selected.status === 'Rejected'}><Gauge size={14} /> Run What-if simulation</button>
          <button className="btn btn-ghost" onClick={() => void decide(selected, 'Approved')} disabled={busy || selected.status !== 'Simulated'}><CheckCircle2 size={14} /> Approve</button>
          <button className="btn btn-ghost !text-rose-700" onClick={() => void decide(selected, 'Rejected')} disabled={busy || selected.status !== 'Simulated'}>Reject</button>
          {selected.status === 'Approved' && <div className="flex items-center text-xs font-medium text-slate-500">Approval creates an execution-pending action; infrastructure is not changed.</div>}
        </div>
        {selected.simulation && <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-900"><strong>Simulation recorded:</strong> {money(selected.simulation.monthlySavings)} potential monthly savings · {percent(selected.simulation.estimatedReductionPercent)} estimated reduction. No infrastructure was modified.</div>}
        <div className="mt-3 text-[10px] text-slate-400">Source: {selected.result.source} · User-provided cost · Potential estimate, not guaranteed savings.</div>
      </> : <div className="p-10 text-center text-sm text-slate-500">Select a saved analysis or create a new one.</div>}</section>
    </div>}
  </div>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-slate-100 p-3"><div className="text-[10px] font-semibold uppercase leading-4 tracking-wide text-slate-500">{label}</div><div className="mt-1 break-words font-mono text-sm font-semibold text-slate-900">{value}</div></div>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3"><dt>{label}</dt><dd className="text-right font-medium">{value}</dd></div>;
}
