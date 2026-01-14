import { useState } from 'react';
import { Modal, ModalFooter, Button, Input } from '../ui';
import { Server as ServerIcon } from 'lucide-react';
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
  };
}

export const CreateServerModal = ({ isOpen, onClose, onSubmit }: CreateServerModalProps) => {
  const [formData, setFormData] = useState<ServerFormData>({
    name: '',
    serverPath: '',
    address: 'localhost',
    port: 5520,
    version: '1.0.0',
    maxPlayers: 20,
    gameMode: 'expedfition',
    adapterType: 'java',
  });

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof ServerFormData, string>>>({});

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

  const handleClose = () => {
    setFormData({
      name: '',
      serverPath: '',
      address: 'localhost',
      port: 5520,
      version: '1.0.0',
      maxPlayers: 20,
      gameMode: 'expedition',
      adapterType: 'java',
    });
    setErrors({});
    onClose();
  };

  const updateField = (field: keyof ServerFormData, value: string | number) => {
    setFormData(prev => {
      const updated = { ...prev, [field]: value };

      // Auto-generate serverPath when name changes (just the folder name, backend adds base path)
      if (field === 'name' && typeof value === 'string') {
        const slugifiedName = value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        updated.serverPath = slugifiedName || '';
      }

      return updated;
    });
    // Clear error for this field
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  };

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
          />

          {/* Address and Port */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-2">
                Address *
              </label>
              <Input
                type="text"
                placeholder="localhost"
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
                    jvmArgs: '-Xms1G -Xmx2G',
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

              <div>
                <label className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-2">
                  JVM Arguments
                </label>
                <textarea
                  placeholder="-Xms1G -Xmx2G"
                  value={formData.jvmArgs || '-Xms1G -Xmx2G'}
                  onChange={(e) => setFormData(prev => ({
                    ...prev,
                    jvmArgs: e.target.value,
                  }))}
                  className="w-full px-4 py-2 bg-white dark:bg-primary-bg border border-gray-300 dark:border-gray-700 rounded-lg text-text-light-primary dark:text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50 font-mono text-sm"
                  rows={2}
                />
                <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                  JVM arguments for the Java process. Common: -Xms (min memory), -Xmx (max memory)
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <ModalFooter>
        <Button variant="ghost" onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSubmit} disabled={loading}>
          {loading ? 'Creating...' : 'Create Server'}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
