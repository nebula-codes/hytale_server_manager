import { useEffect, useState, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, TokenExpiryBadge } from '../ui';
import { useTranslation } from 'react-i18next';
import { HytaleOAuthModal } from '../modals/HytaleOAuthModal';
import {
  useHytaleDownloaderStore,
  useHytaleDownloaderStatus,
  useHytaleDownloaderLoading,
  useHytaleDownloaderError,
} from '../../stores/hytaleDownloaderStore';
import {
  Download,
  RefreshCw,
  Check,
  X,
  Key,
  Trash2,
  Loader2,
  AlertCircle,
  ExternalLink,
  Clock,
} from 'lucide-react';

export const HytaleDownloaderSettingsCard = () => {
  const { t } = useTranslation();
  const {
    fetchStatus,
    installBinary,
    updateBinary,
    clearCredentials,
    clearError,
    refreshToken,
    isRefreshingToken,
    setAutoRefresh,
    isUpdatingAutoRefresh,
  } = useHytaleDownloaderStore();

  const status = useHytaleDownloaderStatus();
  const isLoading = useHytaleDownloaderLoading();
  const error = useHytaleDownloaderError();

  const [showOAuthModal, setShowOAuthModal] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [isClearingCredentials, setIsClearingCredentials] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localSuccess, setLocalSuccess] = useState<string | null>(null);

  // Fetch status on mount
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleInstall = useCallback(async () => {
    setIsInstalling(true);
    setLocalError(null);
    setLocalSuccess(null);

    try {
      await installBinary();
      setLocalSuccess(t('settings.downloader.install_success'));
    } catch (err: any) {
      setLocalError(err.message || t('settings.downloader.install_failed'));
    } finally {
      setIsInstalling(false);
    }
  }, [installBinary, t]);

  const handleUpdate = useCallback(async () => {
    setIsInstalling(true);
    setLocalError(null);
    setLocalSuccess(null);

    try {
      await updateBinary();
      setLocalSuccess(t('settings.downloader.update_success'));
    } catch (err: any) {
      setLocalError(err.message || t('settings.downloader.update_failed'));
    } finally {
      setIsInstalling(false);
    }
  }, [updateBinary, t]);

  const handleClearCredentials = useCallback(async () => {
    if (!confirm(t('settings.downloader.disconnect_confirm'))) {
      return;
    }

    setIsClearingCredentials(true);
    setLocalError(null);
    setLocalSuccess(null);

    try {
      await clearCredentials();
      setLocalSuccess(t('settings.downloader.disconnect_success'));
    } catch (err: any) {
      setLocalError(err.message || t('settings.downloader.disconnect_failed'));
    } finally {
      setIsClearingCredentials(false);
    }
  }, [clearCredentials, t]);

  const handleOAuthSuccess = useCallback(() => {
    setLocalSuccess(t('settings.downloader.connect_success'));
    setShowOAuthModal(false);
    fetchStatus();
  }, [fetchStatus, t]);

  const handleRefreshToken = useCallback(async () => {
    setLocalError(null);
    setLocalSuccess(null);

    try {
      await refreshToken();
      setLocalSuccess(t('settings.downloader.refresh_success'));
    } catch (err: any) {
      setLocalError(err.message || t('settings.downloader.refresh_failed'));
    }
  }, [refreshToken, t]);

  const handleToggleAutoRefresh = useCallback(async () => {
    setLocalError(null);
    setLocalSuccess(null);

    const newEnabled = !status?.autoRefresh?.enabled;

    try {
      await setAutoRefresh(newEnabled, 1800); // 30 minutes
      setLocalSuccess(newEnabled ? t('settings.downloader.auto_refresh_enabled') : t('settings.downloader.auto_refresh_disabled'));
    } catch (err: any) {
      setLocalError(err.message || t('settings.downloader.auto_refresh_failed'));
    }
  }, [setAutoRefresh, status?.autoRefresh?.enabled, t]);

  return (
    <>
      <Card id="hytale-downloader">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Download size={20} />
                {t('settings.downloader.title')}
              </CardTitle>
              <CardDescription>
                {t('settings.downloader.description')}
              </CardDescription>
            </div>
            {status?.binaryInstalled && (
              <div className="flex items-center gap-2 px-3 py-1 rounded-full text-sm bg-green-500/10 text-green-500">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                {t('settings.downloader.installed')}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* Error message */}
          {(error || localError) && (
            <div className="bg-red-500/10 text-red-500 p-3 rounded mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <AlertCircle size={16} />
                {error || localError}
              </span>
              <button
                onClick={() => {
                  clearError();
                  setLocalError(null);
                }}
              >
                <X size={16} />
              </button>
            </div>
          )}

          {/* Success message */}
          {localSuccess && (
            <div className="bg-green-500/10 text-green-500 p-3 rounded mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Check size={16} />
                {localSuccess}
              </span>
              <button onClick={() => setLocalSuccess(null)}>
                <X size={16} />
              </button>
            </div>
          )}

          {isLoading && !status ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-accent-primary" />
              <span className="ml-2 text-text-light-secondary dark:text-text-secondary">
                {t('settings.downloader.loading')}
              </span>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Binary Status */}
              <div className="border rounded-lg p-4 dark:border-gray-700">
                <h4 className="font-medium text-text-light-primary dark:text-text-primary mb-3">
                  {t('settings.downloader.tool')}
                </h4>

                {status?.binaryInstalled ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-text-light-secondary dark:text-text-secondary">
                        {t('settings.downloader.version')}
                      </span>
                      <span className="text-sm font-mono text-text-light-primary dark:text-text-primary">
                        {status.binaryVersion || t('settings.downloader.unknown')}
                      </span>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleUpdate}
                      disabled={isInstalling}
                    >
                      {isInstalling ? (
                        <Loader2 size={16} className="mr-2 animate-spin" />
                      ) : (
                        <RefreshCw size={16} className="mr-2" />
                      )}
                      {isInstalling ? t('settings.downloader.updating') : t('settings.downloader.update')}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-text-light-muted dark:text-text-muted">
                      {t('settings.downloader.not_installed')}
                    </p>
                    <Button
                      variant="primary"
                      onClick={handleInstall}
                      disabled={isInstalling}
                    >
                      {isInstalling ? (
                        <Loader2 size={16} className="mr-2 animate-spin" />
                      ) : (
                        <Download size={16} className="mr-2" />
                      )}
                      {isInstalling ? t('settings.downloader.installing') : t('settings.downloader.install')}
                    </Button>
                  </div>
                )}
              </div>

              {/* Authentication Status */}
              <div className="border rounded-lg p-4 dark:border-gray-700">
                <h4 className="font-medium text-text-light-primary dark:text-text-primary mb-3">
                  {t('settings.downloader.account_title')}
                </h4>

                {status?.isAuthenticated ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-green-500">
                      <Check size={16} />
                      <span className="text-sm">{t('settings.downloader.connected')}</span>
                    </div>
                    {status.accountEmail && (
                      <p className="text-sm text-text-light-muted dark:text-text-muted">
                        {t('settings.downloader.account_label', { email: status.accountEmail })}
                      </p>
                    )}

                    {/* Token Status */}
                    {status.tokenInfo && (
                      <div className="space-y-2 pt-2 border-t dark:border-gray-700">
                        <h5 className="text-xs font-medium text-text-light-secondary dark:text-text-secondary uppercase tracking-wide">
                          {t('settings.downloader.token_status')}
                        </h5>

                        <div className="flex items-center justify-between">
                          <span className="text-sm text-text-light-muted dark:text-text-muted">
                            {t('settings.downloader.access_token')}
                          </span>
                          <TokenExpiryBadge
                            expiresIn={status.tokenInfo.accessTokenExpiresIn}
                            isExpired={status.tokenInfo.isAccessTokenExpired}
                            warningThreshold={300}
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-sm text-text-light-muted dark:text-text-muted">
                            {t('settings.downloader.refresh_token')}
                          </span>
                          <TokenExpiryBadge
                            expiresIn={status.tokenInfo.refreshTokenExpiresIn}
                            isExpired={status.tokenInfo.isRefreshTokenExpired}
                            warningThreshold={86400}
                          />
                        </div>

                        {status.tokenInfo.branch && (
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-text-light-muted dark:text-text-muted">
                              {t('settings.downloader.branch')}
                            </span>
                            <span className="text-sm text-text-light-primary dark:text-text-primary">
                              {status.tokenInfo.branch}
                            </span>
                          </div>
                        )}

                        {/* Auto-refresh toggle */}
                        <div className="flex items-center justify-between pt-2 border-t dark:border-gray-700">
                          <div className="flex items-center gap-2">
                            <Clock size={16} className="text-text-light-muted dark:text-text-muted" />
                            <span className="text-sm text-text-light-muted dark:text-text-muted">
                              {t('settings.downloader.auto_refresh')}
                            </span>
                          </div>
                          <button
                            onClick={handleToggleAutoRefresh}
                            disabled={isUpdatingAutoRefresh}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${status.autoRefresh?.enabled
                              ? 'bg-accent-primary'
                              : 'bg-gray-300 dark:bg-gray-600'
                              } ${isUpdatingAutoRefresh ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${status.autoRefresh?.enabled ? 'translate-x-6' : 'translate-x-1'
                                }`}
                            />
                          </button>
                        </div>

                        <div className="flex gap-2 mt-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleRefreshToken}
                            disabled={isRefreshingToken}
                            className="flex-1"
                          >
                            {isRefreshingToken ? (
                              <Loader2 size={16} className="mr-2 animate-spin" />
                            ) : (
                              <RefreshCw size={16} className="mr-2" />
                            )}
                            {isRefreshingToken ? t('settings.downloader.refreshing') : t('settings.downloader.refresh_now')}
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setShowOAuthModal(true)}
                        disabled={!status?.binaryInstalled}
                      >
                        <Key size={16} className="mr-2" />
                        {t('settings.downloader.reconnect')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleClearCredentials}
                        disabled={isClearingCredentials}
                        className="text-red-500 hover:text-red-400"
                      >
                        {isClearingCredentials ? (
                          <Loader2 size={16} className="mr-2 animate-spin" />
                        ) : (
                          <Trash2 size={16} className="mr-2" />
                        )}
                        {isClearingCredentials ? t('settings.downloader.disconnecting') : t('settings.downloader.disconnect')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-text-light-muted dark:text-text-muted">
                      {t('settings.downloader.connect_message')}
                    </p>
                    <Button
                      variant="primary"
                      onClick={() => setShowOAuthModal(true)}
                      disabled={!status?.binaryInstalled}
                    >
                      <Key size={16} className="mr-2" />
                      {t('settings.downloader.connect_account')}
                    </Button>
                    {!status?.binaryInstalled && (
                      <p className="text-xs text-text-light-muted dark:text-text-muted">
                        {t('settings.downloader.install_first')}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="bg-blue-500/10 text-blue-400 p-3 rounded text-sm">
                <p>
                  {t('settings.downloader.info')}
                </p>
                <a
                  href="https://support.hytale.com/hc/en-us/articles/45326769420827-Hytale-Server-Manual"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-2 text-accent-primary hover:underline"
                >
                  {t('settings.downloader.view_manual')}
                  <ExternalLink size={12} />
                </a>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <HytaleOAuthModal
        isOpen={showOAuthModal}
        onClose={() => setShowOAuthModal(false)}
        onSuccess={handleOAuthSuccess}
      />
    </>
  );
};
