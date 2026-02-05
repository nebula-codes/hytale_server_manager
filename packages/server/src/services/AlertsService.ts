import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';
import { DiscordNotificationService } from './DiscordNotificationService';

const prisma = new PrismaClient();

export type AlertType = 'server_down' | 'high_cpu' | 'high_memory' | 'high_disk' | 'player_join' | 'player_leave' | 'custom';
export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertInfo {
  id: string;
  serverId: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  isRead: boolean;
  isResolved: boolean;
  metadata?: any;
  createdAt: Date;
  resolvedAt?: Date;
}

export interface CreateAlertData {
  serverId: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  metadata?: any;
}

export class AlertsService {
  private alertListeners: Array<(alert: AlertInfo) => void> = [];
  private monitoringInterval: NodeJS.Timeout | null = null;
  private readonly MONITORING_INTERVAL_MS = 60000; // 1 minute
  private readonly RETENTION_DAYS = 90; // Keep alerts for 90 days
  private discordService?: DiscordNotificationService;

  // Alert thresholds
  private readonly CPU_WARNING_THRESHOLD = 80;
  private readonly CPU_CRITICAL_THRESHOLD = 95;
  private readonly MEMORY_WARNING_THRESHOLD = 85;
  private readonly MEMORY_CRITICAL_THRESHOLD = 95;
  private readonly DISK_WARNING_THRESHOLD = 85;
  private readonly DISK_CRITICAL_THRESHOLD = 95;

  constructor(discordService?: DiscordNotificationService) {
    this.discordService = discordService;
  }

  /**
   * Create a new alert
   */
  async createAlert(data: CreateAlertData): Promise<AlertInfo> {
    const alert = await prisma.alert.create({
      data: {
        serverId: data.serverId,
        type: data.type,
        severity: data.severity,
        title: data.title,
        message: data.message,
        metadata: data.metadata ? JSON.stringify(data.metadata) : null,
        isRead: false,
        isResolved: false,
      },
    });

    const alertInfo = this.mapToAlertInfo(alert);

    // Notify listeners
    this.notifyListeners(alertInfo);

    logger.info(`Alert created: ${data.title} (${data.severity})`);

    // Send Discord notification for alerts
    if (this.discordService) {
      const server = await prisma.server.findUnique({
        where: { id: data.serverId },
      });

      // Map alert type to Discord notification event
      if (data.severity === 'critical') {
        await this.discordService.notify('alert_critical', {
          serverName: server?.name,
          reason: data.title,
          details: data.message || data.title,
        });
      } else if (data.severity === 'warning') {
        await this.discordService.notify('alert_warning', {
          serverName: server?.name,
          reason: data.title,
          details: data.message || data.title,
        });
      }

      // Also send specific performance alerts
      if (data.type === 'high_cpu') {
        const cpuUsage = data.metadata?.cpuUsage ?? data.metadata;
        await this.discordService.notify('high_cpu', {
          serverName: server?.name,
          details: typeof cpuUsage === 'object' ? JSON.stringify(cpuUsage) : cpuUsage,
        });
      } else if (data.type === 'high_memory') {
        const memoryUsage = data.metadata?.memoryUsage ?? data.metadata;
        await this.discordService.notify('high_memory', {
          serverName: server?.name,
          details: typeof memoryUsage === 'object' ? JSON.stringify(memoryUsage) : memoryUsage,
        });
      } else if (data.type === 'high_disk') {
        const diskUsage = data.metadata?.diskUsage ?? data.metadata;
        await this.discordService.notify('high_disk', {
          serverName: server?.name,
          details: typeof diskUsage === 'object' ? JSON.stringify(diskUsage) : diskUsage,
        });
      }
    }

    return alertInfo;
  }

