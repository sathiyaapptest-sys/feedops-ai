import { useEffect, useState, useCallback } from 'react';
import { api } from '../../lib/api';
import { UploadCloud, CheckCircle2, XCircle, Clock, AlertTriangle, Loader2 } from 'lucide-react';

// Sibling of FeedHealth.tsx for the Menu Feeds track -- deliberately not
// shared state/component with the Ordering Redirect version, reading
// api.getMenuFeedBatches/triggerMenuFeedPipeline (server-filtered to
// kind == "menu") instead of api.getBatches/triggerPipeline, so there's zero
// risk of a menu batch ever affecting the Redirect FeedHealth's counts.

interface Batch {
  batch_id: string;
  environment: string;
  merchant_count: number;
  upload_status: string;
  dry_run: boolean;
  feed_types?: string[];
  created_at?: string;
  [key: string]: any; // feed_status_{type} fields, dynamic per feed type
}

type Health = 'clean' | 'pending' | 'attention';

// Derived purely from Menu Feed Status's own feed_status_menu mark -- see
// FeedHealth.tsx's identical comment: there used to be a second, separate
// "Mark Clean/Flag Errors" action here writing its own unread
// verification_status field. This card is now a read-only summary of the
// one real mechanism (feed_status_menu), not a second one.
function batchHealth(batch: Batch): Health {
  if (batch.upload_status !== 'success') return 'attention';
  const feedTypes = batch.feed_types && batch.feed_types.length > 0 ? batch.feed_types : [];
  if (feedTypes.length === 0) return 'pending';
  const statuses = feedTypes.map((ft) => batch[`feed_status_${ft}`]);
  if (statuses.some((s) => s === 'flagged_errors')) return 'attention';
  if (statuses.every((s) => s === 'confirmed_clean')) return 'clean';
  return 'pending';
}

const HEALTH_LABEL: Record<Health, string> = {
  clean: 'accepted',
  pending: 'awaiting review',
  attention: 'needs attention',
};

const DOT_CLASS: Record<Health, string> = {
  clean: 'bg-green-500',
  pending: 'bg-amber-400',
  attention: 'bg-red-500',
};

function formatWhen(created_at?: string) {
  if (!created_at) return 'unknown time';
  const d = new Date(created_at);
  if (isNaN(d.getTime())) return 'unknown time';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface MenuFeedHealthProps {
  environment: 'sandbox' | 'production';
}

export function MenuFeedHealth({ environment }: MenuFeedHealthProps) {
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [triggerResult, setTriggerResult] = useState<string | null>(null);
  const [productionUnlocked, setProductionUnlocked] = useState<boolean | null>(null); // null = loading

  useEffect(() => {
    if (environment !== 'production') return;
    api.getMenuOnboardingJourney().then((res) => {
      const reviewStep = res.steps?.find((s) => s.key === 'menu_sandbox_review');
      setProductionUnlocked(reviewStep?.status === 'complete');
    }).catch(() => setProductionUnlocked(false));
  }, [environment]);

  const load = useCallback(async () => {
    try {
      const res = await api.getMenuFeedBatches(environment);
      const sorted = [...(res.batches || [])].sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      });
      setBatches(sorted);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Could not load menu feed upload history.');
    }
  }, [environment]);

  useEffect(() => {
    load();
  }, [load]);

  const uploadLocked = environment === 'production' && !productionUnlocked;

  const handleUploadNow = async () => {
    if (uploadLocked) {
      setTriggerResult('Production is locked until Menu Sandbox Review is approved.');
      return;
    }
    setTriggering(true);
    setTriggerResult(null);
    try {
      const summary = await api.triggerMenuFeedPipeline(environment);
      setTriggerResult(
        summary.ok
          ? `Push complete: ${summary.merchants_pushed} restaurant menu(s) uploaded.`
          : summary.error
          ? summary.error
          : `Push finished with errors -- see batch ${summary.batch_id} below.`
      );
      await load();
    } catch (err: any) {
      setTriggerResult(`Failed to trigger push: ${err.message}`);
    } finally {
      setTriggering(false);
    }
  };

  const latest = batches && batches.length > 0 ? batches[0] : null;
  const hoursSinceLatest = latest?.created_at
    ? (Date.now() - new Date(latest.created_at).getTime()) / (1000 * 60 * 60)
    : null;
  const dayGap = hoursSinceLatest !== null && hoursSinceLatest > 36;
  const needsAttention = !latest || batchHealth(latest) === 'attention' || dayGap;

  return (
    <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 md:col-span-2">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <UploadCloud className="w-5 h-5 text-blue-500" />
          Menu Feed Health ({environment === 'sandbox' ? 'Sandbox' : 'Production'})
        </h2>
        <button
          onClick={handleUploadNow}
          disabled={triggering || uploadLocked}
          title={uploadLocked ? 'Locked until Menu Sandbox Review is approved.' : undefined}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition-colors"
        >
          {triggering ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
          Upload Now
        </button>
      </div>

      {uploadLocked && (
        <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 rounded-lg text-sm">
          Production is locked until Menu Sandbox Review is approved -- see the Menu Feeds tracker on the Dashboard.
        </div>
      )}

      {needsAttention && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {!latest
            ? 'No menu feed push on record yet -- run one with "Upload Now".'
            : dayGap
            ? `No push recorded in over 36 hours (last one: ${formatWhen(latest.created_at)}).`
            : 'The most recent push needs attention -- see Menu Feed Status above to mark it Accepted/Rejected.'}
        </div>
      )}

      {triggerResult && (
        <div className="mb-4 p-3 bg-slate-50 dark:bg-slate-900/40 text-slate-700 dark:text-slate-300 rounded-lg text-sm">
          {triggerResult}
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg text-sm">
          {error}
        </div>
      )}

      {batches === null ? (
        <div className="h-16 animate-pulse bg-slate-100 dark:bg-slate-700 rounded-lg" />
      ) : batches.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No {environment} menu feed batches yet.</p>
      ) : (
        <>
          <div className="flex items-center gap-1.5 mb-4 flex-wrap">
            {batches.slice(0, 30).reverse().map((b) => {
              const health = batchHealth(b);
              return (
                <span
                  key={b.batch_id}
                  title={`${b.batch_id} -- ${health} -- ${formatWhen(b.created_at)}`}
                  className={`w-3 h-3 rounded-full ${DOT_CLASS[health]}`}
                />
              );
            })}
          </div>

          <div className="space-y-2 max-h-80 overflow-y-auto">
            {batches.map((b) => {
              const health = batchHealth(b);
              return (
                <div
                  key={b.batch_id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 text-sm"
                >
                  {health === 'clean' && <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />}
                  {health === 'pending' && <Clock className="w-4 h-4 text-amber-400 flex-shrink-0" />}
                  {health === 'attention' && <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />}
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 dark:text-white truncate">
                      {b.batch_id} <span className="text-slate-400 font-normal">({b.environment}{b.dry_run ? ', dry-run' : ''})</span>
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {formatWhen(b.created_at)} -- {b.merchant_count} restaurant(s) -- {HEALTH_LABEL[health]}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <p className="mt-3 text-xs text-slate-400">
        Read-only: this summarizes the mark from Menu Feed Status above (feed_status_menu, the same data that
        builds your streak) -- Menu Feed Status is the one place you actually mark it Accepted or Rejected
        after checking Partner Portal &rarr; Ingestion &rarr; History.
      </p>
    </div>
  );
}
