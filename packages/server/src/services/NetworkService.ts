import { PrismaClient, ServerNetwork as PrismaNetwork } from '@prisma/client';
import { ServerService } from './ServerService';
import { BackupService } from './BackupService';
import { ProxyService, ProxyNetworkConfig, ProxyBackendServer } from './ProxyService';
import {
  NetworkType,
  NetworkStatusType,
  MemberRole,
  NetworkWithMembers,
  NetworkStatus,
  AggregatedMetrics,
  NetworkPlayerInfo,
  BulkOperationResult,
  ServerOperationResult,
} from '../types';
import logger from '../utils/logger';

interface CreateNetworkDto {
  name: string;
  description?: string;
  networkType?: NetworkType;
  proxyServerId?: string;
  proxyConfig?: ProxyNetworkConfig;
  color?: string;
  serverIds?: string[];
}

interface UpdateNetworkDto {
  name?: string;
  description?: string;
  proxyServerId?: string;
  proxyConfig?: ProxyNetworkConfig;
  color?: string;
  sortOrder?: number;
  bulkActionsEnabled?: boolean;
}

export class NetworkService {
  private prisma: PrismaClient;
  private serverService: ServerService;
  private backupService: BackupService;
  private proxyService: ProxyService;

  constructor(
    prisma: PrismaClient,
    serverService: ServerService,
    backupService: BackupService,
    proxyService: ProxyService
  ) {
    this.prisma = prisma;
    this.serverService = serverService;
    this.backupService = backupService;
    this.proxyService = proxyService;
  }

  // ==========================================
  // Network CRUD
  // ==========================================

  async createNetwork(data: CreateNetworkDto): Promise<PrismaNetwork> {
    // Check if network name already exists
    const existing = await this.prisma.serverNetwork.findUnique({
      where: { name: data.name },
    });
    if (existing) {
      throw new Error('A network with this name already exists');
    }

    // Enforce version alignment across provided servers (including proxy)
    if (data.serverIds?.length) {
      await this.assertUniformVersion(data.serverIds, data.proxyServerId);
    } else if (data.proxyServerId) {
      await this.assertUniformVersion([data.proxyServerId], data.proxyServerId);
    }

    const network = await this.prisma.serverNetwork.create({
      data: {
        name: data.name,
        description: data.description,
        networkType: data.networkType || 'logical',
        proxyServerId: data.proxyServerId,
        proxyConfig: data.proxyConfig ? JSON.stringify(data.proxyConfig) : null,
        color: data.color,
      },
    });

    // Add servers if provided
    if (data.serverIds && data.serverIds.length > 0) {
      for (let i = 0; i < data.serverIds.length; i++) {
        const serverId = data.serverIds[i];
        const role: MemberRole = serverId === data.proxyServerId
          ? 'proxy'
          : data.networkType === 'proxy'
            ? 'backend'
            : 'member';
        await this.addServer(network.id, serverId, role, i);
      }
    }

    logger.info(`Created network: ${network.name} (${network.id})`);
    return network;
  }

