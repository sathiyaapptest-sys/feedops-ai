import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, MapPin, AlertCircle, CheckCircle2, Loader2, Terminal } from 'lucide-react';
import { motion } from 'framer-motion';

import { api } from '@/lib/api';

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

function slugify(name: string): string {
  const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return `${base || 'store'}-${Math.random().toString(36).slice(2, 7)}`;
}

export const MerchantOnboardingCard: React.FC = () => {
  const [storeName, setStoreName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState({ lat: 37.7749, lng: -122.4194 });

  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [runError, setRunError] = useState<string | null>(null);

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  const flaggedForReview = events.some((e) => e.status === 'flagged' && e.stage === 'hitl_triage');
  const needsGbpDraft = events.some((e) => e.stage === 'gbp_generation');
  const completedAllSteps = events.some((e) => e.stage === 'conversion_health');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeName || !address) return;

    setRunning(true);
    setRunError(null);
    setEvents([]);

    try {
      await api.onboardMerchant(
        {
          store_id: slugify(storeName),
          name: storeName,
          address,
          telephone: phone || undefined,
          latitude: pin.lat,
          longitude: pin.lng,
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
          Runs the real EntityMatcher &rarr; SchemaAuditor &rarr; ConversionSentry pipeline live.
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

      {completedAllSteps && !flaggedForReview && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 p-4 rounded-lg flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span className="font-medium text-sm">Onboarding pipeline complete.</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        {/* Dropzone -- menu/CSV upload lives on the Menu page; this is visual context only */}
        <div className="border-2 border-dashed border-border rounded-lg p-8 flex flex-col items-center justify-center text-center hover:bg-accent/50 transition-colors">
          <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4">
            <UploadCloud className="w-6 h-6" />
          </div>
          <p className="text-sm font-medium">Drag & drop printed menu photos or CSV</p>
          <p className="text-xs text-muted-foreground mt-1">Use the Menu page to upload -- this onboards the store itself</p>
        </div>

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
          <div className="space-y-1.5 col-span-2">
            <label className="text-sm font-medium">Phone</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="+15551234567"
            />
          </div>
        </div>

        {/* Map Adjuster */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Location Pin Adjuster</label>
            <span className="text-xs text-muted-foreground font-mono">{pin.lat.toFixed(4)}, {pin.lng.toFixed(4)}</span>
          </div>
          <div className="h-48 w-full bg-accent/30 rounded-lg border border-border relative overflow-hidden flex items-center justify-center">
            <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, currentColor 1px, transparent 0)', backgroundSize: '24px 24px' }}></div>
            <motion.div
              drag
              dragConstraints={{ top: -80, left: -250, right: 250, bottom: 80 }}
              onDrag={(_, info) => {
                setPin((p) => ({ lat: p.lat - info.delta.y * 0.0001, lng: p.lng + info.delta.x * 0.0001 }));
              }}
              className="cursor-grab active:cursor-grabbing z-10 text-primary flex flex-col items-center"
            >
              <div className="bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5 rounded shadow-sm mb-1 pointer-events-none">Drag to adjust</div>
              <MapPin className="w-8 h-8 fill-primary text-background drop-shadow-md" />
            </motion.div>
          </div>
        </div>

        <button
          type="submit"
          disabled={running || !storeName || !address}
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
