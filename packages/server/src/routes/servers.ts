import { Router, Request, Response } from 'express';
import multer from 'multer';
import { ServerService } from '../services/ServerService';
import { ConsoleService } from '../services/ConsoleService';
import { ModService } from '../services/ModService';
import { PlayerService } from '../services/PlayerService';
import { BackupService } from '../services/BackupService';
import { SchedulerService } from '../services/SchedulerService';
import { FileService } from '../services/FileService';
import { MetricsService } from '../services/MetricsService';
import { WorldsService } from '../services/WorldsService';
import { AlertsService } from '../services/AlertsService';
import { AutomationRulesService } from '../services/AutomationRulesService';
import { ModProviderService } from '../services/ModProviderService';
import { NetworkService } from '../services/NetworkService';
import { ProxyService } from '../services/ProxyService';
import { requirePermission, AuthenticatedRequest } from '../middleware/auth';
import { PERMISSIONS } from '../permissions/definitions';
import { ActivityLogService } from '../services/ActivityLogService';
import { ACTIVITY_ACTIONS, RESOURCE_TYPES } from '../constants/ActivityLogActions';
import { getActivityContext } from '../middleware/activityLogger';
import logger from '../utils/logger';

export function createServerRoutes(
  serverService: ServerService,
  consoleService: ConsoleService,
  modService: ModService,
  playerService: PlayerService,
  backupService: BackupService,
  schedulerService: SchedulerService,
  fileService: FileService,
  metricsService: MetricsService,
  worldsService: WorldsService,
  alertsService: AlertsService,
  automationRulesService: AutomationRulesService,
  modProviderService: ModProviderService | undefined,  // Optional for backward compatibility during transition
  networkService: NetworkService,
  proxyService: ProxyService
): Router {
  const router = Router();

  // ============================================
  // Server CRUD
  // ============================================

  /**
   * GET /api/servers
   * Get all servers
   */
  router.get('/', requirePermission(PERMISSIONS.SERVERS_VIEW), async (_req: Request, res: Response) => {
    try {
      const servers = await serverService.getAllServers();
      res.json(servers);
    } catch (error) {
      logger.error('Error getting servers:', error);
      res.status(500).json({ error: 'Failed to get servers' });
    }
  });

  /**
   * GET /api/servers/console/targets
   * List console targets (servers + proxy networks)
   */
  router.get('/console/targets', requirePermission(PERMISSIONS.SERVERS_CONSOLE), async (_req: Request, res: Response) => {
    try {
      const servers = await serverService.getAllServers();

      const proxyNetworks = await networkService.getAllNetworks();
      const proxyTargets = proxyNetworks
        .filter(n => n.networkType === 'proxy')
        .map(n => ({
          id: `proxy:${n.id}`,
          name: `${n.name} Proxy`,
          status: proxyService.getStatus(n.id),
          type: 'proxy' as const,
        }));

      const serverTargets = servers.map(s => ({
        id: s.id,
        name: s.name,
        status: s.status,
        type: 'server' as const,
      }));

      res.json([...serverTargets, ...proxyTargets]);
    } catch (error) {
      logger.error('Error getting console targets:', error);
      res.status(500).json({ error: 'Failed to get console targets' });
    }
  });

  /**
   * GET /api/servers/:id
   * Get a single server
   */
  router.get('/:id', requirePermission(PERMISSIONS.SERVERS_VIEW), async (req: Request, res: Response) => {
    try {
      const server = await serverService.getServer(req.params.id);
      if (!server) {
        return res.status(404).json({ error: 'Server not found' });
      }
      return res.json(server);
    } catch (error) {
      logger.error('Error getting server:', error);
      return res.status(500).json({ error: 'Failed to get server' });
    }
  });

  /**
   * POST /api/servers
   * Create a new server
   */
  router.post('/', requirePermission(PERMISSIONS.SERVERS_CREATE), async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const {
        name,
        address,
        port,
        version,
        maxPlayers,
        gameMode,
        adapterType,
        adapterConfig,
        serverPath,
        backupPath,
        backupType,
        jvmArgs,
      } = req.body;

      if (!name || !address || !port || !version || !maxPlayers || !gameMode || !serverPath) {
        return res.status(400).json({ error: 'Missing required fields (name, address, port, version, maxPlayers, gameMode, serverPath)' });
      }

      // Validate backupType if provided
      if (backupType && !['local', 'ftp'].includes(backupType)) {
        return res.status(400).json({ error: 'Invalid backupType. Must be "local" or "ftp"' });
      }

      const server = await serverService.createServer({
        name,
        address,
        port: parseInt(port),
        version,
        maxPlayers: parseInt(maxPlayers),
        gameMode,
        adapterType,
        adapterConfig,
        serverPath,
        backupPath,
        backupType,
        jvmArgs,
      });

      // Log activity (user is guaranteed by requirePermission middleware)
      const activityLogService: ActivityLogService = req.app.get('activityLogService');
      const context = getActivityContext(req);
      const user = authReq.user!;
      activityLogService.logAsync({
        userId: user.id,
        username: user.username,
        userRole: user.role,
        action: ACTIVITY_ACTIONS.SERVER_CREATE,
        resourceType: RESOURCE_TYPES.SERVER,
        resourceId: server.id,
        resourceName: server.name,
        status: 'success',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return res.status(201).json(server);
    } catch (error: any) {
      logger.error('Error creating server:', error);
      // Check for duplicate name error
      if (error.message?.includes('already exists')) {
        return res.status(409).json({ error: error.message });
      }
      return res.status(500).json({ error: 'Failed to create server' });
    }
  });

  /**
   * PATCH /api/servers/:id
   * Update a server
   */
  router.patch('/:id', requirePermission(PERMISSIONS.SERVERS_UPDATE), async (req: Request, res: Response) => {
    try {
      const server = await serverService.updateServer(req.params.id, req.body);
      res.json(server);
    } catch (error) {
      logger.error('Error updating server:', error);
      res.status(500).json({ error: 'Failed to update server' });
    }
  });

  /**
   * DELETE /api/servers/:id
   * Delete a server
   */
  router.delete('/:id', requirePermission(PERMISSIONS.SERVERS_DELETE), async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const server = await serverService.getServer(req.params.id);
      const serverName = server?.name;
      await serverService.deleteServer(req.params.id);

      // Log activity (user is guaranteed by requirePermission middleware)
      const activityLogService: ActivityLogService = req.app.get('activityLogService');
      const context = getActivityContext(req);
      const user = authReq.user!;
      activityLogService.logAsync({
        userId: user.id,
        username: user.username,
        userRole: user.role,
        action: ACTIVITY_ACTIONS.SERVER_DELETE,
        resourceType: RESOURCE_TYPES.SERVER,
        resourceId: req.params.id,
        resourceName: serverName,
        status: 'success',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      res.status(204).send();
    } catch (error) {
      logger.error('Error deleting server:', error);
      res.status(500).json({ error: 'Failed to delete server' });
    }
  });

  // ============================================
  // Server Lifecycle
  // ============================================

  /**
   * POST /api/servers/:id/start
   * Start a server
   */
  router.post('/:id/start', requirePermission(PERMISSIONS.SERVERS_START), async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const server = await serverService.getServer(req.params.id);
      await serverService.startServer(req.params.id);

      // Log activity (user is guaranteed by requirePermission middleware)
      const activityLogService: ActivityLogService = req.app.get('activityLogService');
      const context = getActivityContext(req);
      const user = authReq.user!;
      activityLogService.logAsync({
        userId: user.id,
        username: user.username,
        userRole: user.role,
        action: ACTIVITY_ACTIONS.SERVER_START,
        resourceType: RESOURCE_TYPES.SERVER,
        resourceId: req.params.id,
        resourceName: server?.name,
        status: 'success',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      res.json({ message: 'Server starting' });
    } catch (error: any) {
      // Log failed activity
      const activityLogService: ActivityLogService = req.app.get('activityLogService');
      const context = getActivityContext(req);
      const user = authReq.user!;
      activityLogService.logAsync({
        userId: user.id,
        username: user.username,
        userRole: user.role,
        action: ACTIVITY_ACTIONS.SERVER_START,
        resourceType: RESOURCE_TYPES.SERVER,
        resourceId: req.params.id,
        status: 'failed',
        errorMessage: error.message,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      logger.error('Error starting server:', error);
      res.status(500).json({ error: 'Failed to start server' });
    }
  });

  /**
   * POST /api/servers/:id/stop
   * Stop a server
   */
  router.post('/:id/stop', requirePermission(PERMISSIONS.SERVERS_STOP), async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const server = await serverService.getServer(req.params.id);
      await serverService.stopServer(req.params.id);

      // Log activity (user is guaranteed by requirePermission middleware)
      const activityLogService: ActivityLogService = req.app.get('activityLogService');
      const context = getActivityContext(req);
      const user = authReq.user!;
      activityLogService.logAsync({
        userId: user.id,
        username: user.username,
        userRole: user.role,
        action: ACTIVITY_ACTIONS.SERVER_STOP,
        resourceType: RESOURCE_TYPES.SERVER,
        resourceId: req.params.id,
        resourceName: server?.name,
        status: 'success',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      res.json({ message: 'Server stopping' });
    } catch (error: any) {
      // Log failed activity
      const activityLogService: ActivityLogService = req.app.get('activityLogService');
      const context = getActivityContext(req);
      const user = authReq.user!;
      activityLogService.logAsync({
        userId: user.id,
        username: user.username,
        userRole: user.role,
        action: ACTIVITY_ACTIONS.SERVER_STOP,
        resourceType: RESOURCE_TYPES.SERVER,
        resourceId: req.params.id,
        status: 'failed',
        errorMessage: error.message,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      logger.error('Error stopping server:', error);
      res.status(500).json({ error: 'Failed to stop server' });
    }
  });

  /**
   * POST /api/servers/:id/restart
   * Restart a server
   */
  router.post('/:id/restart', requirePermission(PERMISSIONS.SERVERS_RESTART), async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const server = await serverService.getServer(req.params.id);
      await serverService.restartServer(req.params.id);

      // Log activity (user is guaranteed by requirePermission middleware)
      const activityLogService: ActivityLogService = req.app.get('activityLogService');
      const context = getActivityContext(req);
      const user = authReq.user!;
      activityLogService.logAsync({
        userId: user.id,
        username: user.username,
        userRole: user.role,
        action: ACTIVITY_ACTIONS.SERVER_RESTART,
        resourceType: RESOURCE_TYPES.SERVER,
        resourceId: req.params.id,
        resourceName: server?.name,
        status: 'success',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      res.json({ message: 'Server restarting' });
    } catch (error: any) {
      logger.error('Error restarting server:', error);
      res.status(500).json({ error: 'Failed to restart server' });
    }
  });

  /**
   * POST /api/servers/:id/kill
   * Force kill a server
   */
  router.post('/:id/kill', requirePermission(PERMISSIONS.SERVERS_KILL), async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const server = await serverService.getServer(req.params.id);
      await serverService.killServer(req.params.id);

      // Log activity (user is guaranteed by requirePermission middleware)
      const activityLogService: ActivityLogService = req.app.get('activityLogService');
      const context = getActivityContext(req);
      const user = authReq.user!;
      activityLogService.logAsync({
        userId: user.id,
        username: user.username,
        userRole: user.role,
        action: ACTIVITY_ACTIONS.SERVER_KILL,
        resourceType: RESOURCE_TYPES.SERVER,
        resourceId: req.params.id,
        resourceName: server?.name,
        status: 'success',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      res.json({ message: 'Server killed' });
    } catch (error: any) {
      logger.error('Error killing server:', error);
      res.status(500).json({ error: 'Failed to kill server' });
    }
  });

  // ============================================
  // Server Status & Metrics
  // ============================================

  /**
   * GET /api/servers/:id/status
   * Get server status
   */
  router.get('/:id/status', async (req: Request, res: Response) => {
    try {
      const status = await serverService.getServerStatus(req.params.id);
      res.json(status);
    } catch (error) {
      logger.error('Error getting server status:', error);
      res.status(500).json({ error: 'Failed to get server status' });
    }
  });

  /**
   * GET /api/servers/:id/metrics
   * Get server metrics
   */
  router.get('/:id/metrics', async (req: Request, res: Response) => {
    try {
      const metrics = await serverService.getServerMetrics(req.params.id);
      res.json(metrics);
    } catch (error) {
      logger.error('Error getting server metrics:', error);
      res.status(500).json({ error: 'Failed to get server metrics' });
    }
  });

  /**
   * GET /api/servers/:id/config
   * Get server configuration
   */
  router.get('/:id/config', async (req: Request, res: Response) => {
    try {
      const config = await serverService.getServerConfig(req.params.id);
      res.json(config);
    } catch (error) {
      logger.error('Error getting server config:', error);
      res.status(500).json({ error: 'Failed to get server config' });
    }
  });

  // ============================================
  // Console
  // ============================================

  /**
   * POST /api/servers/:id/console/command
   * Send a command to the server console
   */
  router.post('/:id/console/command', requirePermission(PERMISSIONS.SERVERS_CONSOLE), async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const { command } = req.body;
      if (!command) {
        return res.status(400).json({ error: 'Command is required' });
      }

      const server = await serverService.getServer(req.params.id);
      const adapter = await serverService.getAdapterForServer(req.params.id);
      const response = await consoleService.sendCommand(adapter, command);

      // Log activity (user is guaranteed by requirePermission middleware)
      const activityLogService: ActivityLogService = req.app.get('activityLogService');
      const context = getActivityContext(req);
      const user = authReq.user!;
      activityLogService.logAsync({
        userId: user.id,
        username: user.username,
        userRole: user.role,
        action: ACTIVITY_ACTIONS.SERVER_COMMAND,
        resourceType: RESOURCE_TYPES.SERVER,
        resourceId: req.params.id,
        resourceName: server?.name,
        status: 'success',
        details: { command },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return res.json(response);
    } catch (error) {
      logger.error('Error sending command:', error);
      return res.status(500).json({ error: 'Failed to send command' });
    }
  });

  /**
   * GET /api/servers/:id/console/logs
   * Get historical console logs
   */
  router.get('/:id/console/logs', requirePermission(PERMISSIONS.SERVERS_CONSOLE), async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      const level = req.query.level as string | undefined;

      const logs = await consoleService.getLogs(req.params.id, limit, offset, level);
      res.json(logs);
    } catch (error) {
      logger.error('Error getting logs:', error);
      res.status(500).json({ error: 'Failed to get logs' });
    }
  });

  // ============================================
  // Mods
  // ============================================

  /**
   * GET /api/servers/:id/mods
   * Get all mods for a server
   */
  router.get('/:id/mods', requirePermission(PERMISSIONS.MODS_VIEW), async (req: Request, res: Response) => {
    try {
      const mods = await modService.getServerMods(req.params.id);
      res.json(mods);
    } catch (error) {
      logger.error('Error getting mods:', error);
      res.status(500).json({ error: 'Failed to get mods' });
    }
  });

  /**
   * POST /api/servers/:id/mods
   * Install a mod/modpack - downloads from provider API and extracts to mods folder
   *
   * Request body:
   * {
   *   metadata: {
   *     providerId?: string,  // Optional: 'modtale' or 'curseforge' (defaults to 'modtale')
   *     projectId: string,
   *     versionId: string,
   *     versionName?: string,
   *     projectTitle: string,
   *     projectIconUrl?: string,
   *     classification: string,
   *     fileName?: string,    // Original file name from provider (used for saving the file)
   *   }
   * }
   */
  router.post('/:id/mods', requirePermission(PERMISSIONS.MODS_INSTALL), async (req: Request, res: Response): Promise<void> => {
    logger.info(`POST /api/servers/${req.params.id}/mods - Request received`);
    logger.info(`Request body: ${JSON.stringify(req.body)}`);
    try {
      const { metadata } = req.body;

      if (!metadata) {
        logger.error('No metadata in request body');
        res.status(400).json({ error: 'metadata is required in request body' });
        return;
      }

      const { projectId, versionId, versionName, providerId = 'modtale' } = metadata;

      if (!projectId || !versionId) {
        res.status(400).json({ error: 'projectId and versionId are required' });
        return;
      }

      // Use versionName for download URL (API expects version number, not UUID)
      const downloadVersion = versionName || versionId;
      logger.info(`Installing mod ${projectId} version ${downloadVersion} from ${providerId} to server ${req.params.id}`);

      // Ensure providerId is set in metadata
      metadata.providerId = providerId;

      let downloadStream;

      // Use ModProviderService if available and provider is specified
      if (modProviderService && modProviderService.hasProvider(providerId)) {
        logger.info(`Using ModProviderService for provider: ${providerId}`);

        const provider = modProviderService.getProvider(providerId);
        if (!provider || !provider.isConfigured()) {
          res.status(500).json({ error: `${providerId} API key not configured. Set it in Settings.` });
          return;
        }

        try {
          downloadStream = await modProviderService.downloadVersion(providerId, projectId, downloadVersion);
        } catch (downloadError: any) {
          // If versionName failed, try with versionId as fallback
          if (downloadVersion !== versionId) {
            logger.info(`Download with versionName failed, trying versionId: ${versionId}`);
            try {
              downloadStream = await modProviderService.downloadVersion(providerId, projectId, versionId);
            } catch (fallbackError: any) {
              logger.error(`Both download attempts failed`);
              throw new Error(`Download failed: This mod/modpack may not have downloadable files available.`);
            }
          } else {
            throw downloadError;
          }
        }
      } else {
        // Fallback to legacy Modtale-only approach for backward compatibility
        logger.info(`Using legacy ModtaleApiService (no ModProviderService or provider not found)`);

        const { modtaleApiService } = await import('../services/ModtaleApiService');

        if (!modtaleApiService.getApiKey()) {
          logger.error('Modtale API key not configured');
          res.status(500).json({ error: 'Modtale API key not configured. Set it in Settings.' });
          return;
        }

        try {
          downloadStream = await modtaleApiService.downloadVersion(projectId, downloadVersion);
        } catch (downloadError: any) {
          if (downloadVersion !== versionId) {
            logger.info(`Download with versionName failed, trying versionId: ${versionId}`);
            try {
              downloadStream = await modtaleApiService.downloadVersion(projectId, versionId);
            } catch (fallbackError: any) {
              logger.error(`Both download attempts failed`);
              throw new Error(`Download failed: This mod/modpack may not have downloadable files available.`);
            }
          } else {
            throw downloadError;
          }
        }
      }

      // Collect the stream into a buffer
      const chunks: Buffer[] = [];
      for await (const chunk of downloadStream) {
        chunks.push(Buffer.from(chunk));
      }
      const modFile = Buffer.concat(chunks);

      logger.info(`Downloaded mod file: ${modFile.length} bytes`);

      // Update metadata with actual file size
      metadata.fileSize = modFile.length;

      const adapter = await serverService.getAdapterForServer(req.params.id);
      const mod = await modService.installMod(adapter, req.params.id, modFile, metadata);
      res.status(201).json(mod);
    } catch (error: any) {
      logger.error('Error installing mod:', error);
      res.status(500).json({ error: error.message || 'Failed to install mod' });
    }
  });

  /**
   * DELETE /api/servers/:serverId/mods/:modId
   * Uninstall a mod
   */
  router.delete('/:serverId/mods/:modId', requirePermission(PERMISSIONS.MODS_UNINSTALL), async (req: Request, res: Response) => {
    try {
      const adapter = await serverService.getAdapterForServer(req.params.serverId);
      await modService.uninstallMod(adapter, req.params.modId);
      res.status(204).send();
    } catch (error) {
      logger.error('Error uninstalling mod:', error);
      res.status(500).json({ error: 'Failed to uninstall mod' });
    }
  });

  /**
   * PATCH /api/servers/:serverId/mods/:modId/enable
   * Enable a mod
   */
  router.patch('/:serverId/mods/:modId/enable', requirePermission(PERMISSIONS.MODS_TOGGLE), async (req: Request, res: Response) => {
    try {
      const adapter = await serverService.getAdapterForServer(req.params.serverId);
      const mod = await modService.enableMod(adapter, req.params.modId);
      res.json(mod);
    } catch (error) {
      logger.error('Error enabling mod:', error);
      res.status(500).json({ error: 'Failed to enable mod' });
    }
  });

  /**
   * PATCH /api/servers/:serverId/mods/:modId/disable
   * Disable a mod
   */
  router.patch('/:serverId/mods/:modId/disable', requirePermission(PERMISSIONS.MODS_TOGGLE), async (req: Request, res: Response) => {
    try {
      const adapter = await serverService.getAdapterForServer(req.params.serverId);
      const mod = await modService.disableMod(adapter, req.params.modId);
      res.json(mod);
    } catch (error) {
      logger.error('Error disabling mod:', error);
      res.status(500).json({ error: 'Failed to disable mod' });
    }
  });

  // ============================================
  // Players
  // ============================================

  /**
   * GET /api/servers/:id/players
   * Get all players for a server
   */
  router.get('/:id/players', requirePermission(PERMISSIONS.PLAYERS_VIEW), async (req: Request, res: Response) => {
    try {
      const onlineOnly = req.query.online === 'true';
      const players = await playerService.getServerPlayers(req.params.id, onlineOnly);
      res.json(players);
    } catch (error) {
      logger.error('Error getting players:', error);
      res.status(500).json({ error: 'Failed to get players' });
    }
  });

  /**
   * POST /api/servers/:serverId/players/:uuid/kick
   * Kick a player
   */
  router.post('/:serverId/players/:uuid/kick', requirePermission(PERMISSIONS.PLAYERS_KICK), async (req: Request, res: Response) => {
    try {
      const { reason } = req.body;
      const adapter = await serverService.getAdapterForServer(req.params.serverId);
      await playerService.kickPlayer(adapter, req.params.uuid, reason);
      res.json({ message: 'Player kicked' });
    } catch (error) {
      logger.error('Error kicking player:', error);
      res.status(500).json({ error: 'Failed to kick player' });
    }
  });

  /**
   * POST /api/servers/:serverId/players/:uuid/ban
   * Ban a player
   */
  router.post('/:serverId/players/:uuid/ban', requirePermission(PERMISSIONS.PLAYERS_BAN), async (req: Request, res: Response) => {
    try {
      const { reason, duration } = req.body;
      const adapter = await serverService.getAdapterForServer(req.params.serverId);
      const player = await playerService.banPlayer(adapter, req.params.uuid, reason, duration);
      res.json(player);
    } catch (error) {
      logger.error('Error banning player:', error);
      res.status(500).json({ error: 'Failed to ban player' });
    }
  });

  /**
   * POST /api/servers/:serverId/players/:uuid/unban
   * Unban a player
   */
  router.post('/:serverId/players/:uuid/unban', requirePermission(PERMISSIONS.PLAYERS_UNBAN), async (req: Request, res: Response) => {
    try {
      const adapter = await serverService.getAdapterForServer(req.params.serverId);
      const player = await playerService.unbanPlayer(adapter, req.params.uuid);
      res.json(player);
    } catch (error) {
      logger.error('Error unbanning player:', error);
      res.status(500).json({ error: 'Failed to unban player' });
    }
  });

  // ============================================
  // Backups
  // ============================================

  /**
   * GET /api/servers/:id/backups
   * Get all backups for a server
   */
  router.get('/:id/backups', requirePermission(PERMISSIONS.BACKUPS_VIEW), async (req: Request, res: Response) => {
    try {
      const backups = await backupService.listBackups(req.params.id);
      res.json(backups);
    } catch (error) {
      logger.error('Error getting backups:', error);
      res.status(500).json({ error: 'Failed to get backups' });
    }
  });

  /**
   * GET /api/servers/:id/backups/stats
   * Get backup statistics for a server
   */
  router.get('/:id/backups/stats', requirePermission(PERMISSIONS.BACKUPS_VIEW), async (req: Request, res: Response) => {
    try {
      const stats = await backupService.getBackupStats(req.params.id);
      res.json(stats);
    } catch (error) {
      logger.error('Error getting backup stats:', error);
      res.status(500).json({ error: 'Failed to get backup stats' });
    }
  });

  /**
   * POST /api/servers/:id/backups
   * Create a new backup
   */
  router.post('/:id/backups', requirePermission(PERMISSIONS.BACKUPS_CREATE), async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const { description } = req.body;
      const server = await serverService.getServer(req.params.id);

      // Run backup in background so the API returns immediately
      const backup = await backupService.createBackup(
        req.params.id,
        description,
        undefined, // automationRuleId
        undefined, // scheduledTaskId
        true       // runInBackground
      );

      // Log activity (user is guaranteed by requirePermission middleware)
      const activityLogService: ActivityLogService = req.app.get('activityLogService');
      const context = getActivityContext(req);
      const user = authReq.user!;
      activityLogService.logAsync({
        userId: user.id,
        username: user.username,
        userRole: user.role,
        action: ACTIVITY_ACTIONS.BACKUP_CREATE,
        resourceType: RESOURCE_TYPES.BACKUP,
        resourceId: backup.id,
        resourceName: `${server?.name} - ${backup.name}`,
        status: 'success',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      res.status(201).json(backup);
    } catch (error: any) {
      logger.error('Error creating backup:', error);
      res.status(500).json({ error: error.message || 'Failed to create backup' });
    }
  });

  /**
   * POST /api/bulk/delete-backups
   * Delete multiple backups
   */
  router.post('/bulk/delete-backups', requirePermission(PERMISSIONS.BACKUPS_DELETE), async (req: Request, res: Response) => {
    try {
      const { backupIds } = req.body;

      if (!backupIds || !Array.isArray(backupIds) || backupIds.length === 0) {
        res.status(400).json({ error: 'backupIds array is required' });
        return;
      }

      const result = await backupService.deleteBackups(backupIds);
      res.json(result);
    } catch (error: any) {
      logger.error('Error deleting backups:', error);
      res.status(500).json({ error: error.message || 'Failed to delete backups' });
    }
  });

  /**
   * GET /api/backups/:id
   * Get a single backup
   */
  router.get('/backups/:id', requirePermission(PERMISSIONS.BACKUPS_VIEW), async (req: Request, res: Response) => {
    try {
      const backup = await backupService.getBackup(req.params.id);
      res.json(backup);
    } catch (error: any) {
      logger.error('Error getting backup:', error);
      res.status(404).json({ error: error.message || 'Backup not found' });
    }
  });

  /**
   * POST /api/backups/:id/restore
   * Restore a server from a backup
   */
  router.post('/backups/:id/restore', requirePermission(PERMISSIONS.BACKUPS_RESTORE), async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const backup = await backupService.getBackup(req.params.id);
      await backupService.restoreBackup(req.params.id);

      // Log activity (user is guaranteed by requirePermission middleware)
      const activityLogService: ActivityLogService = req.app.get('activityLogService');
      const context = getActivityContext(req);
      const user = authReq.user!;
      activityLogService.logAsync({
        userId: user.id,
        username: user.username,
        userRole: user.role,
        action: ACTIVITY_ACTIONS.BACKUP_RESTORE,
        resourceType: RESOURCE_TYPES.BACKUP,
        resourceId: req.params.id,
        resourceName: backup.name,
        status: 'success',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      res.json({ message: 'Backup restored successfully' });
    } catch (error: any) {
      logger.error('Error restoring backup:', error);
      res.status(500).json({ error: error.message || 'Failed to restore backup' });
    }
  });

  /**
   * DELETE /api/backups/:id
   * Delete a backup
   */
  router.delete('/backups/:id', requirePermission(PERMISSIONS.BACKUPS_DELETE), async (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    try {
      const backup = await backupService.getBackup(req.params.id);
      const backupName = backup.name;
      await backupService.deleteBackup(req.params.id);

      // Log activity (user is guaranteed by requirePermission middleware)
      const activityLogService: ActivityLogService = req.app.get('activityLogService');
      const context = getActivityContext(req);
      const user = authReq.user!;
      activityLogService.logAsync({
        userId: user.id,
        username: user.username,
        userRole: user.role,
        action: ACTIVITY_ACTIONS.BACKUP_DELETE,
        resourceType: RESOURCE_TYPES.BACKUP,
        resourceId: req.params.id,
        resourceName: backupName,
        status: 'success',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      res.status(204).send();
    } catch (error: any) {
      logger.error('Error deleting backup:', error);
      res.status(500).json({ error: error.message || 'Failed to delete backup' });
    }
  });

  // ============================================
  // Scheduled Tasks
  // ============================================

  /**
   * GET /api/servers/:id/tasks
   * Get all scheduled tasks for a server
   */
  router.get('/:id/tasks', async (req: Request, res: Response) => {
    try {
      const tasks = await schedulerService.listTasks(req.params.id);
      res.json(tasks);
    } catch (error) {
      logger.error('Error getting tasks:', error);
      res.status(500).json({ error: 'Failed to get tasks' });
    }
  });

  /**
   * GET /api/tasks
   * Get all scheduled tasks (all servers)
   */
  router.get('/tasks', async (_req: Request, res: Response) => {
    try {
      const tasks = await schedulerService.listTasks();
      res.json(tasks);
    } catch (error) {
      logger.error('Error getting all tasks:', error);
      res.status(500).json({ error: 'Failed to get tasks' });
    }
  });

  /**
   * POST /api/servers/:id/tasks
   * Create a new scheduled task
   */
  router.post('/:id/tasks', async (req: Request, res: Response) => {
    try {
      const { name, type, cronExpression, taskData, enabled } = req.body;

      if (!name || !type || !cronExpression) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const task = await schedulerService.createTask({
        serverId: req.params.id,
        name,
        type,
        cronExpression,
        taskData,
        enabled,
      });

      return res.status(201).json(task);
    } catch (error: any) {
      logger.error('Error creating task:', error);
      return res.status(500).json({ error: error.message || 'Failed to create task' });
    }
  });

  /**
   * GET /api/tasks/:id
   * Get a single scheduled task
   */
  router.get('/tasks/:id', async (req: Request, res: Response) => {
    try {
      const task = await schedulerService.getTask(req.params.id);
      res.json(task);
    } catch (error: any) {
      logger.error('Error getting task:', error);
      res.status(404).json({ error: error.message || 'Task not found' });
    }
  });

  /**
   * PATCH /api/tasks/:id
   * Update a scheduled task
   */
  router.patch('/tasks/:id', async (req: Request, res: Response) => {
    try {
      const { name, cronExpression, taskData, enabled } = req.body;

      const task = await schedulerService.updateTask(req.params.id, {
        name,
        cronExpression,
        taskData,
        enabled,
      });

      res.json(task);
    } catch (error: any) {
      logger.error('Error updating task:', error);
      res.status(500).json({ error: error.message || 'Failed to update task' });
    }
  });

  /**
   * POST /api/tasks/:id/toggle
   * Toggle task enabled/disabled
   */
  router.post('/tasks/:id/toggle', async (req: Request, res: Response) => {
    try {
      const { enabled } = req.body;
      const task = await schedulerService.toggleTask(req.params.id, enabled);
      res.json(task);
    } catch (error: any) {
      logger.error('Error toggling task:', error);
      res.status(500).json({ error: error.message || 'Failed to toggle task' });
    }
  });

  /**
   * POST /api/tasks/:id/run
   * Run a task immediately
   */
  router.post('/tasks/:id/run', async (req: Request, res: Response) => {
    try {
      await schedulerService.runTaskNow(req.params.id);
      res.json({ message: 'Task executed successfully' });
    } catch (error: any) {
      logger.error('Error running task:', error);
      res.status(500).json({ error: error.message || 'Failed to run task' });
    }
  });

  /**
   * DELETE /api/tasks/:id
   * Delete a scheduled task
   */
  router.delete('/tasks/:id', async (req: Request, res: Response) => {
    try {
      await schedulerService.deleteTask(req.params.id);
      res.status(204).send();
    } catch (error: any) {
      logger.error('Error deleting task:', error);
      res.status(500).json({ error: error.message || 'Failed to delete task' });
    }
  });

  // ============================================
  // File Management
  // ============================================

  /**
   * GET /api/servers/:id/files
   * List files and directories
   */
  router.get('/:id/files', async (req: Request, res: Response) => {
    try {
      const { path: dirPath = '' } = req.query;
      const files = await fileService.listFiles(req.params.id, dirPath as string);
      res.json(files);
    } catch (error: any) {
      logger.error('Error listing files:', error);
      res.status(500).json({ error: error.message || 'Failed to list files' });
    }
  });

  /**
   * GET /api/servers/:id/files/read
   * Read file contents
   */
  router.get('/:id/files/read', async (req: Request, res: Response) => {
    try {
      const { path: filePath } = req.query;
      if (!filePath) {
        return res.status(400).json({ error: 'File path is required' });
      }
      const content = await fileService.readFile(req.params.id, filePath as string);
      return res.json({ content });
    } catch (error: any) {
      logger.error('Error reading file:', error);
      return res.status(500).json({ error: error.message || 'Failed to read file' });
    }
  });

  /**
   * POST /api/servers/:id/files/write
   * Write/update file contents
   */
  router.post('/:id/files/write', async (req: Request, res: Response) => {
    try {
      const { path: filePath, content } = req.body;
      if (!filePath) {
        return res.status(400).json({ error: 'File path is required' });
      }
      await fileService.writeFile(req.params.id, filePath, content || '');
      return res.json({ message: 'File saved successfully' });
    } catch (error: any) {
      logger.error('Error writing file:', error);
      return res.status(500).json({ error: error.message || 'Failed to write file' });
    }
  });

  /**
   * POST /api/servers/:id/files/create
   * Create a new file
   */
  router.post('/:id/files/create', async (req: Request, res: Response) => {
    try {
      const { path: filePath, content = '' } = req.body;
      if (!filePath) {
        return res.status(400).json({ error: 'File path is required' });
      }
      await fileService.createFile(req.params.id, filePath, content);
      return res.status(201).json({ message: 'File created successfully' });
    } catch (error: any) {
      logger.error('Error creating file:', error);
      return res.status(500).json({ error: error.message || 'Failed to create file' });
    }
  });

  /**
   * POST /api/servers/:id/files/mkdir
   * Create a new directory
   */
  router.post('/:id/files/mkdir', async (req: Request, res: Response) => {
    try {
      const { path: dirPath } = req.body;
      if (!dirPath) {
        return res.status(400).json({ error: 'Directory path is required' });
      }
      await fileService.createDirectory(req.params.id, dirPath);
      return res.status(201).json({ message: 'Directory created successfully' });
    } catch (error: any) {
      logger.error('Error creating directory:', error);
      return res.status(500).json({ error: error.message || 'Failed to create directory' });
    }
  });

  /**
   * DELETE /api/servers/:id/files
   * Delete a file or directory
   */
  router.delete('/:id/files', async (req: Request, res: Response) => {
    try {
      const { path: itemPath } = req.query;
      if (!itemPath) {
        return res.status(400).json({ error: 'Path is required' });
      }
      await fileService.delete(req.params.id, itemPath as string);
      return res.status(204).send();
    } catch (error: any) {
      logger.error('Error deleting file/directory:', error);
      return res.status(500).json({ error: error.message || 'Failed to delete' });
    }
  });

  /**
   * POST /api/servers/:id/files/rename
   * Rename/move a file or directory
   */
  router.post('/:id/files/rename', async (req: Request, res: Response) => {
    try {
      const { oldPath, newPath } = req.body;
      if (!oldPath || !newPath) {
        return res.status(400).json({ error: 'Both oldPath and newPath are required' });
      }
      await fileService.rename(req.params.id, oldPath, newPath);
      return res.json({ message: 'Renamed successfully' });
    } catch (error: any) {
      logger.error('Error renaming:', error);
      return res.status(500).json({ error: error.message || 'Failed to rename' });
    }
  });

  /**
   * GET /api/servers/:id/files/info
   * Get file or directory info
   */
  router.get('/:id/files/info', async (req: Request, res: Response) => {
    try {
      const { path: itemPath } = req.query;
      if (!itemPath) {
        return res.status(400).json({ error: 'Path is required' });
      }
      const info = await fileService.getInfo(req.params.id, itemPath as string);
      return res.json(info);
    } catch (error: any) {
      logger.error('Error getting file info:', error);
      return res.status(500).json({ error: error.message || 'Failed to get info' });
    }
  });

  /**
   * GET /api/servers/:id/files/search
   * Search files by name pattern
   */
  router.get('/:id/files/search', async (req: Request, res: Response) => {
    try {
      const { pattern, path: dirPath = '' } = req.query;
      if (!pattern) {
        return res.status(400).json({ error: 'Search pattern is required' });
      }
      const files = await fileService.searchFiles(req.params.id, pattern as string, dirPath as string);
      return res.json(files);
    } catch (error: any) {
      logger.error('Error searching files:', error);
      return res.status(500).json({ error: error.message || 'Failed to search files' });
    }
  });

  /**
   * GET /api/servers/:id/files/usage
   * Get disk usage for server
   */
  router.get('/:id/files/usage', async (req: Request, res: Response) => {
    try {
      const usage = await fileService.getDiskUsage(req.params.id);
      res.json(usage);
    } catch (error: any) {
      logger.error('Error getting disk usage:', error);
      res.status(500).json({ error: error.message || 'Failed to get disk usage' });
    }
  });

  /**
   * GET /api/servers/:id/files/download
   * Download a file
   */
  router.get('/:id/files/download', async (req: Request, res: Response) => {
    try {
      const { path: filePath } = req.query;
      if (!filePath) {
        return res.status(400).json({ error: 'File path is required' });
      }
      const buffer = await fileService.downloadFile(req.params.id, filePath as string);
      const filename = filePath.toString().split('/').pop() || 'download';

      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.send(buffer);
    } catch (error: any) {
      logger.error('Error downloading file:', error);
      return res.status(500).json({ error: error.message || 'Failed to download file' });
    }
  });

  /**
   * POST /api/servers/:id/files/upload
   * Upload a file with optional ZIP extraction
   */
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: require('../config').default.maxFileUploadSize,
      files: 1,
    },
    fileFilter: (_req, _file, cb) => {
      // Currently all file types are allowed to upload.
      // Maybe it makes sense to only allow specific file types (maybe configurable?)
      // That would need to happen here.
      cb(null, true);
    },
  });

  const handleUpload = (req: Request, res: Response, next: Function) => {
    upload.single('file')(req, res, (err: any) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            const config = require('../config').default;
            return res.status(413).json({
              error: `File too large. Maximum size is ${config.maxFileUploadSize / (1024 * 1024)}MB`,
            });
          }
          return res.status(400).json({ error: err.message });
        }

        return res.status(400).json({ error: err.message || 'File upload failed' });
      }
      return next();
    });
  };

  router.post(
    '/:id/files/upload',
    requirePermission(PERMISSIONS.SERVERS_FILES_WRITE),
    handleUpload,
    async (req: Request, res: Response) => {
      try {
        const { path: filePath } = req.body;

        let autoExtractZip = true;
        if (req.body.autoExtractZip !== undefined) {
          autoExtractZip = req.body.autoExtractZip !== 'false' && req.body.autoExtractZip !== false;
        }

        if (!filePath) {
          return res.status(400).json({ error: 'File path is required' });
        }

        if (!req.file || !req.file.buffer) {
          return res.status(400).json({ error: 'No file provided' });
        }

        const result = await fileService.uploadFileWithExtraction(
          req.params.id,
          filePath,
          req.file.buffer,
          autoExtractZip
        );

        return res.status(201).json(result);
      } catch (error: any) {
        logger.error('Error uploading file:', error);
        return res.status(500).json({ error: error.message || 'Failed to upload file' });
      }
    }
  );

  // ============================================
  // Performance Metrics
  // ============================================

  /**
   * GET /api/servers/:id/metrics
   * Get metrics for a server
   */
  router.get('/:id/metrics', async (req: Request, res: Response) => {
    try {
      const { startTime, endTime, limit } = req.query;
      const metrics = await metricsService.queryMetrics({
        serverId: req.params.id,
        startTime: startTime ? new Date(startTime as string) : undefined,
        endTime: endTime ? new Date(endTime as string) : undefined,
        limit: limit ? parseInt(limit as string) : undefined,
      });
      return res.json(metrics);
    } catch (error: any) {
      logger.error('Error getting metrics:', error);
      return res.status(500).json({ error: error.message || 'Failed to get metrics' });
    }
  });

  /**
   * GET /api/servers/:id/metrics/latest
   * Get latest metrics for a server
   */
  router.get('/:id/metrics/latest', async (req: Request, res: Response) => {
    try {
      const metrics = await metricsService.getLatestMetrics(req.params.id);
      if (!metrics) {
        return res.status(404).json({ error: 'No metrics found' });
      }
      return res.json(metrics);
    } catch (error: any) {
      logger.error('Error getting latest metrics:', error);
      return res.status(500).json({ error: error.message || 'Failed to get latest metrics' });
    }
  });

  /**
   * GET /api/servers/:id/metrics/aggregate/:interval
   * Get aggregated metrics for a time interval
   */
  router.get('/:id/metrics/aggregate/:interval', async (req: Request, res: Response) => {
    try {
      const { interval } = req.params;
      const validIntervals = ['1h', '6h', '24h', '7d', '30d'];

      if (!validIntervals.includes(interval)) {
        return res.status(400).json({ error: 'Invalid interval' });
      }

      const metrics = await metricsService.getAggregatedMetrics(
        req.params.id,
        interval as '1h' | '6h' | '24h' | '7d' | '30d'
      );
      return res.json(metrics);
    } catch (error: any) {
      logger.error('Error getting aggregated metrics:', error);
      return res.status(500).json({ error: error.message || 'Failed to get aggregated metrics' });
    }
  });

  // ============================================
  // World Management
  // ============================================

  /**
   * GET /api/servers/:id/worlds
   * List all worlds for a server
   */
  router.get('/:id/worlds', async (req: Request, res: Response) => {
    try {
      const worlds = await worldsService.listWorlds(req.params.id);
      return res.json(worlds);
    } catch (error: any) {
      logger.error('Error listing worlds:', error);
      return res.status(500).json({ error: error.message || 'Failed to list worlds' });
    }
  });

  /**
   * GET /api/servers/:id/worlds/:worldId
   * Get world details
   */
  router.get('/:id/worlds/:worldId', async (req: Request, res: Response) => {
    try {
      const world = await worldsService.getWorld(req.params.worldId);
      if (!world) {
        return res.status(404).json({ error: 'World not found' });
      }
      return res.json(world);
    } catch (error: any) {
      logger.error('Error getting world:', error);
      return res.status(500).json({ error: error.message || 'Failed to get world' });
    }
  });

  /**
   * POST /api/servers/:id/worlds/:worldId/activate
   * Set active world for a server
   */
  router.post('/:id/worlds/:worldId/activate', async (req: Request, res: Response) => {
    try {
      await worldsService.setActiveWorld(req.params.id, req.params.worldId);
      return res.json({ message: 'World activated successfully' });
    } catch (error: any) {
      logger.error('Error activating world:', error);
      return res.status(500).json({ error: error.message || 'Failed to activate world' });
    }
  });

  /**
   * PUT /api/servers/:id/worlds/:worldId
   * Update world metadata
   */
  router.put('/:id/worlds/:worldId', async (req: Request, res: Response) => {
    try {
      const { name, description } = req.body;
      const world = await worldsService.updateWorld(req.params.worldId, { name, description });
      return res.json(world);
    } catch (error: any) {
      logger.error('Error updating world:', error);
      return res.status(500).json({ error: error.message || 'Failed to update world' });
    }
  });

  /**
   * DELETE /api/servers/:id/worlds/:worldId
   * Delete a world
   */
  router.delete('/:id/worlds/:worldId', async (req: Request, res: Response) => {
    try {
      await worldsService.deleteWorld(req.params.worldId);
      return res.status(204).send();
    } catch (error: any) {
      logger.error('Error deleting world:', error);
      return res.status(500).json({ error: error.message || 'Failed to delete world' });
    }
  });

  /**
   * GET /api/servers/:id/worlds/:worldId/config
   * Get world config.json
   */
  router.get('/:id/worlds/:worldId/config', async (req: Request, res: Response) => {
    try {
      const config = await worldsService.getWorldConfig(req.params.worldId);
      return res.json(config);
    } catch (error: any) {
      logger.error('Error getting world config:', error);
      return res.status(500).json({ error: error.message || 'Failed to get world config' });
    }
  });

  /**
   * PUT /api/servers/:id/worlds/:worldId/config
   * Update world config.json
   */
  router.put('/:id/worlds/:worldId/config', async (req: Request, res: Response) => {
    try {
      const config = await worldsService.updateWorldConfig(req.params.worldId, req.body);
      return res.json(config);
    } catch (error: any) {
      logger.error('Error updating world config:', error);
      const statusCode = error.message?.includes('running') ? 400 : 500;
      return res.status(statusCode).json({ error: error.message || 'Failed to update world config' });
    }
  });

  // ============================================
  // Alerts & Notifications
  // ============================================

  /**
   * GET /api/servers/:id/alerts
   * Get alerts for a server
   */
  router.get('/:id/alerts', async (req: Request, res: Response) => {
    try {
      const { unreadOnly, unresolvedOnly, limit } = req.query;
      const alerts = await alertsService.getAlerts(req.params.id, {
        unreadOnly: unreadOnly === 'true',
        unresolvedOnly: unresolvedOnly === 'true',
        limit: limit ? parseInt(limit as string) : undefined,
      });
      return res.json(alerts);
    } catch (error: any) {
      logger.error('Error getting alerts:', error);
      return res.status(500).json({ error: error.message || 'Failed to get alerts' });
    }
  });

  /**
   * GET /api/servers/:id/alerts/unread-count
   * Get unread alert count for a server
   */
  router.get('/:id/alerts/unread-count', async (req: Request, res: Response) => {
    try {
      const count = await alertsService.getUnreadCount(req.params.id);
      return res.json({ count });
    } catch (error: any) {
      logger.error('Error getting unread count:', error);
      return res.status(500).json({ error: error.message || 'Failed to get unread count' });
    }
  });

  /**
   * PUT /api/servers/:id/alerts/:alertId/read
   * Mark alert as read
   */
  router.put('/:id/alerts/:alertId/read', async (req: Request, res: Response) => {
    try {
      await alertsService.markAsRead(req.params.alertId);
      return res.json({ message: 'Alert marked as read' });
    } catch (error: any) {
      logger.error('Error marking alert as read:', error);
      return res.status(500).json({ error: error.message || 'Failed to mark alert as read' });
    }
  });

  /**
   * PUT /api/servers/:id/alerts/read-all
   * Mark all alerts as read for a server
   */
  router.put('/:id/alerts/read-all', async (req: Request, res: Response) => {
    try {
      await alertsService.markAllAsRead(req.params.id);
      return res.json({ message: 'All alerts marked as read' });
    } catch (error: any) {
      logger.error('Error marking all alerts as read:', error);
      return res.status(500).json({ error: error.message || 'Failed to mark all alerts as read' });
    }
  });

  /**
   * PUT /api/servers/:id/alerts/:alertId/resolve
   * Resolve an alert
   */
  router.put('/:id/alerts/:alertId/resolve', async (req: Request, res: Response) => {
    try {
      await alertsService.resolveAlert(req.params.alertId);
      return res.json({ message: 'Alert resolved' });
    } catch (error: any) {
      logger.error('Error resolving alert:', error);
      return res.status(500).json({ error: error.message || 'Failed to resolve alert' });
    }
  });

  /**
   * DELETE /api/servers/:id/alerts/:alertId
   * Delete an alert
   */
  router.delete('/:id/alerts/:alertId', async (req: Request, res: Response) => {
    try {
      await alertsService.deleteAlert(req.params.alertId);
      return res.status(204).send();
    } catch (error: any) {
      logger.error('Error deleting alert:', error);
      return res.status(500).json({ error: error.message || 'Failed to delete alert' });
    }
  });

  // ============================================
  // Automation Rules
  // ============================================

  /**
   * GET /api/servers/:id/automation-rules
   * Get automation rules for a server
   */
  router.get('/:id/automation-rules', async (req: Request, res: Response) => {
    try {
      const rules = await automationRulesService.getRules(req.params.id);
      return res.json(rules);
    } catch (error: any) {
      logger.error('Error getting automation rules:', error);
      return res.status(500).json({ error: error.message || 'Failed to get automation rules' });
    }
  });

  /**
   * GET /api/servers/:id/automation-rules/:ruleId
   * Get automation rule details
   */
  router.get('/:id/automation-rules/:ruleId', async (req: Request, res: Response) => {
    try {
      const rule = await automationRulesService.getRule(req.params.ruleId);
      if (!rule) {
        return res.status(404).json({ error: 'Rule not found' });
      }
      return res.json(rule);
    } catch (error: any) {
      logger.error('Error getting automation rule:', error);
      return res.status(500).json({ error: error.message || 'Failed to get automation rule' });
    }
  });

  /**
   * POST /api/servers/:id/automation-rules
   * Create automation rule
   */
  router.post('/:id/automation-rules', async (req: Request, res: Response) => {
    try {
      const rule = await automationRulesService.createRule({
        serverId: req.params.id,
        ...req.body,
      });
      return res.status(201).json(rule);
    } catch (error: any) {
      logger.error('Error creating automation rule:', error);
      return res.status(500).json({ error: error.message || 'Failed to create automation rule' });
    }
  });

  /**
   * PUT /api/servers/:id/automation-rules/:ruleId
   * Update automation rule
   */
  router.put('/:id/automation-rules/:ruleId', async (req: Request, res: Response) => {
    try {
      const rule = await automationRulesService.updateRule(req.params.ruleId, req.body);
      return res.json(rule);
    } catch (error: any) {
      logger.error('Error updating automation rule:', error);
      return res.status(500).json({ error: error.message || 'Failed to update automation rule' });
    }
  });

  /**
   * DELETE /api/servers/:id/automation-rules/:ruleId
   * Delete automation rule
   */
  router.delete('/:id/automation-rules/:ruleId', async (req: Request, res: Response) => {
    try {
      await automationRulesService.deleteRule(req.params.ruleId);
      return res.status(204).send();
    } catch (error: any) {
      logger.error('Error deleting automation rule:', error);
      return res.status(500).json({ error: error.message || 'Failed to delete automation rule' });
    }
  });

  /**
   * PUT /api/servers/:id/automation-rules/:ruleId/toggle
   * Toggle automation rule enabled status
   */
  router.put('/:id/automation-rules/:ruleId/toggle', async (req: Request, res: Response) => {
    try {
      const { enabled } = req.body;
      await automationRulesService.toggleRule(req.params.ruleId, enabled);
      return res.json({ message: `Rule ${enabled ? 'enabled' : 'disabled'}` });
    } catch (error: any) {
      logger.error('Error toggling automation rule:', error);
      return res.status(500).json({ error: error.message || 'Failed to toggle automation rule' });
    }
  });

  /**
   * POST /api/servers/:id/automation-rules/:ruleId/execute
   * Execute automation rule manually
   */
  router.post('/:id/automation-rules/:ruleId/execute', async (req: Request, res: Response) => {
    try {
      await automationRulesService.executeRule(req.params.ruleId);
      return res.json({ message: 'Rule executed successfully' });
    } catch (error: any) {
      logger.error('Error executing automation rule:', error);
      return res.status(500).json({ error: error.message || 'Failed to execute automation rule' });
    }
  });

  return router;
}
