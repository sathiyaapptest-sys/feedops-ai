import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { auth } from '../../lib/firebase';
import { KeyRound, Loader2, CheckCircle2, UtensilsCrossed, Eye, EyeOff, Shield, Copy, Check, RefreshCw, Key } from 'lucide-react';

interface ConfigForm {
  sftp_username_sandbox: string;
  sftp_username_production: string;
  conversion_partner_id: string;
  production_rwg_tokens: string;
  portal_status_sandbox: string;
  portal_status_production: string;
  menu_feeds_enabled: boolean;
  generic_sftp_username_sandbox: string;
  generic_sftp_username_production: string;
}

const EMPTY_FORM: ConfigForm = {
  sftp_username_sandbox: '',
  sftp_username_production: '',
  conversion_partner_id: '',
  production_rwg_tokens: '',
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

  // SSH Key state
  const [sftpKeyInfo, setSftpKeyInfo] = useState<{
    status: 'configured' | 'not_found' | 'error';
    key_path?: string;
    public_key?: string | null;
    has_private_key?: boolean;
    message?: string;
  } | null>(null);
  const [keyLoading, setKeyLoading] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [generatingKey, setGeneratingKey] = useState(false);

  // Field visibility states for privacy during screen recording / demos
  const [showFields, setShowFields] = useState<Record<string, boolean>>({
    sftp_username_sandbox: false,
    sftp_username_production: false,
    conversion_partner_id: false,
    production_rwg_tokens: false,
    generic_sftp_username_sandbox: false,
    generic_sftp_username_production: false,
    ssh_public_key: false,
  });

  const toggleField = (field: string) => {
    setShowFields((prev) => ({ ...prev, [field]: !prev[field] }));
  };

  const allMasked = !Object.values(showFields).some(Boolean);

  const toggleMaskAll = () => {
    const nextVal = allMasked;
    setShowFields({
      sftp_username_sandbox: nextVal,
      sftp_username_production: nextVal,
      conversion_partner_id: nextVal,
      production_rwg_tokens: nextVal,
      generic_sftp_username_sandbox: nextVal,
      generic_sftp_username_production: nextVal,
      ssh_public_key: nextVal,
    });
  };

  const formatKeyPath = (p?: string) => {
    if (!p) return '~/.ssh/google_actions_center';
    if (p.includes('.ssh/')) {
      return '~/.ssh/' + p.split('.ssh/').pop();
    }
    return p;
  };

  const loadKeyInfo = async () => {
    setKeyLoading(true);
    try {
      const res = await api.getSftpKeyInfo();
      setSftpKeyInfo(res);
    } catch (e) {
      console.error('Could not fetch SFTP key info', e);
    } finally {
      setKeyLoading(false);
    }
  };

  useEffect(() => {
    const load = async () => {
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
        const config = res.org?.config || {};
        setForm({
          sftp_username_sandbox: config.sftp_username_sandbox || '',
          sftp_username_production: config.sftp_username_production || '',
          conversion_partner_id: config.conversion_partner_id || '',
          production_rwg_tokens: config.production_rwg_tokens || '',
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
    loadKeyInfo();
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

  const handleCopyKey = () => {
    if (sftpKeyInfo?.public_key) {
      navigator.clipboard.writeText(sftpKeyInfo.public_key);
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 2000);
    }
  };

  const handleGenerateKey = async () => {
    setGeneratingKey(true);
    try {
      const res = await api.generateSftpKey();
      if (res.status === 'success') {
        await loadKeyInfo();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setGeneratingKey(false);
    }
  };

  return (
    <div className="max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <KeyRound className="w-6 h-6 text-blue-500" />
            Partner Portal Credentials &amp; Setup
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Google Actions Center relies on SFTP feeds and Conversion Tracking pings for Ordering Redirect.
          </p>
        </div>

        <button
          type="button"
          onClick={toggleMaskAll}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
          title={allMasked ? "Reveal all credential fields" : "Mask all credential fields for screen recording"}
        >
          {allMasked ? (
            <>
              <Eye className="w-3.5 h-3.5 text-slate-500" />
              <span>Show All Values</span>
            </>
          ) : (
            <>
              <EyeOff className="w-3.5 h-3.5 text-amber-500" />
              <span>Hide All (Privacy Mode)</span>
            </>
          )}
        </button>
      </div>

      {/* Main Credentials Card */}
      <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-6">
        <div className="flex items-start gap-2.5 p-3.5 bg-blue-50/70 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/40 rounded-lg">
          <Shield className="w-4 h-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            Partner Portal values FeedOps AI needs to deliver feeds and dispatch conversion pings on your behalf — find these under <strong className="font-semibold text-slate-800 dark:text-slate-200">Partner Portal &rarr; Account and Users &rarr; Account tab</strong>.
            SFTP SSH keys and passwords are never exposed or stored in plain text here.
          </p>
        </div>

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
                <CheckCircle2 className="w-4 h-4" /> Saved successfully.
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* SFTP Sandbox */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-900 dark:text-white">SFTP Username (sandbox)</label>
                  <button
                    type="button"
                    onClick={() => toggleField('sftp_username_sandbox')}
                    className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center gap-1"
                  >
                    {showFields.sftp_username_sandbox ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    <span>{showFields.sftp_username_sandbox ? 'Hide' : 'Show'}</span>
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showFields.sftp_username_sandbox ? 'text' : 'password'}
                    value={form.sftp_username_sandbox}
                    onChange={(e) => setForm({ ...form, sftp_username_sandbox: e.target.value })}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md px-3 py-2 text-sm text-slate-900 dark:text-white font-mono"
                    placeholder="sandbox-username"
                    autoComplete="off"
                  />
                </div>
              </div>

              {/* SFTP Production */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-900 dark:text-white">SFTP Username (production)</label>
                  <button
                    type="button"
                    onClick={() => toggleField('sftp_username_production')}
                    className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center gap-1"
                  >
                    {showFields.sftp_username_production ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    <span>{showFields.sftp_username_production ? 'Hide' : 'Show'}</span>
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showFields.sftp_username_production ? 'text' : 'password'}
                    value={form.sftp_username_production}
                    onChange={(e) => setForm({ ...form, sftp_username_production: e.target.value })}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md px-3 py-2 text-sm text-slate-900 dark:text-white font-mono"
                    placeholder="production-username"
                    autoComplete="off"
                  />
                </div>
              </div>

              {/* Conversion Partner ID */}
              <div className="space-y-1.5 sm:col-span-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-900 dark:text-white">Conversion Partner ID</label>
                  <button
                    type="button"
                    onClick={() => toggleField('conversion_partner_id')}
                    className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center gap-1"
                  >
                    {showFields.conversion_partner_id ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    <span>{showFields.conversion_partner_id ? 'Hide' : 'Show'}</span>
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showFields.conversion_partner_id ? 'text' : 'password'}
                    value={form.conversion_partner_id}
                    onChange={(e) => setForm({ ...form, conversion_partner_id: e.target.value })}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md px-3 py-2 text-sm text-slate-900 dark:text-white font-mono"
                    placeholder="numeric Partner/Aggregator ID"
                    autoComplete="off"
                  />
                </div>
              </div>

              {/* Production rwg_token(s) */}
              <div className="space-y-1.5 sm:col-span-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-900 dark:text-white">Production Test Token(s)</label>
                  <button
                    type="button"
                    onClick={() => toggleField('production_rwg_tokens')}
                    className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center gap-1"
                  >
                    {showFields.production_rwg_tokens ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    <span>{showFields.production_rwg_tokens ? 'Hide' : 'Show'}</span>
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showFields.production_rwg_tokens ? 'text' : 'password'}
                    value={form.production_rwg_tokens}
                    onChange={(e) => setForm({ ...form, production_rwg_tokens: e.target.value })}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md px-3 py-2 text-sm text-slate-900 dark:text-white font-mono"
                    placeholder="rwg_token_a, rwg_token_b, rwg_token_c"
                    autoComplete="off"
                  />
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Production has no fixed test token like sandbox does -- Google's production conversion endpoint
                  only accepts a real rwg_token a customer actually generated by clicking "Order Online." Paste
                  3 distinct captured tokens (comma-separated), one per referred merchant, to satisfy Google's
                  "3 events" check.
                </p>
              </div>

              {/* Portal Status Sandbox */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-900 dark:text-white">Portal Status (sandbox)</label>
                <select
                  value={form.portal_status_sandbox}
                  onChange={(e) => setForm({ ...form, portal_status_sandbox: e.target.value })}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md px-3 py-2 text-sm text-slate-900 dark:text-white capitalize"
                >
                  {PORTAL_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
              </div>

              {/* Portal Status Production */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-900 dark:text-white">Portal Status (production)</label>
                <select
                  value={form.portal_status_production}
                  onChange={(e) => setForm({ ...form, portal_status_production: e.target.value })}
                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md px-3 py-2 text-sm text-slate-900 dark:text-white capitalize"
                >
                  {PORTAL_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
              </div>
            </div>

            {/* Menu Feeds Toggle */}
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
                    Also enable Menu Feeds (Optional)
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 block mt-0.5">
                    A separate track (<code className="font-mono text-slate-600 dark:text-slate-300">google.food_menu</code>) for restaurants that want their menu
                    items to display directly on Google Search &amp; Maps.
                  </span>
                </span>
              </label>

              {form.menu_feeds_enabled && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-7">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-slate-900 dark:text-white">Generic SFTP (sandbox)</label>
                      <button
                        type="button"
                        onClick={() => toggleField('generic_sftp_username_sandbox')}
                        className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center gap-1"
                      >
                        {showFields.generic_sftp_username_sandbox ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        <span>{showFields.generic_sftp_username_sandbox ? 'Hide' : 'Show'}</span>
                      </button>
                    </div>
                    <input
                      type={showFields.generic_sftp_username_sandbox ? 'text' : 'password'}
                      value={form.generic_sftp_username_sandbox}
                      onChange={(e) => setForm({ ...form, generic_sftp_username_sandbox: e.target.value })}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md px-3 py-2 text-sm text-slate-900 dark:text-white font-mono"
                      placeholder="generic-sandbox-username"
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium text-slate-900 dark:text-white">Generic SFTP (production)</label>
                      <button
                        type="button"
                        onClick={() => toggleField('generic_sftp_username_production')}
                        className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center gap-1"
                      >
                        {showFields.generic_sftp_username_production ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        <span>{showFields.generic_sftp_username_production ? 'Hide' : 'Show'}</span>
                      </button>
                    </div>
                    <input
                      type={showFields.generic_sftp_username_production ? 'text' : 'password'}
                      value={form.generic_sftp_username_production}
                      onChange={(e) => setForm({ ...form, generic_sftp_username_production: e.target.value })}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md px-3 py-2 text-sm text-slate-900 dark:text-white font-mono"
                      placeholder="generic-production-username"
                      autoComplete="off"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg flex items-center gap-2 shadow-sm transition-colors"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Save Configuration
              </button>
            </div>
          </>
        )}
      </div>

      {/* SSH Public Key for Google Partner Portal Card */}
      <div className="p-6 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="w-5 h-5 text-indigo-500" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              SSH Public Key for Google Partner Portal
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {sftpKeyInfo?.public_key && (
              <button
                type="button"
                onClick={() => toggleField('ssh_public_key')}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-600"
              >
                {showFields.ssh_public_key ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{showFields.ssh_public_key ? 'Hide Key' : 'Show Key'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleGenerateKey}
              disabled={generatingKey}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm disabled:opacity-50"
            >
              {generatingKey ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 text-slate-500" />}
              <span>Generate Dedicated Key</span>
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          To authenticate SFTP feed uploads with Google, copy this <strong>Public Key</strong> and register it in Google Partner Portal.
        </p>

        {keyLoading ? (
          <div className="h-20 animate-pulse bg-slate-100 dark:bg-slate-700 rounded-lg" />
        ) : sftpKeyInfo?.public_key ? (
          <div className="space-y-3">
            <div className="relative group">
              <pre className="p-3.5 bg-slate-900 text-slate-100 rounded-lg text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all border border-slate-800 selection:bg-blue-600 selection:text-white">
                {showFields.ssh_public_key
                  ? sftpKeyInfo.public_key
                  : 'ssh-rsa •••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••• (Masked for privacy)'}
              </pre>
              <button
                type="button"
                onClick={handleCopyKey}
                className="absolute top-2.5 right-2.5 px-2.5 py-1 text-xs font-medium rounded bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1 shadow transition-colors"
                title="Copy Public Key to clipboard"
              >
                {keyCopied ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Key</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Server Key Path: <code className="font-mono text-slate-700 dark:text-slate-300 font-semibold">{formatKeyPath(sftpKeyInfo.key_path)}</code></span>
              <span className="text-green-600 dark:text-green-400 flex items-center gap-1 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" /> Private key ready on server
              </span>
            </div>
          </div>
        ) : (
          <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-lg flex items-center justify-between">
            <div className="text-xs text-amber-800 dark:text-amber-300">
              No SSH key found yet. Click <strong>Generate Dedicated Key</strong> to create a secure ED25519 key pair automatically.
            </div>
            <button
              type="button"
              onClick={handleGenerateKey}
              disabled={generatingKey}
              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium rounded-md flex items-center gap-1.5"
            >
              {generatingKey ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Key className="w-3.5 h-3.5" />}
              <span>Generate Key Pair</span>
            </button>
          </div>
        )}

        {/* 3-Step Guide */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-700/60">
          <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wider">
            Quick Partner Portal Registration Steps:
          </h3>
          <ol className="text-xs text-slate-600 dark:text-slate-400 space-y-1.5 list-decimal list-inside leading-relaxed">
            <li>Click <strong>Copy Key</strong> above to copy your public key string (works even when masked).</li>
            <li>Sign in to <span className="font-medium text-slate-800 dark:text-slate-200">Google Actions Center Partner Portal</span> &rarr; go to <strong>Account and Users</strong> &rarr; <strong>Account</strong> tab.</li>
            <li>Paste into the <strong>SSH Keys</strong> field and save. Google will assign your sandbox/production <strong>SFTP Username</strong>.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}


