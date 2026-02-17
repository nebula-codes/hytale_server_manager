import { useEffect, useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button, Badge, Input } from '../../components/ui';
import { ArrowLeft, Save, Play, Square, RotateCw, Terminal, Plus, Minus, Server, Users, ArrowUp, AlertTriangle } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../stores/toastStore';
type NetworkType = 'logical' | 'proxy';

type ProxyConfig = {
  startOrder?: 'proxy_first' | 'backends_first';
  version?: number;
  bindAddress?: string;
  bindPort?: number;
  publicAddress?: string;
  publicPort?: number;
  certificatePath?: string;
  privateKeyPath?: string;
  proxySecret?: string;
  debugMode?: boolean;
  autoInstallBridge?: boolean;
  defaultServer?: string;
  fallbackServer?: string;
  poolEnabled?: boolean;
  pool?: Record<string, { strategy?: 'round-robin' | 'random' | 'least-connections'; servers: string[] }>;
  routes?: { hostname: string; target: string }[];
};

type PoolEntry = {
  key: string;
  strategy: 'round-robin' | 'random' | 'least-connections';
  servers: string[];
};

type RouteEntry = {
  hostname: string;
  target: string;
};

type Network = {
  id: string;
  name: string;
  description?: string;
  networkType: NetworkType;
  proxyServerId?: string;
  proxyConfig?: string | ProxyConfig | null;
  color?: string;
  members: {
    id: string;
    serverId: string;
    role: string;
    sortOrder: number;
    server: { id: string; name: string; status: string };
  }[];
  versionAlignment?: {
    aligned: boolean;
    updateAvailable: boolean;
    requiresAttention: boolean;
    proxyServerId: string | null;
    proxyVersion: string | null;
    backendVersions: string[];
    highestBackendVersion: string | null;
    canUpdateProxyToSupportServers: boolean;
    recommendedAction: 'none' | 'update_proxy' | 'align_servers';
    targetProxyVersion: string | null;
    targetServerVersion: string | null;
    reason: string | null;
  } | null;
};

type NetworkStatus = {
  status: 'running' | 'stopped' | 'starting' | 'stopping' | 'partial';
  memberStatuses: {
    serverId: string;
    status: string;
    version?: string;
  }[];
};

type UngroupedServer = {
  id: string;
  name: string;
  status: string;
};

