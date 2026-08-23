import React, { useState } from 'react';
import { UploadCloud, MapPin, AlertCircle, CheckCircle2 } from 'lucide-react';
import { motion } from 'framer-motion';

import { MerchantDetails } from '@/types';

export const MerchantOnboardingCard: React.FC = () => {
  const [details, setDetails] = useState<MerchantDetails>({
    storeName: '',
    address: '',
    phone: '',
    cuisineType: '',
    lat: 37.7749,
    lng: -122.4194,
    hasGoogleProfile: false,
  });

  return (
    <div className="bg-card text-card-foreground rounded-xl border border-border shadow-sm p-6 w-full max-w-2xl mx-auto flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Merchant Onboarding</h2>
        <p className="text-muted-foreground text-sm mt-1">Upload menu and verify location details to begin syndication.</p>
      </div>

      {!details.hasGoogleProfile && (
        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 p-4 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
          <div className="flex-1">
            <h4 className="font-semibold text-sm">Missing Google Business Profile</h4>
            <p className="text-xs mt-1 opacity-90">This location requires a Google Profile to receive "Order Online" buttons.</p>
          </div>
          <button 
            onClick={() => setDetails(d => ({ ...d, hasGoogleProfile: true }))}
            className="bg-amber-500 hover:bg-amber-600 text-white text-xs font-medium px-3 py-1.5 rounded-md transition-colors whitespace-nowrap"
          >
            Create Draft & Go Live
          </button>
        </div>
      )}

      {details.hasGoogleProfile && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 p-4 rounded-lg flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span className="font-medium text-sm">Google Business Profile Draft Created</span>
        </div>
      )}

      {/* Dropzone */}
      <div className="border-2 border-dashed border-border rounded-lg p-8 flex flex-col items-center justify-center text-center hover:bg-accent/50 transition-colors cursor-pointer group">
        <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
          <UploadCloud className="w-6 h-6" />
        </div>
        <p className="text-sm font-medium">Drag & drop printed menu photos or CSV</p>
        <p className="text-xs text-muted-foreground mt-1">Supports JPG, PNG, PDF, CSV up to 10MB</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Store Name</label>
          <input className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" placeholder="e.g. Joe's Pizza" />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Cuisine Type</label>
          <input className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" placeholder="e.g. Italian" />
        </div>
        <div className="space-y-1.5 col-span-2">
          <label className="text-sm font-medium">Address</label>
          <input className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" placeholder="123 Main St..." />
        </div>
        <div className="space-y-1.5 col-span-2">
          <label className="text-sm font-medium">Phone</label>
          <input className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" placeholder="(555) 123-4567" />
        </div>
      </div>

      {/* Map Adjuster */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Location Pin Adjuster</label>
          <span className="text-xs text-muted-foreground font-mono">{details.lat.toFixed(4)}, {details.lng.toFixed(4)}</span>
        </div>
        <div className="h-48 w-full bg-accent/30 rounded-lg border border-border relative overflow-hidden flex items-center justify-center">
          {/* Simulated Map Background */}
          <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, currentColor 1px, transparent 0)', backgroundSize: '24px 24px' }}></div>
          
          <motion.div 
            drag
            dragConstraints={{ top: -80, left: -250, right: 250, bottom: 80 }}
            onDrag={(_, info) => {
              setDetails(d => ({ ...d, lat: d.lat - info.delta.y * 0.0001, lng: d.lng + info.delta.x * 0.0001 }))
            }}
            className="cursor-grab active:cursor-grabbing z-10 text-primary flex flex-col items-center"
          >
            <div className="bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5 rounded shadow-sm mb-1 pointer-events-none">Drag to adjust</div>
            <MapPin className="w-8 h-8 fill-primary text-background drop-shadow-md" />
          </motion.div>
        </div>
      </div>

      <button className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-2.5 rounded-md transition-colors mt-2">
        Save & Continue
      </button>
    </div>
  );
};
