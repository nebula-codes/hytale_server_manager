import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Badge, DataTable, type Column } from '../../components/ui';
import { Plus, Play, Pause, Trash2, Clock, Command, Database, RotateCw, PlayCircle, Pencil, Layers, ListOrdered } from 'lucide-react';
import { useToast } from '../../stores/toastStore';
import { api } from '../../services/api';
import { CreateTaskModal } from './CreateTaskModal';
import { TaskGroupModal } from './TaskGroupModal';

interface Server {
  id: string;
  name: string;
  status: string;
}

interface ScheduledTask {
  id: string;
  serverId: string;
  name: string;
  type: 'backup' | 'restart' | 'start' | 'stop' | 'command';
  cronExpression: string;
  taskData: string | null;
  enabled: boolean;
  backupLimit: number;
  lastRun: Date | null;
  lastStatus: 'success' | 'failed' | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  server: {
    id: string;
    name: string;
  };
}

interface TaskGroupMember {
  id: string;
  groupId: string;
  taskId: string;
  sortOrder: number;
  task: ScheduledTask;
}

interface TaskGroup {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  cronExpression: string;
  failureMode: 'stop' | 'continue';
  delayBetweenTasks: number;
  lastRun: Date | null;
  lastStatus: 'success' | 'failed' | 'partial' | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  taskMemberships: TaskGroupMember[];
}

type TabType = 'tasks' | 'groups';

