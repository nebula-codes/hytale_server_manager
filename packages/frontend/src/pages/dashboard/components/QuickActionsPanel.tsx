import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardContent, Button } from '../../../components/ui';
import { Play, Square, RotateCcw, HardDrive, RefreshCw } from 'lucide-react';
import { useToast } from '../../../stores/toastStore';
import api from '../../../services/api';

interface QuickActionsPanelProps {
  runningCount: number;
  stoppedCount: number;
  onRefresh: () => void;
}

export const QuickActionsPanel = ({ runningCount, stoppedCount, onRefresh }: QuickActionsPanelProps) => {
  const toast = useToast();
  const { t } = useTranslation();
  const [loading, setLoading] = useState<string | null>(null);

  const handleAction = async (action: 'start-all' | 'stop-all' | 'restart-all') => {
    try {
      setLoading(action);
      const response = await api.dashboardQuickAction(action);

      if (response.successCount > 0) {
        toast.success(
          t(
            action === 'start-all'
              ? 'dashboard.quick_actions.toast.success_start'
              : action === 'stop-all'
              ? 'dashboard.quick_actions.toast.success_stop'
              : 'dashboard.quick_actions.toast.success_restart',
            { count: response.successCount }
          ),
          response.failedCount > 0
            ? t('dashboard.quick_actions.toast.failed_body', { count: response.failedCount })
            : undefined
        );
      } else if (response.failedCount > 0) {
        toast.error(
          t('dashboard.quick_actions.toast.failed_title'),
          t('dashboard.quick_actions.toast.failed_body', { count: response.failedCount })
        );
      } else {
        toast.info(
          t('dashboard.quick_actions.toast.none_title'),
          t('dashboard.quick_actions.toast.none_body')
        );
      }

      onRefresh();
    } catch (error: any) {
      toast.error(t('dashboard.quick_actions.toast.failed_title'), error.message);
    } finally {
      setLoading(null);
    }
  };

  return (
    <Card variant="glass">
      <CardHeader>
        <CardTitle>{t('dashboard.quick_actions.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <Button
            variant="secondary"
            className="w-full justify-start"
            icon={loading === 'start-all' ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}
            onClick={() => handleAction('start-all')}
            disabled={loading !== null || stoppedCount === 0}
          >
            {t('dashboard.quick_actions.start_all')}
            {stoppedCount > 0 && (
              <span className="ml-auto text-text-light-muted dark:text-text-muted text-sm">
                {t('dashboard.quick_actions.stopped_count', { count: stoppedCount })}
              </span>
            )}
          </Button>

          <Button
            variant="secondary"
            className="w-full justify-start"
            icon={loading === 'stop-all' ? <RefreshCw size={16} className="animate-spin" /> : <Square size={16} />}
            onClick={() => handleAction('stop-all')}
            disabled={loading !== null || runningCount === 0}
          >
            {t('dashboard.quick_actions.stop_all')}
            {runningCount > 0 && (
              <span className="ml-auto text-text-light-muted dark:text-text-muted text-sm">
                {t('dashboard.quick_actions.running_count', { count: runningCount })}
              </span>
            )}
          </Button>

          <Button
            variant="secondary"
            className="w-full justify-start"
            icon={loading === 'restart-all' ? <RefreshCw size={16} className="animate-spin" /> : <RotateCcw size={16} />}
            onClick={() => handleAction('restart-all')}
            disabled={loading !== null || runningCount === 0}
          >
            {t('dashboard.quick_actions.restart_all')}
          </Button>

          <div className="pt-2 border-t border-gray-200 dark:border-gray-800">
            <Button
              variant="ghost"
              className="w-full justify-start"
              icon={<HardDrive size={16} />}
              onClick={onRefresh}
              disabled={loading !== null}
            >
              {t('dashboard.quick_actions.refresh')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
