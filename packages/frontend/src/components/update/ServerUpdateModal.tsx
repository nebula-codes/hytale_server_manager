import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowUp,
  CheckCircle,
  XCircle,
  Loader2,
  Download,
  HardDrive,
  FolderArchive,
  PlayCircle,
  StopCircle,
  RotateCcw,
  AlertTriangle
} from 'lucide-react';
import { Modal, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';
import {
  useCheckServerUpdate,
  useStartServerUpdate,
  useCancelServerUpdate,
  useForceResetServerUpdate
} from '../../hooks/api/useServerUpdates';
import { websocket } from '../../services/websocket';
import type { UpdateStatus, ServerUpdateProgressEvent } from '../../types';

interface ServerUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverId: string;
  serverName: string;
  currentVersion: string;
}

const STATUS_CONFIG: Record<UpdateStatus, { icon: React.ReactNode; label: string; color: string }> = {
  pending: { icon: <Loader2 className="w-5 h-5 animate-spin" />, label: 'updates.modal.status.pending', color: 'text-blue-400' },
  stopping: { icon: <StopCircle className="w-5 h-5" />, label: 'updates.modal.status.stopping', color: 'text-yellow-400' },
  backing_up: { icon: <FolderArchive className="w-5 h-5" />, label: 'updates.modal.status.backing_up', color: 'text-blue-400' },
  preserving: { icon: <HardDrive className="w-5 h-5" />, label: 'updates.modal.status.preserving', color: 'text-blue-400' },
  downloading: { icon: <Download className="w-5 h-5" />, label: 'updates.modal.status.downloading', color: 'text-blue-400' },
  installing: { icon: <HardDrive className="w-5 h-5" />, label: 'updates.modal.status.installing', color: 'text-blue-400' },
  restoring: { icon: <RotateCcw className="w-5 h-5" />, label: 'updates.modal.status.restoring', color: 'text-blue-400' },
  starting: { icon: <PlayCircle className="w-5 h-5" />, label: 'updates.modal.status.starting', color: 'text-green-400' },
  completed: { icon: <CheckCircle className="w-5 h-5" />, label: 'updates.modal.status.completed', color: 'text-green-400' },
  failed: { icon: <XCircle className="w-5 h-5" />, label: 'updates.modal.status.failed', color: 'text-red-400' },
  rolled_back: { icon: <RotateCcw className="w-5 h-5" />, label: 'updates.modal.status.rolled_back', color: 'text-yellow-400' },
};

