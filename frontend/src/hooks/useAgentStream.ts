import { useState, useEffect } from 'react';
import { StreamEvent } from '@/types';

const MOCK_EVENTS: StreamEvent[] = [
  { id: '1', agent: 'EntityMatcher', tool: 'google_places_search', status: 'pending', timestamp: new Date().toISOString(), data: { query: 'Joes Pizza NY' } },
  { id: '1', agent: 'EntityMatcher', tool: 'google_places_search', status: 'success', latencyMs: 204, timestamp: new Date().toISOString(), data: { place_id: 'ChIJxxxx', confidence: 0.95 } },
  { id: '2', agent: 'SchemaAuditor', tool: 'lint_schema', status: 'success', latencyMs: 45, timestamp: new Date().toISOString(), data: { errors: 0, warnings: 2 } },
  { id: '3', agent: 'ConversionSentry', tool: 'execute_rwg_ping', status: 'pending', timestamp: new Date().toISOString() },
  { id: '3', agent: 'ConversionSentry', tool: 'execute_rwg_ping', status: 'error', latencyMs: 800, timestamp: new Date().toISOString(), data: { error: '503 Service Unavailable' } },
];

export function useAgentStream() {
  const [events, setEvents] = useState<StreamEvent[]>([]);

  useEffect(() => {
    let currentIndex = 0;
    const interval = setInterval(() => {
      if (currentIndex < MOCK_EVENTS.length) {
        setEvents(prev => {
          // If it's an update to an existing event (same ID), replace it, otherwise append
          const newEvent = MOCK_EVENTS[currentIndex];
          const existingIdx = prev.findIndex(e => e.id === newEvent.id);
          if (existingIdx >= 0) {
            const next = [...prev];
            next[existingIdx] = newEvent;
            return next;
          }
          return [...prev, newEvent];
        });
        currentIndex++;
      } else {
        clearInterval(interval);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, []);

  return { events };
}
