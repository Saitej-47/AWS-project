import { ArrowDown, BarChart3, BrainCircuit, Cloud, Gauge, GitBranch, ShieldCheck, Sparkles, UserRoundCheck } from 'lucide-react';

const steps = [
  { label: 'AWS Resources', detail: 'Inventory', icon: Cloud, tone: 'slate' },
  { label: 'Utilization Data', detail: 'CloudWatch signals', icon: Gauge, tone: 'blue' },
  { label: 'AWS Compute Optimizer', detail: 'Recommendations', icon: GitBranch, tone: 'orange' },
  { label: 'SmartSize Analysis', detail: 'Prioritization + explanation', icon: BrainCircuit, tone: 'purple' },
  { label: 'Cost + Risk Analysis', detail: 'Financial impact', icon: BarChart3, tone: 'green' },
  { label: 'Human Review', detail: 'Controlled decision', icon: UserRoundCheck, tone: 'ink' },
];

export function ProductWorkflow() {
  return <section className="card workflow-card mb-6 overflow-hidden p-5" aria-labelledby="workflow-title">
    <div className="flex items-start justify-between gap-4 mobile-stack">
      <div><div className="eyebrow">Decision-support architecture</div><h2 id="workflow-title" className="mt-1 font-semibold tracking-tight text-slate-800">How SmartSize works</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">AWS remains the source of infrastructure and optimization signals. SmartSize adds analysis, policy, explainable prioritization, and human review around that data.</p></div>
      <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[10px] font-semibold text-slate-500"><ShieldCheck size={13} className="text-emerald-600" /> Read-only analysis</div>
    </div>
    <div className="workflow-steps" role="list" aria-label="SmartSize workflow">
      {steps.map((step, index) => { const Icon = step.icon; return <div key={step.label} className="workflow-step-wrap" role="listitem"><div className={`workflow-step tone-${step.tone}`}><span className="workflow-icon"><Icon size={15} /></span><span><strong>{step.label}</strong><small>{step.detail}</small></span></div>{index < steps.length - 1 && <ArrowDown className="workflow-connector" size={14} aria-hidden="true" />}</div>; })}
    </div>
    <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3 text-[10px] text-slate-400"><Sparkles size={12} className="text-orange-500" /> Optional AWS action is future-state only and always follows human approval.</div>
  </section>;
}
