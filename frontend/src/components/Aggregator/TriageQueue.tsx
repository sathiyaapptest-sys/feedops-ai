import { Fragment, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { AlertCircle, CheckCircle, XCircle, ExternalLink, MapPin, Pencil } from 'lucide-react';

interface TriageQueueProps {
  // Bumped by a sibling action (e.g. a bulk restaurant upload) that changed
  // merchant data this component doesn't own -- refetches when it changes,
  // since this component otherwise has no way to know data changed elsewhere.
  refreshToken?: number;
  // Called after a resolve (approve/reject) -- approving moves a merchant
  // into the validated Merchants table below, which has no other way to
  // learn this queue changed it.
  onResolved?: () => void;
}

// Google Maps' free text-search page (maps.google.com), not the paid Places
// API -- just a URL, no API key, no billing account, no cost at any volume.
// Built from the merchant's own name/address, so it always searches for the
// real restaurant instead of depending on a Places match (which, without a
// GOOGLE_PLACES_API_KEY, was always the same fake mock place_id -- Google's
// own Sydney office -- for every single row).
const mapsSearchUrlFor = (text: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;

export function TriageQueue({ refreshToken, onResolved }: TriageQueueProps) {
  const [queue, setQueue] = useState<any[]>([]);
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [addressInput, setAddressInput] = useState('');
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    fetchQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  const fetchQueue = () => {
    api.getTriageQueue().then(data => setQueue(data.queue)).catch(console.error);
  };

  const handleResolve = async (storeId: string, action: string, address?: string) => {
    // Merchant records are keyed by store_id, never a plain "id" field --
    // resolve_triage's payload/MerchantRepository.update_status both expect
    // that key. Sending item.id here previously sent undefined, so Approve/
    // Reject silently resolved nothing.
    await api.resolveTriage(storeId, action, address);
    setQueue(q => q.filter(item => item.store_id !== storeId));
    onResolved?.();
  };

  const openFix = (item: any) => {
    setFixingId(item.store_id);
    setAddressInput(item.address || '');
  };

  const closeFix = () => setFixingId(null);

  const applyCorrection = async (storeId: string) => {
    if (!addressInput.trim()) return;
    setApplying(true);
    try {
      await handleResolve(storeId, 'approve', addressInput.trim());
      closeFix();
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-1">
        <AlertCircle className="w-5 h-5 text-amber-500" />
        Global Triage Queue
      </h2>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
        Ambiguous automatic Places matches, waiting on a human decision. <span className="font-medium text-green-700 dark:text-green-400">Approve</span> moves
        a restaurant into the Merchants table below as-is; <span className="font-medium text-red-700 dark:text-red-400">Reject</span> keeps it out of the
        active feed entirely; <span className="font-medium text-blue-700 dark:text-blue-400">Fix Address</span> lets you check the free Google Maps text
        search and correct the address yourself if it's wrong.
      </p>

      {queue.length === 0 ? (
        <p className="text-sm text-slate-500">No items pending review.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-slate-500 dark:text-slate-400">
            <thead className="text-xs text-slate-700 uppercase bg-slate-50 dark:bg-slate-700 dark:text-slate-300">
              <tr>
                <th className="px-4 py-3 rounded-tl-lg">Merchant</th>
                <th className="px-4 py-3">Confidence</th>
                <th className="px-4 py-3">Issue</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3 rounded-tr-lg">Actions</th>
              </tr>
            </thead>
            <tbody>
              {queue.map(item => (
                <Fragment key={item.store_id}>
                  <tr className="bg-white dark:bg-slate-800 border-b dark:border-slate-700">
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{item.name}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${item.confidence < 0.8 ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}`}>
                        {((item.confidence || 0) * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs max-w-[200px]">{item.issue || '--'}</td>
                    <td className="px-4 py-3">
                      {item.address || item.name ? (
                        <a
                          href={mapsSearchUrlFor(`${item.name || ''} ${item.address || ''}`.trim())}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline text-xs font-medium"
                          title="Search this name/address on Google Maps (free text search, no API call)"
                        >
                          <MapPin className="w-3.5 h-3.5" /> View on Maps <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-slate-400">No address on file</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          onClick={() => handleResolve(item.store_id, 'approve')}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-300 dark:hover:bg-green-900/40 rounded"
                          title="Accept the automatic match as-is"
                        >
                          <CheckCircle className="w-3.5 h-3.5" /> Approve
                        </button>
                        <button
                          onClick={() => handleResolve(item.store_id, 'reject')}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/40 rounded"
                          title="Wrong restaurant entirely -- exclude from the active feed"
                        >
                          <XCircle className="w-3.5 h-3.5" /> Reject
                        </button>
                        <button
                          onClick={() => (fixingId === item.store_id ? closeFix() : openFix(item))}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:bg-blue-900/40 rounded"
                          title="Correct the address yourself after checking Google Maps"
                        >
                          <Pencil className="w-3.5 h-3.5" /> Fix Address
                        </button>
                      </div>
                    </td>
                  </tr>
                  {fixingId === item.store_id && (
                    <tr className="bg-slate-50 dark:bg-slate-900/40 border-b dark:border-slate-700">
                      <td colSpan={5} className="px-4 py-4">
                        <div className="space-y-2 max-w-xl">
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Check the address on Google Maps (free, opens a new tab), then correct it below if it's wrong.
                          </p>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={addressInput}
                              onChange={(e) => setAddressInput(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && applyCorrection(item.store_id)}
                              placeholder="Corrected address"
                              className="flex-1 px-3 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                            />
                            <a
                              href={mapsSearchUrlFor(`${item.name || ''} ${addressInput}`.trim())}
                              target="_blank"
                              rel="noreferrer"
                              className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg flex items-center gap-1.5 flex-shrink-0"
                              title="Preview this address on Google Maps"
                            >
                              <MapPin className="w-3.5 h-3.5" /> Preview
                            </a>
                            <button
                              onClick={() => applyCorrection(item.store_id)}
                              disabled={applying || !addressInput.trim()}
                              className="px-3 py-1.5 text-xs font-medium bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg flex-shrink-0"
                            >
                              {applying ? 'Applying...' : 'Approve with this address'}
                            </button>
                            <button
                              onClick={closeFix}
                              className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg flex-shrink-0"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
