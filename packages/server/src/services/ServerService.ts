import { PrismaClient, Server as PrismaServer } from '@prisma/client';
import fs from 'fs-extra';
import path from 'path';
import { IServerAdapter } from '../adapters/IServerAdapter';
import { JavaServerAdapter } from '../adapters/JavaServerAdapter';
import { ServerConfig, ServerStatus, ServerMetrics } from '../types';
import logger from '../utils/logger';
import { DiscordNotificationService } from './DiscordNotificationService';
import { RconService } from './RconService';
import { LogTailService } from './LogTailService';

export class ServerService {
  private prisma: PrismaClient;
  private adapters: Map<string, IServerAdapter> = new Map();
  private discordService?: DiscordNotificationService;
  private rconService: RconService;
  private logTailService: LogTailService;

  constructor(prisma: PrismaClient, discordService?: DiscordNotificationService) {
    this.prisma = prisma;
    this.discordService = discordService;
    this.rconService = new RconService();
    this.logTailService = new LogTailService();
  }

  /**
   * Get or create an adapter for a server
   */
  private async getAdapter(serverId: string): Promise<IServerAdapter> {
    // Check if adapter already exists in memory
    if (this.adapters.has(serverId)) {
      return this.adapters.get(serverId)!;
    }

    // Load server from database
    const server = await this.prisma.server.findUnique({
      where: { id: serverId },
    });

    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    // Create appropriate adapter based on type
    let adapter: IServerAdapter;

    // Parse adapter config if available
    const adapterConfig = server.adapterConfig ? JSON.parse(server.adapterConfig) : {};

    switch (server.adapterType) {
      case 'java':
        // Parse JVM args string into array for the adapter
        // e.g., "-Xms1G -Xmx2G" -> ["-Xms1G", "-Xmx2G", "-jar"]
        let javaArgs: string[] | undefined;
        if (server.jvmArgs) {
          const jvmArgsList = server.jvmArgs.split(/\s+/).filter(arg => arg.trim());
          javaArgs = [...jvmArgsList, '-jar'];
        }

        // Parse server args string into array for the adapter
        // e.g., "--accept-early-plugins --other-arg" -> ["--accept-early-plugins", "--other-arg"]
        let serverArgs: string[] | undefined;
        if (server.serverArgs) {
          serverArgs = server.serverArgs.split(/\s+/).filter(arg => arg.trim());
        }

        adapter = new JavaServerAdapter(
          serverId,
          this.prismaToConfig(server),
          this.prisma,
          this.rconService,
          this.logTailService,
          {
            ...adapterConfig,
            // Pass JVM args if configured
            javaArgs,
            // Pass server args if configured
            serverArgs,
            // Pass persisted RCON config if available
            rconPort: server.rconPort || undefined,
            rconPassword: server.rconPassword || undefined,
            logFilePath: server.logFilePath || undefined,
          }
        );
        break;
      case 'hytale':
        // Future: HytaleServerAdapter
        throw new Error('Hytale adapter not yet implemented');
      default:
        throw new Error(`Unknown adapter type: ${server.adapterType}`);
    }

    // Cache the adapter
    this.adapters.set(serverId, adapter);

    return adapter;
  }

  /**
   * Convert Prisma server model to config
   */
  private prismaToConfig(server: PrismaServer): ServerConfig {
    return {
      name: server.name,
      address: server.address,
      port: server.port,
      maxPlayers: server.maxPlayers,
      gameMode: server.gameMode,
      worldPath: server.worldPath,
      serverPath: server.serverPath,
      version: server.version,
    };
  }

