import { useState } from "react";
import { Cloud, Save } from "lucide-react";
import { api, type SessionUser } from "../lib/api";

type Props = {
  user: SessionUser;
  onUserUpdated: (user: SessionUser) => void;
  toast: (title: string, body: string, tone?: "success" | "info") => void;
};

export function WorkspaceSettingsPage({ user, onUserUpdated, toast }: Props) {
  const [workspaceName, setWorkspaceName] = useState(user.workspaceName);
  const [environmentMode, setEnvironmentMode] = useState<'demo' | 'manual' | 'aws'>(user.environmentMode ?? 'demo');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const { user: updated } = await api.updateWorkspace({ workspaceName, environmentMode });
      onUserUpdated(updated);
      toast("Workspace updated", "Workspace details and analysis environment have been saved.", "success");
    } catch (reason) {
      toast("Could not save workspace", reason instanceof Error ? reason.message : "The workspace update failed.");
    } finally {
      setSaving(false);
    }
  };

  return <div className="page-wrap fade-up">
    <div className="mb-7"><div className="eyebrow mb-2">Workspace configuration</div><h1 className="page-title">Settings</h1><p className="page-subtitle mt-2">Manage workspace identity and cloud connection posture.</p></div>
    <div className="grid gap-5 lg:grid-cols-[1fr_.8fr]">
      <section className="card p-6">
        <div className="eyebrow">Workspace profile</div>
        <label className="mt-4 block max-w-lg text-xs font-semibold text-slate-700" htmlFor="settings-workspace-name">Workspace name
          <input id="settings-workspace-name" className="input mt-2" maxLength={120} value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} />
        </label>
        <label className="mt-4 block max-w-lg text-xs font-semibold text-slate-700">Analysis environment
          <select className="input mt-2" value={environmentMode} onChange={(event) => setEnvironmentMode(event.target.value as 'demo' | 'manual' | 'aws')}>
            <option value="manual">Manual Analysis</option>
            <option value="demo">Demo Environment</option>
            <option value="aws">AWS Environment (requires verified connection)</option>
          </select>
        </label>
        <button className="btn btn-primary mt-4" onClick={() => void save()} disabled={saving || workspaceName.trim().length < 2}><Save size={14} /> Save workspace</button>
      </section>
      <section className="card p-6">
        <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Cloud size={17} /></span><div><h2 className="font-semibold text-slate-900">Optional AWS connection</h2><p className="mt-1 text-xs text-slate-500">{user.environmentMode === 'aws' ? 'AWS workspace selected' : 'AWS is not required'}</p></div></div>
        <p className="mt-4 text-sm leading-6 text-slate-600">Connect through the backend credential chain to verify account identity and inspect service permissions. AWS credentials are never requested in the browser.</p>
        <a href="/aws" className="btn btn-ghost mt-4">Open AWS connection settings</a>
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">Manual Analysis works without AWS. Demo data and manual estimates remain distinct from real AWS data.</div>
      </section>
    </div>
  </div>;
}