  async getNetwork(networkId: string): Promise<NetworkWithMembers | null> {
    const network = await this.prisma.serverNetwork.findUnique({
      where: { id: networkId },
      include: {
        members: {
          include: {
            server: {
              select: { id: true, name: true, status: true },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    return network as NetworkWithMembers | null;
  }

  async getAllNetworks(): Promise<NetworkWithMembers[]> {
    const networks = await this.prisma.serverNetwork.findMany({
      include: {
        members: {
          include: {
            server: {
              select: { id: true, name: true, status: true },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });

    return networks as NetworkWithMembers[];
  }

  async updateNetwork(networkId: string, data: UpdateNetworkDto): Promise<PrismaNetwork> {
    const updateData: Record<string, unknown> = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.proxyServerId !== undefined) {
      await this.assertUniformVersion([], data.proxyServerId, networkId);
      updateData.proxyServerId = data.proxyServerId;
    }
    if (data.proxyConfig !== undefined) updateData.proxyConfig = JSON.stringify(data.proxyConfig);
    if (data.color !== undefined) updateData.color = data.color;
    if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;
    if (data.bulkActionsEnabled !== undefined) updateData.bulkActionsEnabled = data.bulkActionsEnabled;

    const network = await this.prisma.serverNetwork.update({
      where: { id: networkId },
      data: updateData,
    });

    await this.syncProxyConfigForNetwork(networkId);

    logger.info(`Updated network: ${network.name} (${network.id})`);
    return network;
  }

  async deleteNetwork(networkId: string): Promise<void> {
    const network = await this.prisma.serverNetwork.findUnique({
      where: { id: networkId },
    });

    if (!network) {
      throw new Error(`Network ${networkId} not found`);
    }

    // Cascade delete handles members and backups
    await this.prisma.serverNetwork.delete({
      where: { id: networkId },
    });

    logger.info(`Deleted network: ${network.name} (${networkId})`);
  }

  // ==========================================
  // Membership Management
  // ==========================================

  async addServer(
    networkId: string,
    serverId: string,
    role: MemberRole = 'member',
    sortOrder?: number
  ): Promise<void> {
    // Check if server exists
    const server = await this.prisma.server.findUnique({
      where: { id: serverId },
    });
    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    // Check if already a member
    const existing = await this.prisma.serverNetworkMember.findUnique({
      where: {
        networkId_serverId: { networkId, serverId },
      },
    });
    if (existing) {
      throw new Error(`Server ${server.name} is already a member of this network`);
    }

    // Get next sort order if not provided
    if (sortOrder === undefined) {
      const maxSort = await this.prisma.serverNetworkMember.aggregate({
        where: { networkId },
        _max: { sortOrder: true },
      });
      sortOrder = (maxSort._max.sortOrder ?? -1) + 1;
    }

    // Enforce version consistency within network
    await this.assertUniformVersion([serverId], undefined, networkId);

    await this.prisma.serverNetworkMember.create({
      data: {
        networkId,
        serverId,
        role,
        sortOrder,
      },
    });

    await this.syncProxyConfigForNetwork(networkId);

    logger.info(`Added server ${server.name} to network ${networkId} with role ${role}`);
  }

  async removeServer(networkId: string, serverId: string): Promise<void> {
    const membership = await this.prisma.serverNetworkMember.findUnique({
      where: {
        networkId_serverId: { networkId, serverId },
      },
    });

    if (!membership) {
      throw new Error('Server is not a member of this network');
    }

    await this.prisma.serverNetworkMember.delete({
      where: { id: membership.id },
    });

    // If this was the proxy server, clear the proxy reference
    const network = await this.prisma.serverNetwork.findUnique({
      where: { id: networkId },
    });
    if (network?.proxyServerId === serverId) {
      await this.prisma.serverNetwork.update({
        where: { id: networkId },
        data: { proxyServerId: null },
      });
    }

    await this.syncProxyConfigForNetwork(networkId);

    logger.info(`Removed server ${serverId} from network ${networkId}`);
  }

  async updateMemberRole(networkId: string, serverId: string, role: MemberRole): Promise<void> {
    await this.prisma.serverNetworkMember.update({
      where: {
        networkId_serverId: { networkId, serverId },
      },
      data: { role },
    });

    await this.syncProxyConfigForNetwork(networkId);

    logger.info(`Updated server ${serverId} role to ${role} in network ${networkId}`);
  }

  async reorderMembers(networkId: string, serverIds: string[]): Promise<void> {
    for (let i = 0; i < serverIds.length; i++) {
      await this.prisma.serverNetworkMember.update({
        where: {
          networkId_serverId: { networkId, serverId: serverIds[i] },
        },
        data: { sortOrder: i },
      });
    }

    await this.syncProxyConfigForNetwork(networkId);

    logger.info(`Reordered ${serverIds.length} servers in network ${networkId}`);
  }

  // ==========================================
  // Bulk Operations
  // ==========================================

  async startNetwork(networkId: string): Promise<BulkOperationResult> {
    const network = await this.getNetwork(networkId);
    if (!network) {
      throw new Error(`Network ${networkId} not found`);
    }

    const results: ServerOperationResult[] = [];

    if (network.networkType === 'proxy') {
      const proxyConfig = this.parseProxyConfig(network.proxyConfig);
      const startOrder = proxyConfig.startOrder || 'backends_first';
      const backendMembers = network.members.filter(m => m.role !== 'proxy');
      const backendServers = await this.loadBackendServers(backendMembers.map(member => member.serverId));
      this.ensureUniformBackendVersion(backendServers);

      await this.ensureBackendServerArgs(backendServers);

      if (startOrder === 'backends_first') {
        // Start backends first
        for (const member of backendMembers) {
          results.push(await this.startServerSafe(member.serverId, member.server.name));
        }
        // Then start proxy process
        results.push(await this.startProxySafe(network.id, network.name, backendServers, proxyConfig));
      } else {
        // Start proxy first
        results.push(await this.startProxySafe(network.id, network.name, backendServers, proxyConfig));
        // Then start backends
        for (const member of backendMembers) {
          results.push(await this.startServerSafe(member.serverId, member.server.name));
        }
      }
    } else {
      // Logical network - start all in parallel
      const startPromises = network.members.map(m =>
        this.startServerSafe(m.serverId, m.server.name)
      );
      results.push(...(await Promise.all(startPromises)));
    }

    const success = results.every(r => r.success);
    logger.info(`Started network ${network.name}: ${results.filter(r => r.success).length}/${results.length} servers`);

    return { networkId, results, success };
  }

  async stopNetwork(networkId: string): Promise<BulkOperationResult> {
    const network = await this.getNetwork(networkId);
    if (!network) {
      throw new Error(`Network ${networkId} not found`);
    }

    const results: ServerOperationResult[] = [];

    if (network.networkType === 'proxy') {
      const proxyConfig = this.parseProxyConfig(network.proxyConfig);
      // Stop order is reverse of start order
      const startOrder = proxyConfig.startOrder || 'backends_first';

      const backendMembers = network.members.filter(m => m.role !== 'proxy');
      const backendServers = await this.loadBackendServers(backendMembers.map(member => member.serverId));
      this.ensureUniformBackendVersion(backendServers);

      if (startOrder === 'backends_first') {
        // Stop proxy first (reverse of backends_first start)
        results.push(await this.stopProxySafe(network.id));
        // Then stop backends
        for (const member of backendMembers) {
          results.push(await this.stopServerSafe(member.serverId, member.server.name));
        }
      } else {
        // Stop backends first (reverse of proxy_first start)
        for (const member of backendMembers) {
          results.push(await this.stopServerSafe(member.serverId, member.server.name));
        }
        // Then stop proxy
        results.push(await this.stopProxySafe(network.id));
      }
    } else {
      // Logical network - stop all in parallel
      const stopPromises = network.members.map(m =>
        this.stopServerSafe(m.serverId, m.server.name)
      );
      results.push(...(await Promise.all(stopPromises)));
    }

    const success = results.every(r => r.success);
    logger.info(`Stopped network ${network.name}: ${results.filter(r => r.success).length}/${results.length} servers`);

    return { networkId, results, success };
  }

  async restartNetwork(networkId: string): Promise<BulkOperationResult> {
    // Stop first, then start
    await this.stopNetwork(networkId);
    // Wait a bit for clean shutdown
    await new Promise(resolve => setTimeout(resolve, 2000));
    return this.startNetwork(networkId);
  }

  private async startServerSafe(serverId: string, serverName: string): Promise<ServerOperationResult> {
    try {
      await this.serverService.startServer(serverId);
      return { serverId, serverName, success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to start server ${serverName}:`, error);
      return { serverId, serverName, success: false, error: message };
    }
  }

  private async stopServerSafe(serverId: string, serverName: string): Promise<ServerOperationResult> {
    try {
      await this.serverService.stopServer(serverId);
      return { serverId, serverName, success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to stop server ${serverName}:`, error);
      return { serverId, serverName, success: false, error: message };
    }
  }

  private async startProxySafe(
    networkId: string,
    networkName: string,
    backendServers: ProxyBackendServer[],
    proxyConfig: ProxyNetworkConfig
  ): Promise<ServerOperationResult> {
    try {
      await this.proxyService.startProxy(networkId, networkName, backendServers, proxyConfig);
      return { serverId: `proxy:${networkId}`, serverName: `${networkName} Proxy`, success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to start proxy for network ${networkName}:`, error);
      return { serverId: `proxy:${networkId}`, serverName: `${networkName} Proxy`, success: false, error: message };
    }
  }

  private async stopProxySafe(networkId: string): Promise<ServerOperationResult> {
    try {
      await this.proxyService.stopProxy(networkId);
      return { serverId: `proxy:${networkId}`, serverName: `${networkId} Proxy`, success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to stop proxy for network ${networkId}:`, error);
      return { serverId: `proxy:${networkId}`, serverName: `${networkId} Proxy`, success: false, error: message };
    }
  }

  // ==========================================
  // Status & Metrics
  // ==========================================

  async getNetworkStatus(networkId: string): Promise<NetworkStatus> {
    const network = await this.getNetwork(networkId);
    if (!network) {
      throw new Error(`Network ${networkId} not found`);
    }

    const memberStatuses: {
      serverId: string;
      serverName: string;
      status: string;
      cpuUsage?: number;
      memoryUsage?: number;
      playerCount?: number;
    }[] = [];

    for (const member of network.members) {
      try {
        const status = await this.serverService.getServerStatus(member.serverId);
        let cpuUsage = 0;
        let memoryUsage = 0;

        // Get metrics if server is running
        if (status.status === 'running') {
          try {
            const metrics = await this.serverService.getServerMetrics(member.serverId);
            cpuUsage = metrics.cpuUsage;
            memoryUsage = metrics.memoryUsage;
          } catch (error) {
            logger.warn(`Failed to get metrics for server ${member.serverId}:`, error);
          }
        }

        memberStatuses.push({
          serverId: member.serverId,
          serverName: member.server.name,
          status: status.status,
          cpuUsage,
          memoryUsage,
          playerCount: status.playerCount,
        });
      } catch {
        memberStatuses.push({
          serverId: member.serverId,
          serverName: member.server.name,
          status: 'unknown',
          cpuUsage: 0,
          memoryUsage: 0,
          playerCount: 0,
        });
      }
    }

    if (network.networkType === 'proxy') {
      memberStatuses.push({
        serverId: `proxy:${networkId}`,
        serverName: `${network.name} Proxy`,
        status: this.proxyService.getStatus(networkId),
      });
    }

    // Derive network status
    const runningCount = memberStatuses.filter(s => s.status === 'running').length;
    const stoppedCount = memberStatuses.filter(s => s.status === 'stopped').length;
    const startingCount = memberStatuses.filter(s => s.status === 'starting').length;
    const stoppingCount = memberStatuses.filter(s => s.status === 'stopping').length;
    const total = memberStatuses.length;

    let status: NetworkStatusType;
    if (total === 0) {
      status = 'stopped';
    } else if (runningCount === total) {
      status = 'running';
    } else if (stoppedCount === total) {
      status = 'stopped';
    } else if (startingCount > 0) {
      status = 'starting';
    } else if (stoppingCount > 0) {
      status = 'stopping';
    } else {
      status = 'partial';
    }

    return {
      networkId,
      status,
      totalServers: total,
      runningServers: runningCount,
      stoppedServers: stoppedCount,
      memberStatuses,
    };
  }

  async getNetworkMetrics(networkId: string): Promise<AggregatedMetrics> {
    const network = await this.getNetwork(networkId);
    if (!network) {
      throw new Error(`Network ${networkId} not found`);
    }

    let totalPlayers = 0;
    let totalCpuUsage = 0;
    let totalMemoryUsage = 0;
    let totalMemoryAllocated = 0;
    let tpsSum = 0;
    let tpsCount = 0;

    for (const member of network.members) {
      try {
        const metrics = await this.serverService.getServerMetrics(member.serverId);
        totalCpuUsage += metrics.cpuUsage;
        totalMemoryUsage += metrics.memoryUsage;
        totalMemoryAllocated += metrics.memoryTotal;
        if (metrics.tps > 0) {
          tpsSum += metrics.tps;
          tpsCount++;
        }

        const status = await this.serverService.getServerStatus(member.serverId);
        totalPlayers += status.playerCount;
      } catch (error) {
        logger.warn(`Failed to get metrics for server ${member.serverId}:`, error);
      }
    }

    const serverCount = network.members.length;

    return {
      networkId,
      totalPlayers,
      totalCpuUsage,
      averageCpuUsage: serverCount > 0 ? totalCpuUsage / serverCount : 0,
      totalMemoryUsage,
      totalMemoryAllocated,
      averageTps: tpsCount > 0 ? tpsSum / tpsCount : 0,
      serverCount,
      timestamp: new Date(),
    };
  }

  async getNetworkPlayers(networkId: string): Promise<NetworkPlayerInfo[]> {
    const network = await this.getNetwork(networkId);
    if (!network) {
      throw new Error(`Network ${networkId} not found`);
    }

    const players: NetworkPlayerInfo[] = [];

    for (const member of network.members) {
      const serverPlayers = await this.prisma.player.findMany({
        where: {
          serverId: member.serverId,
          isOnline: true,
        },
        select: {
          uuid: true,
          username: true,
          isOnline: true,
        },
      });

      for (const player of serverPlayers) {
        players.push({
          uuid: player.uuid,
          username: player.username,
          serverId: member.serverId,
          serverName: member.server.name,
          isOnline: player.isOnline,
        });
      }
    }

    return players;
  }

  // ==========================================
  // Network Backups
  // ==========================================

  async createNetworkBackup(networkId: string, description?: string): Promise<{ id: string; name: string }> {
    const network = await this.getNetwork(networkId);
    if (!network) {
      throw new Error(`Network ${networkId} not found`);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `${network.name.toLowerCase().replace(/\s+/g, '-')}-network-${timestamp}`;

    // Create network backup record
    const networkBackup = await this.prisma.networkBackup.create({
      data: {
        networkId,
        name: backupName,
        description,
        status: 'creating',
      },
    });

    // Create backups for each server (async)
    this.createServerBackupsAsync(networkBackup.id, network);

    logger.info(`Started network backup: ${backupName}`);
    return { id: networkBackup.id, name: backupName };
  }

  private async createServerBackupsAsync(
    networkBackupId: string,
    network: NetworkWithMembers
  ): Promise<void> {
    const results: { serverId: string; success: boolean; error?: string }[] = [];

    for (const member of network.members) {
      try {
        const backup = await this.backupService.createBackup(
          member.serverId,
          `Network backup: ${network.name}`
        );

        // Link backup to network backup
        await this.prisma.backup.update({
          where: { id: backup.id },
          data: { networkBackupId },
        });

        results.push({ serverId: member.serverId, success: true });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Failed to backup server ${member.server.name}:`, error);
        results.push({ serverId: member.serverId, success: false, error: message });
      }
    }

    // Update network backup status
    const allSuccess = results.every(r => r.success);
    await this.prisma.networkBackup.update({
      where: { id: networkBackupId },
      data: {
        status: allSuccess ? 'completed' : 'failed',
        completedAt: new Date(),
        error: allSuccess ? null : `${results.filter(r => !r.success).length} server(s) failed to backup`,
      },
    });

    logger.info(`Network backup ${networkBackupId} completed: ${results.filter(r => r.success).length}/${results.length} successful`);
  }

  async getNetworkBackups(networkId: string): Promise<unknown[]> {
    return this.prisma.networkBackup.findMany({
      where: { networkId },
      include: {
        serverBackups: {
          select: {
            id: true,
            serverId: true,
            name: true,
            status: true,
            fileSize: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteNetworkBackup(backupId: string): Promise<void> {
    const backup = await this.prisma.networkBackup.findUnique({
      where: { id: backupId },
      include: { serverBackups: true },
    });

    if (!backup) {
      throw new Error(`Network backup ${backupId} not found`);
    }

    // Delete individual server backups
    for (const serverBackup of backup.serverBackups) {
      try {
        await this.backupService.deleteBackup(serverBackup.id);
      } catch (error) {
        logger.warn(`Failed to delete server backup ${serverBackup.id}:`, error);
      }
    }

    // Delete network backup record
    await this.prisma.networkBackup.delete({
      where: { id: backupId },
    });

    logger.info(`Deleted network backup: ${backupId}`);
  }

  // ==========================================
  // Utility Methods
  // ==========================================

  async getUngroupedServers(): Promise<{ id: string; name: string; status: string; address: string; port: number }[]> {
    // Get all servers that are not members of any network
    const servers = await this.prisma.server.findMany({
      where: {
        networkMemberships: {
          none: {},
        },
      },
      select: {
        id: true,
        name: true,
        status: true,
        address: true,
        port: true,
      },
      orderBy: { name: 'asc' },
    });

    return servers;
  }

  async syncProxyConfigsForServer(serverId: string): Promise<void> {
    const memberships = await this.prisma.serverNetworkMember.findMany({
      where: { serverId },
      select: { networkId: true },
    });

    for (const membership of memberships) {
      await this.syncProxyConfigForNetwork(membership.networkId);
    }
  }

  /**
   * Ensure that all servers in a network share the same version.
   * Throws if a mismatch is detected.
   */
  private async assertUniformVersion(newServerIds: string[], proxyServerId?: string, networkId?: string): Promise<string | null> {
    const ids = new Set<string>(newServerIds);
    if (proxyServerId) ids.add(proxyServerId);

    if (networkId) {
      const network = await this.prisma.serverNetwork.findUnique({
        where: { id: networkId },
        include: { members: true },
      });
      if (network) {
        network.members.forEach(m => ids.add(m.serverId));
        if (network.proxyServerId) ids.add(network.proxyServerId);
      }
    }

    if (ids.size === 0) return null;

    const servers = await this.prisma.server.findMany({
      where: { id: { in: Array.from(ids) } },
      select: { id: true, name: true, version: true },
    });

    if (servers.length === 0) return null;

    const baseVersion = servers[0].version;
    const mismatch = servers.find(s => s.version !== baseVersion);
    if (mismatch) {
      throw new Error(
        `Version mismatch in network members: expected ${baseVersion}, found ${mismatch.version} on server ${mismatch.name}`
      );
    }

    return baseVersion;
  }

  private parseProxyConfig(proxyConfig: string | null | undefined): ProxyNetworkConfig {
    if (!proxyConfig) return {};
    try {
      return JSON.parse(proxyConfig) as ProxyNetworkConfig;
    } catch {
      return {};
    }
  }

  private async loadBackendServers(serverIds: string[]): Promise<ProxyBackendServer[]> {
    if (serverIds.length === 0) return [];

    const servers = await this.prisma.server.findMany({
      where: { id: { in: serverIds } },
      select: {
        id: true,
        name: true,
        address: true,
        port: true,
        serverPath: true,
        version: true,
      },
    });

    return servers.map(server => ({
      id: server.id,
      name: server.name,
      address: server.address,
      port: server.port,
      serverPath: server.serverPath,
      version: server.version,
    }));
  }

  private async ensureBackendServerArgs(backendServers: ProxyBackendServer[]): Promise<void> {
    for (const server of backendServers) {
      const dbServer = await this.prisma.server.findUnique({
        where: { id: server.id },
        select: { serverArgs: true },
      });
      if (!dbServer) continue;

      const currentArgs = (dbServer.serverArgs || '').trim();
      const requiredFlags = ['--accept-early-plugins', '--auth-mode', 'insecure'];
      const hasAllFlags = requiredFlags.every(flag => currentArgs.includes(flag));
      if (hasAllFlags) continue;

      const mergedArgs = [currentArgs, '--accept-early-plugins --auth-mode insecure']
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      await this.prisma.server.update({
        where: { id: server.id },
        data: { serverArgs: mergedArgs },
      });
    }
  }

  private ensureUniformBackendVersion(backendServers: ProxyBackendServer[]): string | undefined {
    if (backendServers.length === 0) return undefined;
    const baseVersion = backendServers[0].version;
    const mismatch = backendServers.find(server => server.version !== baseVersion);
    if (mismatch) {
      throw new Error(
        `Version mismatch in backend servers: expected ${baseVersion}, found ${mismatch.version} on server ${mismatch.name}`
      );
    }
    return baseVersion;
  }

  private async syncProxyConfigForNetwork(networkId: string): Promise<void> {
    const network = await this.prisma.serverNetwork.findUnique({
      where: { id: networkId },
      include: {
        members: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!network || network.networkType !== 'proxy') {
      return;
    }

    const proxyConfig = this.parseProxyConfig(network.proxyConfig);
    const backendMembers = network.members.filter(member => member.role !== 'proxy');
    const backendServers = await this.loadBackendServers(backendMembers.map(member => member.serverId));

    await this.proxyService.syncProxyConfig(network.id, backendServers, proxyConfig);
  }
}
