import React, { useState } from 'react';
import { HelpCircle, Loader2, BookOpen } from 'lucide-react';

import { api } from '@/lib/api';

interface Source {
  title: string;
  content: string;
}

export const AskFeedOps: React.FC = () => {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedCategory, setSelectedCategory] = useState<string>('All');

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

      {/* Main Content Card */}
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
                  <div key={i} className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 bg-slate-50/50 dark:bg-slate-900/40 text-xs">
                    <p className="font-bold text-slate-900 dark:text-white mb-1">{s.title}</p>
                    <p className="text-slate-600 dark:text-slate-300 line-clamp-4 leading-relaxed">{s.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
  );
};

