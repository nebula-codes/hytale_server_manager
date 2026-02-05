import { CheckCircle, XCircle, RotateCcw, Clock, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalFooter } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { useServerUpdateHistory, useRollbackServerUpdate } from '../../hooks/api/useServerUpdates';
import type { UpdateStatus, ServerUpdateHistory } from '../../types';

interface UpdateHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverId: string;
  serverName: string;
  canRollback: boolean; // true if preUpdateBackupId exists
}

const STATUS_BADGES: Record<UpdateStatus, { variant: 'success' | 'danger' | 'warning' | 'info' | 'default'; label: string }> = {
  pending: { variant: 'info', label: 'Pending' },
  stopping: { variant: 'info', label: 'Stopping' },
  backing_up: { variant: 'info', label: 'Backing Up' },
  preserving: { variant: 'info', label: 'Preserving' },
  downloading: { variant: 'info', label: 'Downloading' },
  installing: { variant: 'info', label: 'Installing' },
  restoring: { variant: 'info', label: 'Restoring' },
  starting: { variant: 'info', label: 'Starting' },
  completed: { variant: 'success', label: 'Completed' },
  failed: { variant: 'danger', label: 'Failed' },
  rolled_back: { variant: 'warning', label: 'Rolled Back' },
};

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const UpdateHistoryModal = ({
  isOpen,
  onClose,
  serverId,
  serverName,
  canRollback,
}: UpdateHistoryModalProps) => {
  const { t } = useTranslation();
  const { data: history, isLoading, error } = useServerUpdateHistory(serverId, 20);
  const rollbackUpdate = useRollbackServerUpdate();

  const handleRollback = async () => {
    if (!confirm(t('updates.history.rollback_confirm'))) {
      return;
    }

    try {
      await rollbackUpdate.mutateAsync(serverId);
      onClose();
    } catch (err) {
      // Error is handled by the hook
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('updates.history.title')}
      size="lg"
    >
      <div className="space-y-4">
        <p className="text-sm text-text-light-muted dark:text-text-muted">
          {t('updates.history.subtitle', { server: serverName })}
        </p>

        {/* Rollback option */}
        {canRollback && (
          <div className="flex items-center justify-between p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <div>
              <p className="font-medium text-yellow-500">{t('updates.history.rollback_title')}</p>
              <p className="text-sm text-text-light-muted dark:text-text-muted">
                {t('updates.history.rollback_description')}
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={handleRollback}
              disabled={rollbackUpdate.isPending}
              className="flex items-center gap-2"
            >
              {rollbackUpdate.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4" />
              )}
              {t('updates.history.rollback')}
            </Button>
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-accent-primary" />
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-sm text-red-400">{t('updates.history.load_error', { error: error.message })}</p>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && (!history || history.length === 0) && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Clock className="w-12 h-12 text-text-light-muted dark:text-text-muted mb-3" />
            <p className="font-medium text-text-light-primary dark:text-text-primary">{t('updates.history.empty_title')}</p>
            <p className="text-sm text-text-light-muted dark:text-text-muted mt-1">
              {t('updates.history.empty_description')}
            </p>
          </div>
        )}

        {/* History list */}
        {!isLoading && history && history.length > 0 && (
          <div className="space-y-3 max-h-96 overflow-y-auto custom-scrollbar">
            {history.map((record: ServerUpdateHistory) => {
              const statusConfig = STATUS_BADGES[record.status];

              return (
                <div
                  key={record.id}
                  className="flex items-start justify-between p-4 bg-gray-100 dark:bg-gray-800/50 rounded-lg"
                >
                  <div className="flex items-start gap-3">
                    {/* Status icon */}
                    <div className="mt-0.5">
                      {record.status === 'completed' && (
                        <CheckCircle className="w-5 h-5 text-green-500" />
                      )}
                      {record.status === 'failed' && (
                        <XCircle className="w-5 h-5 text-red-500" />
                      )}
                      {record.status === 'rolled_back' && (
                        <RotateCcw className="w-5 h-5 text-yellow-500" />
                      )}
                      {!['completed', 'failed', 'rolled_back'].includes(record.status) && (
                        <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
                      )}
                    </div>

                    {/* Details */}
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-text-light-primary dark:text-text-primary">
                          {record.fromVersion}
                        </span>
                        <span className="text-text-light-muted dark:text-text-muted">→</span>
                        <span className="font-medium text-text-light-primary dark:text-text-primary">
                          {record.toVersion}
                        </span>
                        <Badge variant={statusConfig.variant} size="sm">
                          {t(`updates.history.status.${record.status}`, statusConfig.label)}
                        </Badge>
                      </div>

                      <p className="text-sm text-text-light-muted dark:text-text-muted">
                        {formatDate(record.startedAt)}
                       {record.completedAt && ` - ${formatDate(record.completedAt)}`}
                      </p>

                      {record.error && (
                        <p className="text-sm text-red-400 mt-1">{record.error}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          {t('common.close')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default UpdateHistoryModal;
