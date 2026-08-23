export interface MerchantDetails {
  storeName: string;
  address: string;
  phone: string;
  cuisineType: string;
  lat: number;
  lng: number;
  hasGoogleProfile: boolean;
}

export interface StreamEvent {
  id: string;
  agent: 'EntityMatcher' | 'ConversionSentry' | 'SchemaAuditor';
  tool: string;
  status: 'pending' | 'success' | 'error';
  latencyMs?: number;
  data?: any;
  timestamp: string;
}

export interface MatchCandidate {
  id: string;
  internalName: string;
  internalAddress: string;
  googleName: string;
  googleAddress: string;
  confidenceScore: number;
  placeId: string;
}

export interface ReadinessScore {
  totalMerchants: number;
  placeIdMatchPercent: number;
  feedStatus: 'Healthy' | 'Degraded' | 'Failing';
  sandboxSftpDays: number;
  prodSftpDays: number;
  syntheticSuccessRate: number;
  deepLinkErrors: number;
}
