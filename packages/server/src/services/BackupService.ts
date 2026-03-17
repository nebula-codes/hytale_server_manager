import prisma from '../lib/prisma';
import archiver from 'archiver';
import fs from 'fs-extra';
import * as fsNative from 'fs';
import path from 'path';
import micromatch from 'micromatch';
import yauzl from 'yauzl';
import { DiscordNotificationService } from './DiscordNotificationService';
import { FtpStorageService } from './FtpStorageService';
import config from '../config';
import logger from '../utils/logger';


// Error codes for locked/busy files
const LOCKED_FILE_ERRORS = ['EBUSY', 'EACCES', 'EPERM', 'ETXTBSY'];

interface BackupResult {
  fileSize: number;
  skippedFiles: string[];
  totalFiles: number;
  backedUpFiles: number;
}

export class BackupService {
  private backupsPath: string;
  private discordService?: DiscordNotificationService;
  private ftpService: FtpStorageService;

  constructor(discordService?: DiscordNotificationService) {
    this.discordService = discordService;
    this.ftpService = new FtpStorageService();
    // Store backups in configured backups directory
    this.backupsPath = config.backupsBasePath;
    fs.ensureDirSync(this.backupsPath);
  }

  /**
   * Get the backup directory path for a server
   */
  private getBackupDirectory(server: { id: string; name: string; backupPath: string | null; backupType: string }): string {
    // If server has a custom local backup path, use it
    if (server.backupPath && server.backupType === 'local') {
      return server.backupPath;
    }
    // Default to global backups path using server name
    const serverSlug = server.name.toLowerCase().replace(/\s+/g, '-');
    return path.join(this.backupsPath, serverSlug);
  }

  /**
   * Get the FTP remote path for a backup
   */
  private getFtpRemotePath(server: { id: string; backupPath: string | null; name: string }, backupName: string): string {
    // If server has a custom FTP path, use it
    if (server.backupPath) {
      const remotePath = server.backupPath.replace(/\\/g, '/');
      return remotePath.endsWith('/') ? `${remotePath}${backupName}` : `${remotePath}/${backupName}`;
    }
    // Default to /backups/server-name/
    const serverSlug = server.name.toLowerCase().replace(/\s+/g, '-');
    return `/backups/${serverSlug}/${backupName}`;
  }

  /**
   * Create a backup of a server
   * @param serverId - Server ID to backup
   * @param description - Optional description
   * @param automationRuleId - Optional automation rule ID for tracking and rotation
   * @param scheduledTaskId - Optional scheduled task ID for tracking and rotation
   * @param runInBackground - If true, returns immediately and runs backup in background
   */
  async createBackup(
    serverId: string,
    description?: string,
    automationRuleId?: string,
    scheduledTaskId?: string,
    runInBackground: boolean = false
  ): Promise<any> {
    const server = await prisma.server.findUnique({ where: { id: serverId } });
    if (!server) {
      throw new Error('Server not found');
    }

    const useFtp = server.backupType === 'ftp';

    // Check if FTP is enabled when using FTP backup type
    if (useFtp && !this.ftpService.isEnabled()) {
      throw new Error('FTP storage is not configured. Please configure FTP settings first.');
    }

    // Generate backup name with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `${server.name.toLowerCase().replace(/\s+/g, '-')}-${timestamp}.zip`;

    // Local path for creating the archive (temp location if using FTP)
    const localBackupPath = useFtp
      ? path.join(this.backupsPath, 'temp', serverId)
      : this.getBackupDirectory(server);
    await fs.ensureDir(localBackupPath);

    const localFilePath = path.join(localBackupPath, backupName);
    const remotePath = useFtp ? this.getFtpRemotePath(server, backupName) : null;

    // Create backup record first
    const backup = await prisma.backup.create({
      data: {
        serverId,
        name: backupName,
        description: description || `Backup created at ${new Date().toLocaleString()}`,
        filePath: useFtp ? remotePath! : localFilePath,
        fileSize: 0,
        status: 'creating',
        storageType: useFtp ? 'ftp' : 'local',
        remotePath: remotePath,
        automationRuleId: automationRuleId || null,
        scheduledTaskId: scheduledTaskId || null,
      },
      include: {
        server: true,
      },
    });

    // If running in background, start the backup process and return immediately
    if (runInBackground) {
      this.processBackup(backup, server, localFilePath, remotePath, useFtp, automationRuleId, scheduledTaskId)
        .catch(error => logger.error('Background backup failed:', error));
      return backup;
    }

    // Otherwise, wait for the backup to complete
    return this.processBackup(backup, server, localFilePath, remotePath, useFtp, automationRuleId, scheduledTaskId);
  }

