import React, { useState } from 'react';
import { Terminal, ChevronDown, ChevronRight, Activity, Zap, ShieldAlert } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAgentStream } from '@/hooks/useAgentStream';
import { cn } from '@/lib/utils';
import { StreamEvent } from '@/types';

const AgentIcon = ({ agent }: { agent: StreamEvent['agent'] }) => {
  switch (agent) {
    case 'EntityMatcher': return <Zap className="w-4 h-4 text-blue-400" />;
    case 'ConversionSentry': return <Activity className="w-4 h-4 text-emerald-400" />;
    case 'SchemaAuditor': return <ShieldAlert className="w-4 h-4 text-amber-400" />;
  }
};

const EventRow = ({ event }: { event: StreamEvent }) => {
  const [expanded, setExpanded] = useState(false);

  const statusColor = 
    event.status === 'success' ? 'bg-emerald-500' : 
    event.status === 'error' ? 'bg-red-500' : 'bg-amber-500 animate-pulse';

  return (
    <div className="flex flex-col text-sm font-mono border-b border-border/40 last:border-0 py-2">
      <div 
        className="flex items-center gap-3 cursor-pointer hover:bg-accent/20 px-2 py-1 rounded transition-colors"
        onClick={() => event.data && setExpanded(!expanded)}
      >
        <div className={cn("w-2 h-2 rounded-full", statusColor)} />
        <AgentIcon agent={event.agent} />
        <span className="font-semibold text-muted-foreground">{event.agent}</span>
        <span className="text-foreground/80">invoked</span>
        <span className="bg-primary/20 text-primary px-1.5 py-0.5 rounded text-xs font-medium">
          {event.tool}
        </span>
        
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {event.latencyMs && <span>{event.latencyMs}ms</span>}
          {event.data ? (
            expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />
          ) : <div className="w-4" />}
        </div>
      </div>
      
      <AnimatePresence>
        {expanded && event.data && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2 ml-7 p-3 bg-black/40 rounded-md overflow-x-auto text-xs text-emerald-400/90">
              <pre>{JSON.stringify(event.data, null, 2)}</pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const LiveAgentThoughtStream: React.FC = () => {
  const { events } = useAgentStream();

  return (
    <div className="bg-card text-card-foreground rounded-xl border border-border shadow-sm flex flex-col h-[500px] overflow-hidden">
      <div className="bg-muted px-4 py-3 flex items-center gap-2 border-b border-border">
        <Terminal className="w-5 h-5 text-muted-foreground" />
        <h3 className="font-semibold text-sm">Live ADK Sub-Agent Stream</h3>
        <div className="ml-auto flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="text-xs text-muted-foreground">Active</span>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-1 bg-zinc-950 text-zinc-300">
        {events.map((ev, i) => (
          <EventRow key={`${ev.id}-${i}`} event={ev} />
        ))}
        {events.length === 0 && (
          <div className="text-center text-muted-foreground text-sm mt-10">
            Waiting for agent activity...
          </div>
        )}
      </div>
    </div>
  );
};