  /**
   * Get all servers
   */
  async getAllServers(): Promise<PrismaServer[]> {
    return this.prisma.server.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get a single server by ID
   */
  async getServer(serverId: string): Promise<PrismaServer | null> {
    return this.prisma.server.findUnique({
      where: { id: serverId },
      include: {
        mods: true,
        players: { where: { isOnline: true } },
      },
    });
  }

  /**
   * Create a new server
   */
  async createServer(data: {
    name: string;
    address: string;
    port: number;
    version: string;
    maxPlayers: number;
    gameMode: string;
    adapterType?: string;
    adapterConfig?: Record<string, unknown>;
    serverPath: string;
    backupPath?: string;
    backupType?: 'local' | 'ftp';
    jvmArgs?: string;
  }): Promise<PrismaServer> {
    // Check if server name already exists
    const existing = await this.prisma.server.findUnique({
      where: { name: data.name },
    });
    if (existing) {
      throw new Error('A server with this name already exists');
    }

    // Resolve to absolute path
    const serverPath = path.resolve(data.serverPath);
    const worldPath = path.join(serverPath, 'world');

    // Create the server directory
    await fs.ensureDir(serverPath);
    logger.info(`Created server directory: ${serverPath}`);

    const server = await this.prisma.server.create({
      data: {
        name: data.name,
        address: data.address,
        port: data.port,
        version: data.version,
        maxPlayers: data.maxPlayers,
        gameMode: data.gameMode,
        status: 'stopped',
        serverPath,
        worldPath,
        adapterType: data.adapterType || 'java',
        adapterConfig: data.adapterConfig ? JSON.stringify(data.adapterConfig) : null,
        backupPath: data.backupPath || null,
        backupType: data.backupType || 'local',
        jvmArgs: data.jvmArgs || null,
      },
    });

    logger.info(`Created server: ${server.name} (${server.id})`);

    return server;
  }

  /**
   * Update a server
   */
  async updateServer(
    serverId: string,
    data: Partial<ServerConfig> & {
      serverPath?: string;
      backupPath?: string | null;
      backupType?: 'local' | 'ftp';
      backupExclusions?: string[] | null;
      jvmArgs?: string;
      serverArgs?: string;
      adapterConfig?: Record<string, unknown>;
    }
  ): Promise<PrismaServer> {
    // Build update data, only including fields that are provided
    const updateData: Record<string, any> = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.address !== undefined) updateData.address = data.address;
    if (data.port !== undefined) updateData.port = data.port;
    if (data.version !== undefined) updateData.version = data.version;
    if (data.maxPlayers !== undefined) updateData.maxPlayers = data.maxPlayers;
    if (data.gameMode !== undefined) updateData.gameMode = data.gameMode;
    if (data.serverPath !== undefined) updateData.serverPath = data.serverPath;
    if (data.backupPath !== undefined) updateData.backupPath = data.backupPath;
    if (data.backupType !== undefined) updateData.backupType = data.backupType;
    if (data.backupExclusions !== undefined) {
      // Store as JSON string, or null if empty/null
      updateData.backupExclusions = data.backupExclusions && data.backupExclusions.length > 0
        ? JSON.stringify(data.backupExclusions)
        : null;
    }
    if (data.jvmArgs !== undefined) updateData.jvmArgs = data.jvmArgs;
    if (data.serverArgs !== undefined) updateData.serverArgs = data.serverArgs;

    // Handle adapterConfig - merge with existing config
    if (data.adapterConfig !== undefined) {
      const existingServer = await this.prisma.server.findUnique({
        where: { id: serverId },
        select: { adapterConfig: true },
      });

      let existingConfig: Record<string, unknown> = {};
      if (existingServer?.adapterConfig) {
        try {
          existingConfig = JSON.parse(existingServer.adapterConfig);
        } catch {
          existingConfig = {};
        }
      }

      // Merge new config with existing
      const mergedConfig = { ...existingConfig, ...data.adapterConfig };
      updateData.adapterConfig = JSON.stringify(mergedConfig);
    }

    const server = await this.prisma.server.update({
      where: { id: serverId },
      data: updateData,
    });

    // Invalidate cached adapter so next start uses fresh settings from DB
    // This ensures all settings (address, port, jvmArgs, jarFile, assetsPath, javaPath)
    // are applied when the server restarts
    this.adapters.delete(serverId);

    logger.info(`Updated server: ${server.name} (${server.id})`);

    return server;
  }

  /**
   * Delete a server
   */
  async deleteServer(serverId: string): Promise<void> {
    // Get server info before deleting
    const server = await this.prisma.server.findUnique({
      where: { id: serverId },
    });

    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    // Stop server if running
    const adapter = this.adapters.get(serverId);
    if (adapter) {
      try {
        await adapter.kill();
      } catch (error) {
        logger.error(`Error killing server ${serverId}:`, error);
      }
      this.adapters.delete(serverId);
    }

    // Delete server from database
    await this.prisma.server.delete({
      where: { id: serverId },
    });

    // Delete server files
    const serverPath = path.resolve(server.serverPath);
    if (await fs.pathExists(serverPath)) {
      await fs.remove(serverPath);
      logger.info(`Deleted server files: ${serverPath}`);
    }

    logger.info(`Deleted server: ${serverId}`);
  }

