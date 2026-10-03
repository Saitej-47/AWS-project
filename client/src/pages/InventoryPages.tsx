import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, FlaskConical, Search, Server } from "lucide-react";
import { api, type RecommendationRecord, type ResourceRecord } from "../lib/api";

const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

export function ResourcesWorkspacePage({ navigate }: { navigate: (path: string) => void }) {
  const [resources, setResources] = useState<ResourceRecord[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    void api.resources().then(setResources).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load resources."));
  }, []);
  const filtered = useMemo(() => resources.filter((resource) => `${resource.name} ${resource.instanceId} ${resource.service} ${resource.region} ${resource.env}`.toLowerCase().includes(query.toLowerCase())), [resources, query]);
  return <div className="page-wrap fade-up">
    <div className="mb-7"><div className="eyebrow mb-2">SmartSize · Demo inventory</div><h1 className="page-title">Resources</h1><p className="page-subtitle mt-2">Inventory and utilization summaries loaded from the configured backend data source.</p></div>
    <div className="mb-4 flex items-center gap-2"><label className="relative block w-full max-w-sm"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="input pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search resources, service, region…" aria-label="Search resources" /></label><span className="text-xs text-slate-500">{filtered.length} resources</span></div>
    {error && <div role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
    <section className="card overflow-hidden"><div className="table-wrap"><table className="data-table"><thead><tr><th>Resource</th><th>Service / type</th><th>Region</th><th>Environment</th><th>CPU / memory avg.</th><th>Monthly cost</th><th>Status</th><th></th></tr></thead><tbody>
      {filtered.map((resource) => <tr key={resource.id}><td><div className="font-semibold text-slate-800">{resource.name}</div><div className="mt-0.5 font-mono text-[10px] text-slate-400">{resource.instanceId}</div></td><td>{resource.service}<div className="font-mono text-[10px] text-slate-400">{resource.instanceType}</div></td><td>{resource.region}</td><td>{resource.env}</td><td>{resource.cpu}% / {resource.memory}%</td><td>{money(resource.monthlyCost)}</td><td>{resource.status}</td><td><button className="btn btn-ghost !min-h-8 !px-2.5 text-[11px]" onClick={() => navigate(`/resources/${resource.id}`)}>Details <ArrowRight size={13} /></button></td></tr>)}
      {resources.length > 0 && filtered.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-sm text-slate-500">No resources match this search.</td></tr>}
      {resources.length === 0 && !error && <tr><td colSpan={8} className="py-10 text-center text-sm text-slate-500">Loading backend inventory…</td></tr>}
    </tbody></table></div></section>
  </div>;
}

export function ResourceDetailWorkspacePage({ id, navigate }: { id: string; navigate: (path: string) => void }) {
  const [resource, setResource] = useState<ResourceRecord | null>(null);
  const [recommendation, setRecommendation] = useState<RecommendationRecord | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api.resourceDetail(id).then((result) => {
      if (!active) return;
      setResource(result.resource);
      setRecommendation(result.recommendation);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Could not load resource details.");
    });
    return () => { active = false; };
  }, [id]);
  if (error) return <div className="page-wrap"><div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div></div>;
  if (!resource) return <div className="page-wrap"><div className="card p-8 text-center text-sm text-slate-500">Loading resource details…</div></div>;
  const metricRows = [
    ["Average CPU utilization", resource.cpu, "Average from the synthetic fixture"],
    ["Peak CPU utilization", resource.peakCpu, "Peak from the synthetic fixture"],
    ["Average memory utilization", resource.memory, "Average from the synthetic fixture"],
    ["Peak memory utilization", resource.peakMemory, "Peak from the synthetic fixture"],
    ["Network utilization", resource.network, "Synthetic fixture estimate"],
    ["Storage utilization", resource.storage, "Synthetic fixture estimate"],
  ] as const;
  return <div className="page-wrap fade-up">
    <button className="breadcrumb-link mb-5 flex items-center gap-1 text-xs" onClick={() => navigate("/resources")}><ArrowLeft size={13} /> Resources</button>
    <div className="mb-6 flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-orange-600"><Server size={18} /></span><div><div className="eyebrow">{resource.service} · {resource.region} · {resource.env} · Synthetic demo data</div><h1 className="page-title mt-1">{resource.name}</h1><p className="mt-1 font-mono text-xs text-slate-500">{resource.instanceId} · {resource.instanceType}</p></div></div>
    <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4"><Metric label="Resource state" value={resource.status} /><Metric label="Monthly cost estimate" value={money(resource.monthlyCost)} /><Metric label="Average CPU" value={`${resource.cpu}%`} /><Metric label="Average memory" value={`${resource.memory}%`} /></div>
    <section className="card overflow-hidden"><div className="border-b border-slate-100 p-5"><h2 className="font-semibold text-slate-800">Recorded utilization evidence</h2><p className="mt-1 text-xs text-slate-500">Point-in-time averages and peaks supplied by the synthetic demo fixture; no time-series metrics are available.</p></div><div className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0">{metricRows.map(([label, value, detail]) => <div className="p-5" key={label}><div className="flex items-center justify-between"><span className="text-sm text-slate-600">{label}</span><span className="font-mono font-semibold text-slate-800">{value}%</span></div><p className="mt-1 text-[10px] text-slate-400">{detail}</p></div>)}</div></section>
    <div className="mt-5 flex flex-wrap gap-2"><button className="btn btn-ghost" onClick={() => navigate("/resources")}><ArrowLeft size={14} /> Back to resources</button>{recommendation && <button className="btn btn-primary" onClick={() => navigate(`/recommendations/${recommendation.id}`)}>Review recommendation <ArrowRight size={14} /></button>}</div>
    {!recommendation && <div className="mt-5 rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">No recommendation is associated with this resource in the current demo dataset.</div>}
  </div>;
}

