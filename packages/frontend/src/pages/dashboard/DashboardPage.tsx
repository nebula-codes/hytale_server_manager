import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, Button } from '../../components/ui';
import { Server, Activity, Cpu, RefreshCw } from 'lucide-react';
import { useToast } from '../../stores/toastStore';
import api from '../../services/api';
import { motion } from 'framer-motion';
import {
  CpuMemoryChart,
  AlertsSummaryWidget,
  ActivityFeedWidget,
} from './components';
import { useNavigate } from 'react-router-dom';

interface DashboardStats {
  totalServers: number;
  runningServers: number;
  stoppedServers: number;
  totalPlayers: number;
  host: {
    cpu: { usage: number; cores: number; model: string };
    memory: { usage: number; usedGB: number; totalGB: number; freeGB: number };
    system: { uptime: number; platform: string; hostname: string };
  };
  serverMetrics: {
    totalCpu: number;
    totalMemoryMB: number;
    avgCpu: number;
    avgMemory: number;
  };
  alerts: { critical: number; warning: number; info: number };
  statusDistribution: Record<string, number>;
}

interface MetricsHistory {
  timestamps: string[];
  cpu: number[];
  memory: number[];
  players: number[];
}

interface AlertsSummary {
  counts: { critical: number; warning: number; info: number; total: number };
  unreadCount: number;
  recentAlerts: Array<{
    id: string;
    serverId: string;
    type: string;
    severity: 'info' | 'warning' | 'critical';
    title: string;
    message: string;
    createdAt: string;
  }>;
}

