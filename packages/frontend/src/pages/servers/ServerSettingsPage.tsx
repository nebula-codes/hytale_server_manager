import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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

      // Parse JVM args to get optimization flags
      const jvmArgs = serverData.jvmArgs || '-Xms1G -Xmx2G -XX:AOTCache=HytaleServer.aot';
      const parsedJvmSettings = parseJvmArgs(jvmArgs);

      // Populate advanced settings
      setAdvancedSettings({
        jvmArgs,
        serverArgs: serverData.serverArgs || '',
        jarFile: adapterConfig.jarFile || 'Server/HytaleServer.jar',
        assetsPath: adapterConfig.assetsPath || '../Assets.zip',
        javaPath: adapterConfig.javaPath || 'java',
        minMemory: parsedJvmSettings.minMemory || (adapterConfig.minMemory ? adapterConfig.minMemory.replace(/G$/i, '') : '1'),
        maxMemory: parsedJvmSettings.maxMemory || (adapterConfig.maxMemory ? adapterConfig.maxMemory.replace(/G$/i, '') : '2'),
        cpuCores: parsedJvmSettings.cpuCores || (adapterConfig.cpuCores ? String(adapterConfig.cpuCores) : ''),
        useContainerSupport: parsedJvmSettings.useContainerSupport || false,
        useG1GC: parsedJvmSettings.useG1GC || false,
        maxGcPauseMillis: parsedJvmSettings.maxGcPauseMillis || '200',
        parallelGCThreads: parsedJvmSettings.parallelGCThreads || '',
        concGCThreads: parsedJvmSettings.concGCThreads || '',
        aotCache: parsedJvmSettings.aotCache || 'HytaleServer.aot',
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
      toast.success(t('servers.settings.storage.toast.saved.title'), t('servers.settings.storage.toast.saved.description'));
      setHasChanges(false);
    } catch (err: any) {
      toast.error(t('servers.settings.storage.toast.error.title'), err.message);
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

  const tabs: { id: SettingsTab; label: string; description: string }[] = [
    { id: 'general', label: t('servers.settings.tabs.general'), description: t('servers.settings.tabs.general_desc') },
    { id: 'storage', label: t('servers.settings.tabs.storage'), description: t('servers.settings.tabs.storage_desc') },
    { id: 'network', label: t('servers.settings.tabs.network'), description: t('servers.settings.tabs.network_desc') },
    { id: 'advanced', label: t('servers.settings.tabs.advanced'), description: t('servers.settings.tabs.advanced_desc') },
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

      toast.success(t('servers.settings.toast.saved.title'), t('servers.settings.toast.saved.description'));
      setHasChanges(false);
    } catch (err: any) {
      toast.error(t('servers.settings.toast.error.title'), err.message || t('servers.settings.toast.error.fallback'));
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
              <span className="hidden sm:inline">{t('servers.settings.back')}</span>
            </Button>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl sm:text-3xl font-heading font-bold text-text-light-primary dark:text-text-primary">
              {t('servers.settings.title')}
            </h1>
            <p className="text-sm sm:text-base text-text-light-muted dark:text-text-muted mt-1 truncate">{server.name}</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          {hasChanges && (
            <Button variant="ghost" icon={<RotateCw size={18} />} onClick={handleReset} disabled={saving} className="w-full sm:w-auto">
              {t('servers.settings.reset')}
            </Button>
          )}
          <Button variant="primary" icon={<Save size={18} />} onClick={handleSave} disabled={saving || !hasChanges} className="w-full sm:w-auto">
            {saving ? t('common.saving') : t('common.save_changes')}
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
            <CardTitle>{t('servers.settings.general.title')}</CardTitle>
            <CardDescription>{t('servers.settings.general.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">
                  {t('servers.settings.general.name')}
                </label>
                <Input
                  value={generalSettings.name}
                  onChange={(e) => {
                    setGeneralSettings(prev => ({ ...prev, name: e.target.value }));
                    setHasChanges(true);
                  }}
                  placeholder={t('servers.settings.general.name_placeholder')}
                />
              </div>

              <div>
                <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">
                  {t('servers.settings.general.version')}
                </label>
                <Input
                  value={generalSettings.version}
                  onChange={(e) => {
                    setGeneralSettings(prev => ({ ...prev, version: e.target.value }));
                    setHasChanges(true);
                  }}
                  placeholder={t('servers.settings.general.version_placeholder')}
                />
                <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                  {t('servers.settings.general.version_helper')}
                </p>
              </div>

              <div>
                <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">
                  {t('servers.settings.general.max_players')}
                </label>
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
                <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">
                  {t('servers.settings.general.game_mode')}
                </label>
                <select
                  value={generalSettings.gameMode}
                  onChange={(e) => {
                    setGeneralSettings(prev => ({ ...prev, gameMode: e.target.value }));
                    setHasChanges(true);
                  }}
                  className="w-full bg-white dark:bg-primary-bg border border-gray-300 dark:border-gray-700 rounded-lg px-3 py-2 text-text-light-primary dark:text-text-primary focus:outline-none focus:border-accent-primary"
                >
                  <option value="exploration">{t('servers.settings.general.modes.exploration')}</option>
                  <option value="creative">{t('servers.settings.general.modes.creative')}</option>
                  <option value="custom">{t('servers.settings.general.modes.custom')}</option>
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
                  {t('servers.settings.storage.title')}
                </CardTitle>
                <CardDescription>{t('servers.settings.storage.subtitle')}</CardDescription>
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
                  {ftpStatus.connected ? t('servers.settings.storage.ftp.connected') : t('servers.settings.storage.ftp.disconnected')}
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
                    {t('servers.settings.storage.server_dir')}
                  </label>
                  <Input
                    value={storageSettings.serverPath}
                    onChange={(e) => {
                      setStorageSettings(prev => ({ ...prev, serverPath: e.target.value }));
                      setHasChanges(true);
                    }}
                    placeholder={t('servers.settings.storage.server_dir_placeholder')}
                  />
                  <p className="text-xs text-text-secondary mt-1">
                    {t('servers.settings.storage.server_dir_helper')}
                  </p>
                </div>

                {/* Backup Storage Type */}
                <div>
                  <label className="block text-sm font-medium text-text-light-muted dark:text-text-muted mb-2">
                    <Server size={16} className="inline mr-2" />
                    {t('servers.settings.storage.type')}
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
                    <option value="local">{t('servers.settings.storage.type_local')}</option>
                    <option value="ftp" disabled={!ftpStatus?.enabled}>
                      {t('servers.settings.storage.type_ftp')} {!ftpStatus?.enabled && `(${t('servers.settings.storage.ftp.not_configured')})`}
                    </option>
                  </select>
                </div>

                {/* Backup Path */}
                <div>
                  <label className="block text-sm font-medium text-text-light-muted dark:text-text-muted mb-2">
                    {storageSettings.backupType === 'ftp'
                      ? t('servers.settings.storage.backup_path_ftp')
                      : t('servers.settings.storage.backup_path_local')}
                  </label>
                  <Input
                    value={storageSettings.backupPath}
                    onChange={(e) => {
                      setStorageSettings(prev => ({ ...prev, backupPath: e.target.value }));
                      setHasChanges(true);
                    }}
                    placeholder={
                      storageSettings.backupType === 'ftp'
                        ? t('servers.settings.storage.backup_path_ftp_placeholder')
                        : t('servers.settings.storage.backup_path_local_placeholder')
                    }
                  />
                  <p className="text-xs text-text-secondary mt-1">
                    {storageSettings.backupType === 'ftp'
                      ? t('servers.settings.storage.backup_path_ftp_helper')
                      : t('servers.settings.storage.backup_path_local_helper')}
                  </p>
                </div>

                {/* Backup Exclusions */}
                <div>
                  <label className="block text-sm font-medium text-text-light-muted dark:text-text-muted mb-2">
                    <FileX size={16} className="inline mr-2" />
                    {t('servers.settings.storage.exclusions')}
                  </label>
                  <p className="text-xs text-text-secondary mb-3">
                    {t('servers.settings.storage.exclusions_helper')}
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
                      placeholder={t('servers.settings.storage.exclusions_placeholder')}
                      className="flex-1"
                    />
                    <Button
                      variant="secondary"
                      icon={<Plus size={16} />}
                      onClick={handleAddExclusion}
                      disabled={!newExclusion.trim()}
                    >
                      {t('servers.settings.storage.exclusions_add')}
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
                            title={t('servers.settings.storage.exclusions_remove')}
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-4 text-text-light-muted dark:text-text-muted text-sm border border-dashed border-gray-300 dark:border-gray-700 rounded-lg">
                      {t('servers.settings.storage.exclusions_empty')}
                    </div>
                  )}
                </div>

                {/* FTP Warning */}
                {storageSettings.backupType === 'ftp' && (
                  <div className="bg-blue-500/10 text-blue-400 p-3 rounded text-sm">
                    <strong>{t('servers.settings.storage.ftp.note_label')}</strong> {t('servers.settings.storage.ftp.note')}
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
                    {storageSaving ? t('common.saving') : t('servers.settings.storage.save')}
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
            <CardTitle>{t('servers.settings.network.title')}</CardTitle>
            <CardDescription>{t('servers.settings.network.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">
                  {t('servers.settings.network.address')}
                </label>
                <Input
                  value={networkSettings.address}
                  onChange={(e) => {
                    setNetworkSettings(prev => ({ ...prev, address: e.target.value }));
                    setHasChanges(true);
                  }}
                  placeholder="0.0.0.0"
                />
                <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                  {t('servers.settings.network.address_helper')}
                </p>
              </div>

              <div>
                <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">
                  {t('servers.settings.network.port')}
                </label>
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
                  {t('servers.settings.network.port_helper')}
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
            <CardTitle>{t('servers.settings.advanced.title')}</CardTitle>
            <CardDescription>{t('servers.settings.advanced.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* Java Executable Path */}
              <div>
                <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">
                  {t('servers.settings.advanced.java_path')}
                </label>
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
                  {t('servers.settings.advanced.java_path_helper')}
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
                <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">
                  {t('servers.settings.advanced.jar_path')}
                </label>
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
                  {t('servers.settings.advanced.jar_path_helper')}
                </p>
              </div>

              {/* Assets Path */}
              <div>
                <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">
                  {t('servers.settings.advanced.assets_path')}
                </label>
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
                  {t('servers.settings.advanced.assets_path_helper')}
                </p>
              </div>

              {/* JVM Arguments */}
              <div>
                <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">
                  {t('servers.settings.advanced.jvm_args')}
                </label>
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
                  {t('servers.settings.advanced.jvm_args_helper')}
                </p>
              </div>

              {/* Server Arguments */}
              <div>
                <label className="block text-sm text-text-light-muted dark:text-text-muted mb-2">
                  {t('servers.settings.advanced.server_args')}
                </label>
                <p className="text-xs text-text-light-muted dark:text-text-muted mb-2">
                  {t('servers.settings.advanced.server_args_helper')}
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
                  {t('servers.settings.advanced.preview')}
                </label>
                <p className="text-xs text-text-light-muted dark:text-text-muted mb-3">
                  {t('servers.settings.advanced.preview_helper')}
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
                    <span className="text-text-light-muted dark:text-text-muted">{t('servers.settings.advanced.legend.jvm')}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded bg-purple-600 dark:bg-purple-400"></span>
                    <span className="text-text-light-muted dark:text-text-muted">{t('servers.settings.advanced.legend.default_args')}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 rounded bg-orange-600 dark:bg-orange-400"></span>
                    <span className="text-text-light-muted dark:text-text-muted">{t('servers.settings.advanced.legend.custom_args')}</span>
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
