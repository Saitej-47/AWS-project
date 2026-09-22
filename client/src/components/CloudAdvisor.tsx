import { useState } from 'react';
import { ArrowRight, Bot, Check, ChevronRight, Sparkles, X } from 'lucide-react';

type Props = { open: boolean; onClose: () => void; toast: (title: string, body: string, tone?: 'success' | 'info') => void };

const questions = ['Why is this resource over-provisioned?', 'How much can we potentially save?', 'Which resources should I review first?', 'Explain this recommendation.', 'What if I applied these recommendations?'];

export function CloudAdvisor({ open, onClose, toast }: Props) {
  const [question, setQuestion] = useState('');
  if (!open) return null;
  const submit = (value: string) => { setQuestion(value); toast('Cloud Advisor preview', 'This mock response is grounded in the demo resource and recommendation dataset.'); };
  return <div className="advisor-backdrop" role="presentation" onClick={onClose}><aside className="advisor-panel" role="dialog" aria-modal="true" aria-labelledby="advisor-title" onClick={(event) => event.stopPropagation()}>
    <div className="advisor-header"><div className="flex items-center gap-2"><span className="advisor-mark"><Sparkles size={15} /></span><div><h2 id="advisor-title" className="text-sm font-semibold text-slate-800">Cloud Advisor</h2><p className="mt-0.5 text-[10px] text-slate-400">Grounded in your workspace data</p></div></div><button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close Cloud Advisor"><X size={17} /></button></div>
    <div className="advisor-body"><div className="advisor-intro"><span className="advisor-bot"><Bot size={17} /></span><div><div className="text-xs font-semibold text-slate-700">Ask about your optimization opportunities.</div><p className="mt-1 text-[11px] leading-5 text-slate-500">I’ll use the resources, recommendations and cost signals already available in SmartRightsize.</p></div></div><div className="advisor-questions"><div className="eyebrow !text-[9px]">Suggested questions</div>{questions.map((item) => <button key={item} onClick={() => submit(item)} className="advisor-question">{item}<ChevronRight size={13} /></button>)}</div>{question && <div className="advisor-response"><div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.08em] text-emerald-700"><Check size={12} /> Demo analysis</div><p className="mt-2 text-xs leading-5 text-slate-600">Based on the current simulated dataset, <strong>{question.toLowerCase()}</strong> can be answered by reviewing low-utilization signals, projected monthly savings, confidence and risk together. Open the relevant recommendation to inspect the evidence before any approval.</p><button className="mt-3 flex items-center gap-1 text-[10px] font-bold text-orange-600" onClick={() => { onClose(); toast('Advisor handoff', 'Open Recommendations to continue the human review workflow.'); }}>Continue to recommendations <ArrowRight size={12} /></button></div>}</div>
    <div className="advisor-footer"><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Mock response mode</span><span>Backend-ready interface</span></div>
  </aside></div>;
}