export const ServerUpdateModal = ({
  isOpen,
  onClose,
  serverId,
  serverName,
  currentVersion,
}: ServerUpdateModalProps) => {
  const { t } = useTranslation();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [message, setMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [showResetOption, setShowResetOption] = useState(false);

  const { data: versionCheck, isLoading: isChecking } = useCheckServerUpdate(serverId);
  const startUpdate = useStartServerUpdate();
  const cancelUpdate = useCancelServerUpdate();
  const forceReset = useForceResetServerUpdate();

  const isUpdating = sessionId !== null && status !== 'completed' && status !== 'failed' && status !== 'rolled_back';
  const isComplete = status === 'completed' || status === 'failed' || status === 'rolled_back';

  // WebSocket subscription for real-time updates
  useEffect(() => {
    if (!isOpen || !serverId) return;

    const unsubscribe = websocket.subscribeToServerUpdates(serverId, {
      onStarted: (data) => {
        setSessionId(data.sessionId);
        setStatus('pending');
        setProgress(0);
      },
      onProgress: (data: ServerUpdateProgressEvent) => {
        setStatus(data.status);
        setProgress(data.progress);
        if (data.message) setMessage(data.message);
      },
      onCompleted: () => {
        setStatus('completed');
        setProgress(100);
        setMessage(t('updates.modal.completed_message'));
      },
      onFailed: (data) => {
        setStatus('failed');
        setError(data.error || t('updates.modal.errors.unknown'));
      },
      onCancelled: () => {
        setStatus('failed');
        setError(t('updates.modal.errors.cancelled'));
      },
    });

    return () => {
      unsubscribe();
    };
  }, [isOpen, serverId]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setSessionId(null);
      setProgress(0);
      setStatus(null);
      setMessage('');
      setError(null);
      setShowResetOption(false);
    }
  }, [isOpen]);

  const handleStartUpdate = async () => {
    try {
      setError(null);
      setShowResetOption(false);
      const session = await startUpdate.mutateAsync({
        serverId,
        targetVersion: versionCheck?.availableVersion || undefined
      });
      setSessionId(session.sessionId);
      setStatus(session.status);
      setProgress(session.progress);
    } catch (err: any) {
      setError(err.message);
      // Show reset option if the error indicates stuck state
      if (err.message.includes('already being updated')) {
        setShowResetOption(true);
      }
    }
  };

  const handleForceReset = async () => {
    try {
      await forceReset.mutateAsync(serverId);
      setShowResetOption(false);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCancelUpdate = async () => {
    if (!sessionId) return;
    try {
      await cancelUpdate.mutateAsync(sessionId);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleClose = () => {
    if (isUpdating) {
      // Don't allow closing while update is in progress
      return;
    }
    onClose();
  };

  const statusConfig = status ? STATUS_CONFIG[status] : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('updates.modal.title')}
      size="md"
      showCloseButton={!isUpdating}
    >
      <div className="space-y-6">
        {/* Server Info */}
        <div className="flex items-center justify-between p-4 bg-gray-100 dark:bg-gray-800/50 rounded-lg">
          <div>
            <h3 className="font-medium text-text-light-primary dark:text-text-primary">{serverName}</h3>
            <p className="text-sm text-text-light-muted dark:text-text-muted">
              {t('updates.modal.current_version', { version: currentVersion })}
            </p>
          </div>
          {versionCheck?.availableVersion && (
            <div className="text-right">
              <p className="text-sm text-text-light-muted dark:text-text-muted">{t('updates.modal.available_version_label')}</p>
              <p className="font-medium text-accent-primary">{versionCheck.availableVersion}</p>
            </div>
          )}
        </div>

        {/* Pre-update warning */}
        {!isUpdating && !isComplete && (
          <div className="flex items-start gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-yellow-500 mb-1">{t('updates.modal.before.title')}</p>
              <ul className="text-text-light-muted dark:text-text-muted space-y-1 list-disc list-inside">
                <li>{t('updates.modal.before.items.backup')}</li>
                <li>{t('updates.modal.before.items.preserve')}</li>
                <li>{t('updates.modal.before.items.stop')}</li>
                <li>{t('updates.modal.before.items.rollback')}</li>
              </ul>
            </div>
          </div>
        )}

        {/* Progress Section */}
        {(isUpdating || isComplete) && (
          <div className="space-y-4">
            {/* Status */}
            <div className="flex items-center gap-3">
              <div className={statusConfig?.color}>
                {statusConfig?.icon}
              </div>
              <div>
                <p className={`font-medium ${statusConfig?.color}`}>
                  {statusConfig?.label ? t(statusConfig.label) : ''}
                </p>
                {message && (
                  <p className="text-sm text-text-light-muted dark:text-text-muted">{message}</p>
                )}
              </div>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  status === 'completed' ? 'bg-green-500' :
                  status === 'failed' ? 'bg-red-500' :
                  'bg-accent-primary'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-sm text-center text-text-light-muted dark:text-text-muted">
              {t('updates.modal.progress', { percent: progress })}
            </p>

            {/* Error Message */}
            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}
          </div>
        )}

        {/* Checking for updates */}
        {isChecking && (
          <div className="flex items-center justify-center gap-2 py-8">
            <Loader2 className="w-5 h-5 animate-spin text-accent-primary" />
           <span className="text-text-light-muted dark:text-text-muted">Checking for updates...</span>
            <span className="text-text-light-muted dark:text-text-muted">{t('updates.modal.checking')}</span>
          </div>
        )}

        {/* No updates available */}
        {!isChecking && !versionCheck?.updateAvailable && !isUpdating && !isComplete && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mb-3" />
            <p className="font-medium text-text-light-primary dark:text-text-primary">Server is up to date</p>
            <p className="text-sm text-text-light-muted dark:text-text-muted mt-1">
              {t('updates.modal.up_to_date.description', { version: currentVersion })}
            </p>
          </div>
        )}

        {/* Error when starting update (outside progress section) */}
        {error && !isUpdating && !isComplete && (
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-sm text-red-400">{error}</p>
            {showResetOption && (
              <Button
                variant="danger"
                size="sm"
                className="mt-3"
                onClick={handleForceReset}
                disabled={forceReset.isPending}
              >
                {forceReset.isPending ? 'Resetting...' : 'Reset Update State'}
              </Button>
            )}
          </div>
        )}
      </div>

      <ModalFooter>
        {/* Before update starts */}
        {!isUpdating && !isComplete && versionCheck?.updateAvailable && (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={handleStartUpdate}
              disabled={startUpdate.isPending}
              className="flex items-center gap-2"
            >
              {startUpdate.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowUp className="w-4 h-4" />
              )}
              {startUpdate.isPending ? t('common.loading') : t('updates.modal.start')}
            </Button>
          </>
        )}

        {/* During update */}
        {isUpdating && (
          <Button
            variant="danger"
            onClick={handleCancelUpdate}
            disabled={cancelUpdate.isPending}
          >
            {t('updates.modal.cancel')}
          </Button>
        )}

        {/* After update completes */}
        {isComplete && (
          <Button variant="primary" onClick={onClose}>
            {t('common.close')}
          </Button>
        )}

        {/* No update available */}
        {!isChecking && !versionCheck?.updateAvailable && !isUpdating && !isComplete && (
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
};

export default ServerUpdateModal;
