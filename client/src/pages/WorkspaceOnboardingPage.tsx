import { useState, type ReactNode } from "react";
import { Activity, ArrowRight, Check, Cloud, Database, Gauge, Layers3, LockKeyhole } from "lucide-react";
import { api, type SessionUser } from "../lib/api";

type Props = {
  user: SessionUser;
  onUserUpdated: (user: SessionUser) => void;
  navigate: (path: string) => void;
};

export function WorkspaceOnboardingPage({ user, onUserUpdated, navigate }: Props) {
  const [workspaceName, setWorkspaceName] = useState(user.workspaceName || `${user.name}'s Workspace`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const exploreDemo = async () => {
    setBusy(true);
    setError("");
    try {
      const { user: updatedUser } = await api.updateWorkspace({
        workspaceName: workspaceName.trim(),
        environmentMode: "demo",
      });
      onUserUpdated(updatedUser);
      navigate("/overview");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not initialize the workspace.");
    } finally {
      setBusy(false);
    }
  };

  const connectAws = async () => {
    setBusy(true);
    setError("");
    try {
      await api.connectAws();
      const { user: updatedUser } = await api.updateWorkspace({
        workspaceName: workspaceName.trim(),
        environmentMode: "aws",
      });
      onUserUpdated(updatedUser);
      navigate("/overview");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "AWS connection is unavailable.");
    } finally {
      setBusy(false);
    }
  };

  const chooseManual = async () => {
    setBusy(true);
    setError("");
    try {
      const { user: updatedUser } = await api.updateWorkspace({
        workspaceName: workspaceName.trim(),
        environmentMode: "manual",
      });
      onUserUpdated(updatedUser);
      navigate("/manual");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not initialize Manual Analysis.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f5f7fa] px-4 py-10 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#172535] text-[#ffad32]"><Cloud size={20} /></span>
          <span className="text-lg font-semibold tracking-tight text-slate-900">SmartSize</span>
        </div>
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="grid lg:grid-cols-[1.2fr_.8fr]">
            <div className="p-7 sm:p-10">
              <div className="mb-3 text-[11px] font-bold uppercase tracking-[.16em] text-orange-700">Workspace setup</div>
              <h1 className="max-w-xl text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Welcome to SmartSize, {user.name.split(" ")[0]}.</h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-slate-600">Choose how to analyze your infrastructure: connect AWS, enter resource details for a SmartSize estimate, or explore a separate Demo Environment.</p>
              <label className="mt-7 block max-w-md text-xs font-semibold text-slate-700" htmlFor="workspace-name">Workspace name
                <input id="workspace-name" className="input mt-2" maxLength={120} value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} />
              </label>
              {error && <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">{error}</div>}
              <div className="mt-7 grid gap-3">
                <button className="btn btn-primary justify-center py-3" onClick={() => void connectAws()} disabled={busy}>
                  <Cloud size={15} /> Connect AWS
                </button>
                <button className="btn btn-ghost justify-center py-3" onClick={() => void chooseManual()} disabled={busy || workspaceName.trim().length < 2}>
                  <Database size={15} /> Manual Analysis
                </button>
                <button className="btn btn-ghost justify-center py-3" onClick={() => void exploreDemo()} disabled={busy || workspaceName.trim().length < 2}>
                  Explore Demo Environment <ArrowRight size={15} />
                </button>
              </div>
              <div className="mt-4 flex items-start gap-2 text-[11px] leading-5 text-slate-500"><LockKeyhole size={13} className="mt-0.5 shrink-0" /> AWS credentials are never requested in this screen. Connect succeeds only after the backend verifies its AWS identity with STS.</div>
            </div>
            <aside className="border-t border-slate-100 bg-slate-50 p-7 sm:p-10 lg:border-l lg:border-t-0">
              <div className="text-xs font-bold uppercase tracking-[.14em] text-slate-500">AWS environment</div>
              <div className="mt-4 flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><Cloud size={18} /></span>
                <div><div className="text-sm font-semibold text-slate-800">Backend verification required</div><div className="mt-1 text-xs text-slate-500">Credentials are resolved outside the browser</div></div>
              </div>
              <div className="mt-7 text-xs font-semibold text-slate-700">What SmartSize can analyze</div>
              <div className="mt-3 space-y-2">
                {[
                  { label: "EC2 and EBS inventory", icon: <Layers3 size={15} /> },
                  { label: "Compute Optimizer", icon: <Gauge size={15} /> },
                  { label: "CloudWatch utilization", icon: <Activity size={15} /> },
                  { label: "Cost and usage data", icon: <Database size={15} /> },
                ].map(({ label, icon }) => <div className="flex items-center gap-2.5 text-xs text-slate-600" key={label}><span className="text-slate-400">{icon as ReactNode}</span>{label}</div>)}
              </div>
              <div className="mt-7 rounded-lg border border-blue-100 bg-blue-50 p-3 text-[11px] leading-5 text-blue-900"><Check size={13} className="mr-1 inline" /> AWS is optional. Manual Analysis works without cloud credentials; Demo remains a separate illustrative environment.</div>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
