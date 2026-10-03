import { useState } from 'react';
import { ArrowRight, Bot, Check, ChevronRight, LoaderCircle, Sparkles, X } from 'lucide-react';
import { api } from '../lib/api';

type Props = { open: boolean; onClose: () => void; toast: (title: string, body: string, tone?: 'success' | 'info') => void };

const questions = ['Why is this resource over-provisioned?', 'How much can we potentially save?', 'Which resources should I review first?', 'Explain this recommendation.', 'What if I applied these recommendations?'];

export function CloudAdvisor({ open, onClose, toast }: Props) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [mode, setMode] = useState<'openai' | 'demo-grounded' | null>(null);
  const [loading, setLoading] = useState(false);
  if (!open) return null;
  const submit = async (value: string) => {
    setQuestion(value);
    setAnswer('');
    setLoading(true);
    try {
      const response = await api.advisor(value);
      setAnswer(response.answer);
      setMode(response.mode);
    } catch (error) {
      toast('Advisor unavailable', error instanceof Error ? error.message : 'The AI Advisor could not answer right now.');
    } finally {
      setLoading(false);
    }
  };
  return <div className="advisor-backdrop" role="presentation" onClick={onClose}><aside className="advisor-panel" role="dialog" aria-modal="true" aria-labelledby="advisor-title" onClick={(event) => event.stopPropagation()}>
    <div className="advisor-header"><div className="flex items-center gap-2"><span className="advisor-mark"><Sparkles size={15} /></span><div><h2 id="advisor-title" className="text-sm font-semibold text-slate-800">Cloud Advisor</h2><p className="mt-0.5 text-[10px] text-slate-400">Grounded in your workspace data</p></div></div><button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close Cloud Advisor"><X size={17} /></button></div>
    <div className="advisor-body"><div className="advisor-intro"><span className="advisor-bot"><Bot size={17} /></span><div><div className="text-xs font-semibold text-slate-700">Ask SmartSize AI about your cloud.</div><p className="mt-1 text-[11px] leading-5 text-slate-500">Answers are grounded in the resources and recommendations available in this workspace.</p></div></div><div className="advisor-questions"><div className="eyebrow !text-[9px]">Suggested questions</div>{questions.map((item) => <button key={item} onClick={() => void submit(item)} className="advisor-question" disabled={loading}>{item}<ChevronRight size={13} /></button>)}</div>{question && <div className="advisor-response"><div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.08em] text-emerald-700">{loading ? <LoaderCircle className="animate-spin" size={12} /> : <Check size={12} />} {loading ? 'Analyzing workspace data' : mode === 'openai' ? 'SmartSize AI' : 'Demo-grounded analysis'}</div><p className="mt-2 text-xs leading-5 text-slate-600">{answer || 'Preparing an answer from the verified SmartSize dataset…'}</p><button className="mt-3 flex items-center gap-1 text-[10px] font-bold text-orange-600" onClick={() => { onClose(); toast('Advisor handoff', 'Open Recommendations to continue the human review workflow.'); }}>Continue to recommendations <ArrowRight size={12} /></button></div>}</div>
    <div className="advisor-footer"><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {mode === 'openai' ? 'Backend AI mode' : 'Demo-grounded mode'}</span><span>AWS changes require approval</span></div>
  </aside></div>;
}
