import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Store, MapPin, Clock, Search, Loader2, Info, Sparkles, Terminal, AlertCircle, CheckCircle2, Bot, ExternalLink, ArrowRight } from 'lucide-react';
import { db, auth } from '../../lib/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { api } from '../../lib/api';

interface AgentEvent {
  agent_name: string;
  stage: string;
  status: 'thinking' | 'calling_tool' | 'completed' | 'flagged';
  detail: string;
  payload?: Record<string, unknown>;
}

const STATUS_STYLES: Record<AgentEvent['status'], string> = {
  thinking: 'text-purple-300',
  calling_tool: 'text-sky-300',
  completed: 'text-emerald-300',
  flagged: 'text-amber-300',
};

function isNameSimilar(a: string, b: string): boolean {
  if (!a || !b) return false;
  const STOPWORDS = new Set([
    'the', 'and', '&', 'cafe', 'café', 'restaurant', 'grill', 'bar', 'pizza',
    'pizzeria', 'kitchen', 'shack', 'mart', 'store', 'diner', 'llc', 'inc',
    'co', 'food', 'foods', 'bakery', 'bistro', 'pub', 'express', 'house', 'corner'
  ]);
  
  const getTokens = (str: string) => {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  };
  
  const tokensA = getTokens(a);
  const tokensB = getTokens(b);
  
  if (tokensA.length === 0 || tokensB.length === 0) {
    const normA = a.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normB = b.toLowerCase().replace(/[^a-z0-9]/g, '');
    return normA === normB;
  }
  
  let matchingTokens = 0;
  for (const tA of tokensA) {
    for (const tB of tokensB) {
      if (tA === tB || (tA.length > 3 && tB.length > 3 && (tA.startsWith(tB) || tB.startsWith(tA)))) {
        matchingTokens++;
        break;
      }
    }
  }
  
  const matchRatio = matchingTokens / Math.max(tokensA.length, tokensB.length);
  return matchRatio >= 0.5;
}

