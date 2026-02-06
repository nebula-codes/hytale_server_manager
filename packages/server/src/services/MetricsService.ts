import { PrismaClient } from '@prisma/client';
import os from 'os';
import fs from 'fs-extra';
import path from 'path';
import logger from '../utils/logger';
import { ConsoleService } from './ConsoleService';

const prisma = new PrismaClient();

export interface MetricData {
  timestamp: Date;
  cpuUsage: number;
  memoryUsage: number;
  memoryUsedMB: number;
  memoryTotalMB: number;
  diskUsage: number;
  diskUsedGB: number;
  diskTotalGB: number;
  playerCount: number;
  tps?: number;
}

export interface MetricsQuery {
  serverId: string;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
  interval?: '5m' | '15m' | '1h' | '6h' | '24h';
}

export class MetricsService {
  private collectionInterval: NodeJS.Timeout | null = null;
  private readonly COLLECTION_INTERVAL_MS = 60000; // 1 minute
  private readonly RETENTION_DAYS = 30; // Keep metrics for 30 days
  private readonly CONSOLE_LOG_RETENTION_DAYS = 7; // Keep console logs for 7 days
  private consoleService: ConsoleService | null = null;

  // Store previous CPU measurements per server for delta calculation
  private previousCpuTimes: Map<string, { idle: number; total: number }> = new Map();
  private lastCpuUsage: Map<string, number> = new Map();

  // Store previous host CPU measurement for delta calculation
  private previousHostCpuTimes: { idle: number; total: number } | null = null;
  private lastHostCpuUsage: number = 0;

  constructor(consoleService?: ConsoleService) {
    this.consoleService = consoleService || null;
  }

  /**
   * Start collecting metrics for all running servers
   */
  async startCollection(): Promise<void> {
    if (this.collectionInterval) {
      logger.warn('Metrics collection already running');
      return;
    }

    logger.info('Starting metrics collection');

    // Collect immediately
    await this.collectAllMetrics();

    // Then collect every minute
    this.collectionInterval = setInterval(async () => {
      try {
        await this.collectAllMetrics();
      } catch (error: any) {
        logger.error('Error collecting metrics:', error);
      }
    }, this.COLLECTION_INTERVAL_MS);
  }

