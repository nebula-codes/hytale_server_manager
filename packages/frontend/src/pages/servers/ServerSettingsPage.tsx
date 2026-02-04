import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Input } from '../../components/ui';
import { ArrowLeft, Save, RotateCw, HardDrive, FolderOpen, Server, Plus, X, FileX } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../stores/toastStore';

type SettingsTab = 'general' | 'storage' | 'network' | 'advanced';

interface ServerData {
  id: string;
  name: string;
  address: string;
  port: number;
  version: string;
  maxPlayers: number;
  gameMode: string;
  status: string;
  serverPath: string;
  backupPath: string | null;
  backupType: string;
  backupExclusions: string | null;
  jvmArgs: string | null;
  serverArgs: string | null;
  adapterConfig: string | null;
  adapterType: string;
}

interface GeneralSettings {
  name: string;
  version: string;
  maxPlayers: number;
  gameMode: string;
}

interface NetworkSettings {
  address: string;
  port: number;
}

interface StorageSettings {
  serverPath: string;
  backupType: 'local' | 'ftp';
  backupPath: string;
  backupExclusions: string[];
}

interface AdvancedSettings {
  jvmArgs: string;
  serverArgs: string;
  jarFile: string;
  assetsPath: string;
  javaPath: string;
  minMemory: string;
  maxMemory: string;
  cpuCores: string;
  // JVM optimization flags
  useContainerSupport: boolean;
  useG1GC: boolean;
  maxGcPauseMillis: string;
  parallelGCThreads: string;
  concGCThreads: string;
  aotCache: string;
}

interface FtpStatus {
  enabled: boolean;
  connected: boolean;
  message: string;
}

