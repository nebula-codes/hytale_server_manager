import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Badge } from '../../components/ui';
import { Wifi, WifiOff, Settings, Activity } from 'lucide-react';
import { mockBridgeStatus, mockServerEvents } from '../../data/mockData';

export const BridgePage = () => {
  const bridge = mockBridgeStatus;
  const { t } = useTranslation();

  const getConnectionLabel = () =>
    bridge.connected ? t('bridge.connection.connected') : t('bridge.connection.disconnected');

  const getLatencyLabel = () => t('bridge.latency');

  const getFeatureBadge = (enabled: boolean) =>
    enabled ? t('bridge.feature_status.enabled') : t('bridge.feature_status.disabled');

  const getEventBadgeLabel = (type: string) => {
    switch (type) {
      case 'player_join':
        return t('bridge.events.player_join_badge');
      case 'player_leave':
        return t('bridge.events.player_leave_badge');
      case 'alert':
        return t('bridge.events.alert_badge');
      default:
        return t('bridge.events.info_badge');
    }
  };

  const getEventMessage = (event: typeof mockServerEvents[number]) => {
    switch (event.type) {
      case 'player_join':
        return t('bridge.events.player_join', { username: event.data.username });
      case 'player_leave':
        return t('bridge.events.player_leave', { username: event.data.username });
      case 'chat':
        return t('bridge.events.chat', { username: event.data.username, message: event.data.message });
      case 'achievement':
        return t('bridge.events.achievement', { username: event.data.username, achievement: event.data.achievement });
      case 'alert':
        return event.data.message;
      default:
        return event.type;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-heading font-bold text-text-light-primary dark:text-text-primary">{t('bridge.title')}</h1>
        <p className="text-text-light-muted dark:text-text-muted mt-1">{t('bridge.subtitle')}</p>
      </div>

      {/* Connection Status */}
      <Card variant="glass">
        <CardHeader>
          <CardTitle>{t('bridge.connection.title')}</CardTitle>
          <CardDescription>{t('bridge.connection.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`w-16 h-16 rounded-lg flex items-center justify-center ${
                bridge.connected ? 'bg-success/20' : 'bg-danger/20'
              }`}>
                {bridge.connected ? (
                  <Wifi size={32} className="text-success" />
                ) : (
                  <WifiOff size={32} className="text-danger" />
                )}
              </div>
              <div>
                <p className="text-2xl font-heading font-bold text-text-light-primary dark:text-text-primary">
                {getConnectionLabel()}
                </p>
                <p className="text-text-light-muted dark:text-text-muted">{t('bridge.plugin_version', { version: bridge.pluginVersion })}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-text-light-muted dark:text-text-muted">{getLatencyLabel()}</p>
              <p className="text-2xl font-heading font-bold text-accent-primary">{bridge.latency}ms</p>
              <p className="text-xs text-text-light-muted dark:text-text-muted">
                Last heartbeat: {new Date(bridge.lastHeartbeat).toLocaleTimeString()}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Features */}
      <Card variant="glass">
          <CardHeader>
          <CardTitle>{t('bridge.features.title')}</CardTitle>
          <CardDescription>{t('bridge.features.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {bridge.features.map((feature) => (
              <div
                key={feature.id}
                className="p-4 rounded-lg border border-gray-300 dark:border-gray-800 hover:border-gray-300 dark:border-gray-700 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h4 className="font-heading font-semibold text-text-light-primary dark:text-text-primary">{feature.name}</h4>
                    <p className="text-sm text-text-light-muted dark:text-text-muted mt-1">{feature.description}</p>
                  </div>
                  <Badge variant={feature.enabled ? 'success' : 'default'} size="sm">
                    {getFeatureBadge(feature.enabled)}
                  </Badge>
                </div>
                {feature.configurable && (
                  <Button variant="ghost" size="sm" icon={<Settings size={14} />} className="mt-2">
                    {t('bridge.features.configure')}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Real-time Events */}
      <Card variant="glass">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t('bridge.events.title')}</CardTitle>
              <CardDescription>{t('bridge.events.description')}</CardDescription>
            </div>
            <Activity size={20} className="text-accent-primary animate-pulse" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {mockServerEvents.map((event) => (
              <div
                key={event.id}
                className="p-3 rounded-lg bg-white dark:bg-primary-bg border border-gray-300 dark:border-gray-800/50"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Badge
                      variant={
                        event.type === 'player_join' ? 'success' :
                        event.type === 'player_leave' ? 'warning' :
                        event.type === 'alert' ? 'danger' : 'info'
                      }
                      size="sm"
                    >
                      {getEventBadgeLabel(event.type)}
                    </Badge>
                    <div>
                      <p className="text-sm text-text-light-primary dark:text-text-primary">
                        {getEventMessage(event as typeof mockServerEvents[number])}
                      </p>
                      {event.data.server && (
                        <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">{event.data.server}</p>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-text-light-muted dark:text-text-muted">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
