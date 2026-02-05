import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Badge, StatusIndicator } from '../../components/ui';
import { ArrowLeft, Play, Square, RotateCw, Settings, Users, Activity, Terminal, Database, Package, Trash2, ExternalLink, Plus, RefreshCw, Globe, ArrowUp, History } from 'lucide-react';
import { useToast } from '../../stores/toastStore';
import api from '../../services/api';
import websocket from '../../services/websocket';
import { motion, AnimatePresence } from 'framer-motion';
import { ServerUpdateBadge, ServerUpdateModal, UpdateHistoryModal } from '../../components/update';

interface Server {
  id: string;
  name: string;
  address: string;
  port: number;
  version: string;
  maxPlayers: number;
  gameMode: string;
  status: 'stopped' | 'starting' | 'running' | 'stopping';
  adapterType: string;
  createdAt: string;
  preUpdateBackupId?: string | null;
}

interface ServerMetrics {
  cpuUsage: number;
  memoryUsage: number;
  memoryTotal: number;
  diskUsage: number;
  tps: number;
  uptime: number;
  timestamp: string;
}

interface ServerStatus {
  serverId: string;
  status: string;
  playerCount: number;
  maxPlayers: number;
  version: string;
  uptime: number;
}

interface ModFile {
  id: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  fileType: string;
}

interface InstalledMod {
  id: string;
  serverId: string;
  projectId: string;
  projectTitle: string;
  projectIconUrl?: string;
  versionId: string;
  versionName: string;
  classification: string;
  archiveSize: number;
  files: ModFile[];
  enabled: boolean;
  installedAt: string;
  providerId: string;
}

const getModDisplaySize = (mod: InstalledMod): number => {
  // If files exist (extracted from archive), sum their sizes
  if (mod.files && mod.files.length > 0) {
    return mod.files.reduce((sum, file) => sum + file.fileSize, 0);
  }
  // Fall back to archive size
  return mod.archiveSize || 0;
};

