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
  verification_status: 'pending' | 'confirmed_clean' | 'flagged_errors';
  verification_notes?: string | null;
  created_at?: string;
}

type Health = 'clean' | 'pending' | 'attention';

function batchHealth(batch: Batch): Health {
  if (batch.upload_status !== 'success' || batch.verification_status === 'flagged_errors') return 'attention';
  if (batch.verification_status === 'pending') return 'pending';
  return 'clean';
}

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
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
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

  const handleVerify = async (batchId: string, status: 'confirmed_clean' | 'flagged_errors') => {
    setVerifyingId(batchId);
    try {
      await api.verifyBatch(batchId, status, noteDrafts[batchId] || undefined);
      await load();
    } catch (err: any) {
      setError(`Could not record verification: ${err.message}`);
    } finally {
      setVerifyingId(null);
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
            : 'The most recent push needs attention -- see the batch below.'}
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
                  className="flex items-center justify-between gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 text-sm"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {health === 'clean' && <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />}
                    {health === 'pending' && <Clock className="w-4 h-4 text-amber-400 flex-shrink-0" />}
                    {health === 'attention' && <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />}
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 dark:text-white truncate">
                        {b.batch_id} <span className="text-slate-400 font-normal">({b.environment}{b.dry_run ? ', dry-run' : ''})</span>
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {formatWhen(b.created_at)} -- {b.merchant_count} restaurant(s) -- {b.verification_status.replace('_', ' ')}
                      </p>
                      {b.verification_notes && (
                        <p className="text-xs text-slate-400 italic mt-0.5">"{b.verification_notes}"</p>
                      )}
                    </div>
                  </div>

                  {b.verification_status === 'pending' && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <input
                        type="text"
                        placeholder="notes (optional)"
                        value={noteDrafts[b.batch_id] || ''}
                        onChange={(e) => setNoteDrafts({ ...noteDrafts, [b.batch_id]: e.target.value })}
                        className="hidden lg:block w-32 px-2 py-1 text-xs border border-slate-300 dark:border-slate-600 rounded bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white"
                      />
                      <button
                        onClick={() => handleVerify(b.batch_id, 'confirmed_clean')}
                        disabled={verifyingId === b.batch_id}
                        className="px-2 py-1 text-xs bg-green-100 hover:bg-green-200 text-green-700 dark:bg-green-900/30 dark:text-green-300 rounded disabled:opacity-50"
                      >
                        Mark Clean
                      </button>
                      <button
                        onClick={() => handleVerify(b.batch_id, 'flagged_errors')}
                        disabled={verifyingId === b.batch_id}
                        className="px-2 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/30 dark:text-red-300 rounded disabled:opacity-50"
                      >
                        Flag Errors
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <p className="mt-3 text-xs text-slate-400">
        Verification is self-reported: Google exposes no API to confirm a menu feed was accepted, only
        Partner Portal &rarr; Ingestion &rarr; History. Check there, then mark the batch above.
      </p>
    </div>
  );
}
