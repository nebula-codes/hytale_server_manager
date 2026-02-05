import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardContent, Badge, Button } from '../../../components/ui';
import { AlertCircle, AlertTriangle, Info, Bell, ArrowRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useTranslation } from 'react-i18next';

interface AlertCounts {
  critical: number;
  warning: number;
  info: number;
  total: number;
}

interface RecentAlert {
  id: string;
  serverId: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  createdAt: string;
}

interface AlertsSummaryWidgetProps {
  counts: AlertCounts;
  unreadCount: number;
  recentAlerts: RecentAlert[];
  loading?: boolean;
}

const getSeverityIcon = (severity: string) => {
  switch (severity) {
    case 'critical':
      return <AlertCircle size={14} className="text-red-500" />;
    case 'warning':
      return <AlertTriangle size={14} className="text-yellow-500" />;
    default:
      return <Info size={14} className="text-blue-500" />;
  }
};

export const AlertsSummaryWidget = ({
  counts,
  unreadCount,
  recentAlerts,
  loading,
}: AlertsSummaryWidgetProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  if (loading) {
    return (
      <Card variant="glass">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell size={18} />
            {t('dashboard.alerts.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4 text-text-light-muted dark:text-text-muted">
            {t('dashboard.alerts.loading')}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="glass">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Bell size={18} />
            {t('dashboard.alerts.title')}
            {unreadCount > 0 && (
              <Badge variant="danger" size="sm">
                {t('dashboard.alerts.new_badge', { count: unreadCount })}
              </Badge>
            )}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => navigate('/alerts')}>
            {t('common.view_all')}
            <ArrowRight size={14} className="ml-1" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Counts */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="text-center p-2 bg-red-500/10 rounded-lg">
            <p className="text-2xl font-bold text-red-500">{counts.critical}</p>
            <p className="text-xs text-text-light-muted dark:text-text-muted">{t('alerts.stats.critical')}</p>
          </div>
          <div className="text-center p-2 bg-yellow-500/10 rounded-lg">
            <p className="text-2xl font-bold text-yellow-500">{counts.warning}</p>
            <p className="text-xs text-text-light-muted dark:text-text-muted">{t('alerts.stats.warning')}</p>
          </div>
          <div className="text-center p-2 bg-blue-500/10 rounded-lg">
            <p className="text-2xl font-bold text-blue-500">{counts.info}</p>
            <p className="text-xs text-text-light-muted dark:text-text-muted">{t('alerts.stats.info')}</p>
          </div>
        </div>

        {/* Recent Alerts */}
        {recentAlerts.length === 0 ? (
          <div className="text-center py-4 text-text-light-muted dark:text-text-muted text-sm">
            {t('dashboard.alerts.no_unresolved')}
          </div>
        ) : (
          <div className="space-y-2">
            {recentAlerts.slice(0, 3).map((alert) => (
              <div
                key={alert.id}
                className="flex items-start gap-2 p-2 bg-white dark:bg-primary-bg-secondary rounded border border-gray-200 dark:border-gray-800 cursor-pointer hover:border-accent-primary/50 transition-colors"
                onClick={() => navigate('/alerts')}
              >
                {getSeverityIcon(alert.severity)}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-light-primary dark:text-text-primary truncate">
                    {alert.title}
                  </p>
                  <p className="text-xs text-text-light-muted dark:text-text-muted">
                    {formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
