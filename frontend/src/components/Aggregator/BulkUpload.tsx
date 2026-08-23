import { useState } from 'react';
import { api } from '../../lib/api';
import { UploadCloud, Loader2 } from 'lucide-react';

export function BulkUpload() {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    setUploading(true);
    setResult(null);
    try {
      const data = await api.uploadSpreadsheet(e.target.files[0]);
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
        Bulk Merchant Upload
      </h2>

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

      {result && (
        <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 rounded-lg text-sm">
          Successfully processed {result.merchants_count} merchants and {result.menus_count} menus.
        </div>
      )}
    </div>
  );
}