export const ProxyDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  // Page protégée par RequirePermission; pas de hook dédié ici

  const [network, setNetwork] = useState<Network | null>(null);
  const [status, setStatus] = useState<NetworkStatus | null>(null);
  const [ungroupedServers, setUngroupedServers] = useState<UngroupedServer[]>([]);
  const [form, setForm] = useState<ProxyConfig>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [addingServerId, setAddingServerId] = useState<string | null>(null);
  const [removingServerId, setRemovingServerId] = useState<string | null>(null);
  const [poolEntries, setPoolEntries] = useState<PoolEntry[]>([]);
  const [routeEntries, setRouteEntries] = useState<RouteEntry[]>([]);

  const parsedConfig = useMemo<ProxyConfig>(() => {
    if (!network?.proxyConfig) return {};
    if (typeof network.proxyConfig === 'string') {
      try {
        return JSON.parse(network.proxyConfig) as ProxyConfig;
      } catch {
        return {};
      }
    }
    return network.proxyConfig || {};
  }, [network]);

  const configToForm = (config: ProxyConfig): ProxyConfig => ({
    startOrder: config.startOrder || 'backends_first',
    version: config.version ?? 3,
    bindAddress: config.bindAddress || '0.0.0.0',
    bindPort: config.bindPort || 24322,
    publicAddress: config.publicAddress || 'play.myserver.com',
    publicPort: config.publicPort || config.bindPort || 24322,
    certificatePath: config.certificatePath || 'certs/server.crt',
    privateKeyPath: config.privateKeyPath || 'certs/server.key',
    proxySecret: config.proxySecret || '',
    debugMode: config.debugMode ?? false,
    autoInstallBridge: config.autoInstallBridge !== false,
    defaultServer: config.defaultServer || '',
    fallbackServer: config.fallbackServer || '',
    poolEnabled: config.poolEnabled ?? false,
    pool: config.pool || {},
    routes: config.routes || [],
  });

  const configToPoolEntries = (config: ProxyConfig): PoolEntry[] =>
    Object.entries(config.pool || {}).map(([key, value]) => ({
      key,
      strategy: value?.strategy || 'round-robin',
      servers: Array.isArray(value?.servers) ? value.servers : [],
    }));

  const configToRouteEntries = (config: ProxyConfig): RouteEntry[] =>
    Array.isArray(config.routes)
      ? config.routes.map((route) => ({
          hostname: route?.hostname || '',
          target: route?.target || '',
        }))
      : [];

  const getStatusBadge = (value: string) => {
    switch (value) {
      case 'running':
        return <Badge variant="success" size="sm">{t('networks.manage.status.running')}</Badge>;
      case 'stopped':
        return <Badge variant="default" size="sm">{t('networks.manage.status.stopped')}</Badge>;
      case 'starting':
        return <Badge variant="warning" size="sm">{t('networks.manage.status.starting')}</Badge>;
      case 'stopping':
        return <Badge variant="warning" size="sm">{t('networks.manage.status.stopping')}</Badge>;
      default:
        return <Badge variant="default" size="sm">{value}</Badge>;
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'proxy':
        return <Badge variant="info" size="sm">{t('networks.manage.role.proxy')}</Badge>;
      case 'backend':
        return <Badge variant="warning" size="sm">{t('networks.manage.role.backend')}</Badge>;
      default:
        return <Badge variant="default" size="sm">{t('networks.manage.role.member')}</Badge>;
    }
  };

  const refreshMembersData = async (networkId: string) => {
    const [net, netStatus, ungrouped] = await Promise.all([
      api.getNetwork<Network>(networkId),
      api.getNetworkStatus<NetworkStatus>(networkId),
      api.getUngroupedServers<UngroupedServer>(),
    ]);

    setNetwork(prev => (prev ? { ...net, proxyConfig: prev.proxyConfig } : net));
    setStatus(netStatus);
    setUngroupedServers(ungrouped);
  };

  useEffect(() => {
    if (!id) return;
    const fetchData = async () => {
      try {
        setLoading(true);
        const [net, netStatus, ungrouped] = await Promise.all([
          api.getNetwork<Network>(id),
          api.getNetworkStatus<NetworkStatus>(id),
          api.getUngroupedServers<UngroupedServer>(),
        ]);
        setNetwork(net);
        setStatus(netStatus);
        setUngroupedServers(ungrouped);
      } catch (error: any) {
        toast.error(t('networks.toast.load_failed', { defaultValue: 'Failed to load proxy' }), error?.message);
        navigate('/servers');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id, navigate, t, toast]);

  useEffect(() => {
    if (!network) return;

    setForm(configToForm(parsedConfig));
    setPoolEntries(configToPoolEntries(parsedConfig));
    setRouteEntries(configToRouteEntries(parsedConfig));
  }, [network, parsedConfig]);

  const handleChange = (field: keyof ProxyConfig, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      const parsedPool: ProxyConfig['pool'] = {};
      for (const entry of poolEntries) {
        const key = entry.key.trim();
        if (!key) continue;
        const servers = entry.servers.map((server) => server.trim()).filter(Boolean);
        parsedPool[key] = {
          strategy: entry.strategy || 'round-robin',
          servers,
        };
      }

      const parsedRoutes: ProxyConfig['routes'] = routeEntries
        .map((route) => ({
          hostname: route.hostname.trim(),
          target: route.target.trim(),
        }))
        .filter((route) => route.hostname && route.target);

      await api.updateNetwork(id, {
        proxyConfig: {
          ...form,
          bindPort: form.bindPort || 24322,
          publicAddress: form.publicAddress?.trim() || 'play.myserver.com',
          publicPort: form.publicPort || form.bindPort || 24322,
          version: form.version ?? 3,
          debugMode: form.debugMode ?? false,
          defaultServer: form.defaultServer?.trim() || '',
          fallbackServer: form.fallbackServer?.trim() || '',
          poolEnabled: form.poolEnabled ?? false,
          pool: parsedPool || {},
          routes: parsedRoutes || [],
          certificatePath: form.certificatePath?.trim() || 'certs/server.crt',
          privateKeyPath: form.privateKeyPath?.trim() || 'certs/server.key',
        },
      });
      toast.success(t('networks.toast.proxy_saved', { defaultValue: 'Proxy settings saved' }));
    } catch (error: any) {
      toast.error(t('networks.toast.save_failed', { defaultValue: 'Failed to save proxy settings' }), error?.message);
    } finally {
      setSaving(false);
    }
  };

  const handleStart = async () => {
    if (!id) return;
    setStarting(true);
    try {
      await api.startNetwork(id);
      toast.success(t('networks.toast.start_success', { defaultValue: 'Proxy started' }));
      const s = await api.getNetworkStatus<NetworkStatus>(id);
      setStatus(s);
    } catch (error: any) {
      toast.error(t('networks.toast.start_failed', { defaultValue: 'Failed to start proxy' }), error?.message);
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    if (!id) return;
    setStopping(true);
    try {
      await api.stopNetwork(id);
      toast.success(t('networks.toast.stop_success', { defaultValue: 'Proxy stopped' }));
      const s = await api.getNetworkStatus<NetworkStatus>(id);
      setStatus(s);
    } catch (error: any) {
      toast.error(t('networks.toast.stop_failed', { defaultValue: 'Failed to stop proxy' }), error?.message);
    } finally {
      setStopping(false);
    }
  };

  const handleAddServer = async (serverId: string) => {
    if (!id) return;
    setAddingServerId(serverId);
    try {
      await api.addServerToNetwork(id, serverId, 'backend');
      await refreshMembersData(id);
    } catch (error: any) {
      toast.error(t('networks.toast.save_failed', { defaultValue: 'Failed to save proxy settings' }), error?.message);
    } finally {
      setAddingServerId(null);
    }
  };

  const handleRemoveServer = async (serverId: string) => {
    if (!id) return;
    setRemovingServerId(serverId);
    try {
      await api.removeServerFromNetwork(id, serverId);
      await refreshMembersData(id);
    } catch (error: any) {
      toast.error(t('networks.toast.save_failed', { defaultValue: 'Failed to save proxy settings' }), error?.message);
    } finally {
      setRemovingServerId(null);
    }
  };

  if (loading || !network) {
    return (
      <div className="p-6">
        <div className="animate-pulse h-6 w-48 bg-gray-700 rounded mb-4" />
        <div className="animate-pulse h-10 w-full bg-gray-800 rounded" />
      </div>
    );
  }

  const isRunning = status?.status === 'running';
  const runtimeProxyVersion = status?.memberStatuses?.find((entry) => entry.serverId === `proxy:${id}`)?.version;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" icon={<ArrowLeft size={16} />} onClick={() => navigate(-1)}>
            {t('common.back')}
          </Button>
          <div>
            <h1 className="text-2xl font-heading font-bold text-text-light-primary dark:text-text-primary">
              {network.name} (Proxy)
            </h1>
            <p className="text-text-light-muted dark:text-text-muted text-sm">
              {network.description || t('networks.detail.proxy.subtitle', { defaultValue: 'Proxy network settings' })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isRunning ? 'success' : 'default'}>
            {status?.status || 'unknown'}
          </Badge>
          <Badge variant="info">
            Runtime: {runtimeProxyVersion || 'unknown'}
          </Badge>
          <Link to={`/console`}>
            <Button variant="secondary" size="sm" icon={<Terminal size={16} />}>
              {t('console.title')}
            </Button>
          </Link>
          <Button
            variant={isRunning ? 'danger' : 'primary'}
            size="sm"
            icon={isRunning ? <Square size={16} /> : <Play size={16} />}
            onClick={isRunning ? handleStop : handleStart}
            disabled={starting || stopping}
          >
            {isRunning ? t('servers.actions.stop') : t('servers.actions.start')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<RotateCw size={16} />}
            onClick={() => api.restartNetwork(id!)}
            disabled={starting || stopping}
          >
            {t('servers.actions.restart')}
          </Button>
        </div>
      </div>

      <Card variant="glass">
        {network.versionAlignment?.updateAvailable && (
          <CardContent className="pt-6 pb-0">
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-yellow-500">
                <AlertTriangle size={16} />
                Version alignment required
              </div>
              <p className="mt-2 text-text-light-primary dark:text-text-primary">
                {network.versionAlignment.reason || 'Proxy and backend versions are not aligned.'}
              </p>
              {network.versionAlignment.recommendedAction === 'update_proxy' && network.versionAlignment.targetProxyVersion && (
                <div className="mt-2 inline-flex items-center gap-2 rounded bg-accent-primary/20 px-2 py-1 text-xs text-accent-primary">
                  <ArrowUp size={14} />
                  Proxy update available: target {network.versionAlignment.targetProxyVersion}
                </div>
              )}
              {network.versionAlignment.recommendedAction === 'align_servers' && network.versionAlignment.targetServerVersion && (
                <div className="mt-2 inline-flex items-center gap-2 rounded bg-gray-700/60 px-2 py-1 text-xs text-text-light-primary dark:text-text-primary">
                  Align backend servers to proxy version {network.versionAlignment.targetServerVersion}
                </div>
              )}
            </div>
          </CardContent>
        )}
        <CardHeader>
          <CardTitle>{t('networks.detail.proxy.config_title', { defaultValue: 'Proxy Configuration' })}</CardTitle>
          <CardDescription>{t('networks.detail.proxy.config_subtitle', { defaultValue: 'Fields are written to proxy.yml on start' })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Bind Address"
              value={form.bindAddress || ''}
              onChange={e => handleChange('bindAddress', e.target.value)}
            />
            <Input
              label="Bind Port"
              type="number"
              value={form.bindPort ?? 24322}
              onChange={e => handleChange('bindPort', Number(e.target.value))}
            />
            <Input
              label="Public Address"
              value={form.publicAddress || ''}
              onChange={e => handleChange('publicAddress', e.target.value)}
              placeholder="example.com"
            />
            <Input
              label="Public Port"
              type="number"
              value={form.publicPort ?? form.bindPort ?? 24322}
              onChange={e => handleChange('publicPort', Number(e.target.value))}
            />
            <Input
              label="Certificate Path"
              value={form.certificatePath || ''}
              onChange={e => handleChange('certificatePath', e.target.value)}
              placeholder="/path/to/cert.pem"
            />
            <Input
              label="Private Key Path"
              value={form.privateKeyPath || ''}
              onChange={e => handleChange('privateKeyPath', e.target.value)}
              placeholder="/path/to/key.pem"
            />
            <Input
              label="Proxy Secret"
              value={form.proxySecret || ''}
              onChange={e => handleChange('proxySecret', e.target.value)}
              placeholder="Leave blank to keep current"
            />
            <Input
              label="Config Version"
              type="number"
              value={form.version ?? 3}
              onChange={e => handleChange('version', Number(e.target.value) || 3)}
            />
            <div className="flex flex-col gap-1">
              <label className="text-sm text-text-light-primary dark:text-text-primary font-medium">
                {t('networks.create.proxy_start_order', { defaultValue: 'Start Order' })}
              </label>
              <select
                className="bg-white dark:bg-primary-bg border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2"
                value={form.startOrder || 'backends_first'}
                onChange={e => handleChange('startOrder', e.target.value as ProxyConfig['startOrder'])}
              >
                <option value="backends_first">
                  {t('networks.create.proxy_start_order_backends', { defaultValue: 'Backends first' })}
                </option>
                <option value="proxy_first">
                  {t('networks.create.proxy_start_order_proxy', { defaultValue: 'Proxy first' })}
                </option>
              </select>
            </div>
            <Input
              label="Default Server"
              value={form.defaultServer || ''}
              onChange={e => handleChange('defaultServer', e.target.value)}
              placeholder="lobby-1"
            />
            <Input
              label="Fallback Server"
              value={form.fallbackServer || ''}
              onChange={e => handleChange('fallbackServer', e.target.value)}
              placeholder="server-name"
            />
            <div className="md:col-span-2 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-text-light-primary dark:text-text-primary">Pool Enabled</p>
              </div>
              <input
                type="checkbox"
                className="w-5 h-5"
                checked={form.poolEnabled ?? false}
                onChange={(e) => handleChange('poolEnabled', e.target.checked)}
              />
            </div>
            <div className="md:col-span-2 flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label className="text-sm text-text-light-primary dark:text-text-primary font-medium">
                  Pools
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  icon={<Plus size={14} />}
                  onClick={() => setPoolEntries((prev) => [...prev, { key: '', strategy: 'round-robin', servers: [] }])}
                >
                  Add Pool
                </Button>
              </div>
              <div className="space-y-3">
                {poolEntries.length === 0 && (
                  <div className="text-xs text-text-light-muted dark:text-text-muted border border-dashed border-gray-600 rounded-lg p-3">
                    No pool configured.
                  </div>
                )}
                {poolEntries.map((entry, index) => (
                  <div key={`pool-${index}`} className="border border-gray-700 rounded-lg p-3 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <Input
                        label="Pool Name"
                        value={entry.key}
                        onChange={(e) => setPoolEntries((prev) => prev.map((item, i) => (i === index ? { ...item, key: e.target.value } : item)))}
                        placeholder="lobby"
                      />
                      <div className="flex flex-col gap-1">
                        <label className="text-sm text-text-light-primary dark:text-text-primary font-medium">Strategy</label>
                        <select
                          className="bg-white dark:bg-primary-bg border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2"
                          value={entry.strategy}
                          onChange={(e) => setPoolEntries((prev) => prev.map((item, i) => (i === index ? { ...item, strategy: e.target.value as PoolEntry['strategy'] } : item)))}
                        >
                          <option value="round-robin">round-robin</option>
                          <option value="random">random</option>
                          <option value="least-connections">least-connections</option>
                        </select>
                      </div>
                      <div className="flex items-end">
                        <Button
                          type="button"
                          size="sm"
                          variant="danger"
                          icon={<Minus size={14} />}
                          onClick={() => setPoolEntries((prev) => prev.filter((_, i) => i !== index))}
                        >
                          Remove Pool
                        </Button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-sm text-text-light-primary dark:text-text-primary font-medium">Servers</label>
                      <div className="space-y-2">
                        {entry.servers.map((serverName, serverIndex) => (
                          <div key={`pool-server-${index}-${serverIndex}`} className="flex items-center gap-2">
                            <input
                              className="flex-1 bg-white dark:bg-primary-bg border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2"
                              value={serverName}
                              onChange={(e) =>
                                setPoolEntries((prev) =>
                                  prev.map((item, i) =>
                                    i === index
                                      ? {
                                          ...item,
                                          servers: item.servers.map((srv, si) => (si === serverIndex ? e.target.value : srv)),
                                        }
                                      : item
                                  )
                                )
                              }
                              placeholder="lobby-1"
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              icon={<Minus size={14} />}
                              onClick={() =>
                                setPoolEntries((prev) =>
                                  prev.map((item, i) =>
                                    i === index
                                      ? { ...item, servers: item.servers.filter((_, si) => si !== serverIndex) }
                                      : item
                                  )
                                )
                              }
                            >
                              Remove
                            </Button>
                          </div>
                        ))}
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          icon={<Plus size={14} />}
                          onClick={() =>
                            setPoolEntries((prev) =>
                              prev.map((item, i) =>
                                i === index ? { ...item, servers: [...item.servers, ''] } : item
                              )
                            )
                          }
                        >
                          Add Server
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="md:col-span-2 flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label className="text-sm text-text-light-primary dark:text-text-primary font-medium">
                  Routes
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  icon={<Plus size={14} />}
                  onClick={() => setRouteEntries((prev) => [...prev, { hostname: '', target: '' }])}
                >
                  Add Route
                </Button>
              </div>
              <div className="space-y-2">
                {routeEntries.length === 0 && (
                  <div className="text-xs text-text-light-muted dark:text-text-muted border border-dashed border-gray-600 rounded-lg p-3">
                    No route configured.
                  </div>
                )}
                {routeEntries.map((route, index) => (
                  <div key={`route-${index}`} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-end">
                    <Input
                      label="Hostname"
                      value={route.hostname}
                      onChange={(e) =>
                        setRouteEntries((prev) => prev.map((item, i) => (i === index ? { ...item, hostname: e.target.value } : item)))
                      }
                      placeholder="lobby.example.com"
                    />
                    <Input
                      label="Target (server or pool)"
                      value={route.target}
                      onChange={(e) =>
                        setRouteEntries((prev) => prev.map((item, i) => (i === index ? { ...item, target: e.target.value } : item)))
                      }
                      placeholder="lobby"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      icon={<Minus size={14} />}
                      onClick={() => setRouteEntries((prev) => prev.filter((_, i) => i !== index))}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-text-light-primary dark:text-text-primary">Auto-install Bridge</p>
                <p className="text-xs text-text-light-muted dark:text-text-muted">Copy bridge jars to backends on start</p>
              </div>
              <input
                type="checkbox"
                className="w-5 h-5"
                checked={form.autoInstallBridge !== false}
                onChange={(e) => handleChange('autoInstallBridge', e.target.checked)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-text-light-primary dark:text-text-primary">Debug Mode</p>
                <p className="text-xs text-text-light-muted dark:text-text-muted">Verbose proxy logging</p>
              </div>
              <input
                type="checkbox"
                className="w-5 h-5"
                checked={form.debugMode ?? false}
                onChange={(e) => handleChange('debugMode', e.target.checked)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setForm(configToForm(parsedConfig));
                setPoolEntries(configToPoolEntries(parsedConfig));
                setRouteEntries(configToRouteEntries(parsedConfig));
              }}
            >
              {t('servers.settings.reset')}
            </Button>
            <Button variant="primary" icon={<Save size={16} />} onClick={handleSave} disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card variant="glass">
        <CardHeader>
          <CardTitle>{t('networks.manage.title', { name: network.name })}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Users size={18} className="text-accent-primary" />
              <h3 className="font-medium text-text-light-primary dark:text-text-primary">
                {t('networks.manage.current_members', { count: network.members.length })}
              </h3>
            </div>

            {network.members.length === 0 ? (
              <div className="text-center py-6 text-text-muted bg-gray-800/50 rounded-lg">
                {t('networks.manage.empty')}
              </div>
            ) : (
              <div className="space-y-2">
                {network.members.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <Server size={16} className="text-text-muted" />
                      <div>
                        <span className="text-text-light-primary dark:text-text-primary">
                          {member.server.name}
                        </span>
                        <div className="flex items-center gap-2 mt-1">
                          {getRoleBadge(member.role)}
                          {getStatusBadge(member.server.status)}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Minus size={14} />}
                      onClick={() => handleRemoveServer(member.serverId)}
                      disabled={removingServerId === member.serverId}
                      className="text-danger hover:bg-danger/10"
                    >
                      {removingServerId === member.serverId ? t('common.deleting') : t('common.remove')}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-gray-700" />

          <div>
            <div className="flex items-center gap-2 mb-3">
              <Plus size={18} className="text-success" />
              <h3 className="font-medium text-text-light-primary dark:text-text-primary">
                {t('networks.manage.available', { count: ungroupedServers.length })}
              </h3>
            </div>

            {ungroupedServers.length === 0 ? (
              <div className="text-center py-6 text-text-muted bg-gray-800/50 rounded-lg">
                {t('networks.manage.empty_available')}
              </div>
            ) : (
              <div className="space-y-2">
                {ungroupedServers.map((server) => (
                  <div
                    key={server.id}
                    className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <Server size={16} className="text-text-muted" />
                      <div>
                        <span className="text-text-light-primary dark:text-text-primary">
                          {server.name}
                        </span>
                        <div className="mt-1">
                          {getStatusBadge(server.status)}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Plus size={14} />}
                      onClick={() => handleAddServer(server.id)}
                      disabled={addingServerId === server.id}
                      className="text-success hover:bg-success/10"
                    >
                      {addingServerId === server.id ? t('common.loading') : t('common.add')}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ProxyDetailPage;
