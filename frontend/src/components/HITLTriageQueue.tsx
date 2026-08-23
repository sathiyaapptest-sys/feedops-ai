import React from 'react';
import { CheckCircle2, XCircle, AlertTriangle, ArrowRight } from 'lucide-react';
import { MatchCandidate } from '@/types';
import { cn } from '@/lib/utils';

const MOCK_QUEUE: MatchCandidate[] = [
  {
    id: '1',
    internalName: "Joe's Pizza",
    internalAddress: "123 Main St, New York, NY",
    googleName: "Joe's Pizza NYC",
    googleAddress: "123 Main Street, NY 10001",
    confidenceScore: 0.88,
    placeId: 'ChIJxxxx123'
  },
  {
    id: '2',
    internalName: "Burger King #442",
    internalAddress: "500 Broad St, Newark",
    googleName: "Burger King",
    googleAddress: "498 Broad Street, Newark, NJ",
    confidenceScore: 0.72,
    placeId: 'ChIJyyyy456'
  }
];

export const HITLTriageQueue: React.FC = () => {
  return (
    <div className="bg-card text-card-foreground rounded-xl border border-border shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-lg">HITL Triage Queue</h3>
          <p className="text-sm text-muted-foreground">Entities requiring manual review (Confidence &lt; 0.90)</p>
        </div>
        <div className="bg-amber-500/10 text-amber-600 dark:text-amber-400 px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" />
          {MOCK_QUEUE.length} Pending
        </div>
      </div>
      
      <div className="divide-y divide-border">
        {MOCK_QUEUE.map((item) => {
          const isAmber = item.confidenceScore >= 0.7 && item.confidenceScore < 0.9;
          const scoreColor = isAmber ? 'text-amber-500 bg-amber-500/10' : 'text-red-500 bg-red-500/10';
          
          return (
            <div key={item.id} className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className={cn("px-2.5 py-1 rounded font-mono text-xs font-bold", scoreColor)}>
                  {(item.confidenceScore * 100).toFixed(0)}% MATCH
                </div>
                <div className="flex gap-2">
                  <button className="flex items-center gap-1.5 bg-red-500/10 text-red-600 hover:bg-red-500/20 px-3 py-1.5 rounded text-sm font-medium transition-colors">
                    <XCircle className="w-4 h-4" /> Reject / Remap
                  </button>
                  <button className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1.5 rounded text-sm font-medium transition-colors">
                    <CheckCircle2 className="w-4 h-4" /> Approve Match
                  </button>
                </div>
              </div>
              
              <div className="grid grid-cols-[1fr_auto_1fr] gap-6 items-center">
                <div className="bg-muted p-4 rounded-lg border border-border">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2 font-semibold">Internal Record</div>
                  <div className="font-medium">{item.internalName}</div>
                  <div className="text-sm text-muted-foreground mt-1">{item.internalAddress}</div>
                </div>
                
                <ArrowRight className="text-muted-foreground w-5 h-5" />
                
                <div className="bg-primary/5 p-4 rounded-lg border border-primary/20">
                  <div className="text-xs text-primary uppercase tracking-wider mb-2 font-semibold flex items-center justify-between">
                    Google Places Candidate
                    <span className="font-mono text-[10px] opacity-70">{item.placeId}</span>
                  </div>
                  <div className="font-medium">{item.googleName}</div>
                  <div className="text-sm text-muted-foreground mt-1">{item.googleAddress}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
