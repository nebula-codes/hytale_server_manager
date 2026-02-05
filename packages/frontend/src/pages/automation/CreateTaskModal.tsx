import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalFooter, Button, Input } from '../../components/ui';
import { Clock } from 'lucide-react';

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
}

interface CreateTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (serverId: string, data: any) => Promise<void>;
  onUpdate?: (taskId: string, data: any) => Promise<void>;
  servers: Server[];
  editTask?: ScheduledTask | null;
}

export const CreateTaskModal = ({ isOpen, onClose, onSubmit, onUpdate, servers, editTask }: CreateTaskModalProps) => {
  const { t } = useTranslation();
  const CRON_PRESETS = useMemo(
    () => [
      { label: t('automation.cron.every_5_minutes'), value: '*/5 * * * *' },
      { label: t('automation.cron.every_15_minutes'), value: '*/15 * * * *' },
      { label: t('automation.cron.every_30_minutes'), value: '*/30 * * * *' },
      { label: t('automation.cron.every_hour'), value: '0 * * * *' },
      { label: t('automation.cron.every_6_hours'), value: '0 */6 * * *' },
      { label: t('automation.cron.daily_midnight'), value: '0 0 * * *' },
      { label: t('automation.cron.daily_noon'), value: '0 12 * * *' },
      { label: t('automation.cron.weekly_sunday'), value: '0 0 * * 0' },
      { label: t('automation.cron.weekly_monday'), value: '0 0 * * 1' },
      { label: t('automation.cron.custom'), value: 'custom' },
    ],
    [t]
  );
  const [serverId, setServerId] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<'backup' | 'restart' | 'start' | 'stop' | 'command'>('backup');
  const [cronPreset, setCronPreset] = useState('0 0 * * *');
  const [customCron, setCustomCron] = useState('');
  const [command, setCommand] = useState('');
  const [description, setDescription] = useState('');
  const [backupLimit, setBackupLimit] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isEditMode = !!editTask;

  // Populate form when editing
  useEffect(() => {
    if (editTask) {
      setServerId(editTask.serverId);
      setName(editTask.name);
      setType(editTask.type);
      setBackupLimit(editTask.backupLimit);

      // Parse taskData
      if (editTask.taskData) {
        try {
          const data = JSON.parse(editTask.taskData);
          if (data.command) setCommand(data.command);
          if (data.description) setDescription(data.description);
        } catch {
          // Ignore parse errors
        }
      }

      // Check if cron matches a preset
      const preset = CRON_PRESETS.find(p => p.value === editTask.cronExpression);
      if (preset && preset.value !== 'custom') {
        setCronPreset(editTask.cronExpression);
        setCustomCron('');
      } else {
        setCronPreset('custom');
        setCustomCron(editTask.cronExpression);
      }
    }
  }, [editTask]);

  const handleSubmit = async () => {
    if (!serverId) {
      setError(t('automation.modals.create_task.errors.select_server'));
      return;
    }

    if (!name.trim()) {
      setError(t('automation.modals.create_task.errors.name'));
      return;
    }

    const cronExpression = cronPreset === 'custom' ? customCron : cronPreset;

    if (!cronExpression || !isValidCron(cronExpression)) {
      setError(t('automation.modals.create_task.errors.cron'));
      return;
    }

    if (type === 'command' && !command.trim()) {
      setError(t('automation.modals.create_task.errors.command'));
      return;
    }

    setLoading(true);
    setError('');

    try {
      const taskData: any = {};

      if (type === 'command') {
        taskData.command = command;
      }

      if (type === 'backup' && description) {
        taskData.description = description;
      }

      if (isEditMode && editTask && onUpdate) {
        await onUpdate(editTask.id, {
          name,
          cronExpression,
          taskData,
          backupLimit: type === 'backup' ? backupLimit : undefined,
        });
      } else {
        await onSubmit(serverId, {
          name,
          type,
          cronExpression,
          taskData,
          enabled: true,
          backupLimit: type === 'backup' ? backupLimit : undefined,
        });
      }

      handleClose();
    } catch (err: any) {
      console.error(isEditMode ? 'Error updating task:' : 'Error creating task:', err);
      setError(err.message || t(isEditMode ? 'automation.modals.create_task.errors.update' : 'automation.modals.create_task.errors.create'));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setServerId('');
    setName('');
    setType('backup');
    setCronPreset('0 0 * * *');
    setCustomCron('');
    setCommand('');
    setDescription('');
    setBackupLimit(10);
    setError('');
    onClose();
  };

  const isValidCron = (cron: string): boolean => {
    // Basic validation - should have 5 parts
    const parts = cron.trim().split(/\s+/);
    return parts.length === 5;
  };

  const selectedServer = servers.find(s => s.id === serverId);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={isEditMode ? t('automation.modals.create_task.title_edit') : t('automation.modals.create_task.title_create')}
      size="lg"
    >
      <div className="space-y-4">
        {/* Server Selection */}
        <div>
          <label className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-2">
            {t('automation.modals.create_task.server_label')}
          </label>
          <select
            value={serverId}
            onChange={(e) => setServerId(e.target.value)}
            disabled={isEditMode}
            className={`w-full px-3 py-2 bg-white dark:bg-primary-bg-secondary border border-gray-300 dark:border-gray-700 rounded-lg text-text-light-primary dark:text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary ${isEditMode ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            <option value="">{t('automation.modals.create_task.server_placeholder')}</option>
            {servers.map((server) => (
              <option key={server.id} value={server.id}>
                {server.name} ({server.status})
              </option>
            ))}
          </select>
          {isEditMode && (
            <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
              {t('automation.modals.create_task.server_edit_helper')}
            </p>
          )}
        </div>

        {/* Task Name */}
        <div>
          <label className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-2">
            {t('automation.modals.create_task.name_label')}
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('automation.modals.create_task.name_placeholder')}
            className="w-full"
          />
        </div>

        {/* Task Type */}
        <div>
          <label className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-2">
            {t('automation.modals.create_task.type_label')}
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as any)}
            disabled={isEditMode}
            className={`w-full px-3 py-2 bg-white dark:bg-primary-bg-secondary border border-gray-300 dark:border-gray-700 rounded-lg text-text-light-primary dark:text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary ${isEditMode ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            <option value="backup">{t('automation.modals.create_task.type_options.backup')}</option>
            <option value="restart">{t('automation.modals.create_task.type_options.restart')}</option>
            <option value="start">{t('automation.modals.create_task.type_options.start')}</option>
            <option value="stop">{t('automation.modals.create_task.type_options.stop')}</option>
            <option value="command">{t('automation.modals.create_task.type_options.command')}</option>
          </select>
          {isEditMode && (
            <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
              {t('automation.modals.create_task.type_edit_helper')}
            </p>
          )}
        </div>

        {/* Command Input (only for command type) */}
        {type === 'command' && (
          <div>
            <label className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-2">
              {t('automation.modals.create_task.command_label')}
            </label>
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={t('automation.modals.create_task.command_placeholder')}
              className="w-full font-mono"
            />
            <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
              {t('automation.modals.create_task.command_helper')}
            </p>
          </div>
        )}

        {/* Description (for backup type) */}
        {type === 'backup' && (
          <div>
            <label className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-2">
              {t('automation.modals.create_task.description_label')}
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('automation.modals.create_task.description_placeholder')}
              className="w-full"
            />
          </div>
        )}

        {/* Backup Limit (for backup type) */}
        {type === 'backup' && (
          <div>
            <label className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-2">
              {t('automation.modals.create_task.backup_limit_label')}
            </label>
            <Input
              type="number"
              min={0}
              value={backupLimit}
              onChange={(e) => setBackupLimit(parseInt(e.target.value) || 0)}
              className="w-full"
            />
            <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
              {t('automation.modals.create_task.backup_limit_helper')}
            </p>
          </div>
        )}

        {/* Schedule Preset */}
        <div>
          <label className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-2">
            {t('automation.modals.create_task.schedule_label')}
          </label>
          <select
            value={cronPreset}
            onChange={(e) => setCronPreset(e.target.value)}
            className="w-full px-3 py-2 bg-white dark:bg-primary-bg-secondary border border-gray-300 dark:border-gray-700 rounded-lg text-text-light-primary dark:text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
          >
            {CRON_PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </select>
        </div>

        {/* Custom Cron Expression */}
        {cronPreset === 'custom' && (
          <div>
            <label className="block text-sm font-medium text-text-light-primary dark:text-text-primary mb-2">
              {t('automation.modals.create_task.custom_cron_label')}
            </label>
            <Input
              value={customCron}
              onChange={(e) => setCustomCron(e.target.value)}
              placeholder={t('automation.modals.create_task.custom_cron_placeholder')}
              className="w-full font-mono"
            />
            <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
              {t('automation.modals.create_task.custom_cron_helper')}
            </p>
          </div>
        )}

        {/* Preview */}
        {selectedServer && name && (
          <div className="bg-gray-100 dark:bg-gray-900 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Clock className="text-accent-primary flex-shrink-0 mt-0.5" size={20} />
              <div className="flex-1">
                <p className="text-sm font-medium text-text-light-primary dark:text-text-primary">
                  {t('automation.modals.create_task.preview.title')}
                </p>
                <p className="text-sm text-text-light-muted dark:text-text-muted mt-1">
                  {t('automation.modals.create_task.preview.server', { server: selectedServer.name })}
                </p>
                <p className="text-sm text-text-light-muted dark:text-text-muted mt-1">
                  {t('automation.modals.create_task.preview.name', { name })}
                </p>
                <p className="text-sm text-text-light-muted dark:text-text-muted mt-1">
                  {t('automation.modals.create_task.preview.type', {
                    type: t(`automation.modals.create_task.type_options.${type}`),
                  })}
                </p>
                <p className="text-sm text-text-light-muted dark:text-text-muted mt-1">
                  {t('automation.modals.create_task.preview.schedule', {
                    schedule: cronPreset === 'custom' ? customCron : CRON_PRESETS.find(p => p.value === cronPreset)?.label,
                  })}
                </p>
                {type === 'command' && command && (
                  <p className="text-sm text-text-light-muted dark:text-text-muted mt-1 font-mono">
                    {t('automation.modals.create_task.preview.command', { command })}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* General Error */}
        {error && (
          <div className="bg-danger/10 border border-danger rounded-lg p-3">
            <p className="text-danger text-sm">{error}</p>
          </div>
        )}
      </div>

      <ModalFooter>
        <Button variant="ghost" onClick={handleClose} disabled={loading}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" onClick={handleSubmit} loading={loading} disabled={loading || !serverId || !name}>
          {loading
            ? isEditMode
              ? t('common.saving')
              : t('common.creating')
            : isEditMode
            ? t('common.save_changes')
            : t('automation.modals.create_task.submit')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
