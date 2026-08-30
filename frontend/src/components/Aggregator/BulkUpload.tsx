import { useState } from 'react';
import { api } from '../../lib/api';
import { UploadCloud, Loader2, Trash2, AlertCircle, CheckCircle2, Download, FileSpreadsheet, Info, ChevronDown, ChevronUp } from 'lucide-react';

interface BulkUploadProps {
  onUploaded?: () => void;
}

export function BulkUpload({ onUploaded }: BulkUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [showConfirmClear, setShowConfirmClear] = useState(false);
  const [clearMessage, setClearMessage] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [showFieldGuide, setShowFieldGuide] = useState(false);

  const handleDownloadSampleCsv = () => {
    const csvContent =
      "vendor_id,name,address,phone,email,action_link,latitude,longitude,service_types,lead_time_minutes,service_hours,place_id,website\n" +
      "store_101,Joe's Artisan Pizza,123 Main St Austin TX 78701,+15125550101,owner@joespizza.com,https://order.joespizza.com,30.2672,-97.7431,\"DELIVERY,TAKEOUT\",30,\"Mon-Sun 11:00-23:00\",ChIJgUbEo8cfqokR5lP9_bManAE,https://joespizza.com\n" +
      "store_102,Tokyo Ramen Bar,456 Broadway Ave New York NY 10013,+12125550102,contact@tokyoramen.com,https://tokyoramen.com/menu,40.7209,-74.0007,\"TAKEOUT,DINE_IN\",20,\"Mon-Sat 12:00-22:00\",ChIJOwg_06VPwokRYk534QaPC8g,https://tokyoramen.com\n" +
      "store_103,Green Garden Salad Co,789 Market St San Francisco CA 94103,+14155550103,hello@greengardensf.com,https://greengardensf.com/order,37.7858,-122.4065,\"DELIVERY,TAKEOUT\",15,\"Mon-Fri 10:00-19:00\",ChIJd8BlQ2B-j4AR235Q_aI1W9Y,https://greengardensf.com\n";
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'feedops_bulk_merchants_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    setUploading(true);
    setResult(null);
    setClearMessage(null);
    try {
      const data = await api.uploadSpreadsheet(e.target.files[0], replaceExisting);
      setResult(data);
      if (data.status !== 'error') onUploaded?.();
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleClearAllMerchants = async () => {
    setClearing(true);
    setClearMessage(null);
    try {
      const res = await api.clearAllMerchants();
      if (res.status === 'success') {
        setClearMessage(`Successfully cleared ${res.cleared_count ?? 0} merchant records from Firestore.`);
        setResult(null);
        onUploaded?.();
      } else {
        setClearMessage(`Error: ${res.message || 'Failed to clear merchants.'}`);
      }
    } catch (err: any) {
      setClearMessage(`Error: ${err.message || 'Failed to clear merchants.'}`);
    } finally {
      setClearing(false);
      setShowConfirmClear(false);
    }
  };

  return (
    <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <UploadCloud className="w-5 h-5 text-blue-500" />
            Bulk Restaurant Upload
          </h2>
          <button
            type="button"
            onClick={handleDownloadSampleCsv}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg border border-blue-200 dark:border-blue-800 transition-colors shadow-sm"
            title="Download ready-to-use CSV template"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Sample CSV</span>
          </button>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          Upload multi-location restaurant spreadsheets. Compatible with CSV, XLSX, or XLS exports.
        </p>

        {/* Interactive Field Specifications Toggle */}
        <div className="mb-3">
          <button
            type="button"
            onClick={() => setShowFieldGuide(!showFieldGuide)}
            className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 flex items-center gap-1 font-medium"
          >
            <Info className="w-3.5 h-3.5 text-blue-500" />
            <span>{showFieldGuide ? 'Hide Required Field Specifications' : 'View Required & Optional Fields'}</span>
            {showFieldGuide ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          {showFieldGuide && (
            <div className="mt-2 p-3 bg-slate-50 dark:bg-slate-900/80 rounded-lg border border-slate-200 dark:border-slate-700 text-xs space-y-2 animate-in fade-in">
              <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <FileSpreadsheet className="w-3.5 h-3.5 text-blue-500" />
                Google Actions Center Supported Columns:
              </div>
              <ul className="space-y-1 text-slate-600 dark:text-slate-400 list-disc list-inside">
                <li><strong className="text-slate-800 dark:text-slate-200">Mandatory:</strong> <code className="font-mono text-[11px] text-blue-600 dark:text-blue-400">name</code>, <code className="font-mono text-[11px] text-blue-600 dark:text-blue-400">address</code>, <code className="font-mono text-[11px] text-blue-600 dark:text-blue-400">action_link</code>, <code className="font-mono text-[11px] text-blue-600 dark:text-blue-400">vendor_id</code></li>
                <li><strong className="text-slate-800 dark:text-slate-200">Recommended:</strong> <code className="font-mono text-[11px]">phone</code> (E.164), <code className="font-mono text-[11px]">email</code>, <code className="font-mono text-[11px]">latitude</code>, <code className="font-mono text-[11px]">longitude</code>, <code className="font-mono text-[11px]">service_types</code> (DELIVERY/TAKEOUT/DINE_IN)</li>
                <li><strong className="text-slate-800 dark:text-slate-200">Optional:</strong> <code className="font-mono text-[11px]">lead_time_minutes</code>, <code className="font-mono text-[11px]">service_hours</code>, <code className="font-mono text-[11px]">place_id</code> (Instant match), <code className="font-mono text-[11px]">website</code></li>
              </ul>
            </div>
          )}
        </div>

        <div className="flex items-center justify-center w-full">
          <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-slate-300 border-dashed rounded-lg cursor-pointer bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-700/50 hover:bg-slate-100 dark:border-slate-600 dark:hover:border-slate-500 transition-colors">
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              {uploading ? (
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-2" />
              ) : (
                <UploadCloud className="w-8 h-8 text-slate-400 dark:text-slate-500 mb-2" />
              )}
              <p className="mb-1 text-sm text-slate-600 dark:text-slate-300 font-medium">
                <span>Click to upload store spreadsheet</span> or drag and drop
              </p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">CSV or Excel (MAX. 10MB)</p>
            </div>
            <input type="file" className="hidden" accept=".csv, .xlsx, .xls" onChange={handleFileChange} disabled={uploading || clearing} />
          </label>
        </div>

        <label className="flex items-start gap-2 mt-3 cursor-pointer">
          <input
            type="checkbox"
            checked={replaceExisting}
            onChange={(e) => setReplaceExisting(e.target.checked)}
            disabled={uploading || clearing}
            className="mt-0.5"
          />
          <span className="text-xs text-slate-500 dark:text-slate-400">
            <span className="font-medium text-slate-700 dark:text-slate-300">Replace existing roster</span> -- any
            merchant not in this file gets removed from the active feed.
          </span>
        </label>

        {/* Clear All Merchants Action Bar */}
        <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between flex-wrap gap-2">
          <span className="text-[11px] text-slate-400 dark:text-slate-500">
            Need to purge uploaded test stores?
          </span>

          {!showConfirmClear ? (
            <button
              type="button"
              onClick={() => setShowConfirmClear(true)}
              disabled={clearing || uploading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg border border-rose-200 dark:border-rose-900/60 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear All Merchants</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 animate-in fade-in">
              <span className="text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> Purge all stores?
              </span>
              <button
                type="button"
                onClick={handleClearAllMerchants}
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

        {result && result.status !== 'error' && (() => {
          const persisted: any[] = result.persisted || [];
          const readyCount = persisted.filter((p) => p.status === 'matched' || p.status === 'approved').length;
          const reviewCount = persisted.length - readyCount;
          return (
            <div className="mt-4 space-y-3">
              <div className="p-4 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 rounded-lg text-sm font-medium">
                Parsed {result.merchants_count} merchant{result.merchants_count === 1 ? '' : 's'}.
                {!!readyCount && <> {readyCount} matched automatically -- now in the Merchants table below.</>}
                {!!reviewCount && <> {reviewCount} need{reviewCount === 1 ? 's' : ''} a manual match decision -- now in the Global Triage Queue above.</>}
                {!!result.removed_count && (
                  <> {result.removed_count} merchant{result.removed_count === 1 ? '' : 's'} not in this file {result.removed_count === 1 ? 'was' : 'were'} removed from the active feed.</>
                )}
              </div>

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
          );
        })()}
      </div>
    </div>
  );
}

