import { useState } from 'react';
import { api } from '../../lib/api';
import { Utensils, Loader2 } from 'lucide-react';

export function BulkMenuUpload() {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    setUploading(true);
    setResult(null);
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

  return (
    <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
        <Utensils className="w-5 h-5 text-blue-500" />
        Bulk Menu Upload
      </h2>
      <p className="text-xs text-slate-500 dark:text-slate-400 -mt-3 mb-4">
        Dish rows only -- merchant name, item name, price (category/description optional).
        Matched to the restaurant upload by name, in either order.
      </p>

      <div className="flex items-center justify-center w-full">
        <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-slate-300 border-dashed rounded-lg cursor-pointer bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:hover:border-slate-500">
          <div className="flex flex-col items-center justify-center pt-5 pb-6">
            {uploading ? (
              <Loader2 className="w-8 h-8 text-slate-500 animate-spin mb-2" />
            ) : (
              <Utensils className="w-8 h-8 text-slate-500 mb-2" />
            )}
            <p className="mb-2 text-sm text-slate-500 dark:text-slate-400">
              <span className="font-semibold">Click to upload</span> or drag and drop
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">CSV or Excel (MAX. 10MB)</p>
          </div>
          <input type="file" className="hidden" accept=".csv, .xlsx, .xls" onChange={handleFileChange} disabled={uploading} />
        </label>
      </div>

      {result && result.status === 'error' && (
        <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg text-sm">
          {result.message || 'Upload failed.'}
        </div>
      )}

      {result && result.status !== 'error' && (
        <div className="mt-4 space-y-3">
          <div className="p-4 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 rounded-lg text-sm">
            Parsed {result.items_count} item{result.items_count === 1 ? '' : 's'} across{' '}
            {result.merchants_updated?.length ?? 0} merchant{result.merchants_updated?.length === 1 ? '' : 's'}.
          </div>

          {result.merchants_updated && result.merchants_updated.length > 0 && (
            <div className="p-4 bg-slate-50 dark:bg-slate-900/40 text-slate-700 dark:text-slate-300 rounded-lg text-sm">
              <ul className="space-y-1 max-h-40 overflow-y-auto">
                {result.merchants_updated.map((m: any) => (
                  <li key={m.store_id} className="text-xs">
                    <span className="font-medium">{m.name}</span>: +{m.added} item{m.added === 1 ? '' : 's'}
                    {m.skipped_duplicates ? `, ${m.skipped_duplicates} duplicate${m.skipped_duplicates === 1 ? '' : 's'} skipped` : ''}
                    {' '}({m.total} total)
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.errors && result.errors.length > 0 && (
            <div className="p-4 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 rounded-lg text-sm">
              <p className="font-medium mb-2">{result.errors.length} row{result.errors.length === 1 ? '' : 's'} skipped -- not saved:</p>
              <ul className="space-y-1 max-h-40 overflow-y-auto">
                {result.errors.map((err: any, i: number) => (
                  <li key={i} className="text-xs">
                    {err.row_index === -1 ? 'File' : `Row ${err.row_index + 1}`}: <span className="font-mono">{err.field}</span> -- {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