export const ServerSettingsPage = () => {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [hasChanges, setHasChanges] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Server data from API
  const [server, setServer] = useState<ServerData | null>(null);

  // General settings state
  const [generalSettings, setGeneralSettings] = useState<GeneralSettings>({
    name: '',
    version: '',
    maxPlayers: 20,
    gameMode: 'exploration',
  });

  // Network settings state
  const [networkSettings, setNetworkSettings] = useState<NetworkSettings>({
    address: '0.0.0.0',
    port: 5520,
  });

  // Storage settings state
  const [storageSettings, setStorageSettings] = useState<StorageSettings>({
    serverPath: '',
    backupType: 'local',
    backupPath: '',
    backupExclusions: [],
  });
  const [newExclusion, setNewExclusion] = useState('');
  const [ftpStatus, setFtpStatus] = useState<FtpStatus | null>(null);
  const [storageSaving, setStorageSaving] = useState(false);

  // Advanced settings state
  const [advancedSettings, setAdvancedSettings] = useState<AdvancedSettings>({
    jvmArgs: '-Xms1G -Xmx2G -XX:AOTCache=HytaleServer.aot',
    serverArgs: '',
    jarFile: 'Server/HytaleServer.jar',
    assetsPath: '../Assets.zip',
    javaPath: 'java',
    minMemory: '1',
    maxMemory: '2',
    cpuCores: '',
    useContainerSupport: false,
    useG1GC: false,
    maxGcPauseMillis: '200',
    parallelGCThreads: '',
    concGCThreads: '',
    aotCache: 'HytaleServer.aot',
  });
  const updatingFromRef = useRef<'fields' | 'jvmArgs' | null>(null);

  // Build JVM args from memory and CPU settings
  const buildJvmArgs = (settings: AdvancedSettings): string => {
    const args: string[] = [];

    // Memory args
    if (settings.minMemory) args.push(`-Xms${settings.minMemory}G`);
    if (settings.maxMemory) args.push(`-Xmx${settings.maxMemory}G`);

    // Container support
    if (settings.useContainerSupport) {
      args.push('-XX:+UseContainerSupport');
    }

    // CPU core limit
    const cores = settings.cpuCores ? parseInt(settings.cpuCores) : 0;
    if (cores > 0) {
      args.push(`-XX:ActiveProcessorCount=${cores}`);
    }

    // GC thread settings
    if (settings.parallelGCThreads) {
      args.push(`-XX:ParallelGCThreads=${settings.parallelGCThreads}`);
    }
    if (settings.concGCThreads) {
      args.push(`-XX:ConcGCThreads=${settings.concGCThreads}`);
    }

    // G1 Garbage Collector
    if (settings.useG1GC) {
      args.push('-XX:+UseG1GC');
    }

    // Max GC pause time
    if (settings.maxGcPauseMillis) {
      args.push(`-XX:MaxGCPauseMillis=${settings.maxGcPauseMillis}`);
    }

    // AOT cache for Hytale
    if (settings.aotCache) {
      args.push(`-XX:AOTCache=${settings.aotCache}`);
    }

    return args.join(' ');
  };

  // Parse JVM args to extract memory and CPU settings
  const parseJvmArgs = (jvmArgs: string): Partial<AdvancedSettings> => {
    const result: Partial<AdvancedSettings> = {
      minMemory: '1',
      maxMemory: '2',
      cpuCores: '',
      useContainerSupport: false,
      useG1GC: false,
      maxGcPauseMillis: '200',
      parallelGCThreads: '',
      concGCThreads: '',
      aotCache: 'HytaleServer.aot',
    };

    // Extract -Xms (min memory)
    const xmsMatch = jvmArgs.match(/-Xms(\d+(?:\.\d+)?)(G|M)?/i);
    if (xmsMatch) {
      const value = parseFloat(xmsMatch[1]);
      const unit = xmsMatch[2]?.toUpperCase();
      result.minMemory = unit === 'M' ? (value / 1024).toFixed(1) : value.toString();
    }

    // Extract -Xmx (max memory)
    const xmxMatch = jvmArgs.match(/-Xmx(\d+(?:\.\d+)?)(G|M)?/i);
    if (xmxMatch) {
      const value = parseFloat(xmxMatch[1]);
      const unit = xmxMatch[2]?.toUpperCase();
      result.maxMemory = unit === 'M' ? (value / 1024).toFixed(1) : value.toString();
    }

    // Extract CPU cores from -XX:ActiveProcessorCount
    const cpuMatch = jvmArgs.match(/-XX:ActiveProcessorCount=(\d+)/i);
    if (cpuMatch) {
      result.cpuCores = cpuMatch[1];
    }

    // Extract UseContainerSupport
    result.useContainerSupport = /-XX:\+UseContainerSupport/i.test(jvmArgs);

    // Extract ParallelGCThreads
    const parallelMatch = jvmArgs.match(/-XX:ParallelGCThreads=(\d+)/i);
    if (parallelMatch) {
      result.parallelGCThreads = parallelMatch[1];
    }

    // Extract ConcGCThreads
    const concMatch = jvmArgs.match(/-XX:ConcGCThreads=(\d+)/i);
    if (concMatch) {
      result.concGCThreads = concMatch[1];
    }

    // Extract UseG1GC
    result.useG1GC = /-XX:\+UseG1GC/i.test(jvmArgs);

    // Extract MaxGCPauseMillis
    const pauseMatch = jvmArgs.match(/-XX:MaxGCPauseMillis=(\d+)/i);
    if (pauseMatch) {
      result.maxGcPauseMillis = pauseMatch[1];
    }

    // Extract AOTCache
    const aotMatch = jvmArgs.match(/-XX:AOTCache=([^\s]+)/i);
    if (aotMatch) {
      result.aotCache = aotMatch[1];
    }

    return result;
  };

  // Auto-update JVM args when memory or CPU settings change
  useEffect(() => {
    if (updatingFromRef.current === 'jvmArgs') {
      updatingFromRef.current = null;
      return;
    }

    const newJvmArgs = buildJvmArgs(advancedSettings);

    if (advancedSettings.jvmArgs !== newJvmArgs) {
      updatingFromRef.current = 'fields';
      setAdvancedSettings(prev => ({ ...prev, jvmArgs: newJvmArgs }));
      setHasChanges(true);
    }
  }, [
    advancedSettings.minMemory,
    advancedSettings.maxMemory,
    advancedSettings.cpuCores,
    advancedSettings.useContainerSupport,
    advancedSettings.useG1GC,
    advancedSettings.maxGcPauseMillis,
    advancedSettings.parallelGCThreads,
    advancedSettings.concGCThreads,
    advancedSettings.aotCache,
  ]);

  // Auto-update fields when JVM args change
  useEffect(() => {
    if (updatingFromRef.current === 'fields') {
      updatingFromRef.current = null;
      return;
    }

    if (advancedSettings.jvmArgs) {
      const parsed = parseJvmArgs(advancedSettings.jvmArgs);

      // Check if any field has changed
      const hasChanges = Object.keys(parsed).some(
        key => parsed[key as keyof typeof parsed] !== advancedSettings[key as keyof AdvancedSettings]
      );

      if (hasChanges) {
        updatingFromRef.current = 'jvmArgs';
        setAdvancedSettings(prev => ({
          ...prev,
          ...parsed,
        }));
        setHasChanges(true);
      }
    }
  }, [advancedSettings.jvmArgs]);

  // Load server data
  useEffect(() => {
    if (!id) return;
    loadServer();
    loadFtpStatus();
  }, [id]);

  const loadServer = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const serverData = await api.getServer<ServerData>(id);
      setServer(serverData);

      // Populate general settings
      setGeneralSettings({
        name: serverData.name || '',
        version: serverData.version || '',
        maxPlayers: serverData.maxPlayers || 20,
        gameMode: serverData.gameMode || 'exploration',
      });

      // Populate network settings
      setNetworkSettings({
        address: serverData.address || '0.0.0.0',
        port: serverData.port || 5520,
      });

      // Parse backup exclusions from JSON
      let exclusions: string[] = [];
      if (serverData.backupExclusions) {
        try {
          exclusions = JSON.parse(serverData.backupExclusions);
        } catch (e) {
          console.error('Failed to parse backup exclusions:', e);
        }
      }

      // Populate storage settings
      setStorageSettings({
        serverPath: serverData.serverPath || '',
        backupType: (serverData.backupType as 'local' | 'ftp') || 'local',
        backupPath: serverData.backupPath || '',
        backupExclusions: exclusions,
      });

      // Parse adapter config
      let adapterConfig: {
        jarFile?: string;
        assetsPath?: string;
        javaPath?: string;
        minMemory?: string;
        maxMemory?: string;
        cpuCores?: number;
      } = {};
      if (serverData.adapterConfig) {
        try {
          adapterConfig = JSON.parse(serverData.adapterConfig);
        } catch (e) {
          console.error('Failed to parse adapter config:', e);
        }
      }

      // Populate advanced settings
      setAdvancedSettings({
        jvmArgs: serverData.jvmArgs || '-Xms1G -Xmx2G -XX:AOTCache=HytaleServer.aot',
        serverArgs: serverData.serverArgs || '',
        jarFile: adapterConfig.jarFile || 'Server/HytaleServer.jar',
        assetsPath: adapterConfig.assetsPath || '../Assets.zip',
        javaPath: adapterConfig.javaPath || 'java',
        minMemory: adapterConfig.minMemory ? adapterConfig.minMemory.replace(/G$/i, '') : '1',
        maxMemory: adapterConfig.maxMemory ? adapterConfig.maxMemory.replace(/G$/i, '') : '2',
        cpuCores: adapterConfig.cpuCores ? String(adapterConfig.cpuCores) : '',
        useContainerSupport: false,
        useG1GC: false,
        maxGcPauseMillis: '200',
        parallelGCThreads: '',
        concGCThreads: '',
        aotCache: 'HytaleServer.aot',
      });
      updatingFromRef.current = null;
    } catch (err: any) {
      console.error('Failed to load server:', err);
      setError(err.message || 'Failed to load server');
    } finally {
      setLoading(false);
    }
  };

  const loadFtpStatus = async () => {
    try {
      const status = await api.get<FtpStatus>('/settings/ftp/status');
      setFtpStatus(status);
    } catch (err) {
      console.error('Failed to load FTP status:', err);
    }
  };

  const handleStorageSave = async () => {
    if (!id) return;
    setStorageSaving(true);
    try {
      await api.updateServer(id, {
        serverPath: storageSettings.serverPath || undefined,
        backupPath: storageSettings.backupPath || null,
        backupType: storageSettings.backupType,
        backupExclusions: storageSettings.backupExclusions.length > 0 ? storageSettings.backupExclusions : null,
      });
      toast.success('Storage settings saved', 'Server storage configuration updated successfully');
      setHasChanges(false);
    } catch (err: any) {
      toast.error('Failed to save storage settings', err.message);
    } finally {
      setStorageSaving(false);
    }
  };

  const handleAddExclusion = () => {
    const trimmed = newExclusion.trim();
    if (!trimmed) return;
    if (storageSettings.backupExclusions.includes(trimmed)) {
      toast.error('Duplicate pattern', 'This exclusion pattern already exists');
      return;
    }
    setStorageSettings(prev => ({
      ...prev,
      backupExclusions: [...prev.backupExclusions, trimmed],
    }));
    setNewExclusion('');
    setHasChanges(true);
  };

  const handleRemoveExclusion = (pattern: string) => {
    setStorageSettings(prev => ({
      ...prev,
      backupExclusions: prev.backupExclusions.filter(p => p !== pattern),
    }));
    setHasChanges(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <h2 className="text-2xl font-heading font-bold text-text-light-primary dark:text-text-primary">Loading...</h2>
        </div>
      </div>
    );
  }

  if (error || !server) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <h2 className="text-2xl font-heading font-bold text-text-light-primary dark:text-text-primary">
            {error || 'Server Not Found'}
          </h2>
          <Link to="/servers" className="text-accent-primary hover:underline mt-4 inline-block">
            ← Back to Servers
          </Link>
        </div>
      </div>
    );
  }

  const tabs: { id: SettingsTab; label: string; description: string }[] = [
    { id: 'general', label: 'General', description: 'Basic server settings' },
    { id: 'storage', label: 'Storage', description: 'Server directories and backup location' },
    { id: 'network', label: 'Network', description: 'Network and connection settings' },
    { id: 'advanced', label: 'Advanced', description: 'JVM and advanced configuration' },
  ];

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      let updateData: Record<string, unknown> = {};

      if (activeTab === 'general') {
        updateData = {
          name: generalSettings.name,
          version: generalSettings.version,
          maxPlayers: generalSettings.maxPlayers,
          gameMode: generalSettings.gameMode,
        };
      } else if (activeTab === 'network') {
        updateData = {
          address: networkSettings.address,
          port: networkSettings.port,
        };
      } else if (activeTab === 'storage') {
        // Storage has its own save handler
        await handleStorageSave();
        return;
      } else if (activeTab === 'advanced') {
        updateData = {
          jvmArgs: advancedSettings.jvmArgs,
          serverArgs: advancedSettings.serverArgs,
          adapterConfig: {
            jarFile: advancedSettings.jarFile,
            assetsPath: advancedSettings.assetsPath,
            javaPath: advancedSettings.javaPath,
            minMemory: advancedSettings.minMemory ? `${advancedSettings.minMemory}G` : undefined,
            maxMemory: advancedSettings.maxMemory ? `${advancedSettings.maxMemory}G` : undefined,
            cpuCores: advancedSettings.cpuCores ? parseInt(advancedSettings.cpuCores) : undefined,
          },
        };
      }

      await api.updateServer(id, updateData);

      // Update the server state with new values
      if (server) {
        setServer({ ...server, ...updateData } as ServerData);
      }

      toast.success('Settings saved', 'Server configuration updated successfully');
      setHasChanges(false);
    } catch (err: any) {
      toast.error('Failed to save settings', err.message || 'An error occurred');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (!server) return;

    // Reset to the original server values
    setGeneralSettings({
      name: server.name || '',
      version: server.version || '',
      maxPlayers: server.maxPlayers || 20,
      gameMode: server.gameMode || 'exploration',
    });

    setNetworkSettings({
      address: server.address || '0.0.0.0',
      port: server.port || 5520,
    });

    // Parse backup exclusions from JSON
    let exclusions: string[] = [];
    if (server.backupExclusions) {
      try {
        exclusions = JSON.parse(server.backupExclusions);
      } catch (e) {
        console.error('Failed to parse backup exclusions:', e);
      }
    }

    setStorageSettings({
      serverPath: server.serverPath || '',
      backupType: (server.backupType as 'local' | 'ftp') || 'local',
      backupPath: server.backupPath || '',
      backupExclusions: exclusions,
    });

    // Parse adapter config for reset
    let adapterConfig: {
      jarFile?: string;
      assetsPath?: string;
      javaPath?: string;
      minMemory?: string;
      maxMemory?: string;
      cpuCores?: number;
    } = {};
    if (server.adapterConfig) {
      try {
        adapterConfig = JSON.parse(server.adapterConfig);
      } catch (e) {
        console.error('Failed to parse adapter config:', e);
      }
    }

    setAdvancedSettings({
      jvmArgs: server.jvmArgs || '-Xms1G -Xmx2G -XX:AOTCache=HytaleServer.aot',
      serverArgs: server.serverArgs || '',
      jarFile: adapterConfig.jarFile || 'Server/HytaleServer.jar',
      assetsPath: adapterConfig.assetsPath || '../Assets.zip',
      javaPath: adapterConfig.javaPath || 'java',
      minMemory: adapterConfig.minMemory ? adapterConfig.minMemory.replace(/G$/i, '') : '1',
      maxMemory: adapterConfig.maxMemory ? adapterConfig.maxMemory.replace(/G$/i, '') : '2',
      cpuCores: adapterConfig.cpuCores ? String(adapterConfig.cpuCores) : '',
      useContainerSupport: false,
      useG1GC: false,
      maxGcPauseMillis: '200',
      parallelGCThreads: '',
      concGCThreads: '',
      aotCache: 'HytaleServer.aot',
    });
    updatingFromRef.current = null;

    setHasChanges(false);
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 sm:gap-4">
          <Link to={`/servers/${id}`}>
            <Button variant="ghost" icon={<ArrowLeft size={18} />}>
              <span className="hidden sm:inline">Back to Server</span>
            </Button>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl sm:text-3xl font-heading font-bold text-text-light-primary dark:text-text-primary">Server Settings</h1>
            <p className="text-sm sm:text-base text-text-light-muted dark:text-text-muted mt-1 truncate">{server.name}</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          {hasChanges && (
            <Button variant="ghost" icon={<RotateCw size={18} />} onClick={handleReset} disabled={saving} className="w-full sm:w-auto">
              Reset
            </Button>
          )}
          <Button variant="primary" icon={<Save size={18} />} onClick={handleSave} disabled={saving || !hasChanges} className="w-full sm:w-auto">
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {/* Settings Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 sm:py-2 rounded-lg whitespace-nowrap transition-colors text-sm sm:text-base ${
              activeTab === tab.id
                ? 'bg-accent-primary text-white'
                : 'bg-white dark:bg-gray-100 dark:bg-primary-bg-secondary text-text-light-muted dark:text-text-muted hover:bg-gray-200 dark:bg-gray-800 hover:text-text-light-primary dark:text-text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* General Settings */}
      {activeTab === 'general' && (
        <Card variant="glass">
          <CardHeader>
            <CardTitle>General Settings</CardTitle>
            <CardDescription>Configure basic server information and behavior</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">Server Name</label>
                <Input
                  value={generalSettings.name}
                  onChange={(e) => {
                    setGeneralSettings(prev => ({ ...prev, name: e.target.value }));
                    setHasChanges(true);
                  }}
                  placeholder="My Hytale Server"
                />
              </div>

              <div>
                <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">Server Version</label>
                <Input
                  value={generalSettings.version}
                  onChange={(e) => {
                    setGeneralSettings(prev => ({ ...prev, version: e.target.value }));
                    setHasChanges(true);
                  }}
                  placeholder="e.g., 2025.01.15"
                />
                <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                  The game server version (updated automatically when using the Update feature)
                </p>
              </div>

              <div>
                <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">Max Players</label>
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  value={generalSettings.maxPlayers}
                  onChange={(e) => {
                    setGeneralSettings(prev => ({ ...prev, maxPlayers: parseInt(e.target.value) || 20 }));
                    setHasChanges(true);
                  }}
                />
              </div>

              <div>
                <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">Game Mode</label>
                <select
                  value={generalSettings.gameMode}
                  onChange={(e) => {
                    setGeneralSettings(prev => ({ ...prev, gameMode: e.target.value }));
                    setHasChanges(true);
                  }}
                  className="w-full bg-white dark:bg-primary-bg border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-text-light-primary dark:text-text-primary focus:outline-none focus:border-accent-primary"
                >
                  <option value="exploration">Exploration</option>
                  <option value="creative">Creative</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Storage Settings */}
      {activeTab === 'storage' && (
        <Card variant="glass">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <HardDrive size={20} />
                  Storage Settings
                </CardTitle>
                <CardDescription>Configure server directories and backup storage location</CardDescription>
              </div>
              {ftpStatus && storageSettings.backupType === 'ftp' && (
                <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm ${
                  ftpStatus.connected
                    ? 'bg-green-500/10 text-green-500'
                    : 'bg-yellow-500/10 text-yellow-500'
                }`}>
                  <div className={`w-2 h-2 rounded-full ${
                    ftpStatus.connected ? 'bg-green-500' : 'bg-yellow-500'
                  }`} />
                  {ftpStatus.connected ? 'FTP Connected' : 'FTP Disconnected'}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* Server Directory */}
                <div>
                  <label className="block text-sm font-medium text-text-light-muted dark:text-text-muted mb-2">
                    <FolderOpen size={16} className="inline mr-2" />
                    Server Directory
                  </label>
                  <Input
                    value={storageSettings.serverPath}
                    onChange={(e) => {
                      setStorageSettings(prev => ({ ...prev, serverPath: e.target.value }));
                      setHasChanges(true);
                    }}
                    placeholder="/path/to/server"
                  />
                  <p className="text-xs text-text-secondary mt-1">
                    The directory where server files are stored
                  </p>
                </div>

                {/* Backup Storage Type */}
                <div>
                  <label className="block text-sm font-medium text-text-light-muted dark:text-text-muted mb-2">
                    <Server size={16} className="inline mr-2" />
                    Backup Storage Type
                  </label>
                  <select
                    value={storageSettings.backupType}
                    onChange={(e) => {
                      setStorageSettings(prev => ({
                        ...prev,
                        backupType: e.target.value as 'local' | 'ftp',
                        backupPath: '', // Reset path when changing type
                      }));
                      setHasChanges(true);
                    }}
                    className="w-full bg-white dark:bg-primary-bg border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-text-light-primary dark:text-text-primary focus:outline-none focus:border-accent-primary"
                  >
                    <option value="local">Local Directory</option>
                    <option value="ftp" disabled={!ftpStatus?.enabled}>
                      FTP Server {!ftpStatus?.enabled && '(Not Configured)'}
                    </option>
                  </select>
                </div>

                {/* Backup Path */}
                <div>
                  <label className="block text-sm font-medium text-text-light-muted dark:text-text-muted mb-2">
                    {storageSettings.backupType === 'ftp' ? 'FTP Remote Path' : 'Local Backup Directory'}
                  </label>
                  <Input
                    value={storageSettings.backupPath}
                    onChange={(e) => {
                      setStorageSettings(prev => ({ ...prev, backupPath: e.target.value }));
                      setHasChanges(true);
                    }}
                    placeholder={
                      storageSettings.backupType === 'ftp'
                        ? '/backups/my-server/'
                        : '/path/to/backups'
                    }
                  />
                  <p className="text-xs text-text-secondary mt-1">
                    {storageSettings.backupType === 'ftp'
                      ? 'Path on the FTP server where backups will be stored. Leave empty to use default.'
                      : 'Local directory for storing backups. Leave empty to use default location.'}
                  </p>
                </div>

                {/* Backup Exclusions */}
                <div>
                  <label className="block text-sm font-medium text-text-light-muted dark:text-text-muted mb-2">
                    <FileX size={16} className="inline mr-2" />
                    Backup Exclusions
                  </label>
                  <p className="text-xs text-text-secondary mb-3">
                    Files and folders matching these patterns will be excluded from backups. Examples:
                    <code className="bg-gray-200 dark:bg-gray-800 px-1 mx-1 rounded">*.log</code> (all .log files),
                    <code className="bg-gray-200 dark:bg-gray-800 px-1 mx-1 rounded">logs/*</code> (logs folder contents),
                    <code className="bg-gray-200 dark:bg-gray-800 px-1 mx-1 rounded">*.log.gz</code> (compressed logs)
                  </p>

                  {/* Add new exclusion */}
                  <div className="flex gap-2 mb-3">
                    <Input
                      value={newExclusion}
                      onChange={(e) => setNewExclusion(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddExclusion();
                        }
                      }}
                      placeholder="e.g., *.log, logs/*, crash-reports/**"
                      className="flex-1"
                    />
                    <Button
                      variant="secondary"
                      icon={<Plus size={16} />}
                      onClick={handleAddExclusion}
                      disabled={!newExclusion.trim()}
                    >
                      Add
                    </Button>
                  </div>

                  {/* Exclusion list */}
                  {storageSettings.backupExclusions.length > 0 ? (
                    <div className="space-y-2">
                      {storageSettings.backupExclusions.map((pattern) => (
                        <div
                          key={pattern}
                          className="flex items-center justify-between bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2"
                        >
                          <code className="text-sm text-text-light-primary dark:text-text-primary font-mono">
                            {pattern}
                          </code>
                          <button
                            onClick={() => handleRemoveExclusion(pattern)}
                            className="text-gray-500 hover:text-danger transition-colors p-1"
                            title="Remove exclusion"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-4 text-text-light-muted dark:text-text-muted text-sm border border-dashed border-gray-300 dark:border-gray-700 rounded-lg">
                      No exclusions configured. All files will be included in backups.
                    </div>
                  )}
                </div>

                {/* FTP Warning */}
                {storageSettings.backupType === 'ftp' && (
                  <div className="bg-blue-500/10 text-blue-400 p-3 rounded text-sm">
                    <strong>Note:</strong> When using FTP storage, backups will be uploaded to the FTP server
                    and deleted from local storage after successful upload. Make sure your FTP server has
                    sufficient storage space.
                  </div>
                )}

                {/* Save Button */}
                <div className="flex gap-3 pt-4 border-t">
                  <Button
                    variant="primary"
                    icon={<Save size={18} />}
                    onClick={handleStorageSave}
                    disabled={storageSaving}
                  >
                    {storageSaving ? 'Saving...' : 'Save Storage Settings'}
                  </Button>
                </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Network Settings */}
      {activeTab === 'network' && (
        <Card variant="glass">
          <CardHeader>
            <CardTitle>Network Settings</CardTitle>
            <CardDescription>Configure network address and port settings</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">Server IP / Address</label>
                <Input
                  value={networkSettings.address}
                  onChange={(e) => {
                    setNetworkSettings(prev => ({ ...prev, address: e.target.value }));
                    setHasChanges(true);
                  }}
                  placeholder="0.0.0.0"
                />
                <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                  The IP address the server will bind to. Use 0.0.0.0 to listen on all interfaces.
                </p>
              </div>

              <div>
                <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">Server Port</label>
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  value={networkSettings.port}
                  onChange={(e) => {
                    setNetworkSettings(prev => ({ ...prev, port: parseInt(e.target.value) || 5520 }));
                    setHasChanges(true);
                  }}
                />
                <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                  The port the server will listen on (default: 5520).
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Advanced Settings */}
      {activeTab === 'advanced' && (
        <Card variant="glass">
          <CardHeader>
            <CardTitle>Advanced Settings</CardTitle>
            <CardDescription>Java configuration and JVM arguments</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* Java Executable Path */}
              <div>
                <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">Java Executable Path</label>
                <Input
                  value={advancedSettings.javaPath}
                  onChange={(e) => {
                    setAdvancedSettings(prev => ({ ...prev, javaPath: e.target.value }));
                    setHasChanges(true);
                  }}
                  placeholder="java"
                  className="font-mono"
                />
                <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                  Path to the Java executable. Use "java" to use system Java, or specify a full path (e.g., /usr/lib/jvm/java-17/bin/java).
                </p>
              </div>

              {/* Memory Settings */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">Min Memory (GB)</label>
                  <Input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={advancedSettings.minMemory}
                    onChange={(e) => {
                      setAdvancedSettings(prev => ({ ...prev, minMemory: e.target.value }));
                      setHasChanges(true);
                    }}
                    placeholder="1"
                  />
                  <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                    Minimum heap memory allocation (-Xms)
                  </p>
                </div>
                <div>
                  <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">Max Memory (GB)</label>
                  <Input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={advancedSettings.maxMemory}
                    onChange={(e) => {
                      setAdvancedSettings(prev => ({ ...prev, maxMemory: e.target.value }));
                      setHasChanges(true);
                    }}
                    placeholder="2"
                  />
                  <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                    Maximum heap memory allocation (-Xmx)
                  </p>
                </div>
              </div>

              {/* CPU Core Limit */}
              <div>
                <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">CPU Core Limit (Optional)</label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={advancedSettings.cpuCores}
                  onChange={(e) => {
                    setAdvancedSettings(prev => ({ ...prev, cpuCores: e.target.value }));
                    setHasChanges(true);
                  }}
                  placeholder="Leave empty for no limit"
                />
                <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                  Limit JVM to use a specific number of CPU cores via -XX:ActiveProcessorCount. Leave empty to use all available cores.
                </p>
              </div>

              {/* JVM Optimization Flags */}
              <div className="border-t border-gray-300 dark:border-gray-700 pt-6 mt-6">
                <h4 className="text-sm font-medium text-text-light-primary dark:text-text-primary mb-4">JVM Optimization Flags</h4>

                <div className="space-y-4">
                  {/* Container Support */}
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={advancedSettings.useContainerSupport}
                      onChange={(e) => {
                        setAdvancedSettings(prev => ({ ...prev, useContainerSupport: e.target.checked }));
                        setHasChanges(true);
                      }}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <label className="block text-sm text-text-light-primary dark:text-text-primary font-medium">
                        Container Support (-XX:+UseContainerSupport)
                      </label>
                      <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                        Makes the JVM aware it's running in a container. Improves memory and CPU detection for Docker/Kubernetes environments.
                      </p>
                    </div>
                  </div>

                  {/* G1 Garbage Collector */}
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={advancedSettings.useG1GC}
                      onChange={(e) => {
                        setAdvancedSettings(prev => ({ ...prev, useG1GC: e.target.checked }));
                        setHasChanges(true);
                      }}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <label className="block text-sm text-text-light-primary dark:text-text-primary font-medium">
                        G1 Garbage Collector (-XX:+UseG1GC)
                      </label>
                      <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                        Uses the G1GC garbage collector, which provides better performance for large heaps and reduces pause times. Recommended for servers with 4GB+ memory.
                      </p>
                    </div>
                  </div>

                  {/* GC Thread Settings */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">
                        Parallel GC Threads (Optional)
                      </label>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={advancedSettings.parallelGCThreads}
                        onChange={(e) => {
                          setAdvancedSettings(prev => ({ ...prev, parallelGCThreads: e.target.value }));
                          setHasChanges(true);
                        }}
                        placeholder="Auto (CPU cores)"
                      />
                      <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                        Number of threads for parallel garbage collection (-XX:ParallelGCThreads). Leave empty to auto-detect.
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">
                        Concurrent GC Threads (Optional)
                      </label>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={advancedSettings.concGCThreads}
                        onChange={(e) => {
                          setAdvancedSettings(prev => ({ ...prev, concGCThreads: e.target.value }));
                          setHasChanges(true);
                        }}
                        placeholder="Auto (cores/2)"
                      />
                      <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                        Number of concurrent garbage collection threads (-XX:ConcGCThreads). Leave empty to auto-detect.
                      </p>
                    </div>
                  </div>

                  {/* Max GC Pause Time */}
                  <div>
                    <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">
                      Max GC Pause Time (ms)
                    </label>
                    <Input
                      type="number"
                      min="50"
                      step="50"
                      value={advancedSettings.maxGcPauseMillis}
                      onChange={(e) => {
                        setAdvancedSettings(prev => ({ ...prev, maxGcPauseMillis: e.target.value }));
                        setHasChanges(true);
                      }}
                      placeholder="200"
                    />
                    <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                      Target maximum pause time for garbage collection (-XX:MaxGCPauseMillis). Lower values reduce lag spikes but may increase GC frequency.
                    </p>
                  </div>

                  {/* AOT Cache */}
                  <div>
                    <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">
                      AOT Cache File
                    </label>
                    <Input
                      value={advancedSettings.aotCache}
                      onChange={(e) => {
                        setAdvancedSettings(prev => ({ ...prev, aotCache: e.target.value }));
                        setHasChanges(true);
                      }}
                      placeholder="HytaleServer.aot"
                      className="font-mono"
                    />
                    <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                      Ahead-of-Time compilation cache file (-XX:AOTCache). Enables faster startup times if the cache file exists. Hytale-specific optimization.
                    </p>
                  </div>
                </div>
              </div>

              {/* JAR File Name */}
              <div>
                <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">JAR File Path</label>
                <Input
                  value={advancedSettings.jarFile}
                  onChange={(e) => {
                    setAdvancedSettings(prev => ({ ...prev, jarFile: e.target.value }));
                    setHasChanges(true);
                  }}
                  placeholder="Server/HytaleServer.jar"
                  className="font-mono"
                />
                <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                  Path to the server JAR file relative to the server directory.
                </p>
              </div>

              {/* Assets Path */}
              <div>
                <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">Assets Path</label>
                <Input
                  value={advancedSettings.assetsPath}
                  onChange={(e) => {
                    setAdvancedSettings(prev => ({ ...prev, assetsPath: e.target.value }));
                    setHasChanges(true);
                  }}
                  placeholder="../Assets.zip"
                  className="font-mono"
                />
                <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                  Path to the Assets.zip file relative to the JAR file location. Used with --assets argument.
                </p>
              </div>

              {/* JVM Arguments */}
              <div>
                <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">JVM Arguments</label>
                <textarea
                  value={advancedSettings.jvmArgs}
                  onChange={(e) => {
                    setAdvancedSettings(prev => ({ ...prev, jvmArgs: e.target.value }));
                    setHasChanges(true);
                  }}
                  className="w-full bg-white dark:bg-primary-bg border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-text-light-primary dark:text-text-primary focus:outline-none focus:border-accent-primary font-mono text-sm"
                  rows={4}
                  placeholder="-Xms1G -Xmx2G -XX:AOTCache=HytaleServer.aot"
                />
                <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                  JVM arguments passed to the Java process. AOT cache enables faster startup if HytaleServer.aot exists.
                </p>
              </div>

              {/* Server Arguments */}
              <div>
                <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">Server Arguments</label>
                <p className="text-xs text-text-light-muted dark:text-text-muted mb-2">
                  Arguments passed to the server after the jar file (e.g., --accept-early-plugins)
                </p>
                <Input
                  value={advancedSettings.serverArgs}
                  onChange={(e) => {
                    setAdvancedSettings(prev => ({ ...prev, serverArgs: e.target.value }));
                    setHasChanges(true);
                  }}
                  placeholder="--accept-early-plugins --other-arg"
                  className="font-mono"
                />
              </div>

              {/* Command Preview */}
              <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                <label className="block text-sm font-medium text-text-light-muted dark:text-text-muted mb-2">
                  Command Preview
                </label>
                <p className="text-xs text-text-light-muted dark:text-text-muted mb-3">
                  This is how the server start command will look with your current settings:
                </p>
                <div className="font-mono text-xs bg-gray-200 dark:bg-gray-900 rounded p-3 overflow-x-auto">
                  <span className="text-blue-600 dark:text-blue-400">{advancedSettings.javaPath || 'java'}</span>
                  {' '}
                  <span className="text-green-600 dark:text-green-400" title="JVM Arguments">{advancedSettings.jvmArgs || '-Xms1G -Xmx2G -XX:AOTCache=HytaleServer.aot'}</span>
                  {' '}
                  <span className="text-text-light-primary dark:text-text-primary">-jar {advancedSettings.jarFile || 'Server/HytaleServer.jar'}</span>
                  {' '}
                  <span className="text-purple-600 dark:text-purple-400">--assets {advancedSettings.assetsPath || '../Assets.zip'} --bind {networkSettings.address}:{networkSettings.port}</span>
                  {advancedSettings.serverArgs && (
                    <>
                      {' '}
                      <span className="text-orange-600 dark:text-orange-400" title="Server Arguments">{advancedSettings.serverArgs}</span>
                    </>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs">
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded bg-green-600 dark:bg-green-400"></span>
                    <span className="text-text-light-muted dark:text-text-muted">JVM Arguments</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded bg-purple-600 dark:bg-purple-400"></span>
                    <span className="text-text-light-muted dark:text-text-muted">Default Server Args</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded bg-orange-600 dark:bg-orange-400"></span>
                    <span className="text-text-light-muted dark:text-text-muted">Custom Server Args</span>
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
