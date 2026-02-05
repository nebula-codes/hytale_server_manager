import { ArrowUp, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../ui/Badge';
import { useCheckServerUpdate } from '../../hooks/api/useServerUpdates';

interface ServerUpdateBadgeProps {
  serverId: string;
  currentVersion: string;
  compact?: boolean;
  onUpdateClick?: () => void;
}

export const ServerUpdateBadge = ({
  serverId,
  compact = false,
  onUpdateClick,
}: ServerUpdateBadgeProps) => {
  const { t } = useTranslation();
  const { data: versionCheck, isLoading } = useCheckServerUpdate(serverId, {
    // Only enable if we have a serverId
    enabled: !!serverId,
  });

  if (isLoading) {
    return (
      <Badge variant="default" size="sm" className="animate-pulse">
        <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
        {t('updates.badge.checking')}
      </Badge>
    );
  }

  if (!versionCheck?.updateAvailable) {
    return null;
  }

  if (compact) {
    return (
      <button
        onClick={onUpdateClick}
        className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-white bg-accent-primary rounded-full hover:bg-accent-primary/80 transition-colors"
        title={t('updates.badge.available_tooltip', { version: versionCheck.availableVersion })}
      >
        <ArrowUp className="w-3 h-3" />
        {t('updates.badge.update')}
      </button>
    );
  }

  return (
    <button
      onClick={onUpdateClick}
      className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-accent-primary rounded-lg hover:bg-accent-primary/80 transition-colors"
    >
      <ArrowUp className="w-4 h-4" />
      <span>{t('updates.badge.update_to', { version: versionCheck.availableVersion })}</span>
    </button>
  );
};

export default ServerUpdateBadge;
