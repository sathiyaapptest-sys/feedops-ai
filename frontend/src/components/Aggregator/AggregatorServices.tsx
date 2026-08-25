import { UploadCloud } from 'lucide-react';
import { BulkUpload } from './BulkUpload';
import { BulkMenuUpload } from './BulkMenuUpload';
import { FeedHealth } from './FeedHealth';

export function AggregatorServices() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
        <UploadCloud className="w-6 h-6 text-blue-500" />
        Services
      </h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BulkUpload />
        <BulkMenuUpload />
        <FeedHealth />
      </div>
    </div>
  );
}
