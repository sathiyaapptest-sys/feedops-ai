import { useState } from 'react';
import { api } from '../../lib/api';
import { MapPin, Loader2, Copy, ExternalLink, Check } from 'lucide-react';

const CONFIDENCE_THRESHOLD = 0.9;

const SOURCE_LABELS: Record<string, string> = {
  stored: 'from prior onboarding match',
  fresh_lookup: 'fresh Google Places search',
  no_merchant_record: 'no matching merchant found',
};

interface Suggestion {
  entity_id: string;
  entity_name: string;
  state: string | null;
  confidence: number | null;
  place_id: string | null;
  suggested_maps_url: string | null;
  source: 'stored' | 'fresh_lookup' | 'no_merchant_record';
  note: string | null;
}

export function EntityMatchAssist() {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    setUploading(true);
    setResult(null);
    try {
      const data = await api.assistEntityMatch(e.target.files[0]);
      setResult(data);
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleCopy = async (entityId: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(entityId);
      setTimeout(() => setCopiedId((cur) => (cur === entityId ? null : cur)), 1500);
    } catch (err) {
      console.error(err);
    }
  };

  const suggestions: Suggestion[] = result?.suggestions || [];

  return (
    <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 md:col-span-2">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-1">
        <MapPin className="w-5 h-5 text-blue-500" />
        Entity Match Assist
      </h2>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
        Upload the Entity export from Partner Portal &rarr; Inventory &rarr; Entity to get suggested Google Maps links
        for unmatched entities. Suggestions only -- copy the link into Partner Portal's "Edit match" screen yourself;
        there's no API to push this back to Google.
      </p>

      <div className="flex items-center justify-center w-full">
        <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-slate-300 border-dashed rounded-lg cursor-pointer bg-slate-50 dark:hover:bg-slate-800 dark:bg-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:hover:border-slate-500">
          <div className="flex flex-col items-center justify-center pt-4 pb-4">
            {uploading ? (
              <Loader2 className="w-6 h-6 text-slate-500 animate-spin mb-1" />
            ) : (
              <MapPin className="w-6 h-6 text-slate-500 mb-1" />
            )}
            <p className="text-sm text-slate-500 dark:text-slate-400">
              <span className="font-semibold">Click to upload</span> the Entity export (CSV or TSV)
            </p>
          </div>
          <input type="file" className="hidden" accept=".csv,.tsv,.txt" onChange={handleFileChange} disabled={uploading} />
        </label>
      </div>

      {result && result.status === 'error' && (
        <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg text-sm">
          {result.message || 'Upload failed.'}
        </div>
      )}

      {result && result.status !== 'error' && (
        <div className="mt-4 space-y-3">
          <div className="p-3 bg-slate-50 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 rounded-lg text-xs">
            {result.rows_total} entit{result.rows_total === 1 ? 'y' : 'ies'} read -- {suggestions.length} need a Maps
            match.
          </div>

          {suggestions.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left text-slate-500 dark:text-slate-400">
                <thead className="text-xs text-slate-700 uppercase bg-slate-50 dark:bg-slate-700 dark:text-slate-300">
                  <tr>
                    <th className="px-3 py-2 rounded-tl-lg">Entity Name</th>
                    <th className="px-3 py-2">Entity ID</th>
                    <th className="px-3 py-2">State</th>
                    <th className="px-3 py-2">Confidence</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2 rounded-tr-lg">Suggested Maps URL</th>
                  </tr>
                </thead>
                <tbody>
                  {suggestions.map((s) => (
                    <tr key={s.entity_id} className="bg-white dark:bg-slate-800 border-b dark:border-slate-700 align-top">
                      <td className="px-3 py-2 font-medium text-slate-900 dark:text-white">{s.entity_name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{s.entity_id}</td>
                      <td className="px-3 py-2 text-xs">{s.state || '--'}</td>
                      <td className="px-3 py-2">
                        {s.confidence != null ? (
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-medium ${
                              s.confidence >= CONFIDENCE_THRESHOLD
                                ? 'bg-green-100 text-green-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {Math.round(s.confidence * 100)}%
                          </span>
                        ) : (
                          '--'
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">{SOURCE_LABELS[s.source] || s.source}</td>
                      <td className="px-3 py-2">
                        {s.suggested_maps_url ? (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleCopy(s.entity_id, s.suggested_maps_url!)}
                              className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700"
                              title="Copy Maps URL"
                            >
                              {copiedId === s.entity_id ? (
                                <Check className="w-4 h-4 text-green-500" />
                              ) : (
                                <Copy className="w-4 h-4" />
                              )}
                            </button>
                            <a
                              href={s.suggested_maps_url}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700"
                              title="Open in Google Maps"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          </div>
                        ) : (
                          <span className="text-amber-700 dark:text-amber-300 text-xs">{s.note || 'No suggestion available.'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