export const DashboardPage = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [metricsHistory, setMetricsHistory] = useState<MetricsHistory>({
    timestamps: [],
    cpu: [],
    memory: [],
    players: [],
  });
  const [alertsSummary, setAlertsSummary] = useState<AlertsSummary | null>(null);
  const [metricsRange, setMetricsRange] = useState<'1h' | '24h' | '7d' | '30d'>('24h');

  const navigate = useNavigate();
  // Refs to store current metricsRange for use in intervals
  const metricsRangeRef = useRef(metricsRange);
  metricsRangeRef.current = metricsRange;

  // Fetch just the stats (for cards) - used for 5-second refresh
  const fetchStats = useCallback(async () => {
    try {
      const statsData = await api.getDashboardStats();
      setStats(statsData);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  }, []);

  // Fetch chart data - used for 1-minute refresh
  const fetchChartData = useCallback(async () => {
    try {
      const historyData = await api.getDashboardMetricsHistory(metricsRangeRef.current);
      setMetricsHistory(historyData);
    } catch (error) {
      console.error('Error fetching chart data:', error);
    }
  }, []);

  // Fetch alerts summary
  const fetchAlerts = useCallback(async () => {
    try {
      const alertsData = await api.getDashboardAlertsSummary();
      setAlertsSummary(alertsData);
    } catch (alertsError) {
      console.warn('Could not fetch alerts summary:', alertsError);
      setAlertsSummary({
        counts: { critical: 0, warning: 0, info: 0, total: 0 },
        unreadCount: 0,
        recentAlerts: [],
      });
    }
  }, []);

  // Full dashboard fetch (initial load and manual refresh)
  const fetchDashboardData = useCallback(async (showRefreshing = false) => {
    try {
      if (showRefreshing) setRefreshing(true);
      else setLoading(true);

      const [statsData, historyData] = await Promise.all([
        api.getDashboardStats(),
        api.getDashboardMetricsHistory(metricsRange),
      ]);

      setStats(statsData);
      setMetricsHistory(historyData);
      await fetchAlerts();
    } catch (error: any) {
      console.error('Error fetching dashboard data:', error);
      if (!showRefreshing) {
        toast.error(t('common.loading'), error.message);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [metricsRange, toast, fetchAlerts, t]);

  // Initial fetch
  useEffect(() => {
    fetchDashboardData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh stats every 5 seconds
  useEffect(() => {
    const statsInterval = setInterval(() => {
      fetchStats();
    }, 5000);

    return () => clearInterval(statsInterval);
  }, [fetchStats]);

  // Auto-refresh chart every 1 minute
  useEffect(() => {
    const chartInterval = setInterval(() => {
      fetchChartData();
    }, 60000);

    return () => clearInterval(chartInterval);
  }, [fetchChartData]);

  // Refetch chart when metrics range changes
  useEffect(() => {
    if (!loading) {
      fetchChartData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metricsRange]);

  const handleRefresh = () => {
    fetchDashboardData(true);
  };

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1 },
    },
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 },
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-text-light-muted dark:text-text-muted">{t('dashboard.loading')}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-heading font-bold text-text-light-primary dark:text-text-primary">
            {t('dashboard.title')}
          </h1>
          <p className="text-sm sm:text-base text-text-light-muted dark:text-text-muted mt-1">
            {t('dashboard.subtitle')}
          </p>
        </div>
        <Button
          variant="secondary"
          icon={<RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />}
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {t('common.refresh')}
        </Button>
      </div>

      {/* Stats Grid */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 lg:gap-6"
      >
        <motion.div variants={item}>
          <Card variant="glass" hover onClick={() => navigate('/servers')}>
            <CardContent className="flex items-center justify-between">
              <div>
                <p className="text-text-light-muted dark:text-text-muted text-sm">{t('dashboard.stats.total_servers')}</p>
                <p className="text-3xl font-heading font-bold text-text-light-primary dark:text-text-primary mt-1">
                  {stats?.totalServers || 0}
                </p>
                <p className="text-success text-sm mt-1">
                  {stats?.runningServers || 0} {t('dashboard.stats.running')}
                </p>
              </div>
              <div className="w-12 h-12 bg-accent-primary/20 rounded-lg flex items-center justify-center">
                <Server size={24} className="text-accent-primary" />
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={item}>
          <Card variant="glass">
            <CardContent className="flex items-center justify-between">
              <div>
                <p className="text-text-light-muted dark:text-text-muted text-sm">{t('dashboard.stats.host_cpu')}</p>
                <p className="text-3xl font-heading font-bold text-text-light-primary dark:text-text-primary mt-1">
                  {(stats?.host?.cpu?.usage || 0).toFixed(1)}%
                </p>
                <p
                  className={`text-sm mt-1 ${(stats?.host?.cpu?.usage || 0) > 80
                      ? 'text-danger'
                      : (stats?.host?.cpu?.usage || 0) > 60
                        ? 'text-warning'
                        : 'text-success'
                    }`}
                >
                  {stats?.host?.cpu?.cores || 0} {t('dashboard.stats.cores')}
                </p>
              </div>
              <div className="w-12 h-12 bg-info/20 rounded-lg flex items-center justify-center">
                <Cpu size={24} className="text-info" />
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={item}>
          <Card variant="glass">
            <CardContent className="flex items-center justify-between">
              <div>
                <p className="text-text-light-muted dark:text-text-muted text-sm">{t('dashboard.stats.host_memory')}</p>
                <p className="text-3xl font-heading font-bold text-text-light-primary dark:text-text-primary mt-1">
                  {stats?.host?.memory?.usedGB?.toFixed(1) || 0} GB
                </p>
                <p
                  className={`text-sm mt-1 ${(stats?.host?.memory?.usage || 0) > 85
                      ? 'text-danger'
                      : (stats?.host?.memory?.usage || 0) > 70
                        ? 'text-warning'
                        : 'text-success'
                    }`}
                >
                  {t('dashboard.stats.of')} {stats?.host?.memory?.totalGB?.toFixed(1) || 0} GB ({(stats?.host?.memory?.usage || 0).toFixed(0)}%)
                </p>
              </div>
              <div className="w-12 h-12 bg-warning/20 rounded-lg flex items-center justify-center">
                <Activity size={24} className="text-warning" />
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      {/* CPU/Memory Chart - Full Width */}
      <CpuMemoryChart
        data={metricsHistory}
        range={metricsRange}
        onRangeChange={setMetricsRange}
        loading={refreshing}
      />

      {/* Quick Actions, Activity Feed and Alerts Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        <ActivityFeedWidget />
        {alertsSummary && (
          <AlertsSummaryWidget
            counts={alertsSummary.counts}
            unreadCount={alertsSummary.unreadCount}
            recentAlerts={alertsSummary.recentAlerts}
            loading={refreshing}
          />
        )}
      </div>
    </div>
  );
};
