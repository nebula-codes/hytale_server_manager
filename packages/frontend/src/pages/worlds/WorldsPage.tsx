import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Badge } from '../../components/ui';
import { Globe, Trash2, Check, RefreshCw } from 'lucide-react';
import { api } from '../../services/api';

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

export const WorldsPage = () => {
  const { t } = useTranslation();
  const [servers, setServers] = useState<Server[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [worlds, setWorlds] = useState<World[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadServers();
  }, []);

  useEffect(() => {
    if (selectedServerId) {
      loadWorlds();
    }
  }, [selectedServerId]);

  const loadServers = async () => {
    try {
      const data = await api.getServers<Server>();
      setServers(data);
      if (data.length > 0 && !selectedServerId) {
        setSelectedServerId(data[0].id);
      }
    } catch (err: any) {
      setError(err.message || t('worlds.errors.servers'));
    }
  };

  const loadWorlds = async () => {
    if (!selectedServerId) return;

    setLoading(true);
    setError(null);
    try {
      const data = await api.listWorlds<World>(selectedServerId);
      setWorlds(data);
    } catch (err: any) {
      setError(err.message || t('worlds.errors.worlds'));
    } finally {
      setLoading(false);
    }
  };

  const handleActivateWorld = async (worldId: string) => {
    if (!selectedServerId) return;

    try {
      await api.activateWorld(selectedServerId, worldId);
      loadWorlds();
    } catch (err: any) {
      setError(err.message || t('worlds.errors.activate'));
    }
  };

  const handleDeleteWorld = async (worldId: string, worldName: string) => {
    if (!selectedServerId) return;

    if (!confirm(t('worlds.confirm_delete', { name: worldName }))) {
      return;
    }

    try {
      await api.deleteWorld(selectedServerId, worldId);
      loadWorlds();
    } catch (err: any) {
      setError(err.message || t('worlds.errors.delete'));
    }
  };

  const formatSize = (bytes: number): string => {
    const mb = bytes / 1024 / 1024;
    if (mb >= 1024) {
      return (mb / 1024).toFixed(2) + ' GB';
    }
    return mb.toFixed(2) + ' MB';
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-text-primary">{t('worlds.title')}</h1>
        <p className="text-text-secondary mt-1">{t('worlds.subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('worlds.select_server')}</CardTitle>
          <CardDescription>{t('worlds.select_server_description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 flex-wrap">
            {servers.map(server => (
              <Button
                key={server.id}
                variant={selectedServerId === server.id ? 'primary' : 'secondary'}
                onClick={() => setSelectedServerId(server.id)}
              >
                {server.name}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {selectedServerId && (
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle>{t('worlds.list.title')}</CardTitle>
                <CardDescription>{t('worlds.list.subtitle')}</CardDescription>
              </div>
              <Button onClick={loadWorlds} disabled={loading}>
                <RefreshCw className={loading ? 'animate-spin' : ''} size={16} />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {error && <div className="bg-red-500/10 text-red-500 p-3 rounded mb-4">{error}</div>}

            {loading ? (
              <div className="text-center py-8 text-text-secondary">{t('worlds.list.loading')}</div>
            ) : worlds.length === 0 ? (
              <div className="text-center py-8 text-text-secondary">
                <Globe size={48} className="mx-auto mb-2 opacity-50" />
                <p>{t('worlds.list.empty')}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {worlds.map(world => (
                  <div key={world.id} className="flex items-center justify-between p-4 bg-bg-secondary rounded-lg border border-border-subtle">
                    <div className="flex items-center gap-4 flex-1">
                      <Globe size={24} className={world.isActive ? 'text-accent-primary' : 'text-text-secondary'} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-text-primary">{world.name}</h3>
                          {world.isActive && (
                            <Badge variant="success" size="sm">
                              <Check size={12} className="mr-1" />
                              {t('worlds.status.active')}
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-text-secondary mt-1">
                          <span>{t('worlds.size', { size: formatSize(world.sizeBytes) })}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      {!world.isActive && (
                        <Button variant="secondary" onClick={() => handleActivateWorld(world.id)}>
                          {t('worlds.actions.activate')}
                        </Button>
                      )}
                      <Button variant="secondary" onClick={() => handleDeleteWorld(world.id, world.name)}>
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};
