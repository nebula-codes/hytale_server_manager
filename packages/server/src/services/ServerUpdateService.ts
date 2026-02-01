import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';
import fs from 'fs-extra';
import path from 'path';
import { hytaleDownloaderService } from './HytaleDownloaderService';
import { BackupService } from './BackupService';
import { ServerService } from './ServerService';
import { DiscordNotificationService } from './DiscordNotificationService';
import logger from '../utils/logger';

/**
 * Recursively find all files matching a pattern in a directory
 */
async function findFilesRecursive(dir: string, pattern: RegExp): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string, relativePath: string = ''): Promise<void> {
    if (!(await fs.pathExists(currentDir))) {
      return;
    }

    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

      if (entry.isDirectory()) {
        await walk(fullPath, relPath);
      } else if (entry.isFile() && pattern.test(entry.name)) {
        results.push(relPath.replace(/\\/g, '/'));
      }
    }
  }

  await walk(dir);
  return results;
}

// ==========================================
// Types
// ==========================================

export type UpdateStatus =
  | 'pending'
  | 'stopping'
  | 'backing_up'
  | 'preserving'
  | 'downloading'
  | 'installing'
  | 'restoring'
  | 'starting'
  | 'completed'
  | 'failed'
  | 'rolled_back';

export interface UpdateSession {
  sessionId: string;
  serverId: string;
  fromVersion: string;
  toVersion: string;
  status: UpdateStatus;
  progress: number;
  message?: string;
  error?: string;
  backupId?: string;
  startedAt: Date;
  wasRunning: boolean;
  downloadSessionId?: string;      // Track active download for cancellation
  tempPreservePath?: string;       // Track temp preserve directory for cleanup
}

export interface VersionCheckResult {
  serverId: string;
  serverName: string;
  currentVersion: string;
  availableVersion: string | null;
  updateAvailable: boolean;
  checkedAt: Date;
}

export interface PreservedPaths {
  configs: string[];      // .json files (relative paths)
  modsPath: string;       // /Server/mods
  universePath: string;   // /Server/universe
  logsPath: string;       // /Server/logs
}

// ==========================================
// Service
// ==========================================