  /**
   * Process the actual backup (archiving and uploading)
   */
  private async processBackup(
    backup: any,
    server: any,
    localFilePath: string,
    remotePath: string | null,
    useFtp: boolean,
    automationRuleId?: string,
    scheduledTaskId?: string
  ): Promise<any> {
    try {
      // Resolve server path to absolute path
      const absoluteServerPath = path.resolve(server.serverPath);

      // Get Assets.zip path from adapter config (for Hytale servers)
      let assetsZipPath: string | null = null;
      if (server.adapterConfig) {
        try {
          const adapterConfig = JSON.parse(server.adapterConfig);
          const assetsPath = adapterConfig.assetsPath || '../Assets.zip';
          // Resolve relative to server's JAR location (inside server directory)
          const jarFile = adapterConfig.jarFile || 'Server/HytaleServer.jar';
          const jarDir = path.dirname(path.join(absoluteServerPath, jarFile));
          assetsZipPath = path.resolve(jarDir, assetsPath);
        } catch (e) {
          logger.warn('Failed to parse adapterConfig for assets path:', e);
        }
      }

      // Parse server-specific exclusion patterns
      let excludePatterns: string[] = [];
      if (server.backupExclusions) {
        try {
          const rawPatterns = JSON.parse(server.backupExclusions);
          if (!Array.isArray(rawPatterns)) {
            logger.warn('Invalid backupExclusions format, expected array');
          } else {
            // Expand patterns: for simple wildcard patterns like *.log, also add **/*.log
            // This makes patterns more intuitive (*.log matches files in all subdirs too)
            for (const pattern of rawPatterns) {
              excludePatterns.push(pattern);
              // If pattern starts with * but not ** and doesn't contain path separators,
              // also add a recursive version
              if (pattern.startsWith('*') && !pattern.startsWith('**') && !pattern.includes('/')) {
                excludePatterns.push(`**/${pattern}`);
              }
            }
          }
        } catch (e) {
          logger.warn('Failed to parse backupExclusions:', e);
        }
      }

      if (excludePatterns.length > 0) {
        logger.info(`Using exclusion patterns: ${excludePatterns.join(', ')}`);
      }

      // Build additional files list (e.g., Assets.zip that may be outside server directory)
      const additionalFiles: { absolutePath: string; archiveName: string }[] = [];
      if (assetsZipPath && fs.existsSync(assetsZipPath)) {
        // Only add if it's outside the server directory (not already included)
        const normalizedAssetsPath = path.normalize(assetsZipPath);
        const normalizedServerPath = path.normalize(absoluteServerPath);
        if (!normalizedAssetsPath.startsWith(normalizedServerPath + path.sep)) {
          additionalFiles.push({
            absolutePath: assetsZipPath,
            archiveName: 'Assets.zip', // Store at root of archive
          });
          logger.info(`Including external Assets.zip in backup: ${assetsZipPath}`);
        }
      }

      // Create zip archive locally
      logger.info(`Creating backup archive: ${localFilePath}`);
      logger.info(`Source server path: ${absoluteServerPath}`);
      const result = await this.createZipArchive(absoluteServerPath, localFilePath, excludePatterns, additionalFiles);

      // If using FTP, upload and delete local file
      if (useFtp) {
        logger.info(`Uploading backup to FTP: ${remotePath}`);
        await this.ftpService.upload(localFilePath, remotePath!);

        // Delete local file after successful upload
        logger.info(`Deleting local temp file: ${localFilePath}`);
        await fs.remove(localFilePath);
      }

      // Build description with skipped files info
      let finalDescription = backup.description || `Backup created at ${new Date().toLocaleString()}`;
      if (result.skippedFiles.length > 0) {
        finalDescription += `\n\nSkipped ${result.skippedFiles.length} files (locked or excluded).`;
      }

      // Update backup record with completion
      const updatedBackup = await prisma.backup.update({
        where: { id: backup.id },
        data: {
          fileSize: result.fileSize,
          status: 'completed',
          completedAt: new Date(),
          description: finalDescription,
          totalFiles: result.totalFiles,
          backedUpFiles: result.backedUpFiles,
          skippedFiles: result.skippedFiles.length > 0 ? JSON.stringify(result.skippedFiles) : null,
        },
        include: {
          server: true,
        },
      });

      // Rotate old backups if this is an automation backup
      if (automationRuleId) {
        await this.rotateAutomationBackups(automationRuleId);
      }

      // Rotate old backups if this is a scheduled task backup
      if (scheduledTaskId) {
        await this.rotateScheduledTaskBackups(scheduledTaskId);
      }

      // Send Discord notification for successful backup
      if (this.discordService) {
        // Format details as a string for Discord embed
        let detailsText = `**Name:** ${backup.name}\n`;
        detailsText += `**Size:** ${(result.fileSize / 1024 / 1024).toFixed(2)} MB\n`;
        detailsText += `**Storage:** ${useFtp ? 'FTP' : 'Local'}\n`;
        detailsText += `**Files:** ${result.backedUpFiles}/${result.totalFiles}`;

        if (result.skippedFiles.length > 0) {
          detailsText += `\n**Skipped:** ${result.skippedFiles.length} files`;
        }

        await this.discordService.notify('backup_complete', {
          serverName: server.name,
          details: detailsText,
        });
      }

      return {
        ...updatedBackup,
        skippedFiles: result.skippedFiles,
        totalFiles: result.totalFiles,
        backedUpFiles: result.backedUpFiles,
      };
    } catch (error: any) {
      // Clean up local file on failure
      if (fs.existsSync(localFilePath)) {
        await fs.remove(localFilePath);
      }

      // Update backup record with error
      await prisma.backup.update({
        where: { id: backup.id },
        data: {
          status: 'failed',
          error: error.message,
        },
      });

      // Send Discord notification for failed backup
      if (this.discordService) {
        await this.discordService.notify('backup_failed', {
          serverName: server.name,
          reason: error.message,
        });
      }

      throw error;
    }
  }

