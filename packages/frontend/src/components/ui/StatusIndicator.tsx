import type { ServerStatus } from '../../types';
import { useTranslation } from 'react-i18next';

interface StatusIndicatorProps {
  status: ServerStatus | 'online' | 'offline';
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const StatusIndicator = ({ status, showLabel = false, size = 'md' }: StatusIndicatorProps) => {
  const { t } = useTranslation();
  const statusConfig = {
    running: {
      className: 'status-running',
      label: t('servers.status.running'),
    },
    online: {
      className: 'status-running',
      label: t('ui.status.online'),
    },
    stopped: {
      className: 'status-stopped',
      label: t('servers.status.stopped'),
    },
    offline: {
      className: 'status-stopped',
      label: t('ui.status.offline'),
    },
    starting: {
      className: 'status-warning',
      label: t('servers.status.starting'),
    },
    stopping: {
      className: 'status-warning',
      label: t('servers.status.stopping'),
    },
    crashed: {
      className: 'status-error',
      label: t('servers.status.crashed'),
    },
    orphaned: {
      className: 'status-warning',
      label: t('servers.status.orphaned', 'Reconnecting'),
    },
  };

  const sizes = {
    sm: 'w-2 h-2',
    md: 'w-3 h-3',
    lg: 'w-4 h-4',
  };

  const config = statusConfig[status];

  return (
    <div className="flex items-center gap-2">
      <div className={`status-indicator ${config.className} ${sizes[size]}`} />
      {showLabel && <span className="text-sm text-text-muted">{config.label}</span>}
    </div>
  );
};
