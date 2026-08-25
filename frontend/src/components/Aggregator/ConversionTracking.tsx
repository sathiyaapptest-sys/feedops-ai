import { useEffect, useState, useCallback } from 'react';
import { api } from '../../lib/api';
import { Radio, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

interface ConversionCheck {
  check_id: string;
  environment: string;
  timestamp: string;
  tokens_pinged: number;
  successful_pings: number;
  all_ok: boolean;
}

function formatWhen(ts?: string) {
  if (!ts) return 'unknown time';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return 'unknown time';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ConversionTracking() {
  const [checks, setChecks] = useState<ConversionCheck[] | null>(null);
  const [compliant, setCompliant] = useState(false);
  const [eventsInWindow, setEventsInWindow] = useState(0);
  const [minRequired, setMinRequired] = useState(3);
  const [windowDays, setWindowDays] = useState(7);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getConversionChecks();
      setChecks(res.checks || []);
      setCompliant(res.compliant);
      setEventsInWindow(res.events_in_window || 0);
      if (res.min_events_required) setMinRequired(res.min_events_required);
      if (res.window_days) setWindowDays(res.window_days);
      if (res.error) setError(res.error);
    } catch (err: any) {
      setError(err.message || 'Could not load conversion tracking.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRun = async () => {
    setRunning(true);
    setRunResult(null);
    try {
      const summary = await api.triggerConversionCheck('sandbox');
      if (summary.error) {
        setRunResult(`Could not run conversion check: ${summary.error} Set it under API & Webhooks.`);
      } else {
        setRunResult(
          summary.all_ok
            ? `Conversion check passed: ${summary.successful_pings}/${summary.tokens_pinged} token(s) accepted.`
            : `Conversion check had failures -- see results below.`
        );
      }
      await load();
    } catch (err: any) {
      setRunResult(`Failed to run conversion check: ${err.message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 md:col-span-2">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-3">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <Radio className="w-5 h-5 text-blue-500" />
          Conversion Tracking
        </h2>
        <button
          onClick={handleRun}
          disabled={running}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition-colors"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radio className="w-4 h-4" />}
          Run Conversion Check
        </button>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
        Google requires at least {minRequired} conversion events every {windowDays} days per environment to keep
        launch eligibility -- dispatches synthetic rwg_token pings, not real customer conversions.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg text-sm">
          {error}
        </div>
      )}
      {runResult && (
        <div className="mb-4 p-3 bg-slate-50 dark:bg-slate-900/40 text-slate-700 dark:text-slate-300 rounded-lg text-sm">
          {runResult}
        </div>
      )}

      <div
        className={`mb-4 p-3 rounded-lg text-sm flex items-center gap-2 ${
          compliant
            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
            : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
        }`}
      >
        {compliant ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
        {compliant
          ? `Compliant -- ${eventsInWindow} event(s) in the last ${windowDays} days (need ${minRequired}).`
          : `Not compliant -- only ${eventsInWindow} event(s) in the last ${windowDays} days (need ${minRequired}). Run a check now.`}
      </div>

      {checks === null ? (
        <div className="h-16 animate-pulse bg-slate-100 dark:bg-slate-700 rounded-lg" />
      ) : checks.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No conversion checks recorded yet.</p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {checks.map((c) => (
            <div
              key={c.check_id}
              className="flex items-center justify-between gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 text-sm"
            >
              <div className="flex items-center gap-3">
                {c.all_ok ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                )}
                <div>
                  <p className="font-medium text-slate-900 dark:text-white">
                    {c.check_id} <span className="text-slate-400 font-normal">({c.environment})</span>
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {formatWhen(c.timestamp)} -- {c.successful_pings}/{c.tokens_pinged} succeeded
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
