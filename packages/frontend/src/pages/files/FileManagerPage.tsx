import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Badge, Input } from '../../components/ui';
import {
  Folder, File, FileText, FileCode, FileImage, FileArchive,
  ChevronRight, Home, Plus, Download, Edit, Trash2, Search, FolderPlus, Upload
} from 'lucide-react';
import { api, ApiError } from '../../services/api';
import { AuthError } from '../../services/auth';
import { FileEditorModal } from './FileEditorModal';
import { CreateItemModal } from './CreateItemModal';
import { UploadFileModal } from './UploadFileModal';

interface Server {
  id: string;
  name: string;
  status: string;
}

interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modified: Date;
  extension?: string;
  isEditable: boolean;
}

export const FileManagerPage = () => {
  const [servers, setServers] = useState<Server[]>([]);
  const [selectedServer, setSelectedServer] = useState<string>('');
  const [currentPath, setCurrentPath] = useState<string>('');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const { t } = useTranslation();

  // Modals
  const [showEditor, setShowEditor] = useState(false);
  const [editingFile, setEditingFile] = useState<FileItem | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createType, setCreateType] = useState<'file' | 'directory'>('file');
  const [showUploadModal, setShowUploadModal] = useState(false);

  // Disk usage
  const [diskUsage, setDiskUsage] = useState({ total: 0, used: 0 });

  const fetchFiles = useCallback(async () => {
    if (!selectedServer) return;

    try {
      setLoading(true);
      const data = await api.listFiles<FileItem>(selectedServer, currentPath);
      setFiles(data);
    } catch (error) {
      console.error('Error fetching files:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedServer, currentPath]);

  const fetchDiskUsage = useCallback(async () => {
    if (!selectedServer) return;

    try {
      const usage = await api.getDiskUsage(selectedServer);
      setDiskUsage(usage);
    } catch (error) {
      console.error('Error fetching disk usage:', error);
    }
  }, [selectedServer]);

  const fetchServers = useCallback(async () => {
    try {
      const data = await api.getServers<Server>();
      setServers(data.map((s) => ({ id: s.id, name: s.name, status: s.status })));

      if (data.length > 0 && !selectedServer) {
        setSelectedServer(data[0].id);
      }
    } catch (error) {
      console.error('Error fetching servers:', error);
    }
  }, [selectedServer]);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  useEffect(() => {
    if (selectedServer) {
      fetchFiles();
      fetchDiskUsage();
    }
  }, [selectedServer, currentPath, fetchFiles, fetchDiskUsage]);

  const handleSearch = async () => {
    if (!selectedServer || !searchQuery.trim()) return;

    try {
      setSearching(true);
      const results = await api.searchFiles<FileItem>(selectedServer, searchQuery, currentPath);
      setFiles(results);
    } catch (error) {
      console.error('Error searching files:', error);
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    fetchFiles();
  };

  const navigate = (path: string) => {
    setCurrentPath(path);
    setSearchQuery('');
  };

  const navigateUp = () => {
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    navigate(parts.join('/'));
  };

  const openDirectory = (item: FileItem) => {
    if (item.type === 'directory') {
      navigate(item.path);
    }
  };

  const handleEdit = (file: FileItem) => {
    setEditingFile(file);
    setShowEditor(true);
  };

  const handleDelete = async (item: FileItem) => {
    if (!selectedServer) return;

    const confirmMsg = item.type === 'directory'
      ? t('files.confirm.delete_directory', { name: item.name })
      : t('files.confirm.delete_file', { name: item.name });

    if (!confirm(confirmMsg)) return;

    try {
      await api.deleteFile(selectedServer, item.path);
      await fetchFiles();
    } catch (error: unknown) {
      let message = t('files.alert.unexpected_error');
      let typeLabel = item.type === 'directory' ? t('files.types.directory') : t('files.types.file');
      if (error instanceof ApiError || error instanceof AuthError || error instanceof Error) {
        message = error.message;
      } else if (typeof error === 'string') {
        message = error;
      }
      alert(
        t('files.alert.delete_error', {
          type: typeLabel,
          message,
        })
      );
    }
  };

  const handleDownload = (file: FileItem) => {
    if (!selectedServer) return;

    const url = api.getFileDownloadUrl(selectedServer, file.path);
    window.open(url, '_blank');
  };

  const handleCreateFile = () => {
    setCreateType('file');
    setShowCreateModal(true);
  };

  const handleCreateDirectory = () => {
    setCreateType('directory');
    setShowCreateModal(true);
  };

  const handleItemCreated = async () => {
    await fetchFiles();
    setShowCreateModal(false);
  };

  const getFileIcon = (item: FileItem) => {
    if (item.type === 'directory') {
      return <Folder size={20} className="text-accent-primary" />;
    }

    const ext = item.extension?.toLowerCase();

    if (['.txt', '.md', '.log'].includes(ext || '')) {
      return <FileText size={20} className="text-blue-500" />;
    }
    if (['.js', '.ts', '.json', '.yml', '.yaml', '.xml', '.html', '.css'].includes(ext || '')) {
      return <FileCode size={20} className="text-green-500" />;
    }
    if (['.png', '.jpg', '.jpeg', '.gif', '.svg'].includes(ext || '')) {
      return <FileImage size={20} className="text-purple-500" />;
    }
    if (['.zip', '.tar', '.gz', '.jar'].includes(ext || '')) {
      return <FileArchive size={20} className="text-orange-500" />;
    }

    return <File size={20} className="text-gray-500" />;
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const formatDate = (date: Date): string => {
    return new Date(date).toLocaleString();
  };

  const getBreadcrumbs = () => {
    if (!currentPath) return [];
    return currentPath.split('/').filter(Boolean);
  };

  const selectedServerData = servers.find(s => s.id === selectedServer);
  const usagePercent = diskUsage.total > 0 ? (diskUsage.used / diskUsage.total) * 100 : 0;
  const getServerPlaceholder = () => t('files.server_selector.placeholder');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-heading font-bold text-text-light-primary dark:text-text-primary">{t('files.title')}</h1>
          <p className="text-text-light-muted dark:text-text-muted mt-1">{t('files.subtitle')}</p>
        </div>
      </div>

      {/* Server Selector */}
      <div className="flex gap-4 items-center">
        <div className="flex-1">
          <select
            value={selectedServer}
            onChange={(e) => {
              setSelectedServer(e.target.value);
              setCurrentPath('');
            }}
            className="w-full max-w-md px-4 py-2 bg-white dark:bg-primary-bg-secondary border border-gray-300 dark:border-gray-700 rounded-lg text-text-light-primary dark:text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
          >
            <option value="">{getServerPlaceholder()}</option>
            {servers.map((server) => (
              <option key={server.id} value={server.id}>
                {server.name} ({server.status})
              </option>
            ))}
          </select>
        </div>

        {selectedServer && (
          <div className="flex gap-2">
            <Button variant="primary" size="sm" icon={<Plus size={16} />} onClick={handleCreateFile}>
              {t('files.actions.new_file')}
            </Button>
            <Button variant="secondary" size="sm" icon={<FolderPlus size={16} />} onClick={handleCreateDirectory}>
              {t('files.actions.new_folder')}
            </Button>
            <Button variant="secondary" size="sm" icon={<Upload size={16} />} onClick={() => setShowUploadModal(true)}>
              {t('files.actions.upload')}
            </Button>
          </div>
        )}
      </div>

      {selectedServer && (
        <>
          {/* Disk Usage */}
          <Card variant="glass">
            <CardContent>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-text-light-muted dark:text-text-muted">{t('files.disk_usage')}</p>
                <p className="text-sm font-medium text-text-light-primary dark:text-text-primary">
                  {formatSize(diskUsage.used)}
                </p>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2">
                <div
                  className="bg-accent-primary rounded-full h-2 transition-all"
                  style={{ width: `${Math.min(usagePercent, 100)}%` }}
                />
              </div>
            </CardContent>
          </Card>

          {/* Breadcrumbs and Search */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 flex-1">
              <Button
                variant="ghost"
                size="sm"
                icon={<Home size={16} />}
                onClick={() => navigate('')}
              />
              {getBreadcrumbs().map((crumb, index, arr) => {
                const path = arr.slice(0, index + 1).join('/');
                return (
                  <div key={index} className="flex items-center gap-2">
                    <ChevronRight size={16} className="text-text-light-muted dark:text-text-muted" />
                    <button
                      onClick={() => navigate(path)}
                      className="text-text-light-primary dark:text-text-primary hover:text-accent-primary transition-colors"
                    >
                      {crumb}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder={t('files.search.placeholder')}
                className="w-64"
              />
              <Button
                variant="secondary"
                size="sm"
                icon={<Search size={16} />}
                onClick={handleSearch}
                loading={searching}
              >
                {t('files.actions.search')}
              </Button>
              {searchQuery && (
                <Button variant="ghost" size="sm" onClick={clearSearch}>
                  {t('files.actions.clear')}
                </Button>
              )}
            </div>
          </div>

          {/* Files List */}
          <Card variant="glass">
            <CardHeader>
            <CardTitle>
              {searchQuery ? t('files.table.search_results', { query: searchQuery }) : t('files.table.files_and_folders')}
              {loading ? ` (${t('common.loading')})` : ''}
            </CardTitle>
              <CardDescription>
                {selectedServerData?.name} - {currentPath || '/'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {files.length === 0 && !loading ? (
                <div className="text-center py-12 text-text-light-muted dark:text-text-muted">
                  {searchQuery ? t('files.empty.search') : t('files.empty.directory')}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-300 dark:border-gray-800">
                        <th className="text-left py-3 px-4 text-sm font-medium text-text-light-muted dark:text-text-muted">{t('files.table.name')}</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-text-light-muted dark:text-text-muted">{t('files.table.size')}</th>
                        <th className="text-left py-3 px-4 text-sm font-medium text-text-light-muted dark:text-text-muted">{t('files.table.modified')}</th>
                        <th className="text-right py-3 px-4 text-sm font-medium text-text-light-muted dark:text-text-muted">{t('files.table.actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentPath && (
                        <tr className="border-b border-gray-300 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-900 cursor-pointer">
                          <td colSpan={4} className="py-3 px-4" onClick={navigateUp}>
                            <div className="flex items-center gap-2">
                              <Folder size={20} className="text-gray-500" />
                              <span className="font-medium text-text-light-primary dark:text-text-primary">..</span>
                            </div>
                          </td>
                        </tr>
                      )}
                      {files.map((item) => (
                        <tr
                          key={item.path}
                          className="border-b border-gray-300 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
                        >
                          <td
                            className="py-3 px-4 cursor-pointer"
                            onClick={() => openDirectory(item)}
                          >
                            <div className="flex items-center gap-3">
                              {getFileIcon(item)}
                              <span className="font-medium text-text-light-primary dark:text-text-primary">
                                {item.name}
                              </span>
                              {item.isEditable && (
                                <Badge variant="info" size="sm">{t('files.badge.editable')}</Badge>
                              )}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-sm text-text-light-muted dark:text-text-muted">
                            {item.type === 'file' ? formatSize(item.size) : '-'}
                          </td>
                          <td className="py-3 px-4 text-sm text-text-light-muted dark:text-text-muted">
                            {formatDate(item.modified)}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex justify-end gap-2">
                              {item.type === 'file' && item.isEditable && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  icon={<Edit size={14} />}
                                  onClick={() => handleEdit(item)}
                                />
                              )}
                              {item.type === 'file' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  icon={<Download size={14} />}
                                  onClick={() => handleDownload(item)}
                                />
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                icon={<Trash2 size={14} />}
                                onClick={() => handleDelete(item)}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* File Editor Modal */}
      {editingFile && (
        <FileEditorModal
          isOpen={showEditor}
          onClose={() => {
            setShowEditor(false);
            setEditingFile(null);
          }}
          onSave={fetchFiles}
          serverId={selectedServer}
          file={editingFile}
        />
      )}

      {/* Create Item Modal */}
      <CreateItemModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={handleItemCreated}
        serverId={selectedServer}
        currentPath={currentPath}
        type={createType}
      />

      {/* Upload File Modal */}
      <UploadFileModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onSuccess={fetchFiles}
        serverId={selectedServer}
        currentPath={currentPath}
      />
    </div>
  );
};
