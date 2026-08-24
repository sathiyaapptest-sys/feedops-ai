import { useState, useEffect } from 'react';
import { Store, MapPin, Clock, Search, Loader2, Info } from 'lucide-react';
import { db, auth } from '../../lib/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { api } from '../../lib/api';

export function MyStore() {
  const [hasPlaceId, setHasPlaceId] = useState<boolean | null>(null);
  const [placeIdInput, setPlaceIdInput] = useState('');
  
  const [storeName, setStoreName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
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

  useEffect(() => {
    // Attempt to load existing profile using auth.currentUser.email
    if (auth.currentUser?.email) {
      setEmail(auth.currentUser.email);
      const storeRef = doc(db, 'stores', auth.currentUser.email);
      getDoc(storeRef).then((snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setStoreName(data.storeName || '');
          setPlaceIdInput(data.placeId || '');
          setPhone(data.phone || '');
          setEmail(data.email || auth.currentUser?.email || '');
          setAddress(data.address || '');
          if (data.serviceOptions) setServiceOptions(data.serviceOptions);
          if (data.timings) setTimings(data.timings);
          if (data.placeId) setHasPlaceId(true);
          if (typeof data.leadTimeMinutes === 'number') setLeadTimeMinutes(data.leadTimeMinutes);
        }
      });
    }
  }, []);

  const updateTiming = (index: number, field: string, value: any) => {
    const newTimings = [...timings];
    newTimings[index] = { ...newTimings[index], [field]: value };
    setTimings(newTimings);
  };

  const applyPlaceData = (place: any) => {
    if (place.displayName?.text) setStoreName(place.displayName.text);
    if (place.formattedAddress) setAddress(place.formattedAddress);
    if (place.internationalPhoneNumber) setPhone(place.internationalPhoneNumber);
    
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
        applyPlaceData(place);
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
    if (!address) return;
    setFetching(true);
    setMessage(null);
    try {
      const res = await api.searchPlaces(address);
      if (res.status === 'success' && res.data.places && res.data.places.length > 0) {
        const place = res.data.places[0];
        setPlaceIdInput(place.id || '');
        applyPlaceData(place);
        setMessage({type: 'success', text: 'Place matched based on address!'});
      } else {
        setMessage({type: 'info', text: 'No Google Profile found for this address. We recommend creating a Google Business Profile.'});
      }
    } catch (err: any) {
      setMessage({type: 'error', text: err.message});
    } finally {
      setFetching(false);
    }
  };

  const handleSave = async () => {
    if (!auth.currentUser?.email) {
      setMessage({type: 'error', text: 'You must be logged in to save. Your email is used as the account key.'});
      return;
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
          placeId: placeIdInput || undefined,
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
    } catch (err: any) {
      setMessage({type: 'error', text: err.message});
    } finally {
      setSaving(false);
    }
  };

  // Extract a query string for the Map Pin
  const mapQuery = address ? encodeURIComponent(address) : encodeURIComponent(storeName || 'Restaurant');

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3 pb-4 border-b border-slate-200 dark:border-slate-700">
        <Store className="w-6 h-6 text-blue-500" />
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">My Store Profile</h1>
      </div>

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

      {hasPlaceId === null && !placeIdInput && !storeName ? (
        <div className="p-8 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center text-center space-y-4">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Do you have a Google Place ID or Profile ID?</h2>
          <p className="text-slate-500 max-w-md">If you already have a Google Business Profile, we can fetch your details automatically.</p>
          <div className="flex gap-4 mt-4">
            <button onClick={() => setHasPlaceId(true)} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg">Yes, I have one</button>
            <button onClick={() => setHasPlaceId(false)} className="px-6 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 font-medium rounded-lg">No, I don't</button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in zoom-in-95">
          {/* Basic Info */}
          <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-4">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Basic Information</h2>
            
            {hasPlaceId !== false && (
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Google Place ID</label>
                  <input type="text" value={placeIdInput} onChange={(e) => setPlaceIdInput(e.target.value)} className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white" placeholder="ChIJ_..." />
                </div>
                <button onClick={handleFetchByPlaceId} disabled={fetching || !placeIdInput} className="px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50">
                  {fetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  Fetch
                </button>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Store Name</label>
              <input type="text" value={storeName} onChange={(e) => setStoreName(e.target.value)} className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white" placeholder="Corner Cafe" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Phone Number</label>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white" placeholder="(555) 123-4567" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white" placeholder="hello@cornercafe.com" />
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
                  <span className="text-sm text-slate-700 dark:text-slate-300">In Store</span>
                </label>
              </div>
            </div>
          </div>

          {/* Location Map */}
          <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 flex flex-col">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
              <MapPin className="w-5 h-5 text-red-500" />
              Location Details
            </h2>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Full Address</label>
                <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-900 dark:text-white" placeholder="123 Main St, Anytown" />
              </div>
              <button onClick={handleFetchByAddress} disabled={fetching || !address} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50" title="Find Place ID by Address">
                {fetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Find Profile
              </button>
            </div>
            <div className="mt-4 flex-1 bg-slate-100 dark:bg-slate-700 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-600 min-h-[200px] relative">
               <iframe
                width="100%"
                height="100%"
                style={{ border: 0 }}
                loading="lazy"
                allowFullScreen
                src={`https://www.google.com/maps/embed/v1/place?key=AIzaSyMockKeyForDemoOnly&q=${mapQuery}`}
              ></iframe>
              <div className="absolute inset-0 bg-slate-200 dark:bg-slate-800/20 flex items-center justify-center backdrop-blur-[1px] pointer-events-none">
              </div>
            </div>
          </div>

          {/* Servicing Hours */}
          <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 md:col-span-2">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
              <Clock className="w-5 h-5 text-amber-500" />
              Servicing Timings
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {timings.map((timing, index) => (
                <div key={timing.day} className="flex flex-col gap-1.5 p-3 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800/50">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{timing.day}</span>
                    <input 
                      type="checkbox" 
                      checked={timing.isOpen} 
                      onChange={(e) => updateTiming(index, 'isOpen', e.target.checked)}
                      className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                    />
                  </div>
                  {!timing.isOpen ? (
                    <span className="text-xs w-max text-red-500 font-semibold px-2 py-1 bg-red-50 dark:bg-red-900/20 rounded mt-1">Closed</span>
                  ) : (
                    <div className="flex items-center gap-2 mt-1">
                      <input 
                        type="time" 
                        value={timing.openTime} 
                        onChange={(e) => updateTiming(index, 'openTime', e.target.value)}
                        className="text-sm px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                      />
                      <span className="text-slate-500">-</span>
                      <input 
                        type="time" 
                        value={timing.closeTime} 
                        onChange={(e) => updateTiming(index, 'closeTime', e.target.value)}
                        className="text-sm px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {hasPlaceId !== null || placeIdInput || storeName ? (
        <div className="flex justify-end pt-4 animate-in fade-in zoom-in-95">
          <button onClick={handleSave} disabled={saving} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition-colors flex items-center gap-2 disabled:opacity-50">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save Changes
          </button>
        </div>
      ) : null}
    </div>
  );
}
