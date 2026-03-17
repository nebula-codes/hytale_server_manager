import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import os from 'os';
import { AuthenticatedRequest, requirePermission } from '../middleware/auth';
import { MetricsService } from '../services/MetricsService';
import { AlertsService } from '../services/AlertsService';
import { PERMISSIONS } from '../permissions/definitions';
import logger from '../utils/logger';


// Store previous CPU measurement for delta calculation
let previousCpuTimes: { idle: number; total: number } | null = null;
let lastCpuUsage = 0;

/**
 * Get CPU times snapshot
 */
function getCpuTimes() {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;

  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type as keyof typeof cpu.times];
    }
    totalIdle += cpu.times.idle;
  }

  return { idle: totalIdle, total: totalTick };
}

/**
 * Get current host system metrics
 * Uses delta between measurements for accurate CPU usage
 */
function getHostMetrics() {
  const currentCpuTimes = getCpuTimes();

  // Calculate CPU usage from delta (if we have a previous measurement)
  if (previousCpuTimes) {
    const idleDelta = currentCpuTimes.idle - previousCpuTimes.idle;
    const totalDelta = currentCpuTimes.total - previousCpuTimes.total;

    if (totalDelta > 0) {
      lastCpuUsage = Math.round((100 - (100 * idleDelta / totalDelta)) * 100) / 100;
    }
  }

  // Store current measurement for next call
  previousCpuTimes = currentCpuTimes;

  // Memory Usage
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memoryUsage = Math.round((usedMem / totalMem) * 100 * 100) / 100;
  const memoryUsedGB = Math.round((usedMem / 1024 / 1024 / 1024) * 100) / 100;
  const memoryTotalGB = Math.round((totalMem / 1024 / 1024 / 1024) * 100) / 100;

  // System info
  const cpus = os.cpus();
  const uptime = os.uptime();
  const platform = os.platform();
  const hostname = os.hostname();
  const cpuCount = cpus.length;
  const cpuModel = cpus[0]?.model || 'Unknown';

  return {
    cpu: {
      usage: lastCpuUsage,
      cores: cpuCount,
      model: cpuModel,
    },
    memory: {
      usage: memoryUsage,
      usedGB: memoryUsedGB,
      totalGB: memoryTotalGB,
      freeGB: Math.round((freeMem / 1024 / 1024 / 1024) * 100) / 100,
    },
    system: {
      uptime,
      platform,
      hostname,
    },
  };
}

// Initialize first CPU measurement
getCpuTimes();
previousCpuTimes = getCpuTimes();

