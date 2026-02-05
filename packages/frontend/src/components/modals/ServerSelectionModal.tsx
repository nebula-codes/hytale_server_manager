import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalFooter, Button, Badge, StatusIndicator } from '../ui';
import { Server as ServerIcon, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import * as modProviderApi from '../../services/modProviderApi';
import type { UnifiedProject, UnifiedDependency } from '../../types/modProvider';
import api from '../../services/api';

interface ServerSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: UnifiedProject | null;
  onInstall: (serverId: string, projectId: string, versionId: string, providerId: string) => void;
}

export const ServerSelectionModal = ({ isOpen, onClose, project, onInstall }: ServerSelectionModalProps) => {
  const { t } = useTranslation();
  const [servers, setServers] = useState<any[]>([]);
  const [selectedServer, setSelectedServer] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [dependencies, setDependencies] = useState<UnifiedDependency[]>([]);
  const [loadingDeps, setLoadingDeps] = useState(false);
  const [depsError, setDepsError] = useState<string | null>(null);

  // Fetch servers when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchServers();
    }
  }, [isOpen]);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen && project) {
      setSelectedServer(null);
      setSelectedVersion(project.latestVersion?.id || null);
      setDependencies([]);
      setDepsError(null);
    }
  }, [isOpen, project]);

  const fetchServers = async () => {
    try {
      const data = await api.getServers();
      setServers(data);
    } catch (error) {
      console.error('Error fetching servers:', error);
    }
  };

  // Fetch dependencies when version is selected
  useEffect(() => {
    if (project && selectedVersion) {
      fetchDependencies();
    }
  }, [project, selectedVersion]);

  const fetchDependencies = async () => {
    if (!project || !selectedVersion) return;

    setLoadingDeps(true);
    setDepsError(null);

    try {
      const deps = await modProviderApi.getVersionDependencies(project.providerId, project.id, selectedVersion);
      setDependencies(deps);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : t('mods.server_select.deps_error');
      setDepsError(errorMessage);
      setDependencies([]);
    } finally {
      setLoadingDeps(false);
    }
  };

  const handleInstall = () => {
    if (!selectedServer || !project || !selectedVersion) {
      return;
    }
    onInstall(selectedServer, project.id, selectedVersion, project.providerId);
    onClose();
  };

  const selectedServerData = servers.find(s => s.id === selectedServer);
  const hasRequiredDependencies = dependencies.some(d => d.required);
  const canInstall = selectedServer && selectedVersion && !loadingDeps;

  if (!project) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('mods.server_select.title', { name: project.title })}
      size="lg"
    >
      <div className="space-y-6">
        {/* Project Info */}
        <div className="flex items-start gap-4 p-4 bg-primary-bg-secondary rounded-lg">
          <img
            src={project.iconUrl || `https://via.placeholder.com/64/6366f1/ffffff?text=${project.title[0]}`}
            alt={project.title}
            className="w-16 h-16 rounded-lg object-cover"
          />
          <div className="flex-1">
            <h3 className="font-heading font-semibold text-text-light-primary dark:text-text-primary">
              {project.title}
            </h3>
            <p className="text-sm text-text-light-muted dark:text-text-muted mt-1">
              {t('mods.server_select.by_author', { author: project.author.username })}
            </p>
            <div className="flex gap-2 mt-2">
              <Badge size="sm" variant="info">{project.classification}</Badge>
              <Badge size="sm" variant="default">
                {t('mods.server_select.downloads', { count: project.downloads })}
              </Badge>
            </div>
          </div>
        </div>

        {/* Version Selection */}
        <div>
          <label className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-2">
            {t('mods.server_select.version_label')}
          </label>
          <select
            value={selectedVersion || ''}
            onChange={(e) => setSelectedVersion(e.target.value)}
            className="w-full px-4 py-2 bg-white dark:bg-primary-bg border border-gray-300 dark:border-gray-700 rounded-lg text-text-light-primary dark:text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
          >
            {project.versions?.map((version) => {
              const dateStr = version.releaseDate;
              const dateDisplay = dateStr ? new Date(dateStr).toLocaleDateString() : '';
              const translationKey = dateDisplay
                ? 'mods.server_select.version_option_with_date'
                : 'mods.server_select.version_option';
              return (
                <option key={version.id} value={version.id}>
                  {t(translationKey, { version: version.version, date: dateDisplay })}
                </option>
              );
            }) || (
              <option value={project.latestVersion?.id}>
                {project.latestVersion?.version || t('mods.server_select.latest')}
              </option>
            )}
          </select>
        </div>

        {/* Dependencies */}
        {loadingDeps && (
          <div className="flex items-center gap-2 text-text-light-muted dark:text-text-muted">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">{t('mods.server_select.deps_checking')}</span>
          </div>
        )}

        {depsError && (
          <div className="flex items-center gap-2 p-3 bg-danger/10 border border-danger/30 rounded-lg">
            <AlertCircle size={18} className="text-danger" />
            <span className="text-sm text-danger">{depsError}</span>
          </div>
        )}

        {!loadingDeps && dependencies.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-2">
              {t('mods.server_select.deps_label')} {hasRequiredDependencies && <span className="text-danger">*</span>}
            </label>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {dependencies.map((dep, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 bg-white dark:bg-primary-bg-secondary border border-gray-300 dark:border-gray-700 rounded-lg"
                >
                  <div className="flex-1">
                    <p className="text-sm font-medium text-text-light-primary dark:text-text-primary">
                      {dep.projectName}
                    </p>
                    <p className="text-xs text-text-light-muted dark:text-text-muted">
                      {t('mods.server_select.deps_version', { version: dep.versionId || t('mods.server_select.any') })}
                    </p>
                  </div>
                  <Badge
                    size="sm"
                    variant={dep.required ? 'danger' : 'default'}
                  >
                    {dep.required ? t('mods.server_select.required') : t('mods.server_select.optional')}
                  </Badge>
                </div>
              ))}
            </div>
            {hasRequiredDependencies && (
              <p className="text-xs text-warning mt-2">
                ⚠️ {t('mods.server_select.deps_notice')}
              </p>
            )}
          </div>
        )}

        {/* Server Selection */}
        <div>
          <label className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-2">
            {t('mods.server_select.server_label')}
          </label>
          <div className="grid grid-cols-1 gap-3 max-h-64 overflow-y-auto">
            {servers.map((server) => (
              <button
                key={server.id}
                onClick={() => setSelectedServer(server.id)}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  selectedServer === server.id
                    ? 'border-accent-primary bg-accent-primary/10'
                    : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-primary-bg hover:border-accent-primary/50'
                }`}
              >
                <div className="flex items-start gap-3">
                  <ServerIcon
                    size={20}
                    className={selectedServer === server.id ? 'text-accent-primary' : 'text-text-light-muted dark:text-text-muted'}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                     <h4 className="font-medium text-text-light-primary dark:text-text-primary truncate">
                       {server.name}
                     </h4>
                     <StatusIndicator status={server.status} />
                   </div>
                   <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                      {t('mods.server_select.server_meta', { address: server.address, port: server.port, version: server.version })}
                   </p>
                   <div className="flex gap-3 mt-2 text-xs text-text-light-muted dark:text-text-muted">
                      <span>{t('mods.server_select.players', { current: 0, max: server.maxPlayers })}</span>
                   </div>
                 </div>
                  {selectedServer === server.id && (
                    <CheckCircle2 size={20} className="text-accent-primary flex-shrink-0" />
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Selected Server Info */}
        {selectedServerData && (
          <div className="p-3 bg-success/10 border border-success/30 rounded-lg">
            <p className="text-sm text-success">
              {t('mods.server_select.summary', { project: project.title, server: selectedServerData.name })}
            </p>
          </div>
        )}
      </div>

      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          onClick={handleInstall}
          disabled={!canInstall}
        >
          {loadingDeps ? t('mods.server_select.deps_checking') : t('mods.server_select.install')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
