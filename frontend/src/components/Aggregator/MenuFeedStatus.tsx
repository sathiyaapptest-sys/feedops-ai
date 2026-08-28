import { useEffect, useState, useCallback } from 'react';
import { api } from '../../lib/api';
import { FileJson, CheckCircle2, XCircle } from 'lucide-react';

// Sibling of FeedStatus.tsx for the Menu Feeds track. Leaner deliberately --
// there's only one feed type ("menu"), so no per-feed-type list, and no
// screenshot assistant (not requested for this track). Reads
// api.getMenuFeedBatches (server-filtered to kind == "menu") so it can never
// pick up an Ordering Redirect batch by accident.

interface Batch {
  batch_id: string;
  environment: string;
  created_at?: string;
  [key: string]: any; // feed_status_menu, etc.
}

interface MenuFeedStatusProps {
  environment: 'sandbox' | 'production';
}

export function MenuFeedStatus({ environment }: MenuFeedStatusProps) {
  const [latest, setLatest] = useState<Batch | null | undefined>(undefined); // undefined = loading
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [feedContent, setFeedContent] = useState<Record<string, any> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getMenuFeedBatches(environment);
      const sorted = [...(res.batches || [])].sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      });
      setLatest(sorted[0] || null);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Could not load menu feed status.');
      setLatest(null);
    }
  }, [environment]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!latest?.batch_id) {
      setFeedContent(null);
      return;
    }
    api.getBatchFeedContent(latest.batch_id).then((res) => {
      if (res.status === 'ok') setFeedContent(res.feeds || {});
    });
  }, [latest?.batch_id]);

  const handleMark = async (status: 'confirmed_clean' | 'flagged_errors') => {
    if (!latest) return;
    setMarking(true);
    try {
      await api.verifyBatchFeed(latest.batch_id, 'menu', status);
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not record feed status.');
    } finally {
      setMarking(false);
    }
  };

  const status = latest?.feed_status_menu || 'pending';

  return (
    <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 md:col-span-2">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-1">
        <FileJson className="w-5 h-5 text-blue-500" />
        Menu Feed Status ({environment === 'sandbox' ? 'Sandbox' : 'Production'})
      </h2>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
        Acceptance for the most recent menu feed push -- check Partner Portal &rarr; Ingestion &rarr; History,
        then mark it here.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg text-sm">
          {error}
        </div>
      )}

      {latest === undefined ? (
        <div className="h-16 animate-pulse bg-slate-100 dark:bg-slate-700 rounded-lg" />
      ) : !latest ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No {environment} menu feed pushed yet.</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 text-sm">
            <div className="flex items-center gap-2">
              {status === 'confirmed_clean' && <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />}
              {status === 'flagged_errors' && <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />}
              {status === 'pending' && <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />}
              <span className="font-medium text-slate-900 dark:text-white">Menu Feed</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleMark('confirmed_clean')}
                disabled={marking}
                className="px-2 py-1 text-xs bg-green-100 hover:bg-green-200 text-green-700 dark:bg-green-900/30 dark:text-green-300 rounded disabled:opacity-50"
              >
                Mark Accepted
              </button>
              <button
                onClick={() => handleMark('flagged_errors')}
                disabled={marking}
                className="px-2 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/30 dark:text-red-300 rounded disabled:opacity-50"
              >
                Mark Rejected
              </button>
            </div>
          </div>

          {feedContent?.menu && (
            <div className="mt-4 p-3 border border-slate-200 dark:border-slate-700 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <FileJson className="w-4 h-4 text-blue-500" />
                <h3 className="text-xs font-semibold text-slate-900 dark:text-white">Compiled Menu Feed Output</h3>
              </div>
              <pre className="bg-slate-900 text-slate-200 text-xs rounded-lg p-3 overflow-auto max-h-72">
                {JSON.stringify(feedContent.menu, null, 2)}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}