export function createDashboardRoutes(
  metricsService: MetricsService,
  alertsService: AlertsService
): Router {
  const router = Router();

  /**
   * GET /api/dashboard/stats
   * Get aggregated dashboard stats
   */
  router.get('/stats', requirePermission(PERMISSIONS.SERVERS_VIEW), async (_req, res: Response) => {
    try {
      // Get all servers
      const servers = await prisma.server.findMany({
        include: {
          players: {
            where: { isOnline: true },
          },
          metrics: {
            orderBy: { timestamp: 'desc' },
            take: 1,
          },
        },
      });

      const runningServers = servers.filter(s => s.status === 'running');
      const totalPlayers = runningServers.reduce((sum, s) => sum + s.players.length, 0);

      // Calculate current CPU and memory from latest metrics
      let totalCpu = 0;
      let totalMemory = 0;
      let totalMemoryUsedMB = 0;
      let totalMemoryTotalMB = 0;
      let serversWithMetrics = 0;

      for (const server of runningServers) {
        if (server.metrics.length > 0) {
          totalCpu += server.metrics[0].cpuUsage;
          totalMemory += server.metrics[0].memoryUsage;
          totalMemoryUsedMB += server.metrics[0].memoryUsedMB;
          totalMemoryTotalMB += server.metrics[0].memoryTotalMB;
          serversWithMetrics++;
        }
      }

      // Calculate averages for display
      const avgCpu = serversWithMetrics > 0 ? totalCpu / serversWithMetrics : 0;
      const avgMemory = serversWithMetrics > 0 ? totalMemory / serversWithMetrics : 0;

      // Get alert counts
      const alerts = await prisma.alert.groupBy({
        by: ['severity'],
        where: { isResolved: false },
        _count: { id: true },
      });

      const alertCounts = {
        critical: 0,
        warning: 0,
        info: 0,
      };

      for (const alert of alerts) {
        if (alert.severity in alertCounts) {
          alertCounts[alert.severity as keyof typeof alertCounts] = alert._count.id;
        }
      }

      // Get server status distribution
      const statusDistribution = servers.reduce((acc, s) => {
        acc[s.status] = (acc[s.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Get real-time host metrics
      const hostMetrics = getHostMetrics();

      res.json({
        totalServers: servers.length,
        runningServers: runningServers.length,
        stoppedServers: servers.filter(s => s.status === 'stopped').length,
        totalPlayers,
        // Host system metrics (real-time)
        host: hostMetrics,
        // Server process metrics (from latest metrics of running servers)
        serverMetrics: {
          totalCpu: Math.round(totalCpu * 100) / 100,
          totalMemoryMB: Math.round(totalMemoryUsedMB),
          avgCpu: Math.round(avgCpu * 100) / 100,
          avgMemory: Math.round(avgMemory * 100) / 100,
        },
        alerts: alertCounts,
        statusDistribution,
      });
    } catch (error) {
      logger.error('Failed to get dashboard stats:', error);
      res.status(500).json({ message: 'Failed to get dashboard stats' });
    }
  });

  /**
   * GET /api/dashboard/metrics/history
   * Get historical metrics for all servers
   * Query params: range (1h, 24h, 7d, 30d)
   */
  router.get(
    '/metrics/history',
    requirePermission(PERMISSIONS.SERVERS_VIEW),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const range = (req.query.range as string) || '24h';
        const validRanges = ['1h', '24h', '7d', '30d'];

        if (!validRanges.includes(range)) {
          res.status(400).json({ message: 'Invalid range. Use: 1h, 24h, 7d, 30d' });
          return;
        }

        const history = await metricsService.getAggregatedMetricsHistory(range as '1h' | '24h' | '7d' | '30d');

        res.json(history);
      } catch (error) {
        logger.error('Failed to get metrics history:', error);
        res.status(500).json({ message: 'Failed to get metrics history' });
      }
    }
  );

  /**
   * GET /api/dashboard/health
   * Get server health overview
   */
  router.get('/health', requirePermission(PERMISSIONS.SERVERS_VIEW), async (_req, res: Response) => {
    try {
      const servers = await prisma.server.findMany({
        include: {
          players: {
            where: { isOnline: true },
          },
          metrics: {
            orderBy: { timestamp: 'desc' },
            take: 1,
          },
        },
      });

      const health = servers.map(server => {
        const metric = server.metrics[0];
        let healthStatus: 'healthy' | 'warning' | 'critical' | 'offline' = 'offline';

        if (server.status === 'running' && metric) {
          if (metric.cpuUsage >= 95 || metric.memoryUsage >= 95) {
            healthStatus = 'critical';
          } else if (metric.cpuUsage >= 80 || metric.memoryUsage >= 85) {
            healthStatus = 'warning';
          } else {
            healthStatus = 'healthy';
          }
        } else if (server.status === 'running') {
          healthStatus = 'healthy';
        }

        return {
          id: server.id,
          name: server.name,
          status: server.status,
          healthStatus,
          playerCount: server.players.length,
          maxPlayers: server.maxPlayers,
          cpuUsage: metric?.cpuUsage || 0,
          memoryUsage: metric?.memoryUsage || 0,
          memoryUsedMB: metric?.memoryUsedMB || 0,
          diskUsage: metric?.diskUsage || 0,
        };
      });

      res.json(health);
    } catch (error) {
      logger.error('Failed to get server health:', error);
      res.status(500).json({ message: 'Failed to get server health' });
    }
  });

  /**
   * GET /api/dashboard/alerts-summary
   * Get alert summary for dashboard
   */
  router.get(
    '/alerts-summary',
    requirePermission(PERMISSIONS.ALERTS_VIEW),
    async (_req, res: Response) => {
      try {
        // Get counts by severity
        const severityCounts = await prisma.alert.groupBy({
          by: ['severity'],
          where: { isResolved: false },
          _count: { id: true },
        });

        // Get recent unresolved alerts
        const recentAlerts = await alertsService.getAlerts(undefined, {
          unresolvedOnly: true,
          limit: 5,
        });

        // Get unread count
        const unreadCount = await alertsService.getUnreadCount();

        const counts = {
          critical: 0,
          warning: 0,
          info: 0,
          total: 0,
        };

        for (const item of severityCounts) {
          counts[item.severity as keyof typeof counts] = item._count.id;
          counts.total += item._count.id;
        }

        res.json({
          counts,
          unreadCount,
          recentAlerts,
        });
      } catch (error) {
        logger.error('Failed to get alerts summary:', error);
        res.status(500).json({ message: 'Failed to get alerts summary' });
      }
    }
  );

  /**
   * POST /api/dashboard/quick-action/:action
   * Execute quick actions from dashboard
   */
  router.post(
    '/quick-action/:action',
    requirePermission(PERMISSIONS.SERVERS_START),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { action } = req.params;
        const { serverIds } = req.body as { serverIds?: string[] };

        const validActions = ['start-all', 'stop-all', 'restart-all'];
        if (!validActions.includes(action)) {
          res.status(400).json({ message: 'Invalid action' });
          return;
        }

        // Get target servers
        let targetServers;
        if (serverIds && serverIds.length > 0) {
          targetServers = await prisma.server.findMany({
            where: { id: { in: serverIds } },
          });
        } else {
          targetServers = await prisma.server.findMany();
        }

        const results: { serverId: string; serverName: string; success: boolean; error?: string }[] = [];

        for (const server of targetServers) {
          try {
            switch (action) {
              case 'start-all':
                if (server.status === 'stopped') {
                  await prisma.server.update({
                    where: { id: server.id },
                    data: { status: 'starting' },
                  });
                  results.push({ serverId: server.id, serverName: server.name, success: true });
                }
                break;
              case 'stop-all':
                if (server.status === 'running') {
                  await prisma.server.update({
                    where: { id: server.id },
                    data: { status: 'stopping' },
                  });
                  results.push({ serverId: server.id, serverName: server.name, success: true });
                }
                break;
              case 'restart-all':
                if (server.status === 'running') {
                  await prisma.server.update({
                    where: { id: server.id },
                    data: { status: 'restarting' },
                  });
                  results.push({ serverId: server.id, serverName: server.name, success: true });
                }
                break;
            }
          } catch (err: any) {
            results.push({ serverId: server.id, serverName: server.name, success: false, error: err.message });
          }
        }

        res.json({
          action,
          results,
          successCount: results.filter(r => r.success).length,
          failedCount: results.filter(r => !r.success).length,
        });
      } catch (error) {
        logger.error('Failed to execute quick action:', error);
        res.status(500).json({ message: 'Failed to execute quick action' });
      }
    }
  );

  return router;
}