export function MyStore() {
  const navigate = useNavigate();
  const [placeIdInput, setPlaceIdInput] = useState('');
  
  const [storeName, setStoreName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [actionUrl, setActionUrl] = useState('');
  const [leadTimeMinutes, setLeadTimeMinutes] = useState<number | ''>('');
  
  const [serviceOptions, setServiceOptions] = useState({
    delivery: false,
    takeaway: true,
    inStore: true
  });

  const [timings, setTimings] = useState([
    { day: 'Monday', isOpen: true, openTime: '09:00', closeTime: '22:00' },
    { day: 'Tuesday', isOpen: true, openTime: '09:00', closeTime: '22:00' },
    { day: 'Wednesday', isOpen: true, openTime: '09:00', closeTime: '22:00' },
    { day: 'Thursday', isOpen: true, openTime: '09:00', closeTime: '22:00' },
    { day: 'Friday', isOpen: true, openTime: '09:00', closeTime: '22:00' },
    { day: 'Saturday', isOpen: true, openTime: '09:00', closeTime: '22:00' },
    { day: 'Sunday', isOpen: false, openTime: '09:00', closeTime: '22:00' },
  ]);

  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{type: 'error' | 'success' | 'info', text: string} | null>(null);

  // Live AI Agent Streaming States
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [agentError, setAgentError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [agentEvents]);

  useEffect(() => {
    if (auth.currentUser?.email) {
      setEmail(auth.currentUser.email);
    }

    // Load authoritative profile from backend /api/merchants/profile
    api.getMerchantProfile().then((res) => {
      if (res.status === 'success' && res.profile) {
        const p = res.profile;
        if (p.name) setStoreName(p.name);
        if (p.address) setAddress(p.address);
        if (p.telephone) setPhone(p.telephone);
        if (p.email) setEmail(p.email);
        if (p.action_url || p.action_link) setActionUrl(p.action_url || p.action_link);
        setPlaceIdInput(p.place_id || '');
        if (typeof p.lead_time_minutes === 'number') setLeadTimeMinutes(p.lead_time_minutes);
        if (Array.isArray(p.opening_hours) && p.opening_hours.length > 0) {
          setTimings(p.opening_hours);
        }
        if (Array.isArray(p.service_types)) {
          setServiceOptions({
            delivery: p.service_types.includes('DELIVERY'),
            takeaway: p.service_types.includes('TAKEOUT'),
            inStore: p.service_types.includes('DINE_IN') || p.service_types.includes('IN_STORE'),
          });
        }
      }
    }).catch(() => {
      // Fallback to client-side Firestore if API is unreachable
      if (auth.currentUser?.email) {
        const storeRef = doc(db, 'stores', auth.currentUser.email);
        getDoc(storeRef).then((snap) => {
          if (snap.exists()) {
            const data = snap.data();
            if (data.storeName) setStoreName(data.storeName);
            setPlaceIdInput(data.placeId || '');
            if (data.phone) setPhone(data.phone);
            if (data.email) setEmail(data.email);
            if (data.address) setAddress(data.address);
            if (data.actionUrl || data.action_url || data.action_link) setActionUrl(data.actionUrl || data.action_url || data.action_link);
            if (data.serviceOptions) setServiceOptions(data.serviceOptions);
            if (data.timings) setTimings(data.timings);
            if (typeof data.leadTimeMinutes === 'number') setLeadTimeMinutes(data.leadTimeMinutes);
          }
        }).catch(() => {});
      }
    });
  }, []);

  const updateTiming = (index: number, field: string, value: any) => {
    const newTimings = [...timings];
    newTimings[index] = { ...newTimings[index], [field]: value };
    setTimings(newTimings);
  };

  const applyPlaceData = (place: any, preserveInputs = false) => {
    if (!preserveInputs) {
      if (place.displayName?.text) setStoreName(place.displayName.text);
      if (place.formattedAddress) setAddress(place.formattedAddress);
    } else {
      // Only set if fields are empty; preserve what the merchant already typed
      if (!storeName && place.displayName?.text) setStoreName(place.displayName.text);
      if (!address && place.formattedAddress) setAddress(place.formattedAddress);
    }
    
    if (place.internationalPhoneNumber || place.nationalPhoneNumber) {
      setPhone(place.internationalPhoneNumber || place.nationalPhoneNumber);
    }
    
    if (place.regularOpeningHours?.periods) {
      const newTimings = [
        { day: 'Monday', isOpen: false, openTime: '09:00', closeTime: '22:00' },
        { day: 'Tuesday', isOpen: false, openTime: '09:00', closeTime: '22:00' },
        { day: 'Wednesday', isOpen: false, openTime: '09:00', closeTime: '22:00' },
        { day: 'Thursday', isOpen: false, openTime: '09:00', closeTime: '22:00' },
        { day: 'Friday', isOpen: false, openTime: '09:00', closeTime: '22:00' },
        { day: 'Saturday', isOpen: false, openTime: '09:00', closeTime: '22:00' },
        { day: 'Sunday', isOpen: false, openTime: '09:00', closeTime: '22:00' },
      ];
      
      place.regularOpeningHours.periods.forEach((period: any) => {
        if (period.open && period.close) {
          const dayIndex = period.open.day; // 0 is Sunday
          const mappedIndex = dayIndex === 0 ? 6 : dayIndex - 1;
          
          const openHour = (period.open.hour || 0).toString().padStart(2, '0');
          const openMin = (period.open.minute || 0).toString().padStart(2, '0');
          const closeHour = (period.close.hour || 0).toString().padStart(2, '0');
          const closeMin = (period.close.minute || 0).toString().padStart(2, '0');
          
          newTimings[mappedIndex].isOpen = true;
          newTimings[mappedIndex].openTime = `${openHour}:${openMin}`;
          newTimings[mappedIndex].closeTime = `${closeHour}:${closeMin}`;
        }
      });
      setTimings(newTimings);
    }
  };

  const handleFetchByPlaceId = async () => {
    if (!placeIdInput) return;
    setFetching(true);
    setMessage(null);
    try {
      const res = await api.searchPlaces(placeIdInput);
      if (res.status === 'success' && res.data.places && res.data.places.length > 0) {
        const place = res.data.places[0];
        applyPlaceData(place, false);
        setMessage({type: 'success', text: 'Place details fetched successfully.'});
      } else {
        setMessage({type: 'error', text: 'No place found with this ID.'});
      }
    } catch (err: any) {
      setMessage({type: 'error', text: err.message});
    } finally {
      setFetching(false);
    }
  };

  const handleFetchByAddress = async () => {
    if (!address && !storeName) {
      setMessage({ type: 'error', text: 'Please enter a Store Name or Address to find your profile.' });
      return;
    }
    setFetching(true);
    setMessage(null);
    try {
      // Search using what the merchant currently entered
      const query = storeName && address ? `${storeName}, ${address}` : (storeName || address);
      const res = await api.searchPlaces(query);
      if (res.status === 'success' && res.data.places && res.data.places.length > 0) {
        const place = res.data.places[0];
        const placeName = place.displayName?.text || '';

        // If merchant entered a store name, verify it matches before touching the form
        if (storeName && !isNameSimilar(storeName, placeName)) {
          setMessage({
            type: 'error',
            text: `Google Places found '${placeName}' at this address, which differs from '${storeName}'. Your modified address and store name were preserved. Run AI Entity Match to resolve.`,
          });
          return;
        }

        setPlaceIdInput(place.id || '');
        // Preserve user's typed address so Google's old address string does not overwrite what they just entered
        applyPlaceData(place, true);
        setMessage({type: 'success', text: `Google Places matched: ${placeName}`});
      } else {
        setMessage({type: 'info', text: 'No Google Profile found for this query. We recommend creating a Google Business Profile or providing a Place ID.'});
      }
    } catch (err: any) {
      setMessage({type: 'error', text: err.message});
    } finally {
      setFetching(false);
    }
  };

  const handleSave = async (): Promise<boolean> => {
    if (!auth.currentUser?.email) {
      setMessage({type: 'error', text: 'You must be logged in to save. Your email is used as the account key.'});
      return false;
    }
    if (!storeName || !address) {
      setMessage({type: 'error', text: 'Store Name and Address are required.'});
      return false;
    }

    if (!actionUrl || (!actionUrl.startsWith('http://') && !actionUrl.startsWith('https://')) || !actionUrl.includes('.')) {
      setMessage({
        type: 'error',
        text: 'A valid Ordering Action Link URL is mandatory for Google Ordering Redirect (e.g. https://sathiyascafe.com/order).'
      });
      return false;
    }

    setSaving(true);
    setMessage(null);
    try {
      const storeRef = doc(db, 'stores', auth.currentUser.email);
      await setDoc(storeRef, {
        storeName,
        placeId: placeIdInput,
        phone,
        email,
        address,
        actionUrl,
        action_url: actionUrl,
        action_link: actionUrl,
        serviceOptions,
        timings,
        leadTimeMinutes: leadTimeMinutes === '' ? null : leadTimeMinutes,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      // Best-effort sync into the `merchants` collection -- the system of
      // record the daily feed push actually compiles from. A failure here
      // shouldn't block the profile save above (that data isn't lost, it's
      // just not yet reflected in the feed pipeline), so it's reported
      // separately rather than thrown.
      let feedSyncNote = '';
      try {
        const sync = await api.saveMerchantProfile({
          storeName,
          address,
          phone,
          email,
          actionUrl,
          placeId: placeIdInput,
          serviceOptions,
          timings,
          leadTimeMinutes: leadTimeMinutes === '' ? null : leadTimeMinutes,
        });
        if (sync.status !== 'success') {
          feedSyncNote = ` (feed sync failed: ${sync.message || 'unknown error'})`;
        }
      } catch (syncErr: any) {
        feedSyncNote = ` (feed sync failed: ${syncErr.message})`;
      }

      setMessage({type: feedSyncNote ? 'info' : 'success', text: `Store profile saved successfully.${feedSyncNote}`});
      return true;
    } catch (err: any) {
      setMessage({type: 'error', text: err.message});
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndContinue = async () => {
    const success = await handleSave();
    if (success) {
      navigate('/merchant/services');
    }
  };

  const flaggedForReview = agentEvents.some((e) => e.status === 'flagged' && e.stage === 'hitl_triage');
  const needsGbpDraft = agentEvents.some((e) => e.stage === 'gbp_generation');
  const entityMatchDone = !agentRunning && agentEvents.length > 0;

  const resolutionEvt = agentEvents.find((e) => e.stage === 'entity_resolution');
  const resolutionPayload = resolutionEvt?.payload as any;
  const candidateName = resolutionPayload?.candidate_name || resolutionPayload?.name || '';
  const candidatePlaceId = resolutionPayload?.place_id || '';
  const matchConfidencePct = resolutionPayload?.confidence ? Math.round(Number(resolutionPayload.confidence) * 100) : null;

  const handleRunAiMatch = async () => {
    if (!storeName || !address) {
      setMessage({ type: 'error', text: 'Please enter a Store Name and Address before running AI Entity Match.' });
      return;
    }
    setAgentRunning(true);
    setAgentError(null);
    setAgentEvents([]);
    setMessage(null);

    try {
      await api.onboardMerchant(
        {
          name: storeName,
          address,
          telephone: phone || undefined,
          email: email || auth.currentUser?.email || undefined,
        },
        (event: AgentEvent) => {
          setAgentEvents((prev) => [...prev, event]);
          // Only auto-fill Place ID if it's a high-confidence match (>= 90%)
          // If the name is different (confidence < 90%), do NOT overwrite the merchant's data
          const conf = typeof event.payload?.confidence === 'number' ? event.payload.confidence : 0;
          if (conf >= 0.90 && event.payload?.place_id && typeof event.payload.place_id === 'string') {
            setPlaceIdInput(event.payload.place_id);
          }
        }
      );
    } catch (err: any) {
      setAgentError(err.message || 'AI Entity Matcher failed.');
    } finally {
      setAgentRunning(false);
    }
  };

  // Extract a query string for the Map Pin
  const googleMapsUrl = placeIdInput
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(storeName ? `${storeName}, ${address}` : address)}&query_place_id=${placeIdInput}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address || storeName || 'Restaurant')}`;

  return (
    <div className="min-h-full flex flex-col">
      {/* Flush Sticky Solid Header */}
      <div className="sticky top-0 z-30 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 md:px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">My Store Profile</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">Step 1: Restaurant identity, action redirect URL, fulfillment types, and AI Google Places verification.</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSaveAndContinue}
              disabled={saving || agentRunning}
              className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold rounded-xl shadow-sm transition-all flex items-center gap-2 disabled:opacity-50 text-xs cursor-pointer"
            >
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <span>Next: Services &amp; Feeds</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable Form Content */}
      <div className="max-w-7xl w-full mx-auto px-6 md:px-8 py-6 md:py-8 space-y-6 pb-16">

      {message && (
        <div className={`p-4 rounded-lg flex items-center gap-2 border ${
          message.type === 'error' ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800' : 
          message.type === 'success' ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800' :
          'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800'
        }`}>
          <Info className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm">{message.text}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in fade-in zoom-in-95">
        {/* Basic Info (7 cols on large screens) */}
        <div className="lg:col-span-7 p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-4">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Basic Information</h2>
          
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Google Place ID (Optional)</label>
              <input type="text" value={placeIdInput} onChange={(e) => setPlaceIdInput(e.target.value)} className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white" placeholder="e.g. ChIJ..." />
            </div>
            <button onClick={handleFetchByPlaceId} disabled={fetching || !placeIdInput} className="px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50" title="Fetch Details by Place ID">
              {fetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Fetch
            </button>
          </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Store Name <span className="text-red-500">*</span></label>
              <input type="text" value={storeName} onChange={(e) => setStoreName(e.target.value)} className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white" placeholder="Enter store name" />
            </div>

            {/* Mandatory Ordering Action Link URL */}
            <div className="space-y-2 p-4 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-semibold text-slate-900 dark:text-white">
                  Ordering Action Link URL <span className="text-red-500">*</span>
                </label>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                  Mandatory for Google
                </span>
              </div>
              <input
                type="url"
                value={actionUrl}
                onChange={(e) => setActionUrl(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono text-sm"
                placeholder="https://sathiyascafe.com/order or https://order.myrestaurant.com"
              />
              <div className="p-3 bg-blue-50/80 dark:bg-blue-900/20 border border-blue-200/80 dark:border-blue-800/60 rounded-lg text-xs text-blue-900 dark:text-blue-200 leading-relaxed">
                <span className="font-semibold block mb-0.5">Why this is mandatory for Google Actions Center:</span>
                Google Actions Center (Ordering Redirect) requires an exact destination URL for every restaurant. When customers search on Google Maps or Search and click <strong>"Order Online"</strong>, Google immediately redirects them to this URL to browse your menu and complete checkout on your payment system.
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Phone Number</label>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white" placeholder="Phone number (optional)" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white" placeholder="Contact email" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Average Prep / Lead Time (minutes)</label>
              <input
                type="number"
                min={0}
                value={leadTimeMinutes}
                onChange={(e) => setLeadTimeMinutes(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white"
                placeholder="e.g. 30"
              />
              <p className="text-xs text-slate-500 mt-1">Required for Google's service feed (hours/lead-time). Leave blank if unknown -- we won't guess a number on your behalf.</p>
            </div>

            {/* Service Options */}
            <div className="pt-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Service Options</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={serviceOptions.delivery} onChange={(e) => setServiceOptions({...serviceOptions, delivery: e.target.checked})} className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500" />
                  <span className="text-sm text-slate-700 dark:text-slate-300">Delivery</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={serviceOptions.takeaway} onChange={(e) => setServiceOptions({...serviceOptions, takeaway: e.target.checked})} className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500" />
                  <span className="text-sm text-slate-700 dark:text-slate-300">Takeaway</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={serviceOptions.inStore} onChange={(e) => setServiceOptions({...serviceOptions, inStore: e.target.checked})} className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500" />
                  <span className="text-sm text-slate-700 dark:text-slate-300">Dine-in / In Store</span>
                </label>
              </div>
            </div>
          </div>

          {/* Location Map (5 cols on large screens) */}
          <div className="lg:col-span-5 p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
              <MapPin className="w-5 h-5 text-red-500" />
              Location Details
            </h2>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Full Address</label>
                <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white" placeholder="123 Main St, Anytown" />
              </div>
              <button onClick={handleFetchByAddress} disabled={fetching || (!address && !storeName)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50 text-sm font-medium" title="Search Places by Name & Address">
                {fetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Find Profile
              </button>
            </div>
            <div className="mt-4 flex-1 bg-slate-100 dark:bg-slate-700/60 rounded-lg border border-slate-200 dark:border-slate-600 min-h-[220px] flex flex-col items-center justify-center gap-3 p-6 text-center">
              <MapPin className="w-8 h-8 text-slate-400" />
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {address ? 'Confirm this address looks right on the map:' : 'Enter an address above to preview it on the map.'}
              </p>
              {address && (
                <div className="flex flex-col items-center gap-2">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {storeName ? `${storeName} · ` : ''}{address}
                  </span>
                  <a
                    href={googleMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition-colors shadow-sm"
                  >
                    <MapPin className="w-4 h-4" />
                    View on Google Maps
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Servicing Hours (Full 12 cols with 7-column responsive grid) */}
          <div className="lg:col-span-12 p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
              <Clock className="w-5 h-5 text-amber-500" />
              Servicing Timings
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3.5">
              {timings.map((timing, index) => (
                <div key={timing.day} className="flex flex-col justify-between p-3.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800/60 transition-all hover:border-slate-300 dark:hover:border-slate-600">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{timing.day}</span>
                    <input 
                      type="checkbox" 
                      checked={timing.isOpen} 
                      onChange={(e) => updateTiming(index, 'isOpen', e.target.checked)}
                      className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                    />
                  </div>
                  {!timing.isOpen ? (
                    <div className="py-3 text-center">
                      <span className="text-xs font-semibold px-2.5 py-1 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 rounded-md">Closed</span>
                    </div>
                  ) : (
                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
                        <span>Open</span>
                        <input 
                          type="time" 
                          value={timing.openTime} 
                          onChange={(e) => updateTiming(index, 'openTime', e.target.value)}
                          className="text-xs px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-slate-900 dark:text-white font-mono"
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
                        <span>Close</span>
                        <input 
                          type="time" 
                          value={timing.closeTime} 
                          onChange={(e) => updateTiming(index, 'closeTime', e.target.value)}
                          className="text-xs px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-slate-900 dark:text-white font-mono"
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
        </div>
      </div>

      <div className="space-y-6 pt-4 animate-in fade-in zoom-in-95">
        {/* Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <Bot className="w-5 h-5 text-blue-500" />
              <span>Step 1: Save profile, verify Google Place ID, and continue to Services &amp; Feeds.</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handleSave}
                disabled={saving || agentRunning}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 font-medium rounded-xl transition-colors flex items-center gap-2 disabled:opacity-50 text-xs cursor-pointer"
              >
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Save Draft</span>
              </button>

              <button
                onClick={handleRunAiMatch}
                disabled={agentRunning || !storeName || !address}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-xl shadow-xs transition-all flex items-center gap-2 disabled:opacity-50 text-xs cursor-pointer"
              >
                {agentRunning ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Agent Matching...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Run AI Entity Match</span>
                  </>
                )}
              </button>

              <button
                onClick={handleSaveAndContinue}
                disabled={saving || agentRunning}
                className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold rounded-xl shadow-md hover:shadow-lg transition-all flex items-center gap-2 disabled:opacity-50 text-xs cursor-pointer"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving Profile...</span>
                  </>
                ) : (
                  <>
                    <span>Save &amp; Continue to Services &amp; Feeds</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </div>

          {/* AI Matching Status Alerts */}
          {needsGbpDraft && (
            <div className="bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 p-4 rounded-xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 mt-0.5 shrink-0 text-amber-500" />
              <div className="flex-1">
                <h4 className="font-semibold text-sm">Missing Google Business Profile</h4>
                <p className="text-xs mt-1 opacity-90">
                  No existing Places match found. EntityMatcherAgent drafted a Google Business Profile onboarding record below.
                </p>
              </div>
            </div>
          )}

          {flaggedForReview && (
            <div className="bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 p-5 rounded-xl space-y-3.5 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-bold text-sm text-slate-900 dark:text-white">Human in the Loop (HITL) Review Required</h4>
                    {matchConfidencePct !== null && (
                      <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300">
                        {matchConfidencePct}% Match Score
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                    Google Maps found {candidateName ? <strong>"{candidateName}"</strong> : 'a different business listing'} at this address, which is below our 90% confidence threshold for automated feed approval.
                  </p>
                </div>
              </div>

              {/* Guided Action Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                <div className="p-3.5 bg-white dark:bg-slate-800 rounded-xl border border-amber-500/20 text-xs flex flex-col justify-between gap-2 shadow-xs">
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-slate-100 block mb-1">1. Typo in Store Name or Unit?</span>
                    <p className="text-slate-500 dark:text-slate-400 leading-relaxed">Check if your restaurant name or address unit number has a typo, then click <strong>Run AI Entity Match</strong> again.</p>
                  </div>
                </div>

                <div className="p-3.5 bg-white dark:bg-slate-800 rounded-xl border border-amber-500/20 text-xs flex flex-col justify-between gap-2 shadow-xs">
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-slate-100 block mb-1">2. Is {candidateName ? `"${candidateName}"` : 'this'} your store?</span>
                    <p className="text-slate-500 dark:text-slate-400 leading-relaxed">If your restaurant rebranded or is registered under this legal listing name on Google:</p>
                  </div>
                  {candidatePlaceId && (
                    <button
                      onClick={() => {
                        setPlaceIdInput(candidatePlaceId);
                        handleFetchByPlaceId();
                      }}
                      className="w-full px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium text-center transition-colors text-xs shadow-xs"
                    >
                      Use Found Google Place ID
                    </button>
                  )}
                </div>

                <div className="p-3.5 bg-white dark:bg-slate-800 rounded-xl border border-amber-500/20 text-xs flex flex-col justify-between gap-2 shadow-xs">
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-slate-100 block mb-1">3. New Restaurant at this Address?</span>
                    <p className="text-slate-500 dark:text-slate-400 leading-relaxed">If this is a new store not yet listed on Google Maps, claim and register your Google Business Profile (GBP):</p>
                  </div>
                  <a
                    href="https://business.google.com/create"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-center transition-colors flex items-center justify-center gap-1.5 text-xs shadow-xs"
                  >
                    <span>Register on Google Business Profile (GBP)</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>

              <p className="text-[11px] text-slate-500 dark:text-slate-400 italic pt-0.5">
                * Note: Your account has also been queued for our aggregator operations team for manual verification.
              </p>
            </div>
          )}

          {entityMatchDone && !flaggedForReview && !needsGbpDraft && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 p-4 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-500" />
                <div>
                  <span className="font-semibold text-sm">Google Business Profile Matched &amp; Verified</span>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">High confidence entity match. Ready for Menu and Action/Service Feeds.</p>
                </div>
              </div>
            </div>
          )}

          {agentError && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300 p-4 rounded-xl flex items-center gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 text-red-500" />
              <span className="text-sm">{agentError}</span>
            </div>
          )}

          {/* Live Agent Terminal Stream */}
          {(agentRunning || agentEvents.length > 0) && (
            <div className="rounded-xl border border-slate-800 bg-slate-950 text-slate-100 overflow-hidden shadow-xl">
              <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-mono text-slate-300">
                  <Terminal className="w-4 h-4 text-blue-400" />
                  <span className="font-semibold">EntityMatcherAgent Thought Stream</span>
                  {agentRunning && (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/20 text-blue-300 animate-pulse">
                      Live
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-slate-500 font-mono">Google ADK Multi-Agent</span>
              </div>

              <div ref={logRef} className="p-4 font-mono text-xs max-h-60 overflow-y-auto space-y-2">
                {agentEvents.length === 0 && agentRunning && (
                  <div className="text-slate-500 italic">Initializing EntityMatcherAgent with Google Places client...</div>
                )}
                {agentEvents.map((evt, idx) => (
                  <div key={idx} className="flex items-start gap-2 leading-relaxed">
                    <span className="text-slate-500 select-none shrink-0">[{evt.stage}]</span>
                    <span className={`font-semibold shrink-0 ${STATUS_STYLES[evt.status] || 'text-slate-300'}`}>
                      {evt.agent_name}:
                    </span>
                    <span className="text-slate-200">{evt.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
