import { ConversionTracking } from '../ConversionTracking';

interface ConversionStepProps {
  environment: 'sandbox' | 'production';
}

export function ConversionStep({ environment }: ConversionStepProps) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
        Conversion Tracking in {environment === 'sandbox' ? 'Sandbox' : 'Production'}
      </h1>
      <div className="grid grid-cols-1 gap-6">
        <ConversionTracking environment={environment} />
      </div>
    </div>
  );
}
