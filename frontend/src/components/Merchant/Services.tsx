import { useEffect, useRef, useState } from 'react';
import { Settings, Terminal, CheckCircle2, AlertCircle, Loader2, FileJson } from 'lucide-react';
import { api } from '@/lib/api';

interface AgentEvent {
  agent_name: string;
  stage: string;
  status: 'thinking' | 'calling_tool' | 'completed' | 'flagged';
  detail: string;
  payload?: Record<string, any>;
}

const STATUS_STYLES: Record<AgentEvent['status'], string> = {
  thinking: 'text-purple-300',
  calling_tool: 'text-sky-300',
  completed: 'text-emerald-300',
  flagged: 'text-amber-300',
};

const FEED_LABELS: Record<string, string> = {
  entity: 'Entity Feed',
  action: 'Action Feed',
  service: 'Service Feed',
};

export function Services() {
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [feedContents, setFeedContents] = useState<Record<string, any> | null>(null);
  const [conversionHealth, setConversionHealth] = useState<Record<string, any> | null>(null);
  const [compiledAt, setCompiledAt] = useState<string | null>(null);
  const [activeFeed, setActiveFeed] = useState<string>('entity');

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  // On mount, load whatever was last actually compiled, so revisiting this
  // page shows real prior output instead of a blank slate.
  useEffect(() => {
    api.getMerchantAudit().then((res) => {
      if (res.status === 'success' && res.compiled_feeds) {
        setFeedContents(res.compiled_feeds);
        setConversionHealth(res.conversion_health || null);
        if (res.feeds_compiled_at) setCompiledAt(String(res.feeds_compiled_at));
        const firstKey = Object.keys(res.compiled_feeds).find((k) => !k.endsWith('_descriptor'));
        if (firstKey) setActiveFeed(firstKey);
      }
    });
  }, []);

  const handleRunAudit = async () => {
    setRunning(true);
    setRunError(null);
    setEvents([]);

    try {
      await api.auditMerchant((event: AgentEvent) => {
        setEvents((prev) => [...prev, event]);
        if (event.stage === 'schema_compilation' && event.payload?.feed_contents) {
          const contents = event.payload.feed_contents as Record<string, any>;
          setFeedContents(contents);
          setCompiledAt(new Date().toISOString());
          const firstKey = Object.keys(contents).find((k) => !k.endsWith('_descriptor'));
          if (firstKey) setActiveFeed(firstKey);
        }
        if (event.stage === 'conversion_health' && event.payload) {
          setConversionHealth(event.payload);
        }
      });
    } catch (err: any) {
      setRunError(err.message || 'Audit failed.');
    } finally {
      setRunning(false);
    }
  };

  const fileKeys = feedContents ? Object.keys(feedContents).filter((k) => !k.endsWith('_descriptor')) : [];
  const schemaFlagged = events.some((e) => e.stage === 'schema_compilation' && e.status === 'flagged');
  const conversionFlagged = events.some((e) => e.stage === 'conversion_health' && e.status === 'flagged');

  return (
    <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Left Column: Trigger + status */}
      <div className="space-y-6">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-200 dark:border-slate-700">
          <Settings className="w-6 h-6 text-green-500" />
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Service Settings</h1>
        </div>

        <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-6">
          <div className="p-4 border border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <span className="text-sm font-semibold text-slate-900 dark:text-white block">Google Ordering Redirect</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Runs SchemaAuditorAgent (compiles &amp; audits your entity/action/service feed
              bundle) and ConversionSentryAgent (synthetic conversion ping) against your saved
              Store Profile, then shows you exactly what would be sent to Google.
            </span>
          </div>

          {schemaFlagged && (
            <div className="bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 p-3 rounded-lg flex items-center gap-2 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              Schema compilation flagged an issue -- see the agent stream for details.
            </div>
          )}
          {conversionFlagged && (
            <div className="bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 p-3 rounded-lg flex items-center gap-2 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              Conversion ping unavailable -- see the agent stream for details.
            </div>
          )}
          {feedContents && !running && !schemaFlagged && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 p-3 rounded-lg flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              {compiledAt ? `Feeds compiled ${new Date(compiledAt).toLocaleString()}.` : 'Feeds compiled.'}
            </div>
          )}
          {runError && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-3 rounded-lg text-sm">
              {runError}
            </div>
          )}

          <div className="pt-2 flex justify-end">
            <button
              onClick={handleRunAudit}
              disabled={running}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {running ? 'Running schema & conversion checks...' : 'Run Schema Audit & Conversion Check'}
            </button>
          </div>
        </div>

        {fileKeys.length > 0 && (
          <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2 mb-4">
              <FileJson className="w-5 h-5 text-blue-500" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Compiled Feed Output ({fileKeys.length} file{fileKeys.length === 1 ? '' : 's'})
              </h2>
            </div>
            <div className="flex gap-2 mb-3">
              {fileKeys.map((key) => (
                <button
                  key={key}
                  onClick={() => setActiveFeed(key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                    activeFeed === key
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-transparent text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  {FEED_LABELS[key] || key}
                </button>
              ))}
            </div>
            <pre className="bg-slate-900 text-slate-200 text-xs rounded-lg p-4 overflow-auto max-h-96">
              {JSON.stringify(feedContents?.[activeFeed] ?? {}, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* Right Column: Real agent stream */}
      <div className="lg:h-[calc(100vh-8rem)] flex flex-col gap-6">
        <div className="p-6 bg-slate-900 rounded-xl shadow-sm border border-slate-700 flex flex-col flex-1 min-h-[300px]">
          <div className="flex items-center gap-2 mb-4 border-b border-slate-700 pb-2">
            <Terminal className="w-5 h-5 text-green-400" />
            <h2 className="text-lg font-mono text-green-400">Agent Stream</h2>
          </div>
          <div ref={logRef} className="flex-1 overflow-y-auto font-mono text-sm space-y-1.5">
            {events.length === 0 ? (
              <p className="text-slate-500 italic">Run the audit to see SchemaAuditorAgent and ConversionSentryAgent work in real time.</p>
            ) : (
              events.map((evt, i) => (
                <div key={i} className={STATUS_STYLES[evt.status]}>
                  <span className="text-slate-500">[{evt.agent_name}]</span> {evt.detail}
                </div>
              ))
            )}
          </div>
        </div>

        {conversionHealth && (
          <div className="p-4 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
            <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wide">
              Conversion Health
            </h3>
            <pre className="bg-slate-900 text-slate-200 text-xs rounded-lg p-3 overflow-auto max-h-48">
              {JSON.stringify(conversionHealth, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
