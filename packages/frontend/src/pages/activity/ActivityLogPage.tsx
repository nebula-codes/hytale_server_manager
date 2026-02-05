import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Button,
  Badge,
} from '../../components/ui';
import { DataTable, type Column } from '../../components/ui/DataTable';
import {
  History,
  RefreshCw,
  User,
  Server,
  Shield,
  AlertCircle,
  CheckCircle,
  XCircle,
  Filter,
  Search,
} from 'lucide-react';
import { useActivityLogs, type ActivityLogEntry, type ActivityLogFilters } from '../../hooks/api';
import { formatDistanceToNow } from 'date-fns';

/**
 * Human-readable action labels
 */
const ACTION_LABELS: Record<string, string> = {
  'auth:login': 'activity.actions.auth_login',
  'auth:logout': 'activity.actions.auth_logout',
  'auth:password_change': 'activity.actions.auth_password_change',
  'auth:login_failed': 'activity.actions.auth_login_failed',
  'server:create': 'activity.actions.server_create',
  'server:update': 'activity.actions.server_update',
  'server:delete': 'activity.actions.server_delete',
  'server:start': 'activity.actions.server_start',
  'server:stop': 'activity.actions.server_stop',
  'server:restart': 'activity.actions.server_restart',
  'server:kill': 'activity.actions.server_kill',
  'server:command': 'activity.actions.server_command',
  'backup:create': 'activity.actions.backup_create',
  'backup:restore': 'activity.actions.backup_restore',
  'backup:delete': 'activity.actions.backup_delete',
  'player:kick': 'activity.actions.player_kick',
  'player:ban': 'activity.actions.player_ban',
  'player:unban': 'activity.actions.player_unban',
  'mod:install': 'activity.actions.mod_install',
  'mod:uninstall': 'activity.actions.mod_uninstall',
  'mod:enable': 'activity.actions.mod_enable',
  'mod:disable': 'activity.actions.mod_disable',
  'world:activate': 'activity.actions.world_activate',
  'world:delete': 'activity.actions.world_delete',
  'automation:create': 'activity.actions.automation_create',
  'automation:delete': 'activity.actions.automation_delete',
  'automation:execute': 'activity.actions.automation_execute',
  'network:create': 'activity.actions.network_create',
  'network:delete': 'activity.actions.network_delete',
  'settings:update': 'activity.actions.settings_update',
  'user:create': 'activity.actions.user_create',
  'user:delete': 'activity.actions.user_delete',
};

/**
 * Category colors for badges - mapped to available Badge variants
 */
const CATEGORY_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  auth: 'info',
  server: 'info',
  backup: 'success',
  player: 'warning',
  mod: 'info',
  world: 'info',
  automation: 'success',
  network: 'info',
  user: 'info',
  settings: 'default',
};

/**
 * Get human-readable action label
 */
function getActionLabel(action: string, translate: (key: string, opts?: Record<string, unknown>) => string): string {
  const key = ACTION_LABELS[action];
  return key ? translate(key) : action.replace(':', ' ').replace(/_/g, ' ');
}

/**
 * Get category icon
 */
function getCategoryIcon(category: string) {
  switch (category) {
    case 'auth':
      return <Shield size={14} />;
    case 'server':
      return <Server size={14} />;
    case 'user':
      return <User size={14} />;
    default:
      return <History size={14} />;
  }
}

