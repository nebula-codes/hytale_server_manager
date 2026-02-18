import { PrismaClient, ServerNetwork as PrismaNetwork } from '@prisma/client';
import fs from 'fs-extra';
import path from 'path';
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

type VersionAlignmentAction = 'none' | 'update_proxy' | 'align_servers';

export interface NetworkVersionAlignment {
  aligned: boolean;
  updateAvailable: boolean;
  requiresAttention: boolean;
  proxyServerId: string | null;
  proxyVersion: string | null;
  backendVersions: string[];
  highestBackendVersion: string | null;
  canUpdateProxyToSupportServers: boolean;
  recommendedAction: VersionAlignmentAction;
  targetProxyVersion: string | null;
  targetServerVersion: string | null;
  reason: string | null;
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

    // Enforce version alignment only for proxy networks
    if (data.networkType === 'proxy') {
      if (data.serverIds?.length) {
        await this.assertUniformVersion(data.serverIds, data.proxyServerId);
      } else if (data.proxyServerId) {
        await this.assertUniformVersion([data.proxyServerId], data.proxyServerId);
      }
    }

    const normalizedProxyConfig = data.proxyConfig
      ? this.normalizeProxyConfig(data.proxyConfig)
      : undefined;

    const network = await this.prisma.serverNetwork.create({
      data: {
        name: data.name,
        description: data.description,
        networkType: data.networkType || 'logical',
        proxyServerId: data.proxyServerId,
        proxyConfig: normalizedProxyConfig ? JSON.stringify(normalizedProxyConfig) : null,
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
              select: { id: true, name: true, status: true, version: true },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!network) return null;
    return this.withVersionAlignment(network as NetworkWithMembers);
  }

  async getAllNetworks(): Promise<NetworkWithMembers[]> {
    const networks = await this.prisma.serverNetwork.findMany({
      include: {
        members: {
          include: {
            server: {
              select: { id: true, name: true, status: true, version: true },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });

    const enriched = await Promise.all(
      networks.map(network => this.withVersionAlignment(network as NetworkWithMembers))
    );
    return enriched as NetworkWithMembers[];
  }

  async updateNetwork(networkId: string, data: UpdateNetworkDto): Promise<PrismaNetwork> {
    const updateData: Record<string, unknown> = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.proxyServerId !== undefined) {
      const existingNetwork = await this.prisma.serverNetwork.findUnique({
        where: { id: networkId },
        select: { networkType: true },
      });
      if (existingNetwork?.networkType === 'proxy') {
        await this.assertUniformVersion([], data.proxyServerId, networkId);
      }
      updateData.proxyServerId = data.proxyServerId;
    }
    if (data.proxyConfig !== undefined) {
      const normalizedProxyConfig = this.normalizeProxyConfig(data.proxyConfig);
      updateData.proxyConfig = JSON.stringify(normalizedProxyConfig);
    }
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

    const network = await this.prisma.serverNetwork.findUnique({
      where: { id: networkId },
      select: { networkType: true },
    });
    if (!network) {
      throw new Error(`Network ${networkId} not found`);
    }

    // Enforce version consistency only for proxy networks
    if (network.networkType === 'proxy') {
      await this.assertUniformVersion([serverId], undefined, networkId);
    }

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
      const backendMembers = network.members.filter(m => m.role !== 'proxy');
      const backendServers = await this.loadBackendServers(backendMembers.map(member => member.serverId));
      this.ensureUniformBackendVersion(backendServers);
      const backendNames = new Set(backendServers.map(server => server.name));
      const parsedProxyConfig = this.parseProxyConfig(network.proxyConfig);
      const validatedProxyConfig = this.normalizeProxyConfig(parsedProxyConfig, backendNames);
      const effectiveProxyConfig = await this.proxyService.syncProxyConfig(network.id, backendServers, validatedProxyConfig);
      await this.persistProxyConfig(network.id, effectiveProxyConfig);
      const startOrder = effectiveProxyConfig.startOrder || 'backends_first';

      await this.ensureBackendServerArgs(backendServers);
      if (effectiveProxyConfig.autoInstallBridge !== false) {
        await this.bootstrapBackendBridgeConfigs(backendServers);
        await this.proxyService.syncBridgeForBackends(backendServers, effectiveProxyConfig.proxySecret);
        await this.verifyBackendSecretConfiguration(backendServers, effectiveProxyConfig.proxySecret);
      }

      if (startOrder === 'backends_first') {
        // Start backends first
        for (const member of backendMembers) {
          results.push(await this.startServerSafe(member.serverId, member.server.name));
        }
        // Then start proxy process
        results.push(await this.startProxySafe(network.id, network.name, backendServers, effectiveProxyConfig));
      } else {
        // Start proxy first
        results.push(await this.startProxySafe(network.id, network.name, backendServers, effectiveProxyConfig));
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
      version?: string;
      bridgeStatus?: 'ok' | 'pending_restart';
      cpuUsage?: number;
      memoryUsage?: number;
      playerCount?: number;
    }[] = [];
    const proxyConfig = network.networkType === 'proxy' ? this.parseProxyConfig(network.proxyConfig) : {};
    const expectedProxySecret = proxyConfig.proxySecret?.trim();
    const memberRuntimeConfigs = network.networkType === 'proxy'
      ? await this.prisma.server.findMany({
          where: { id: { in: network.members.map(member => member.serverId) } },
          select: {
            id: true,
            serverPath: true,
            serverArgs: true,
          },
        })
      : [];
    const runtimeConfigByServerId = new Map(
      memberRuntimeConfigs.map((entry) => [entry.id, entry])
    );

    for (const member of network.members) {
      try {
        const status = await this.serverService.getServerStatus(member.serverId);
        let cpuUsage = 0;
        let memoryUsage = 0;
        const bridgeStatus = network.networkType === 'proxy' && member.role !== 'proxy'
          ? await this.evaluateBackendBridgeStatus(
              runtimeConfigByServerId.get(member.serverId),
              status.status,
              expectedProxySecret
            )
          : undefined;

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
          version: member.server.version,
          bridgeStatus,
          cpuUsage,
          memoryUsage,
          playerCount: status.playerCount,
        });
      } catch {
        memberStatuses.push({
          serverId: member.serverId,
          serverName: member.server.name,
          status: 'unknown',
          version: member.server.version,
          bridgeStatus: network.networkType === 'proxy' && member.role !== 'proxy' ? 'pending_restart' : undefined,
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
        version: this.proxyService.getRunningProxyVersion(networkId) || undefined,
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

  private hasInsecureAuthMode(serverArgs: string | null | undefined): boolean {
    const tokens = (serverArgs || '').split(/\s+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] !== '--auth-mode') {
        continue;
      }
      return tokens[i + 1] === 'insecure';
    }
    return false;
  }

  private async evaluateBackendBridgeStatus(
    runtimeConfig: { id: string; serverPath: string; serverArgs: string | null } | undefined,
    runtimeStatus: string,
    expectedProxySecret?: string
  ): Promise<'ok' | 'pending_restart'> {
    if (!runtimeConfig) {
      return 'pending_restart';
    }

    const modsPath = await this.resolveBackendModsPath(runtimeConfig.serverPath);
    const bridgeConfigPath = path.join(modsPath, 'OrbisProxy_OrbisProxy', 'config.json');
    const hasAuthArg = this.hasInsecureAuthMode(runtimeConfig.serverArgs);

    let hasBackendMod = false;
    try {
      const mods = await fs.readdir(modsPath);
      hasBackendMod = mods.some((fileName) =>
        /\.jar$/i.test(fileName) &&
        (/orbisproxy/i.test(fileName) || /^bridge-/i.test(fileName))
      );
    } catch {
      hasBackendMod = false;
    }

    let hasMatchingSecret = false;
    if (await fs.pathExists(bridgeConfigPath)) {
      try {
        const bridgeConfig = await fs.readJson(bridgeConfigPath) as { SecretKey?: unknown; Secret?: unknown };
        const secretKeyValue = typeof bridgeConfig?.SecretKey === 'string' ? bridgeConfig.SecretKey.trim() : '';
        const secretValue = typeof bridgeConfig?.Secret === 'string' ? bridgeConfig.Secret.trim() : '';
        const secret = secretKeyValue || secretValue;
        hasMatchingSecret = expectedProxySecret ? secret === expectedProxySecret : secret.length > 0;
      } catch {
        hasMatchingSecret = false;
      }
    }

    const ready = hasAuthArg && hasBackendMod && hasMatchingSecret;
    if (ready) {
      return 'ok';
    }

    return runtimeStatus === 'running' ? 'pending_restart' : 'pending_restart';
  }

  private async resolveBackendModsPath(serverPath: string): Promise<string> {
    const root = path.resolve(serverPath);
    const nestedServerRoot = path.join(root, 'Server');
    if (!(await fs.pathExists(nestedServerRoot))) {
      throw new Error(
        `Expected backend runtime folder "${nestedServerRoot}" was not found. ` +
        'Backends must use servers/<name>/Server layout.'
      );
    }
    return path.join(nestedServerRoot, 'mods');
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
      return this.normalizeProxyConfig(JSON.parse(proxyConfig) as ProxyNetworkConfig);
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
      const tokens = currentArgs.length > 0 ? currentArgs.split(/\s+/).filter(Boolean) : [];
      const normalizedTokens: string[] = [];

      // Remove any existing --auth-mode value so we can enforce exactly one value.
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token === '--auth-mode') {
          i += 1; // Skip existing value token as well
          continue;
        }
        normalizedTokens.push(token);
      }

      normalizedTokens.push('--auth-mode', 'insecure');
      const mergedArgs = normalizedTokens.join(' ').replace(/\s+/g, ' ').trim();

      if (mergedArgs === currentArgs) {
        continue;
      }

      await this.prisma.server.update({
        where: { id: server.id },
        data: { serverArgs: mergedArgs },
      });
    }
  }

  private async bootstrapBackendBridgeConfigs(backendServers: ProxyBackendServer[]): Promise<void> {
    for (const server of backendServers) {
      const modsPath = await this.resolveBackendModsPath(server.serverPath);
      const bridgeConfigPath = path.join(modsPath, 'OrbisProxy_OrbisProxy', 'config.json');
      if (await fs.pathExists(bridgeConfigPath)) {
        continue;
      }

      const dbServer = await this.prisma.server.findUnique({
        where: { id: server.id },
        select: { status: true, name: true },
      });

      if (!dbServer) {
        continue;
      }

      if (dbServer.status !== 'stopped') {
        logger.warn(
          `[NetworkService] Bridge bootstrap skipped for backend ${dbServer.name}: server is ${dbServer.status} and ${bridgeConfigPath} does not exist yet.`
        );
        continue;
      }

      logger.info(
        `[NetworkService] Bootstrapping backend mod files for ${dbServer.name} (start once / stop once).`
      );

      let started = false;
      try {
        await this.serverService.startServer(server.id);
        started = true;
        await this.waitForFile(bridgeConfigPath, 15000, 500);
      } catch (error) {
        logger.warn(
          `[NetworkService] Backend bootstrap failed for ${dbServer.name}; continuing with managed bridge config write.`,
          error
        );
      } finally {
        if (started) {
          try {
            await this.serverService.stopServer(server.id);
          } catch (stopError) {
            logger.warn(
              `[NetworkService] Failed to stop backend ${dbServer.name} after bridge bootstrap.`,
              stopError
            );
          }
        }
      }
    }
  }

  private async waitForFile(filePath: string, timeoutMs: number, intervalMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await fs.pathExists(filePath)) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    return false;
  }

  private async verifyBackendSecretConfiguration(
    backendServers: ProxyBackendServer[],
    expectedSecret: string
  ): Promise<void> {
    for (const server of backendServers) {
      const modsPath = await this.resolveBackendModsPath(server.serverPath);
      const bridgeConfigPath = path.join(modsPath, 'OrbisProxy_OrbisProxy', 'config.json');
      if (!(await fs.pathExists(bridgeConfigPath))) {
        throw new Error(`Backend ${server.name} is missing OrbisProxy config at ${bridgeConfigPath}`);
      }

      let bridgeConfig: { SecretKey?: unknown; Secret?: unknown };
      try {
        bridgeConfig = await fs.readJson(bridgeConfigPath) as { SecretKey?: unknown; Secret?: unknown };
      } catch {
        throw new Error(`Backend ${server.name} has an invalid OrbisProxy config file: ${bridgeConfigPath}`);
      }

      const secretKeyValue = typeof bridgeConfig.SecretKey === 'string' ? bridgeConfig.SecretKey.trim() : '';
      const secretValue = typeof bridgeConfig.Secret === 'string' ? bridgeConfig.Secret.trim() : '';
      const actualSecret = secretKeyValue || secretValue;
      if (actualSecret !== expectedSecret) {
        throw new Error(`Backend ${server.name} Secret mismatch in ${bridgeConfigPath}`);
      }
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
    const backendNames = new Set(backendServers.map(server => server.name));
    const validatedProxyConfig = this.normalizeProxyConfig(proxyConfig, backendNames);
    await this.reconcileProxyServerVersion(network.id, network.proxyServerId, backendServers);

    const effectiveConfig = await this.proxyService.syncProxyConfig(network.id, backendServers, validatedProxyConfig);
    await this.persistProxyConfig(network.id, effectiveConfig);

    if (effectiveConfig.autoInstallBridge !== false) {
      await this.proxyService.syncBridgeForBackends(backendServers, effectiveConfig.proxySecret);
      await this.verifyBackendSecretConfiguration(backendServers, effectiveConfig.proxySecret);
    }

    try {
      await this.proxyService.restartIfProxyVersionChanged(
        network.id,
        network.name,
        backendServers,
        effectiveConfig
      );
    } catch (error) {
      logger.warn(`[NetworkService] Failed to restart proxy after version change for network ${network.id}:`, error);
    }
  }

  private async persistProxyConfig(networkId: string, config: ProxyNetworkConfig): Promise<void> {
    await this.prisma.serverNetwork.update({
      where: { id: networkId },
      data: { proxyConfig: JSON.stringify(config) },
    });
  }

  private async withVersionAlignment(network: NetworkWithMembers): Promise<NetworkWithMembers & { versionAlignment: NetworkVersionAlignment | null }> {
    if (network.networkType !== 'proxy') {
      return { ...network, versionAlignment: null };
    }

    const backendMembers = network.members.filter(member => member.role !== 'proxy');
    const backendVersions = Array.from(new Set(
      backendMembers
        .map(member => member.server.version)
        .filter((version): version is string => Boolean(version))
    ));

    const highestBackendVersion = backendVersions.reduce<string | null>((current, version) => {
      if (!current) return version;
      return this.compareVersions(version, current) > 0 ? version : current;
    }, null);

    const proxyServerId = network.proxyServerId || null;
    const proxyVersion = proxyServerId
      ? (
        await this.prisma.server.findUnique({
          where: { id: proxyServerId },
          select: { version: true },
        })
      )?.version || null
      : null;

    const hasMismatch = Boolean(
      proxyVersion &&
      backendVersions.length > 0 &&
      backendVersions.some(version => version !== proxyVersion)
    );

    let canUpdateProxyToSupportServers = false;
    if (hasMismatch && highestBackendVersion && highestBackendVersion !== proxyVersion) {
      canUpdateProxyToSupportServers = await this.proxyService.canSupportVersion(highestBackendVersion);
    }

    let recommendedAction: VersionAlignmentAction = 'none';
    let targetProxyVersion: string | null = null;
    let targetServerVersion: string | null = null;
    let reason: string | null = null;

    if (hasMismatch) {
      if (canUpdateProxyToSupportServers && highestBackendVersion) {
        recommendedAction = 'update_proxy';
        targetProxyVersion = highestBackendVersion;
        reason = `Proxy version ${proxyVersion} does not match backend version ${highestBackendVersion}. A compatible proxy release exists.`;
      } else {
        recommendedAction = 'align_servers';
        targetServerVersion = proxyVersion;
        reason = `Proxy version ${proxyVersion} does not match backend versions (${backendVersions.join(', ')}). Use proxy-compatible server versions.`;
      }
    }

    return {
      ...network,
      versionAlignment: {
        aligned: !hasMismatch,
        updateAvailable: hasMismatch,
        requiresAttention: hasMismatch,
        proxyServerId,
        proxyVersion,
        backendVersions,
        highestBackendVersion,
        canUpdateProxyToSupportServers,
        recommendedAction,
        targetProxyVersion,
        targetServerVersion,
        reason,
      },
    };
  }

  private compareVersions(a: string, b: string): number {
    const normalize = (v: string) => v.replace(/^v/i, '');
    const toParts = (v: string) => normalize(v)
      .split('.')
      .map(part => {
        const n = Number.parseInt(part, 10);
        return Number.isNaN(n) ? 0 : n;
      });

    const aParts = toParts(a);
    const bParts = toParts(b);
    const length = Math.max(aParts.length, bParts.length);

    for (let i = 0; i < length; i++) {
      const av = aParts[i] ?? 0;
      const bv = bParts[i] ?? 0;
      if (av > bv) return 1;
      if (av < bv) return -1;
    }
    return 0;
  }

  private async reconcileProxyServerVersion(
    networkId: string,
    proxyServerId: string | null,
    backendServers: ProxyBackendServer[]
  ): Promise<void> {
    if (!proxyServerId || backendServers.length === 0) {
      return;
    }

    const highestBackendVersion = backendServers
      .map(server => server.version)
      .filter((version): version is string => Boolean(version))
      .reduce<string | null>((current, version) => {
        if (!current) return version;
        return this.compareVersions(version, current) > 0 ? version : current;
      }, null);

    if (!highestBackendVersion) {
      return;
    }

    const proxyServer = await this.prisma.server.findUnique({
      where: { id: proxyServerId },
      select: { id: true, version: true, name: true },
    });

    if (!proxyServer || proxyServer.version === highestBackendVersion) {
      return;
    }

    const canUpdateProxy = await this.proxyService.canSupportVersion(highestBackendVersion);
    if (!canUpdateProxy) {
      logger.warn(
        `[NetworkService] Proxy ${proxyServer.name} (${networkId}) cannot be aligned to backend version ${highestBackendVersion} (release not found).`
      );
      return;
    }

    await this.prisma.server.update({
      where: { id: proxyServer.id },
      data: { version: highestBackendVersion },
    });

    logger.info(
      `[NetworkService] Aligned proxy server ${proxyServer.name} version from ${proxyServer.version} to ${highestBackendVersion} for network ${networkId}.`
    );
  }

  private normalizeProxyConfig(
    raw: ProxyNetworkConfig | undefined,
    backendNames?: Set<string>
  ): ProxyNetworkConfig {
    if (!raw) return {};

    const normalized: ProxyNetworkConfig = {};

    const trimOptionalString = (value: unknown, field: string): string | undefined => {
      if (value === undefined || value === null) return undefined;
      if (typeof value !== 'string') {
        throw new Error(`Invalid proxy config: ${field} must be a string`);
      }
      const trimmed = value.trim();
      if (trimmed === 'undefined' || trimmed === 'null') {
        return undefined;
      }
      return trimmed.length > 0 ? trimmed : undefined;
    };

    const optionalPort = (value: unknown, field: string): number | undefined => {
      if (value === undefined || value === null || value === '') return undefined;
      const parsed = typeof value === 'number' ? value : Number(value);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error(`Invalid proxy config: ${field} must be an integer between 1 and 65535`);
      }
      return parsed;
    };

    if (raw.startOrder !== undefined) {
      if (raw.startOrder !== 'backends_first' && raw.startOrder !== 'proxy_first') {
        throw new Error('Invalid proxy config: startOrder must be "backends_first" or "proxy_first"');
      }
      normalized.startOrder = raw.startOrder;
    }

    if (raw.version !== undefined) {
      if (!Number.isInteger(raw.version) || raw.version < 1) {
        throw new Error('Invalid proxy config: version must be a positive integer');
      }
      normalized.version = raw.version;
    }

    normalized.bindAddress = trimOptionalString(raw.bindAddress, 'bindAddress');
    normalized.bindPort = optionalPort(raw.bindPort, 'bindPort');
    normalized.publicAddress = trimOptionalString(raw.publicAddress, 'publicAddress');
    normalized.publicPort = optionalPort(raw.publicPort, 'publicPort');
    normalized.certificatePath = trimOptionalString(raw.certificatePath, 'certificatePath');
    normalized.privateKeyPath = trimOptionalString(raw.privateKeyPath, 'privateKeyPath');
    normalized.proxySecret = trimOptionalString(raw.proxySecret, 'proxySecret');

    if (raw.debugMode !== undefined) {
      if (typeof raw.debugMode !== 'boolean') {
        throw new Error('Invalid proxy config: debugMode must be a boolean');
      }
      normalized.debugMode = raw.debugMode;
    }

    if (raw.autoInstallBridge !== undefined) {
      if (typeof raw.autoInstallBridge !== 'boolean') {
        throw new Error('Invalid proxy config: autoInstallBridge must be a boolean');
      }
      normalized.autoInstallBridge = raw.autoInstallBridge;
    }

    normalized.defaultServer = trimOptionalString(raw.defaultServer, 'defaultServer');
    normalized.fallbackServer = trimOptionalString(raw.fallbackServer, 'fallbackServer');

    if (raw.poolEnabled !== undefined) {
      if (typeof raw.poolEnabled !== 'boolean') {
        throw new Error('Invalid proxy config: poolEnabled must be a boolean');
      }
      normalized.poolEnabled = raw.poolEnabled;
    }

    if (raw.pool !== undefined) {
      if (!raw.pool || typeof raw.pool !== 'object' || Array.isArray(raw.pool)) {
        throw new Error('Invalid proxy config: pool must be an object');
      }
      const normalizedPool: Record<string, { strategy?: 'round-robin' | 'random' | 'least-connections'; servers: string[] }> = {};
      for (const [poolName, poolConfig] of Object.entries(raw.pool)) {
        const name = poolName.trim();
        if (!name) {
          throw new Error('Invalid proxy config: pool names must be non-empty');
        }
        if (!poolConfig || typeof poolConfig !== 'object' || Array.isArray(poolConfig)) {
          throw new Error(`Invalid proxy config: pool.${name} must be an object`);
        }
        const strategy = (poolConfig as any).strategy;
        if (strategy !== undefined && !['round-robin', 'random', 'least-connections'].includes(strategy)) {
          throw new Error(`Invalid proxy config: pool.${name}.strategy is invalid`);
        }
        const servers = (poolConfig as any).servers;
        if (!Array.isArray(servers) || servers.some(value => typeof value !== 'string' || value.trim().length === 0)) {
          throw new Error(`Invalid proxy config: pool.${name}.servers must be an array of non-empty strings`);
        }
        normalizedPool[name] = {
          strategy: strategy as 'round-robin' | 'random' | 'least-connections' | undefined,
          servers: servers.map((serverName: string) => serverName.trim()),
        };
      }
      normalized.pool = normalizedPool;
    }

    if (raw.routes !== undefined) {
      if (!Array.isArray(raw.routes)) {
        throw new Error('Invalid proxy config: routes must be an array');
      }
      normalized.routes = raw.routes.map((route, index) => {
        if (!route || typeof route !== 'object') {
          throw new Error(`Invalid proxy config: routes[${index}] must be an object`);
        }
        const hostname = trimOptionalString((route as any).hostname, `routes[${index}].hostname`);
        const target = trimOptionalString((route as any).target, `routes[${index}].target`);
        if (!hostname || !target) {
          throw new Error(`Invalid proxy config: routes[${index}] requires hostname and target`);
        }
        return { hostname, target };
      });
    }

    if (backendNames && backendNames.size > 0) {
      if (normalized.defaultServer && !backendNames.has(normalized.defaultServer)) {
        throw new Error(`Invalid proxy config: defaultServer "${normalized.defaultServer}" is not a backend member`);
      }
      if (normalized.fallbackServer && !backendNames.has(normalized.fallbackServer)) {
        throw new Error(`Invalid proxy config: fallbackServer "${normalized.fallbackServer}" is not a backend member`);
      }
      if (normalized.pool) {
        for (const [poolName, poolConfig] of Object.entries(normalized.pool)) {
          for (const serverName of poolConfig.servers) {
            if (!backendNames.has(serverName)) {
              throw new Error(`Invalid proxy config: pool "${poolName}" references unknown backend "${serverName}"`);
            }
          }
        }
      }
      if (normalized.routes) {
        const poolNames = new Set(Object.keys(normalized.pool || {}));
        for (const route of normalized.routes) {
          if (!backendNames.has(route.target) && !poolNames.has(route.target)) {
            throw new Error(`Invalid proxy config: route target "${route.target}" is neither a backend server nor a pool`);
          }
        }
      }
    }

    return normalized;
  }
}
