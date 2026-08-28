import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { auth } from '../../lib/firebase';
import { Settings, Loader2, CheckCircle2, UtensilsCrossed } from 'lucide-react';

interface ConfigForm {
  sftp_username_sandbox: string;
  sftp_username_production: string;
  conversion_partner_id: string;
  portal_status_sandbox: string;
  portal_status_production: string;
  // Menu Feeds -- a separate, opt-in track (see onboarding/steps.ts's
  // MENU_STEP_* tables and compute_menu_journey on the backend). Additive
  // only: nothing above this comment changed.
  menu_feeds_enabled: boolean;
  generic_sftp_username_sandbox: string;
  generic_sftp_username_production: string;
}

const EMPTY_FORM: ConfigForm = {
  sftp_username_sandbox: '',
  sftp_username_production: '',
  conversion_partner_id: '',
  portal_status_sandbox: 'not_started',
  portal_status_production: 'not_started',
  menu_feeds_enabled: false,
  generic_sftp_username_sandbox: '',
  generic_sftp_username_production: '',
};

const PORTAL_STATUS_OPTIONS = ['not_started', 'in_progress', 'live'];

export function ApiWebhooks() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [form, setForm] = useState<ConfigForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const load = async () => {
      // auth.currentUser is synchronously null immediately after a fresh
      // page load, until Firebase finishes restoring the persisted session --
      // confirmed live: this page reported "Not signed in" on a direct
      // navigation despite a genuinely active session (same race fixed in
      // api.ts's getIdToken() this session, but this component reads
      // auth.currentUser directly instead of going through that helper).
      await auth.authStateReady();
      const user = auth.currentUser;
      if (!user) {
        setError('Not signed in.');
        setLoading(false);
        return;
      }
      const id = user.uid;
      setOrgId(id);

      try {
        let res = await api.getOrganization(id);
        if (res.status === 'error') {
          // First visit -- this aggregator has no org record yet. There's no
          // separate org-creation wizard in this app, so create one lazily,
          // keyed by the aggregator's own uid (same self-service pattern
          // merchants get keyed by email).
          const created = await api.createOrganization({
            org_id: id,
            org_type: 'aggregator',
            name: user.email || id,
            contact_email: user.email || '',
            goal: 'Google Actions Center Ordering Redirect',
          });
          res = await api.getOrganization(id);
          if (res.status === 'error') throw new Error(created.message || 'Could not create organization.');
        }
        // update_organization_config writes portal_status_sandbox/production as
        // flat keys inside `config` (not the top-level `portal_status` object
        // /api/organizations POST seeds at creation) -- reading from `config`
        // here so a value round-trips correctly after being saved via that
        // same endpoint.
        const config = res.org?.config || {};
        setForm({
          sftp_username_sandbox: config.sftp_username_sandbox || '',
          sftp_username_production: config.sftp_username_production || '',
          conversion_partner_id: config.conversion_partner_id || '',
          portal_status_sandbox: config.portal_status_sandbox || res.org?.portal_status?.sandbox || 'not_started',
          portal_status_production: config.portal_status_production || res.org?.portal_status?.production || 'not_started',
          menu_feeds_enabled: !!config.menu_feeds_enabled,
          generic_sftp_username_sandbox: config.generic_sftp_username_sandbox || '',
          generic_sftp_username_production: config.generic_sftp_username_production || '',
        });
      } catch (err: any) {
        setError(err.message || 'Could not load organization config.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleSave = async () => {
    if (!orgId) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await api.updateOrganizationConfig(orgId, form);
      if (res.status === 'error') throw new Error(res.message);
      setSaved(true);
    } catch (err: any) {
      setError(err.message || 'Could not save config.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
        <Settings className="w-6 h-6 text-blue-500" />
        API &amp; Webhooks
      </h1>

      <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-6">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Partner Portal values FeedOps AI needs to deliver feeds and dispatch conversion pings on
          your behalf -- find these under Partner Portal &rarr; Account and Users &rarr; Account tab.
          {' '}<span className="font-medium">Not</span> the same as an SFTP password (never stored here).
        </p>

        {loading ? (
          <div className="h-40 animate-pulse bg-slate-100 dark:bg-slate-700 rounded-lg" />
        ) : (
          <>
            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg text-sm">
                {error}
              </div>
            )}
            {saved && (
              <div className="p-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 rounded-lg text-sm flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> Saved.
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-900 dark:text-white">SFTP Username (sandbox)</label>
                <input
                  value={form.sftp_username_sandbox}
                  onChange={(e) => setForm({ ...form, sftp_username_sandbox: e.target.value })}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md px-3 py-2 text-sm text-slate-900 dark:text-white"
                  placeholder="sandbox-username"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-900 dark:text-white">SFTP Username (production)</label>
                <input
                  value={form.sftp_username_production}
                  onChange={(e) => setForm({ ...form, sftp_username_production: e.target.value })}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md px-3 py-2 text-sm text-slate-900 dark:text-white"
                  placeholder="production-username"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-sm font-medium text-slate-900 dark:text-white">Conversion Partner ID</label>
                <input
                  value={form.conversion_partner_id}
                  onChange={(e) => setForm({ ...form, conversion_partner_id: e.target.value })}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md px-3 py-2 text-sm text-slate-900 dark:text-white"
                  placeholder="numeric Partner/Aggregator ID"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-900 dark:text-white">Portal Status (sandbox)</label>
                <select
                  value={form.portal_status_sandbox}
                  onChange={(e) => setForm({ ...form, portal_status_sandbox: e.target.value })}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md px-3 py-2 text-sm text-slate-900 dark:text-white"
                >
                  {PORTAL_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-900 dark:text-white">Portal Status (production)</label>
                <select
                  value={form.portal_status_production}
                  onChange={(e) => setForm({ ...form, portal_status_production: e.target.value })}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md px-3 py-2 text-sm text-slate-900 dark:text-white"
                >
                  {PORTAL_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 dark:border-slate-700 space-y-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.menu_feeds_enabled}
                  onChange={(e) => setForm({ ...form, menu_feeds_enabled: e.target.checked })}
                  className="mt-1"
                />
                <span>
                  <span className="text-sm font-medium text-slate-900 dark:text-white flex items-center gap-1.5">
                    <UtensilsCrossed className="w-4 h-4 text-blue-500" />
                    Also enable Menu Feeds
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 block mt-0.5">
                    A separate, optional onboarding track (google.food_menu) for restaurants that want their menu
                    to show on Google Search/Maps -- not every aggregator needs this. Adds its own tracker card to
                    the Dashboard once enabled.
                  </span>
                </span>
              </label>

              {form.menu_feeds_enabled && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-7">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-900 dark:text-white">Generic SFTP Username (sandbox)</label>
                    <input
                      value={form.generic_sftp_username_sandbox}
                      onChange={(e) => setForm({ ...form, generic_sftp_username_sandbox: e.target.value })}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md px-3 py-2 text-sm text-slate-900 dark:text-white"
                      placeholder="generic-sandbox-username"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-slate-900 dark:text-white">Generic SFTP Username (production)</label>
                    <input
                      value={form.generic_sftp_username_production}
                      onChange={(e) => setForm({ ...form, generic_sftp_username_production: e.target.value })}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md px-3 py-2 text-sm text-slate-900 dark:text-white"
                      placeholder="generic-production-username"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Save Configuration
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
