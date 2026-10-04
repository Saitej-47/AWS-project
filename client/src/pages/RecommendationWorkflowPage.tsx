import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, FlaskConical, ShieldCheck, X } from 'lucide-react';
import { api, type RecommendationDetail } from '../lib/api';
import type { Recommendation } from '../lib/mockData';

type Toast = (title: string, body: string, tone?: 'success' | 'info') => void;
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);

export function RecommendationWorkflowPage({
  id,
  navigate,
  toast,
  onApprove,
  onReject,
}: {
  id: string;
  navigate: (path: string) => void;
  toast: Toast;
  onApprove: (recommendation: Recommendation) => void;
  onReject: (recommendation: Recommendation, note?: string) => Promise<void>;
}) {
  const [detail, setDetail] = useState<RecommendationDetail | null>(null);
  const [simulation, setSimulation] = useState<Awaited<ReturnType<typeof api.simulateRecommendation>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void api.recommendationDetail(id).then((result) => {
      if (active) setDetail(result);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Could not load recommendation evidence.');
    });
    return () => { active = false; };
  }, [id]);

  const runSimulation = async () => {
    setBusy(true);
    try {
      setSimulation(await api.simulateRecommendation(id));
    } catch (reason) {
      toast('Simulation failed', reason instanceof Error ? reason.message : 'This recommendation could not be simulated.');
    } finally {
      setBusy(false);
    }
  };
  const reject = async () => {
    if (!detail) return;
    const note = window.prompt('Optional reason for rejecting this recommendation:');
    if (note === null) return;
    setBusy(true);
    try {
      await onReject(detail.recommendation, note.trim() || undefined);
      setDetail({ ...detail, recommendation: { ...detail.recommendation, status: 'Rejected' } });
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div className="page-wrap"><div role="alert" className="card border-rose-200 p-6 text-sm text-rose-800">{error}<button className="btn btn-ghost ml-3" onClick={() => navigate('/recommendations')}>Back to recommendations</button></div></div>;
  if (!detail) return <div className="page-wrap"><div className="card p-8 text-center text-sm text-slate-500">Loading recommendation evidence…</div></div>;
  const { recommendation, resource, analysis } = detail;
  const isFinal = recommendation.status === 'Approved' || recommendation.status === 'Rejected';
  const metrics = [
    { label: 'CPU average / peak', average: resource.cpu, peak: resource.peakCpu },
    { label: 'Memory average / peak', average: resource.memory, peak: resource.peakMemory },
    { label: 'Network utilization', average: resource.network, peak: undefined },
  ];

  return <div className="page-wrap fade-up">
    <button className="breadcrumb-link mb-5 flex items-center gap-1 text-xs" onClick={() => navigate('/recommendations')}><ArrowLeft size={13} /> Recommendations</button>
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div><div className="eyebrow mb-2">Sample recommendation · {resource.service} · {resource.region} · {resource.env}</div><h1 className="page-title">{resource.name}</h1><p className="page-subtitle mt-2">Review the proposed configuration, cost estimate, and performance evidence.</p></div>
      <span className="status-pill status-review">{recommendation.status}</span>
    </div>
    <div className="mb-5 grid grid-cols-3 gap-4 grid-cols-1 md:grid-cols-3">
      <section className="card border-l-4 border-l-slate-400 p-5"><div className="eyebrow">Current configuration</div><div className="mt-3 font-mono text-xl font-semibold text-slate-800">{recommendation.current}</div><div className="mt-2 text-xs text-slate-500">Estimated monthly cost · {money(recommendation.currentCost)}</div></section>
      <div className="hidden items-center justify-center text-orange-500 md:flex"><ArrowRight size={26} /></div>
      <section className="card border-l-4 border-l-orange-400 p-5"><div className="eyebrow">Proposed configuration · Sample</div><div className="mt-3 font-mono text-xl font-semibold text-slate-800">{recommendation.recommended}</div><div className="mt-2 text-xs text-slate-500">Estimated monthly cost · {money(recommendation.optimizedCost)}</div></section>
      <section className="card border-l-4 border-l-emerald-500 p-5"><div className="eyebrow">Estimated opportunity</div><div className="mt-3 font-mono text-xl font-semibold text-emerald-700">{money(recommendation.savings)} / month</div><div className="mt-2 text-xs text-slate-500">{money(analysis.estimated_savings.annual)} annualized · {Math.round(recommendation.savings / Math.max(1, recommendation.currentCost) * 100)}% lower estimate</div></section>
    </div>
    <div className="mb-5 grid grid-cols-3 gap-5 grid-cols-1 lg:grid-cols-3">
      <section className="card p-5 lg:col-span-2"><h2 className="font-semibold text-slate-800">Why this recommendation?</h2><p className="mt-3 text-sm leading-7 text-slate-600">{analysis.explanation}</p><div className="mt-5 grid grid-cols-3 gap-3 grid-cols-1 sm:grid-cols-3">{metrics.map((metric) => <div className="rounded-lg bg-slate-50 p-3" key={metric.label}><div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{metric.label}</div><div className="mt-2 font-mono text-lg font-semibold text-slate-800">{metric.average}%</div>{metric.peak !== undefined && <div className="mt-1 text-[10px] text-slate-500">Peak {metric.peak}%</div>}</div>)}</div></section>
      <section className="card p-5"><div className="flex items-center justify-between"><h2 className="font-semibold text-slate-800">Transparent score</h2><span className="font-mono text-xl font-bold text-orange-600">{analysis.opportunity_score}<small className="text-xs text-slate-400">/100</small></span></div><div className="mt-1 text-xs text-slate-500">{analysis.recommendation_priority} priority · {analysis.risk_level} risk</div><ul className="mt-4 space-y-3">{analysis.score_reasons.map((reason) => <li className="border-t border-slate-100 pt-3 text-xs leading-5 text-slate-600" key={reason}>{reason}</li>)}</ul><div className="mt-4 text-[10px] leading-4 text-slate-400">Source: {analysis.recommendation_source}</div></section>
    </div>
    {simulation && <div role="status" className="mb-5 rounded-xl border border-blue-200 bg-blue-50 p-5"><div className="flex items-center gap-2 font-semibold text-blue-900"><FlaskConical size={16} /> Simulation result</div><div className="mt-3 grid grid-cols-3 gap-3 text-xs text-blue-900 grid-cols-1 sm:grid-cols-3"><div>Monthly savings <strong className="block mt-1">{money(simulation.monthlySavings)}</strong></div><div>Annualized savings <strong className="block mt-1">{money(simulation.annualizedSavings)}</strong></div><div>Risk <strong className="block mt-1">{simulation.risk}</strong></div></div><p className="mt-3 text-xs text-blue-800">{simulation.result}</p></div>}
    <div className="insight-strip flex flex-wrap items-center justify-between gap-4 p-5"><div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[#ffb448]"><ShieldCheck size={14} /> Human-controlled workflow</div><p className="mt-1 text-xs text-slate-300">No approval, schedule, or simulation action modifies AWS resources.</p></div><div className="flex flex-wrap gap-2">
      <button className="btn bg-white/10 text-white hover:bg-white/20" disabled={busy} onClick={() => void runSimulation()}>{busy ? 'Working…' : <><FlaskConical size={14} /> Simulate</>}</button>
      {!isFinal && <button className="btn btn-primary" onClick={() => onApprove(recommendation)}><Check size={14} /> Approve</button>}
      {!isFinal && <button className="btn bg-white/10 text-white hover:bg-white/20" disabled={busy} onClick={() => void reject()}><X size={14} /> Reject</button>}
      {recommendation.status === 'Approved' && <button className="btn btn-ghost" onClick={() => navigate('/actions')}>Open Action Center <ArrowRight size={13} /></button>}
    </div></div>
  </div>;
}
