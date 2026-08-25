import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { UploadCloud, AlertCircle, CheckCircle2, Loader2, Terminal } from 'lucide-react';

import { api } from '@/lib/api';
import { auth } from '@/lib/firebase';

interface AgentEvent {
  agent_name: string;
  stage: string;
  status: 'thinking' | 'calling_tool' | 'completed' | 'flagged';
  detail: string;
  payload?: Record<string, unknown>;
}

const STATUS_STYLES: Record<AgentEvent['status'], string> = {
  thinking: 'text-purple-300',
  calling_tool: 'text-sky-300',
  completed: 'text-emerald-300',
  flagged: 'text-amber-300',
};

export const MerchantOnboardingCard: React.FC = () => {
  const [storeName, setStoreName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');

  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [runError, setRunError] = useState<string | null>(null);

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  // Pre-fill from the signed-in account -- store_id is always this email
  // server-side regardless of what's typed here, so defaulting to it avoids
  // a merchant accidentally onboarding under a different address than the
  // one My Store/Services will actually read back.
  useEffect(() => {
    if (auth.currentUser?.email) setEmail((prev) => prev || auth.currentUser!.email!);
  }, []);

  const flaggedForReview = events.some((e) => e.status === 'flagged' && e.stage === 'hitl_triage');
  const needsGbpDraft = events.some((e) => e.stage === 'gbp_generation');
  const entityMatchDone = !running && events.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeName || !address || !email) return;

    setRunning(true);
    setRunError(null);
    setEvents([]);

    try {
      await api.onboardMerchant(
        {
          name: storeName,
          address,
          telephone: phone || undefined,
          email,
        },
        (event) => setEvents((prev) => [...prev, event])
      );
    } catch (err: any) {
      setRunError(err.message || 'Onboarding failed.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="bg-card text-card-foreground rounded-xl border border-border shadow-sm p-6 w-full max-w-2xl mx-auto flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Merchant Onboarding</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Runs the real EntityMatcherAgent live to find your Google Business Profile.
          Add your hours and menu in My Store, then run schema &amp; conversion checks
          in Services.
        </p>
      </div>

      {needsGbpDraft && (
        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 p-4 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
          <div className="flex-1">
            <h4 className="font-semibold text-sm">Missing Google Business Profile</h4>
            <p className="text-xs mt-1 opacity-90">
              No Places match found. EntityMatcherAgent drafted a Google Business Profile onboarding
              record below -- see the agent stream for details.
            </p>
          </div>
        </div>
      )}

      {flaggedForReview && (
        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 p-4 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="font-medium text-sm">Staged in HITL Review Queue -- match confidence below 90%.</span>
        </div>
      )}

      {entityMatchDone && !flaggedForReview && !needsGbpDraft && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 p-4 rounded-lg flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span className="font-medium text-sm">Google Business Profile matched.</span>
          </div>
          <Link to="/merchant/store" className="text-sm font-medium underline underline-offset-2 ml-8">
            Continue to My Store &rarr; add hours, lead time &amp; service types
          </Link>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        {/* This used to be styled as a dropzone (dashed border, "Drag & drop
            here" text) but had no onDrop/file input behind it at all -- a
            drag onto it silently did nothing. It was only ever meant to
            point at the real Menu page, so it's a real link now instead of
            an affordance that looked functional but wasn't. */}
        <Link
          to="/merchant/menu"
          className="flex items-center gap-3 p-4 rounded-lg border border-border bg-accent/30 hover:bg-accent/50 transition-colors"
        >
          <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
            <UploadCloud className="w-5 h-5" />
          </div>
          <div className="text-left">
            <p className="text-sm font-medium">Have a printed menu to upload?</p>
            <p className="text-xs text-muted-foreground mt-0.5">Go to the Menu page &rarr; that's where photo/CSV uploads actually happen.</p>
          </div>
        </Link>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5 col-span-2">
            <label className="text-sm font-medium">Store Name</label>
            <input
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              required
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="e.g. Joe's Pizza"
            />
          </div>
          <div className="space-y-1.5 col-span-2">
            <label className="text-sm font-medium">Address</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              required
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="123 Main St..."
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Phone</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="+15551234567"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="owner@store.com"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={running || !storeName || !address || !email}
          className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-2.5 rounded-md transition-colors mt-2 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {running ? 'Running agent pipeline...' : 'Save & Onboard'}
        </button>
      </form>

      {runError && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-3 rounded-lg text-sm">
          {runError}
        </div>
      )}

      {events.length > 0 && (
        <div className="bg-slate-900 rounded-xl border border-slate-700 p-4 flex flex-col max-h-80">
          <div className="flex items-center gap-2 mb-3 border-b border-slate-700 pb-2">
            <Terminal className="w-4 h-4 text-green-400" />
            <h3 className="text-sm font-mono text-green-400">Agent Stream</h3>
          </div>
          <div ref={logRef} className="flex-1 overflow-y-auto font-mono text-xs space-y-1.5">
            {events.map((evt, i) => (
              <div key={i} className={STATUS_STYLES[evt.status]}>
                <span className="text-slate-500">[{evt.agent_name}]</span> {evt.detail}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
