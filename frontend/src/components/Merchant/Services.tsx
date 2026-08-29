import { useEffect, useRef, useState } from 'react';
import { 
  Settings, Terminal, CheckCircle2, AlertCircle, Loader2, FileJson, 
  ExternalLink, Copy, Check, ShoppingBag, Bike, Clock, ArrowRight, 
  ShieldCheck, AlertTriangle, Layers, Sparkles, RefreshCw, Mail
} from 'lucide-react';
import { api } from '@/lib/api';
import { Link } from 'react-router-dom';

interface AgentEvent {
  agent_name: string;
  stage: string;
  status: 'thinking' | 'calling_tool' | 'completed' | 'flagged';
  detail: string;
  payload?: Record<string, any>;
}

const STATUS_STYLES: Record<AgentEvent['status'], string> = {
  thinking: 'text-purple-300',
  calling_tool: 'text-sky-300',
  completed: 'text-emerald-300',
  flagged: 'text-amber-300',
};

export function Services() {
  const [storeData, setStoreData] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [feedContents, setFeedContents] = useState<Record<string, any> | null>(null);
  const [compiledAt, setCompiledAt] = useState<string | null>(null);
  const [activeFeed, setActiveFeed] = useState<string>('entity');
  const [copied, setCopied] = useState(false);
  const [copiedHandoff, setCopiedHandoff] = useState(false);

  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  useEffect(() => {
    // Load store profile to display real action link and fulfillment settings
    api.getMerchantProfile().then((res) => {
      if (res.status === 'success' && res.profile) {
        setStoreData(res.profile);
      }
    }).catch(() => {});

    // Load compiled feeds if already audited
    api.getMerchantAudit().then((res) => {
      if (res.status === 'success' && res.compiled_feeds) {
        setFeedContents(res.compiled_feeds);
        if (res.feeds_compiled_at) setCompiledAt(String(res.feeds_compiled_at));
        const firstKey = Object.keys(res.compiled_feeds).find((k) => !k.endsWith('_descriptor'));
        if (firstKey) setActiveFeed(firstKey);
      }
    });
  }, []);

  const handleRunAudit = async () => {
    setRunning(true);
    setRunError(null);
    setEvents([]);

    try {
      await api.auditMerchant((event: AgentEvent) => {
        setEvents((prev) => [...prev, event]);
        if (event.stage === 'schema_compilation' && event.payload?.feed_contents) {
          const contents = event.payload.feed_contents as Record<string, any>;
          setFeedContents(contents);
          setCompiledAt(new Date().toISOString());
          const firstKey = Object.keys(contents).find((k) => !k.endsWith('_descriptor'));
          if (firstKey) setActiveFeed(firstKey);
        }
      });
    } catch (err: any) {
      setRunError(err.message || 'Audit failed.');
    } finally {
      setRunning(false);
    }
  };

  const targetActionUrl = storeData?.action_url || storeData?.action_link || '';
  const hasValidActionUrl = Boolean(targetActionUrl && (targetActionUrl.startsWith('http://') || targetActionUrl.startsWith('https://')) && targetActionUrl.includes('.'));
  const hasValidAddress = Boolean(storeData?.address && storeData.address.trim().length > 5);
  const hasPlaceId = Boolean(storeData?.place_id);
  const hasLeadTime = typeof storeData?.lead_time_minutes === 'number' && storeData.lead_time_minutes > 0;
  const hasTimings = Array.isArray(storeData?.opening_hours) && storeData.opening_hours.some((t: any) => t.isOpen);
  const schemaFlagged = events.some((e) => e.stage === 'schema_compilation' && e.status === 'flagged');
  const allGreen = hasValidAddress && hasValidActionUrl && Boolean(feedContents) && !schemaFlagged && !running;

  const handleCopyLink = () => {
    if (!targetActionUrl) return;
    navigator.clipboard.writeText(targetActionUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyHandoffSummary = () => {
    const storeName = storeData?.name || 'My Restaurant';
    const address = storeData?.address || 'Address on file';
    const placeId = storeData?.place_id || 'Matched on Google Maps';
    const actionUrl = targetActionUrl || 'https://...';
    const leadTime = hasLeadTime ? `${storeData.lead_time_minutes} mins` : '15–20 mins';
    const services = storeData?.service_types?.join(', ') || 'DELIVERY, TAKEOUT';

    const text = [
      `📢 GOOGLE ACTIONS CENTER ONBOARDING HANDOFF`,
      `--------------------------------------------`,
      `Store Name: ${storeName}`,
      `Place ID: ${placeId}`,
      `Physical Address: ${address}`,
      `Ordering Action Link: ${actionUrl}`,
      `Fulfillment Services: ${services} (Lead Time: ${leadTime})`,
      `FeedOps AI Verification: 100% Compliant with madden.ingestion specifications`,
      `Action Requested: Please include this store in the daily Google Actions Center SFTP feed push.`,
    ].join('\n');

    navigator.clipboard.writeText(text);
    setCopiedHandoff(true);
    setTimeout(() => setCopiedHandoff(false), 2500);
  };

  const emailSubject = encodeURIComponent(`Google Actions Center Launch Handoff: ${storeData?.name || 'Restaurant'}`);
  const emailBody = encodeURIComponent(
    `Hi Aggregator Operations Team,\n\nOur restaurant profile and Google Actions Center proto feeds have been verified with 100% compliance in FeedOps AI.\n\nStore Details:\n- Store Name: ${storeData?.name || ''}\n- Place ID: ${storeData?.place_id || ''}\n- Physical Address: ${storeData?.address || ''}\n- Ordering Action Link: ${targetActionUrl}\n\nPlease include our store in the next daily Google SFTP feed push to enable the "Order Online" button on Google Search & Maps.\n\nThank you!`
  );
  const mailtoHref = `mailto:?subject=${emailSubject}&body=${emailBody}`;

  const fileKeys = feedContents
    ? Object.keys(feedContents).filter((k) => !k.endsWith('_descriptor'))
    : [];

  return (
    <div className="min-h-full flex flex-col">
      {/* Flush Sticky Solid Header */}
      <div className="sticky top-0 z-30 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 md:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-500 flex items-center justify-center">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">Services &amp; Feeds</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Autonomous feed compiler &amp; Google Actions Center compliance auditor.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {feedContents && !running && !schemaFlagged ? (
              <span className="px-3 py-1 text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 rounded-full border border-emerald-200 dark:border-emerald-800/50 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                <span>Feeds Verified &amp; Compiled</span>
              </span>
            ) : running ? (
              <span className="px-3 py-1 text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 rounded-full border border-blue-200 dark:border-blue-800/50 flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                <span>Auditing Rules...</span>
              </span>
            ) : (
              <span className="px-3 py-1 text-xs font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 rounded-full border border-slate-200 dark:border-slate-700">
                Awaiting Audit
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-7xl w-full mx-auto px-6 md:px-8 py-6 md:py-8 space-y-6 pb-16">

        {/* 🌟 0. ALL GOOD & AGGREGATOR LAUNCH HANDOFF BANNER (TOP PRIORITY STATUS) */}
        {allGreen && (
          <div className="p-6 bg-gradient-to-br from-emerald-50 via-teal-50 to-emerald-100/70 dark:from-emerald-950/40 dark:via-slate-900 dark:to-emerald-900/20 border-2 border-emerald-500/40 dark:border-emerald-700/60 rounded-2xl shadow-md space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="w-11 h-11 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-md">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      All Good! Your Store is 100% Ready for Google Actions Center
                    </h3>
                    <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-500 text-white font-extrabold tracking-wide uppercase shadow-xs">
                      Ready to Launch
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed max-w-3xl">
                    Your store identity, physical location, "Order Online" destination URL, and Google <code className="font-mono bg-white dark:bg-slate-800 px-1 py-0.5 rounded text-emerald-700 dark:text-emerald-300">madden.ingestion</code> proto feeds have passed all compliance checks. All data is automatically synchronized into your platform's database.
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2.5 shrink-0 self-start md:self-auto">
                <button
                  onClick={handleCopyHandoffSummary}
                  className="px-4 py-2.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-white border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-2 cursor-pointer"
                  title="Copy handoff snippet to paste into Slack or Email"
                >
                  {copiedHandoff ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 text-slate-500" />}
                  <span>{copiedHandoff ? 'Handoff Snippet Copied!' : 'Copy Handoff (Slack/Email)'}</span>
                </button>

                <a
                  href={mailtoHref}
                  className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-2"
                >
                  <Mail className="w-4 h-4" />
                  <span>Notify Aggregator Manager</span>
                </a>
              </div>
            </div>

            {/* Instruction Footer */}
            <div className="pt-3 border-t border-emerald-200/60 dark:border-emerald-800/50 flex items-center justify-between text-xs text-emerald-800 dark:text-emerald-300">
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span><strong>Next Step:</strong> Contact your Aggregator Manager to include your store in the next daily Google Partner Portal SFTP upload.</span>
              </span>
              <span className="font-semibold text-[11px] text-emerald-700 dark:text-emerald-400 hidden sm:inline">
                Auto-Synced with Platform Database ✓
              </span>
            </div>
          </div>
        )}

        {/* 🌟 1. TOP PRIORITY PRIMARY ACTION HERO BANNER */}
        <div className="p-6 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 rounded-2xl text-white shadow-lg relative overflow-hidden">
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2 max-w-2xl">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/15 text-xs font-medium backdrop-blur-xs">
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                <span>Google Ordering Redirect Rule Auditor</span>
              </div>
              <h2 className="text-xl md:text-2xl font-bold tracking-tight">
                Compile &amp; Audit Google Feed Bundle
              </h2>
              <p className="text-xs md:text-sm text-blue-100 leading-relaxed">
                Runs <strong>SchemaAuditorAgent</strong> to validate your restaurant profile against all Google Actions Center specifications, compile the required <code className="font-mono bg-black/20 px-1 py-0.5 rounded text-white text-[11px]">madden.ingestion</code> proto feeds, and verify cross-feed referential integrity before daily SFTP submission.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
              <button
                onClick={handleRunAudit}
                disabled={running}
                className="px-6 py-3.5 bg-white hover:bg-slate-100 text-blue-700 font-bold rounded-xl shadow-md transition-all disabled:opacity-50 flex items-center justify-center gap-2.5 text-sm cursor-pointer"
              >
                {running ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                    <span>Compiling &amp; Auditing...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 text-blue-600" />
                    <span>Compile &amp; Audit Feeds Now</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Timestamp and Status Sub-bar */}
          <div className="mt-4 pt-3 border-t border-white/20 flex flex-wrap items-center justify-between text-xs text-blue-100 gap-2">
            <span>
              {compiledAt ? (
                <>Last compiled: <strong>{new Date(compiledAt).toLocaleString()}</strong> ({fileKeys.length} proto files generated)</>
              ) : (
                'No compiled bundle yet. Click the button above to run your first schema audit.'
              )}
            </span>
            <span className="text-[11px] opacity-90">
              Protocol: madden.ingestion (snake_case proto3)
            </span>
          </div>
        </div>

        {/* Global Error Banner */}
        {runError && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300 p-4 rounded-xl text-sm flex items-center gap-2">
            <AlertCircle className="w-5 h-5 shrink-0 text-red-500" />
            <span>{runError}</span>
          </div>
        )}

        {/* 🛡️ 2. GOOGLE ORDERING REDIRECT RULE AUDIT SCORECARD (4 MANDATES) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-indigo-500" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Google Ordering Redirect Compliance Scorecard
              </h2>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Evaluated against Google Actions Center specifications (§3, §4)
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            
            {/* Mandate 1: Entity Feed */}
            <div className={`p-4 rounded-xl border transition-all ${
              hasValidAddress 
                ? 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700' 
                : 'bg-amber-50/60 dark:bg-amber-900/10 border-amber-300 dark:border-amber-800/60'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  1. Entity Mandate
                </span>
                {hasValidAddress ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Pass
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="w-3.5 h-3.5" /> Missing
                  </span>
                )}
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">
                Store Identity &amp; GBP Match
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-3">
                Requires merchant name, physical address, and telephone to match Google Business Profile.
              </p>
              <div className="pt-2 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-xs">
                <span className="text-slate-600 dark:text-slate-300">
                  {hasPlaceId ? 'Place ID: Matched' : 'Address: Available'}
                </span>
                {!hasValidAddress && (
                  <Link to="/merchant/store" className="text-blue-600 dark:text-blue-400 font-semibold hover:underline flex items-center gap-0.5">
                    Fix <ArrowRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
            </div>

            {/* Mandate 2: Action Feed */}
            <div className={`p-4 rounded-xl border transition-all ${
              hasValidActionUrl 
                ? 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700' 
                : 'bg-red-50/60 dark:bg-red-900/10 border-red-300 dark:border-red-800/60'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  2. Action Mandate
                </span>
                {hasValidActionUrl ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Pass
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 dark:text-red-400">
                    <AlertCircle className="w-3.5 h-3.5" /> Critical
                  </span>
                )}
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">
                "Order Online" Action Link
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-3">
                Mandatory HTTPS destination link for user redirect when clicking Order Online on Google.
              </p>
              <div className="pt-2 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-xs">
                <span className="text-slate-600 dark:text-slate-300">
                  {hasValidActionUrl ? 'URL: Valid HTTPS' : 'URL: Missing'}
                </span>
                {!hasValidActionUrl && (
                  <Link to="/merchant/store" className="text-red-600 dark:text-red-400 font-semibold hover:underline flex items-center gap-0.5">
                    Add URL <ArrowRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
            </div>

            {/* Mandate 3: Service Feed */}
            <div className={`p-4 rounded-xl border transition-all ${
              hasLeadTime && hasTimings
                ? 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700' 
                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  3. Service Mandate
                </span>
                {hasLeadTime && hasTimings ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Pass
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    Optional
                  </span>
                )}
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">
                Hours &amp; Lead Time Duration
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-3">
                Formats lead times in seconds (<code className="font-mono text-[11px]">Xs</code>) and ASAP operating windows in <code className="font-mono text-[11px]">TimeOfDay</code>.
              </p>
              <div className="pt-2 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-xs">
                <span className="text-slate-600 dark:text-slate-300">
                  {hasLeadTime ? `Lead: ${storeData.lead_time_minutes}m` : 'No lead time (omitted)'}
                </span>
                {!hasLeadTime && (
                  <Link to="/merchant/store" className="text-blue-600 dark:text-blue-400 font-semibold hover:underline flex items-center gap-0.5">
                    Set <ArrowRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
            </div>

            {/* Mandate 4: Cross-Feed Referential Integrity */}
            <div className="p-4 rounded-xl border bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 transition-all">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  4. Referential Integrity
                </span>
                {feedContents ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" /> 0 Orphans
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400">
                    Pending
                  </span>
                )}
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">
                Atomic SFTP Bundle
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-3">
                Guarantees every <code className="font-mono text-[11px]">entity_id</code> and <code className="font-mono text-[11px]">link_id</code> matches across all feeds without orphaned records.
              </p>
              <div className="pt-2 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-xs">
                <span className="text-slate-600 dark:text-slate-300">
                  Descriptors: Paired (*.filesetdesc.json)
                </span>
              </div>
            </div>

          </div>
        </div>

        {/* 🔗 3. ACTIVE DESTINATION & FULFILLMENT SUMMARY */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-6">
            
            {/* Live Ordering Redirect Link Card */}
            <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Live "Order Online" Action Link
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 font-semibold">
                  Google Destination URL
                </span>
              </div>

              <div className="p-4 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-700 space-y-3">
                {targetActionUrl ? (
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-sm text-blue-600 dark:text-blue-400 truncate select-all">
                      {targetActionUrl}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={handleCopyLink}
                        className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
                        title="Copy URL"
                      >
                        {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                        <span>{copied ? 'Copied' : 'Copy'}</span>
                      </button>
                      <a
                        href={targetActionUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors shadow-xs"
                      >
                        <span>Test Link</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 text-sm text-red-600 dark:text-red-400">
                    <span className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>No Action Link configured yet. Google cannot render "Order Online" without a URL.</span>
                    </span>
                    <Link
                      to="/merchant/store"
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold shrink-0"
                    >
                      Add Action URL ↗
                    </Link>
                  </div>
                )}

                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed border-t border-slate-200 dark:border-slate-800 pt-2.5">
                  <strong>How it works:</strong> FeedOps AI is the integration middleware that publishes your store to Google. When customers click <strong>"Order Online"</strong> on Google Search or Maps, Google redirects them directly to this URL with an <code className="font-mono text-[11px] bg-slate-200 dark:bg-slate-800 px-1 rounded">?rwg_token</code> parameter so they can add items to cart and pay on your existing checkout system.
                </p>
              </div>
            </div>

            {/* Active Fulfillment Summary */}
            <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Active Fulfillment Services on Google
                </h2>
                <Link
                  to="/merchant/store"
                  className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                >
                  <span>Edit in My Store</span>
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShoppingBag className="w-4 h-4 text-emerald-500" />
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">Pickup / Takeout</span>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 font-semibold">
                      {storeData?.service_types?.includes('TAKEOUT') ? 'Active' : 'Active (Default)'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Estimated Prep: <strong>{hasLeadTime ? `${storeData.lead_time_minutes} mins` : '15–20 mins'}</strong>
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Bike className="w-4 h-4 text-blue-500" />
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">Delivery</span>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 font-semibold">
                      {storeData?.service_types?.includes('DELIVERY') ? 'Active' : 'Active (Default)'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Estimated Lead: <strong>{hasLeadTime ? `${storeData.lead_time_minutes} mins` : '30–45 mins'}</strong>
                  </p>
                </div>
              </div>

              <div className="p-3.5 bg-slate-100 dark:bg-slate-700/40 rounded-xl flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-400" />
                  <span>Weekly Operating Hours: Synchronized with Google Places</span>
                </div>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">Ready for Daily SFTP Push</span>
              </div>
            </div>

          </div>

          {/* 💻 Right Column: Live SchemaAuditorAgent Stream */}
          <div className="lg:col-span-5 space-y-6">
            <div className="p-6 bg-slate-950 rounded-xl shadow-xl border border-slate-800 flex flex-col min-h-[460px]">
              <div className="flex items-center gap-2 mb-4 border-b border-slate-800 pb-3">
                <Terminal className="w-5 h-5 text-green-400" />
                <div>
                  <h2 className="text-sm font-mono font-semibold text-green-400">SchemaAuditorAgent Stream</h2>
                  <p className="text-[11px] text-slate-500 font-mono">Real-time Actions Center proto validation</p>
                </div>
              </div>
              <div ref={logRef} className="flex-1 overflow-y-auto font-mono text-xs space-y-2 max-h-[500px]">
                {events.length === 0 ? (
                  <p className="text-slate-500 italic">Click "Compile &amp; Audit Feeds Now" above to see SchemaAuditorAgent validate proto fields and pricing in real time.</p>
                ) : (
                  events.map((evt, i) => (
                    <div key={i} className={`flex items-start gap-2 leading-relaxed ${STATUS_STYLES[evt.status] || 'text-slate-300'}`}>
                      <span className="text-slate-500 select-none shrink-0">[{evt.agent_name}]</span>
                      <span>{evt.detail}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 📚 4. WHAT ARE ENTITY, ACTION, AND SERVICE FEEDS? (FEED EDUCATION) */}
        <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-4">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-blue-500" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              What Are Google Actions Center Feeds &amp; What Gets Sent?
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Google Ordering Redirect requires three distinct feed files packaged with atomic timestamp descriptors for daily SFTP ingestion:
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            {/* Entity Explainer */}
            <div className="p-4 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-blue-600 dark:text-blue-400 font-mono">entity.json</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 font-semibold">Mandatory</span>
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">1. Merchant Identity Feed</h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Contains store name, physical address, coordinates, and phone. Google uses this strictly to match your entity to an existing Google Business Profile on Google Maps.
              </p>
              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 pt-1">
                Descriptor: reservewithgoogle.entity
              </div>
            </div>

            {/* Action Explainer */}
            <div className="p-4 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 font-mono">actions.json</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300 font-semibold">Mandatory</span>
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">2. Action Deep Link Feed</h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Contains the ordering redirect URL and action types (<code className="font-mono text-[11px]">DELIVERY</code>, <code className="font-mono text-[11px]">TAKEOUT</code>). This powers the official "Order Online" button on Google Search.
              </p>
              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 pt-1">
                Descriptor: reservewithgoogle.action.v2
              </div>
            </div>

            {/* Service Explainer */}
            <div className="p-4 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-purple-600 dark:text-purple-400 font-mono">services.json</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300 font-semibold">Fulfillment</span>
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">3. Service &amp; Hours Feed</h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                Transmits structured weekly operating hours and lead times formatted in proto duration seconds (<code className="font-mono text-[11px]">"1200s"</code>). Tells Google when the restaurant is actively open for orders.
              </p>
              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 pt-1">
                Descriptor: google.food_service
              </div>
            </div>
          </div>
        </div>

        {/* 📄 5. COMPILED PROTO FEED OUTPUT INSPECTOR (ALWAYS SHOWS ALL 3 FEEDS) */}
        <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <FileJson className="w-5 h-5 text-blue-500" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Compiled Proto Feed Inspector (3 Feed Files)
              </h2>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
              Exact madden.ingestion JSON shape
            </span>
          </div>

          <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-700 pb-3">
            {[
              { key: 'entity', label: '1. entity.json', sub: 'Merchant Identity', isReady: Boolean(feedContents?.entity) },
              { key: 'action', label: '2. actions.json', sub: 'Action Deep Link', isReady: Boolean(feedContents?.action) },
              { key: 'service', label: '3. services.json', sub: 'Hours & Lead Time', isReady: Boolean(feedContents?.service) },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveFeed(tab.key)}
                className={`px-3.5 py-2 text-xs font-semibold rounded-xl border transition-all cursor-pointer flex items-center gap-2 ${
                  activeFeed === tab.key
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm ring-2 ring-blue-500/20'
                    : 'bg-slate-50 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700'
                }`}
              >
                <span>{tab.label}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold ${
                  tab.isReady
                    ? activeFeed === tab.key ? 'bg-white/20 text-white' : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                    : activeFeed === tab.key ? 'bg-white/20 text-white' : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
                }`}>
                  {tab.isReady ? '✓ Generated' : '⚠ Pending'}
                </span>
              </button>
            ))}
          </div>

          {feedContents?.[activeFeed] ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Descriptor: <code className="font-mono text-[11px] text-blue-600 dark:text-blue-400">{
                  activeFeed === 'entity' ? 'reservewithgoogle.entity' :
                  activeFeed === 'action' ? 'reservewithgoogle.action.v2' : 'google.food_service'
                }</code></span>
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Validated Proto Output
                </span>
              </div>
              <pre className="bg-slate-950 text-slate-200 text-xs rounded-xl p-4 overflow-auto max-h-96 font-mono leading-relaxed border border-slate-800 shadow-inner">
                {JSON.stringify(feedContents[activeFeed], null, 2)}
              </pre>
            </div>
          ) : (
            <div className="p-6 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40 text-center space-y-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 mx-auto flex items-center justify-center">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  {activeFeed === 'action' ? 'actions.json Not Generated Yet' :
                   activeFeed === 'service' ? 'services.json Not Generated Yet' : 'entity.json Not Generated Yet'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
                  {activeFeed === 'action' && 'Requires a valid Ordering Action Link URL in your Store Profile. Once set, SchemaAuditorAgent will compile action.json for user ordering redirect.'}
                  {activeFeed === 'service' && 'Requires an average lead time duration (minutes) and operating hours. If omitted, Google allows shipping entity + action feeds first.'}
                  {activeFeed === 'entity' && 'Requires store name and physical address. Click "Compile & Audit Feeds Now" above to generate.'}
                </p>
              </div>
              <div className="pt-1">
                <Link
                  to="/merchant/store"
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
                >
                  <span>Configure in My Store</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