  /**
   * Start a server
   */
  async startServer(serverId: string): Promise<void> {
    const server = await this.getServer(serverId);
    if (!server) throw new Error(`Server ${serverId} not found`);

    await this.ensureProxyAuthModeIfNeeded(serverId);
    const adapter = await this.getAdapter(serverId);

    await this.prisma.server.update({
      where: { id: serverId },
      data: { status: 'starting' },
    });

    try {
      await adapter.start();

      await this.prisma.server.update({
        where: { id: serverId },
        data: { status: 'running' },
      });

      logger.info(`Started server: ${serverId}`);

      // Send Discord notification
      if (this.discordService) {
        await this.discordService.notify('server_start', {
          serverName: server.name,
        });
      }
    } catch (error) {
      // Reset status to stopped on failure
      logger.error(`Failed to start server ${serverId}:`, error);

      await this.prisma.server.update({
        where: { id: serverId },
        data: {
          status: 'stopped',
          pid: null,
          startedAt: null,
        },
      });

      // Re-throw the error so the caller knows it failed
      throw error;
    }
  }

  /**
   * Stop a server
   */
  async stopServer(serverId: string): Promise<void> {
    const server = await this.getServer(serverId);
    if (!server) throw new Error(`Server ${serverId} not found`);

    const adapter = await this.getAdapter(serverId);
    const previousStatus = server.status;

    await this.prisma.server.update({
      where: { id: serverId },
      data: { status: 'stopping' },
    });

    try {
      await adapter.stop();

      await this.prisma.server.update({
        where: { id: serverId },
        data: { status: 'stopped' },
      });

      // Clear adapter cache so next start reads fresh settings from DB
      this.adapters.delete(serverId);

      logger.info(`Stopped server: ${serverId}`);

      // Send Discord notification
      if (this.discordService) {
        await this.discordService.notify('server_stop', {
          serverName: server.name,
        });
      }
    } catch (error) {
      // Reset status to previous state on failure
      logger.error(`Failed to stop server ${serverId}:`, error);

      await this.prisma.server.update({
        where: { id: serverId },
        data: { status: previousStatus },
      });

      throw error;
    }
  }

  /**
   * Restart a server
   */
  async restartServer(serverId: string): Promise<void> {
    const server = await this.getServer(serverId);
    if (!server) throw new Error(`Server ${serverId} not found`);

    // Update status to 'stopping'
    await this.prisma.server.update({
      where: { id: serverId },
      data: { status: 'stopping' },
    });

    const adapter = await this.getAdapter(serverId);

    // Stop the server
    await adapter.stop();

    // Update status to 'starting'
    await this.prisma.server.update({
      where: { id: serverId },
      data: { status: 'starting' },
    });

    // Wait before starting (same as adapter.restart())
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Start the server
    await adapter.start();

    // Update status to 'running'
    await this.prisma.server.update({
      where: { id: serverId },
      data: { status: 'running' },
    });

    logger.info(`Restarted server: ${serverId}`);

    // Send Discord notification
    if (this.discordService) {
      await this.discordService.notify('server_restart', {
        serverName: server.name,
      });
    }
  }

  /**
   * Kill a server
   */
  async killServer(serverId: string): Promise<void> {
    const adapter = await this.getAdapter(serverId);
    await adapter.kill();

    await this.prisma.server.update({
      where: { id: serverId },
      data: { status: 'stopped' },
    });

    logger.info(`Killed server: ${serverId}`);
  }

  /**
   * Get server status
   */
  async getServerStatus(serverId: string): Promise<ServerStatus> {
    const adapter = await this.getAdapter(serverId);
    return adapter.getStatus();
  }

  /**
   * Get server metrics
   */
  async getServerMetrics(serverId: string): Promise<ServerMetrics> {
    const adapter = await this.getAdapter(serverId);
    return adapter.getMetrics();
  }

  /**
   * Get server config
   */
  async getServerConfig(serverId: string): Promise<ServerConfig> {
    const adapter = await this.getAdapter(serverId);
    return adapter.getConfig();
  }