  /**
   * Get alerts for a server
   */
  async getAlerts(serverId?: string, options?: {
    unreadOnly?: boolean;
    unresolvedOnly?: boolean;
    limit?: number;
  }): Promise<AlertInfo[]> {
    const where: any = {};

    if (serverId) {
      where.serverId = serverId;
    }

    if (options?.unreadOnly) {
      where.isRead = false;
    }

    if (options?.unresolvedOnly) {
      where.isResolved = false;
    }

    const alerts = await prisma.alert.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      take: options?.limit || 100,
    });

    return alerts.map(this.mapToAlertInfo);
  }

  /**
   * Get alert by ID
   */
  async getAlert(alertId: string): Promise<AlertInfo | null> {
    const alert = await prisma.alert.findUnique({
      where: { id: alertId },
    });

    if (!alert) return null;

    return this.mapToAlertInfo(alert);
  }

  /**
   * Mark alert as read
   */
  async markAsRead(alertId: string): Promise<void> {
    await prisma.alert.update({
      where: { id: alertId },
      data: { isRead: true },
    });
  }

  /**
   * Mark all alerts as read
   */
  async markAllAsRead(serverId?: string): Promise<void> {
    const where: any = {};
    if (serverId) {
      where.serverId = serverId;
    }

    await prisma.alert.updateMany({
      where,
      data: { isRead: true },
    });
  }

  /**
   * Resolve alert
   */
  async resolveAlert(alertId: string): Promise<void> {
    await prisma.alert.update({
      where: { id: alertId },
      data: {
        isResolved: true,
        resolvedAt: new Date(),
      },
    });
  }

  /**
   * Delete alert
   */
  async deleteAlert(alertId: string): Promise<void> {
    await prisma.alert.delete({
      where: { id: alertId },
    });
  }

  /**
   * Delete multiple alerts
   */
  async deleteAlerts(alertIds: string[]): Promise<number> {
    const result = await prisma.alert.deleteMany({
      where: { id: { in: alertIds } },
    });
    return result.count;
  }

  /**
   * Get unread count
   */
  async getUnreadCount(serverId?: string): Promise<number> {
    const where: any = { isRead: false };
    if (serverId) {
      where.serverId = serverId;
    }

    return prisma.alert.count({ where });
  }

  /**
   * Subscribe to alert notifications
   */
  onAlert(callback: (alert: AlertInfo) => void): () => void {
    this.alertListeners.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.alertListeners.indexOf(callback);
      if (index > -1) {
        this.alertListeners.splice(index, 1);
      }
    };
  }

  /**
   * Notify all listeners of a new alert
   */
  private notifyListeners(alert: AlertInfo): void {
    for (const listener of this.alertListeners) {
      try {
        listener(alert);
      } catch (error) {
        logger.error('Error in alert listener:', error);
      }
    }
  }

  /**
   * Start monitoring for alert conditions
   */
  async startMonitoring(): Promise<void> {
    if (this.monitoringInterval) {
      logger.warn('Alert monitoring already running');
      return;
    }

    logger.info('Starting alert monitoring');

    // Monitor immediately
    await this.checkAlertConditions();

    // Then monitor every minute
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.checkAlertConditions();
      } catch (error: any) {
        logger.error('Error checking alert conditions:', error);
      }
    }, this.MONITORING_INTERVAL_MS);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      logger.info('Stopped alert monitoring');
    }
  }

  /**
   * Check for alert conditions
   */
  private async checkAlertConditions(): Promise<void> {
    const servers = await prisma.server.findMany({
      include: {
        metrics: {
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
      },
    });

    for (const server of servers) {
      // Check if server is down
      if (server.status === 'stopped') {
        await this.checkAndCreateAlert(
          server.id,
          'server_down',
          'critical',
          `Server ${server.name} is down`,
          `The server ${server.name} is currently stopped.`
        );
      } else if (server.status === 'running') {
        // Auto-resolve server_down alerts when server is back online
        await this.autoResolveAlerts(server.id, 'server_down');
      }

      // Check metrics if available
      if (server.metrics.length > 0) {
        const metric = server.metrics[0];

        // Check CPU usage
        if (metric.cpuUsage >= this.CPU_CRITICAL_THRESHOLD) {
          await this.checkAndCreateAlert(
            server.id,
            'high_cpu',
            'critical',
            `Critical CPU usage on ${server.name}`,
            `CPU usage is at ${metric.cpuUsage.toFixed(1)}%`,
            { cpuUsage: metric.cpuUsage }
          );
        } else if (metric.cpuUsage >= this.CPU_WARNING_THRESHOLD) {
          await this.checkAndCreateAlert(
            server.id,
            'high_cpu',
            'warning',
            `High CPU usage on ${server.name}`,
            `CPU usage is at ${metric.cpuUsage.toFixed(1)}%`,
            { cpuUsage: metric.cpuUsage }
          );
        } else {
          // Auto-resolve high_cpu alerts when CPU is back to normal
          await this.autoResolveAlerts(server.id, 'high_cpu');
        }

        // Check memory usage
        if (metric.memoryUsage >= this.MEMORY_CRITICAL_THRESHOLD) {
          await this.checkAndCreateAlert(
            server.id,
            'high_memory',
            'critical',
            `Critical memory usage on ${server.name}`,
            `Memory usage is at ${metric.memoryUsage.toFixed(1)}%`,
            { memoryUsage: metric.memoryUsage }
          );
        } else if (metric.memoryUsage >= this.MEMORY_WARNING_THRESHOLD) {
          await this.checkAndCreateAlert(
            server.id,
            'high_memory',
            'warning',
            `High memory usage on ${server.name}`,
            `Memory usage is at ${metric.memoryUsage.toFixed(1)}%`,
            { memoryUsage: metric.memoryUsage }
          );
        } else {
          // Auto-resolve high_memory alerts when memory is back to normal
          await this.autoResolveAlerts(server.id, 'high_memory');
        }

        // Check disk usage
        if (metric.diskUsage >= this.DISK_CRITICAL_THRESHOLD) {
          await this.checkAndCreateAlert(
            server.id,
            'high_disk',
            'critical',
            `Critical disk usage on ${server.name}`,
            `Disk usage is at ${metric.diskUsage.toFixed(1)}%`,
            { diskUsage: metric.diskUsage }
          );
        } else if (metric.diskUsage >= this.DISK_WARNING_THRESHOLD) {
          await this.checkAndCreateAlert(
            server.id,
            'high_disk',
            'warning',
            `High disk usage on ${server.name}`,
            `Disk usage is at ${metric.diskUsage.toFixed(1)}%`,
            { diskUsage: metric.diskUsage }
          );
        } else {
          // Auto-resolve high_disk alerts when disk usage is back to normal
          await this.autoResolveAlerts(server.id, 'high_disk');
        }
      }
    }

    // Clean up old alerts periodically (once per day)
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() === 0) {
      await this.cleanupOldAlerts();
    }
  }

  /**
   * Check if similar unresolved alert exists, create if not
   */
  private async checkAndCreateAlert(
    serverId: string,
    type: AlertType,
    severity: AlertSeverity,
    title: string,
    message: string,
    metadata?: any
  ): Promise<void> {
    // Check if any unresolved alert of the same type exists for this server
    // No time window - prevents repeated alerts for ongoing conditions
    const existingAlert = await prisma.alert.findFirst({
      where: {
        serverId,
        type,
        isResolved: false,
      },
    });

    if (!existingAlert) {
      await this.createAlert({
        serverId,
        type,
        severity,
        title,
        message,
        metadata,
      });
    }
  }

  /**
   * Auto-resolve alerts when conditions are no longer met
   */
  private async autoResolveAlerts(
    serverId: string,
    type: AlertType
  ): Promise<void> {
    await prisma.alert.updateMany({
      where: {
        serverId,
        type,
        isResolved: false,
      },
      data: {
        isResolved: true,
        resolvedAt: new Date(),
      },
    });
  }

  /**
   * Clean up old resolved alerts
   */
  private async cleanupOldAlerts(): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.RETENTION_DAYS);

    const result = await prisma.alert.deleteMany({
      where: {
        isResolved: true,
        createdAt: {
          lt: cutoffDate,
        },
      },
    });

    if (result.count > 0) {
      logger.info(`Cleaned up ${result.count} old alerts`);
    }
  }

  /**
   * Map database alert to AlertInfo
   */
  private mapToAlertInfo(alert: any): AlertInfo {
    return {
      id: alert.id,
      serverId: alert.serverId,
      type: alert.type,
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
      isRead: alert.isRead,
      isResolved: alert.isResolved,
      metadata: alert.metadata ? JSON.parse(alert.metadata) : undefined,
      createdAt: alert.createdAt,
      resolvedAt: alert.resolvedAt || undefined,
    };
  }
}
