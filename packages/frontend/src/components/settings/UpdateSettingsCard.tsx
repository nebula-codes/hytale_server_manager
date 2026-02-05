import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Button } from '../ui';
import { Download, RefreshCw, Check, ExternalLink, Info, X, Play, Loader2, AlertTriangle, Container } from 'lucide-react';
import { useUpdateStore } from '../../stores/updateStore';
import { api } from '../../services/api';

export const UpdateSettingsCard = () => {
  const { t } = useTranslation();
  const {
    updateInfo,
    isLoading,
    error,
    lastChecked,
    dismissed,
    checkForUpdates,
    resetDismiss,
    clearError,
  } = useUpdateStore();

  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateSuccess, setUpdateSuccess] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    // Load update info on mount
    checkForUpdates();
  }, [checkForUpdates]);

  const handleApplyUpdate = async () => {
    setShowConfirm(false);
    setIsUpdating(true);
    setUpdateError(null);

    try {
      const response = await api.post<{ success: boolean; message: string }>('/system/updates/apply');

      if (response.success) {
        setUpdateSuccess(true);
        // The server will restart, so we'll lose connection
        // Show a message and try to reconnect
        setTimeout(() => {
          window.location.reload();
        }, 10000);
      } else {
        setUpdateError(response.message || t('settings.updates.apply_failed'));
        setIsUpdating(false);
      }
    } catch (err: any) {
      setUpdateError(err.message || t('settings.updates.apply_failed'));
      setIsUpdating(false);
    }
  };

  return (
    <Card id="updates">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Download size={20} />
              {t('settings.updates.title')}
            </CardTitle>
            <CardDescription>
              {t('settings.updates.description')}
            </CardDescription>
          </div>
          {updateInfo?.updateAvailable && !dismissed && (
            <span className="flex items-center gap-1 px-2 py-1 bg-accent-primary/20 text-accent-primary rounded text-sm">
              <Download size={14} />
              {t('settings.updates.update_available')}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="bg-red-500/10 text-red-500 p-3 rounded mb-4 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={clearError} className="hover:opacity-80">
              <X size={16} />
            </button>
          </div>
        )}

        {/* Docker Mode - Simplified Version Display */}
        {updateInfo?.isDocker ? (
          <div className="space-y-4">
            <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
              <div className="flex items-center gap-3">
                <Container size={24} className="text-blue-400" />
                <div>
                  <p className="text-lg font-semibold text-text-light-primary dark:text-text-primary">
                    v{updateInfo.currentVersion}
                  </p>
                  <p className="text-sm text-text-light-muted dark:text-text-muted">
                    {t('settings.updates.docker_mode')}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3 p-4 bg-blue-500/10 text-blue-400 rounded-lg">
              <Info size={20} className="flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium mb-1">{t('settings.updates.docker.instructions_title')}</p>
                <ul className="list-disc list-inside space-y-1 text-blue-300">
                  <li>{t('settings.updates.docker.step_pull')} <code className="bg-gray-800 px-1 rounded">docker pull ghcr.io/your-repo/hsm:latest</code></li>
                  <li>{t('settings.updates.docker.step_restart')}</li>
                  <li>{t('settings.updates.docker.step_data')}</li>
                </ul>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Version Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
                <p className="text-sm text-text-light-muted dark:text-text-muted mb-1">{t('settings.updates.current_version')}</p>
                <p className="text-lg font-semibold text-text-light-primary dark:text-text-primary">
                  v{updateInfo?.currentVersion || '...'}
                </p>
              </div>
              <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
                <p className="text-sm text-text-light-muted dark:text-text-muted mb-1">{t('settings.updates.latest_version')}</p>
                <p className="text-lg font-semibold text-text-light-primary dark:text-text-primary">
                  {updateInfo?.latestVersion ? `v${updateInfo.latestVersion}` : isLoading ? t('settings.updates.checking') : 'Unknown'}
                </p>
              </div>
            </div>

            {/* Update Available Section */}
            {updateInfo?.updateAvailable && (
              <div className="border border-accent-primary/30 rounded-lg p-4 mb-6">
                <div className="flex items-start gap-3 mb-4">
                  <Download size={20} className="text-accent-primary mt-1 flex-shrink-0" />
                  <div>
                    <h4 className="font-medium text-text-light-primary dark:text-text-primary">
                      {updateInfo.releaseName || t('settings.updates.version_name', { version: updateInfo.latestVersion })}
                    </h4>
                    <p className="text-sm text-text-light-muted dark:text-text-muted">
                      {updateInfo.publishedAt
                        ? t('settings.updates.released_on', { date: new Date(updateInfo.publishedAt).toLocaleDateString() })
                        : t('settings.updates.released_recently')}
                    </p>
                  </div>
                </div>

                {/* Release Notes */}
                {updateInfo.releaseNotes && (
                  <div className="mb-4">
                    <h5 className="text-sm font-medium mb-2 text-text-light-primary dark:text-text-primary">{t('settings.updates.release_notes')}</h5>
                    <div className="p-3 bg-gray-100 dark:bg-gray-800 rounded text-sm max-h-40 overflow-y-auto">
                      <pre className="whitespace-pre-wrap font-sans text-text-light-secondary dark:text-text-secondary">
                        {updateInfo.releaseNotes}
                      </pre>
                    </div>
                  </div>
                )}

                {/* Update Error */}
                {updateError && (
                  <div className="bg-red-500/10 text-red-500 p-3 rounded mb-4 flex items-center justify-between">
                    <span>{updateError}</span>
                    <button onClick={() => setUpdateError(null)} className="hover:opacity-80">
                      <X size={16} />
                    </button>
                  </div>
                )}

                {/* Update In Progress */}
                {isUpdating && (
                  <div className="bg-accent-primary/10 text-accent-primary p-4 rounded mb-4">
                    <div className="flex items-center gap-3 mb-2">
                      <Loader2 size={20} className="animate-spin" />
                      <span className="font-medium">{t('settings.updates.updating')}</span>
                    </div>
                    <p className="text-sm opacity-80">
                      {updateSuccess
                        ? t('settings.updates.update_complete')
                        : t('settings.updates.updating_message')}
                    </p>
                  </div>
                )}

                {/* Confirmation Dialog */}
                {showConfirm && !isUpdating && (
                  <div className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-500 p-4 rounded mb-4">
                    <div className="flex items-start gap-3 mb-3">
                      <AlertTriangle size={20} className="flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium mb-1">{t('settings.updates.confirm_update')}</p>
                        <p className="text-sm opacity-80">
                          {t('settings.updates.confirm_message')}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-3 ml-8">
                      <Button
                        onClick={handleApplyUpdate}
                        className="bg-accent-primary hover:bg-accent-primary/90 text-black"
                      >
                        <Play size={16} />
                        {t('settings.updates.confirm_yes')}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setShowConfirm(false)}
                      >
                        {t('common.cancel', { defaultValue: 'Cancel' })}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                {!isUpdating && !showConfirm && (
                  <div className="flex flex-wrap gap-3">
                    <Button
                      onClick={() => setShowConfirm(true)}
                      className="bg-accent-primary hover:bg-accent-primary/90 text-black"
                    >
                      <Play size={16} />
                      {t('settings.updates.update_now')}
                    </Button>
                    {updateInfo.downloadUrl && (
                      <a
                        href={updateInfo.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-text-light-primary dark:text-text-primary rounded-lg transition-colors"
                      >
                        <Download size={16} />
                        {t('settings.updates.download_manually')}
                      </a>
                    )}
                    {updateInfo.releaseUrl && (
                      <a
                        href={updateInfo.releaseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-text-light-primary dark:text-text-primary rounded-lg transition-colors"
                      >
                        <ExternalLink size={16} />
                        {t('settings.updates.view_github')}
                      </a>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* No Update Available */}
            {updateInfo && !updateInfo.updateAvailable && !updateInfo.message?.includes('not configured') && (
              <div className="flex items-center gap-3 p-4 bg-green-500/10 text-green-500 rounded-lg mb-6">
                <Check size={20} />
                <span>{t('settings.updates.up_to_date')}</span>
              </div>
            )}

            {/* Not configured message */}
            {updateInfo?.message?.includes('not configured') && (
              <div className="flex items-center gap-3 p-4 bg-yellow-500/10 text-yellow-500 rounded-lg mb-6">
                <Info size={20} />
                <span>{updateInfo.message}</span>
              </div>
            )}

            {/* Info Box */}
            <div className="flex items-start gap-3 p-4 bg-blue-500/10 text-blue-400 rounded-lg">
              <Info size={20} className="flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium mb-1">{t('settings.updates.info.title')}</p>
                <ul className="list-disc list-inside space-y-1 text-blue-300">
                  {(t('settings.updates.info.steps', { returnObjects: true }) as string[]).map((step, index) => (
                    <li key={index}>{step}</li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}
      </CardContent>
      {!updateInfo?.isDocker && (
        <CardFooter className="flex items-center justify-between flex-wrap gap-4">
          <div className="text-sm text-text-light-muted dark:text-text-muted">
            {lastChecked && (
              <span>{t('settings.updates.last_checked', { date: lastChecked.toLocaleString() })}</span>
            )}
          </div>
          <div className="flex gap-3">
            {dismissed && updateInfo?.updateAvailable && (
              <Button variant="ghost" size="sm" onClick={resetDismiss}>
                {t('settings.updates.show_update')}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => checkForUpdates(true)}
              disabled={isLoading}
              loading={isLoading}
            >
              <RefreshCw size={16} />
              {isLoading ? t('settings.updates.checking') : t('settings.updates.check')}
            </Button>
          </div>
        </CardFooter>
      )}
    </Card>
  );
};