export function RecommendationsWorkspacePage({ navigate }: { navigate: (path: string) => void }) {
  const [recommendations, setRecommendations] = useState<RecommendationRecord[]>([]);
  const [resources, setResources] = useState<ResourceRecord[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All");
  const [error, setError] = useState("");
  useEffect(() => {
    void Promise.all([api.recommendations(), api.resources()]).then(([nextRecommendations, nextResources]) => {
      setRecommendations(nextRecommendations);
      setResources(nextResources);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load recommendations."));
  }, []);
  const resourceById = useMemo(() => new Map(resources.map((resource) => [resource.id, resource])), [resources]);
  const filtered = recommendations.filter((item) => {
    const resource = resourceById.get(item.resourceId);
    const matchesQuery = `${item.resourceName} ${item.current} ${item.recommended} ${resource?.region ?? ""} ${resource?.service ?? ""}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (status === "All" || item.status === status);
  });
  return <div className="page-wrap fade-up">
    <div className="mb-7"><div className="eyebrow mb-2">SmartSize · Decision support</div><h1 className="page-title">Recommendations</h1><p className="page-subtitle mt-2">Recommendation fixtures and workflow status from the backend. AWS Compute Optimizer is not connected.</p></div>
    <div className="mb-4 flex flex-wrap items-center gap-2"><label className="relative block w-full max-w-sm"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="input pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search recommendations…" aria-label="Search recommendations" /></label><select className="input w-auto" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by recommendation status">{["All", "Open", "Reviewed", "Approved", "Rejected"].map((item) => <option key={item}>{item}</option>)}</select><span className="text-xs text-slate-500">{filtered.length} recommendations</span></div>
    {error && <div role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
    <section className="card overflow-hidden"><div className="table-wrap"><table className="data-table"><thead><tr><th>Resource</th><th>Service / region</th><th>Current → proposed</th><th>Monthly opportunity</th><th>Risk / confidence</th><th>Status</th><th></th></tr></thead><tbody>
      {filtered.map((item) => { const resource = resourceById.get(item.resourceId); return <tr key={item.id}><td><div className="font-semibold text-slate-800">{item.resourceName}</div><div className="font-mono text-[10px] text-slate-400">{item.id}</div></td><td>{resource?.service ?? "—"}<div className="text-[10px] text-slate-400">{resource?.region ?? "—"}</div></td><td><span className="font-mono">{item.current} → {item.recommended}</span></td><td className="font-semibold text-emerald-700">{money(item.savings)}</td><td>{item.risk} · {item.confidence}%</td><td>{item.status}</td><td><button className="btn btn-ghost !min-h-8 !px-2.5 text-[11px]" onClick={() => navigate(`/recommendations/${item.id}`)}>Review <ArrowRight size={13} /></button></td></tr>; })}
      {recommendations.length > 0 && filtered.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-sm text-slate-500">No recommendations match these filters.</td></tr>}
      {recommendations.length === 0 && !error && <tr><td colSpan={7} className="py-10 text-center text-sm text-slate-500">Loading recommendation data…</td></tr>}
    </tbody></table></div></section>
  </div>;
}

export function SimulatorWorkspacePage({ onSave }: { onSave: (selectedIds: string[]) => Promise<void> }) {
  const [recommendations, setRecommendations] = useState<RecommendationRecord[]>([]);
  const [resources, setResources] = useState<ResourceRecord[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [simulations, setSimulations] = useState<Awaited<ReturnType<typeof api.simulations>>>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void Promise.all([api.recommendations(), api.resources(), api.simulations()]).then(([nextRecommendations, nextResources, nextSimulations]) => {
      setRecommendations(nextRecommendations.filter((item) => item.status !== "Rejected"));
      setResources(nextResources);
      setSimulations(nextSimulations);
      setSelected(nextRecommendations.filter((item) => item.status !== "Rejected").slice(0, 6).map((item) => item.id));
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load simulation inputs."));
  }, []);
  const byId = new Map(recommendations.map((item) => [item.id, item]));
  const selectedRecommendations = selected.map((id) => byId.get(id)).filter((item): item is RecommendationRecord => Boolean(item));
  const baseline = resources.reduce((sum, item) => sum + item.monthlyCost, 0);
  const monthlySavings = selectedRecommendations.reduce((sum, item) => sum + item.savings, 0);
  const projected = Math.max(0, baseline - monthlySavings);
  const save = async () => {
    setSaving(true);
    try {
      await onSave(selected);
      setSimulations(await api.simulations());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the simulation.");
    } finally {
      setSaving(false);
    }
  };
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  return <div className="page-wrap fade-up">
    <div className="mb-6"><div className="eyebrow mb-2">Scenario planning · Demo only</div><h1 className="page-title">Rightsizing What-If Simulator</h1><p className="page-subtitle mt-2">Model potential monthly impact from backend recommendation estimates; simulation never modifies AWS.</p></div>
    <div className="mb-5 flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50/70 p-3.5 text-xs text-blue-900"><FlaskConical size={15} className="mt-0.5 shrink-0 text-blue-600" /><span><strong>Simulation only:</strong> all costs and recommendations are synthetic demo fixtures. No AWS resources are read or modified.</span></div>
    {error && <div role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
    <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4"><Metric label="Synthetic monthly baseline" value={money(baseline)} /><Metric label="Selected recommendations" value={`${selected.length}`} /><Metric label="Estimated monthly opportunity" value={money(monthlySavings)} /><Metric label="Projected monthly cost" value={money(projected)} /></div>
    <section className="card overflow-hidden"><div className="border-b border-slate-100 p-5"><h2 className="font-semibold text-slate-800">Scenario recommendations</h2><p className="mt-1 text-xs text-slate-500">Select opportunities to include in this persisted scenario.</p></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Include</th><th>Resource</th><th>Configuration</th><th>Risk</th><th>Monthly estimate</th></tr></thead><tbody>
      {recommendations.map((item) => <tr key={item.id}><td><input type="checkbox" aria-label={`Include ${item.resourceName}`} checked={selected.includes(item.id)} onChange={() => toggle(item.id)} /></td><td><div className="font-semibold text-slate-800">{item.resourceName}</div><div className="text-[10px] text-slate-400">{resources.find((resource) => resource.id === item.resourceId)?.region ?? "—"}</div></td><td><span className="font-mono">{item.current} → {item.recommended}</span></td><td>{item.risk}</td><td className="font-semibold text-emerald-700">{money(item.savings)}</td></tr>)}
      {!recommendations.length && !error && <tr><td colSpan={5} className="py-8 text-center text-sm text-slate-500">Loading recommendation inputs…</td></tr>}
    </tbody></table></div><div className="flex justify-end border-t border-slate-100 p-4"><button className="btn btn-primary" onClick={() => void save()} disabled={saving || !selected.length}>{saving ? "Saving…" : "Save simulation"}</button></div></section>
    <section className="card mt-5 overflow-hidden"><div className="border-b border-slate-100 p-5"><h2 className="font-semibold text-slate-800">Saved scenarios</h2><p className="mt-1 text-xs text-slate-500">Persisted simulation snapshots from the workspace API.</p></div>{simulations.length ? <div className="divide-y divide-slate-100">{simulations.map((simulation) => <div className="flex flex-wrap items-center justify-between gap-2 p-4" key={simulation.id}><div><div className="text-sm font-semibold text-slate-700">{simulation.name}</div><div className="text-[10px] text-slate-400">{new Date(simulation.createdAt).toLocaleString()} · {simulation.recommendationIds.length} recommendations</div></div><div className="text-right"><div className="text-xs font-semibold text-emerald-700">{money(simulation.monthlySavings)} / month</div><div className="text-[10px] text-slate-400">Projected cost {money(simulation.optimizedSpend)}</div></div></div>)}</div> : <div className="p-6 text-center text-sm text-slate-500">No simulations saved yet.</div>}</section>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="card p-4"><div className="eyebrow !text-[9px]">{label}</div><div className="mt-2 text-sm font-semibold text-slate-800">{value}</div></div>;
}
