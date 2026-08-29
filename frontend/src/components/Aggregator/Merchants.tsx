import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Layers, Trash2 } from 'lucide-react';
import { MerchantDetailModal } from './MerchantDetailModal';
import { BulkUpload } from './BulkUpload';
import { BulkMenuUpload } from './BulkMenuUpload';
import { ReadinessScorecard } from './ReadinessScorecard';
import { TriageQueue } from './TriageQueue';

const STATUS_STYLES: Record<string, string> = {
  matched: 'bg-green-100 text-green-800',
  approved: 'bg-green-100 text-green-800',
  needs_review: 'bg-amber-100 text-amber-800',
  no_listing: 'bg-amber-100 text-amber-800',
  rejected: 'bg-red-100 text-red-800',
  excluded_closed: 'bg-slate-200 text-slate-700',
  new: 'bg-slate-100 text-slate-600',
};

export function Merchants() {
  const [merchants, setMerchants] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [detailStoreId, setDetailStoreId] = useState<string | null>(null);
  // Bumped after a bulk upload completes -- TriageQueue and ReadinessScorecard
  // below each fetch their own data once on mount and have no other way to
  // learn that a sibling upload changed it, so this is passed down to force
  // a refetch instead of the user needing a full page reload.
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    api.listMerchants()
      .then((data) => {
        setMerchants(data.merchants || []);
        if (data.error) setError(data.error);
      })
      .catch((err) => setError(err.message || 'Could not load merchants.'));
  }, [refreshToken]);

  const handleRemove = async (storeId: string) => {
    setRemovingId(storeId);
    try {
      const res = await api.removeMerchant(storeId);
      if (res.status === 'error') throw new Error(res.message);
      // Soft-removed (status -> excluded_closed) -- /api/merchants only ever
      // returns matched/approved rows, so it won't come back on a reload
      // either; drop it locally now for immediate feedback.
      setMerchants((prev) => (prev || []).filter((m) => m.store_id !== storeId));
    } catch (err: any) {
      setError(err.message || 'Could not remove merchant.');
    } finally {
      setRemovingId(null);
      setConfirmId(null);
    }
  };

  const filtered = (merchants || []).filter((m) =>
    !query || (m.name || '').toLowerCase().includes(query.toLowerCase()) || (m.store_id || '').toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Layers className="w-6 h-6 text-blue-500" />
            Merchants
          </h1>
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-1">
            Validated merchants only -- matched automatically or approved in the Triage Queue.
          </p>
        </div>
        <input
          type="text"
          placeholder="Search by name or store id..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-64 px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
        />
      </div>

      <ReadinessScorecard refreshToken={refreshToken} />
      <TriageQueue refreshToken={refreshToken} onResolved={() => setRefreshToken((t) => t + 1)} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BulkUpload onUploaded={() => setRefreshToken((t) => t + 1)} />
        <BulkMenuUpload onCleared={() => setRefreshToken((t) => t + 1)} />
      </div>

      <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg text-sm">
            {error}
          </div>
        )}

        {merchants === null ? (
          <div className="h-24 animate-pulse bg-slate-100 dark:bg-slate-700 rounded-lg" />
        ) : filtered.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {merchants.length === 0 ? 'No merchants on record yet.' : 'No merchants match your search.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left text-slate-500 dark:text-slate-400">
              <thead className="text-xs text-slate-700 uppercase bg-slate-50 dark:bg-slate-700 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-3 rounded-tl-lg">Name</th>
                  <th className="px-4 py-3">Store ID</th>
                  <th className="px-4 py-3">Address</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Confidence</th>
                  <th className="px-4 py-3 rounded-tr-lg">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => (
                  <tr
                    key={m.store_id}
                    onClick={() => setDetailStoreId(m.store_id)}
                    className="bg-white dark:bg-slate-800 border-b dark:border-slate-700 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50"
                  >
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{m.name || '--'}</td>
                    <td className="px-4 py-3 font-mono text-xs">{m.store_id}</td>
                    <td className="px-4 py-3 truncate max-w-xs">{m.address || '--'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[m.status] || 'bg-slate-100 text-slate-600'}`}>
                        {(m.status || 'new').replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">{m.confidence != null ? `${(m.confidence * 100).toFixed(0)}%` : '--'}</td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      {confirmId === m.store_id ? (
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <span className="text-xs text-slate-500 dark:text-slate-400">Remove?</span>
                          <button
                            onClick={() => handleRemove(m.store_id)}
                            disabled={removingId === m.store_id}
                            className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                          >
                            {removingId === m.store_id ? 'Removing...' : 'Confirm'}
                          </button>
                          <button
                            onClick={() => setConfirmId(null)}
                            disabled={removingId === m.store_id}
                            className="text-xs font-medium text-slate-500 hover:underline disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmId(m.store_id)}
                          className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                          title="Remove from active feed"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detailStoreId && (
        <MerchantDetailModal storeId={detailStoreId} onClose={() => setDetailStoreId(null)} />
      )}
    </div>
  );
}
