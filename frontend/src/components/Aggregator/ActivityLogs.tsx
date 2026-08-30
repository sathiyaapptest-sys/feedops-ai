import { useState, useEffect, useRef } from 'react';
import { api } from '../../lib/api';
import {
  Activity,
  RefreshCw,
  Trash2,
  Filter,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Clock,
  User,
  Radio,
  FileCode,
  Search,
  ChevronDown,
  ChevronUp,
  Download,
  ShieldCheck,
  Server,
  Zap,
} from 'lucide-react';

interface ActivityLogItem {
  log_id: string;
  timestamp: string;
  action: string;
  actor: string;
  status: 'success' | 'warning' | 'error' | 'info';
  details: string;
  metadata?: Record<string, any>;
  duration_ms?: number;
  category?: string;
}

const CATEGORIES = [
  'All',
  'Feeds & SFTP',
  'Merchants & Places',
  'Conversion',
  'Menu & Vision',
  'AI Agents',
  'System',
];

export function ActivityLogs() {
  const [logs, setLogs] = useState<ActivityLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLiveStream, setIsLiveStream] = useState<boolean>(true);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [showConfirmClear, setShowConfirmClear] = useState(false);

  const liveTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchLogs = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await api.getActivityLogs(150, selectedCategory !== 'All' ? selectedCategory : undefined);
      if (res.status === 'ok' || Array.isArray(res.logs)) {
        setLogs(res.logs || []);
      } else {
        setError('Failed to fetch activity logs.');
      }
    } catch (err: any) {
      setError(err.message || 'Error communicating with backend.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs(false);
  }, [selectedCategory]);

  useEffect(() => {
    if (isLiveStream) {
      liveTimerRef.current = setInterval(() => {
        fetchLogs(true);
      }, 3000);
    } else if (liveTimerRef.current) {
      clearInterval(liveTimerRef.current);
    }
    return () => {
      if (liveTimerRef.current) clearInterval(liveTimerRef.current);
    };
  }, [isLiveStream, selectedCategory]);

  const handleClear = async () => {
    setClearing(true);
    try {
      await api.clearActivityLogs();
      setLogs([]);
      setShowConfirmClear(false);
    } catch (err: any) {
      setError(err.message || 'Could not clear activity logs.');
    } finally {
      setClearing(false);
    }
  };

  const handleExportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(logs, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `feedops_activity_logs_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const filteredLogs = logs.filter((log) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      log.action.toLowerCase().includes(q) ||
      log.details.toLowerCase().includes(q) ||
      log.actor.toLowerCase().includes(q) ||
      (log.category && log.category.toLowerCase().includes(q)) ||
      JSON.stringify(log.metadata || {}).toLowerCase().includes(q)
    );
  });

  const successCount = logs.filter((l) => l.status === 'success').length;
  const warningCount = logs.filter((l) => l.status === 'warning').length;
  const errorCount = logs.filter((l) => l.status === 'error').length;
  const avgDuration =
    logs.filter((l) => (l.duration_ms || 0) > 0).length > 0
      ? Math.round(
          logs.reduce((acc, l) => acc + (l.duration_ms || 0), 0) /
            logs.filter((l) => (l.duration_ms || 0) > 0).length
        )
      : 0;

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'success':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
            <CheckCircle2 className="w-3 h-3" /> SUCCESS
          </span>
        );
      case 'warning':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
            <AlertTriangle className="w-3 h-3" /> WARNING
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
            <XCircle className="w-3 h-3" /> ERROR
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
            <Info className="w-3 h-3" /> INFO
          </span>
        );
    }
  };

  const formatRelativeTime = (ts: string) => {
    try {
      const date = new Date(ts);
      const diff = Math.floor((Date.now() - date.getTime()) / 1000);
      if (diff < 5) return 'Just now';
      if (diff < 60) return `${diff}s ago`;
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return ts;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-500/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 rounded-lg">
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                Live Activity Stream &amp; Audit Logs
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Real-time operational audit trail across AI Agents, Google Actions Center feeds, Places matching, and Cloud Run jobs.
              </p>
            </div>
          </div>
        </div>

        {/* Live Stream & Action Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setIsLiveStream(!isLiveStream)}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
              isLiveStream
                ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 ring-2 ring-emerald-500/20'
                : 'bg-white text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
            }`}
          >
            <Radio className={`w-3.5 h-3.5 ${isLiveStream ? 'text-emerald-500 animate-pulse' : 'text-slate-400'}`} />
            <span>{isLiveStream ? 'Live Auto-Refresh (3s)' : 'Live Paused'}</span>
          </button>

          <button
            type="button"
            onClick={() => fetchLogs(false)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors shadow-sm"
            title="Manual Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={handleExportJson}
            disabled={logs.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors shadow-sm"
            title="Export JSON Audit Log"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export</span>
          </button>

          {!showConfirmClear ? (
            <button
              type="button"
              onClick={() => setShowConfirmClear(true)}
              disabled={logs.length === 0 || clearing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 rounded-lg transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5 animate-in fade-in">
              <button
                type="button"
                onClick={handleClear}
                disabled={clearing}
                className="px-2.5 py-1 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-md transition-colors"
              >
                {clearing ? 'Purging...' : 'Confirm Purge'}
              </button>
              <button
                type="button"
                onClick={() => setShowConfirmClear(false)}
                className="px-2 py-1 text-xs text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 rounded-md"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-xl text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <XCircle className="w-4 h-4 text-rose-500 shrink-0" />
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => setError(null)} className="text-rose-500 hover:text-rose-700 font-bold">
            &times;
          </button>
        </div>
      )}

      {/* Metrics Summary Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Total Logged
            </div>
            <div className="text-xl font-bold text-slate-900 dark:text-white mt-0.5">
              {logs.length}
            </div>
          </div>
          <div className="p-2 bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 rounded-lg">
            <Activity className="w-4 h-4" />
          </div>
        </div>

        <div className="p-3.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Successful Ops
            </div>
            <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
              {successCount}
            </div>
          </div>
          <div className="p-2 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 rounded-lg">
            <ShieldCheck className="w-4 h-4" />
          </div>
        </div>

        <div className="p-3.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Warnings / Errors
            </div>
            <div className="text-xl font-bold text-amber-600 dark:text-amber-400 mt-0.5">
              {warningCount + errorCount}
            </div>
          </div>
          <div className="p-2 bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 rounded-lg">
            <AlertTriangle className="w-4 h-4" />
          </div>
        </div>

        <div className="p-3.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Avg Latency
            </div>
            <div className="text-xl font-bold text-slate-900 dark:text-white mt-0.5">
              {avgDuration > 0 ? `${avgDuration}ms` : '< 50ms'}
            </div>
          </div>
          <div className="p-2 bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 rounded-lg">
            <Zap className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
          <Filter className="w-4 h-4 text-slate-400 mr-1 flex-shrink-0" />
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors ${
                selectedCategory === cat
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Search Bar */}
        <div className="relative min-w-[240px]">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search action, store, or payload..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Logs Feed Container */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-700/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Activity Stream ({filteredLogs.length} Events)
            </span>
          </div>
          {isLiveStream && (
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              <span>Streaming Live</span>
            </div>
          )}
        </div>

        {filteredLogs.length === 0 ? (
          <div className="p-12 text-center">
            <Activity className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
              {loading ? 'Fetching activity records...' : 'No activity logs found matching the filter.'}
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
              Trigger any action (e.g. Bulk Upload, SFTP Push, Conversion Ping) to watch live events arrive here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {filteredLogs.map((log) => {
              const isExpanded = expandedLogId === log.log_id;
              const hasMetadata = log.metadata && Object.keys(log.metadata).length > 0;

              return (
                <div
                  key={log.log_id}
                  className="p-4 hover:bg-slate-50/80 dark:hover:bg-slate-700/40 transition-colors text-xs"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                    {/* Main Log Info */}
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {renderStatusBadge(log.status)}
                        <span className="font-mono font-bold text-slate-900 dark:text-white">
                          {log.action}
                        </span>
                        {log.category && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                            {log.category}
                          </span>
                        )}
                        {log.duration_ms && log.duration_ms > 0 ? (
                          <span className="text-[10px] font-mono text-purple-600 dark:text-purple-400">
                            {Math.round(log.duration_ms)}ms
                          </span>
                        ) : null}
                      </div>

                      <p className="text-slate-700 dark:text-slate-300 font-normal leading-relaxed">
                        {log.details}
                      </p>

                      <div className="flex items-center gap-4 text-[11px] text-slate-400 dark:text-slate-500 pt-0.5 flex-wrap">
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3 text-slate-400" />
                          <span>{log.actor}</span>
                        </span>
                        <span className="flex items-center gap-1" title={log.timestamp}>
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span>{formatRelativeTime(log.timestamp)}</span>
                          <span className="text-[10px] text-slate-400">({new Date(log.timestamp).toLocaleTimeString()})</span>
                        </span>
                      </div>
                    </div>

                    {/* Metadata Toggle */}
                    {hasMetadata && (
                      <button
                        type="button"
                        onClick={() => setExpandedLogId(isExpanded ? null : log.log_id)}
                        className="self-start sm:self-center inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-700/50 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md transition-colors"
                      >
                        <FileCode className="w-3 h-3" />
                        <span>{isExpanded ? 'Hide Payload' : 'View Payload'}</span>
                        {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    )}
                  </div>

                  {/* Expanded JSON Inspector */}
                  {isExpanded && hasMetadata && (
                    <div className="mt-3 p-3 bg-slate-900 text-slate-200 rounded-lg font-mono text-[11px] overflow-x-auto border border-slate-800 animate-in fade-in">
                      <div className="text-[10px] text-slate-400 uppercase font-semibold mb-1 flex items-center justify-between">
                        <span>Event Metadata JSON</span>
                        <span>ID: {log.log_id}</span>
                      </div>
                      <pre>{JSON.stringify(log.metadata, null, 2)}</pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
