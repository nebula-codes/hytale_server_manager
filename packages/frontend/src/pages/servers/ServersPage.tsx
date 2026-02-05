import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge, StatusIndicator, DataTable, ConfirmDialog, type Column } from '../../components/ui';
import { Play, Square, RotateCw, Eye, Plus, Trash2, Network, List, LayoutGrid, Skull } from 'lucide-react';
import { useToast } from '../../stores/toastStore';
import api from '../../services/api';
import websocket from '../../services/websocket';
import { CreateServerModal, type ServerFormData } from '../../components/modals/CreateServerModal';
import { CreateNetworkModal } from '../../components/modals/CreateNetworkModal';
import { ManageNetworkServersModal } from '../../components/modals/ManageNetworkServersModal';
import { NetworkCard } from '../../components/networks';
import {
  useNetworks,
  useUngroupedServers,
  useStartNetwork,
  useStopNetwork,
  useRestartNetwork,
  useDeleteNetwork,
  useCreateNetwork,
  useAddServerToNetwork,
  useRemoveServerFromNetwork,
} from '../../hooks/api/useNetworks';
import type { NetworkStatus, AggregatedMetrics, CreateNetworkDto, NetworkWithMembers } from '../../types';

interface Server {
  id: string;
  name: string;
  address: string;
  port: number;
  version: string;
  maxPlayers: number;
  status: 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed' | 'orphaned';
  currentPlayers?: number;
  tps?: number;
  cpuUsage?: number;
  memoryUsage?: number;
  memoryAllocated?: number;
  uptime?: number;
}

type ViewMode = 'grouped' | 'flat';

