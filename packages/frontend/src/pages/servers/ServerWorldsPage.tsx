import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button } from '../../components/ui';
import { Globe, Trash2, RefreshCw, ArrowLeft, Settings } from 'lucide-react';
import { api } from '../../services/api';
import { useToast } from '../../stores/toastStore';
import { HytaleWorldConfigModal } from '../../components/modals/HytaleWorldConfigModal';

interface Server {
  id: string;
  name: string;
  status: string;
}

interface World {
  id: string;
  serverId: string;
  name: string;
  folderPath: string;
  sizeBytes: number;
  isActive: boolean;
  description?: string;
  createdAt: Date;
  lastPlayed?: Date;
}

export const ServerWorldsPage = () => {
  const { id: serverId } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const toast = useToast();

  const [server, setServer] = useState<Server | null>(null);
  const [worlds, setWorlds] = useState<World[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configModalWorld, setConfigModalWorld] = useState<World | null>(null);

  useEffect(() => {
    if (serverId) {
      loadServer();
      loadWorlds();
    }
  }, [serverId]);

  const loadServer = async () => {
    if (!serverId) return;
    try {
      const data = await api.getServer<Server>(serverId);
      setServer(data);
    } catch (err: any) {
      console.error('Failed to load server:', err);
    }
  };

  const loadWorlds = async () => {
    if (!serverId) return;

    setLoading(true);
    setError(null);
    try {
      const data = await api.listWorlds<World>(serverId);
      setWorlds(data);
    } catch (err: any) {
      setError(err.message || t('servers.worlds.toast.load_failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteWorld = async (worldId: string, worldName: string) => {
    if (!serverId) return;

    if (!confirm(t('servers.worlds.confirm_delete', { name: worldName }))) {
      return;
    }

    try {
      await api.deleteWorld(serverId, worldId);
      toast.success(t('servers.worlds.toast.deleted.title'), t('servers.worlds.toast.deleted.description', { name: worldName }));
      loadWorlds();
    } catch (err: any) {
      toast.error(t('servers.worlds.toast.delete_failed.title'), err.message || t('common.error'));
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) {
      return bytes + ' B';
    }
    const kb = bytes / 1024;
    if (kb < 1024) {
      return kb.toFixed(1) + ' KB';
    }
    const mb = kb / 1024;
    if (mb < 1024) {
      return mb.toFixed(2) + ' MB';
    }
    return (mb / 1024).toFixed(2) + ' GB';
  };

  const formatDate = (date: Date | string | undefined): string => {
    if (!date) return 'Never';
    return new Date(date).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 sm:gap-4">
          <Link to={`/servers/${serverId}`}>
            <Button variant="ghost" icon={<ArrowLeft size={18} />}>
              <span className="hidden sm:inline">{t('common.back')}</span>
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl sm:text-3xl font-heading font-bold text-text-light-primary dark:text-text-primary">
              {t('servers.worlds.title')}
            </h1>
            {server && (
              <p className="text-sm sm:text-base text-text-light-muted dark:text-text-muted mt-1">
                {server.name}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            icon={<RefreshCw size={16} className={loading ? 'animate-spin' : ''} />}
            onClick={loadWorlds}
            disabled={loading}
          >
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      {/* Worlds List */}
      <Card variant="glass">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe size={20} />
            Universe Worlds
          </CardTitle>
          <CardDescription>
            {t('servers.worlds.subtitle')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="bg-red-500/10 text-red-500 p-3 rounded-lg mb-4">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-accent-primary border-t-transparent" />
            </div>
          ) : worlds.length === 0 ? (
            <div className="text-center py-12">
              <Globe size={48} className="mx-auto text-text-light-muted dark:text-text-muted mb-3 opacity-50" />
              <p className="text-text-light-muted dark:text-text-muted mb-2">{t('servers.worlds.empty.title')}</p>
              <p className="text-sm text-text-light-muted dark:text-text-muted opacity-75">
                {t('servers.worlds.empty.subtitle')}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {worlds.map(world => (
                <div
                  key={world.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-white/50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-accent-primary/50 transition-colors gap-4"
                >
                  <div className="flex items-start sm:items-center gap-4 flex-1">
                    <Globe
                      size={24}
                      className="flex-shrink-0 mt-1 sm:mt-0 text-text-light-muted dark:text-text-muted"
                    />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-text-light-primary dark:text-text-primary">
                        {world.name}
                      </h3>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-light-muted dark:text-text-muted mt-1">
                        <span>{t('servers.worlds.size', { size: formatSize(world.sizeBytes) })}</span>
                        {world.lastPlayed && (
                          <span>{t('servers.worlds.last_played', { date: formatDate(world.lastPlayed) })}</span>
                        )}
                      </div>
                      {world.description && (
                        <p className="text-sm text-text-light-muted dark:text-text-muted mt-2 line-clamp-2">
                          {world.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 sm:flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Settings size={16} />}
                      title={t('servers.worlds.actions.settings')}
                      onClick={() => setConfigModalWorld(world)}
                    >
                      <span className="hidden sm:inline">{t('servers.worlds.actions.config')}</span>
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      icon={<Trash2 size={16} />}
                      onClick={() => handleDeleteWorld(world.id, world.name)}
                      title={t('servers.worlds.actions.delete')}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card variant="glass">
        <CardHeader>
          <CardTitle>{t('servers.worlds.info.title')}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-text-light-muted dark:text-text-muted space-y-2">
          <p>
            {t('servers.worlds.info.body1')}
          </p>
          <p>
            {t('servers.worlds.info.body2')}
          </p>
        </CardContent>
      </Card>

      {/* World Config Modal */}
      {configModalWorld && (
        <HytaleWorldConfigModal
          world={configModalWorld}
          serverStatus={server?.status || 'stopped'}
          isOpen={!!configModalWorld}
          onClose={() => setConfigModalWorld(null)}
          onSaved={loadWorlds}
        />
      )}
    </div>
  );
};