export const ActivityLogPage = () => {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<ActivityLogFilters>({
    page: 1,
    limit: 20,
    sortBy: 'timestamp',
    sortOrder: 'desc',
  });
  const [searchValue, setSearchValue] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Build complete filters
  const queryFilters = useMemo(() => ({
    ...filters,
    search: searchValue || undefined,
    actionCategory: categoryFilter || undefined,
    status: (statusFilter as 'success' | 'failed') || undefined,
  }), [filters, searchValue, categoryFilter, statusFilter]);

  const { data, isLoading, refetch, isFetching } = useActivityLogs(queryFilters);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setFilters(prev => ({ ...prev, page: 1 }));
  };

  const handlePageChange = (page: number) => {
    setFilters(prev => ({ ...prev, page }));
  };

  const categories = useMemo(() => ([
    { value: '', label: t('activity.filters.all_categories') },
    { value: 'auth', label: t('activity.filters.categories.auth') },
    { value: 'server', label: t('activity.filters.categories.server') },
    { value: 'backup', label: t('activity.filters.categories.backup') },
    { value: 'player', label: t('activity.filters.categories.player') },
    { value: 'mod', label: t('activity.filters.categories.mod') },
    { value: 'world', label: t('activity.filters.categories.world') },
    { value: 'automation', label: t('activity.filters.categories.automation') },
    { value: 'network', label: t('activity.filters.categories.network') },
    { value: 'user', label: t('activity.filters.categories.user') },
    { value: 'settings', label: t('activity.filters.categories.settings') },
  ]), [t]);

  const columns: Column<ActivityLogEntry>[] = [
    {
      key: 'timestamp',
      label: t('activity.table.time'),
      sortable: true,
      render: (entry) => (
        <span className="text-text-secondary text-sm">
          {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
        </span>
      ),
    },
    {
      key: 'username',
      label: t('activity.table.user'),
      sortable: true,
      render: (entry) => (
        <div className="flex items-center gap-2">
          <User size={14} className="text-text-muted" />
          <span className="font-medium">{entry.username}</span>
          <Badge variant="default" className="text-xs">
            {entry.userRole}
          </Badge>
        </div>
      ),
    },
    {
      key: 'action',
      label: t('activity.table.action'),
      sortable: true,
      render: (entry) => (
        <div className="flex items-center gap-2">
          <Badge variant={CATEGORY_COLORS[entry.actionCategory] || 'default'}>
            <span className="flex items-center gap-1">
              {getCategoryIcon(entry.actionCategory)}
              {categories.find((cat) => cat.value === entry.actionCategory)?.label || entry.actionCategory}
            </span>
          </Badge>
          <span>{getActionLabel(entry.action, t)}</span>
        </div>
      ),
    },
    {
      key: 'resourceName',
      label: t('activity.table.resource'),
      render: (entry) => (
        <span className="text-text-secondary">
          {entry.resourceName || entry.resourceId || '-'}
        </span>
      ),
    },
    {
      key: 'status',
      label: t('activity.table.status'),
      render: (entry) => (
        <div className="flex items-center gap-1">
          {entry.status === 'success' ? (
            <>
              <CheckCircle size={14} className="text-green-500" />
              <span className="text-green-600">{t('activity.status.success')}</span>
            </>
          ) : (
            <>
              <XCircle size={14} className="text-red-500" />
              <span className="text-red-600">{t('activity.status.failed')}</span>
            </>
          )}
        </div>
      ),
    },
    {
      key: 'ipAddress',
      label: t('activity.table.ip_address'),
      render: (entry) => (
        <span className="text-text-muted text-sm font-mono">
          {entry.ipAddress || '-'}
        </span>
      ),
    },
  ];


  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-text-primary flex items-center gap-2">
          <History className="text-primary" />
          {t('activity.title')}
        </h1>
        <p className="text-text-secondary mt-1">
          {t('activity.subtitle')}
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>{t('activity.history.title')}</CardTitle>
              <CardDescription>
                {t('activity.history.total', { count: data?.pagination.total || 0 })}
              </CardDescription>
            </div>
            <Button
              onClick={() => refetch()}
              disabled={isFetching}
              variant="secondary"
            >
              <RefreshCw className={isFetching ? 'animate-spin' : ''} size={16} />
              {t('common.refresh')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex flex-wrap gap-4 mb-6">
            <form onSubmit={handleSearch} className="flex gap-2">
              <div className="relative">
                <Search
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
                />
                <input
                  type="text"
                  placeholder={t('activity.filters.search_placeholder')}
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  className="pl-9 pr-4 py-2 border border-border rounded-lg bg-background text-text-primary w-64 focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <Button type="submit" variant="secondary">
                {t('activity.filters.search')}
              </Button>
            </form>

            <div className="flex items-center gap-2">
              <Filter size={16} className="text-text-muted" />
              <select
                value={categoryFilter}
                onChange={(e) => {
                  setCategoryFilter(e.target.value);
                  setFilters(prev => ({ ...prev, page: 1 }));
                }}
                className="px-3 py-2 border border-border rounded-lg bg-background text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {categories.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setFilters(prev => ({ ...prev, page: 1 }));
                }}
                className="px-3 py-2 border border-border rounded-lg bg-background text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">{t('activity.filters.statuses.all')}</option>
                <option value="success">{t('activity.status.success')}</option>
                <option value="failed">{t('activity.status.failed')}</option>
              </select>
            </div>
          </div>

          {/* Data Table */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="animate-spin text-primary" size={24} />
              <span className="ml-2 text-text-secondary">{t('activity.loading')}</span>
            </div>
          ) : data?.data && data.data.length > 0 ? (
            <>
              <DataTable<ActivityLogEntry>
                data={data.data}
                columns={columns}
                keyExtractor={(item) => item.id}
              />

              {/* Pagination */}
              {data.pagination.totalPages > 1 && (
                <div className="flex justify-center items-center gap-2 mt-6">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handlePageChange(data.pagination.page - 1)}
                    disabled={data.pagination.page <= 1}
                  >
                    {t('table.pagination.previous')}
                  </Button>
                  <span className="text-text-secondary px-4">
                    {t('table.pagination.page_of', { page: data.pagination.page, total: data.pagination.totalPages })}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handlePageChange(data.pagination.page + 1)}
                    disabled={data.pagination.page >= data.pagination.totalPages}
                  >
                    {t('table.pagination.next')}
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12">
              <AlertCircle size={48} className="mx-auto text-text-muted mb-4" />
              <p className="text-text-secondary">{t('activity.empty.title')}</p>
              <p className="text-text-muted text-sm mt-1">
                {t('activity.empty.subtitle')}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ActivityLogPage;
