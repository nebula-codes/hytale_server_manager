import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardContent, Badge, StatusIndicator } from '../../../components/ui';
import { Cpu, MemoryStick, Users } from 'lucide-react';
import type { ServerStatus } from '../../../types';

interface ServerHealth {
  id: string;
  name: string;
  status: ServerStatus;
  healthStatus: 'healthy' | 'warning' | 'critical' | 'offline';
  playerCount: number;
  maxPlayers: number;
  cpuUsage: number;
  memoryUsage: number;
  memoryUsedMB: number;
}

interface ServerHealthCardsProps {
  servers: ServerHealth[];
  loading?: boolean;
}

const healthBadgeVariant = (health: string): 'success' | 'warning' | 'danger' | 'default' => {
  switch (health) {
    case 'healthy':
      return 'success';
    case 'warning':
      return 'warning';
    case 'critical':
      return 'danger';
    default:
      return 'default';
  }
};

export const ServerHealthCards = ({ servers, loading }: ServerHealthCardsProps) => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  if (loading) {
    return (
      <Card variant="glass">
        <CardHeader>
          <CardTitle>{t('dashboard.health.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-text-light-muted dark:text-text-muted">
            {t('dashboard.health.loading')}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (servers.length === 0) {
    return (
      <Card variant="glass">
        <CardHeader>
          <CardTitle>{t('dashboard.health.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-text-light-muted dark:text-text-muted">
            {t('dashboard.health.empty')}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="glass">
      <CardHeader>
        <CardTitle>{t('dashboard.health.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {servers.map((server) => (
            <div
              key={server.id}
              className="p-3 bg-white dark:bg-primary-bg-secondary rounded-lg border border-gray-200 dark:border-gray-800 hover:border-accent-primary/50 transition-colors cursor-pointer"
              onClick={() => navigate(`/servers/${server.id}`)}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <StatusIndicator status={server.status} size="sm" />
                  <span className="font-medium text-text-light-primary dark:text-text-primary">
                    {server.name}
                  </span>
                </div>
                <Badge variant={healthBadgeVariant(server.healthStatus)} size="sm">
                  {t(`dashboard.health.status.${server.healthStatus}`, server.healthStatus)}
                </Badge>
              </div>

              {server.status === 'running' && (
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div className="flex items-center gap-1 text-text-light-muted dark:text-text-muted">
                    <Cpu size={14} />
                    <span
                      className={
                        server.cpuUsage >= 90
                          ? 'text-red-500'
                          : server.cpuUsage >= 70
                          ? 'text-yellow-500'
                          : ''
                      }
                    >
                      {server.cpuUsage.toFixed(0)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-text-light-muted dark:text-text-muted">
                    <MemoryStick size={14} />
                    <span
                      className={
                        server.memoryUsage >= 90
                          ? 'text-red-500'
                          : server.memoryUsage >= 80
                          ? 'text-yellow-500'
                          : ''
                      }
                    >
                      {server.memoryUsage.toFixed(0)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-text-light-muted dark:text-text-muted">
                    <Users size={14} />
                    <span>
                      {server.playerCount}/{server.maxPlayers}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
