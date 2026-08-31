import React, { useState } from 'react';
import { HelpCircle, Loader2, BookOpen, Image as ImageIcon, Sparkles } from 'lucide-react';

import { api } from '@/lib/api';

interface Source {
  title: string;
  content: string;
}

interface ScreenshotStepSuggestion {
  step_key: string;
  suggested_status: string;
  evidence_quote: string;
}

interface ScreenshotFeedSuggestion {
  feed_type: string;
  suggested_status: string;
  confidence: number;
  evidence_quote: string;
}

interface ScreenshotAnalysis {
  screen_type: string;
  summary: string;
  next_steps: string[];
  feed_suggestions: ScreenshotFeedSuggestion[];
  onboarding_step_suggestions: ScreenshotStepSuggestion[];
}

/** Playbook citation card -- collapsed to a 4-line preview by default (source
 * chunks are full markdown sections and can be long), expandable in place so
 * nothing is permanently cut off. */
const SourceCard: React.FC<{ source: Source }> = ({ source }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 bg-slate-50/50 dark:bg-slate-900/40 text-xs">
      <p className="font-bold text-slate-900 dark:text-white mb-1">{source.title}</p>
      <p
        className={`text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap ${
          expanded ? '' : 'line-clamp-4'
        }`}
      >
        {source.content}
      </p>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-2 text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:underline"
      >
        {expanded ? 'Show less' : 'Show more'}
      </button>
    </div>
  );
};