  private async ensureProxyAuthModeIfNeeded(serverId: string): Promise<void> {
    const memberships = await this.prisma.serverNetworkMember.findMany({
      where: { serverId },
      include: {
        network: {
          select: { networkType: true },
        },
      },
    });

    const isProxyBackend = memberships.some(
      (membership) => membership.role !== 'proxy' && membership.network.networkType === 'proxy'
    );
    if (!isProxyBackend) {
      return;
    }

    const dbServer = await this.prisma.server.findUnique({
      where: { id: serverId },
      select: { serverArgs: true },
    });
    if (!dbServer) {
      return;
    }

    const currentArgs = (dbServer.serverArgs || '').trim();
    const tokens = currentArgs.length > 0 ? currentArgs.split(/\s+/).filter(Boolean) : [];
    const normalizedTokens: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === '--auth-mode') {
        i += 1;
        continue;
      }
      normalizedTokens.push(token);
    }
    normalizedTokens.push('--auth-mode', 'insecure');
    const mergedArgs = normalizedTokens.join(' ').replace(/\s+/g, ' ').trim();

    if (mergedArgs === currentArgs) {
      return;
    }

    await this.prisma.server.update({
      where: { id: serverId },
      data: { serverArgs: mergedArgs },
    });

    // Ensure adapter reloads fresh args right before start.
    this.adapters.delete(serverId);
  }

  /**
   * Get adapter for external use (e.g., in WebSocket handlers)
   */
  async getAdapterForServer(serverId: string): Promise<IServerAdapter> {
    return this.getAdapter(serverId);
  }

  /**
   * Recover orphaned servers after manager restart
   * Finds servers that were running before shutdown and reconnects to them
   */
  async recoverOrphanedServers(): Promise<void> {
    logger.info('Checking for orphaned servers to recover...');

    // Find servers with running/orphaned status and a PID
    const orphanedServers = await this.prisma.server.findMany({
      where: {
        status: { in: ['running', 'starting', 'orphaned'] },
        pid: { not: null },
      },
    });

    if (orphanedServers.length === 0) {
      logger.info('No orphaned servers found');
      return;
    }

    logger.info(`Found ${orphanedServers.length} potentially orphaned server(s)`);

    for (const server of orphanedServers) {
      try {
        logger.info(`Attempting to recover server: ${server.name} (PID: ${server.pid})`);

        // Create adapter for this server
        const adapter = await this.getAdapter(server.id);

        // Try to reconnect to the existing process
        const reconnected = await adapter.reconnect(server.pid!);

        if (reconnected) {
          logger.info(`Successfully reconnected to server ${server.name} (PID: ${server.pid})`);

          // Update status in database
          await this.prisma.server.update({
            where: { id: server.id },
            data: { status: 'running' },
          });
        } else {
          // Process died while manager was down
          logger.warn(`Server ${server.name} process (PID: ${server.pid}) no longer exists - marking as crashed`);

          await this.prisma.server.update({
            where: { id: server.id },
            data: {
              status: 'crashed',
              pid: null,
              startedAt: null,
            },
          });

          // Remove adapter from cache since server isn't running
          this.adapters.delete(server.id);

          // Send Discord notification about crash
          if (this.discordService) {
            await this.discordService.notify('server_crash', {
              serverName: server.name,
            });
          }
        }
      } catch (error) {
        logger.error(`Failed to recover server ${server.name}:`, error);

        // Mark as crashed
        await this.prisma.server.update({
          where: { id: server.id },
          data: {
            status: 'crashed',
            pid: null,
            startedAt: null,
          },
        });
      }
    }

    logger.info('Server recovery complete');
  }

  /**
   * Cleanup - disconnect from all servers without killing them
   * This allows servers to keep running during manager restart
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up server adapters (keeping servers running)...');

    for (const [serverId, adapter] of this.adapters.entries()) {
      try {
        // Mark server as orphaned in database (it's still running but unmanaged)
        const pid = adapter.getPid();
        if (pid) {
          await this.prisma.server.update({
            where: { id: serverId },
            data: { status: 'orphaned' },
          });
        }

        // Disconnect without killing the process
        await adapter.disconnect();
        logger.info(`Disconnected from server ${serverId} (process still running)`);
      } catch (error) {
        logger.error(`Error cleaning up adapter for ${serverId}:`, error);
      }
    }

    // Cleanup services
    await this.rconService.disconnectAll();
    await this.logTailService.stopAll();

    this.adapters.clear();
    logger.info('Cleanup complete - servers left running for recovery');
  }
}