class ServerUpdateService extends EventEmitter {
  private prisma: PrismaClient;
  private sessions: Map<string, UpdateSession> = new Map();
  private backupService?: BackupService;
  private serverService?: ServerService;
  private discordService?: DiscordNotificationService;
  private autoCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.prisma = new PrismaClient();
  }

  /**
   * Initialize with dependencies
   */
  initialize(
    serverService: ServerService,
    backupService: BackupService,
    discordService?: DiscordNotificationService
  ): void {
    this.serverService = serverService;
    this.backupService = backupService;
    this.discordService = discordService;
    logger.info('[ServerUpdate] Service initialized');
  }

  // ==========================================
  // Version Checking
  // ==========================================

  /**
   * Check if an update is available for a specific server
   */
  async checkForUpdate(serverId: string): Promise<VersionCheckResult> {
    const server = await this.prisma.server.findUnique({
      where: { id: serverId },
    });

    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    // Get latest version from Hytale downloader
    let latestVersion = null;
    try {
      latestVersion = await hytaleDownloaderService.getGameVersion();
    } catch (err: any) {
      logger.warn(`[ServerUpdate] Could not get latest version: ${err.message}`);
    }

    const result: VersionCheckResult = {
      serverId: server.id,
      serverName: server.name,
      currentVersion: server.version,
      availableVersion: latestVersion?.version || null,
      updateAvailable: false,
      checkedAt: new Date(),
    };

    // Compare versions
    if (latestVersion?.version && latestVersion.version !== server.version) {
      result.updateAvailable = true;
    }

    // Update server record with check results
    await this.prisma.server.update({
      where: { id: serverId },
      data: {
        availableVersion: latestVersion?.version || null,
        lastVersionCheck: new Date(),
      },
    });

    logger.info(`[ServerUpdate] Version check for ${server.name}: current=${server.version}, available=${latestVersion?.version}, updateAvailable=${result.updateAvailable}`);

    return result;
  }

  /**
   * Check all servers for available updates
   */
  async checkAllServersForUpdates(): Promise<VersionCheckResult[]> {
    const servers = await this.prisma.server.findMany();
    const results: VersionCheckResult[] = [];

    // Get latest version once (same for all servers)
    let latestVersion = null;
    try {
      latestVersion = await hytaleDownloaderService.getGameVersion();
    } catch (err: any) {
      logger.warn(`[ServerUpdate] Could not get latest version: ${err.message}`);
    }

    for (const server of servers) {
      const result: VersionCheckResult = {
        serverId: server.id,
        serverName: server.name,
        currentVersion: server.version,
        availableVersion: latestVersion?.version || null,
        updateAvailable: false,
        checkedAt: new Date(),
      };

      if (latestVersion?.version && latestVersion.version !== server.version) {
        result.updateAvailable = true;
      }

      // Update server record
      await this.prisma.server.update({
        where: { id: server.id },
        data: {
          availableVersion: latestVersion?.version || null,
          lastVersionCheck: new Date(),
        },
      });

      results.push(result);
    }

    return results;
  }

  // ==========================================
  // Update Process
  // ==========================================

  /**
   * Start the update process for a server
   */
  async startUpdate(serverId: string, targetVersion?: string): Promise<UpdateSession> {
    const server = await this.prisma.server.findUnique({
      where: { id: serverId },
    });

    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    if (server.updateInProgress) {
      throw new Error(`Server ${server.name} is already being updated`);
    }

    // Get target version (either specified or latest available)
    let toVersion = targetVersion;
    if (!toVersion) {
      try {
        const latestVersion = await hytaleDownloaderService.getGameVersion();
        if (!latestVersion?.version) {
          throw new Error('Could not determine latest version. Please ensure the Hytale downloader is authenticated.');
        }
        toVersion = latestVersion.version;
      } catch (err: any) {
        throw new Error(`Could not determine latest version: ${err.message}`);
      }
    }

    if (toVersion === server.version) {
      throw new Error(`Server is already at version ${toVersion}`);
    }

    // Create session
    const sessionId = `update-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const session: UpdateSession = {
      sessionId,
      serverId: server.id,
      fromVersion: server.version,
      toVersion,
      status: 'pending',
      progress: 0,
      startedAt: new Date(),
      wasRunning: server.status === 'running',
    };

    this.sessions.set(sessionId, session);

    // Mark server as updating
    await this.prisma.server.update({
      where: { id: serverId },
      data: { updateInProgress: true },
    });

    // Create update history record
    const updateHistory = await this.prisma.serverUpdateHistory.create({
      data: {
        serverId,
        fromVersion: server.version,
        toVersion,
        status: 'pending',
      },
    });

    // Emit started event
    this.emit('update:started', {
      sessionId,
      serverId,
      serverName: server.name,
      fromVersion: server.version,
      toVersion,
    });

    // Send Discord notification
    if (this.discordService) {
      await this.discordService.notify('server_update_started', {
        serverName: server.name,
        details: {
          fromVersion: server.version,
          toVersion,
        },
      });
    }

    logger.info(`[ServerUpdate] Starting update for ${server.name}: ${server.version} -> ${toVersion}`);

    // Execute update pipeline (non-blocking)
    this.executeUpdatePipeline(session, updateHistory.id).catch((error) => {
      logger.error(`[ServerUpdate] Update failed for ${server.name}:`, error);
    });

    return session;
  }

  /**
   * Execute the update pipeline
   */
  private async executeUpdatePipeline(session: UpdateSession, historyId: string): Promise<void> {
    const server = await this.prisma.server.findUnique({
      where: { id: session.serverId },
    });

    if (!server) {
      throw new Error('Server not found');
    }

    let tempPreservePath: string | null = null;

    try {
      // Step 1: Stop server if running
      if (session.wasRunning) {
        await this.updateSessionStatus(session, 'stopping', 5, 'Stopping server...');
        await this.updateHistoryStatus(historyId, 'stopping');

        if (this.serverService) {
          await this.serverService.stopServer(session.serverId);
          // Wait a moment for the server to fully stop
          await this.sleep(2000);
        }
      }

      // Step 2: Create full backup
      await this.updateSessionStatus(session, 'backing_up', 15, 'Creating backup...');
      await this.updateHistoryStatus(historyId, 'backing_up');

      if (this.backupService) {
        const backup = await this.backupService.createBackup(
          session.serverId,
          `Pre-update backup (${session.fromVersion} -> ${session.toVersion})`
        );
        session.backupId = backup.id;

        // Store backup reference for rollback
        await this.prisma.server.update({
          where: { id: session.serverId },
          data: { preUpdateBackupId: backup.id },
        });

        await this.prisma.serverUpdateHistory.update({
          where: { id: historyId },
          data: { backupId: backup.id },
        });
      }

      // Step 3: Preserve user files
      await this.updateSessionStatus(session, 'preserving', 30, 'Preserving user files...');
      await this.updateHistoryStatus(historyId, 'preserving');

      const preserved = await this.identifyPreservedPaths(server.serverPath);
      tempPreservePath = await this.preserveFiles(server.serverPath, preserved);

      // Track temp preserve path for cleanup on cancellation
      session.tempPreservePath = tempPreservePath;
      this.sessions.set(session.sessionId, session);

      // Step 4: Download new version
      await this.updateSessionStatus(session, 'downloading', 45, 'Downloading new version...');
      await this.updateHistoryStatus(historyId, 'downloading');

      // Clear the Server folder contents before downloading
      const serverDir = path.join(server.serverPath, 'Server');
      if (await fs.pathExists(serverDir)) {
        // Remove everything in Server folder except our preserved temp folder
        const items = await fs.readdir(serverDir);
        for (const item of items) {
          const itemPath = path.join(serverDir, item);
          await this.removeWithRetry(itemPath);
        }
      }

      // Download new server files
      const downloadSession = await hytaleDownloaderService.startDownload({
        destinationPath: server.serverPath,
      });

      // Track download session for cancellation
      session.downloadSessionId = downloadSession.sessionId;
      this.sessions.set(session.sessionId, session);

      // Wait for download to complete
      await this.waitForDownload(downloadSession.sessionId, session);

      // Step 5: Install/verify new version
      await this.updateSessionStatus(session, 'installing', 70, 'Installing new version...');
      await this.updateHistoryStatus(historyId, 'installing');

      // Verify the download completed successfully
      const jarPath = path.join(server.serverPath, 'Server', 'HytaleServer.jar');
      if (!(await fs.pathExists(jarPath))) {
        throw new Error('Server files not properly installed - HytaleServer.jar not found');
      }

      // Step 6: Restore preserved files
      await this.updateSessionStatus(session, 'restoring', 80, 'Restoring user files...');
      await this.updateHistoryStatus(historyId, 'restoring');

      if (tempPreservePath) {
        await this.restorePreservedFiles(tempPreservePath, server.serverPath);
        tempPreservePath = null; // Mark as restored
      }

      // Step 7: Update database
      await this.prisma.server.update({
        where: { id: session.serverId },
        data: {
          version: session.toVersion,
          updateInProgress: false,
          availableVersion: null, // Clear since we're now at this version
        },
      });

      // Step 8: Restart server if it was running
      if (session.wasRunning) {
        await this.updateSessionStatus(session, 'starting', 90, 'Starting server...');
        await this.updateHistoryStatus(historyId, 'starting');

        if (this.serverService) {
          await this.serverService.startServer(session.serverId);
        }
      }

      // Complete!
      await this.updateSessionStatus(session, 'completed', 100, 'Update completed successfully');
      await this.updateHistoryStatus(historyId, 'completed');

      await this.prisma.serverUpdateHistory.update({
        where: { id: historyId },
        data: { completedAt: new Date() },
      });

      this.emit('update:completed', {
        sessionId: session.sessionId,
        serverId: session.serverId,
        fromVersion: session.fromVersion,
        toVersion: session.toVersion,
      });

      // Send Discord notification
      if (this.discordService) {
        await this.discordService.notify('server_update_completed', {
          serverName: server.name,
          details: {
            fromVersion: session.fromVersion,
            toVersion: session.toVersion,
          },
        });
      }

      logger.info(`[ServerUpdate] Update completed for ${server.name}: ${session.fromVersion} -> ${session.toVersion}`);

    } catch (error: any) {
      logger.error(`[ServerUpdate] Update failed:`, error);

      // Clean up temp preserve path if it exists
      if (tempPreservePath) {
        try {
          await fs.remove(tempPreservePath);
        } catch (cleanupError) {
          logger.warn('[ServerUpdate] Failed to cleanup temp preserve path:', cleanupError);
        }
      }

      // Update session and history with failure
      session.status = 'failed';
      session.error = error.message;
      this.sessions.set(session.sessionId, session);

      await this.updateHistoryStatus(historyId, 'failed', error.message);

      // Mark server as no longer updating
      await this.prisma.server.update({
        where: { id: session.serverId },
        data: { updateInProgress: false },
      });

      this.emit('update:failed', {
        sessionId: session.sessionId,
        serverId: session.serverId,
        error: error.message,
      });

      // Send Discord notification
      if (this.discordService) {
        await this.discordService.notify('server_update_failed', {
          serverName: server.name,
          details: {
            fromVersion: session.fromVersion,
            toVersion: session.toVersion,
            error: error.message,
          },
        });
      }
    }
  }

  /**
   * Wait for download to complete
   */
  private async waitForDownload(downloadSessionId: string, updateSession: UpdateSession): Promise<void> {
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        // Check if update was cancelled
        const currentSession = this.sessions.get(updateSession.sessionId);
        if (currentSession?.status === 'failed') {
          clearInterval(checkInterval);
          reject(new Error('Update cancelled'));
          return;
        }

        const downloadSession = hytaleDownloaderService.getDownloadSession(downloadSessionId);

        if (!downloadSession) {
          clearInterval(checkInterval);
          reject(new Error('Download session not found'));
          return;
        }

        // Update progress
        const downloadProgress = downloadSession.progress;
        const overallProgress = 45 + (downloadProgress * 0.25); // 45-70% range
        updateSession.progress = Math.round(overallProgress);
        updateSession.message = `Downloading: ${downloadProgress}%`;
        this.sessions.set(updateSession.sessionId, updateSession);

        this.emit('update:progress', {
          sessionId: updateSession.sessionId,
          serverId: updateSession.serverId,
          status: updateSession.status,
          progress: updateSession.progress,
          message: updateSession.message,
        });

        if (downloadSession.status === 'complete') {
          clearInterval(checkInterval);
          resolve();
        } else if (downloadSession.status === 'failed') {
          clearInterval(checkInterval);
          reject(new Error(downloadSession.error || 'Download failed'));
        }
      }, 1000);

      // Timeout after 30 minutes
      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error('Download timed out'));
      }, 30 * 60 * 1000);
    });
  }

  // ==========================================
  // File Preservation
  // ==========================================

  /**
   * Identify files and directories to preserve
   */
  private async identifyPreservedPaths(serverPath: string): Promise<PreservedPaths> {
    const serverDir = path.join(serverPath, 'Server');

    // Find all .json config files in the Server directory
    let configs: string[] = [];
    try {
      configs = await findFilesRecursive(serverDir, /\.json$/i);
    } catch (e) {
      logger.warn('[ServerUpdate] Failed to find config files:', e);
    }

    return {
      configs,
      modsPath: path.join(serverDir, 'mods'),
      universePath: path.join(serverDir, 'universe'),
      logsPath: path.join(serverDir, 'logs'),
    };
  }

  /**
   * Preserve user files to a temporary directory
   */
  private async preserveFiles(serverPath: string, preserved: PreservedPaths): Promise<string> {
    const tempPath = path.join(serverPath, '.update-preserve-' + Date.now());
    await fs.ensureDir(tempPath);

    const serverDir = path.join(serverPath, 'Server');

    // Copy config files
    for (const configFile of preserved.configs) {
      const srcPath = path.join(serverDir, configFile);
      const destPath = path.join(tempPath, 'configs', configFile);

      if (await fs.pathExists(srcPath)) {
        await fs.ensureDir(path.dirname(destPath));
        await fs.copy(srcPath, destPath);
        logger.debug(`[ServerUpdate] Preserved config: ${configFile}`);
      }
    }

    // Copy directories if they exist
    const dirsToPreserve = [
      { src: preserved.modsPath, dest: path.join(tempPath, 'mods'), name: 'mods' },
      { src: preserved.universePath, dest: path.join(tempPath, 'universe'), name: 'universe' },
      { src: preserved.logsPath, dest: path.join(tempPath, 'logs'), name: 'logs' },
    ];

    for (const dir of dirsToPreserve) {
      if (await fs.pathExists(dir.src)) {
        await fs.copy(dir.src, dir.dest);
        logger.debug(`[ServerUpdate] Preserved directory: ${dir.name}`);
      }
    }

    logger.info(`[ServerUpdate] Preserved files to: ${tempPath}`);
    return tempPath;
  }

  /**
   * Restore preserved files after update
   */
  private async restorePreservedFiles(tempPath: string, serverPath: string): Promise<void> {
    const serverDir = path.join(serverPath, 'Server');

    // Restore config files
    const configsDir = path.join(tempPath, 'configs');
    if (await fs.pathExists(configsDir)) {
      const configFiles = await findFilesRecursive(configsDir, /\.json$/i);
      for (const configFile of configFiles) {
        const srcPath = path.join(configsDir, configFile);
        const destPath = path.join(serverDir, configFile);
        await fs.ensureDir(path.dirname(destPath));
        await fs.copy(srcPath, destPath, { overwrite: true });
        logger.debug(`[ServerUpdate] Restored config: ${configFile}`);
      }
    }

    // Restore directories
    const dirsToRestore = [
      { src: path.join(tempPath, 'mods'), dest: path.join(serverDir, 'mods'), name: 'mods' },
      { src: path.join(tempPath, 'universe'), dest: path.join(serverDir, 'universe'), name: 'universe' },
      { src: path.join(tempPath, 'logs'), dest: path.join(serverDir, 'logs'), name: 'logs' },
    ];

    for (const dir of dirsToRestore) {
      if (await fs.pathExists(dir.src)) {
        await fs.copy(dir.src, dir.dest, { overwrite: true });
        logger.debug(`[ServerUpdate] Restored directory: ${dir.name}`);
      }
    }

    // Clean up temp directory
    await fs.remove(tempPath);
    logger.info(`[ServerUpdate] Restored preserved files and cleaned up temp directory`);
  }

  // ==========================================
  // Rollback
  // ==========================================

  /**
   * Rollback to pre-update state
   */
  async rollback(serverId: string): Promise<void> {
    const server = await this.prisma.server.findUnique({
      where: { id: serverId },
    });

    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    if (!server.preUpdateBackupId) {
      throw new Error('No pre-update backup available for rollback');
    }

    logger.info(`[ServerUpdate] Starting rollback for ${server.name}`);

    // Stop server if running
    const wasRunning = server.status === 'running';
    if (wasRunning && this.serverService) {
      await this.serverService.stopServer(serverId);
      await this.sleep(2000);
    }

    // Restore from backup
    if (this.backupService) {
      await this.backupService.restoreBackup(server.preUpdateBackupId);
    }

    // Find the update history to get the original version
    const updateHistory = await this.prisma.serverUpdateHistory.findFirst({
      where: {
        serverId,
        backupId: server.preUpdateBackupId,
      },
      orderBy: { startedAt: 'desc' },
    });

    if (updateHistory) {
      // Revert version in database
      await this.prisma.server.update({
        where: { id: serverId },
        data: {
          version: updateHistory.fromVersion,
          preUpdateBackupId: null,
        },
      });

      // Update history record
      await this.prisma.serverUpdateHistory.update({
        where: { id: updateHistory.id },
        data: { status: 'rolled_back' },
      });
    }

    // Restart server if it was running
    if (wasRunning && this.serverService) {
      await this.serverService.startServer(serverId);
    }

    this.emit('update:rollback-completed', { serverId });
    logger.info(`[ServerUpdate] Rollback completed for ${server.name}`);
  }

  // ==========================================
  // Session Management
  // ==========================================

  /**
   * Get update session by ID
   */
  getSession(sessionId: string): UpdateSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Cancel an in-progress update
   */
  async cancelUpdate(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Update session not found');
    }

    if (session.status === 'completed' || session.status === 'failed') {
      throw new Error('Cannot cancel a completed or failed update');
    }

    // Cancel active download if in progress
    if (session.downloadSessionId) {
      hytaleDownloaderService.cancelDownload(session.downloadSessionId);
    }

    // Clean up temp preserve directory if it exists
    if (session.tempPreservePath && await fs.pathExists(session.tempPreservePath)) {
      try {
        await fs.remove(session.tempPreservePath);
        logger.info(`[ServerUpdate] Cleaned up temp preserve path: ${session.tempPreservePath}`);
      } catch (err) {
        logger.warn(`[ServerUpdate] Failed to clean up temp preserve path: ${err}`);
      }
    }

    // Mark as failed
    session.status = 'failed';
    session.error = 'Update cancelled by user';
    this.sessions.set(sessionId, session);

    // Reset server update flag
    await this.prisma.server.update({
      where: { id: session.serverId },
      data: { updateInProgress: false },
    });

    this.emit('update:cancelled', { sessionId, serverId: session.serverId });
    logger.info(`[ServerUpdate] Update cancelled: ${sessionId}`);
  }

  /**
   * Get update history for a server
   */
  async getUpdateHistory(serverId: string, limit: number = 10): Promise<any[]> {
    return this.prisma.serverUpdateHistory.findMany({
      where: { serverId },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Force reset the update state for a server.
   * Used when an update gets stuck and the session is lost (e.g., after restart).
   */
  async forceResetUpdateState(serverId: string): Promise<void> {
    const server = await this.prisma.server.findUnique({
      where: { id: serverId },
    });

    if (!server) {
      throw new Error(`Server ${serverId} not found`);
    }

    // 1. Find and cancel any active session for this server
    for (const [sessionId, session] of this.sessions) {
      if (session.serverId === serverId) {
        if (session.downloadSessionId) {
          hytaleDownloaderService.cancelDownload(session.downloadSessionId);
        }
        if (session.tempPreservePath && await fs.pathExists(session.tempPreservePath)) {
          await fs.remove(session.tempPreservePath);
        }
        this.sessions.delete(sessionId);
      }
    }

    // 2. Clean up orphaned .update-preserve-* directories
    const serverDir = server.serverPath;
    try {
      const entries = await fs.readdir(serverDir);
      for (const entry of entries) {
        if (entry.startsWith('.update-preserve-')) {
          const preservePath = path.join(serverDir, entry);
          logger.info(`[ServerUpdate] Cleaning up orphaned preserve directory: ${preservePath}`);
          await fs.remove(preservePath);
        }
      }
    } catch (err) {
      logger.warn(`[ServerUpdate] Failed to clean preserve directories for ${server.name}:`, err);
    }

    // 3. Reset database flag
    await this.prisma.server.update({
      where: { id: serverId },
      data: { updateInProgress: false },
    });

    // 4. Mark any pending/in-progress update history as failed
    await this.prisma.serverUpdateHistory.updateMany({
      where: {
        serverId,
        status: { in: ['pending', 'stopping', 'backing_up', 'preserving', 'downloading', 'installing', 'restoring', 'starting'] },
      },
      data: {
        status: 'failed',
        error: 'Update forcefully reset by user',
        completedAt: new Date(),
      },
    });

    this.emit('update:reset', { serverId });
    logger.info(`[ServerUpdate] Force reset update state for server: ${server.name}`);
  }

  /**
   * Recover servers with stuck update states on startup.
   * Called during application initialization.
   */
  async recoverStuckUpdates(): Promise<void> {
    const stuckServers = await this.prisma.server.findMany({
      where: { updateInProgress: true },
    });

    if (stuckServers.length === 0) return;

    logger.warn(`[ServerUpdate] Found ${stuckServers.length} server(s) with stuck update state`);

    for (const server of stuckServers) {
      logger.warn(`[ServerUpdate] Recovering stuck update for server: ${server.name}`);

      // Clean up orphaned preserve directories
      try {
        const entries = await fs.readdir(server.serverPath);
        for (const entry of entries) {
          if (entry.startsWith('.update-preserve-')) {
            const preservePath = path.join(server.serverPath, entry);
            logger.info(`[ServerUpdate] Cleaning up orphaned preserve directory: ${preservePath}`);
            await fs.remove(preservePath);
          }
        }
      } catch (err) {
        logger.warn(`[ServerUpdate] Failed to clean preserve directories for ${server.name}:`, err);
      }

      // Reset database flag
      await this.prisma.server.update({
        where: { id: server.id },
        data: { updateInProgress: false },
      });

      // Mark pending history as failed
      await this.prisma.serverUpdateHistory.updateMany({
        where: {
          serverId: server.id,
          status: { notIn: ['completed', 'failed', 'rolled_back'] },
        },
        data: {
          status: 'failed',
          error: 'Update interrupted by server restart',
          completedAt: new Date(),
        },
      });
    }

    logger.info(`[ServerUpdate] Recovered ${stuckServers.length} stuck update(s)`);
  }

  // ==========================================
  // Auto-Check Feature
  // ==========================================

  /**
   * Start automatic version checking
   */
  startAutoCheck(intervalMinutes: number = 60): void {
    this.stopAutoCheck();

    const intervalMs = intervalMinutes * 60 * 1000;
    logger.info(`[ServerUpdate] Starting auto-check with interval: ${intervalMinutes} minutes`);

    this.autoCheckInterval = setInterval(async () => {
      try {
        const results = await this.checkAllServersForUpdates();
        const updatesAvailable = results.filter(r => r.updateAvailable);

        if (updatesAvailable.length > 0) {
          logger.info(`[ServerUpdate] Auto-check found ${updatesAvailable.length} server(s) with available updates`);

          // Create alerts for servers with available updates
          for (const result of updatesAvailable) {
            await this.prisma.alert.create({
              data: {
                serverId: result.serverId,
                type: 'version_update_available',
                severity: 'info',
                title: 'Update Available',
                message: `Version ${result.availableVersion} is available (current: ${result.currentVersion})`,
              },
            });
          }

          this.emit('updates:available', { servers: updatesAvailable });
        }
      } catch (error) {
        logger.error('[ServerUpdate] Auto-check failed:', error);
      }
    }, intervalMs);

    // Run immediately on start
    this.checkAllServersForUpdates().catch(e =>
      logger.error('[ServerUpdate] Initial auto-check failed:', e)
    );
  }

  /**
   * Stop automatic version checking
   */
  stopAutoCheck(): void {
    if (this.autoCheckInterval) {
      clearInterval(this.autoCheckInterval);
      this.autoCheckInterval = null;
      logger.info('[ServerUpdate] Auto-check stopped');
    }
  }

  // ==========================================
  // Helpers
  // ==========================================

  private async updateSessionStatus(
    session: UpdateSession,
    status: UpdateStatus,
    progress: number,
    message: string
  ): Promise<void> {
    session.status = status;
    session.progress = progress;
    session.message = message;
    this.sessions.set(session.sessionId, session);

    this.emit('update:progress', {
      sessionId: session.sessionId,
      serverId: session.serverId,
      status,
      progress,
      message,
    });
  }

  private async updateHistoryStatus(
    historyId: string,
    status: string,
    error?: string
  ): Promise<void> {
    await this.prisma.serverUpdateHistory.update({
      where: { id: historyId },
      data: {
        status,
        error: error || null,
      },
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Remove a file or directory with retry logic for locked files
   */
  private async removeWithRetry(targetPath: string, maxAttempts = 5, delayMs = 1000): Promise<void> {
    const LOCKED_FILE_ERRORS = ['ENOTEMPTY', 'EBUSY', 'EACCES', 'EPERM', 'ETXTBSY'];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await fs.remove(targetPath);
        return;
      } catch (error: any) {
        const isLockedError = LOCKED_FILE_ERRORS.includes(error.code);
        if (isLockedError && attempt < maxAttempts) {
          logger.debug(`[ServerUpdate] Retry ${attempt}/${maxAttempts} removing ${path.basename(targetPath)}, waiting ${delayMs}ms...`);
          await this.sleep(delayMs);
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * Cleanup on shutdown
   */
  cleanup(): void {
    this.stopAutoCheck();
    this.sessions.clear();
  }
}

export const serverUpdateService = new ServerUpdateService();