export const AskFeedOps: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'ask' | 'screenshot'>('ask');

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  // Screenshot Insights tab -- onboarding-only, advisory: reads a Partner
  // Portal screenshot and explains it grounded in the real playbook, never
  // writes an onboarding step or feed status directly.
  const [screenshotAnalyzing, setScreenshotAnalyzing] = useState(false);
  const [screenshotError, setScreenshotError] = useState<string | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [screenshotAnalysis, setScreenshotAnalysis] = useState<ScreenshotAnalysis | null>(null);
  const [screenshotInsight, setScreenshotInsight] = useState<{ answer: string; sources: Source[] } | null>(null);

  const handleScreenshotUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    setScreenshotAnalyzing(true);
    setScreenshotError(null);
    setScreenshotAnalysis(null);
    setScreenshotInsight(null);
    setScreenshotPreview(URL.createObjectURL(file));

    try {
      const res = await api.getScreenshotInsight(file);
      if (res.status === 'error') {
        setScreenshotError(res.message || 'Could not read that screenshot.');
      } else {
        setScreenshotAnalysis(res.data);
        setScreenshotInsight(res.insight);
      }
    } catch (err: any) {
      setScreenshotError(err.message || 'Could not read that screenshot.');
    } finally {
      setScreenshotAnalyzing(false);
      e.target.value = '';
    }
  };

  const TOP_FAQS = [
    // Step 1: Setup & Account
    {
      step: 'Step 1: Setup',
      category: 'Setup & Auth',
      question: "What is the difference between the numeric Partner ID and the SFTP username?",
    },
    {
      step: 'Step 1: Setup',
      category: 'Setup & Auth',
      question: "What initial configurations are required in Google Partner Portal before uploading feeds?",
    },

    // Step 2: Restaurant Roster & Entity Matching
    {
      step: 'Step 2: Merchants',
      category: 'Roster & Places',
      question: "What fields are required and optional for bulk restaurant roster CSV/Excel upload?",
    },
    {
      step: 'Step 2: Merchants',
      category: 'Roster & Places',
      question: "What are the formatting rules for bulk restaurant data (E.164 phone, lead times, service types)?",
    },
    {
      step: 'Step 2: Merchants',
      category: 'Roster & Places',
      question: "Why must we upload the restaurant list and verify them against Google Places before pushing feeds?",
    },
    {
      step: 'Step 2: Merchants',
      category: 'Roster & Places',
      question: "How does FeedOps detect and exclude permanently or temporarily closed restaurants?",
    },
    {
      step: 'Step 2: Merchants',
      category: 'Roster & Places',
      question: "What is the role of the Human-in-the-Loop (HITL) Triage Queue for low-confidence entity matches?",
    },

    // Step 3: Sandbox Feeds & Ingestion
    {
      step: 'Step 3: Sandbox Feeds',
      category: 'Feeds & SFTP',
      question: "Why do we generate three separate feeds (entity, action, service) for Google Ordering Redirect?",
    },
    {
      step: 'Step 3: Sandbox Feeds',
      category: 'Feeds & SFTP',
      question: "Why must descriptor files (*.filesetdesc.json) be uploaded before data files via SFTP?",
    },
    {
      step: 'Step 3: Sandbox Feeds',
      category: 'Proto Spec',
      question: "What is the madden.ingestion proto format required by Google Actions Center?",
    },

    // Step 4: Sandbox Conversion Tracking
    {
      step: 'Step 4: Sandbox Conversion',
      category: 'Conversion',
      question: "What is Google's 3-events-in-7-days conversion tracking compliance requirement?",
    },
    {
      step: 'Step 4: Sandbox Conversion',
      category: 'Conversion',
      question: "What is the difference between the Merchant's Action Landing URL and Google's Conversion Tracking Endpoint?",
    },
    {
      step: 'Step 4: Sandbox Conversion',
      category: 'Conversion',
      question: "How does the end-to-end rwg_token redirect, landing page capture, and checkout conversion flow work?",
    },
    {
      step: 'Step 4: Sandbox Conversion',
      category: 'Conversion',
      question: "What do HTTP status codes 200, 400, and 500 mean during conversion tracking pings?",
    },

    // Step 5: Sandbox-to-Prod Review
    {
      step: 'Step 5: Sandbox Review',
      category: 'Launch Checklist',
      question: "What are the exact criteria for the 3-day feed streak required for Sandbox-to-Prod review?",
    },
    {
      step: 'Step 5: Sandbox Review',
      category: 'Launch Checklist',
      question: "Why is feed acceptance verification self-reported instead of automated via an API?",
    },

    // Step 6: Production Feeds
    {
      step: 'Step 6: Prod Feeds',
      category: 'Feeds & SFTP',
      question: "How does the daily feed push Cloud Run Job automate production feed deliveries?",
    },
    {
      step: 'Step 6: Prod Feeds',
      category: 'Feeds & SFTP',
      question: "What happens if a restaurant's operating hours, service types, or lead times change in production?",
    },

    // Step 7: Production Launch & Sweeps
    {
      step: 'Step 7: Production Launch',
      category: 'Launch Checklist',
      question: "What final checks does Google require before flipping an aggregator to Live in Production?",
    },
    {
      step: 'Step 7: Production Conversion',
      category: 'Conversion',
      question: "How do we switch conversion tracking from Sandbox (/debug/collect) to Live Production (/collect) upon launch approval?",
    },
    {
      step: 'Step 7: Production Sweeps',
      category: 'Conversion',
      question: "How do automated weekly conversion sweeps prevent live production integrations from lapsing?",
    },

    // Technical Deep-Dives
    {
      step: 'Technical',
      category: 'Redirect Links',
      question: "What are the formatting rules for action_link deep links with fulfillment action types?",
    },
    {
      step: 'Technical',
      category: 'Proto Spec',
      question: "How are lead times (Duration with 's' suffix) and operating hours formatted in madden feeds?",
    },
    // Menu vs Ordering Redirect
    {
      step: 'Menu Track',
      category: 'Menu Feeds',
      question: "Is a menu required for Google Ordering Redirect, and how do Ordering Redirect vs Menu Feeds differ?",
    },
    {
      step: 'Technical',
      category: 'Menu Feeds',
      question: "What is the difference between Google Ordering Redirect feeds and Google Menu Feeds?",
    },
  ];

  const CATEGORIES = ['All', '7-Step Journey', 'Menu Feeds', 'Feeds & SFTP', 'Conversion', 'Roster & Places', 'Proto Spec', 'Launch Checklist'];

  const executeAsk = async (queryText: string) => {
    if (!queryText.trim()) return;
    setQuestion(queryText);
    setLoading(true);
    setError(null);
    setAnswer(null);
    setSources([]);

    try {
      const result = await api.askSupport(queryText);
      setAnswer(result.answer);
      setSources(result.sources || []);
    } catch (err: any) {
      setError(err.message || 'Ask FeedOps failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    executeAsk(question);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-500/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 rounded-lg">
              <HelpCircle className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Ask FeedOps</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                RAG-grounded support agent answering directly from Google Actions Center playbooks and proto specs.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('ask')}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 ${
            activeTab === 'ask'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
          }`}
        >
          <HelpCircle className="w-4 h-4" />
          Ask a Question
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('screenshot')}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 ${
            activeTab === 'screenshot'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
          }`}
        >
          <ImageIcon className="w-4 h-4" />
          Screenshot Insights
        </button>
      </div>

      {activeTab === 'ask' && (
      /* Main Content Card */
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 flex flex-col gap-6">
        {/* Top 20 Clickable FAQs */}

          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                7-Step Journey &amp; Technical Playbook FAQs (Click to Ask)
              </p>
              <span className="text-xs font-medium text-slate-500">
                {TOP_FAQS.filter(f => selectedCategory === 'All' || (selectedCategory === '7-Step Journey' ? f.step.startsWith('Step') : f.category === selectedCategory)).length} Questions
              </span>
            </div>

            {/* Category Filters */}
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                    selectedCategory === cat
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Responsive 3-Column FAQ Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 max-h-[380px] overflow-y-auto pr-1">
              {TOP_FAQS
                .filter((faq) => {
                  if (selectedCategory === 'All') return true;
                  if (selectedCategory === '7-Step Journey') return faq.step.startsWith('Step');
                  return faq.category === selectedCategory;
                })
                .map((faq, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => executeAsk(faq.question)}
                    disabled={loading}
                    className="text-left p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 hover:bg-blue-50/80 dark:hover:bg-blue-900/20 hover:border-blue-300 dark:hover:border-blue-700 transition-all text-xs group flex flex-col justify-between gap-2 disabled:opacity-50 shadow-xs"
                  >
                    <span className="text-slate-800 dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-blue-300 font-medium leading-relaxed">
                      {faq.question}
                    </span>
                    <div className="flex items-center justify-between gap-1 pt-1 border-t border-slate-200/50 dark:border-slate-800">
                      <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wide">
                        {faq.step}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-medium">
                        {faq.category}
                      </span>
                    </div>
                  </button>
                ))}
            </div>
          </div>

          {/* Question Input Form */}
          <form onSubmit={handleAsk} className="flex gap-3 pt-2 border-t border-slate-200 dark:border-slate-700">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a custom question about Actions Center feeds, SFTP, conversion requirements..."
              className="flex-1 border border-slate-300 dark:border-slate-600 rounded-xl px-4 py-3 text-sm bg-white dark:bg-slate-700/80 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-xs"
            />
            <button
              type="submit"
              disabled={loading || !question.trim()}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold disabled:opacity-50 flex items-center gap-2 transition-colors shadow-sm"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Ask Agent'}
            </button>
          </form>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 p-4 rounded-xl text-sm border border-red-200 dark:border-red-800">
              {error}
            </div>
          )}

          {answer && (
            <div className="bg-slate-50 dark:bg-slate-900/90 rounded-xl p-5 text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed border border-slate-200 dark:border-slate-800 shadow-xs">
              {answer}
            </div>
          )}

          {sources.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                <BookOpen className="w-4 h-4 text-blue-500" />
                <span>Cited directly from Actions Center Domain Playbook</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {sources.map((s, i) => (
                  <SourceCard key={i} source={s} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'screenshot' && (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 flex flex-col gap-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white mb-1">
                Onboarding Screenshot Insights
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl">
                Upload a Partner Portal onboarding screen (Ingestion History, a task rollup, or the 7-step
                Onboarding Plan) and get a plain-language read grounded in the real playbook. Advisory only --
                this never writes an onboarding step or feed status for you.
              </p>
            </div>
            <label
              className="cursor-pointer px-4 py-2.5 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs ring-2 ring-blue-400/60 hover:ring-blue-400 transition-all flex items-center gap-2 shrink-0"
            >
              {screenshotAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
              <span>{screenshotAnalyzing ? 'Reading...' : 'Upload Screenshot'}</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={screenshotAnalyzing}
                onChange={handleScreenshotUpload}
              />
            </label>
          </div>

          {screenshotError && (
            <div className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 p-4 rounded-xl text-sm border border-red-200 dark:border-red-800">
              {screenshotError}
            </div>
          )}

          {(screenshotPreview || screenshotAnalysis) && (
            <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-5">
              {screenshotPreview && (
                <img
                  src={screenshotPreview}
                  alt="Uploaded Partner Portal screenshot"
                  className="w-full h-auto rounded-xl border border-slate-200 dark:border-slate-700 object-cover"
                />
              )}

              {screenshotAnalysis && (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                      {screenshotAnalysis.screen_type.replace(/_/g, ' ')}
                    </span>
                  </div>

                  <p className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
                    {screenshotAnalysis.summary}
                  </p>

                  {screenshotAnalysis.next_steps?.length > 0 && (
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                        Next Steps
                      </p>
                      <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-300 list-disc list-inside">
                        {screenshotAnalysis.next_steps.map((step, i) => (
                          <li key={i}>{step}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {(screenshotAnalysis.onboarding_step_suggestions?.length > 0 ||
                    screenshotAnalysis.feed_suggestions?.length > 0) && (
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">
                        Detected (advisory -- not saved)
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {screenshotAnalysis.onboarding_step_suggestions?.map((s, i) => (
                          <span
                            key={`step-${i}`}
                            className={`text-[10px] font-semibold px-2 py-1 rounded-md ${
                              s.suggested_status === 'complete'
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                            }`}
                            title={s.evidence_quote}
                          >
                            {s.step_key.replace(/_/g, ' ')}: {s.suggested_status.replace(/_/g, ' ')}
                          </span>
                        ))}
                        {screenshotAnalysis.feed_suggestions?.map((f, i) => (
                          <span
                            key={`feed-${i}`}
                            className={`text-[10px] font-semibold px-2 py-1 rounded-md ${
                              f.suggested_status === 'confirmed_clean'
                                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                            }`}
                            title={f.evidence_quote}
                          >
                            {f.feed_type}: {f.suggested_status.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {screenshotInsight && (
            <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                <Sparkles className="w-4 h-4 text-blue-500" />
                <span>Grounded Insight</span>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/90 rounded-xl p-5 text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed border border-slate-200 dark:border-slate-800 shadow-xs">
                {screenshotInsight.answer}
              </div>

              {screenshotInsight.sources?.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    <BookOpen className="w-4 h-4 text-blue-500" />
                    <span>Cited directly from Actions Center Domain Playbook</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {screenshotInsight.sources.map((s, i) => (
                      <SourceCard key={i} source={s} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

