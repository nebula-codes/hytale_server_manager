import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Input } from '../../components/ui';
import { UpdateSettingsCard } from '../../components/settings/UpdateSettingsCard';
import { HytaleDownloaderSettingsCard } from '../../components/settings/HytaleDownloaderSettingsCard';
import { Save, Bell, Check, X, ExternalLink, Lock, Eye, EyeOff, HardDrive, Server, Package } from 'lucide-react';
import { api } from '../../services/api';
import { useModProviderStore } from '../../stores/modProviderStore';
import { authService, AuthError } from '../../services/auth';
import type { ChangePasswordRequest } from '../../services/auth';

interface DiscordSettings {
  enabled: boolean;
  webhookUrl?: string;
  username?: string;
  avatarUrl?: string;
  enabledEvents: string[];
  mentionRoleId?: string;
}

interface FtpSettings {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password: string;
  secure: boolean;
  configured: boolean;
}

interface FtpStatus {
  enabled: boolean;
  connected: boolean;
  message: string;
}

const ALL_EVENTS = [
  'server_start', 'server_stop', 'server_restart', 'server_crash',
  'player_join', 'player_leave', 'player_ban', 'player_unban', 'player_kick',
  'backup_complete', 'backup_failed',
  'alert_critical', 'alert_warning',
  'high_cpu', 'high_memory', 'high_disk'
];

