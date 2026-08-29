import { useState } from 'react';
import { api } from '../../lib/api';
import { Utensils, Loader2, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';

interface BulkMenuUploadProps {
  onCleared?: () => void;
}

export function BulkMenuUpload({ onCleared }: BulkMenuUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const [clearMessage, setClearMessage] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    setUploading(true);
    setResult(null);
    setClearMessage(null);
    try {
      const data = await api.uploadMenuSpreadsheet(e.target.files[0]);
      setResult(data);
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleClearAllMenus = async () => {
    setClearing(true);
    setClearMessage(null);
    try {
      const res = await api.clearAllMenus();
      if (res.status === 'success') {
        setClearMessage(`Successfully cleared ${res.cleared_count ?? 0} menu documents from Firestore.`);
        setResult(null);
        onCleared?.();
      } else {
        setClearMessage(`Error: ${res.message || 'Failed to clear menus.'}`);
      }
    } catch (err: any) {
      setClearMessage(`Error: ${err.message || 'Failed to clear menus.'}`);
    } finally {
      setClearing(false);
      setShowConfirmClear(false);
    }
  };

  return (
    <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Utensils className="w-5 h-5 text-purple-500" />
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Bulk Menu Upload
            </h2>
          </div>
          <span className="text-[10px] uppercase font-extrabold tracking-wider px-2.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60">
            Optional Track
          </span>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
          <strong className="text-slate-700 dark:text-slate-300">Optional Enhancement:</strong> Google Ordering Redirect (<span className="italic">Order Online</span> buttons) launches with restaurant profiles alone. Bulk menu upload powers the optional <code className="font-mono text-[11px] bg-slate-100 dark:bg-slate-700/80 px-1 py-0.5 rounded text-purple-600 dark:text-purple-400">google.food_menu</code> feed to display dishes in Google Maps Search.
        </p>

        <div className="flex items-center justify-center w-full">
          <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-slate-300 border-dashed rounded-lg cursor-pointer bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-700/50 hover:bg-slate-100 dark:border-slate-600 dark:hover:border-slate-500 transition-colors">
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              {uploading ? (
                <Loader2 className="w-8 h-8 text-purple-500 animate-spin mb-2" />
              ) : (
                <Utensils className="w-8 h-8 text-slate-400 dark:text-slate-500 mb-2" />
              )}
              <p className="mb-1 text-sm text-slate-600 dark:text-slate-300 font-medium">
                <span>Click to upload menu spreadsheet</span> or drag and drop
              </p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">CSV or Excel with dish rows (MAX. 10MB)</p>
            </div>
            <input type="file" className="hidden" accept=".csv, .xlsx, .xls" onChange={handleFileChange} disabled={uploading || clearing} />
          </label>
        </div>

        {/* Clear All Menus Action Bar */}
        <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between flex-wrap gap-2">
          <span className="text-[11px] text-slate-400 dark:text-slate-500">
            Need to purge uploaded test dishes?
          </span>

          {!showConfirmClear ? (
            <button
              type="button"
              onClick={() => setShowConfirmClear(true)}
              disabled={clearing || uploading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg border border-rose-200 dark:border-rose-900/60 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear All Menus</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 animate-in fade-in">
              <span className="text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> Purge all menus?
              </span>
              <button
                type="button"
                onClick={handleClearAllMenus}
                disabled={clearing}
                className="px-2.5 py-1 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-md shadow-sm transition-colors flex items-center gap-1"
              >
                {clearing ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Yes, Clear All'}
              </button>
              <button
                type="button"
                onClick={() => setShowConfirmClear(false)}
                disabled={clearing}
                className="px-2.5 py-1 text-xs text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 rounded-md transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {clearMessage && (
          <div className="mt-3 p-3 bg-slate-50 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>{clearMessage}</span>
          </div>
        )}

        {result && result.status === 'error' && (
          <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg text-sm">
            {result.message || 'Upload failed.'}
          </div>
        )}

        {result && result.status !== 'error' && (
          <div className="mt-4 space-y-3">
            <div className="p-4 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 rounded-lg text-sm font-medium">
              Parsed {result.items_count} item{result.items_count === 1 ? '' : 's'} across{' '}
              {result.merchants_updated?.length ?? 0} merchant{result.merchants_updated?.length === 1 ? '' : 's'}.
            </div>

            {result.merchants_updated && result.merchants_updated.length > 0 && (
              <div className="p-3 bg-slate-50 dark:bg-slate-900/40 text-slate-700 dark:text-slate-300 rounded-lg text-sm">
                <ul className="space-y-1 max-h-36 overflow-y-auto">
                  {result.merchants_updated.map((m: any) => (
                    <li key={m.store_id} className="text-xs">
                      <span className="font-medium text-slate-900 dark:text-white">{m.name}</span>: +{m.added} item{m.added === 1 ? '' : 's'}
                      {m.skipped_duplicates ? `, ${m.skipped_duplicates} duplicate${m.skipped_duplicates === 1 ? '' : 's'} skipped` : ''}
                      {' '}({m.total} total)
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.errors && result.errors.length > 0 && (
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 rounded-lg text-xs">
                <p className="font-semibold mb-1.5">{result.errors.length} row{result.errors.length === 1 ? '' : 's'} skipped:</p>
                <ul className="space-y-1 max-h-32 overflow-y-auto">
                  {result.errors.map((err: any, i: number) => (
                    <li key={i}>
                      {err.row_index === -1 ? 'File' : `Row ${err.row_index + 1}`}: <span className="font-mono">{err.field}</span> -- {err.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

