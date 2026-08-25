import { useEffect, useState, useCallback } from 'react';
import { api } from '../../lib/api';
import { FileJson, CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react';

const FEED_LABELS: Record<string, string> = {
  entity: 'Entity Feed',
  action: 'Action Feed',
  service: 'Service Feed',
};

const FEED_ORDER = ['entity', 'action', 'service'];

interface Batch {
  batch_id: string;
  created_at?: string;
  feed_types?: string[];
  [key: string]: any; // feed_status_{type} fields, dynamic per feed type
}

export function FeedStatus() {
  const [latest, setLatest] = useState<Batch | null | undefined>(undefined); // undefined = loading
  const [error, setError] = useState<string | null>(null);
  const [markingKey, setMarkingKey] = useState<string | null>(null);
  const [reuploading, setReuploading] = useState(false);
  const [reuploadResult, setReuploadResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getBatches();
      const sorted = [...(res.batches || [])].sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      });
      setLatest(sorted[0] || null);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Could not load feed status.');
      setLatest(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleMark = async (feedType: 'entity' | 'action' | 'service', status: 'confirmed_clean' | 'flagged_errors') => {
    if (!latest) return;
    setMarkingKey(feedType);
    try {
      await api.verifyBatchFeed(latest.batch_id, feedType, status);
      await load();
    } catch (err: any) {
      setError(err.message || 'Could not record feed status.');
    } finally {
      setMarkingKey(null);
    }
  };

  const handleReupload = async () => {
    setReuploading(true);
    setReuploadResult(null);
    try {
      const summary = await api.triggerPipeline();
      setReuploadResult(
        summary.ok
          ? `New batch pushed: ${summary.merchants_pushed} merchant(s).`
          : `Push finished with errors -- see batch ${summary.batch_id}.`
      );
      await load();
    } catch (err: any) {
      setReuploadResult(`Failed to trigger push: ${err.message}`);
    } finally {
      setReuploading(false);
    }
  };

  const feedTypes = latest
    ? (latest.feed_types && latest.feed_types.length > 0
        ? latest.feed_types
        : FEED_ORDER.filter((ft) => latest[`feed_status_${ft}`] !== undefined))
    : [];
  const orderedFeedTypes = FEED_ORDER.filter((ft) => feedTypes.includes(ft));
  const anyFlagged = orderedFeedTypes.some((ft) => latest?.[`feed_status_${ft}`] === 'flagged_errors');

  return (
    <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 md:col-span-2">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-1">
        <FileJson className="w-5 h-5 text-blue-500" />
        Feed Status
      </h2>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
        Per-file acceptance for the most recent push -- check Partner Portal &rarr; Ingestion &rarr; History
        for each file, then mark it here.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg text-sm">
          {error}
        </div>
      )}

      {latest === undefined ? (
        <div className="h-16 animate-pulse bg-slate-100 dark:bg-slate-700 rounded-lg" />
      ) : !latest || orderedFeedTypes.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No feed pushed yet.</p>
      ) : (
        <>
          <div className="space-y-2">
            {orderedFeedTypes.map((ft) => {
              const status = latest[`feed_status_${ft}`] || 'pending';
              return (
                <div
                  key={ft}
                  className="flex items-center justify-between gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 text-sm"
                >
                  <div className="flex items-center gap-2">
                    {status === 'confirmed_clean' && <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />}
                    {status === 'flagged_errors' && <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />}
                    {status === 'pending' && <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />}
                    <span className="font-medium text-slate-900 dark:text-white">{FEED_LABELS[ft] || ft}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleMark(ft as any, 'confirmed_clean')}
                      disabled={markingKey === ft}
                      className="px-2 py-1 text-xs bg-green-100 hover:bg-green-200 text-green-700 dark:bg-green-900/30 dark:text-green-300 rounded disabled:opacity-50"
                    >
                      Mark Accepted
                    </button>
                    <button
                      onClick={() => handleMark(ft as any, 'flagged_errors')}
                      disabled={markingKey === ft}
                      className="px-2 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/30 dark:text-red-300 rounded disabled:opacity-50"
                    >
                      Mark Rejected
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {anyFlagged && (
            <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 rounded-lg text-sm flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p>A feed was rejected -- fix the underlying data and submit a new push.</p>
                <button
                  onClick={handleReupload}
                  disabled={reuploading}
                  className="mt-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg flex items-center gap-2"
                >
                  {reuploading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                  Submit New Feed Upload
                </button>
                {reuploadResult && <p className="mt-2 text-xs">{reuploadResult}</p>}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