export const AutomationPage = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabType>('tasks');
  const [servers, setServers] = useState<Server[]>([]);
  const [selectedServer, setSelectedServer] = useState<string>('all');

  // Tasks state
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null);
  const [selectedTasks, setSelectedTasks] = useState<ScheduledTask[]>([]);
  const [deletingMultiple, setDeletingMultiple] = useState(false);

  // Task Groups state
  const [taskGroups, setTaskGroups] = useState<TaskGroup[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<TaskGroup | null>(null);
  const [selectedGroups, setSelectedGroups] = useState<TaskGroup[]>([]);
  const [deletingMultipleGroups, setDeletingMultipleGroups] = useState(false);

  // Memoize callbacks to prevent infinite loops in DataTable
  const handleSelectionChange = useCallback((items: ScheduledTask[]) => {
    setSelectedTasks(items);
  }, []);

  const handleGroupSelectionChange = useCallback((items: TaskGroup[]) => {
    setSelectedGroups(items);
  }, []);

  const keyExtractor = useCallback((task: ScheduledTask) => task.id, []);
  const groupKeyExtractor = useCallback((group: TaskGroup) => group.id, []);

  // Fetch servers on mount
  useEffect(() => {
    fetchServers();
    fetchTaskGroups();
  }, []);

  // Fetch tasks when selectedServer changes OR when servers are loaded
  useEffect(() => {
    if (selectedServer === 'all' && servers.length === 0) {
      return; // Wait for servers to load
    }
    fetchTasks();
  }, [selectedServer, servers.length]);

  const fetchServers = async () => {
    try {
      const data = await api.getServers();
      setServers(data.map((s: any) => ({ id: s.id, name: s.name, status: s.status })));
    } catch (error) {
      console.error('Error fetching servers:', error);
      toast.error(t('automation.toast.load_servers.title'), t('automation.toast.load_servers.description'));
    }
  };

  const fetchTasks = async () => {
    try {
      setLoadingTasks(true);
      let data: ScheduledTask[];
      if (selectedServer === 'all') {
        // Fetch tasks for all servers
        const allTasks: ScheduledTask[] = [];
        for (const server of servers) {
          const serverTasks = await api.getServerTasks<ScheduledTask>(server.id);
          allTasks.push(...serverTasks);
        }
        data = allTasks;
      } else {
        data = await api.getServerTasks<ScheduledTask>(selectedServer);
      }
      setTasks(data);
    } catch (error) {
      console.error('Error fetching tasks:', error);
      toast.error(t('automation.toast.load_tasks.title'), t('automation.toast.load_tasks.description'));
    } finally {
      setLoadingTasks(false);
    }
  };

  const fetchTaskGroups = async () => {
    try {
      setLoadingGroups(true);
      const data = await api.getTaskGroups<TaskGroup>();
      setTaskGroups(data);
    } catch (error) {
      console.error('Error fetching task groups:', error);
      toast.error(t('automation.toast.load_groups.title'), t('automation.toast.load_groups.description'));
    } finally {
      setLoadingGroups(false);
    }
  };

  // Task handlers
  const handleToggleTask = async (taskId: string, currentEnabled: boolean) => {
    try {
      await api.toggleTask(taskId, !currentEnabled);
      toast.success(currentEnabled ? t('automation.toast.task_disabled') : t('automation.toast.task_enabled'));
      await fetchTasks();
    } catch (error: any) {
      console.error('Error toggling task:', error);
      toast.error(t('automation.toast.toggle_task_failed.title'), error.message || t('automation.toast.generic_error'));
    }
  };

  const handleRunNow = async (taskId: string) => {
    try {
      await api.runTaskNow(taskId);
      toast.success(t('automation.toast.task_executed.title'), t('automation.toast.task_executed.description'));
      await fetchTasks();
    } catch (error: any) {
      console.error('Error running task:', error);
      toast.error(t('automation.toast.run_task_failed.title'), error.message || t('automation.toast.generic_error'));
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm(t('automation.confirm.delete_task'))) return;

    try {
      await api.deleteTask(taskId);
      toast.success(t('automation.toast.task_deleted.title'), t('automation.toast.task_deleted.description'));
      await fetchTasks();
    } catch (error: any) {
      console.error('Error deleting task:', error);
      toast.error(t('automation.toast.delete_task_failed.title'), error.message || t('automation.toast.generic_error'));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedTasks.length === 0) return;

    if (!confirm(t('automation.confirm.bulk_delete_tasks', { count: selectedTasks.length }))) {
      return;
    }

    setDeletingMultiple(true);
    let deleted = 0;
    let failed = 0;

    for (const task of selectedTasks) {
      try {
        await api.deleteTask(task.id);
        deleted++;
      } catch (error) {
        failed++;
      }
    }

    if (deleted > 0) {
      toast.success(
        t('automation.toast.bulk_tasks_deleted.title', { count: deleted }),
        failed > 0 ? t('automation.toast.bulk_tasks_deleted.description', { failed }) : undefined
      );
    }
    if (failed > 0 && deleted === 0) {
      toast.error(t('automation.toast.bulk_tasks_failed.title'), t('automation.toast.bulk_tasks_failed.description', { failed }));
    }

    await fetchTasks();
    setSelectedTasks([]);
    setDeletingMultiple(false);
  };

  const handleCreateTask = async (serverId: string, data: any) => {
    await api.createTask(serverId, data);
    toast.success(t('automation.toast.task_created.title'), t('automation.toast.task_created.description'));
    await fetchTasks();
    setShowCreateModal(false);
  };

  const handleUpdateTask = async (taskId: string, data: any) => {
    await api.updateTask(taskId, data);
    toast.success(t('automation.toast.task_updated.title'), t('automation.toast.task_updated.description'));
    await fetchTasks();
    setEditingTask(null);
    setShowCreateModal(false);
  };

  const handleEditTask = (task: ScheduledTask) => {
    setEditingTask(task);
    setShowCreateModal(true);
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
    setEditingTask(null);
  };

  // Task Group handlers
  const handleToggleGroup = async (groupId: string, currentEnabled: boolean) => {
    try {
      await api.toggleTaskGroup(groupId, !currentEnabled);
      toast.success(currentEnabled ? t('automation.toast.group_disabled') : t('automation.toast.group_enabled'));
      await fetchTaskGroups();
    } catch (error: any) {
      console.error('Error toggling task group:', error);
      toast.error(t('automation.toast.toggle_group_failed.title'), error.message || t('automation.toast.generic_error'));
    }
  };

  const handleRunGroupNow = async (groupId: string) => {
    try {
      toast.info(t('automation.toast.group_running.title'), t('automation.toast.group_running.description'));
      await api.runTaskGroupNow(groupId);
      toast.success(t('automation.toast.group_executed.title'), t('automation.toast.group_executed.description'));
      await fetchTaskGroups();
    } catch (error: any) {
      console.error('Error running task group:', error);
      toast.error(t('automation.toast.run_group_failed.title'), error.message || t('automation.toast.generic_error'));
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!confirm(t('automation.confirm.delete_group'))) return;

    try {
      await api.deleteTaskGroup(groupId);
      toast.success(t('automation.toast.group_deleted.title'), t('automation.toast.group_deleted.description'));
      await fetchTaskGroups();
    } catch (error: any) {
      console.error('Error deleting task group:', error);
      toast.error(t('automation.toast.delete_group_failed.title'), error.message || t('automation.toast.generic_error'));
    }
  };

  const handleBulkDeleteGroups = async () => {
    if (selectedGroups.length === 0) return;

    if (!confirm(t('automation.confirm.bulk_delete_groups', { count: selectedGroups.length }))) {
      return;
    }

    setDeletingMultipleGroups(true);
    let deleted = 0;
    let failed = 0;

    for (const group of selectedGroups) {
      try {
        await api.deleteTaskGroup(group.id);
        deleted++;
      } catch (error) {
        failed++;
      }
    }

    if (deleted > 0) {
      toast.success(
        t('automation.toast.bulk_groups_deleted.title', { count: deleted }),
        failed > 0 ? t('automation.toast.bulk_groups_deleted.description', { failed }) : undefined
      );
    }
    if (failed > 0 && deleted === 0) {
      toast.error(t('automation.toast.bulk_groups_failed.title'), t('automation.toast.bulk_groups_failed.description', { failed }));
    }

    await fetchTaskGroups();
    setSelectedGroups([]);
    setDeletingMultipleGroups(false);
  };

  const handleCreateGroup = async (data: any) => {
    await api.createTaskGroup(data);
    toast.success(t('automation.toast.group_created.title'), t('automation.toast.group_created.description'));
    await fetchTaskGroups();
    setShowGroupModal(false);
  };

  const handleUpdateGroup = async (groupId: string, data: any) => {
    await api.updateTaskGroup(groupId, data);
    toast.success(t('automation.toast.group_updated.title'), t('automation.toast.group_updated.description'));
    await fetchTaskGroups();
    setEditingGroup(null);
    setShowGroupModal(false);
  };

  const handleEditGroup = (group: TaskGroup) => {
    setEditingGroup(group);
    setShowGroupModal(true);
  };

  const handleCloseGroupModal = () => {
    setShowGroupModal(false);
    setEditingGroup(null);
  };

  const formatCron = (cron: string): string => {
    if (cron === '0 * * * *') return t('automation.cron.every_hour');
    if (cron === '0 0 * * *') return t('automation.cron.daily_midnight');
    if (cron === '0 0 * * 0') return t('automation.cron.weekly_sunday');
    if (cron === '*/5 * * * *') return t('automation.cron.every_5_minutes');
    if (cron === '*/15 * * * *') return t('automation.cron.every_15_minutes');
    if (cron === '*/30 * * * *') return t('automation.cron.every_30_minutes');
    if (cron === '0 */6 * * *') return t('automation.cron.every_6_hours');
    if (cron === '0 12 * * *') return t('automation.cron.daily_noon');
    if (cron === '0 0 * * 1') return t('automation.cron.weekly_monday');
    return cron;
  };

  // Task columns
  const taskColumns: Column<ScheduledTask>[] = [
    {
      key: 'name',
      label: t('automation.table.task'),
      render: (task) => (
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${task.enabled ? 'bg-success/20' : 'bg-gray-200 dark:bg-gray-800'}`}>
            {task.type === 'command' && <Command size={16} />}
            {task.type === 'restart' && <RotateCw size={16} />}
            {task.type === 'backup' && <Database size={16} />}
            {task.type === 'start' && <Play size={16} />}
            {task.type === 'stop' && <Pause size={16} />}
          </div>
          <div>
            <p className="font-medium text-text-light-primary dark:text-text-primary">{task.name}</p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/servers/${task.server.id}`);
              }}
              className="text-xs text-accent-primary hover:text-accent-primary/80 hover:underline transition-colors text-left"
            >
              {task.server.name}
            </button>
          </div>
        </div>
      ),
    },
    {
      key: 'type',
      label: t('automation.table.type'),
      render: (task) => (
        <Badge variant="default" size="sm">{task.type}</Badge>
      ),
    },
    {
      key: 'cronExpression',
      label: t('automation.table.schedule'),
      render: (task) => (
        <Badge variant="info" size="sm">{formatCron(task.cronExpression)}</Badge>
      ),
    },
    {
      key: 'enabled',
      label: t('automation.table.status'),
      render: (task) => (
        <Badge variant={task.enabled ? 'success' : 'default'} size="sm">
          {task.enabled ? t('automation.status.active') : t('automation.status.disabled')}
        </Badge>
      ),
    },
    {
      key: 'lastRun',
      label: t('automation.table.last_run'),
      render: (task) => (
        <div>
          <p className="text-sm">{task.lastRun ? new Date(task.lastRun).toLocaleDateString() : t('automation.status.never')}</p>
          {task.lastRun && (
            <p className="text-xs text-text-light-muted dark:text-text-muted">
              {new Date(task.lastRun).toLocaleTimeString()}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'lastStatus',
      label: t('automation.table.result'),
      render: (task) => {
        if (!task.lastRun) {
          return <Badge variant="default" size="sm">{t('automation.status.never_run')}</Badge>;
        }
        if (task.lastStatus === 'success') {
          return <Badge variant="success" size="sm">{t('automation.status.success')}</Badge>;
        }
        if (task.lastStatus === 'failed') {
          return <Badge variant="danger" size="sm">{t('automation.status.failed')}</Badge>;
        }
        return <Badge variant="default" size="sm">{t('automation.status.unknown')}</Badge>;
      },
    },
    {
      key: 'actions',
      label: t('automation.table.actions'),
      sortable: false,
      render: (task) => (
        <div className="flex gap-1">
          <Button
            variant={task.enabled ? 'ghost' : 'success'}
            size="sm"
            icon={task.enabled ? <Pause size={14} /> : <Play size={14} />}
            onClick={(e) => {
              e.stopPropagation();
              handleToggleTask(task.id, task.enabled);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={<PlayCircle size={14} />}
            onClick={(e) => {
              e.stopPropagation();
              handleRunNow(task.id);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={<Pencil size={14} />}
            onClick={(e) => {
              e.stopPropagation();
              handleEditTask(task);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 size={14} />}
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteTask(task.id);
            }}
          />
        </div>
      ),
    },
  ];

  // Task Group columns
  const groupColumns: Column<TaskGroup>[] = [
    {
      key: 'name',
      label: t('automation.table.group'),
      render: (group) => (
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${group.enabled ? 'bg-accent-primary/20' : 'bg-gray-200 dark:bg-gray-800'}`}>
            <Layers size={16} />
          </div>
          <div>
            <p className="font-medium text-text-light-primary dark:text-text-primary">{group.name}</p>
            {group.description && (
              <p className="text-xs text-text-light-muted dark:text-text-muted truncate max-w-[200px]">
                {group.description}
              </p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'taskMemberships',
      label: t('automation.table.tasks'),
      render: (group) => (
        <div className="flex items-center gap-2">
          <Badge variant="info" size="sm">{t('automation.table.task_count', { count: group.taskMemberships.length })}</Badge>
        </div>
      ),
    },
    {
      key: 'cronExpression',
      label: t('automation.table.schedule'),
      render: (group) => (
        <Badge variant="info" size="sm">{formatCron(group.cronExpression)}</Badge>
      ),
    },
    {
      key: 'delayBetweenTasks',
      label: t('automation.table.delay'),
      render: (group) => (
        <span className="text-sm text-text-light-muted dark:text-text-muted">
          {group.delayBetweenTasks > 0 ? `${group.delayBetweenTasks}s` : t('automation.status.none')}
        </span>
      ),
    },
    {
      key: 'failureMode',
      label: t('automation.table.on_failure'),
      render: (group) => (
        <Badge variant={group.failureMode === 'stop' ? 'warning' : 'default'} size="sm">
          {group.failureMode === 'stop' ? t('automation.failure.stop') : t('automation.failure.continue')}
        </Badge>
      ),
    },
    {
      key: 'enabled',
      label: t('automation.table.status'),
      render: (group) => (
        <Badge variant={group.enabled ? 'success' : 'default'} size="sm">
          {group.enabled ? t('automation.status.active') : t('automation.status.disabled')}
        </Badge>
      ),
    },
    {
      key: 'lastRun',
      label: t('automation.table.last_run'),
      render: (group) => (
        <div>
          <p className="text-sm">{group.lastRun ? new Date(group.lastRun).toLocaleDateString() : t('automation.status.never')}</p>
          {group.lastRun && (
            <p className="text-xs text-text-light-muted dark:text-text-muted">
              {new Date(group.lastRun).toLocaleTimeString()}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'lastStatus',
      label: t('automation.table.result'),
      render: (group) => {
        if (!group.lastRun) {
          return <Badge variant="default" size="sm">{t('automation.status.never_run')}</Badge>;
        }
        if (group.lastStatus === 'success') {
          return <Badge variant="success" size="sm">{t('automation.status.success')}</Badge>;
        }
        if (group.lastStatus === 'failed') {
          return <Badge variant="danger" size="sm">{t('automation.status.failed')}</Badge>;
        }
        if (group.lastStatus === 'partial') {
          return <Badge variant="warning" size="sm">{t('automation.status.partial')}</Badge>;
        }
        return <Badge variant="default" size="sm">{t('automation.status.unknown')}</Badge>;
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      sortable: false,
      render: (group) => (
        <div className="flex gap-1">
          <Button
            variant={group.enabled ? 'ghost' : 'success'}
            size="sm"
            icon={group.enabled ? <Pause size={14} /> : <Play size={14} />}
            onClick={(e) => {
              e.stopPropagation();
              handleToggleGroup(group.id, group.enabled);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={<PlayCircle size={14} />}
            onClick={(e) => {
              e.stopPropagation();
              handleRunGroupNow(group.id);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={<Pencil size={14} />}
            onClick={(e) => {
              e.stopPropagation();
              handleEditGroup(group);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 size={14} />}
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteGroup(group.id);
            }}
          />
        </div>
      ),
    },
  ];

  const activeTasks = tasks.filter(t => t.enabled).length;
  const successfulTasks = tasks.filter(t => t.lastStatus === 'success').length;
  const failedTasks = tasks.filter(t => t.lastStatus === 'failed').length;

  const activeGroups = taskGroups.filter(g => g.enabled).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-heading font-bold text-text-light-primary dark:text-text-primary">{t('automation.title')}</h1>
          <p className="text-text-light-muted dark:text-text-muted mt-1">{t('automation.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          {activeTab === 'tasks' && (
            <Button variant="primary" icon={<Plus size={18} />} onClick={() => setShowCreateModal(true)}>
              {t('automation.buttons.create_task')}
            </Button>
          )}
          {activeTab === 'groups' && (
            <Button variant="primary" icon={<Plus size={18} />} onClick={() => setShowGroupModal(true)}>
              {t('automation.buttons.create_group')}
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white dark:bg-primary-bg-secondary p-1 rounded-lg w-fit">
        <button
          onClick={() => setActiveTab('tasks')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${activeTab === 'tasks'
              ? 'bg-accent-primary text-black'
              : 'text-text-light-muted dark:text-text-muted hover:text-text-light-primary dark:hover:text-text-primary'
            }`}
        >
          <Clock size={16} />
          {t('automation.tabs.tasks', { count: tasks.length })}
        </button>
        <button
          onClick={() => setActiveTab('groups')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${activeTab === 'groups'
              ? 'bg-accent-primary text-black'
              : 'text-text-light-muted dark:text-text-muted hover:text-text-light-primary dark:hover:text-text-primary'
            }`}
        >
          <Layers size={16} />
          {t('automation.tabs.groups', { count: taskGroups.length })}
        </button>
      </div>

      {/* Tasks Tab Content */}
      {activeTab === 'tasks' && (
        <>
          {/* Server Selector */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm text-text-light-muted dark:text-text-muted">{t('automation.server_selector.label')}</span>
            <button
              onClick={() => setSelectedServer('all')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${selectedServer === 'all'
                  ? 'bg-accent-primary text-black'
                  : 'bg-white dark:bg-primary-bg-secondary text-text-light-muted dark:text-text-muted hover:text-text-light-primary dark:hover:text-text-primary'
                }`}
            >
              {t('automation.server_selector.all_servers')}
            </button>
            {servers.map((server) => (
              <button
                key={server.id}
                onClick={() => setSelectedServer(server.id)}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${selectedServer === server.id
                    ? 'bg-accent-primary text-black'
                    : 'bg-white dark:bg-primary-bg-secondary text-text-light-muted dark:text-text-muted hover:text-text-light-primary dark:hover:text-text-primary'
                  }`}
              >
                {server.name}
              </button>
            ))}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card variant="glass">
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-text-light-muted dark:text-text-muted text-sm">{t('automation.stats.total_tasks')}</p>
                    <p className="text-3xl font-heading font-bold text-text-light-primary dark:text-text-primary mt-1">{tasks.length}</p>
                  </div>
                  <Clock size={32} className="text-accent-primary" />
                </div>
              </CardContent>
            </Card>
            <Card variant="glass">
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-text-light-muted dark:text-text-muted text-sm">{t('automation.stats.active')}</p>
                    <p className="text-3xl font-heading font-bold text-success mt-1">{activeTasks}</p>
                  </div>
                  <Play size={32} className="text-success" />
                </div>
              </CardContent>
            </Card>
            <Card variant="glass">
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-text-light-muted dark:text-text-muted text-sm">{t('automation.stats.successful')}</p>
                    <p className="text-3xl font-heading font-bold text-success mt-1">{successfulTasks}</p>
                  </div>
                  <PlayCircle size={32} className="text-success" />
                </div>
              </CardContent>
            </Card>
            <Card variant="glass">
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-text-light-muted dark:text-text-muted text-sm">{t('automation.stats.failed')}</p>
                    <p className="text-3xl font-heading font-bold text-danger mt-1">{failedTasks}</p>
                  </div>
                  <Pause size={32} className="text-danger" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tasks List */}
          <Card variant="glass">
            <CardHeader>
              <CardTitle>
                {selectedServer === 'all'
                  ? t('automation.cards.all_tasks')
                  : t('automation.cards.server_tasks', { server: servers.find(s => s.id === selectedServer)?.name })}
                {loadingTasks ? ` (${t('common.loading')})` : ''}
              </CardTitle>
              <CardDescription>{t('automation.cards.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              {tasks.length === 0 && !loadingTasks ? (
                <div className="text-center py-12 text-text-light-muted dark:text-text-muted">
                  <Clock size={48} className="mx-auto mb-4 opacity-50" />
                  <p>{t('automation.empty.title')}</p>
                  <Button variant="primary" className="mt-4" icon={<Plus size={16} />} onClick={() => setShowCreateModal(true)}>
                    {t('automation.empty.button')}
                  </Button>
                </div>
              ) : (
                <DataTable
                  data={tasks}
                  columns={taskColumns}
                  keyExtractor={keyExtractor}
                  itemsPerPage={10}
                  searchable
                  exportable
                  selectable
                  onSelectionChange={handleSelectionChange}
                  bulkActions={
                    <Button
                      variant="danger"
                      size="sm"
                      icon={<Trash2 size={14} />}
                      onClick={handleBulkDelete}
                      loading={deletingMultiple}
                      disabled={deletingMultiple}
                    >
                      {t('automation.actions.delete_selected')}
                    </Button>
                  }
                />
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Task Groups Tab Content */}
      {activeTab === 'groups' && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card variant="glass">
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-text-light-muted dark:text-text-muted text-sm">{t('automation.groups.stats.total')}</p>
                    <p className="text-3xl font-heading font-bold text-text-light-primary dark:text-text-primary mt-1">{taskGroups.length}</p>
                  </div>
                  <Layers size={32} className="text-accent-primary" />
                </div>
              </CardContent>
            </Card>
            <Card variant="glass">
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-text-light-muted dark:text-text-muted text-sm">{t('automation.groups.stats.active')}</p>
                    <p className="text-3xl font-heading font-bold text-success mt-1">{activeGroups}</p>
                  </div>
                  <Play size={32} className="text-success" />
                </div>
              </CardContent>
            </Card>
            <Card variant="glass">
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-text-light-muted dark:text-text-muted text-sm">{t('automation.groups.stats.tasks_in_groups')}</p>
                    <p className="text-3xl font-heading font-bold text-text-light-primary dark:text-text-primary mt-1">
                      {taskGroups.reduce((sum, g) => sum + g.taskMemberships.length, 0)}
                    </p>
                  </div>
                  <ListOrdered size={32} className="text-accent-primary" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Task Groups List */}
          <Card variant="glass">
            <CardHeader>
              <CardTitle>
                {t('automation.groups.title')}
                {loadingGroups ? ` (${t('common.loading')})` : ''}
              </CardTitle>
              <CardDescription>{t('automation.groups.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              {taskGroups.length === 0 && !loadingGroups ? (
                <div className="text-center py-12 text-text-light-muted dark:text-text-muted">
                  <Layers size={48} className="mx-auto mb-4 opacity-50" />
                  <p>{t('automation.groups.empty.title')}</p>
                  <p className="text-sm mt-2">{t('automation.groups.empty.subtitle')}</p>
                  <Button variant="primary" className="mt-4" icon={<Plus size={16} />} onClick={() => setShowGroupModal(true)}>
                    {t('automation.groups.empty.button')}
                  </Button>
                </div>
              ) : (
                <DataTable
                  data={taskGroups}
                  columns={groupColumns}
                  keyExtractor={groupKeyExtractor}
                  itemsPerPage={10}
                  searchable
                  exportable
                  selectable
                  onSelectionChange={handleGroupSelectionChange}
                  bulkActions={
                    <Button
                      variant="danger"
                      size="sm"
                      icon={<Trash2 size={14} />}
                      onClick={handleBulkDeleteGroups}
                      loading={deletingMultipleGroups}
                      disabled={deletingMultipleGroups}
                    >
                      {t('automation.actions.delete_selected')}
                    </Button>
                  }
                />
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Create/Edit Task Modal */}
      <CreateTaskModal
        isOpen={showCreateModal}
        onClose={handleCloseModal}
        onSubmit={handleCreateTask}
        onUpdate={handleUpdateTask}
        servers={servers}
        editTask={editingTask}
      />

      {/* Create/Edit Task Group Modal */}
      <TaskGroupModal
        isOpen={showGroupModal}
        onClose={handleCloseGroupModal}
        onSubmit={handleCreateGroup}
        onUpdate={handleUpdateGroup}
        availableTasks={tasks}
        editGroup={editingGroup}
      />
    </div>
  );
};
