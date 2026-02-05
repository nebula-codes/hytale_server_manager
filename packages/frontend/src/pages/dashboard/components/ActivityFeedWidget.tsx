import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardContent, Badge, Button } from '../../../components/ui';
import { Activity, ArrowRight, Server, User, Shield, Settings, Play, Square, Download, HardDrive } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useTranslation } from 'react-i18next';
import api from '../../../services/api';

interface ActivityItem {
  id: string;
  userId: string;
  username: string;
  action: string;
  actionCategory: string;
  resourceType: string;
  resourceName?: string;
  status: string;
  timestamp: string;
}

const getActionIcon = (category: string, action: string) => {
  if (action.includes('start')) return <Play size={14} className="text-green-500" />;
  if (action.includes('stop')) return <Square size={14} className="text-red-500" />;
  if (action.includes('backup')) return <Download size={14} className="text-blue-500" />;

  switch (category) {
    case 'server':
      return <Server size={14} className="text-accent-primary" />;
    case 'user':
      return <User size={14} className="text-purple-500" />;
    case 'auth':
      return <Shield size={14} className="text-green-500" />;
    case 'settings':
      return <Settings size={14} className="text-gray-500" />;
    case 'backup':
      return <HardDrive size={14} className="text-blue-500" />;
    default:
      return <Activity size={14} className="text-text-light-muted dark:text-text-muted" />;
  }
};

const formatAction = (action: string): string => {
  return action
    .replace(/_/g, ' ')
    .replace(/:/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase());
};

export const ActivityFeedWidget = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRecentActivity();
  }, []);

  const fetchRecentActivity = async () => {
    try {
      setLoading(true);
      const data = await api.getRecentActivity<ActivityItem>(5);
      setActivities(data);
    } catch (error) {
      console.error('Error fetching activity:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card variant="glass">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Activity size={18} />
            {t('dashboard.activity.title')}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => navigate('/activity')}>
            {t('common.view_all')}
            <ArrowRight size={14} className="ml-1" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-4 text-text-light-muted dark:text-text-muted">
            {t('dashboard.activity.loading')}
          </div>
        ) : activities.length === 0 ? (
          <div className="text-center py-4 text-text-light-muted dark:text-text-muted text-sm">
            {t('dashboard.activity.empty')}
          </div>
        ) : (
          <div className="space-y-3">
            {activities.map((activity) => (
              <div
                key={activity.id}
                className="flex items-start gap-2 p-2 bg-white dark:bg-primary-bg-secondary rounded border border-gray-200 dark:border-gray-800"
              >
                <div className="mt-0.5">{getActionIcon(activity.actionCategory, activity.action)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-light-primary dark:text-text-primary">
                    <span className="font-medium">{activity.username}</span>{' '}
                    <span className="text-text-light-muted dark:text-text-muted">
                      {formatAction(activity.action).toLowerCase()}
                    </span>
                    {activity.resourceName && (
                      <>
                        {' '}
                        <span className="font-medium">{activity.resourceName}</span>
                      </>
                    )}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-text-light-muted dark:text-text-muted">
                      {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                    </span>
                    {activity.status === 'failed' && (
                      <Badge variant="danger" size="sm">
                        {t('dashboard.activity.failed')}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
