import { useEffect, useMemo, useState } from "react";
import { Activity, BarChart3 } from "lucide-react";
import { api, type RecommendationRecord, type ResourceRecord } from "../lib/api";

const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

export function CostAnalysisWorkspacePage() {
  const [resources, setResources] = useState<ResourceRecord[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationRecord[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    void Promise.all([api.resources(), api.recommendations()]).then(([nextResources, nextRecommendations]) => {
      setResources(nextResources);
      setRecommendations(nextRecommendations);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load cost analysis."));
  }, []);
  const currentSpend = resources.reduce((sum, resource) => sum + resource.monthlyCost, 0);
  const potentialSavings = recommendations.filter((item) => item.status !== "Rejected").reduce((sum, item) => sum + item.savings, 0);
  const serviceRows = useMemo(() => Array.from(new Set(resources.map((resource) => resource.service))).map((service) => {
    const group = resources.filter((resource) => resource.service === service);
    const groupIds = new Set(group.map((resource) => resource.id));
    const savings = recommendations.filter((item) => groupIds.has(item.resourceId) && item.status !== "Rejected").reduce((sum, item) => sum + item.savings, 0);
    return { service, count: group.length, current: group.reduce((sum, item) => sum + item.monthlyCost, 0), savings };
  }), [resources, recommendations]);
  return <div className="page-wrap fade-up">
    <Header icon={<BarChart3 size={16} />} title="Cost Analysis" subtitle="Calculated from resources and recommendations returned by the current backend data source." />
    {error && <ErrorBox>{error}</ErrorBox>}
    <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3"><Metric label="Current monthly estimate" value={money(currentSpend)} /><Metric label="Potential monthly opportunity" value={money(potentialSavings)} /><Metric label="Annualized opportunity" value={money(potentialSavings * 12)} /></div>
    <section className="card overflow-hidden"><div className="border-b border-slate-100 p-5"><h2 className="font-semibold text-slate-800">Service cost breakdown</h2><p className="mt-1 text-xs text-slate-500">Monthly estimates and opportunities grouped from current resource records.</p></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Service</th><th>Resources</th><th>Current monthly estimate</th><th>Potential opportunity</th></tr></thead><tbody>{serviceRows.map((item) => <tr key={item.service}><td className="font-semibold">{item.service}</td><td>{item.count}</td><td>{money(item.current)}</td><td className="font-semibold text-emerald-700">{money(item.savings)}</td></tr>)}{!resources.length && !error && <tr><td colSpan={4} className="py-8 text-center text-sm text-slate-500">Loading backend cost inputs…</td></tr>}</tbody></table></div></section>
    <p className="mt-3 text-[10px] text-slate-400">Demo mode: these are synthetic fixture estimates, not actual AWS billing or Cost Explorer data.</p>
  </div>;
}

export function UtilizationWorkspacePage() {
  const [resources, setResources] = useState<ResourceRecord[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    void api.resources().then(setResources).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load utilization data."));
  }, []);
  const averages = resources.length ? {
    cpu: resources.reduce((sum, item) => sum + item.cpu, 0) / resources.length,
    memory: resources.reduce((sum, item) => sum + item.memory, 0) / resources.length,
    network: resources.reduce((sum, item) => sum + item.network, 0) / resources.length,
    storage: resources.reduce((sum, item) => sum + item.storage, 0) / resources.length,
  } : null;
  return <div className="page-wrap fade-up">
    <Header icon={<Activity size={16} />} title="Utilization" subtitle="Recorded utilization summaries from the configured backend data source; this view does not infer a time series." />
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Synthetic fixture values only. CloudWatch metrics are not connected, and no historical time-series data is available.</div>
    {error && <ErrorBox>{error}</ErrorBox>}
    {averages && <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4"><Metric label="Average CPU" value={`${averages.cpu.toFixed(1)}%`} /><Metric label="Average memory" value={`${averages.memory.toFixed(1)}%`} /><Metric label="Average network" value={`${averages.network.toFixed(1)}%`} /><Metric label="Average storage" value={`${averages.storage.toFixed(1)}%`} /></div>}
    <section className="card overflow-hidden"><div className="border-b border-slate-100 p-5"><h2 className="font-semibold text-slate-800">Resource utilization summaries</h2><p className="mt-1 text-xs text-slate-500">Average and recorded peak fixture values. No interpolated data points are displayed.</p></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Resource</th><th>Service</th><th>Average CPU</th><th>Peak CPU</th><th>Average memory</th><th>Peak memory</th><th>Network</th><th>Storage</th></tr></thead><tbody>{resources.map((item) => <tr key={item.id}><td className="font-semibold text-slate-800">{item.name}</td><td>{item.service}</td><td>{item.cpu}%</td><td>{item.peakCpu}%</td><td>{item.memory}%</td><td>{item.peakMemory}%</td><td>{item.network}%</td><td>{item.storage}%</td></tr>)}{!resources.length && !error && <tr><td colSpan={8} className="py-8 text-center text-sm text-slate-500">Loading backend utilization summaries…</td></tr>}</tbody></table></div></section>
  </div>;
}

function Header({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return <div className="mb-6 flex items-start gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-50 text-orange-600">{icon}</span><div><div className="eyebrow">SmartSize · Demo data</div><h1 className="page-title mt-1">{title}</h1><p className="page-subtitle mt-1">{subtitle}</p></div></div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="card p-4"><div className="eyebrow !text-[9px]">{label}</div><div className="mt-2 font-mono text-lg font-semibold text-slate-800">{value}</div></div>;
}

function ErrorBox({ children }: { children: string }) {
  return <div role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{children}</div>;
}