export const ServerDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useTranslation();

  const [server, setServer] = useState<Server | null>(null);
  const [_status, setStatus] = useState<ServerStatus | null>(null);
  const [metrics, setMetrics] = useState<ServerMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installedMods, setInstalledMods] = useState<InstalledMod[]>([]);
  const [modsLoading, setModsLoading] = useState(false);
  const [uninstallingMod, setUninstallingMod] = useState<string | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // Fetch server data on mount
  useEffect(() => {
    if (!id) return;
    fetchServer();
  }, [id]);

  // Subscribe to real-time updates
  useEffect(() => {
    if (!id || !server) return;

    const unsubscribe = websocket.subscribeToServer(id, {
      onStatus: (data) => {
        setStatus(data.status);
        setServer(prev => prev ? { ...prev, status: data.status.status } : null);
      },
      onMetrics: (data) => {
        setMetrics(data.metrics);
      },
    });

    return () => {
      unsubscribe();
    };
  }, [id, server?.id]);

  const fetchServer = async () => {
    if (!id) return;

    try {
      setLoading(true);
      setError(null);

      const [serverData, statusData, metricsData] = await Promise.all([
        api.getServer<Server>(id),
        api.getServerStatus(id),
        api.getServerMetrics(id),
      ]);

      setServer(serverData);
      setStatus({
        serverId: id,
        status: statusData.status,
        playerCount: statusData.playerCount,
        maxPlayers: statusData.maxPlayers,
        version: serverData.version,
        uptime: statusData.uptime,
      });
      setMetrics({
        cpuUsage: metricsData.cpuUsage,
        memoryUsage: metricsData.memoryUsage,
        memoryTotal: metricsData.memoryTotal,
        diskUsage: metricsData.diskUsage,
        tps: metricsData.tps,
        uptime: metricsData.uptime,
        timestamp: metricsData.timestamp?.toString() ?? new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('Error fetching server:', err);
      setError(err.message || 'Failed to load server');
      toast.error(t('servers.toast.load_failed.title'), err.message);
    } finally {
      setLoading(false);
    }

    // Also fetch installed mods
    fetchMods();
  };

  const fetchMods = async () => {
    if (!id) return;

    setModsLoading(true);
    try {
      const mods = await api.getServerMods<InstalledMod>(id);
      setInstalledMods(mods);
    } catch (err) {
      console.error('Error fetching mods:', err);
      // Don't show error toast for mods - just log it
    } finally {
      setModsLoading(false);
    }
  };

  const handleUninstallMod = async (modId: string, modName: string) => {
    if (!id) return;

    setUninstallingMod(modId);
    try {
      await api.uninstallMod(id, modId);
      setInstalledMods(prev => prev.filter(m => m.id !== modId));
      toast.success(t('servers.toast.mod_uninstalled.title'), t('servers.toast.mod_uninstalled.description', { mod: modName }));
    } catch (err: any) {
      toast.error(t('servers.toast.mod_uninstalled_failed.title'), err.message);
    } finally {
      setUninstallingMod(null);
    }
  };

  const handleStart = async () => {
    if (!id) return;

    try {
      await api.startServer(id);
      toast.success(t('servers.toast.starting.title'), t('servers.toast.starting.description', { name: server?.name }));
      setServer(prev => prev ? { ...prev, status: 'starting' } : null);
    } catch (err: any) {
      toast.error(t('servers.toast.start_failed.title'), err.message);
    }
  };

  const handleStop = async () => {
    if (!id) return;

    try {
      await api.stopServer(id);
      toast.warning(t('servers.toast.stopping.title'), t('servers.toast.stopping.description', { name: server?.name }));
      setServer(prev => prev ? { ...prev, status: 'stopping' } : null);
    } catch (err: any) {
      toast.error(t('servers.toast.stop_failed.title'), err.message);
    }
  };

  const handleRestart = async () => {
    if (!id) return;

    try {
      await api.restartServer(id);
      toast.info(t('servers.toast.restarting.title'), t('servers.toast.restarting.description', { name: server?.name }));
    } catch (err: any) {
      toast.error(t('servers.toast.restart_failed.title'), err.message);
    }
  };

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <h2 className="text-2xl font-heading font-bold text-text-light-primary dark:text-text-primary">
            {t('common.loading')}
          </h2>
        </div>
      </div>
    );
  }

  if (error || !server) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <h2 className="text-2xl font-heading font-bold text-text-light-primary dark:text-text-primary">
            {error || t('servers.detail.errors.not_found')}
          </h2>
          <Link to="/servers" className="text-accent-primary hover:underline mt-4 inline-block">
            ← {t('servers.detail.back_to_servers')}
          </Link>
        </div>
      </div>
    );
  }

  const currentUptime = metrics?.uptime || 0;
  const currentTps = metrics?.tps || 0;
  const currentCpu = metrics?.cpuUsage || 0;
  const currentMemory = metrics?.memoryUsage || 0;
  const totalMemory = metrics?.memoryTotal || 8192;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 sm:gap-4">
          <Link to="/servers">
            <Button variant="ghost" icon={<ArrowLeft size={18} />}>
              <span className="hidden sm:inline">{t('common.back')}</span>
            </Button>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl sm:text-3xl font-heading font-bold text-text-light-primary dark:text-text-primary truncate">
              {server.name}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-sm sm:text-base text-text-light-muted dark:text-text-muted">
                {server.address}:{server.port}
              </p>
              <StatusIndicator status={server.status} showLabel size="sm" />
            </div>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          {server.status === 'running' ? (
            <div className="flex gap-2">
              <Button variant="danger" icon={<Square size={18} />} className="flex-1 sm:flex-initial" onClick={handleStop}>
                {t('servers.detail.actions.stop')}
              </Button>
              <Button variant="secondary" icon={<RotateCw size={18} />} className="flex-1 sm:flex-initial" onClick={handleRestart}>
                {t('servers.detail.actions.restart')}
              </Button>
            </div>
          ) : server.status === 'stopped' ? (
            <Button variant="success" icon={<Play size={18} />} className="w-full sm:w-auto" onClick={handleStart}>
              {t('servers.detail.actions.start')}
            </Button>
          ) : (
            <Button variant="ghost" className="w-full sm:w-auto" disabled>
              {t(`servers.status.${server.status}`, { defaultValue: server.status })}...
            </Button>
          )}
          <Button variant="ghost" icon={<Globe size={18} />} className="w-full sm:w-auto" onClick={() => navigate(`/servers/${id}/worlds`)}>
            {t('servers.detail.actions.worlds')}
          </Button>
          <Button variant="ghost" icon={<Settings size={18} />} className="w-full sm:w-auto" onClick={() => navigate(`/servers/${id}/settings`)}>
            {t('servers.detail.actions.settings')}
          </Button>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Card variant="glass" className="opacity-50">
          <CardContent className="flex items-center justify-between">
            <div>
              <p className="text-text-light-muted dark:text-text-muted text-sm">{t('servers.detail.stats.players')}</p>
              <p className="text-2xl font-heading font-bold text-text-light-primary dark:text-text-primary">
                - / -
              </p>
              <p className="text-xs text-text-light-muted dark:text-text-muted">{t('common.coming_soon')}</p>
            </div>
            <Users size={32} className="text-text-muted" />
          </CardContent>
        </Card>

        <Card variant="glass">
          <CardContent className="flex items-center justify-between">
            <div>
              <p className="text-text-light-muted dark:text-text-muted text-sm">{t('servers.detail.stats.tps')}</p>
              <p className="text-2xl font-heading font-bold text-text-light-primary dark:text-text-primary">
                {server.status === 'running' ? currentTps.toFixed(1) : '-'}
              </p>
            </div>
            <Activity size={32} className={currentTps >= 19.5 ? 'text-success' : currentTps >= 18 ? 'text-warning' : 'text-danger'} />
          </CardContent>
        </Card>

        <Card variant="glass">
          <CardContent className="flex items-center justify-between">
            <div>
              <p className="text-text-light-muted dark:text-text-muted text-sm">{t('servers.detail.stats.memory')}</p>
              <p className="text-2xl font-heading font-bold text-text-light-primary dark:text-text-primary">
                {server.status === 'running' ? `${Math.round(currentMemory)} MB` : '-'}
              </p>
            </div>
            <Terminal size={32} className="text-accent-secondary" />
          </CardContent>
        </Card>

        <Card variant="glass">
          <CardContent className="flex items-center justify-between">
            <div>
              <p className="text-text-light-muted dark:text-text-muted text-sm">{t('servers.detail.stats.uptime')}</p>
              <p className="text-2xl font-heading font-bold text-text-light-primary dark:text-text-primary">
                {server.status === 'running' ? formatUptime(currentUptime) : t('servers.detail.stats.offline')}
              </p>
            </div>
            <Database size={32} className="text-success" />
          </CardContent>
        </Card>
      </div>

      {/* Server Info */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        <Card variant="glass">
          <CardHeader>
            <CardTitle>{t('servers.detail.info.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-text-light-muted dark:text-text-muted">{t('servers.detail.info.version')}</span>
              <div className="flex items-center gap-2">
                <Badge variant="info">{server.version}</Badge>
                <ServerUpdateBadge
                  serverId={server.id}
                  currentVersion={server.version}
                  compact
                  onUpdateClick={() => setShowUpdateModal(true)}
                />
              </div>
            </div>
            <div className="flex justify-between">
              <span className="text-text-light-muted dark:text-text-muted">{t('servers.detail.info.game_mode')}</span>
              <Badge variant="default">{server.gameMode}</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-text-light-muted dark:text-text-muted">{t('servers.detail.info.adapter_type')}</span>
              <Badge variant="default">
                {server.adapterType === 'java' ? t('servers.detail.info.adapter_java') : server.adapterType}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-text-light-muted dark:text-text-muted">{t('servers.detail.info.created')}</span>
              <span className="text-text-light-primary dark:text-text-primary">
                {new Date(server.createdAt).toLocaleString()}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card variant="glass">
          <CardHeader>
            <CardTitle>{t('servers.detail.resources.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-text-light-muted dark:text-text-muted text-sm">{t('servers.detail.resources.cpu')}</span>
                <span className="text-text-light-primary dark:text-text-primary font-medium">
                  {server.status === 'running' ? `${currentCpu.toFixed(1)}%` : '-'}
                </span>
              </div>
              {server.status === 'running' && (
                <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${
                      currentCpu > 70 ? 'bg-danger' : currentCpu > 50 ? 'bg-warning' : 'bg-success'
                    }`}
                    style={{ width: `${currentCpu}%` }}
                  />
                </div>
              )}
            </div>

            <div>
              <div className="flex justify-between mb-2">
                <span className="text-text-light-muted dark:text-text-muted text-sm">{t('servers.detail.resources.memory')}</span>
                <span className="text-text-light-primary dark:text-text-primary font-medium">
                  {server.status === 'running' ? `${Math.round(currentMemory)} / ${Math.round(totalMemory)} MB` : '-'}
                </span>
              </div>
              {server.status === 'running' && (
                <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent-secondary"
                    style={{ width: `${(currentMemory / totalMemory) * 100}%` }}
                  />
                </div>
              )}
            </div>

            <div className="opacity-50">
              <div className="flex justify-between mb-2">
                <span className="text-text-light-muted dark:text-text-muted text-sm">{t('servers.detail.resources.slots')}</span>
                <span className="text-text-light-primary dark:text-text-primary font-medium">
                  - / - <span className="text-xs">({t('common.coming_soon')})</span>
                </span>
              </div>
              <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent-primary"
                  style={{ width: '0%' }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Installed Mods Section */}
      <Card variant="glass">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Package size={20} />
                {t('servers.detail.mods.title')}
                {installedMods.length > 0 && (
                  <Badge variant="info" size="sm">{installedMods.length}</Badge>
                )}
              </CardTitle>
              <CardDescription>{t('servers.detail.mods.subtitle')}</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                icon={<RefreshCw size={16} className={modsLoading ? 'animate-spin' : ''} />}
                onClick={fetchMods}
                disabled={modsLoading}
              >
                {t('common.refresh')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={<Plus size={16} />}
                onClick={() => navigate('/mods')}
              >
                {t('servers.detail.mods.browse')}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {modsLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-accent-primary border-t-transparent" />
            </div>
          ) : installedMods.length === 0 ? (
            <div className="text-center py-8">
              <Package size={48} className="mx-auto text-text-light-muted dark:text-text-muted mb-3 opacity-50" />
              <p className="text-text-light-muted dark:text-text-muted mb-4">{t('servers.detail.mods.empty')}</p>
              <Button
                variant="secondary"
                icon={<Plus size={16} />}
                onClick={() => navigate('/mods')}
              >
                {t('servers.detail.mods.browse_install')}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <AnimatePresence>
                {installedMods.map((mod) => (
                  <motion.div
                    key={mod.id}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="flex items-center gap-4 p-3 bg-white/50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-accent-primary/50 transition-colors"
                  >
                    {/* Mod Icon */}
                    <img
                      src={mod.projectIconUrl || `https://via.placeholder.com/48/6366f1/ffffff?text=${mod.projectTitle[0]}`}
                      alt={mod.projectTitle}
                      className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                    />

                    {/* Mod Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium text-text-light-primary dark:text-text-primary truncate">
                          {mod.projectTitle}
                        </h4>
                        <Badge size="sm" variant={mod.classification === 'MODPACK' ? 'info' : 'default'}>
                          {mod.classification}
                        </Badge>
                        {!mod.enabled && (
                          <Badge size="sm" variant="warning">{t('servers.detail.mods.disabled')}</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-sm text-text-light-muted dark:text-text-muted">
                        <span>v{mod.versionName}</span>
                        <span>•</span>
                        <span>{(getModDisplaySize(mod) / 1024).toFixed(1)} KB</span>
                        <span>•</span>
                        <span>{t('servers.detail.mods.installed_on', { date: new Date(mod.installedAt).toLocaleDateString() })}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<ExternalLink size={14} />}
                        onClick={() => {
                          if (mod.providerId === 'curseforge') {
                            // CurseForge slugs: lowercase, spaces to hyphens, remove non-alphanumeric (except hyphens)
                            const slug = mod.projectTitle
                              .toLowerCase()
                              .replace(/[^a-z0-9\s-]/g, '')
                              .replace(/\s+/g, '-')
                              .replace(/-+/g, '-');
                            window.open(`https://www.curseforge.com/hytale/mods/${slug}`, '_blank');
                          } else {
                            // Default to Modtale
                            const slug = mod.projectTitle.toLowerCase().replace(/\s+/g, '-');
                            const type = mod.classification === 'MODPACK' ? 'modpack' : 'mod';
                            window.open(`https://modtale.net/${type}/${slug}-${mod.projectId}`, '_blank');
                          }
                        }}
                        title={
                          mod.providerId === 'curseforge'
                            ? t('servers.detail.mods.view_curseforge')
                            : t('servers.detail.mods.view_modtale')
                        }
                      />
                      <Button
                        variant="danger"
                        size="sm"
                        icon={<Trash2 size={14} />}
                        onClick={() => handleUninstallMod(mod.id, mod.projectTitle)}
                        disabled={uninstallingMod === mod.id}
                        title={t('servers.detail.mods.uninstall_title')}
                      >
                        {uninstallingMod === mod.id ? t('servers.detail.mods.removing') : t('servers.detail.mods.remove')}
                      </Button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card variant="glass">
        <CardHeader>
          <CardTitle>{t('servers.detail.quick.title')}</CardTitle>
          <CardDescription>{t('servers.detail.quick.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <Button variant="secondary" icon={<Terminal size={18} />} className="w-full" onClick={() => navigate('/console')}>
              {t('servers.detail.quick.console')}
            </Button>
            <Button variant="secondary" icon={<Globe size={18} />} className="w-full" onClick={() => navigate(`/servers/${id}/worlds`)}>
              {t('servers.detail.quick.worlds')}
            </Button>
            <Button variant="secondary" icon={<Database size={18} />} className="w-full" onClick={() => navigate('/backups')}>
              {t('servers.detail.quick.backups')}
            </Button>
            <Button variant="secondary" icon={<Package size={18} />} className="w-full" onClick={() => navigate('/mods')}>
              {t('servers.detail.quick.mods')}
            </Button>
            <Button variant="secondary" icon={<Users size={18} />} className="w-full" onClick={() => navigate('/players')}>
              {t('servers.detail.quick.players')}
            </Button>
            <Button variant="secondary" icon={<ArrowUp size={18} />} className="w-full" onClick={() => setShowUpdateModal(true)}>
              {t('servers.detail.quick.update')}
            </Button>
            <Button variant="secondary" icon={<History size={18} />} className="w-full" onClick={() => setShowHistoryModal(true)}>
              {t('servers.detail.quick.history')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Update Modals */}
      <ServerUpdateModal
        isOpen={showUpdateModal}
        onClose={() => setShowUpdateModal(false)}
        serverId={server.id}
        serverName={server.name}
        currentVersion={server.version}
      />

      <UpdateHistoryModal
        isOpen={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
        serverId={server.id}
        serverName={server.name}
        canRollback={!!server.preUpdateBackupId}
      />
    </div>
  );
};
