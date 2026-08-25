import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Auth/Login';
import AggregatorLayout from './components/Layout/AggregatorLayout';
import MerchantLayout from './components/Layout/MerchantLayout';
import { ReadinessScorecard } from './components/Aggregator/ReadinessScorecard';
import { TriageQueue } from './components/Aggregator/TriageQueue';
import { BulkUpload } from './components/Aggregator/BulkUpload';
import { BulkMenuUpload } from './components/Aggregator/BulkMenuUpload';
import { FeedHealth } from './components/Aggregator/FeedHealth';
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
          <Route path="dashboard" element={
            <div className="space-y-6">
              <ReadinessScorecard />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <TriageQueue />
                <BulkUpload />
                <BulkMenuUpload />
                <FeedHealth />
              </div>
            </div>
          } />
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
