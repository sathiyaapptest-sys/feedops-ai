import { useEffect, useState } from 'react';
import { FileJson, RefreshCw, Loader2, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../../lib/api';

const FEED_TABS = [
  { key: 'entity', label: '1. entity.json', descriptorKey: 'entity_descriptor' },
  { key: 'action', label: '2. actions.json', descriptorKey: 'action_descriptor' },
  { key: 'service', label: '3. services.json', descriptorKey: 'service_descriptor' },
];

// The bulk-roster equivalent of the merchant self-service Services page's
// "Compiled Proto Feed Inspector" -- compiles the exact JSON "Upload Now"
// would send, without touching SFTP, so a bad address/link/hours entry (or a
// malformed descriptor, like the missing data_file field this caught live)
// is visible before a real push, not after checking Partner Portal.
export function FeedPreview() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feeds, setFeeds] = useState<Record<string, any> | null>(null);
  const [merchantsPreviewed, setMerchantsPreviewed] = useState<number | null>(null);
  const [activeFeed, setActiveFeed] = useState('entity');
  const [descriptorExpanded, setDescriptorExpanded] = useState(true);
  const [dataExpanded, setDataExpanded] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.previewFeeds();
      if (res.status === 'success') {
        setFeeds(res.feeds || {});
        setMerchantsPreviewed(res.merchants_previewed ?? null);
        const firstReady = FEED_TABS.map((t) => t.key).find((k) => res.feeds?.[k]);
        if (firstReady) setActiveFeed(firstReady);
      } else {
        setFeeds(null);
        setError(res.message || 'Could not compile a preview.');
      }
    } catch (err: any) {
      setError(err.message || 'Could not compile a preview.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const activeTab = FEED_TABS.find((t) => t.key === activeFeed);
  const activeDescriptor = feeds && activeTab ? feeds[activeTab.descriptorKey] : null;

  return (
    <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <FileJson className="w-5 h-5 text-blue-500" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">
            Feed Preview -- Verify Before Upload
          </h2>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-600 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          <span>{loading ? 'Compiling...' : 'Recompile Preview'}</span>
        </button>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Compiles the exact JSON your current merchant roster would produce -- the same compile step "Upload Now"
        runs below -- without touching SFTP. Check this before pushing to catch a bad address, missing action link,
        or malformed service hours.
      </p>

      {error && (
        <div className="p-3 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 rounded-lg text-xs flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {feeds && (
        <>
          <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-700 pb-3">
            {FEED_TABS.map((tab) => {
              const isReady = Boolean(feeds[tab.key]);
              const rowCount = feeds[tab.key]?.data?.length;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveFeed(tab.key)}
                  className={`px-3.5 py-2 text-xs font-semibold rounded-xl border transition-all cursor-pointer flex items-center gap-2 ${
                    activeFeed === tab.key
                      ? 'bg-blue-600 text-white border-blue-600 shadow-sm ring-2 ring-blue-500/20'
                      : 'bg-slate-50 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold ${
                      isReady
                        ? activeFeed === tab.key
                          ? 'bg-white/20 text-white'
                          : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                        : activeFeed === tab.key
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-200 dark:bg-slate-600 text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {isReady ? `${rowCount} row${rowCount === 1 ? '' : 's'}` : 'not generated'}
                  </span>
                </button>
              );
            })}
          </div>

          {feeds[activeFeed] ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  {merchantsPreviewed ?? '?'} merchant(s) compiled into this roster
                </span>
              </div>

              {activeDescriptor && (
                <div className="space-y-1">
                  <button
                    onClick={() => setDescriptorExpanded((v) => !v)}
                    className="w-full flex items-center justify-between gap-2 text-left cursor-pointer group"
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300">
                      Descriptor -- {activeTab?.key}.filesetdesc.json
                    </span>
                    {descriptorExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    )}
                  </button>
                  {descriptorExpanded && (
                    <pre className="bg-slate-100 dark:bg-slate-900/70 text-slate-700 dark:text-slate-300 text-[11px] rounded-lg p-3 font-mono leading-relaxed border border-slate-200 dark:border-slate-700">
                      {JSON.stringify(activeDescriptor, null, 2)}
                    </pre>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <button
                  onClick={() => setDataExpanded((v) => !v)}
                  className="w-full flex items-center justify-between gap-2 text-left cursor-pointer group"
                >
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300">
                    Data -- {activeTab?.key}_*.json ({feeds[activeFeed]?.data?.length ?? 0} row{feeds[activeFeed]?.data?.length === 1 ? '' : 's'})
                  </span>
                  {dataExpanded ? (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 shrink-0">
                      Collapse <ChevronUp className="w-3.5 h-3.5" />
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 shrink-0">
                      Expand to view <ChevronDown className="w-3.5 h-3.5" />
                    </span>
                  )}
                </button>
                {dataExpanded && (
                  <pre className="bg-slate-950 text-slate-200 text-xs rounded-xl p-4 overflow-auto max-h-96 font-mono leading-relaxed border border-slate-800 shadow-inner">
                    {JSON.stringify(feeds[activeFeed], null, 2)}
                  </pre>
                )}
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40 text-center text-xs text-slate-500 dark:text-slate-400">
              No {activeFeed} feed for this roster (e.g. no merchant on file has a lead time set, so there's no
              service feed to send yet -- that's expected, not an error).
            </div>
          )}
        </>
      )}
    </div>
  );
}
