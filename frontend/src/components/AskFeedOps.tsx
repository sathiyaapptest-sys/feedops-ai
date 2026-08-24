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

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;

    setLoading(true);
    setError(null);
    setAnswer(null);
    setSources([]);

    try {
      const result = await api.askSupport(question);
      setAnswer(result.answer);
      setSources(result.sources || []);
    } catch (err: any) {
      setError(err.message || 'Ask FeedOps failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 w-full max-w-2xl mx-auto flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <HelpCircle className="w-5 h-5 text-blue-500" />
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Ask FeedOps</h2>
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400 -mt-2">
        Grounded in the real Actions Center playbook -- e.g. "What does portal error 'duplicate entry' mean?"
        or "What does conversion status 500 mean?"
      </p>

      <form onSubmit={handleAsk} className="flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question..."
          className="flex-1 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Ask'}
        </button>
      </form>

      {error && (
        <div className="bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-400 p-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {answer && (
        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-4 text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
          {answer}
        </div>
      )}

      {sources.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            <BookOpen className="w-3.5 h-3.5" />
            <span>Cited from the playbook</span>
          </div>
          {sources.map((s, i) => (
            <div key={i} className="border border-slate-200 dark:border-slate-700 rounded-lg p-3">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{s.title}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-3">{s.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
