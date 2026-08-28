import { MenuFeedStatus } from '../MenuFeedStatus';
import { MenuFeedHealth } from '../MenuFeedHealth';

interface MenuDevelopmentStepProps {
  environment: 'sandbox' | 'production';
}

// Mirrors FeedsStep.tsx's composition for the Menu Feeds track. No Entity
// Match Assist here -- menu items attach to a merchant already matched via
// the Ordering Redirect Entity feed, so that's already handled there.
export function MenuDevelopmentStep({ environment }: MenuDevelopmentStepProps) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
        Menu Feeds -- {environment === 'sandbox' ? 'Sandbox' : 'Production'} Development
      </h1>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MenuFeedStatus environment={environment} />
        <MenuFeedHealth environment={environment} />
      </div>
    </div>
  );
}
