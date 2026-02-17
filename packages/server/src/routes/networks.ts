import { Router } from 'express';
import { NetworkService } from '../services/NetworkService';
import logger from '../utils/logger';

export function createNetworkRoutes(networkService: NetworkService): Router {
  const router = Router();

  // ==========================================
  // Network CRUD
  // ==========================================

  // GET /api/networks - List all networks
  router.get('/', async (_req, res) => {
    try {
      const networks = await networkService.getAllNetworks();
      res.json(networks);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error getting networks:', error);
      res.status(500).json({ error: message });
    }
  });

  // GET /api/networks/ungrouped - Get servers not in any network
  router.get('/ungrouped', async (_req, res) => {
    try {
      const servers = await networkService.getUngroupedServers();
      res.json(servers);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error getting ungrouped servers:', error);
      res.status(500).json({ error: message });
    }
  });

  // GET /api/networks/:id - Get single network with members
  router.get('/:id', async (req, res): Promise<void> => {
    try {
      const network = await networkService.getNetwork(req.params.id);
      if (!network) {
        res.status(404).json({ error: 'Network not found' });
        return;
      }
      res.json(network);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error getting network:', error);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/networks - Create network
  router.post('/', async (req, res): Promise<void> => {
    try {
      const { name, description, networkType, proxyServerId, proxyConfig, color, serverIds } = req.body;

      if (!name) {
        res.status(400).json({ error: 'Network name is required' });
        return;
      }

      const network = await networkService.createNetwork({
        name,
        description,
        networkType,
        proxyServerId,
        proxyConfig,
        color,
        serverIds,
      });

      res.status(201).json(network);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error creating network:', error);
      if (message.includes('already exists')) {
        res.status(409).json({ error: message });
      } else if (message.includes('Invalid proxy config')) {
        res.status(400).json({ error: message });
      } else {
        res.status(500).json({ error: message });
      }
    }
  });

  // PATCH /api/networks/:id - Update network
  router.patch('/:id', async (req, res) => {
    try {
      const { name, description, proxyServerId, proxyConfig, color, sortOrder, bulkActionsEnabled } = req.body;

      const network = await networkService.updateNetwork(req.params.id, {
        name,
        description,
        proxyServerId,
        proxyConfig,
        color,
        sortOrder,
        bulkActionsEnabled,
      });

      res.json(network);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error updating network:', error);
      if (message.includes('Invalid proxy config')) {
        res.status(400).json({ error: message });
      } else {
        res.status(500).json({ error: message });
      }
    }
  });

  // DELETE /api/networks/:id - Delete network
  router.delete('/:id', async (req, res) => {
    try {
      await networkService.deleteNetwork(req.params.id);
      res.json({ message: 'Network deleted' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error deleting network:', error);
      if (message.includes('not found')) {
        res.status(404).json({ error: message });
      } else {
        res.status(500).json({ error: message });
      }
    }
  });

  // ==========================================
  // Membership Management
  // ==========================================

  // POST /api/networks/:id/servers - Add server to network
  router.post('/:id/servers', async (req, res): Promise<void> => {
    try {
      const { serverId, role } = req.body;

      if (!serverId) {
        res.status(400).json({ error: 'Server ID is required' });
        return;
      }

      await networkService.addServer(req.params.id, serverId, role);
      res.json({ message: 'Server added to network' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error adding server to network:', error);
      if (message.includes('not found')) {
        res.status(404).json({ error: message });
      } else if (message.includes('already a member')) {
        res.status(409).json({ error: message });
      } else {
        res.status(500).json({ error: message });
      }
    }
  });

  // DELETE /api/networks/:id/servers/:serverId - Remove server from network
  router.delete('/:id/servers/:serverId', async (req, res) => {
    try {
      await networkService.removeServer(req.params.id, req.params.serverId);
      res.json({ message: 'Server removed from network' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error removing server from network:', error);
      res.status(500).json({ error: message });
    }
  });

  // PATCH /api/networks/:id/servers/:serverId - Update member role
  router.patch('/:id/servers/:serverId', async (req, res): Promise<void> => {
    try {
      const { role } = req.body;

      if (!role) {
        res.status(400).json({ error: 'Role is required' });
        return;
      }

      await networkService.updateMemberRole(req.params.id, req.params.serverId, role);
      res.json({ message: 'Member role updated' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error updating member role:', error);
      res.status(500).json({ error: message });
    }
  });

  // PUT /api/networks/:id/servers/order - Reorder servers
  router.put('/:id/servers/order', async (req, res): Promise<void> => {
    try {
      const { serverIds } = req.body;

      if (!serverIds || !Array.isArray(serverIds)) {
        res.status(400).json({ error: 'serverIds array is required' });
        return;
      }

      await networkService.reorderMembers(req.params.id, serverIds);
      res.json({ message: 'Servers reordered' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error reordering servers:', error);
      res.status(500).json({ error: message });
    }
  });

  // ==========================================
  // Bulk Operations
  // ==========================================

  // POST /api/networks/:id/start - Start all servers
  router.post('/:id/start', async (req, res) => {
    try {
      const result = await networkService.startNetwork(req.params.id);
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error starting network:', error);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/networks/:id/stop - Stop all servers
  router.post('/:id/stop', async (req, res) => {
    try {
      const result = await networkService.stopNetwork(req.params.id);
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error stopping network:', error);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/networks/:id/restart - Restart all servers
  router.post('/:id/restart', async (req, res) => {
    try {
      const result = await networkService.restartNetwork(req.params.id);
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error restarting network:', error);
      res.status(500).json({ error: message });
    }
  });

  // ==========================================
  // Status & Metrics
  // ==========================================

  // GET /api/networks/:id/status - Get derived network status
  router.get('/:id/status', async (req, res) => {
    try {
      const status = await networkService.getNetworkStatus(req.params.id);
      res.json(status);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error getting network status:', error);
      res.status(500).json({ error: message });
    }
  });

  // GET /api/networks/:id/metrics - Get aggregated metrics
  router.get('/:id/metrics', async (req, res) => {
    try {
      const metrics = await networkService.getNetworkMetrics(req.params.id);
      res.json(metrics);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error getting network metrics:', error);
      res.status(500).json({ error: message });
    }
  });

  // GET /api/networks/:id/players - Get cross-server players
  router.get('/:id/players', async (req, res) => {
    try {
      const players = await networkService.getNetworkPlayers(req.params.id);
      res.json(players);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error getting network players:', error);
      res.status(500).json({ error: message });
    }
  });

  // ==========================================
  // Network Backups
  // ==========================================

  // GET /api/networks/:id/backups - List network backups
  router.get('/:id/backups', async (req, res) => {
    try {
      const backups = await networkService.getNetworkBackups(req.params.id);
      res.json(backups);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error getting network backups:', error);
      res.status(500).json({ error: message });
    }
  });

  // POST /api/networks/:id/backups - Create network backup
  router.post('/:id/backups', async (req, res) => {
    try {
      const { description } = req.body;
      const backup = await networkService.createNetworkBackup(req.params.id, description);
      res.status(202).json(backup);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error creating network backup:', error);
      res.status(500).json({ error: message });
    }
  });

  // DELETE /api/networks/:id/backups/:backupId - Delete network backup
  router.delete('/:id/backups/:backupId', async (req, res) => {
    try {
      await networkService.deleteNetworkBackup(req.params.backupId);
      res.json({ message: 'Network backup deleted' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Error deleting network backup:', error);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
