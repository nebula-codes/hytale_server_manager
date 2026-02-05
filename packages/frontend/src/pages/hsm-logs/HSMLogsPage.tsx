import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardContent, Button } from '../../components/ui';
import { Download, Trash2, RefreshCw } from 'lucide-react';
import { useToast } from '../../stores/toastStore';
import api from '../../services/api';

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

interface LogsResponse {
  logs: LogEntry[];
  file: string;
  count: number;
}

type LogLevel = 'all' | 'error' | 'warn' | 'info' | 'debug';

const POLL_INTERVAL = 3000; // 3 seconds

export const HSMLogsPage = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [levelFilter, setLevelFilter] = useState<LogLevel>('all');
  const [isLoading, setIsLoading] = useState(true);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const fetchLogs = useCallback(async () => {
    try {
      const endpoint = levelFilter === 'all'
        ? '/system/logs?lines=500'
        : `/system/logs?lines=500&level=${levelFilter}`;
      const data = await api.get<LogsResponse>(endpoint);
      setLogs(data.logs);
    } catch (error) {
      console.error('Error fetching logs:', error);
      toast.error(t('hsm_logs.toast.load_failed'));
    } finally {
      setIsLoading(false);
    }
  }, [levelFilter, t, toast]);

  // Initial fetch and polling
  useEffect(() => {
    fetchLogs();

    const interval = setInterval(fetchLogs, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  // Auto-scroll to bottom when logs update
  useEffect(() => {
    if (autoScroll) {
      consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const handleClearDisplay = () => {
    setLogs([]);
    toast.info(t('hsm_logs.toast.display_cleared'));
  };

  const handleDownloadLogs = () => {
    const logText = logs
      .map(
        (log) =>
          `[${log.timestamp}] [${log.level.toUpperCase()}] ${log.message}`
      )
      .join('\n');

    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hsm-logs-${Date.now()}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success(t('hsm_logs.toast.logs_downloaded'));
  };

  const handleRefresh = () => {
    setIsLoading(true);
    fetchLogs();
  };

  const getLogLevelColor = (level: string) => {
    switch (level.toLowerCase()) {
      case 'error': return 'text-danger';
      case 'warn': return 'text-warning';
      case 'debug': return 'text-accent-secondary';
      default: return 'text-text-light-primary dark:text-text-primary';
    }
  };

  const levelOptions: { value: LogLevel; labelKey: string }[] = [
    { value: 'all', labelKey: 'hsm_logs.filters.all' },
    { value: 'error', labelKey: 'hsm_logs.filters.error' },
    { value: 'warn', labelKey: 'hsm_logs.filters.warn' },
    { value: 'info', labelKey: 'hsm_logs.filters.info' },
    { value: 'debug', labelKey: 'hsm_logs.filters.debug' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-heading font-bold text-text-light-primary dark:text-text-primary">
            {t('hsm_logs.title')}
          </h1>
          <p className="text-text-light-muted dark:text-text-muted mt-1">
            {t('hsm_logs.subtitle')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />}
            onClick={handleRefresh}
          >
            {t('hsm_logs.actions.refresh')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Download size={16} />}
            onClick={handleDownloadLogs}
            disabled={logs.length === 0}
          >
            {t('hsm_logs.actions.download_logs')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 size={16} />}
            onClick={handleClearDisplay}
            disabled={logs.length === 0}
          >
            {t('hsm_logs.actions.clear_display')}
          </Button>
        </div>
      </div>

      {/* Level Filter */}
      <div className="flex gap-2 flex-wrap">
        {levelOptions.map((option) => (
          <button
            key={option.value}
            onClick={() => setLevelFilter(option.value)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              levelFilter === option.value
                ? 'bg-accent-primary text-black'
                : 'bg-white dark:bg-primary-bg-secondary text-text-light-muted dark:text-text-muted hover:text-text-light-primary dark:hover:text-text-primary'
            }`}
          >
            {t(option.labelKey)}
          </button>
        ))}
      </div>

      {/* Log Display */}
      <Card variant="glass">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>
              {t('hsm_logs.log_source')}
            </CardTitle>
            <label className="flex items-center gap-2 text-sm text-text-light-muted dark:text-text-muted">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-700"
              />
              Auto-scroll
            </label>
          </div>
        </CardHeader>
        <CardContent>
          {/* Log Output */}
          <div className="bg-white dark:bg-primary-bg rounded-lg p-4 font-mono text-sm h-[calc(100vh-350px)] min-h-96 overflow-y-auto custom-scrollbar">
            {isLoading && logs.length === 0 ? (
              <div className="text-text-light-muted dark:text-text-muted text-center py-8">
                {t('common.loading')}
              </div>
            ) : logs.length === 0 ? (
              <div className="text-text-light-muted dark:text-text-muted text-center py-8">
                {t('hsm_logs.waiting_for_logs')}
              </div>
            ) : (
              logs.map((log, index) => (
                <div key={index} className="mb-1 flex gap-2">
                  <span className="text-text-light-muted dark:text-text-muted shrink-0">
                    [{log.timestamp}]
                  </span>
                  <span className={`${getLogLevelColor(log.level)} shrink-0`}>
                    [{log.level.toUpperCase()}]
                  </span>
                  <span className="text-text-light-primary dark:text-text-primary break-all">
                    {log.message}
                  </span>
                </div>
              ))
            )}
            <div ref={consoleEndRef} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
