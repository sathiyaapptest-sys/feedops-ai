import React from 'react';
import { Rocket, Server, Activity, CheckCircle2, ShieldAlert } from 'lucide-react';
import { ReadinessScore } from '@/types';
import { cn } from '@/lib/utils';

const mockData: ReadinessScore = {
  totalMerchants: 14,
  placeIdMatchPercent: 100,
  feedStatus: 'Healthy',
  sandboxSftpDays: 3,
  prodSftpDays: 1,
  syntheticSuccessRate: 98.5,
  deepLinkErrors: 0,
};

const MetricCard = ({ title, value, subtext, icon: Icon, isSuccess }: any) => (
  <div className="bg-card p-5 rounded-xl border border-border flex flex-col gap-2 shadow-sm">
    <div className="flex items-center justify-between text-muted-foreground mb-1">
      <span className="text-sm font-medium">{title}</span>
      <Icon className="w-4 h-4" />
    </div>
    <div className="text-2xl font-bold">{value}</div>
    <div className={cn("text-xs font-medium", isSuccess ? "text-emerald-500" : "text-amber-500")}>
      {subtext}
    </div>
  </div>
);

const ProgressBar = ({ steps, current }: { steps: number, current: number }) => (
  <div className="flex gap-1.5 mt-2">
    {Array.from({ length: steps }).map((_, i) => (
      <div 
        key={i} 
        className={cn(
          "h-2 flex-1 rounded-full transition-colors",
          i < current ? "bg-emerald-500" : "bg-muted-foreground/20"
        )} 
      />
    ))}
  </div>
);

export const LaunchReadinessScorecard: React.FC = () => {
  const isReady = 
    mockData.placeIdMatchPercent >= 90 && 
    mockData.feedStatus === 'Healthy' && 
    mockData.prodSftpDays >= 3 && 
    mockData.syntheticSuccessRate >= 97 &&
    mockData.deepLinkErrors === 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <MetricCard 
          title="Total Active Merchants" 
          value={mockData.totalMerchants} 
          subtext="Target: > 10" 
          icon={Server} 
          isSuccess={mockData.totalMerchants >= 10} 
        />
        <MetricCard 
          title="Place ID Match Ratio" 
          value={`${mockData.placeIdMatchPercent}%`} 
          subtext="Target: > 90%" 
          icon={CheckCircle2} 
          isSuccess={mockData.placeIdMatchPercent >= 90} 
        />
        <MetricCard 
          title="Deep-Link Health" 
          value={`${mockData.deepLinkErrors} Errors`} 
          subtext="Target: 0 (4xx/5xx)" 
          icon={Activity} 
          isSuccess={mockData.deepLinkErrors === 0} 
        />
      </div>

      <div className="bg-card p-6 rounded-xl border border-border shadow-sm grid grid-cols-2 gap-8">
        <div>
          <h4 className="font-semibold mb-4 text-sm flex items-center justify-between">
            3-Day SFTP Ingestion Tracker
          </h4>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs font-medium mb-1">
                <span>Sandbox Environment</span>
                <span className={mockData.sandboxSftpDays >= 3 ? "text-emerald-500" : "text-muted-foreground"}>
                  {mockData.sandboxSftpDays}/3 Days
                </span>
              </div>
              <ProgressBar steps={3} current={mockData.sandboxSftpDays} />
            </div>
            <div>
              <div className="flex justify-between text-xs font-medium mb-1">
                <span>Production Environment</span>
                <span className={mockData.prodSftpDays >= 3 ? "text-emerald-500" : "text-amber-500"}>
                  {mockData.prodSftpDays}/3 Days
                </span>
              </div>
              <ProgressBar steps={3} current={mockData.prodSftpDays} />
            </div>
          </div>
        </div>

        <div>
          <h4 className="font-semibold mb-4 text-sm">7-Day Synthetic Conversion Monitor</h4>
          <div className="bg-muted rounded-lg p-4 flex items-center gap-4 border border-border">
            <div className="w-12 h-12 rounded-full border-4 border-emerald-500 flex items-center justify-center font-bold text-sm">
              {mockData.syntheticSuccessRate}%
            </div>
            <div>
              <div className="font-medium text-sm">Success Rate (Test Tokens)</div>
              <div className="text-xs text-muted-foreground mt-0.5">Threshold: &gt; 97% required</div>
            </div>
          </div>
        </div>
      </div>

      <button 
        disabled={!isReady}
        className={cn(
          "w-full flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-lg transition-all",
          isReady 
            ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-[1.01] shadow-lg shadow-primary/20" 
            : "bg-muted text-muted-foreground cursor-not-allowed border border-border"
        )}
      >
        <Rocket className="w-5 h-5" />
        Request Production Launch Review
      </button>
      
      {!isReady && (
        <div className="flex items-center justify-center gap-2 text-sm text-amber-500">
          <ShieldAlert className="w-4 h-4" />
          Missing requirements for production launch.
        </div>
      )}
    </div>
  );
};
