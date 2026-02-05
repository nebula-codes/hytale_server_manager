import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardContent, Button, Badge } from '../ui';
import { Download, X, ChevronDown, ChevronUp, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { useInstallationQueueStore, type InstallationStatus } from '../../stores/installationQueueStore';
import { motion, AnimatePresence } from 'framer-motion';

export const InstallationQueueWidget = () => {
  const { t } = useTranslation();
  const { queue, removeFromQueue, clearCompleted } = useInstallationQueueStore();
  const [isExpanded, setIsExpanded] = useState(true);

  // Don't render if queue is empty
  if (queue.length === 0) return null;

  const activeCount = queue.filter(
    (item) => item.status === 'pending' || item.status === 'downloading' || item.status === 'installing'
  ).length;

  const completedCount = queue.filter((item) => item.status === 'completed').length;
  const failedCount = queue.filter((item) => item.status === 'failed').length;

  const getStatusIcon = (status: InstallationStatus) => {
    switch (status) {
      case 'pending':
        return <Download size={16} className="text-text-light-muted dark:text-text-muted" />;
      case 'downloading':
      case 'installing':
        return <Loader2 size={16} className="text-accent-primary animate-spin" />;
      case 'completed':
        return <CheckCircle2 size={16} className="text-success" />;
      case 'failed':
        return <AlertCircle size={16} className="text-danger" />;
    }
  };

  const getStatusColor = (status: InstallationStatus) => {
    switch (status) {
      case 'pending':
        return 'default';
      case 'downloading':
      case 'installing':
        return 'info';
      case 'completed':
        return 'success';
      case 'failed':
        return 'danger';
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="fixed bottom-6 right-6 w-96 z-50"
    >
      <Card variant="glass" className="shadow-2xl border-2 border-accent-primary/20">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Download size={20} className="text-accent-primary" />
              <CardTitle className="text-base">{t('installation_queue.title')}</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              {activeCount > 0 && (
                <Badge size="sm" variant="info">
                  {t('installation_queue.active', { count: activeCount })}
                </Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                icon={isExpanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                onClick={() => setIsExpanded(!isExpanded)}
              />
            </div>
          </div>
        </CardHeader>

        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <CardContent>
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {queue.map((item) => (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      className="flex items-start gap-3 p-3 bg-white dark:bg-primary-bg-secondary rounded-lg border border-gray-300 dark:border-gray-700"
                    >
                      <img
                        src={item.projectIconUrl || `https://via.placeholder.com/40/6366f1/ffffff?text=${item.projectTitle[0]}`}
                        alt={item.projectTitle}
                        className="w-10 h-10 rounded object-cover flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm text-text-light-primary dark:text-text-primary truncate">
                              {item.projectTitle}
                            </p>
                            <p className="text-xs text-text-light-muted dark:text-text-muted truncate">
                              {item.serverName} • v{item.versionName}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {getStatusIcon(item.status)}
                            {(item.status === 'completed' || item.status === 'failed') && (
                              <button
                                onClick={() => removeFromQueue(item.id)}
                                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-800 rounded transition-colors"
                              >
                                <X size={14} className="text-text-light-muted dark:text-text-muted" />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="mt-2">
                          <Badge size="sm" variant={getStatusColor(item.status)}>
                            {t(`installation_queue.status.${item.status}`)}
                          </Badge>
                        </div>

                        {(item.status === 'downloading' || item.status === 'installing') && (
                          <div className="mt-2">
                            <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${item.progress}%` }}
                                className="h-full bg-accent-primary"
                              />
                            </div>
                            <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                              {item.progress}%
                            </p>
                          </div>
                        )}

                        {item.error && (
                          <p className="text-xs text-danger mt-2">{item.error}</p>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>

                {(completedCount > 0 || failedCount > 0) && (
                  <div className="mt-3 pt-3 border-t border-gray-300 dark:border-gray-700">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearCompleted}
                      className="w-full"
                    >
                      {t('installation_queue.clear_completed', { count: completedCount + failedCount })}
                    </Button>
                  </div>
                )}
              </CardContent>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
};