  /**
   * Create a zip archive of a directory with retry logic for locked files
   */
  private async createZipArchive(
    sourcePath: string,
    outputPath: string,
    excludePatterns: string[] = [],
    additionalFiles?: { absolutePath: string; archiveName: string }[]
  ): Promise<BackupResult> {
    // Validate source directory exists
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source directory does not exist: ${sourcePath}`);
    }

    // Check if directory has any contents
    const contents = await fs.readdir(sourcePath);
    if (contents.length === 0) {
      throw new Error(`Source directory is empty: ${sourcePath}`);
    }

    logger.info(`Archiving directory: ${sourcePath} (${contents.length} items)`);
    logger.debug(`Directory contents: ${contents.join(', ')}`);
    if (excludePatterns.length > 0) {
      logger.info(`Exclusion patterns: ${excludePatterns.join(', ')}`);
    }

    const skippedFiles: string[] = [];
    let totalFiles = 0;
    let backedUpFiles = 0;

    // Get all files recursively
    const allFiles = await this.getFilesRecursively(sourcePath);
    totalFiles = allFiles.length;

    // Filter out excluded files based on server-specific patterns
    const filesToBackup: { absolutePath: string; relativePath: string }[] = [];

    for (const file of allFiles) {
      const relativePath = path.relative(sourcePath, file).replace(/\\/g, '/');

      // Check if file matches any exclusion pattern (only if patterns are defined)
      if (excludePatterns.length > 0 && micromatch.isMatch(relativePath, excludePatterns)) {
        logger.debug(`Excluding file (pattern match): ${relativePath}`);
        skippedFiles.push(`${relativePath} (excluded by pattern)`);
        continue;
      }

      filesToBackup.push({ absolutePath: file, relativePath });
    }

    logger.info(`Files to backup: ${filesToBackup.length} (${skippedFiles.length} excluded by pattern)`);

    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip', {
        zlib: { level: 9 }, // Maximum compression
      });

      output.on('close', () => {
        const fileSize = archive.pointer();
        logger.info(`Archive created: ${outputPath} (${fileSize} bytes)`);
        logger.info(`Backup complete: ${backedUpFiles}/${totalFiles} files (${skippedFiles.length} skipped)`);

        if (skippedFiles.length > 0) {
          logger.warn(`Skipped files: ${skippedFiles.join(', ')}`);
        }

        resolve({
          fileSize,
          skippedFiles,
          totalFiles,
          backedUpFiles,
        });
      });

      archive.on('error', (err: any) => {
        // Don't fail the entire backup for locked file errors
        // These should be handled by our retry logic, but just in case
        if (LOCKED_FILE_ERRORS.includes(err.code)) {
          logger.warn('Archive warning (locked file, continuing):', err.message);
        } else {
          logger.error('Archive error:', err);
          reject(err);
        }
      });

      archive.on('warning', (err) => {
        if (err.code === 'ENOENT') {
          logger.warn('Archive warning (file not found):', err);
        } else {
          logger.warn('Archive warning:', err);
        }
      });

      archive.pipe(output);

      // Add files with retry logic
      const addFilesSequentially = async () => {
        for (const { absolutePath, relativePath } of filesToBackup) {
          const added = await this.addFileToArchiveWithRetry(archive, absolutePath, relativePath);
          if (added) {
            backedUpFiles++;
          } else {
            skippedFiles.push(`${relativePath} (locked/inaccessible)`);
          }
        }

        // Add additional files (like Assets.zip) if provided
        if (additionalFiles) {
          for (const file of additionalFiles) {
            if (fs.existsSync(file.absolutePath)) {
              const added = await this.addFileToArchiveWithRetry(archive, file.absolutePath, file.archiveName);
              if (added) {
                backedUpFiles++;
                totalFiles++;
                logger.info(`Added additional file to backup: ${file.archiveName}`);
              } else {
                skippedFiles.push(`${file.archiveName} (locked/inaccessible)`);
                totalFiles++;
              }
            }
          }
        }

        archive.finalize();
      };

      addFilesSequentially().catch(reject);
    });
  }

  /**
   * Recursively get all files in a directory
   */
  private async getFilesRecursively(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await this.getFilesRecursively(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Add a file to the archive with retry logic for locked files
   * Always uses streaming to avoid Node.js 2GB buffer limit
   */
  private async addFileToArchiveWithRetry(
    archive: archiver.Archiver,
    absolutePath: string,
    relativePath: string
  ): Promise<boolean> {
    const { retryAttempts, retryDelayMs } = config.backup;

    for (let attempt = 1; attempt <= retryAttempts; attempt++) {
      try {
        // Get file metadata first
        const fileStat = await fs.stat(absolutePath);

        // Test file accessibility
        await fs.access(absolutePath, fs.constants.R_OK);

        // Always use streaming - avoids Node.js 2GB buffer limit entirely
        const readStream = fsNative.createReadStream(absolutePath);

        archive.append(readStream, {
          name: relativePath,
          date: fileStat.mtime,
          mode: fileStat.mode,
        });

        return true;
      } catch (error: any) {
        const isLockedFile = LOCKED_FILE_ERRORS.includes(error.code);

        if (isLockedFile && attempt < retryAttempts) {
          logger.debug(
            `File locked (${error.code}), retrying in ${retryDelayMs}ms (attempt ${attempt}/${retryAttempts}): ${relativePath}`
          );
          await this.sleep(retryDelayMs);
        } else if (isLockedFile) {
          logger.warn(
            `Skipping locked file after ${retryAttempts} attempts: ${relativePath} (${error.code})`
          );
          return false;
        } else if (error.code === 'ENOENT') {
          logger.warn(`File no longer exists, skipping: ${relativePath}`);
          return false;
        } else {
          logger.error(`Error accessing file ${relativePath}:`, error);
          return false;
        }
      }
    }

    return false;
  }

  /**
   * Sleep for a specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Restore a server from a backup
   */
  async restoreBackup(backupId: string): Promise<void> {
    const backup = await prisma.backup.findUnique({
      where: { id: backupId },
      include: { server: true },
    });

    if (!backup) {
      throw new Error('Backup not found');
    }

    const isFtpBackup = backup.storageType === 'ftp';
    let localArchivePath = backup.filePath;
    let tempDownloadPath: string | null = null;

    // If FTP backup, download to temp location first
    if (isFtpBackup) {
      if (!backup.remotePath) {
        throw new Error('FTP backup missing remote path');
      }
      if (!this.ftpService.isEnabled()) {
        throw new Error('FTP storage is not configured');
      }

      // Check if file exists on FTP
      const exists = await this.ftpService.exists(backup.remotePath);
      if (!exists) {
        throw new Error('Backup file not found on FTP server');
      }

      // Download to temp location
      tempDownloadPath = path.join(this.backupsPath, 'temp', `restore-${backup.id}-${Date.now()}.zip`);
      await fs.ensureDir(path.dirname(tempDownloadPath));
      logger.info(`Downloading backup from FTP: ${backup.remotePath}`);
      await this.ftpService.download(backup.remotePath, tempDownloadPath);
      localArchivePath = tempDownloadPath;
    } else {
      // Check local file exists
      if (!fs.existsSync(backup.filePath)) {
        throw new Error('Backup file not found on disk');
      }
    }

    // Update backup status
    await prisma.backup.update({
      where: { id: backupId },
      data: { status: 'restoring' },
    });

    try {
      const server = backup.server;

      // Resolve server path to absolute path
      const absoluteServerPath = path.resolve(server.serverPath);

      // Backup current server data before restoring
      const tempBackupPath = `${absoluteServerPath}.temp-backup-${Date.now()}`;
      if (fs.existsSync(absoluteServerPath)) {
        await fs.move(absoluteServerPath, tempBackupPath);
      }

      // Ensure server directory exists
      await fs.ensureDir(absoluteServerPath);

      // Extract backup
      logger.info(`Extracting backup to: ${absoluteServerPath}`);
      await this.extractZipArchive(localArchivePath, absoluteServerPath);

      // Remove temporary backup of old server data
      if (fs.existsSync(tempBackupPath)) {
        await fs.remove(tempBackupPath);
      }

      // Clean up temp download file
      if (tempDownloadPath && fs.existsSync(tempDownloadPath)) {
        await fs.remove(tempDownloadPath);
      }

      // Update backup status
      await prisma.backup.update({
        where: { id: backupId },
        data: { status: 'completed' },
      });
    } catch (error: any) {
      // Clean up temp download file on failure
      if (tempDownloadPath && fs.existsSync(tempDownloadPath)) {
        await fs.remove(tempDownloadPath);
      }

      // Update backup status with error
      await prisma.backup.update({
        where: { id: backupId },
        data: {
          status: 'failed',
          error: `Restore failed: ${error.message}`,
        },
      });

      throw error;
    }
  }

  /**
   * Extract a zip archive using yauzl (handles files of any size)
   * Cross-platform: works on Windows, Linux, and Docker
   */
  private async extractZipArchive(archivePath: string, destinationPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      yauzl.open(archivePath, { lazyEntries: true }, (err, zipfile) => {
        if (err || !zipfile) {
          reject(err || new Error('Failed to open zip file'));
          return;
        }

        let pending = 0;
        let finished = false;

        const checkDone = () => {
          if (finished && pending === 0) {
            resolve();
          }
        };

        zipfile.on('entry', (entry: yauzl.Entry) => {
          const entryPath = path.join(destinationPath, entry.fileName);

          // Handle directory entries
          if (entry.fileName.endsWith('/')) {
            fs.ensureDir(entryPath)
              .then(() => zipfile.readEntry())
              .catch(reject);
            return;
          }

          // Handle file entries
          pending++;
          fs.ensureDir(path.dirname(entryPath))
            .then(() => {
              zipfile.openReadStream(entry, (streamErr, readStream) => {
                if (streamErr || !readStream) {
                  reject(streamErr || new Error('Failed to open read stream'));
                  return;
                }

                const writeStream = fsNative.createWriteStream(entryPath);
                readStream.pipe(writeStream);

                writeStream.on('close', () => {
                  pending--;
                  checkDone();
                });

                writeStream.on('error', reject);
                readStream.on('error', reject);

                // Continue to next entry
                zipfile.readEntry();
              });
            })
            .catch(reject);
        });

        zipfile.on('end', () => {
          finished = true;
          checkDone();
        });

        zipfile.on('error', reject);

        // Start reading entries
        zipfile.readEntry();
      });
    });
  }

  /**
   * Delete a backup
   */
  async deleteBackup(backupId: string): Promise<void> {
    const backup = await prisma.backup.findUnique({ where: { id: backupId } });

    if (!backup) {
      throw new Error('Backup not found');
    }

    // Delete file based on storage type
    if (backup.storageType === 'ftp' && backup.remotePath) {
      // Delete from FTP
      if (this.ftpService.isEnabled()) {
        try {
          await this.ftpService.delete(backup.remotePath);
        } catch (error: any) {
          logger.warn(`Failed to delete FTP file: ${error.message}`);
          // Continue with database deletion even if FTP deletion fails
        }
      }
    } else {
      // Delete local file
      if (fs.existsSync(backup.filePath)) {
        await fs.remove(backup.filePath);
      }
    }

    // Delete backup record from database
    await prisma.backup.delete({ where: { id: backupId } });
  }

  /**
   * List all backups for a server
   */
  async listBackups(serverId: string): Promise<any[]> {
    const backups = await prisma.backup.findMany({
      where: { serverId },
      orderBy: { createdAt: 'desc' },
      include: {
        server: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return backups;
  }

  /**
   * Get a single backup by ID
   */
  async getBackup(backupId: string): Promise<any> {
    const backup = await prisma.backup.findUnique({
      where: { id: backupId },
      include: {
        server: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!backup) {
      throw new Error('Backup not found');
    }

    return backup;
  }

  /**
   * Get backup statistics for a server
   */
  async getBackupStats(serverId: string): Promise<any> {
    const backups = await prisma.backup.findMany({
      where: { serverId },
    });

    const totalBackups = backups.length;
    // Handle BigInt fileSize - convert to Number for arithmetic (safe for files up to ~9 petabytes)
    const totalSize = backups.reduce((sum, b) => sum + Number(b.fileSize), 0);
    const completedBackups = backups.filter((b) => b.status === 'completed').length;
    const failedBackups = backups.filter((b) => b.status === 'failed').length;

    return {
      totalBackups,
      totalSize,
      completedBackups,
      failedBackups,
      averageSize: totalBackups > 0 ? totalSize / totalBackups : 0,
    };
  }

  /**
   * Rotate backups for an automation rule - delete oldest backups beyond the limit
   * @param automationRuleId - The automation rule ID
   */
  async rotateAutomationBackups(automationRuleId: string): Promise<{ deleted: number; remaining: number }> {
    // Get the automation rule to check the backup limit
    const automationRule = await prisma.automationRule.findUnique({
      where: { id: automationRuleId },
    });

    if (!automationRule) {
      logger.warn(`Automation rule not found for backup rotation: ${automationRuleId}`);
      return { deleted: 0, remaining: 0 };
    }

    const backupLimit = automationRule.backupLimit;

    // If limit is 0, no rotation (unlimited backups)
    if (backupLimit === 0) {
      logger.debug(`Backup limit is 0 (unlimited) for automation: ${automationRule.name}`);
      return { deleted: 0, remaining: 0 };
    }

    // Get all completed backups for this automation, ordered by creation date (newest first)
    const backups = await prisma.backup.findMany({
      where: {
        automationRuleId,
        status: 'completed',
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalBackups = backups.length;

    // If we haven't exceeded the limit, nothing to delete
    if (totalBackups <= backupLimit) {
      logger.debug(
        `Backup count (${totalBackups}) within limit (${backupLimit}) for automation: ${automationRule.name}`
      );
      return { deleted: 0, remaining: totalBackups };
    }

    // Get backups to delete (everything beyond the limit)
    const backupsToDelete = backups.slice(backupLimit);
    let deletedCount = 0;

    for (const backup of backupsToDelete) {
      try {
        logger.info(`Rotating out old backup: ${backup.name} (automation: ${automationRule.name})`);
        await this.deleteBackup(backup.id);
        deletedCount++;
      } catch (error: any) {
        logger.error(`Failed to delete backup during rotation: ${backup.name}`, error);
        // Continue with other backups even if one fails
      }
    }

    logger.info(
      `Backup rotation complete for automation "${automationRule.name}": deleted ${deletedCount}, remaining ${backupLimit}`
    );

    return { deleted: deletedCount, remaining: backupLimit };
  }

  /**
   * Rotate backups for a scheduled task - delete oldest backups beyond the limit
   * @param scheduledTaskId - The scheduled task ID
   */
  async rotateScheduledTaskBackups(scheduledTaskId: string): Promise<{ deleted: number; remaining: number }> {
    // Get the scheduled task to check the backup limit
    const scheduledTask = await prisma.scheduledTask.findUnique({
      where: { id: scheduledTaskId },
    });

    if (!scheduledTask) {
      logger.warn(`Scheduled task not found for backup rotation: ${scheduledTaskId}`);
      return { deleted: 0, remaining: 0 };
    }

    const backupLimit = scheduledTask.backupLimit;

    // If limit is 0, no rotation (unlimited backups)
    if (backupLimit === 0) {
      logger.debug(`Backup limit is 0 (unlimited) for scheduled task: ${scheduledTask.name}`);
      return { deleted: 0, remaining: 0 };
    }

    // Get all completed backups for this scheduled task, ordered by creation date (newest first)
    const backups = await prisma.backup.findMany({
      where: {
        scheduledTaskId,
        status: 'completed',
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalBackups = backups.length;

    // If we haven't exceeded the limit, nothing to delete
    if (totalBackups <= backupLimit) {
      logger.debug(
        `Backup count (${totalBackups}) within limit (${backupLimit}) for scheduled task: ${scheduledTask.name}`
      );
      return { deleted: 0, remaining: totalBackups };
    }

    // Get backups to delete (everything beyond the limit)
    const backupsToDelete = backups.slice(backupLimit);
    let deletedCount = 0;

    for (const backup of backupsToDelete) {
      try {
        logger.info(`Rotating out old backup: ${backup.name} (scheduled task: ${scheduledTask.name})`);
        await this.deleteBackup(backup.id);
        deletedCount++;
      } catch (error: any) {
        logger.error(`Failed to delete backup during rotation: ${backup.name}`, error);
        // Continue with other backups even if one fails
      }
    }

    logger.info(
      `Backup rotation complete for scheduled task "${scheduledTask.name}": deleted ${deletedCount}, remaining ${backupLimit}`
    );

    return { deleted: deletedCount, remaining: backupLimit };
  }

  /**
   * Delete multiple backups by IDs
   */
  async deleteBackups(backupIds: string[]): Promise<{ deleted: number; failed: number; errors: string[] }> {
    let deleted = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const backupId of backupIds) {
      try {
        await this.deleteBackup(backupId);
        deleted++;
      } catch (error: any) {
        failed++;
        errors.push(`${backupId}: ${error.message}`);
        logger.error(`Failed to delete backup ${backupId}:`, error);
      }
    }

    return { deleted, failed, errors };
  }
}
