import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { X, Store, Clock, Utensils } from 'lucide-react';

interface MerchantDetailModalProps {
  storeId: string;
  onClose: () => void;
}

const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Read-only mirror of MyStore.tsx's fields (profile) and Menu.tsx's preview
// table (menu items) -- for the aggregator to inspect one restaurant's real
// stored data from the Merchants page, without leaving it or being able to
// edit it (editing stays the merchant's own self-service surface).
export function MerchantDetailModal({ storeId, onClose }: MerchantDetailModalProps) {
  const [merchant, setMerchant] = useState<any>(null);
  const [menu, setMenu] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getMerchantDetail(storeId)
      .then((res) => {
        if (cancelled) return;
        if (res.status === 'error') {
          setError(res.message || 'Could not load merchant details.');
          return;
        }
        setMerchant(res.merchant);
        setMenu(res.menu);
      })
      .catch((err) => !cancelled && setError(err.message || 'Could not load merchant details.'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [storeId]);

  const openingHours: any[] = merchant?.opening_hours || [];
  const sortedHours = [...openingHours].sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));
  const serviceTypes: string[] = merchant?.service_types || [];
  const menuItems: any[] = menu?.items || [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 w-full max-w-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700 sticky top-0 bg-white dark:bg-slate-800 z-10">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 min-w-0">
            <Store className="w-5 h-5 text-blue-500 flex-shrink-0" />
            <span className="truncate">{merchant?.name || storeId}</span>
          </h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded flex-shrink-0" title="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {loading && <div className="h-40 animate-pulse bg-slate-100 dark:bg-slate-700 rounded-lg" />}

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg text-sm">{error}</div>
          )}

          {!loading && !error && merchant && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Store ID</div>
                  <div className="font-mono text-xs text-slate-700 dark:text-slate-300 mt-0.5">{merchant.store_id}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Status</div>
                  <div className="text-slate-900 dark:text-white mt-0.5">{(merchant.status || 'new').replace('_', ' ')}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Address</div>
                  <div className="text-slate-900 dark:text-white mt-0.5">{merchant.address || 'Not set'}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Phone</div>
                  <div className="text-slate-900 dark:text-white mt-0.5">{merchant.telephone || 'Not set'}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Places match confidence</div>
                  <div className="text-slate-900 dark:text-white mt-0.5">{merchant.confidence != null ? `${(merchant.confidence * 100).toFixed(0)}%` : 'Not set'}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Lead / prep time</div>
                  <div className="text-slate-900 dark:text-white mt-0.5">
                    {merchant.lead_time_minutes != null ? `${merchant.lead_time_minutes} min` : 'Not set -- only self-reported by the merchant'}
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <div className="text-xs text-slate-500 dark:text-slate-400">Service types</div>
                  <div className="text-slate-900 dark:text-white mt-0.5">
                    {serviceTypes.length > 0 ? serviceTypes.join(', ') : 'Not set -- only self-reported by the merchant'}
                  </div>
                </div>
              </div>

              {sortedHours.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5 mb-2">
                    <Clock className="w-4 h-4 text-amber-500" />
                    Servicing Timings
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    {sortedHours.map((t) => (
                      <div key={t.day} className="p-2 border border-slate-200 dark:border-slate-700 rounded-lg">
                        <div className="font-medium text-slate-700 dark:text-slate-300">{t.day}</div>
                        <div className="text-slate-500 dark:text-slate-400">{t.isOpen ? `${t.openTime}-${t.closeTime}` : 'Closed'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5 mb-2">
                  <Utensils className="w-4 h-4 text-green-500" />
                  Menu {menuItems.length > 0 && <span className="text-xs font-normal text-slate-500 dark:text-slate-400">({menuItems.length} item{menuItems.length === 1 ? '' : 's'})</span>}
                </h3>
                {menuItems.length === 0 ? (
                  <div className="p-3 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 rounded-lg text-sm">
                    No menu on file yet -- add items for this restaurant via Bulk Menu Upload on the Merchants page.
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                    <table className="w-full text-left text-sm text-slate-700 dark:text-slate-300">
                      <thead className="sticky top-0 bg-slate-50 dark:bg-slate-700 text-xs uppercase text-slate-500 dark:text-slate-400">
                        <tr>
                          <th className="px-3 py-2">Name</th>
                          <th className="px-3 py-2">Price</th>
                          <th className="px-3 py-2">Category</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                        {menuItems.map((item, idx) => (
                          <tr key={idx}>
                            <td className="px-3 py-2">{item.name}</td>
                            <td className="px-3 py-2">{item.price}</td>
                            <td className="px-3 py-2">{item.category || '--'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
