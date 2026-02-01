import { useState, useEffect, useRef, useCallback } from 'react';
import { Modal, ModalFooter, Button, Input } from '../ui';
import { AlertTriangle, ChevronDown, Server as ServerIcon } from 'lucide-react';
import { HytaleServerDownloadSection } from '../features/HytaleServerDownloadSection';

interface CreateServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ServerFormData) => Promise<void>;
}

export interface ServerFormData {
  name: string;
  serverPath: string;
  address: string;
  port: number;
  version: string;
  maxPlayers: number;
  gameMode: string;
  adapterType: string;
  jvmArgs?: string;
  adapterConfig?: {
    jarFile?: string;
    assetsPath?: string;
    javaPath?: string;
    minMemory?: string;
    maxMemory?: string;
    cpuCores?: number;
    useContainerSupport?: boolean;
    useG1GC?: boolean;
    maxGcPauseMillis?: string;
    parallelGCThreads?: string;
    concGCThreads?: string;
    aotCache?: string;
  };
}

export const CreateServerModal = ({ isOpen, onClose, onSubmit }: CreateServerModalProps) => {
  const [formData, setFormData] = useState<ServerFormData>({
    name: '',
    serverPath: '',
    address: '0.0.0.0',
    port: 5520,
    version: '',
    maxPlayers: 20,
    gameMode: 'expedition',
    adapterType: 'java',
  });

  const [loading, setLoading] = useState(false);
  const [jvmArgsExpanded, setJvmArgsExpanded] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof ServerFormData, string>>>({});
  const [skippedDownload, setSkippedDownload] = useState(false);
  const [showSkipConfirmation, setShowSkipConfirmation] = useState(false);
  const updatingFromRef = useRef<'fields' | 'jvmArgs' | null>(null);

  const toggleJvmArgsExpanded = () => {
    setJvmArgsExpanded(!jvmArgsExpanded);
  };

  // Build JVM args from memory and CPU settings
  const buildJvmArgs = (config: ServerFormData['adapterConfig']): string => {
    const args: string[] = [];
    if (!config) return '';

    // Memory args
    if (config.minMemory) args.push(`-Xms${config.minMemory}G`);
    if (config.maxMemory) args.push(`-Xmx${config.maxMemory}G`);

    // Container support
    if (config.useContainerSupport) {
      args.push('-XX:+UseContainerSupport');
    }

    // CPU core limit
    if (config.cpuCores && config.cpuCores > 0) {
      args.push(`-XX:ActiveProcessorCount=${config.cpuCores}`);
    }

    // GC thread settings
    if (config.parallelGCThreads) {
      args.push(`-XX:ParallelGCThreads=${config.parallelGCThreads}`);
    }
    if (config.concGCThreads) {
      args.push(`-XX:ConcGCThreads=${config.concGCThreads}`);
    }

    // G1 Garbage Collector
    if (config.useG1GC) {
      args.push('-XX:+UseG1GC');
    }

    // Max GC pause time
    if (config.maxGcPauseMillis) {
      args.push(`-XX:MaxGCPauseMillis=${config.maxGcPauseMillis}`);
    }

    // AOT cache for Hytale
    if (config.aotCache) {
      args.push(`-XX:AOTCache=${config.aotCache}`);
    }

    return args.join(' ');
  };

  // Parse JVM args to extract memory and CPU settings
  const parseJvmArgs = (jvmArgs: string): Partial<ServerFormData['adapterConfig']> => {
    const result: Partial<ServerFormData['adapterConfig']> = {
      minMemory: '1',
      maxMemory: '2',
      cpuCores: undefined,
      useContainerSupport: true,
      useG1GC: true,
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
      result.cpuCores = parseInt(cpuMatch[1]);
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

    if (formData.adapterType === 'java' && formData.adapterConfig) {
      const newJvmArgs = buildJvmArgs(formData.adapterConfig);

      if (formData.jvmArgs !== newJvmArgs) {
        updatingFromRef.current = 'fields';
        setFormData(prev => ({ ...prev, jvmArgs: newJvmArgs }));
      }
    }
  }, [
    formData.adapterConfig?.minMemory,
    formData.adapterConfig?.maxMemory,
    formData.adapterConfig?.cpuCores,
    formData.adapterConfig?.useContainerSupport,
    formData.adapterConfig?.useG1GC,
    formData.adapterConfig?.maxGcPauseMillis,
    formData.adapterConfig?.parallelGCThreads,
    formData.adapterConfig?.concGCThreads,
    formData.adapterConfig?.aotCache,
    formData.adapterType
  ]);

  // Auto-update fields when JVM args change
  useEffect(() => {
    if (updatingFromRef.current === 'fields') {
      updatingFromRef.current = null;
      return;
    }

    if (formData.adapterType === 'java' && formData.jvmArgs) {
      const parsed = parseJvmArgs(formData.jvmArgs);
      if (!parsed) return;

      const currentConfig = formData.adapterConfig || {};

      // Check if any field has changed
      const hasChanges = Object.keys(parsed).some(
        key => parsed[key as keyof typeof parsed] !== currentConfig[key as keyof typeof currentConfig]
      );

      if (hasChanges) {
        updatingFromRef.current = 'jvmArgs';
        setFormData(prev => ({
          ...prev,
          adapterConfig: {
            ...prev.adapterConfig,
            ...parsed,
          },
        }));
      }
    }
  }, [formData.jvmArgs, formData.adapterType]);

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof ServerFormData, string>> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Server name is required';
    }

    if (!formData.serverPath.trim()) {
      newErrors.serverPath = 'Server directory path is required';
    }

    if (!formData.address.trim()) {
      newErrors.address = 'Address is required';
    }

    if (formData.port < 1 || formData.port > 65535) {
      newErrors.port = 'Port must be between 1 and 65535';
    }

    if (!formData.version.trim()) {
      newErrors.version = 'Server version is required. Download server files first.';
    }

    if (!formData.gameMode.trim()) {
      newErrors.gameMode = 'Game mode is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    // Show confirmation if download was skipped
    if (skippedDownload && !showSkipConfirmation) {
      setShowSkipConfirmation(true);
      return;
    }

    setLoading(true);
    try {
      await onSubmit(formData);
      handleClose();
    } catch (error) {
      console.error('Error creating server:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmSkipCreate = async () => {
    setShowSkipConfirmation(false);
    setLoading(true);
    try {
      // Process adapter config to format memory values
      const processedFormData = { ...formData };
      if (processedFormData.adapterConfig) {
        const config = { ...processedFormData.adapterConfig };
        // Add 'G' suffix to memory values if they exist and are not empty
        if (config.minMemory) {
          config.minMemory = `${config.minMemory}G`;
        }
        if (config.maxMemory) {
          config.maxMemory = `${config.maxMemory}G`;
        }
        processedFormData.adapterConfig = config;
      }

      await onSubmit(processedFormData);
      handleClose();
    } catch (error) {
      console.error('Error creating server:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFormData({
      name: '',
      serverPath: '',
      address: '0.0.0.0',
      port: 5520,
      version: '',
      maxPlayers: 20,
      gameMode: 'expedition',
      adapterType: 'java',
    });
    setErrors({});
    setSkippedDownload(false);
    setShowSkipConfirmation(false);
    updatingFromRef.current = null;
    onClose();
  };

  const updateField = useCallback((field: keyof ServerFormData, value: string | number) => {
    setFormData(prev => {
      const updated = { ...prev, [field]: value };

      // Auto-generate serverPath when name changes
      if (field === 'name' && typeof value === 'string') {
        const slugifiedName = value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        if (slugifiedName) {
          updated.serverPath = `servers/${slugifiedName}`;
        } else {
          updated.serverPath = '';
        }
      }

      return updated;
    });
    // Clear error for this field (no null check needed)
    setErrors(prev => ({ ...prev, [field]: undefined }));
  }, []);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Create New Server"
      size="lg"
    >
      <div className="space-y-4">
        {/* Server Icon Header */}
        <div className="flex items-center gap-3 p-4 bg-primary-bg-secondary rounded-lg">
          <div className="p-3 bg-accent-primary/20 rounded-lg">
            <ServerIcon className="text-accent-primary" size={24} />
          </div>
          <div>
            <h3 className="font-heading font-semibold text-text-light-primary dark:text-text-primary">
              Configure Your Server
            </h3>
            <p className="text-sm text-text-light-muted dark:text-text-muted">
              Set up a new Hytale server instance
            </p>
          </div>
        </div>

        {/* Form Fields */}
        <div className="space-y-4">
          {/* Server Name */}
          <div>
            <label className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-2">
              Server Name *
            </label>
            <Input
              type="text"
              placeholder="My Awesome Server"
              value={formData.name}
              onChange={(e) => updateField('name', e.target.value)}
            />
            {errors.name && (
              <p className="text-danger text-sm mt-1">{errors.name}</p>
            )}
          </div>

          {/* Server Directory Path */}
          <div>
            <label className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-2">
              Server Directory *
            </label>
            <Input
              type="text"
              placeholder="C:\Servers\MyServer"
              value={formData.serverPath}
              onChange={(e) => updateField('serverPath', e.target.value)}
            />
            <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
              Full path to the server directory. This directory will be created if it doesn't exist.
            </p>
            {errors.serverPath && (
              <p className="text-danger text-sm mt-1">{errors.serverPath}</p>
            )}
          </div>

          {/* Hytale Server Download */}
          <HytaleServerDownloadSection
            serverPath={formData.serverPath}
            onVersionSet={useCallback((version: string) => updateField('version', version), [updateField])}
            onSkipDownload={useCallback(skipped) => setSkippedDownload(skipped), [setSkippedDownload])}
          />
          {errors.version && (
            <p className="text-danger text-sm mt-1">{errors.version}</p>
          )}

          {/* Address and Port */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-2">
                Address *
              </label>
              <Input
                type="text"
                placeholder="0.0.0.0"
                value={formData.address}
                onChange={(e) => updateField('address', e.target.value)}
              />
              {errors.address && (
                <p className="text-danger text-sm mt-1">{errors.address}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-2">
                Port *
              </label>
              <Input
                type="number"
                placeholder="25565"
                value={formData.port}
                onChange={(e) => updateField('port', parseInt(e.target.value) || 0)}
              />
              {errors.port && (
                <p className="text-danger text-sm mt-1">{errors.port}</p>
              )}
            </div>
          </div>

          {/* Game Mode */}
          <div>
            <label className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-2">
              Game Mode *
            </label>
            <select
              value={formData.gameMode}
              onChange={(e) => updateField('gameMode', e.target.value)}
              className="w-full px-4 py-2 bg-white dark:bg-primary-bg border border-gray-300 dark:border-gray-700 rounded-lg text-text-light-primary dark:text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
            >
              <option value="expedition">Expedition</option>
              <option value="creative">Creative</option>
            </select>
            {errors.gameMode && (
              <p className="text-danger text-sm mt-1">{errors.gameMode}</p>
            )}
          </div>

          {/* Adapter Type */}
          <div>
            <label className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-2">
              Adapter Type
            </label>
            <select
              value={formData.adapterType}
              onChange={(e) => {
                updateField('adapterType', e.target.value);
                // Set default adapter config for java
                if (e.target.value === 'java') {
                  setFormData(prev => ({
                    ...prev,
                    adapterType: 'java',
                    jvmArgs: '-Xms1G -Xmx2G -XX:AOTCache=HytaleServer.aot',
                    adapterConfig: {
                      jarFile: 'Server/HytaleServer.jar',
                      assetsPath: '../Assets.zip',
                      javaPath: 'java',
                    },
                  }));
                } else {
                  setFormData(prev => ({
                    ...prev,
                    adapterType: e.target.value,
                    jvmArgs: undefined,
                    adapterConfig: undefined,
                  }));
                }
              }}
              className="w-full px-4 py-2 bg-white dark:bg-primary-bg border border-gray-300 dark:border-gray-700 rounded-lg text-text-light-primary dark:text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
            >
              <option value="java">Java JAR (Hytale, Minecraft, etc.)</option>
              <option value="hytale" disabled>Hytale (Coming Soon)</option>
            </select>
            <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
              {formData.adapterType === 'java' && 'Run a Java JAR file (e.g., Minecraft server).'}
            </p>
          </div>

          {/* Java Adapter Config */}
          {formData.adapterType === 'java' && (
            <div className="space-y-4 p-4 bg-primary-bg-secondary rounded-lg">
              <h4 className="font-medium text-text-light-primary dark:text-text-primary">Java Configuration</h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-2">
                    JAR File Path
                  </label>
                  <Input
                    type="text"
                    placeholder="Server/HytaleServer.jar"
                    value={formData.adapterConfig?.jarFile || 'Server/HytaleServer.jar'}
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      adapterConfig: { ...prev.adapterConfig, jarFile: e.target.value },
                    }))}
                  />
                  <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                    Path to the JAR file relative to the server directory
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-2">
                    Assets Path
                  </label>
                  <Input
                    type="text"
                    placeholder="../Assets.zip"
                    value={formData.adapterConfig?.assetsPath || '../Assets.zip'}
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      adapterConfig: { ...prev.adapterConfig, assetsPath: e.target.value },
                    }))}
                  />
                  <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                    Path to Assets.zip relative to the JAR file
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-2">
                    Java Path
                  </label>
                  <Input
                    type="text"
                    placeholder="java"
                    value={formData.adapterConfig?.javaPath || 'java'}
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      adapterConfig: { ...prev.adapterConfig, javaPath: e.target.value },
                    }))}
                  />
                  <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                    Path to Java executable (or just "java" if in PATH)
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-2">
                    Min Memory (GB)
                  </label>
                  <Input
                    type="number"
                    min="0.5"
                    step="0.5"
                    placeholder="1"
                    value={formData.adapterConfig?.minMemory || ''}
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      adapterConfig: { ...prev.adapterConfig, minMemory: e.target.value },
                    }))}
                  />
                  <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                    Minimum heap memory (-Xms)
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-2">
                    Max Memory (GB)
                  </label>
                  <Input
                    type="number"
                    min="0.5"
                    step="0.5"
                    placeholder="2"
                    value={formData.adapterConfig?.maxMemory || ''}
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      adapterConfig: { ...prev.adapterConfig, maxMemory: e.target.value },
                    }))}
                  />
                  <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                    Maximum heap memory (-Xmx)
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-2">
                    CPU Cores (Optional)
                  </label>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="No limit"
                    value={formData.adapterConfig?.cpuCores || ''}
                    onChange={(e) => setFormData(prev => ({
                      ...prev,
                      adapterConfig: {
                        ...prev.adapterConfig,
                        cpuCores: e.target.value ? parseInt(e.target.value) : undefined,
                      },
                    }))}
                  />
                  <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                    Limit CPU cores used by JVM via -XX:ActiveProcessorCount
                  </p>
                </div>
              </div>

              {/* JVM Optimization Flags */}
              <div className="border-t border-gray-300 dark:border-gray-700 pt-4 mt-4">
                <div className="flex flex-row items-center justify-between mb-3">
                  <div className="flex flex-col">
                    <h5 className="text-sm font-medium text-text-light-primary dark:text-text-primary">JVM Optimization Flags</h5>
                    <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                      Additional JVM tuning options for better performance
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={toggleJvmArgsExpanded}>
                    <ChevronDown className={`w-4 h-4 transform transition-transform duration-300 ${
                      jvmArgsExpanded ? 'rotate-180' : 'rotate-0'
                    }`}/>
                  </Button>
                </div>
                  
                <div className={`transition-all duration-300 ease-in-out overflow-hidden ${
                  jvmArgsExpanded ? 'max-h-screen opacity-100' : 'max-h-0 opacity-0'
                }`}>
                  <div className="space-y-3">
                    {/* Container Support */}
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={formData.adapterConfig?.useContainerSupport || false}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          adapterConfig: { ...prev.adapterConfig, useContainerSupport: e.target.checked },
                        }))}
                        className="mt-0.5"
                      />
                      <div className="flex-1">
                        <label className="block text-xs text-text-light-primary dark:text-text-primary font-medium">
                          Container Support
                        </label>
                        <p className="text-xs text-text-light-muted dark:text-text-muted">
                          JVM container awareness for Docker/Kubernetes
                        </p>
                      </div>
                    </div>

                    {/* G1GC */}
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={formData.adapterConfig?.useG1GC || false}
                        onChange={(e) => setFormData(prev => ({
                          ...prev,
                          adapterConfig: { ...prev.adapterConfig, useG1GC: e.target.checked },
                        }))}
                        className="mt-0.5"
                      />
                      <div className="flex-1">
                        <label className="block text-xs text-text-light-primary dark:text-text-primary font-medium">
                          G1 Garbage Collector
                        </label>
                        <p className="text-xs text-text-light-muted dark:text-text-muted">
                          Better performance for 4GB+ heaps, reduces lag
                        </p>
                      </div>
                    </div>

                    {/* GC Thread Inputs */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Input
                          type="number"
                          min="1"
                          placeholder="Parallel GC Threads (Leave blank for auto)"
                          value={formData.adapterConfig?.parallelGCThreads || ''}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            adapterConfig: { ...prev.adapterConfig, parallelGCThreads: e.target.value },
                          }))}
                          className="text-xs"
                        />
                      </div>
                      <div>
                        <Input
                          type="number"
                          min="1"
                          placeholder="Concurrent GC Threads (Leave blank for auto)"
                          value={formData.adapterConfig?.concGCThreads || ''}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            adapterConfig: { ...prev.adapterConfig, concGCThreads: e.target.value },
                          }))}
                          className="text-xs"
                        />
                      </div>
                    </div>

                    {/* Max GC Pause & AOT Cache */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Input
                          type="number"
                          min="50"
                          placeholder="Max GC Pause (ms)"
                          value={formData.adapterConfig?.maxGcPauseMillis || '200'}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            adapterConfig: { ...prev.adapterConfig, maxGcPauseMillis: e.target.value },
                          }))}
                          className="text-xs"
                        />
                      </div>
                      <div>
                        <Input
                          placeholder="AOT Cache File"
                          value={formData.adapterConfig?.aotCache || 'HytaleServer.aot'}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            adapterConfig: { ...prev.adapterConfig, aotCache: e.target.value },
                          }))}
                          className="text-xs font-mono"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-2">
                  JVM Arguments
                </label>
                <textarea
                  placeholder="-Xms1G -Xmx2G -XX:AOTCache=HytaleServer.aot"
                  value={formData.jvmArgs || '-Xms1G -Xmx2G -XX:AOTCache=HytaleServer.aot'}
                  onChange={(e) => {
                    setFormData(prev => ({
                      ...prev,
                      jvmArgs: e.target.value,
                    }));
                  }}
                  className="w-full px-4 py-2 bg-white dark:bg-primary-bg border border-gray-300 dark:border-gray-700 rounded-lg text-text-light-primary dark:text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50 font-mono text-sm"
                  rows={2}
                />
                <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                  JVM arguments for the Java process. AOT cache enables faster startup if HytaleServer.aot exists.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Skip Download Confirmation Dialog */}
      {showSkipConfirmation && (
        <div className="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-yellow-500 shrink-0" />
            <div>
              <h4 className="font-medium text-text-light-primary dark:text-text-primary mb-2">
                Confirm: No Server Files Downloaded
              </h4>
              <p className="text-sm text-text-light-muted dark:text-text-muted mb-3">
                You are creating this server without downloading files. This means:
              </p>
              <ul className="text-sm text-text-light-muted dark:text-text-muted list-disc list-inside space-y-1 mb-3">
                <li>The server directory must already contain valid server files</li>
                <li>The server JAR file must exist at the specified path</li>
                <li>This option is only intended for migrating existing servers</li>
              </ul>
              <p className="text-sm text-yellow-600 dark:text-yellow-400 font-medium">
                Are you sure you want to continue?
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSkipConfirmation(false)}
            >
              Go Back
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleConfirmSkipCreate}
              disabled={loading}
              className="bg-yellow-600 hover:bg-yellow-700"
            >
              {loading ? 'Creating...' : 'Yes, Create Server'}
            </Button>
          </div>
        </div>
      )}

      <ModalFooter>
        <Button variant="ghost" onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSubmit} disabled={loading || showSkipConfirmation}>
          {loading ? 'Creating...' : 'Create Server'}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
