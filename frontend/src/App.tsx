import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Auth/Login';
import AggregatorLayout from './components/Layout/AggregatorLayout';
import MerchantLayout from './components/Layout/MerchantLayout';
import { OnboardingJourney } from './components/OnboardingJourney';
import { Merchants } from './components/Aggregator/Merchants';
import { ApiWebhooks } from './components/Aggregator/ApiWebhooks';
import { FeedsStep } from './components/Aggregator/onboarding/FeedsStep';
import { ConversionStep } from './components/Aggregator/onboarding/ConversionStep';
import { ReviewStep } from './components/Aggregator/onboarding/ReviewStep';
import { StepNav } from './components/Aggregator/onboarding/StepNav';
import { MyStore } from './components/Merchant/MyStore';
import { Menu } from './components/Merchant/Menu';
import { Services } from './components/Merchant/Services';
import { StoreView } from './components/Customer/StoreView';
import { MerchantOnboardingCard } from './components/MerchantOnboardingCard';
import { AskFeedOps } from './components/AskFeedOps';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<Login />} />

        {/* Public Routes */}
        <Route path="/store/:storeId" element={<StoreView />} />

        {/* Protected Routes (Aggregator) */}
        <Route path="/aggregator" element={<AggregatorLayout />}>
          <Route index element={<Navigate to="/aggregator/dashboard" replace />} />
          <Route path="dashboard" element={<OnboardingJourney />} />
          <Route path="merchants" element={<Merchants />} />
          <Route path="onboarding/setup" element={<StepNav stepKey="setup"><ApiWebhooks /></StepNav>} />
          <Route path="onboarding/feeds-sandbox" element={<StepNav stepKey="feeds_sandbox"><FeedsStep environment="sandbox" /></StepNav>} />
          <Route path="onboarding/conversion-sandbox" element={<StepNav stepKey="conversion_sandbox"><ConversionStep environment="sandbox" /></StepNav>} />
          <Route path="onboarding/sandbox-review" element={<StepNav stepKey="sandbox_to_prod_review"><ReviewStep stepKey="sandbox_to_prod_review" /></StepNav>} />
          <Route path="onboarding/feeds-production" element={<StepNav stepKey="feeds_production"><FeedsStep environment="production" /></StepNav>} />
          <Route path="onboarding/conversion-production" element={<StepNav stepKey="conversion_production"><ConversionStep environment="production" /></StepNav>} />
          <Route path="onboarding/launch-review" element={<StepNav stepKey="launch_review"><ReviewStep stepKey="launch_review" /></StepNav>} />
        </Route>

        {/* Protected Routes (Merchant) */}
        <Route path="/merchant" element={<MerchantLayout />}>
          <Route index element={<Navigate to="/merchant/store" replace />} />
          <Route path="store" element={<MyStore />} />
          <Route path="menu" element={<Menu />} />
          <Route path="services" element={<Services />} />
          <Route path="onboard" element={<MerchantOnboardingCard />} />
          <Route path="ask" element={<AskFeedOps />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
