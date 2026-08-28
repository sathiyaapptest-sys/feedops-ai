import { useState } from 'react';
import { api } from '../../lib/api';
import { UploadCloud, Loader2 } from 'lucide-react';

export function BulkUpload() {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    setUploading(true);
    setResult(null);
    try {
      const data = await api.uploadSpreadsheet(e.target.files[0], replaceExisting);
      setResult(data);
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
      // clear the input
      e.target.value = '';
    }
  };

  return (
    <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
        <UploadCloud className="w-5 h-5 text-blue-500" />
        Bulk Restaurant Upload
      </h2>
      <p className="text-xs text-slate-500 dark:text-slate-400 -mt-3 mb-4">
        Restaurant/merchant rows only -- name, address, phone. Upload menu items separately below.
      </p>

      <div className="flex items-center justify-center w-full">
        <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-slate-300 border-dashed rounded-lg cursor-pointer bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:hover:border-slate-500">
          <div className="flex flex-col items-center justify-center pt-5 pb-6">
            {uploading ? (
              <Loader2 className="w-8 h-8 text-slate-500 animate-spin mb-2" />
            ) : (
              <UploadCloud className="w-8 h-8 text-slate-500 mb-2" />
            )}
            <p className="mb-2 text-sm text-slate-500 dark:text-slate-400">
              <span className="font-semibold">Click to upload</span> or drag and drop
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">CSV or Excel (MAX. 10MB)</p>
          </div>
          <input type="file" className="hidden" accept=".csv, .xlsx, .xls" onChange={handleFileChange} disabled={uploading} />
        </label>
      </div>

      <label className="flex items-start gap-2 mt-3 cursor-pointer">
        <input
          type="checkbox"
          checked={replaceExisting}
          onChange={(e) => setReplaceExisting(e.target.checked)}
          disabled={uploading}
          className="mt-0.5"
        />
        <span className="text-xs text-slate-500 dark:text-slate-400">
          <span className="font-medium text-slate-700 dark:text-slate-300">Replace existing roster</span> -- any
          merchant not in this file gets removed from the active feed (not hard-deleted; you can still see its
          history). Leave unchecked to just add/update these rows.
        </span>
      </label>

      {result && result.status === 'error' && (
        <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg text-sm">
          {result.message || 'Upload failed.'}
        </div>
      )}

      {result && result.status !== 'error' && (
        <div className="mt-4 space-y-3">
          <div className="p-4 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 rounded-lg text-sm">
            Parsed {result.merchants_count} merchant{result.merchants_count === 1 ? '' : 's'} --
            {' '}{result.persisted_count ?? 0} saved to the triage queue / readiness scorecard / daily feed push.
            {!!result.removed_count && (
              <> {result.removed_count} merchant{result.removed_count === 1 ? '' : 's'} not in this file {result.removed_count === 1 ? 'was' : 'were'} removed from the active feed.</>
            )}
          </div>

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
