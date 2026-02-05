import { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '../../components/ui';
import { Send, Download, Trash2 } from 'lucide-react';
import { useToast } from '../../stores/toastStore';
import api from '../../services/api';
import websocket from '../../services/websocket';

interface LogEntry {
  id?: string;
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  source?: string;
}

interface Server {
  id: string;
  name: string;
  status: string;
}

export const ConsolePage = () => {
  const { serverId } = useParams<{ serverId?: string }>();
  const { t } = useTranslation();
  const toast = useToast();
  const [servers, setServers] = useState<Server[]>([]);
  const [selectedServer, setSelectedServer] = useState<string>('');
  const [command, setCommand] = useState('');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const urlRegex = /https?:\/\/[^\s]+/g;

  const stripAnsiCodes = (message: string) => {
    // Remove ANSI color/control sequences (e.g. "\x1b[31m", "\x1b[m").
    return message.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  };

  const formatLogMessage = (message: string) => {
    const cleaned = stripAnsiCodes(message);
    return cleaned.replace(urlRegex, (url) => {
      try {
        return decodeURIComponent(url);
      } catch {
        return url;
      }
    });
  };

  // Fetch servers on mount
  useEffect(() => {
    fetchServers();
  }, []);

  // Connect to WebSocket for live logs when server changes
  useEffect(() => {
    if (!selectedServer) return;

    const unsubscribe = websocket.subscribeToConsole(selectedServer, {
      onHistoricalLogs: (data) => {
        // Set initial historical logs
        const transformedLogs = data.logs.map((log: any) => ({
          id: log.id,
          timestamp: new Date(log.timestamp),
          level: log.level,
          message: log.message,
          source: log.source,
        }));
        setLogs(transformedLogs);
      },
      onLog: (data) => {
        // Append new log
        const newLog = {
          timestamp: new Date(data.log.timestamp),
          level: data.log.level,
          message: data.log.message,
          source: data.log.source,
        };
        setLogs((prev) => [...prev, newLog]);
      },
      onCommandResponse: (data) => {
        // Show command response
        if (data.response.success) {
          toast.success(t('console.toast.command_executed'), data.response.output);
        } else {
          toast.error(t('console.toast.command_failed'), data.response.error || t('console.toast.unknown_error'));
        }
      },
    });

    return () => {
      unsubscribe();
    };
  }, [selectedServer]);

  // Auto-scroll to bottom when logs update
  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const fetchServers = async () => {
    try {
      const data = await api.getServers<Server>();
      setServers(data.map((s) => ({ id: s.id, name: s.name, status: s.status })));

      // Select server from URL param if provided, otherwise first server
      if (data.length > 0 && !selectedServer) {
        if (serverId && data.some((s) => s.id === serverId)) {
          setSelectedServer(serverId);
        } else {
          setSelectedServer(data[0].id);
        }
      }
    } catch (error) {
      console.error('Error fetching servers:', error);
      toast.error(t('console.toast.load_servers_failed.title'), t('console.toast.load_servers_failed.description'));
    }
  };

  const handleSendCommand = () => {
    if (!command.trim()) return;

    // Send command via WebSocket
    websocket.sendCommand(selectedServer, command);
    setCommand('');
  };

  const handleClearConsole = () => {
    setLogs([]);
    toast.info(t('console.toast.console_cleared'));
  };

  const handleDownloadLogs = () => {
    const logText = logs
      .map(
        (log) =>
          `[${new Date(log.timestamp).toISOString()}] [${log.level.toUpperCase()}] [${log.source || 'Server'}] ${log.message}`
      )
      .join('\n');

    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `console-${selectedServer}-${Date.now()}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success(t('console.toast.logs_downloaded'));
  };

  const getLogLevelColor = (level: string) => {
    switch (level.toLowerCase()) {
      case 'error': return 'text-danger';
      case 'warn': return 'text-warning';
      case 'debug': return 'text-accent-secondary';
      default: return 'text-text-light-primary dark:text-text-primary';
    }
  };

  const selectedServerData = servers.find(s => s.id === selectedServer);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-heading font-bold text-text-light-primary dark:text-text-primary">{t('console.title')}</h1>
          <p className="text-text-light-muted dark:text-text-muted mt-1">{t('console.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" icon={<Download size={16} />} onClick={handleDownloadLogs} disabled={logs.length === 0}>
            {t('console.actions.download_logs')}
          </Button>
          <Button variant="ghost" size="sm" icon={<Trash2 size={16} />} onClick={handleClearConsole} disabled={logs.length === 0}>
            {t('console.actions.clear_console')}
          </Button>
        </div>
      </div>

      {/* Server Selector */}
      <div className="flex gap-2 flex-wrap">
        {servers.map((server) => (
          <button
            key={server.id}
            onClick={() => setSelectedServer(server.id)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${selectedServer === server.id
                ? 'bg-accent-primary text-black'
                : 'bg-white dark:bg-gray-100 dark:bg-primary-bg-secondary text-text-light-muted dark:text-text-muted hover:text-text-light-primary dark:text-text-primary'
              }`}
          >
            {server.name}
          </button>
        ))}
      </div>

      {/* Console */}
      <Card variant="glass">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>
              {t('console.live_console_title', { server: selectedServerData?.name || t('console.select_server_placeholder') })}
            </CardTitle>
            {selectedServerData && (
              <Badge variant={selectedServerData.status === 'running' ? 'success' : 'default'}>
                {t(`servers.status.${selectedServerData.status}`)}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* Console Output */}
          <div className="bg-white dark:bg-primary-bg rounded-lg p-4 font-mono text-sm h-96 overflow-y-auto custom-scrollbar">
            {logs.length === 0 ? (
              <div className="text-text-light-muted dark:text-text-muted text-center py-8">
                {['running', 'starting'].includes(selectedServerData?.status || '')
                  ? t('console.waiting_for_logs')
                  : t('console.start_server_prompt')}
              </div>
            ) : (
              logs.map((log, index) => (
                <div key={log.id || index} className="mb-1 flex gap-2">
                  <span className="text-text-light-muted dark:text-text-muted">
                    [{new Date(log.timestamp).toLocaleTimeString()}]
                  </span>
                  <span className={getLogLevelColor(log.level)}>[{log.level.toUpperCase()}]</span>
                  <span className="text-accent-secondary">[{log.source || t('console.server_default')}]</span>
                  <span className="text-text-light-primary dark:text-text-primary">{formatLogMessage(log.message)}</span>
                </div>
              ))
            )}
            <div ref={consoleEndRef} />
          </div>

          {/* Command Input */}
          <div className="mt-4 flex gap-2">
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendCommand()}
              placeholder={t('console.command_placeholder')}
              className="flex-1 px-4 py-2 bg-white dark:bg-primary-bg border border-gray-300 dark:border-gray-700 rounded-lg text-text-light-primary dark:text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50 font-mono"
              disabled={!['running', 'starting'].includes(selectedServerData?.status || '')}
            />
            <Button
              variant="primary"
              icon={<Send size={18} />}
              onClick={handleSendCommand}
              disabled={!['running', 'starting'].includes(selectedServerData?.status || '') || !command.trim()}
            >
              {t('console.actions.send')}
            </Button>
          </div>

          {!['running', 'starting'].includes(selectedServerData?.status || '') && selectedServerData && (
            <p className="text-warning text-sm mt-2">{t('console.not_running_warning')}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