  /**
   * Stop collecting metrics
   */
  stopCollection(): void {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
      logger.info('Stopped metrics collection');
    }
  }

  /**
   * Collect metrics for all servers and host
   */
  private async collectAllMetrics(): Promise<void> {
    // Always collect host metrics
    try {
      await this.collectHostMetrics();
    } catch (error: any) {
      logger.error('Error collecting host metrics:', error);
    }

    // Collect server-specific metrics for running servers
    const servers = await prisma.server.findMany({
      where: {
        status: 'running'
      },
      include: {
        players: {
          where: {
            isOnline: true
          }
        }
      }
    });

    for (const server of servers) {
      try {
        await this.collectServerMetrics(server.id, server.players.length);
      } catch (error: any) {
        logger.error(`Error collecting metrics for server ${server.id}:`, error);
      }
    }

    // Clean up old metrics periodically (once per hour)
    const now = new Date();
    if (now.getMinutes() === 0) {
      await this.cleanupOldMetrics();
    }
  }

  /**
   * Collect host system metrics
   */
  private async collectHostMetrics(): Promise<void> {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    }

    const currentCpuTimes = { idle: totalIdle, total: totalTick };

    // Calculate CPU usage from delta (if we have a previous measurement)
    if (this.previousHostCpuTimes) {
      const idleDelta = currentCpuTimes.idle - this.previousHostCpuTimes.idle;
      const totalDelta = currentCpuTimes.total - this.previousHostCpuTimes.total;

      if (totalDelta > 0) {
        this.lastHostCpuUsage = Math.round((100 - (100 * idleDelta / totalDelta)) * 100) / 100;
      }
    }

    // Store current measurement for next call
    this.previousHostCpuTimes = currentCpuTimes;

    const cpuUsage = this.lastHostCpuUsage;
    const cpuCores = cpus.length;

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memoryUsage = Math.round((usedMem / totalMem) * 100 * 100) / 100;
    const memoryUsedGB = Math.round((usedMem / 1024 / 1024 / 1024) * 100) / 100;
    const memoryTotalGB = Math.round((totalMem / 1024 / 1024 / 1024) * 100) / 100;

    await prisma.hostMetric.create({
      data: {
        timestamp: new Date(),
        cpuUsage,
        cpuCores,
        memoryUsage,
        memoryUsedGB,
        memoryTotalGB,
      }
    });

    logger.debug('Collected host metrics');
  }

  /**
   * Collect metrics for a specific server
   */
  async collectServerMetrics(serverId: string, playerCount: number): Promise<void> {
    const metrics = await this.getSystemMetrics(serverId, playerCount);

    await prisma.serverMetric.create({
      data: {
        serverId,
        timestamp: metrics.timestamp,
        cpuUsage: metrics.cpuUsage,
        memoryUsage: metrics.memoryUsage,
        memoryUsedMB: metrics.memoryUsedMB,
        memoryTotalMB: metrics.memoryTotalMB,
        diskUsage: metrics.diskUsage,
        diskUsedGB: metrics.diskUsedGB,
        diskTotalGB: metrics.diskTotalGB,
        playerCount: metrics.playerCount,
        tps: metrics.tps,
      }
    });

    logger.debug(`Collected metrics for server ${serverId}`);
  }

  /**
   * Get CPU times snapshot
   */
  private getCpuTimes(): { idle: number; total: number } {
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
   * Get current system metrics
   */
  private async getSystemMetrics(serverId: string, playerCount: number): Promise<MetricData> {
    // CPU Usage - calculate from delta between measurements
    const currentCpuTimes = this.getCpuTimes();
    const previousTimes = this.previousCpuTimes.get(serverId);
    let cpuUsage = this.lastCpuUsage.get(serverId) || 0;

    if (previousTimes) {
      const idleDelta = currentCpuTimes.idle - previousTimes.idle;
      const totalDelta = currentCpuTimes.total - previousTimes.total;

      if (totalDelta > 0) {
        cpuUsage = 100 - (100 * idleDelta / totalDelta);
        this.lastCpuUsage.set(serverId, cpuUsage);
      }
    }

    // Store current measurement for next collection
    this.previousCpuTimes.set(serverId, currentCpuTimes);

    // Memory Usage
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memoryUsage = (usedMem / totalMem) * 100;
    const memoryUsedMB = Math.round(usedMem / 1024 / 1024);
    const memoryTotalMB = Math.round(totalMem / 1024 / 1024);

    // Disk Usage (for server directory)
    const server = await prisma.server.findUnique({
      where: { id: serverId }
    });

    let diskUsage = 0;
    let diskUsedGB = 0;
    let diskTotalGB = 0;

    if (server && await fs.pathExists(server.serverPath)) {
      try {
        // Get disk usage for the server directory
        const diskStats = await this.getDiskUsage(server.serverPath);
        diskUsage = diskStats.usage;
        diskUsedGB = diskStats.used;
        diskTotalGB = diskStats.total;
      } catch (error) {
        logger.warn(`Could not get disk usage for server ${serverId}:`, error);
      }
    }

    return {
      timestamp: new Date(),
      cpuUsage: Math.round(cpuUsage * 100) / 100,
      memoryUsage: Math.round(memoryUsage * 100) / 100,
      memoryUsedMB,
      memoryTotalMB,
      diskUsage: Math.round(diskUsage * 100) / 100,
      diskUsedGB: Math.round(diskUsedGB * 100) / 100,
      diskTotalGB: Math.round(diskTotalGB * 100) / 100,
      playerCount,
      tps: undefined, // TPS would need to be provided by server adapter
    };
  }

  /**
   * Get disk usage for a path with timeout
   */
  private async getDiskUsage(dirPath: string): Promise<{ usage: number; used: number; total: number }> {
    // For simplicity, we'll get the directory size and use system disk stats
    // In production, you might want to use a library like 'check-disk-space'

    const TIMEOUT_MS = 10000; // 10 second timeout to prevent CPU spikes

    try {
      // Race between directory size calculation and timeout
      const used = await Promise.race([
        this.getDirectorySize(dirPath),
        new Promise<number>((_, reject) =>
          setTimeout(() => reject(new Error('Directory size calculation timeout')), TIMEOUT_MS)
        )
      ]);

      const usedGB = used / 1024 / 1024 / 1024;

      // Use OS free space as a rough estimate
      // Note: This is a simplified approach
      const totalGB = 100; // Default to 100GB if we can't determine
      const usage = (usedGB / totalGB) * 100;

      return {
        usage: Math.min(usage, 100),
        used: usedGB,
        total: totalGB,
      };
    } catch (error) {
      // Timeout occurred or error during calculation
      logger.warn(`Disk usage calculation timed out or failed for ${dirPath}, using cached/default values`);
      return {
        usage: 0,
        used: 0,
        total: 100,
      };
    }
  }

  /**
   * Get total size of a directory
   */
  private async getDirectorySize(dirPath: string): Promise<number> {
    let totalSize = 0;

    try {
      const files = await fs.readdir(dirPath);

      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = await fs.stat(filePath);

        if (stats.isFile()) {
          totalSize += stats.size;
        } else if (stats.isDirectory()) {
          totalSize += await this.getDirectorySize(filePath);
        }
      }
    } catch (error) {
      // Ignore errors for inaccessible directories
    }

    return totalSize;
  }

  /**
   * Query metrics for a server
   */
  async queryMetrics(query: MetricsQuery): Promise<MetricData[]> {
    const { serverId, startTime, endTime, limit = 100 } = query;

    const where: any = {
      serverId,
    };

    if (startTime || endTime) {
      where.timestamp = {};
      if (startTime) where.timestamp.gte = startTime;
      if (endTime) where.timestamp.lte = endTime;
    }

    const metrics = await prisma.serverMetric.findMany({
      where,
      orderBy: {
        timestamp: 'desc',
      },
      take: limit,
    });

    return metrics.map(m => ({
      timestamp: m.timestamp,
      cpuUsage: m.cpuUsage,
      memoryUsage: m.memoryUsage,
      memoryUsedMB: m.memoryUsedMB,
      memoryTotalMB: m.memoryTotalMB,
      diskUsage: m.diskUsage,
      diskUsedGB: m.diskUsedGB,
      diskTotalGB: m.diskTotalGB,
      playerCount: m.playerCount,
      tps: m.tps || undefined,
    }));
  }

  /**
   * Get latest metrics for a server
   */
  async getLatestMetrics(serverId: string): Promise<MetricData | null> {
    const metric = await prisma.serverMetric.findFirst({
      where: { serverId },
      orderBy: { timestamp: 'desc' },
    });

    if (!metric) return null;

    return {
      timestamp: metric.timestamp,
      cpuUsage: metric.cpuUsage,
      memoryUsage: metric.memoryUsage,
      memoryUsedMB: metric.memoryUsedMB,
      memoryTotalMB: metric.memoryTotalMB,
      diskUsage: metric.diskUsage,
      diskUsedGB: metric.diskUsedGB,
      diskTotalGB: metric.diskTotalGB,
      playerCount: metric.playerCount,
      tps: metric.tps || undefined,
    };
  }

  /**
   * Get aggregated metrics for a time range
   */
  async getAggregatedMetrics(serverId: string, interval: '1h' | '6h' | '24h' | '7d' | '30d'): Promise<MetricData[]> {
    const now = new Date();
    const startTime = new Date(now);

    switch (interval) {
      case '1h':
        startTime.setHours(now.getHours() - 1);
        break;
      case '6h':
        startTime.setHours(now.getHours() - 6);
        break;
      case '24h':
        startTime.setDate(now.getDate() - 1);
        break;
      case '7d':
        startTime.setDate(now.getDate() - 7);
        break;
      case '30d':
        startTime.setDate(now.getDate() - 30);
        break;
    }

    return this.queryMetrics({
      serverId,
      startTime,
      endTime: now,
      limit: 1000,
    });
  }

  /**
   * Get aggregated host metrics history for dashboard charts
   * Returns data points for host CPU and memory usage
   */
  async getAggregatedMetricsHistory(range: '1h' | '24h' | '7d' | '30d'): Promise<{
    timestamps: string[];
    cpu: number[];
    memory: number[];
    players: number[];
  }> {
    const now = new Date();
    const startTime = new Date(now);
    let interval: number; // minutes between data points
    let pointCount: number;

    switch (range) {
      case '1h':
        startTime.setHours(now.getHours() - 1);
        interval = 5; // 5-minute intervals
        pointCount = 12;
        break;
      case '24h':
        startTime.setDate(now.getDate() - 1);
        interval = 60; // 1-hour intervals
        pointCount = 24;
        break;
      case '7d':
        startTime.setDate(now.getDate() - 7);
        interval = 360; // 6-hour intervals
        pointCount = 28;
        break;
      case '30d':
        startTime.setDate(now.getDate() - 30);
        interval = 1440; // 1-day intervals
        pointCount = 30;
        break;
    }

    // Get host metrics in the range
    const hostMetrics = await prisma.hostMetric.findMany({
      where: {
        timestamp: {
          gte: startTime,
          lte: now,
        },
      },
      orderBy: { timestamp: 'asc' },
    });

    // Get player counts from server metrics (for the players line)
    const serverMetrics = await prisma.serverMetric.findMany({
      where: {
        timestamp: {
          gte: startTime,
          lte: now,
        },
      },
      orderBy: { timestamp: 'asc' },
    });

    // Create time buckets - timestamps represent the END of each bucket
    // Last bucket ends at "now" so chart shows most recent data
    const timestamps: string[] = [];
    const cpuBuckets: number[][] = [];
    const memoryBuckets: number[][] = [];
    const playerBuckets: number[][] = [];

    const intervalMs = interval * 60000;
    // First bucket ENDS at (now - (pointCount-1) * interval), so it STARTS one interval before that
    const firstBucketStart = new Date(now.getTime() - pointCount * intervalMs);

    for (let i = 0; i < pointCount; i++) {
      // Timestamp is the END of the bucket (start + interval)
      const bucketEndTime = new Date(firstBucketStart.getTime() + (i + 1) * intervalMs);
      timestamps.push(bucketEndTime.toISOString());
      cpuBuckets.push([]);
      memoryBuckets.push([]);
      playerBuckets.push([]);
    }

    // Update startTime for bucket distribution calculation
    startTime.setTime(firstBucketStart.getTime());

    // Distribute host metrics into buckets
    for (const metric of hostMetrics) {
      const metricTime = metric.timestamp.getTime();
      const bucketIndex = Math.floor((metricTime - startTime.getTime()) / (interval * 60000));

      if (bucketIndex >= 0 && bucketIndex < pointCount) {
        cpuBuckets[bucketIndex].push(metric.cpuUsage);
        memoryBuckets[bucketIndex].push(metric.memoryUsage);
      }
    }

    // Distribute player counts from server metrics
    for (const metric of serverMetrics) {
      const metricTime = metric.timestamp.getTime();
      const bucketIndex = Math.floor((metricTime - startTime.getTime()) / (interval * 60000));

      if (bucketIndex >= 0 && bucketIndex < pointCount) {
        playerBuckets[bucketIndex].push(metric.playerCount);
      }
    }

    // Calculate averages for each bucket
    const cpu = cpuBuckets.map(bucket =>
      bucket.length > 0 ? Math.round(bucket.reduce((a, b) => a + b, 0) / bucket.length * 100) / 100 : 0
    );
    const memory = memoryBuckets.map(bucket =>
      bucket.length > 0 ? Math.round(bucket.reduce((a, b) => a + b, 0) / bucket.length * 100) / 100 : 0
    );
    const players = playerBuckets.map(bucket =>
      bucket.length > 0 ? Math.round(bucket.reduce((a, b) => a + b, 0) / bucket.length) : 0
    );

    return { timestamps, cpu, memory, players };
  }

  /**
   * Clean up old metrics and console logs (older than retention period)
   */
  private async cleanupOldMetrics(): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.RETENTION_DAYS);

    const serverResult = await prisma.serverMetric.deleteMany({
      where: {
        timestamp: {
          lt: cutoffDate,
        },
      },
    });

    const hostResult = await prisma.hostMetric.deleteMany({
      where: {
        timestamp: {
          lt: cutoffDate,
        },
      },
    });

    const totalCleaned = serverResult.count + hostResult.count;
    if (totalCleaned > 0) {
      logger.info(`Cleaned up ${totalCleaned} old metrics (${serverResult.count} server, ${hostResult.count} host)`);
    }

    // Also clean up old console logs
    if (this.consoleService) {
      try {
        const logsDeleted = await this.consoleService.clearAllOldLogs(this.CONSOLE_LOG_RETENTION_DAYS);
        if (logsDeleted > 0) {
          logger.info(`Cleaned up ${logsDeleted} old console logs`);
        }
      } catch (error) {
        logger.error('Error cleaning up old console logs:', error);
      }
    }
  }
}
