import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useHytaleDownloaderStore,
  useHytaleDownloaderDownload,
} from '../../stores/hytaleDownloaderStore';
import {
  Download,
  Loader2,
  CheckCircle,
  XCircle,
  X,
  Archive,
  Shield,
} from 'lucide-react';
import { Button } from '../ui/Button';

interface HytaleDownloadProgressProps {
  onComplete?: (path: string) => void;
  onError?: (error: string) => void;
  showCancel?: boolean;
}

export const HytaleDownloadProgress = ({
  onComplete,
  onError,
  showCancel = true,
}: HytaleDownloadProgressProps) => {
  const { t } = useTranslation();
  const { cancelDownload } = useHytaleDownloaderStore();
  const downloadSession = useHytaleDownloaderDownload();

  const handleCancel = useCallback(() => {
    cancelDownload();
  }, [cancelDownload]);

  // Notify parent on completion/error
  if (downloadSession?.status === 'complete' && onComplete) {
    onComplete(downloadSession.destinationPath);
  }

  if (downloadSession?.status === 'failed' && onError && downloadSession.error) {
    onError(downloadSession.error);
  }

  if (!downloadSession) {
    return null;
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatSpeed = (bytesPerSecond: number) => {
    return formatBytes(bytesPerSecond) + '/s';
  };

  const getStatusInfo = () => {
    switch (downloadSession.status) {
      case 'downloading':
        return {
          icon: <Download className="w-5 h-5 text-accent-primary" />,
          label: t('hytale_downloader.progress.downloading'),
          color: 'bg-accent-primary',
        };
      case 'extracting':
        return {
          icon: <Archive className="w-5 h-5 text-yellow-500" />,
          label: t('hytale_downloader.progress.extracting'),
          color: 'bg-yellow-500',
        };
      case 'validating':
        return {
          icon: <Shield className="w-5 h-5 text-blue-500" />,
          label: t('hytale_downloader.progress.validating'),
          color: 'bg-blue-500',
        };
      case 'complete':
        return {
          icon: <CheckCircle className="w-5 h-5 text-green-500" />,
          label: t('hytale_downloader.progress.complete'),
          color: 'bg-green-500',
        };
      case 'failed':
        return {
          icon: <XCircle className="w-5 h-5 text-red-500" />,
          label: t('hytale_downloader.progress.failed'),
          color: 'bg-red-500',
        };
      default:
        return {
          icon: <Loader2 className="w-5 h-5 text-gray-500 animate-spin" />,
          label: t('hytale_downloader.progress.processing'),
          color: 'bg-gray-500',
        };
    }
  };

  const statusInfo = getStatusInfo();
  const isActive = ['downloading', 'extracting', 'validating'].includes(downloadSession.status);

  return (
    <div className="bg-gray-100 dark:bg-gray-800/50 rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {statusInfo.icon}
          <span className="font-medium text-text-light-primary dark:text-text-primary">
            {statusInfo.label}
          </span>
        </div>
        {showCancel && isActive && (
          <Button variant="ghost" size="sm" onClick={handleCancel}>
            <X size={16} />
          </Button>
        )}
      </div>

      {/* Progress bar */}
      {isActive && (
        <div className="mb-3">
          <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full ${statusInfo.color} transition-all duration-300`}
              style={{ width: `${downloadSession.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="flex flex-wrap gap-4 text-sm text-text-light-muted dark:text-text-muted">
        {/* Progress percentage */}
        <div>
          <span className="font-medium">{downloadSession.progress.toFixed(1)}%</span>
        </div>

        {/* Bytes downloaded */}
        {downloadSession.totalBytes > 0 && (
          <div>
            <span>
              {formatBytes(downloadSession.bytesDownloaded)} / {formatBytes(downloadSession.totalBytes)}
            </span>
          </div>
        )}

        {/* Speed */}
        {downloadSession.speed > 0 && isActive && (
          <div>
            <span>{formatSpeed(downloadSession.speed)}</span>
          </div>
        )}
      </div>

      {/* Error message */}
      {downloadSession.status === 'failed' && downloadSession.error && (
        <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-sm text-red-500">{downloadSession.error}</p>
        </div>
      )}

      {/* Success message */}
      {downloadSession.status === 'complete' && (
        <div className="mt-3 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
          <p className="text-sm text-green-500">
            {t('hytale_downloader.progress.success')}
          </p>
          <p className="text-xs text-green-400 mt-1 font-mono break-all">
            {downloadSession.destinationPath}
          </p>
        </div>
      )}
    </div>
  );
};

/**
 * Compact inline progress indicator
 */
export const HytaleDownloadProgressInline = () => {
  const downloadSession = useHytaleDownloaderDownload();
  const { t } = useTranslation();

  if (!downloadSession) {
    return null;
  }

  const isActive = ['downloading', 'extracting', 'validating'].includes(downloadSession.status);

  if (!isActive) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 text-sm text-text-light-muted dark:text-text-muted">
      <Loader2 size={14} className="animate-spin" />
      <span>
        {downloadSession.status === 'downloading' &&
          t('hytale_downloader.progress.inline.downloading', { percent: downloadSession.progress.toFixed(0) })}
        {downloadSession.status === 'extracting' && t('hytale_downloader.progress.inline.extracting')}
        {downloadSession.status === 'validating' && t('hytale_downloader.progress.inline.validating')}
      </span>
    </div>
  );
};
