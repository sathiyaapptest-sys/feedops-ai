import { useEffect, useState, useRef } from 'react';
import { Terminal } from 'lucide-react';

export function AgentStreamViewer() {
  const [logs, setLogs] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const eventSource = new EventSource('http://localhost:8000/api/agent/stream');

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.thought) {
          setLogs(prev => [...prev, `[LiveAgent] ${data.thought}`]);
        }
      } catch (e) {
        console.error("Failed to parse SSE data", e);
      }
    };

    eventSource.onerror = (err) => {
      console.error("EventSource failed:", err);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="p-6 bg-slate-900 rounded-xl shadow-sm border border-slate-700 flex flex-col h-full min-h-[300px]">
      <div className="flex items-center gap-2 mb-4 border-b border-slate-700 pb-2">
        <Terminal className="w-5 h-5 text-green-400" />
        <h2 className="text-lg font-mono text-green-400">Agent Thought Stream</h2>
      </div>
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto font-mono text-sm text-slate-300 space-y-1"
      >
        {logs.length === 0 ? (
          <p className="text-slate-500 italic">Waiting for agent activity...</p>
        ) : (
          logs.map((log, i) => <div key={i}>{log}</div>)
        )}
      </div>
    </div>
  );
}
