import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Input, Badge, DataTable, SearchableSelect } from '../../components/ui';
import type { Column } from '../../components/ui';
import { Download, AlertCircle, Settings, Search, X, ExternalLink, Grid, List, ChevronLeft, ChevronRight } from 'lucide-react';
import { useModProviderStore, useIsCurrentProviderConfigured } from '../../stores/modProviderStore';
import { useToast } from '../../stores/toastStore';
import { useInstallationQueueStore } from '../../stores/installationQueueStore';
import * as modProviderApi from '../../services/modProviderApi';
import type { UnifiedProject } from '../../types/modProvider';
import { ServerSelectionModal } from '../../components/modals/ServerSelectionModal';
import { ProviderSelector, ProviderBadge } from '../../components/mods/ProviderSelector';
import api from '../../services/api';

export const ModpacksPage = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useTranslation();
  const {
    selectedProvider,
    providers,
    loadProviders,
    searchResults,
    multiSearchResults,
    searchLoading,
    searchError,
    search,
    setSearchQuery: setStoreSearchQuery,
    setSearchClassification,
    searchPage,
    setSearchPage,
  } = useModProviderStore();
  const isProviderConfigured = useIsCurrentProviderConfigured();
  const { addToQueue } = useInstallationQueueStore();

  const [showInstallModal, setShowInstallModal] = useState(false);
  const [selectedProject, setSelectedProject] = useState<UnifiedProject | null>(null);
  const [servers, setServers] = useState<any[]>([]);

  // Search and filters
  const [localSearchQuery, setLocalSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'downloads' | 'rating' | 'updated'>('downloads');
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [filterAuthor, setFilterAuthor] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  const CARD_PAGE_SIZE = 9;

  // Fetch servers on mount
  useEffect(() => {
    const fetchServers = async () => {
      try {
        const data = await api.getServers();
        setServers(data);
      } catch (err) {
        console.error('Failed to fetch servers:', err);
      }
    };
    fetchServers();
    loadProviders();
  }, []);

  // Set classification to MODPACK and trigger search when provider changes
  useEffect(() => {
    if (isProviderConfigured) {
      setSearchClassification('MODPACK');
      search();
    }
  }, [selectedProvider, isProviderConfigured]);

  // Get projects from search results
  const allProjects = useMemo(() => {
    if (selectedProvider === 'all' && multiSearchResults) {
      return modProviderApi.mergeSearchResults(multiSearchResults);
    }
    return searchResults?.projects || [];
  }, [selectedProvider, searchResults, multiSearchResults]);

  // Filter to only modpacks
  const modpacks = useMemo(() => {
    return allProjects.filter(p => p.classification === 'MODPACK');
  }, [allProjects]);

  // Get total count
  const totalResults = useMemo(() => {
    if (selectedProvider === 'all' && multiSearchResults) {
      return multiSearchResults.totalAcrossProviders;
    }
    return searchResults?.total || 0;
  }, [selectedProvider, searchResults, multiSearchResults]);

  // Extract unique tags and authors for filter dropdowns
  const uniqueTags = useMemo(() => {
    const tagSet = new Set<string>();
    modpacks.forEach(modpack => {
      modpack.categories?.forEach(cat => tagSet.add(cat.name));
    });
    return Array.from(tagSet).sort();
  }, [modpacks]);

  const uniqueAuthors = useMemo(() => {
    const authorSet = new Set<string>();
    modpacks.forEach(modpack => {
      if (modpack.author?.username) {
        authorSet.add(modpack.author.username);
      }
    });
    return Array.from(authorSet).sort();
  }, [modpacks]);

  // Filter and sort modpacks client-side
  const filteredModpacks = useMemo(() => {
    let filtered = modpacks;

    // Filter by search query
    if (localSearchQuery.trim()) {
      const query = localSearchQuery.toLowerCase();
      filtered = filtered.filter(m =>
        m.title.toLowerCase().includes(query) ||
        m.description.toLowerCase().includes(query) ||
        m.author?.username?.toLowerCase().includes(query)
      );
    }

    // Filter by tags (categories)
    if (filterTags.length > 0) {
      filtered = filtered.filter(m =>
        filterTags.every(filterTag =>
          m.categories?.some(cat => cat.name === filterTag)
        )
      );
    }

    // Filter by author
    if (filterAuthor !== 'all') {
      filtered = filtered.filter(m => m.author?.username === filterAuthor);
    }

    // Sort
    filtered = [...filtered].sort((a, b) => {
      if (sortBy === 'downloads') return b.downloads - a.downloads;
      if (sortBy === 'rating') return (b.rating || 0) - (a.rating || 0);
      if (sortBy === 'updated') {
        const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return dateB - dateA;
      }
      return 0;
    });

    return filtered;
  }, [modpacks, localSearchQuery, filterTags, filterAuthor, sortBy]);

  // Paginate modpacks for card view
  const cardPage = Math.ceil(searchPage);
  const paginatedModpacks = useMemo(() => {
    const startIndex = (cardPage - 1) * CARD_PAGE_SIZE;
    return filteredModpacks.slice(startIndex, startIndex + CARD_PAGE_SIZE);
  }, [filteredModpacks, cardPage]);

  const totalCardPages = Math.ceil(filteredModpacks.length / CARD_PAGE_SIZE);

  const handleSearch = () => {
    setStoreSearchQuery(localSearchQuery);
    search();
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  // Generate project URL based on provider
  const getProjectUrl = (project: UnifiedProject) => {
    if (project.providerId === 'modtale') {
      const titleSlug = project.title.toLowerCase().replace(/\s+/g, '-');
      return `https://modtale.net/modpack/${titleSlug}-${project.id}`;
    } else if (project.providerId === 'curseforge') {
      return `https://www.curseforge.com/hytale/modpacks/${project.slug}`;
    }
    return '#';
  };

  const handleInstallClick = (project: UnifiedProject) => {
    setSelectedProject(project);
    setShowInstallModal(true);
  };

  const handleInstall = async (serverId: string, projectId: string, versionId: string, _providerId: string) => {
    if (!selectedProject) return;

    const server = servers.find(s => s.id === serverId);
    if (!server) return;

    const version = selectedProject.versions?.find(v => v.id === versionId) || selectedProject.latestVersion;

    // Add to installation queue for UI feedback
    const queueId = addToQueue({
      serverId,
      serverName: server.name,
      projectId,
      projectTitle: selectedProject.title,
      projectIconUrl: selectedProject.iconUrl,
      versionId,
      versionName: version?.version || 'Latest',
      classification: selectedProject.classification,
    });

    // Update status to downloading
    const { updateStatus, removeFromQueue } = useInstallationQueueStore.getState();
    updateStatus(queueId, 'downloading');

    toast.success(
      t('modpacks.toast.installing.title'),
      t('modpacks.toast.installing.description', { title: selectedProject.title, server: server.name })
    );

    // Call backend API to actually install the modpack
    try {
      updateStatus(queueId, 'installing');
      await api.installMod(serverId, {
        providerId: selectedProject.providerId,
        projectId,
        projectTitle: selectedProject.title,
        projectIconUrl: selectedProject.iconUrl,
        versionId,
        versionName: version?.version || 'Latest',
        classification: selectedProject.classification,
        fileSize: version?.fileSize || 0,
        fileName: version?.fileName,
      });
      updateStatus(queueId, 'completed');
      toast.success(
        t('modpacks.toast.completed.title'),
        t('modpacks.toast.completed.description', { title: selectedProject.title })
      );

      // Remove from queue after a short delay so user can see completion
      setTimeout(() => removeFromQueue(queueId), 2000);
    } catch (error: any) {
      console.error('Error installing modpack:', error);
      updateStatus(queueId, 'failed', error.message);
      toast.error(t('modpacks.toast.failed.title'), error.message || t('modpacks.toast.failed.description'));

      // Remove failed items after showing error
      setTimeout(() => removeFromQueue(queueId), 5000);
    }
  };

  // DataTable columns
  const columns: Column<UnifiedProject>[] = [
    {
      key: 'title',
      label: t('modpacks.columns.modpack'),
      sortable: true,
      render: (modpack) => (
        <div className="flex items-center gap-3">
          <img
            src={modpack.iconUrl || `https://via.placeholder.com/48/6366f1/ffffff?text=${modpack.title[0]}`}
            alt={modpack.title}
            className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium text-text-light-primary dark:text-text-primary truncate">{modpack.title}</p>
              {selectedProvider === 'all' && <ProviderBadge providerId={modpack.providerId} />}
            </div>
            <p className="text-sm text-text-light-muted dark:text-text-muted truncate">{modpack.description}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'author',
      label: t('modpacks.columns.author'),
      sortable: true,
      render: (modpack) => (
        <span className="whitespace-nowrap">{modpack.author.username}</span>
      ),
    },
    {
      key: 'categories',
      label: t('modpacks.columns.categories'),
      sortable: false,
      className: 'hidden md:table-cell',
      render: (modpack) => (
        <div className="flex flex-wrap gap-1">
          {modpack.categories.slice(0, 2).map((cat) => (
            <Badge key={cat.id} size="sm" variant="info">
              {cat.name}
            </Badge>
          ))}
          {modpack.categories.length > 2 && (
            <Badge size="sm" variant="default">
              +{modpack.categories.length - 2}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'downloads',
      label: t('modpacks.columns.downloads'),
      sortable: true,
      className: 'text-right',
      render: (modpack) => (
        <span className="whitespace-nowrap">{modpack.downloads.toLocaleString()}</span>
      ),
    },
    {
      key: 'rating',
      label: t('modpacks.columns.rating'),
      sortable: true,
      className: 'text-right',
      render: (modpack) => (
        <span className="whitespace-nowrap">{modpack.rating?.toFixed(1) || '-'}</span>
      ),
    },
    {
      key: 'actions',
      label: t('modpacks.columns.actions'),
      sortable: false,
      className: 'text-right',
      render: (modpack) => (
        <div className="flex gap-2 justify-end">
          <Button
            variant="primary"
            size="sm"
            icon={<Download size={14} />}
            onClick={() => handleInstallClick(modpack)}
          >
            {t('modpacks.actions.install')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<ExternalLink size={14} />}
            onClick={() => window.open(getProjectUrl(modpack), '_blank')}
          >
            {t('modpacks.actions.view')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-heading font-bold text-text-light-primary dark:text-text-primary">{t('modpacks.title')}</h1>
          <p className="text-text-light-muted dark:text-text-muted mt-1">
            {t('modpacks.subtitle', {
              count: totalResults,
              available: totalResults > 0 ? `(${totalResults.toLocaleString()} ${t('modpacks.available')})` : '',
            })}
          </p>
        </div>
        <ProviderSelector />
      </div>

      {/* Search and Filters */}
      {isProviderConfigured && (
        <Card variant="glass" className="relative z-10 overflow-visible">
          <CardContent className="py-4 overflow-visible">
            <div className="flex flex-col gap-4">
              {/* Search Bar */}
              <div className="relative">
                <Search size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-text-light-muted dark:text-text-muted" />
                <Input
                  type="text"
                  placeholder={t('modpacks.search.placeholder')}
                  value={localSearchQuery}
                  onChange={(e) => setLocalSearchQuery(e.target.value)}
                  onKeyPress={handleKeyPress}
                  className="pl-10 pr-10"
                />
                {localSearchQuery && (
                  <button
                    onClick={() => setLocalSearchQuery('')}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-text-light-muted dark:text-text-muted hover:text-text-light-primary dark:hover:text-text-primary"
                    title={t('modpacks.search.clear')}
                  >
                    <X size={20} />
                  </button>
                )}
              </div>

              {/* Filter Row */}
              <div className="flex flex-col md:flex-row gap-4 relative z-20">
                {/* Tags Filter */}
                <div className="w-full md:w-48">
                  <SearchableSelect
                    options={uniqueTags}
                    value={filterTags}
                    onChange={(value) => setFilterTags(value as string[])}
                    placeholder={t('modpacks.filters.categories')}
                    searchPlaceholder={t('modpacks.filters.search_categories')}
                    multiple={true}
                    allLabel={t('modpacks.filters.all_categories')}
                  />
                </div>

                {/* Author Filter */}
                <div className="w-full md:w-48">
                  <SearchableSelect
                    options={uniqueAuthors}
                    value={filterAuthor}
                    onChange={(value) => setFilterAuthor(value as string)}
                    placeholder={t('modpacks.filters.authors')}
                    searchPlaceholder={t('modpacks.filters.search_authors')}
                    multiple={false}
                    allLabel={t('modpacks.filters.all_authors')}
                  />
                </div>

                {/* Sort Dropdown */}
                <div className="w-full md:w-48">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as 'downloads' | 'rating' | 'updated')}
                    className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-text-light-primary dark:text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                  >
                    <option value="downloads">{t('modpacks.sort.downloads')}</option>
                    <option value="rating">{t('modpacks.sort.rating')}</option>
                    <option value="updated">{t('modpacks.sort.updated')}</option>
                  </select>
                </div>

                {/* View Toggle */}
                <div className="flex gap-2 md:ml-auto">
                  <button
                    onClick={() => setViewMode('card')}
                    className={`p-2 rounded-lg border transition-colors ${viewMode === 'card'
                      ? 'bg-accent-primary text-white border-accent-primary'
                      : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-text-light-muted dark:text-text-muted hover:text-text-light-primary dark:hover:text-text-primary'
                      }`}
                    title={t('modpacks.view_modes.card')}
                  >
                    <Grid size={20} />
                  </button>
                  <button
                    onClick={() => setViewMode('table')}
                    className={`p-2 rounded-lg border transition-colors ${viewMode === 'table'
                      ? 'bg-accent-primary text-white border-accent-primary'
                      : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-text-light-muted dark:text-text-muted hover:text-text-light-primary dark:hover:text-text-primary'
                      }`}
                    title={t('modpacks.view_modes.table')}
                  >
                    <List size={20} />
                  </button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Provider Not Configured Warning */}
      {!isProviderConfigured && (
        <Card variant="glass">
          <CardContent>
            <div className="flex items-center gap-4 py-4">
              <AlertCircle size={32} className="text-warning" />
              <div className="flex-1">
                <h3 className="font-heading font-semibold text-text-light-primary dark:text-text-primary">
                  {selectedProvider === 'all'
                    ? t('modpacks.no_providers')
                    : t('modpacks.provider_not_configured', {
                      provider: providers.find(p => p.id === selectedProvider)?.displayName || t('modpacks.provider'),
                    })}
                </h3>
                <p className="text-sm text-text-light-muted dark:text-text-muted mt-1">
                  {t('modpacks.configure_hint')}
                </p>
              </div>
              <Button
                variant="primary"
                icon={<Settings size={18} />}
                onClick={() => navigate('/settings')}
              >
                {t('modpacks.actions.configure_providers')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading State */}
      {searchLoading && (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-accent-primary border-t-transparent"></div>
          <p className="text-text-light-muted dark:text-text-muted mt-4">{t('modpacks.loading')}</p>
        </div>
      )}

      {/* Error State */}
      {searchError && !searchLoading && (
        <Card variant="glass">
          <CardContent>
            <div className="flex items-center gap-4 py-4">
              <AlertCircle size={32} className="text-danger" />
              <div className="flex-1">
                <h3 className="font-heading font-semibold text-text-light-primary dark:text-text-primary">
                  {t('modpacks.error.title')}
                </h3>
                <p className="text-sm text-text-light-muted dark:text-text-muted mt-1">{searchError}</p>
              </div>
              <Button variant="secondary" onClick={() => search()}>
                {t('modpacks.actions.retry')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Modpacks List */}
      {isProviderConfigured && !searchLoading && !searchError && (
        <div className="space-y-4">
          {/* Card View */}
          {viewMode === 'card' && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {paginatedModpacks.map((modpack) => (
                  <Card key={`${modpack.providerId}-${modpack.id}`} variant="glass" hover>
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <img
                          src={modpack.iconUrl || `https://via.placeholder.com/48/6366f1/ffffff?text=${modpack.title[0]}`}
                          alt={modpack.title}
                          className="w-12 h-12 rounded-lg object-cover"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <CardTitle className="truncate">{modpack.title}</CardTitle>
                            {selectedProvider === 'all' && <ProviderBadge providerId={modpack.providerId} />}
                          </div>
                          <CardDescription className="truncate">{modpack.author.username}</CardDescription>
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-3">
                      <p className="text-sm text-text-light-muted dark:text-text-muted line-clamp-2">{modpack.description}</p>

                      {/* Categories */}
                      {modpack.categories && modpack.categories.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {modpack.categories.slice(0, 3).map((cat) => (
                            <Badge key={cat.id} size="sm" variant="info">
                              {cat.name}
                            </Badge>
                          ))}
                          {modpack.categories.length > 3 && (
                            <Badge size="sm" variant="default">
                              {t('modpacks.more_categories', { count: modpack.categories.length - 3 })}
                            </Badge>
                          )}
                        </div>
                      )}

                      <div className="flex items-center justify-between text-sm">
                        <span className="text-text-light-muted dark:text-text-muted">
                          {modpack.rating?.toFixed(1) || '-'}
                        </span>
                        <span className="text-text-light-muted dark:text-text-muted">
                          {t('modpacks.downloads', { downloads: modpack.downloads.toLocaleString() })}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          icon={<Download size={14} />}
                          className="flex-1"
                          onClick={() => handleInstallClick(modpack)}
                        >
                          {t('modpacks.actions.install')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<ExternalLink size={14} />}
                          onClick={() => window.open(getProjectUrl(modpack), '_blank')}
                        >
                          {t('modpacks.actions.view')}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Card View Pagination */}
              {totalCardPages > 1 && (
                <div className="flex items-center justify-between mt-6 px-2">
                  <span className="text-sm text-text-light-muted dark:text-text-muted">
                    {t('table.pagination.showing', {
                      start: (cardPage - 1) * CARD_PAGE_SIZE + 1,
                      end: Math.min(cardPage * CARD_PAGE_SIZE, filteredModpacks.length),
                      total: filteredModpacks.length,
                    })}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<ChevronLeft size={16} />}
                      onClick={() => setSearchPage(Math.max(1, cardPage - 1))}
                      disabled={cardPage === 1}
                    >
                      {t('table.pagination.previous')}
                    </Button>
                    <span className="text-sm text-text-light-muted dark:text-text-muted px-2">
                      {t('table.pagination.page_of', { page: cardPage, total: totalCardPages })}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<ChevronRight size={16} />}
                      onClick={() => setSearchPage(Math.min(totalCardPages, cardPage + 1))}
                      disabled={cardPage === totalCardPages}
                    >
                      {t('table.pagination.next')}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Table View */}
          {viewMode === 'table' && (
            <DataTable
              data={filteredModpacks}
              columns={columns}
              keyExtractor={(modpack) => `${modpack.providerId}-${modpack.id}`}
              itemsPerPage={10}
              searchable={true}
              exportable={true}
            />
          )}

          {filteredModpacks.length === 0 && (
            <div className="text-center py-12">
              <p className="text-text-light-muted dark:text-text-muted">{t('modpacks.empty')}</p>
            </div>
          )}
        </div>
      )}

      {/* Server Selection Modal */}
      <ServerSelectionModal
        isOpen={showInstallModal}
        onClose={() => setShowInstallModal(false)}
        project={selectedProject}
        onInstall={handleInstall}
      />
    </div>
  );
};