export const SettingsPage = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const { providers, loadProviders, configureProvider } = useModProviderStore();

  const [settings, setSettings] = useState<DiscordSettings>({
    enabled: false,
    webhookUrl: '',
    username: 'Hytale Server Manager',
    avatarUrl: '',
    enabledEvents: [],
    mentionRoleId: '',
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Password change state
  const [passwordForm, setPasswordForm] = useState<ChangePasswordRequest>({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // FTP settings state
  const [ftpSettings, setFtpSettings] = useState<FtpSettings>({
    enabled: false,
    host: '',
    port: 21,
    username: '',
    password: '',
    secure: false,
    configured: false,
  });
  const [ftpStatus, setFtpStatus] = useState<FtpStatus | null>(null);
  const [ftpTesting, setFtpTesting] = useState(false);
  const [ftpError, setFtpError] = useState<string | null>(null);
  const [ftpSuccess, setFtpSuccess] = useState<string | null>(null);
  const [showFtpPassword, setShowFtpPassword] = useState(false);

  // Mod provider state
  const [providerApiKeys, setProviderApiKeys] = useState<Record<string, string>>({});
  const [providerSaving, setProviderSaving] = useState<Record<string, boolean>>({});
  const [providerSuccess, setProviderSuccess] = useState<Record<string, string>>({});
  const [providerError, setProviderError] = useState<Record<string, string>>({});

  useEffect(() => {
    loadSettings();
    loadFtpSettings();
    loadProviders();
  }, []);

  // Scroll to hash section (e.g., #security)
  useEffect(() => {
    if (location.hash) {
      // Use a longer timeout to ensure page content is rendered
      const scrollToElement = () => {
        const element = document.querySelector(location.hash);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      };
      // Try multiple times in case content is still loading
      setTimeout(scrollToElement, 100);
      setTimeout(scrollToElement, 300);
    }
  }, [location.hash, location.key]);

  const loadSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getDiscordSettings<DiscordSettings>();
      // Ensure enabledEvents is always an array
      setSettings({
        ...data,
        enabledEvents: data.enabledEvents ?? [],
      });
    } catch (err: any) {
      setError(err.message || t('settings.discord.errors.load'));
    } finally {
      setLoading(false);
    }
  };

  const loadFtpSettings = async () => {
    try {
      const [settings, status] = await Promise.all([
        api.get<FtpSettings>('/settings/ftp'),
        api.get<FtpStatus>('/settings/ftp/status'),
      ]);
      setFtpSettings(settings);
      setFtpStatus(status);
    } catch (err: any) {
      console.error('Failed to load FTP settings:', err);
      setFtpError(t('settings.ftp.errors.load'));
    }
  };

  const handleFtpTest = async () => {
    setFtpTesting(true);
    setFtpError(null);
    setFtpSuccess(null);

    try {
      const result = await api.post<{ success: boolean; message: string }>('/settings/ftp/test', {
        host: ftpSettings.host,
        port: ftpSettings.port,
        username: ftpSettings.username,
        password: ftpSettings.password,
        secure: ftpSettings.secure,
      });

      if (result.success) {
        setFtpSuccess(result.message);
        setFtpStatus({ enabled: true, connected: true, message: result.message });
      } else {
        setFtpError(result.message);
        setFtpStatus({ enabled: true, connected: false, message: result.message });
      }
    } catch (err: any) {
      setFtpError(err.message || t('settings.ftp.errors.test'));
    } finally {
      setFtpTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await api.updateDiscordSettings(settings);
      setSuccess(t('settings.discord.success.saved'));
    } catch (err: any) {
      setError(err.message || t('settings.discord.errors.save'));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setError(null);
    setSuccess(null);
    try {
      await api.testDiscordNotification();
      setSuccess(t('settings.discord.success.test'));
    } catch (err: any) {
      setError(err.message || t('settings.discord.errors.test'));
    } finally {
      setTesting(false);
    }
  };

  const handleProviderSave = async (providerId: string) => {
    const apiKey = providerApiKeys[providerId];
    if (!apiKey?.trim()) return;

    setProviderSaving(prev => ({ ...prev, [providerId]: true }));
    setProviderError(prev => ({ ...prev, [providerId]: '' }));
    setProviderSuccess(prev => ({ ...prev, [providerId]: '' }));

    try {
      await configureProvider(providerId, apiKey);
      setProviderSuccess(prev => ({ ...prev, [providerId]: t('settings.mods.saved') }));
      setProviderApiKeys(prev => ({ ...prev, [providerId]: '' })); // Clear the input after success
    } catch (err) {
      setProviderError(prev => ({
        ...prev,
        [providerId]: err instanceof Error ? err.message : t('settings.mods.save_error'),
      }));
    } finally {
      setProviderSaving(prev => ({ ...prev, [providerId]: false }));
    }
  };

  const toggleEvent = (eventId: string) => {
    setSettings(prev => ({
      ...prev,
      enabledEvents: prev.enabledEvents.includes(eventId)
        ? prev.enabledEvents.filter(e => e !== eventId)
        : [...prev.enabledEvents, eventId],
    }));
  };

  const handlePasswordChange = async () => {
    setPasswordSaving(true);
    setPasswordError(null);
    setPasswordSuccess(null);

    try {
      const result = await authService.changePassword(passwordForm);
      setPasswordSuccess(result.message);
      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
    } catch (err) {
      const message = err instanceof AuthError
        ? err.message
        : 'Failed to change password';
      setPasswordError(message);
    } finally {
      setPasswordSaving(false);
    }
  };

  const isPasswordFormValid = () => {
    return (
      passwordForm.currentPassword.length > 0 &&
      passwordForm.newPassword.length >= 8 &&
      passwordForm.newPassword === passwordForm.confirmPassword &&
      passwordForm.newPassword !== passwordForm.currentPassword
    );
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="text-center py-8 text-text-secondary">{t('settings.loading')}</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-text-primary">{t('settings.title')}</h1>
        <p className="text-text-secondary mt-1">{t('settings.subtitle')}</p>
      </div>

      {/* Software Updates */}
      <UpdateSettingsCard />

      {/* Hytale Server Downloader */}
      <HytaleDownloaderSettingsCard />

      {/* Mod Providers */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Package size={20} />
                {t('settings.mods.title')}
              </CardTitle>
              <CardDescription>{t('settings.mods.description')}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {providers.length === 0 ? (
              <p className="text-text-secondary text-sm">{t('settings.mods.loading')}</p>
            ) : (
              providers.map((provider) => (
                <div key={provider.id} className="border rounded-lg p-4 dark:border-gray-700">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                        {provider.iconUrl ? (
                          <img src={provider.iconUrl} alt={provider.displayName} className="w-6 h-6" />
                        ) : (
                          <Package size={20} className="text-text-secondary" />
                        )}
                      </div>
                      <div>
                        <h4 className="font-medium text-text-primary">{provider.displayName}</h4>
                        <p className="text-xs text-text-secondary">
                          {provider.requiresApiKey
                            ? provider.isConfigured
                              ? t('settings.mods.configured')
                              : t('settings.mods.key_required')
                            : t('settings.mods.no_key')}
                        </p>
                      </div>
                    </div>
                    {provider.isConfigured && (
                      <span className="flex items-center gap-1 text-green-500 text-sm">
                        <Check size={16} />
                        {t('settings.mods.configured')}
                      </span>
                    )}
                  </div>

                  {provider.requiresApiKey && (
                    <>
                      {providerError[provider.id] && (
                        <div className="bg-red-500/10 text-red-500 p-2 rounded mb-3 text-sm flex items-center justify-between">
                          <span>{providerError[provider.id]}</span>
                          <button onClick={() => setProviderError(prev => ({ ...prev, [provider.id]: '' }))}>
                            <X size={14} />
                          </button>
                        </div>
                      )}
                      {providerSuccess[provider.id] && (
                        <div className="bg-green-500/10 text-green-500 p-2 rounded mb-3 text-sm flex items-center justify-between">
                          <span className="flex items-center gap-2">
                            <Check size={14} />
                            {providerSuccess[provider.id]}
                          </span>
                          <button onClick={() => setProviderSuccess(prev => ({ ...prev, [provider.id]: '' }))}>
                            <X size={14} />
                          </button>
                        </div>
                      )}

                      <div className="flex gap-2">
                        <Input
                          type="password"
                          placeholder={provider.isConfigured ? t('settings.mods.placeholder_configured') : t('settings.mods.placeholder_key')}
                          value={providerApiKeys[provider.id] || ''}
                          onChange={(e) => setProviderApiKeys(prev => ({ ...prev, [provider.id]: e.target.value }))}
                          className="flex-1"
                        />
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleProviderSave(provider.id)}
                          disabled={!providerApiKeys[provider.id]?.trim() || providerSaving[provider.id]}
                        >
                          {providerSaving[provider.id] ? t('settings.mods.saving') : t('settings.mods.save')}
                        </Button>
                      </div>

                      {provider.id === 'curseforge' && (
                        <div className="flex items-center gap-2 mt-2">
                          <p className="text-xs text-text-secondary">
                            {t('settings.mods.get_key')}
                          </p>
                          <a
                            href="https://support.curseforge.com/en/support/solutions/articles/9000208346-about-the-curseforge-api-and-how-to-apply-for-a-key"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-accent-primary hover:underline flex items-center gap-1"
                          >
                            {t('settings.mods.curseforge_console')}
                            <ExternalLink size={12} />
                          </a>
                        </div>
                      )}
                      {provider.id === 'modtale' && (
                        <div className="flex items-center gap-2 mt-2">
                          <p className="text-xs text-text-secondary">
                            {t('settings.mods.get_key')}
                          </p>
                          <a
                            href="https://modtale.net/dashboard/developer"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-accent-primary hover:underline flex items-center gap-1"
                          >
                            {t('settings.mods.modtale_dashboard')}
                            <ExternalLink size={12} />
                          </a>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card id="security">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Lock size={20} />
                {t('settings.security.title')}
              </CardTitle>
              <CardDescription>{t('settings.security.description')}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {passwordError && (
            <div className="bg-red-500/10 text-red-500 p-3 rounded mb-4 flex items-center justify-between">
              <span>{passwordError}</span>
              <button onClick={() => setPasswordError(null)}>
                <X size={16} />
              </button>
            </div>
          )}
          {passwordSuccess && (
            <div className="bg-green-500/10 text-green-500 p-3 rounded mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Check size={16} />
                {passwordSuccess}
              </span>
              <button onClick={() => setPasswordSuccess(null)}>
                <X size={16} />
              </button>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">{t('settings.security.current')}</label>
              <div className="relative">
                <Input
                  type={showCurrentPassword ? 'text' : 'password'}
                  placeholder={t('settings.security.current')}
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm(prev => ({ ...prev, currentPassword: e.target.value }))}
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
                >
                  {showCurrentPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">{t('settings.security.new')}</label>
              <div className="relative">
                <Input
                  type={showNewPassword ? 'text' : 'password'}
                  placeholder={t('settings.security.new')}
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm(prev => ({ ...prev, newPassword: e.target.value }))}
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
                >
                  {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {passwordForm.newPassword.length > 0 && passwordForm.newPassword.length < 8 && (
                <p className="text-xs text-red-500 mt-1">{t('settings.security.min_length')}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">{t('settings.security.confirm')}</label>
              <div className="relative">
                <Input
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder={t('settings.security.confirm')}
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
                >
                  {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {passwordForm.confirmPassword.length > 0 && passwordForm.newPassword !== passwordForm.confirmPassword && (
                <p className="text-xs text-red-500 mt-1">{t('settings.security.mismatch')}</p>
              )}
            </div>

            <div className="flex gap-3 pt-4 border-t">
              <Button
                variant="primary"
                onClick={handlePasswordChange}
                disabled={passwordSaving || !isPasswordFormValid()}
              >
                <Lock size={16} className="mr-2" />
                {passwordSaving ? t('settings.security.changing') : t('settings.security.change')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Discord Notifications */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Bell size={20} />
                {t('settings.discord.title')}
              </CardTitle>
              <CardDescription>{t('settings.discord.description')}</CardDescription>
            </div>
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(e) => setSettings(prev => ({ ...prev, enabled: e.target.checked }))}
                className="mr-2"
              />
              <span className="text-sm">{t('settings.discord.enable')}</span>
            </label>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="bg-red-500/10 text-red-500 p-3 rounded mb-4 flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => setError(null)}>
                <X size={16} />
              </button>
            </div>
          )}
          {success && (
            <div className="bg-green-500/10 text-green-500 p-3 rounded mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Check size={16} />
                {success}
              </span>
              <button onClick={() => setSuccess(null)}>
                <X size={16} />
              </button>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">{t('settings.discord.webhook_url')}</label>
              <Input
                type="text"
                placeholder={settings.webhookUrl === '***' ? t('settings.discord.webhook_placeholder_configured') : t('settings.discord.webhook_placeholder')}
                value={settings.webhookUrl === '***' ? '' : (settings.webhookUrl || '')}
                onChange={(e) => setSettings(prev => ({ ...prev, webhookUrl: e.target.value }))}
                disabled={!settings.enabled}
              />
              <p className="text-xs text-text-secondary mt-1">
                {settings.webhookUrl === '***'
                  ? t('settings.discord.webhook_configured_hint')
                  : t('settings.discord.webhook_hint')}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">{t('settings.discord.username')}</label>
                <Input
                  type="text"
                  value={settings.username || ''}
                  onChange={(e) => setSettings(prev => ({ ...prev, username: e.target.value }))}
                  disabled={!settings.enabled}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">{t('settings.discord.avatar_url')}</label>
                <Input
                  type="text"
                  value={settings.avatarUrl || ''}
                  onChange={(e) => setSettings(prev => ({ ...prev, avatarUrl: e.target.value }))}
                  disabled={!settings.enabled}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">{t('settings.discord.events')}</label>
              <div className="grid grid-cols-2 gap-2">
                {ALL_EVENTS.map(event => (
                  <label key={event} className="flex items-center gap-2 p-2 border rounded">
                    <input
                      type="checkbox"
                      checked={settings.enabledEvents.includes(event)}
                      onChange={() => toggleEvent(event)}
                      disabled={!settings.enabled}
                    />
                    <span className="text-sm">{event.replace(/_/g, ' ')}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-4 border-t">
              <Button
                variant="primary"
                onClick={handleSave}
                disabled={saving || !settings.enabled}
              >
                <Save size={16} className="mr-2" />
                {saving ? t('settings.mods.saving') : t('settings.discord.save')}
              </Button>
              <Button
                variant="secondary"
                onClick={handleTest}
                disabled={testing || !settings.enabled || !settings.webhookUrl}
              >
                <Bell size={16} className="mr-2" />
                {testing ? t('settings.discord.sending') : t('settings.discord.test')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* FTP Storage Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <HardDrive size={20} />
                {t('settings.ftp.title')}
              </CardTitle>
              <CardDescription>{t('settings.ftp.description')}</CardDescription>
            </div>
                {ftpStatus && (
                  <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm ${ftpStatus.connected
                    ? 'bg-green-500/10 text-green-500'
                    : ftpStatus.enabled
                      ? 'bg-yellow-500/10 text-yellow-500'
                      : 'bg-gray-500/10 text-gray-500'
                    }`}>
                    <div className={`w-2 h-2 rounded-full ${ftpStatus.connected
                      ? 'bg-green-500'
                      : ftpStatus.enabled
                        ? 'bg-yellow-500'
                        : 'bg-gray-500'
                      }`} />
                    {ftpStatus.connected ? t('settings.ftp.status.connected') : ftpStatus.enabled ? t('settings.ftp.status.disconnected') : t('settings.ftp.status.not_configured')}
                  </div>
                )}
          </div>
        </CardHeader>
        <CardContent>
          {ftpError && (
            <div className="bg-red-500/10 text-red-500 p-3 rounded mb-4 flex items-center justify-between">
              <span>{ftpError}</span>
              <button onClick={() => setFtpError(null)}>
                <X size={16} />
              </button>
            </div>
          )}
          {ftpSuccess && (
            <div className="bg-green-500/10 text-green-500 p-3 rounded mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Check size={16} />
                {ftpSuccess}
              </span>
              <button onClick={() => setFtpSuccess(null)}>
                <X size={16} />
              </button>
            </div>
          )}

          <div className="bg-blue-500/10 text-blue-400 p-3 rounded mb-4 text-sm">
            <strong>{t('settings.ftp.note_title')}</strong> {t('settings.ftp.note')}
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">{t('settings.ftp.host')}</label>
                <Input
                  type="text"
                  placeholder="ftp.example.com"
                  value={ftpSettings.host}
                  onChange={(e) => setFtpSettings(prev => ({ ...prev, host: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">{t('settings.ftp.port')}</label>
                <Input
                  type="number"
                  value={ftpSettings.port}
                  onChange={(e) => setFtpSettings(prev => ({ ...prev, port: parseInt(e.target.value) || 21 }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">{t('settings.ftp.username')}</label>
                <Input
                  type="text"
                  placeholder="ftp_user"
                  value={ftpSettings.username}
                  onChange={(e) => setFtpSettings(prev => ({ ...prev, username: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">{t('settings.ftp.password')}</label>
                <div className="relative">
                  <Input
                    type={showFtpPassword ? 'text' : 'password'}
                    placeholder={t('settings.ftp.password_placeholder')}
                    value={ftpSettings.password}
                    onChange={(e) => setFtpSettings(prev => ({ ...prev, password: e.target.value }))}
                  />
                  <button
                    type="button"
                    onClick={() => setShowFtpPassword(!showFtpPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
                  >
                    {showFtpPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            </div>

            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ftpSettings.secure}
                  onChange={(e) => setFtpSettings(prev => ({ ...prev, secure: e.target.checked }))}
                />
                <span className="text-sm">{t('settings.ftp.secure')}</span>
              </label>
            </div>

            <div className="flex gap-3 pt-4 border-t">
              <Button
                variant="secondary"
                onClick={handleFtpTest}
                disabled={ftpTesting || !ftpSettings.host || !ftpSettings.username || !ftpSettings.password}
              >
                <Server size={16} className="mr-2" />
                {ftpTesting ? t('settings.ftp.testing') : t('settings.ftp.test')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