export const ServersPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCreateNetworkModal, setShowCreateNetworkModal] = useState(false);
  const [serverToDelete, setServerToDelete] = useState<Server | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('grouped');
  const [expandedNetworks, setExpandedNetworks] = useState<Set<string>>(new Set());
  const [managingNetwork, setManagingNetwork] = useState<NetworkWithMembers | null>(null);

  // Network data hooks
  const { data: networks = [], isLoading: networksLoading, refetch: refetchNetworks } = useNetworks();
  const { data: ungroupedServers = [], refetch: refetchUngrouped } = useUngroupedServers();

  // Network status and metrics (stored in state for real-time updates)
  const [networkStatuses, setNetworkStatuses] = useState<Record<string, NetworkStatus>>({});
  const [networkMetrics, setNetworkMetrics] = useState<Record<string, AggregatedMetrics>>({});

  // Network mutations
  const startNetworkMutation = useStartNetwork();
  const stopNetworkMutation = useStopNetwork();
  const restartNetworkMutation = useRestartNetwork();
  const deleteNetworkMutation = useDeleteNetwork();
  const createNetworkMutation = useCreateNetwork();
  const addServerToNetworkMutation = useAddServerToNetwork();
  const removeServerFromNetworkMutation = useRemoveServerFromNetwork();

  // Fetch network status and metrics
  useEffect(() => {
    const fetchNetworkData = async () => {
      for (const network of networks) {
        try {
          const [status, metrics] = await Promise.all([
            api.getNetworkStatus<NetworkStatus>(network.id),
            api.getNetworkMetrics<AggregatedMetrics>(network.id),
          ]);
          setNetworkStatuses(prev => ({ ...prev, [network.id]: status }));
          setNetworkMetrics(prev => ({ ...prev, [network.id]: metrics }));
        } catch (error) {
          console.error(`Error fetching network data for ${network.id}:`, error);
        }
      }
    };

    if (networks.length > 0) {
      fetchNetworkData();
      // Refresh network data periodically
      const interval = setInterval(fetchNetworkData, 30000);
      return () => clearInterval(interval);
    }
  }, [networks]);

  // Fetch servers on mount
  useEffect(() => {
    fetchServers();
  }, []);

  // Connect to WebSocket for real-time updates
  useEffect(() => {
    const socket = websocket.connectToServers();

    // Subscribe to all servers for real-time updates
    servers.forEach((server) => {
      socket.emit('subscribe', { serverId: server.id });
    });

    // Listen for status updates
    socket.on('server:status', (data: any) => {
      setServers((prev) =>
        prev.map((s) =>
          s.id === data.serverId
            ? { ...s, status: data.status.status, currentPlayers: data.status.playerCount }
            : s
        )
      );
    });

    // Listen for metrics updates
    socket.on('server:metrics', (data: any) => {
      setServers((prev) =>
        prev.map((s) =>
          s.id === data.serverId
            ? {
              ...s,
              cpuUsage: data.metrics.cpuUsage,
              memoryUsage: Math.round(data.metrics.memoryUsage),
              memoryAllocated: Math.round(data.metrics.memoryTotal),
              tps: data.metrics.tps,
              uptime: Math.round(data.metrics.uptime),
            }
            : s
        )
      );
    });

    return () => {
      servers.forEach((server) => {
        socket.emit('unsubscribe', { serverId: server.id });
      });
    };
  }, [servers.map(s => s.id).join(',')]);

  const fetchServers = async () => {
    try {
      setLoading(true);
      const data = await api.getServers();

      // Transform backend data to match frontend structure
      const transformedServers = data.map((server: any) => ({
        id: server.id,
        name: server.name,
        address: server.address,
        port: server.port,
        version: server.version,
        maxPlayers: server.maxPlayers,
        status: server.status,
        currentPlayers: 0,
        tps: 0,
        cpuUsage: 0,
        memoryUsage: 0,
        memoryAllocated: 8192,
        uptime: 0,
      }));

      setServers(transformedServers);

      // Fetch initial metrics for running servers
      for (const server of transformedServers) {
        if (server.status === 'running') {
          try {
            const [status, metrics] = await Promise.all([
              api.getServerStatus(server.id),
              api.getServerMetrics(server.id),
            ]);

            setServers((prev) =>
              prev.map((s) =>
                s.id === server.id
                  ? {
                    ...s,
                    currentPlayers: status.playerCount,
                    cpuUsage: metrics.cpuUsage,
                    memoryUsage: Math.round(metrics.memoryUsage),
                    memoryAllocated: Math.round(metrics.memoryTotal),
                    tps: metrics.tps,
                    uptime: Math.round(metrics.uptime),
                  }
                  : s
              )
            );
          } catch (error) {
            console.error(`Error fetching metrics for server ${server.id}:`, error);
          }
        }
      }
    } catch (error) {
      console.error('Error fetching servers:', error);
      toast.error(t('servers.toast.load_failed.title'), t('servers.toast.load_failed.description'));
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async (server: Server) => {
    try {
      await api.startServer(server.id);
      toast.success(t('servers.toast.starting.title'), t('servers.toast.starting.description', { name: server.name }));

      // Update local state immediately
      setServers((prev) =>
        prev.map((s) => (s.id === server.id ? { ...s, status: 'starting' } : s))
      );
    } catch (error: any) {
      toast.error(t('servers.toast.start_failed.title'), error.message || t('servers.toast.generic_error'));
    }
  };

  const handleStop = async (server: Server) => {
    try {
      await api.stopServer(server.id);
      toast.warning(t('servers.toast.stopping.title'), t('servers.toast.stopping.description', { name: server.name }));

      // Update local state immediately
      setServers((prev) =>
        prev.map((s) => (s.id === server.id ? { ...s, status: 'stopping' } : s))
      );
    } catch (error: any) {
      toast.error(t('servers.toast.stop_failed.title'), error.message || t('servers.toast.generic_error'));
    }
  };

  const handleRestart = async (server: Server) => {
    try {
      await api.restartServer(server.id);
      toast.info(t('servers.toast.restarting.title'), t('servers.toast.restarting.description', { name: server.name }));
    } catch (error: any) {
      toast.error(t('servers.toast.restart_failed.title'), error.message || t('servers.toast.generic_error'));
    }
  };

  const handleKill = async (server: Server) => {
    try {
      await api.killServer(server.id);
      toast.warning(t('servers.toast.killed.title'), t('servers.toast.killed.description', { name: server.name }));

      // Update local state immediately
      setServers((prev) =>
        prev.map((s) => (s.id === server.id ? { ...s, status: 'stopped' } : s))
      );
    } catch (error: any) {
      toast.error(t('servers.toast.kill_failed.title'), error.message || t('servers.toast.generic_error'));
    }
  };

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const handleCreateServer = async (data: ServerFormData) => {
    try {
      const newServer = await api.createServer<Server>(data);
      toast.success(t('servers.toast.created.title'), t('servers.toast.created.description', { name: newServer.name }));
      await fetchServers(); // Refresh the list
      refetchUngrouped(); // Refresh ungrouped servers
    } catch (error: any) {
      toast.error(t('servers.toast.create_failed.title'), error.message || t('servers.toast.generic_error'));
      throw error; // Re-throw to keep modal open
    }
  };

  const handleCreateNetwork = async (data: CreateNetworkDto) => {
    await createNetworkMutation.mutateAsync(data);
    refetchNetworks();
    refetchUngrouped();
  };

  const handleDeleteServer = async () => {
    if (!serverToDelete) return;

    try {
      setDeleting(true);
      await api.deleteServer(serverToDelete.id);
      toast.success(t('servers.toast.deleted.title'), t('servers.toast.deleted.description', { name: serverToDelete.name }));
      setServers((prev) => prev.filter((s) => s.id !== serverToDelete.id));
      setServerToDelete(null);
      refetchUngrouped();
    } catch (error: any) {
      toast.error(t('servers.toast.delete_failed.title'), error.message || t('servers.toast.generic_error'));
    } finally {
      setDeleting(false);
    }
  };

  // Network action handlers
  const handleStartNetwork = (networkId: string) => {
    startNetworkMutation.mutate(networkId, {
      onSuccess: () => {
        // Refresh network status
        api.getNetworkStatus<NetworkStatus>(networkId).then(status => {
          setNetworkStatuses(prev => ({ ...prev, [networkId]: status }));
        });
      },
    });
  };

  const handleStopNetwork = (networkId: string) => {
    stopNetworkMutation.mutate(networkId, {
      onSuccess: () => {
        api.getNetworkStatus<NetworkStatus>(networkId).then(status => {
          setNetworkStatuses(prev => ({ ...prev, [networkId]: status }));
        });
      },
    });
  };

  const handleRestartNetwork = (networkId: string) => {
    restartNetworkMutation.mutate(networkId, {
      onSuccess: () => {
        api.getNetworkStatus<NetworkStatus>(networkId).then(status => {
          setNetworkStatuses(prev => ({ ...prev, [networkId]: status }));
        });
      },
    });
  };

  const handleDeleteNetwork = (networkId: string) => {
    deleteNetworkMutation.mutate(networkId, {
      onSuccess: () => {
        refetchNetworks();
        refetchUngrouped();
      },
    });
  };

  const handleManageServers = (network: NetworkWithMembers) => {
    setManagingNetwork(network);
  };

  const handleAddServerToNetwork = async (networkId: string, serverId: string, role?: string) => {
    await addServerToNetworkMutation.mutateAsync({ networkId, serverId, role });
    // Refetch data and update the managing network with fresh data
    const [networksResult] = await Promise.all([refetchNetworks(), refetchUngrouped()]);
    const updatedNetwork = networksResult.data?.find(n => n.id === networkId);
    if (updatedNetwork) {
      setManagingNetwork(updatedNetwork);
    }
  };

  const handleRemoveServerFromNetwork = async (networkId: string, serverId: string) => {
    await removeServerFromNetworkMutation.mutateAsync({ networkId, serverId });
    // Refetch data and update the managing network with fresh data
    const [networksResult] = await Promise.all([refetchNetworks(), refetchUngrouped()]);
    const updatedNetwork = networksResult.data?.find(n => n.id === networkId);
    if (updatedNetwork) {
      setManagingNetwork(updatedNetwork);
    }
  };

  const handleServerAction = async (serverId: string, action: 'start' | 'stop' | 'restart' | 'kill' | 'delete') => {
    const server = servers.find(s => s.id === serverId);
    if (!server) return;

    switch (action) {
      case 'start':
        await handleStart(server);
        break;
      case 'stop':
        await handleStop(server);
        break;
      case 'restart':
        await handleRestart(server);
        break;
      case 'kill':
        await handleKill(server);
        break;
      case 'delete':
        setServerToDelete(server);
        break;
    }
  };

  const toggleNetworkExpand = (networkId: string) => {
    setExpandedNetworks(prev => {
      const next = new Set(prev);
      if (next.has(networkId)) {
        next.delete(networkId);
      } else {
        next.add(networkId);
      }
      return next;
    });
  };

  // Get available servers for network creation (all ungrouped servers)
  const availableServersForNetwork = useMemo(() => {
    return ungroupedServers.map(s => ({
      id: s.id,
      name: s.name,
      status: s.status,
    }));
  }, [ungroupedServers]);

  const columns: Column<Server>[] = [
    {
      key: 'name',
      label: t('servers.columns.server'),
      render: (server) => (
        <div>
          <p className="font-medium text-text-light-primary dark:text-text-primary">{server.name}</p>
          <p className="text-xs text-text-light-muted dark:text-text-muted">{server.address}:{server.port}</p>
        </div>
      ),
    },
    {
      key: 'status',
      label: t('servers.columns.status'),
      render: (server) => <StatusIndicator status={server.status} showLabel />,
    },
    {
      key: 'currentPlayers',
      label: t('servers.columns.players'),
      render: (server) => (
        <div>
          <p className="font-medium text-text-light-primary dark:text-text-primary">
            {server.currentPlayers || 0} / {server.maxPlayers}
          </p>
          <div className="w-24 h-1.5 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden mt-1">
            <div
              className="h-full bg-accent-primary"
              style={{ width: `${((server.currentPlayers || 0) / server.maxPlayers) * 100}%` }}
            />
          </div>
        </div>
      ),
    },
    {
      key: 'version',
      label: t('servers.columns.version'),
      render: (server) => <Badge variant="info" size="sm">{server.version}</Badge>,
    },
    {
      key: 'tps',
      label: t('servers.columns.tps'),
      render: (server) => {
        if (server.status !== 'running' || !server.tps) {
          return <span className="text-sm text-text-light-muted dark:text-text-muted">-</span>;
        }
        return (
          <Badge variant={server.tps >= 19.5 ? 'success' : server.tps >= 18 ? 'warning' : 'danger'} size="sm">
            {server.tps.toFixed(1)}
          </Badge>
        );
      },
    },
    {
      key: 'cpuUsage',
      label: t('servers.columns.cpu'),
      render: (server) => {
        if (server.status !== 'running' || server.cpuUsage === undefined) {
          return <span className="text-sm text-text-light-muted dark:text-text-muted">-</span>;
        }
        return (
          <div>
            <p className="text-sm text-text-light-primary dark:text-text-primary">{server.cpuUsage.toFixed(1)}%</p>
            <div className="w-16 h-1.5 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden mt-1">
              <div
                className={`h-full ${server.cpuUsage > 70 ? 'bg-danger' : server.cpuUsage > 50 ? 'bg-warning' : 'bg-success'
                  }`}
                style={{ width: `${server.cpuUsage}%` }}
              />
            </div>
          </div>
        );
      },
    },
    {
      key: 'memoryUsage',
      label: t('servers.columns.memory'),
      render: (server) => {
        if (server.status !== 'running' || !server.memoryUsage) {
          return <span className="text-sm text-text-light-muted dark:text-text-muted">-</span>;
        }
        return (
          <div>
            <p className="text-sm text-text-light-primary dark:text-text-primary">{server.memoryUsage} MB</p>
            <p className="text-xs text-text-light-muted dark:text-text-muted">
              {((server.memoryUsage / (server.memoryAllocated || 8192)) * 100).toFixed(0)}%
            </p>
          </div>
        );
      },
    },
    {
      key: 'uptime',
      label: t('servers.columns.uptime'),
      render: (server) => (
        server.status === 'running' && server.uptime ? (
          <span className="text-sm text-text-light-primary dark:text-text-primary">{formatUptime(server.uptime)}</span>
        ) : (
          <span className="text-sm text-text-light-muted dark:text-text-muted">-</span>
        )
      ),
    },
    {
      key: 'actions',
      label: t('servers.columns.actions'),
      sortable: false,
      render: (server) => (
        <div className="flex gap-2">
          {server.status === 'running' ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                icon={<Square size={14} />}
                onClick={() => handleStop(server)}
              >
                {t('servers.actions.stop')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<RotateCw size={14} />}
                onClick={() => handleRestart(server)}
              >
                {t('servers.actions.restart')}
              </Button>
            </>
          ) : server.status === 'stopped' || server.status === 'crashed' ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<Play size={14} />}
              onClick={() => handleStart(server)}
            >
              {t('servers.actions.start')}
            </Button>
          ) : server.status === 'stopping' ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<Skull size={14} />}
              onClick={() => handleKill(server)}
              className="text-danger hover:bg-danger/10"
              title={t('servers.tooltips.force_kill')}
            >
              {t('servers.actions.kill')}
            </Button>
          ) : (
            <Button variant="ghost" size="sm" disabled>
              {server.status}...
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={<Eye size={14} />}
            onClick={() => navigate(`/servers/${server.id}`)}
          >
            {t('servers.actions.details')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 size={14} />}
            onClick={() => setServerToDelete(server)}
            disabled={server.status !== 'stopped' && server.status !== 'crashed'}
            title={server.status !== 'stopped' && server.status !== 'crashed'
              ? t('servers.tooltips.stop_before_delete')
              : t('servers.tooltips.delete_server')}
          >
            {t('servers.actions.delete')}
          </Button>
        </div>
      ),
    },
  ];

  // Columns for ungrouped servers
  const ungroupedColumns: Column<{ id: string; name: string; status: string }>[] = [
    {
      key: 'name',
      label: t('servers.columns.server'),
      render: (server) => (
        <span
          className="font-medium text-text-light-primary dark:text-text-primary cursor-pointer hover:text-accent-primary"
          onClick={() => navigate(`/servers/${server.id}`)}
        >
          {server.name}
        </span>
      ),
    },
    {
      key: 'status',
      label: t('servers.columns.status'),
      render: (server) => {
        // Use status from local servers state if available for immediate updates
        const fullServer = servers.find(s => s.id === server.id);
        const currentStatus = fullServer?.status || server.status;
        return <StatusIndicator status={currentStatus as any} showLabel />;
      },
    },
    {
      key: 'actions',
      label: t('common.actions'),
      sortable: false,
      render: (server) => {
        const fullServer = servers.find(s => s.id === server.id);
        const currentStatus = fullServer?.status || server.status;
        return (
          <div className="flex gap-2">
            {currentStatus === 'running' ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Square size={14} />}
                  onClick={() => fullServer && handleStop(fullServer)}
                >
                  {t('servers.actions.stop')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<RotateCw size={14} />}
                  onClick={() => fullServer && handleRestart(fullServer)}
                >
                  {t('servers.actions.restart')}
                </Button>
              </>
            ) : currentStatus === 'stopped' || currentStatus === 'crashed' ? (
              <Button
                variant="ghost"
                size="sm"
                icon={<Play size={14} />}
                onClick={() => fullServer && handleStart(fullServer)}
              >
                {t('servers.actions.start')}
              </Button>
            ) : currentStatus === 'stopping' ? (
              <Button
                variant="ghost"
                size="sm"
                icon={<Skull size={14} />}
                onClick={() => fullServer && handleKill(fullServer)}
                className="text-danger hover:bg-danger/10"
                title={t('servers.tooltips.force_kill')}
              >
                {t('servers.actions.kill')}
              </Button>
            ) : (
              <Button variant="ghost" size="sm" disabled>
                {currentStatus}...
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              icon={<Eye size={14} />}
              onClick={() => navigate(`/servers/${server.id}`)}
            >
              {t('servers.actions.details')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 size={14} />}
              onClick={() => fullServer && setServerToDelete(fullServer)}
              disabled={currentStatus !== 'stopped' && currentStatus !== 'crashed'}
              title={currentStatus !== 'stopped' && currentStatus !== 'crashed' ? 'Stop the server before deleting' : 'Delete server'}
            >
              {t('servers.actions.delete')}
            </Button>
          </div>
        );
      },
    },
  ];

  const isAnyNetworkLoading = startNetworkMutation.isPending ||
    stopNetworkMutation.isPending ||
    restartNetworkMutation.isPending ||
    deleteNetworkMutation.isPending;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-heading font-bold text-text-light-primary dark:text-text-primary">{t('servers.title')}</h1>
          <p className="text-sm sm:text-base text-text-light-muted dark:text-text-muted mt-1">{t('servers.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* View Mode Toggle */}
          <div className="flex bg-gray-800 rounded-lg p-1">
            <button
              onClick={() => setViewMode('grouped')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${viewMode === 'grouped'
                ? 'bg-accent-primary text-black'
                : 'text-text-muted hover:text-text-primary'
                }`}
            >
              <LayoutGrid size={14} />
              <span className="hidden sm:inline">{t('servers.view_mode.grouped')}</span>
            </button>
            <button
              onClick={() => setViewMode('flat')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${viewMode === 'flat'
                ? 'bg-accent-primary text-black'
                : 'text-text-muted hover:text-text-primary'
                }`}
            >
              <List size={14} />
              <span className="hidden sm:inline">{t('servers.view_mode.flat')}</span>
            </button>
          </div>

          <Button
            variant="secondary"
            icon={<Network size={18} />}
            onClick={() => setShowCreateNetworkModal(true)}
          >
            <span className="hidden sm:inline">{t('servers.create_network')}</span>
          </Button>
          <Button
            variant="primary"
            icon={<Plus size={18} />}
            onClick={() => setShowCreateModal(true)}
          >
            <span className="hidden sm:inline">{t('servers.create.title')}</span>
          </Button>
        </div>
      </div>

      {/* Content based on view mode */}
      {viewMode === 'grouped' ? (
        <>
          {/* Loading State */}
          {networksLoading && (
            <div className="text-center py-8 text-text-muted">
              {t('common.loading')}
            </div>
          )}

          {/* Networks */}
          {!networksLoading && networks.length > 0 && (
            <div>
              <h2 className="text-lg font-heading font-semibold text-text-light-primary dark:text-text-primary mb-4">
                {t('servers.networks')} ({networks.length})
              </h2>
              {networks.map((network) => (
                <NetworkCard
                  key={network.id}
                  network={network}
                  status={networkStatuses[network.id]}
                  metrics={networkMetrics[network.id]}
                  servers={servers}
                  expanded={expandedNetworks.has(network.id)}
                  onToggleExpand={() => toggleNetworkExpand(network.id)}
                  onStartNetwork={handleStartNetwork}
                  onStopNetwork={handleStopNetwork}
                  onRestartNetwork={handleRestartNetwork}
                  onDeleteNetwork={handleDeleteNetwork}
                  onManageServers={handleManageServers}
                  onServerAction={handleServerAction}
                  isLoading={isAnyNetworkLoading}
                />
              ))}
            </div>
          )}

          {/* Ungrouped Servers */}
          {ungroupedServers.length > 0 && (
            <Card variant="glass">
              <CardHeader>
                <CardTitle>{t('servers.ungrouped')} ({ungroupedServers.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <DataTable
                  data={ungroupedServers}
                  columns={ungroupedColumns}
                  keyExtractor={(server) => server.id}
                  itemsPerPage={10}
                  searchable
                />
              </CardContent>
            </Card>
          )}

          {/* Empty State */}
          {!networksLoading && networks.length === 0 && ungroupedServers.length === 0 && servers.length === 0 && (
            <Card variant="glass" className="text-center py-12">
              <CardContent>
                <Network size={48} className="mx-auto text-text-muted mb-4" />
                <h3 className="text-lg font-heading font-semibold text-text-light-primary dark:text-text-primary mb-2">
                  {t('servers.empty.title')}
                </h3>
                <p className="text-text-light-muted dark:text-text-muted mb-4">
                  {t('servers.empty.description')}
                </p>
                <div className="flex justify-center gap-3">
                  <Button variant="secondary" icon={<Network size={18} />} onClick={() => setShowCreateNetworkModal(true)}>
                    {t('servers.create_network')}
                  </Button>
                  <Button variant="primary" icon={<Plus size={18} />} onClick={() => setShowCreateModal(true)}>
                    {t('servers.create.submit')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        /* Flat View - Original Table */
        <Card variant="glass">
          <CardHeader>
            <CardTitle>
              {t('servers.all_servers')} {loading && `(${t('common.loading')})`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              data={servers}
              columns={columns}
              keyExtractor={(server) => server.id}
              itemsPerPage={10}
              searchable
              exportable
            />
          </CardContent>
        </Card>
      )}

      {/* Create Server Modal */}
      <CreateServerModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateServer}
      />

      {/* Create Network Modal */}
      <CreateNetworkModal
        isOpen={showCreateNetworkModal}
        onClose={() => setShowCreateNetworkModal(false)}
        onSubmit={handleCreateNetwork}
        availableServers={availableServersForNetwork}
        isLoadingServers={loading}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!serverToDelete}
        onClose={() => setServerToDelete(null)}
        onConfirm={handleDeleteServer}
        title={t('servers.delete_dialog.title')}
        message={t('servers.delete_dialog.message', { name: serverToDelete?.name ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        variant="danger"
        loading={deleting}
      />

      {/* Manage Network Servers Modal */}
      {managingNetwork && (
        <ManageNetworkServersModal
          isOpen={!!managingNetwork}
          onClose={() => setManagingNetwork(null)}
          network={managingNetwork}
          ungroupedServers={ungroupedServers}
          onAddServer={handleAddServerToNetwork}
          onRemoveServer={handleRemoveServerFromNetwork}
          isLoading={addServerToNetworkMutation.isPending || removeServerFromNetworkMutation.isPending}
        />
      )}
    </div>
  );
};
