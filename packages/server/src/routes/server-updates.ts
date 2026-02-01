import { Router, Request, Response } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { serverUpdateService } from '../services/ServerUpdateService';
import { PERMISSIONS } from '../permissions/definitions';
import logger from '../utils/logger';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/server-updates/:serverId/check
 * Check for updates for a specific server
 */
router.get(
  '/:serverId/check',
  requirePermission(PERMISSIONS.SERVERS_VIEW),
  async (req: Request, res: Response) => {
    try {
      const { serverId } = req.params;
      const result = await serverUpdateService.checkForUpdate(serverId);
      res.json(result);
    } catch (error: any) {
      logger.error('[ServerUpdate] Error checking for updates:', error);
      res.status(500).json({ error: 'Failed to check for updates', message: error.message });
    }
  }
);

/**
 * GET /api/server-updates/check-all
 * Check for updates for all servers
 */
router.get(
  '/check-all',
  requirePermission(PERMISSIONS.SERVERS_VIEW),
  async (_req: Request, res: Response) => {
    try {
      const results = await serverUpdateService.checkAllServersForUpdates();
      res.json(results);
    } catch (error: any) {
      logger.error('[ServerUpdate] Error checking all servers for updates:', error);
      res.status(500).json({ error: 'Failed to check for updates', message: error.message });
    }
  }
);

/**
 * POST /api/server-updates/:serverId/update
 * Start update for a specific server
 */
router.post(
  '/:serverId/update',
  requirePermission(PERMISSIONS.SERVERS_UPDATE),
  async (req: Request, res: Response) => {
    try {
      const { serverId } = req.params;
      const { targetVersion } = req.body;

      const session = await serverUpdateService.startUpdate(serverId, targetVersion);
      res.json(session);
    } catch (error: any) {
      logger.error('[ServerUpdate] Error starting update:', error);
      res.status(500).json({ error: 'Failed to start update', message: error.message });
    }
  }
);

/**
 * GET /api/server-updates/session/:sessionId
 * Get update session status
 */
router.get(
  '/session/:sessionId',
  requirePermission(PERMISSIONS.SERVERS_VIEW),
  async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      const session = serverUpdateService.getSession(sessionId);

      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      res.json(session);
    } catch (error: any) {
      logger.error('[ServerUpdate] Error getting session status:', error);
      res.status(500).json({ error: 'Failed to get session status', message: error.message });
    }
  }
);

/**
 * POST /api/server-updates/session/:sessionId/cancel
 * Cancel an in-progress update
 */
router.post(
  '/session/:sessionId/cancel',
  requirePermission(PERMISSIONS.SERVERS_UPDATE),
  async (req: Request, res: Response) => {
    try {
      const { sessionId } = req.params;
      await serverUpdateService.cancelUpdate(sessionId);
      res.json({ success: true });
    } catch (error: any) {
      logger.error('[ServerUpdate] Error cancelling update:', error);
      res.status(500).json({ error: 'Failed to cancel update', message: error.message });
    }
  }
);

/**
 * POST /api/server-updates/:serverId/rollback
 * Rollback to pre-update state
 */
router.post(
  '/:serverId/rollback',
  requirePermission(PERMISSIONS.SERVERS_UPDATE),
  async (req: Request, res: Response) => {
    try {
      const { serverId } = req.params;
      await serverUpdateService.rollback(serverId);
      res.json({ success: true });
    } catch (error: any) {
      logger.error('[ServerUpdate] Error rolling back update:', error);
      res.status(500).json({ error: 'Failed to rollback update', message: error.message });
    }
  }
);

/**
 * GET /api/server-updates/:serverId/history
 * Get update history for a server
 */
router.get(
  '/:serverId/history',
  requirePermission(PERMISSIONS.SERVERS_VIEW),
  async (req: Request, res: Response) => {
    try {
      const { serverId } = req.params;
      const limit = parseInt(req.query.limit as string) || 10;
      const history = await serverUpdateService.getUpdateHistory(serverId, limit);
      res.json(history);
    } catch (error: any) {
      logger.error('[ServerUpdate] Error getting update history:', error);
      res.status(500).json({ error: 'Failed to get update history', message: error.message });
    }
  }
);

/**
 * POST /api/server-updates/:serverId/force-reset
 * Force reset the update state for a server (when session is lost)
 */
router.post(
  '/:serverId/force-reset',
  requirePermission(PERMISSIONS.SERVERS_UPDATE),
  async (req: Request, res: Response) => {
    try {
      const { serverId } = req.params;
      await serverUpdateService.forceResetUpdateState(serverId);
      res.json({ success: true, message: 'Update state reset successfully' });
    } catch (error: any) {
      logger.error('[ServerUpdate] Error force resetting update:', error);
      res.status(500).json({ error: 'Failed to reset update state', message: error.message });
    }
  }
);

export default router;
