import { PrismaClient } from '@prisma/client';
import { IServerAdapter } from '../adapters/IServerAdapter';
import { LogEntry, CommandResponse } from '../types';
import logger from '../utils/logger';

interface QueuedLog {
  serverId: string;
  log: LogEntry;
}

export class ConsoleService {
  private prisma: PrismaClient;
  private logQueue: QueuedLog[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing: boolean = false;

  // Batch configuration
  private readonly FLUSH_INTERVAL_MS = 200; // Flush every 200ms
  private readonly MAX_QUEUE_SIZE = 50; // Flush when queue reaches this size

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Send a command to the server
   */
  async sendCommand(adapter: IServerAdapter, command: string): Promise<CommandResponse> {
    logger.info(`Sending command: ${command}`);
    const response = await adapter.sendCommand(command);
    return response;
  }

  /**
   * Get historical logs from database
   */
  async getLogs(
    serverId: string,
    limit: number = 100,
    offset: number = 0,
    level?: string
  ): Promise<LogEntry[]> {
    const where: any = { serverId };
    if (level) {
      where.level = level;
    }

    const logs = await this.prisma.consoleLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit,
      skip: offset,
    });

    return logs.map(log => ({
      id: log.id,
      timestamp: log.timestamp,
      level: log.level as 'info' | 'warn' | 'error' | 'debug',
      message: log.message,
      source: log.source || undefined,
    }));
  }

  /**
   * Save a log entry to the database (queued for batch insert)
   */
  async saveLog(serverId: string, log: LogEntry): Promise<void> {
    this.queueLog(serverId, log);
  }

  /**
   * Queue a log entry for batch insertion
   */
  private queueLog(serverId: string, log: LogEntry): void {
    this.logQueue.push({ serverId, log });

    // Start flush timer if not already running
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushLogs();
      }, this.FLUSH_INTERVAL_MS);
    }

    // Flush immediately if queue is full
    if (this.logQueue.length >= this.MAX_QUEUE_SIZE) {
      this.flushLogs();
    }
  }

  /**
   * Flush queued logs to database in a single transaction
   */
  private async flushLogs(): Promise<void> {
    // Clear the timer
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Skip if already flushing or queue is empty
    if (this.isFlushing || this.logQueue.length === 0) {
      return;
    }

    this.isFlushing = true;

    // Take current queue and reset it
    const logsToFlush = this.logQueue;
    this.logQueue = [];

    try {
      // Use createMany for efficient batch insert
      await this.prisma.consoleLog.createMany({
        data: logsToFlush.map(({ serverId, log }) => ({
          serverId,
          timestamp: log.timestamp,
          level: log.level,
          message: log.message,
          source: log.source || 'server',
        })),
      });
    } catch (error) {
      // Don't throw errors for log saving failures
      logger.error(`Failed to batch save ${logsToFlush.length} logs to database:`, error);
    } finally {
      this.isFlushing = false;

      // If more logs accumulated while flushing, schedule another flush
      if (this.logQueue.length > 0 && !this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          this.flushLogs();
        }, this.FLUSH_INTERVAL_MS);
      }
    }
  }

  /**
   * Flush any remaining logs (call on shutdown)
   */
  async cleanup(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flushLogs();
  }

  /**
   * Clear old logs (housekeeping)
   */
  async clearOldLogs(serverId: string, olderThanDays: number = 7): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await this.prisma.consoleLog.deleteMany({
      where: {
        serverId,
        timestamp: {
          lt: cutoffDate,
        },
      },
    });

    logger.info(`Cleared ${result.count} old logs for server ${serverId}`);

    return result.count;
  }

  /**
   * Clear old logs for all servers (housekeeping)
   */
  async clearAllOldLogs(olderThanDays: number = 7): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await this.prisma.consoleLog.deleteMany({
      where: {
        timestamp: {
          lt: cutoffDate,
        },
      },
    });

    if (result.count > 0) {
      logger.info(`Cleared ${result.count} old console logs across all servers`);
    }

    return result.count;
  }

  /**
   * Stream logs from the adapter
   */
  streamLogs(adapter: IServerAdapter, callback: (log: LogEntry) => void): void {
    adapter.streamLogs(callback);
  }

  /**
   * Stop streaming logs
   */
  stopStreamLogs(adapter: IServerAdapter): void {
    adapter.stopLogStream();
  }
}
