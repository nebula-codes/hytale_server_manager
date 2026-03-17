import prisma from '../lib/prisma';
import fs from 'fs-extra';
import path from 'path';
import unzipper from 'unzipper';
import logger from '../utils/logger';


export interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modified: Date;
  extension?: string;
  isEditable: boolean;
}

export interface ExtractedFileInfo {
  fileName: string;
  size: number;
  extractedFiles: string[];
}

export class FileService {
  // Cache server paths to avoid repeated database queries
  private serverPathCache: Map<string, string> = new Map();

  // Track concurrent extractions per destination directory to prevent race conditions
  private extractionQueues: Map<string, Promise<void>> = new Map();
  private extractionLocks: Map<string, boolean> = new Map();

  /**
   * Get the absolute path for a server's directory from the database
   */
  private async getServerPath(serverId: string): Promise<string> {
    // Check cache first
    const cached = this.serverPathCache.get(serverId);
    if (cached) {
      return cached;
    }

    // Fetch from database
    const server = await prisma.server.findUnique({
      where: { id: serverId },
      select: { serverPath: true },
    });

    if (!server) {
      throw new Error(`Server not found: ${serverId}`);
    }

    const serverPath = path.resolve(server.serverPath);
    this.serverPathCache.set(serverId, serverPath);
    return serverPath;
  }

  /**
   * Clear cache for a server (call when server is updated/deleted)
   */
  clearCache(serverId?: string): void {
    if (serverId) {
      this.serverPathCache.delete(serverId);
    } else {
      this.serverPathCache.clear();
    }
  }

  /**
   * Acquire lock for extraction to a destination directory
   * Ensures only one extraction happens to the same directory at a time
   */
  private async acquireExtractionLock(destPath: string): Promise<void> {
    const resolvedPath = path.resolve(destPath);

    let waitCount = 0;
    while (this.extractionLocks.get(resolvedPath)) {
      waitCount++;
      const existingQueue = this.extractionQueues.get(resolvedPath);

      if (existingQueue) {
        logger.debug(`Extraction lock held for ${resolvedPath}, waiting for queue (attempt ${waitCount})`);
        try {
          await existingQueue;
        } catch (err) {
          logger.warn(`Queue promise rejected while waiting:`, err);
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    this.extractionLocks.set(resolvedPath, true);
    logger.debug(`Extraction lock acquired for ${resolvedPath}`);
  }

  /**
   * Release lock for extraction to a destination directory
   */
  private releaseExtractionLock(destPath: string): void {
    const resolvedPath = path.resolve(destPath);
    this.extractionLocks.delete(resolvedPath);
    logger.debug(`Extraction lock released for ${resolvedPath}`);
  }

  /**
   * Queue an extraction operation to prevent concurrent extractions to the same directory
   */
  private queueExtraction(destPath: string, operation: () => Promise<[string[], string]>): Promise<[string[], string]> {
    const resolvedPath = path.resolve(destPath);

    const currentTail = this.extractionQueues.get(resolvedPath) ?? Promise.resolve();

    const runOperation = async (): Promise<[string[], string]> => {
      await this.acquireExtractionLock(resolvedPath);
      try {
        const result = await operation();
        return result;
      } catch (err) {
        logger.error(`Extraction operation failed for ${resolvedPath}:`, err);
        throw err;
      } finally {
        this.releaseExtractionLock(resolvedPath);
      }
    };

    const chained = currentTail
      .catch(() => undefined)
      .then(() => runOperation());

    this.extractionQueues.set(
      resolvedPath,
      chained.then(
        () => {
          logger.debug(`Queue promise resolved for ${resolvedPath}`);
        },
        (err) => {
          logger.debug(`Queue promise rejected for ${resolvedPath}:`, err);
        }
      )
    );

    return chained;
  }

  /**
   * Validate that a path is within the server directory (security)
   */
  private async validatePath(serverId: string, filePath: string): Promise<string> {
    const serverPath = await this.getServerPath(serverId);
    const absolutePath = path.join(serverPath, filePath);
    const normalizedPath = path.normalize(absolutePath);

    const normalizedServerPath = path.normalize(serverPath);
    if (normalizedPath !== normalizedServerPath &&
        !normalizedPath.startsWith(normalizedServerPath + path.sep)) {
      throw new Error('Access denied: Path is outside server directory');
    }

    return normalizedPath;
  }

  /**
   * Check if a file is editable based on extension
   */
  private isEditableFile(filename: string): boolean {
    const editableExtensions = [
      '.txt', '.json', '.yml', '.yaml', '.properties', '.conf', '.cfg',
      '.ini', '.log', '.md', '.xml', '.js', '.ts', '.html', '.css',
      '.sh', '.bat', '.cmd', '.ps1', '.toml', '.env'
    ];

    const ext = path.extname(filename).toLowerCase();
    return editableExtensions.includes(ext);
  }

  /**
   * List files and directories in a path
   */
  async listFiles(serverId: string, dirPath: string = ''): Promise<FileInfo[]> {
    const absolutePath = await this.validatePath(serverId, dirPath);

    // Ensure directory exists
    if (!await fs.pathExists(absolutePath)) {
      await fs.ensureDir(absolutePath);
    }

    const items = await fs.readdir(absolutePath);
    const fileInfos: FileInfo[] = [];

    for (const item of items) {
      const itemPath = path.join(absolutePath, item);
      const stats = await fs.stat(itemPath);
      const relativePath = path.join(dirPath, item);

      fileInfos.push({
        name: item,
        path: relativePath,
        type: stats.isDirectory() ? 'directory' : 'file',
        size: stats.size,
        modified: stats.mtime,
        extension: stats.isFile() ? path.extname(item) : undefined,
        isEditable: stats.isFile() ? this.isEditableFile(item) : false,
      });
    }

    // Sort: directories first, then files alphabetically
    return fileInfos.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Read file contents
   */
  async readFile(serverId: string, filePath: string): Promise<string> {
    const absolutePath = await this.validatePath(serverId, filePath);

    if (!await fs.pathExists(absolutePath)) {
      throw new Error('File not found');
    }

    const stats = await fs.stat(absolutePath);
    if (stats.isDirectory()) {
      throw new Error('Cannot read directory as file');
    }

    // Check file size (limit to 10MB for editing)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (stats.size > maxSize) {
      throw new Error('File too large to edit (max 10MB)');
    }

    return await fs.readFile(absolutePath, 'utf-8');
  }

  /**
   * Write/update file contents
   */
  async writeFile(serverId: string, filePath: string, content: string): Promise<void> {
    const absolutePath = await this.validatePath(serverId, filePath);

    // Ensure parent directory exists
    await fs.ensureDir(path.dirname(absolutePath));

    await fs.writeFile(absolutePath, content, 'utf-8');
    logger.info(`File written: ${filePath} for server ${serverId}`);
  }

  /**
   * Create a new file
   */
  async createFile(serverId: string, filePath: string, content: string = ''): Promise<void> {
    const absolutePath = await this.validatePath(serverId, filePath);

    if (await fs.pathExists(absolutePath)) {
      throw new Error('File already exists');
    }

    await this.writeFile(serverId, filePath, content);
    logger.info(`File created: ${filePath} for server ${serverId}`);
  }

  /**
   * Create a new directory
   */
  async createDirectory(serverId: string, dirPath: string): Promise<void> {
    const absolutePath = await this.validatePath(serverId, dirPath);

    if (await fs.pathExists(absolutePath)) {
      throw new Error('Directory already exists');
    }

    await fs.ensureDir(absolutePath);
    logger.info(`Directory created: ${dirPath} for server ${serverId}`);
  }

  /**
   * Delete a file or directory
   */
  async delete(serverId: string, itemPath: string): Promise<void> {
    const absolutePath = await this.validatePath(serverId, itemPath);

    if (!await fs.pathExists(absolutePath)) {
      throw new Error('File or directory not found');
    }

    await fs.remove(absolutePath);
    logger.info(`Deleted: ${itemPath} for server ${serverId}`);
  }

  /**
   * Rename/move a file or directory
   */
  async rename(serverId: string, oldPath: string, newPath: string): Promise<void> {
    const oldAbsolutePath = await this.validatePath(serverId, oldPath);
    const newAbsolutePath = await this.validatePath(serverId, newPath);

    if (!await fs.pathExists(oldAbsolutePath)) {
      throw new Error('Source file or directory not found');
    }

    if (await fs.pathExists(newAbsolutePath)) {
      throw new Error('Destination already exists');
    }

    await fs.move(oldAbsolutePath, newAbsolutePath);
    logger.info(`Renamed: ${oldPath} to ${newPath} for server ${serverId}`);
  }

  /**
   * Get file or directory info
   */
  async getInfo(serverId: string, itemPath: string): Promise<FileInfo> {
    const absolutePath = await this.validatePath(serverId, itemPath);

    if (!await fs.pathExists(absolutePath)) {
      throw new Error('File or directory not found');
    }

    const stats = await fs.stat(absolutePath);
    const name = path.basename(itemPath);

    return {
      name,
      path: itemPath,
      type: stats.isDirectory() ? 'directory' : 'file',
      size: stats.size,
      modified: stats.mtime,
      extension: stats.isFile() ? path.extname(name) : undefined,
      isEditable: stats.isFile() ? this.isEditableFile(name) : false,
    };
  }

  /**
   * Upload a file
   */
  async uploadFile(serverId: string, filePath: string, buffer: Buffer): Promise<void> {
    const absolutePath = await this.validatePath(serverId, filePath);

    // Ensure parent directory exists
    await fs.ensureDir(path.dirname(absolutePath));

    await fs.writeFile(absolutePath, buffer);
    logger.info(`File uploaded: ${filePath} for server ${serverId}`);
  }

  /**
   * Download a file (get buffer)
   */
  async downloadFile(serverId: string, filePath: string): Promise<Buffer> {
    const absolutePath = await this.validatePath(serverId, filePath);

    if (!await fs.pathExists(absolutePath)) {
      throw new Error('File not found');
    }

    const stats = await fs.stat(absolutePath);
    if (stats.isDirectory()) {
      throw new Error('Cannot download directory as file');
    }

    return await fs.readFile(absolutePath);
  }

  /**
   * Search files by name pattern
   */
  async searchFiles(serverId: string, pattern: string, dirPath: string = ''): Promise<FileInfo[]> {
    const absolutePath = await this.validatePath(serverId, dirPath);
    const results: FileInfo[] = [];

    const searchRecursive = async (currentPath: string, relativePath: string) => {
      const items = await fs.readdir(currentPath);

      for (const item of items) {
        const itemPath = path.join(currentPath, item);
        const itemRelativePath = path.join(relativePath, item);
        const stats = await fs.stat(itemPath);

        // Check if name matches pattern (case-insensitive)
        if (item.toLowerCase().includes(pattern.toLowerCase())) {
          results.push({
            name: item,
            path: itemRelativePath,
            type: stats.isDirectory() ? 'directory' : 'file',
            size: stats.size,
            modified: stats.mtime,
            extension: stats.isFile() ? path.extname(item) : undefined,
            isEditable: stats.isFile() ? this.isEditableFile(item) : false,
          });
        }

        // Recurse into directories
        if (stats.isDirectory()) {
          await searchRecursive(itemPath, itemRelativePath);
        }
      }
    };

    await searchRecursive(absolutePath, dirPath);
    return results;
  }

  /**
   * Get disk usage for a server
   */
  async getDiskUsage(serverId: string): Promise<{ total: number; used: number }> {
    const serverPath = await this.getServerPath(serverId);

    const calculateSize = async (dirPath: string): Promise<number> => {
      let totalSize = 0;

      if (!await fs.pathExists(dirPath)) {
        return 0;
      }

      const items = await fs.readdir(dirPath);

      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stats = await fs.stat(itemPath);

        if (stats.isDirectory()) {
          totalSize += await calculateSize(itemPath);
        } else {
          totalSize += stats.size;
        }
      }

      return totalSize;
    };

    const used = await calculateSize(serverPath);

    return {
      total: 0, // Can be implemented with disk space check if needed
      used,
    };
  }

  /**
   * Extract a zip file using unzipper library with path traversal protection
   * Queues extraction to prevent concurrent extractions to the same directory
   * Returns tuple of [extractedFiles, tempDirPath] for cleanup tracking
   *
   * NOTE: Uses library-based extraction instead of native tools to prevent Zip Slip attacks
   * where malicious ZIP entries could write outside the destination directory.
   */
  private async extractZip(zipPath: string, destPath: string): Promise<[string[], string]> {
    return this.queueExtraction(destPath, async () => {
      return await this.extractZipWithLibrary(zipPath, destPath);
    });
  }



  /**
   * Generate a unique temporary directory name for extraction
   * Uses timestamp + random string to ensure uniqueness even with concurrent extractions
   */
  private generateUniqueTempDir(destPath: string): string {
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 11);
    const uniqueId = `${timestamp}-${randomId}`;
    return path.join(destPath, `.temp-extract-${uniqueId}`);
  }



  /**
   * Extract using unzipper library (fallback when native tools unavailable)
   * Extracts to a temporary directory first, then moves files after validation
   * Returns tuple of [extractedFiles, tempDirPath] for cleanup tracking
   */
  private extractZipWithLibrary(zipPath: string, destPath: string): Promise<[string[], string]> {
    return new Promise(async (resolve, reject) => {
      const tempDir = this.generateUniqueTempDir(destPath);
      const extractedFiles: string[] = [];
      const writePromises: Promise<void>[] = [];

      try {
        await fs.ensureDir(tempDir);
        logger.info(`Created temp directory for extraction: ${tempDir}`);

        const resolvedTempDir = path.resolve(tempDir);

        fs.createReadStream(zipPath)
          .pipe(unzipper.Parse())
          .on('entry', (entry) => {
            const fileName = entry.path;

            if (entry.type === 'Directory') {
              entry.autodrain();
              return;
            }

            const targetPath = path.resolve(tempDir, fileName);
            if (!targetPath.startsWith(resolvedTempDir + path.sep) && targetPath !== resolvedTempDir) {
              logger.warn(`Skipping dangerous path in ZIP: ${fileName}`);
              entry.autodrain();
              return;
            }

            const processEntryPromise = (async () => {
              if (!fileName.endsWith('/')) {
                extractedFiles.push(fileName);
              }

              const dir = path.dirname(targetPath);
              await fs.ensureDir(dir);

              const writePromise = new Promise<void>((resolveWrite, rejectWrite) => {
                const writeStream = fs.createWriteStream(targetPath);

                writeStream.on('finish', () => resolveWrite());
                writeStream.on('error', (err) => rejectWrite(err));
                entry.on('error', (err: unknown) => rejectWrite(err));

                entry.pipe(writeStream);
              });

              await writePromise;
            })();

            writePromises.push(processEntryPromise);
          })
          .on('close', async () => {
            const movedFiles: string[] = [];
            const resolvedDestPath = path.resolve(destPath);

            try {
              await Promise.all(writePromises);
              const uniqueExtractedFiles = Array.from(new Set(extractedFiles));

              for (const file of uniqueExtractedFiles) {
                const srcPath = path.resolve(tempDir, file);
                const destFilePath = path.resolve(destPath, file);

                if (!srcPath.startsWith(resolvedTempDir + path.sep) && srcPath !== resolvedTempDir) {
                  continue;
                }

                if (!destFilePath.startsWith(resolvedDestPath + path.sep) && destFilePath !== resolvedDestPath) {
                  continue;
                }

                if (!await fs.pathExists(srcPath)) {
                  continue;
                }

                await fs.ensureDir(path.dirname(destFilePath));
                await fs.move(srcPath, destFilePath, { overwrite: true });

                movedFiles.push(destFilePath);
              }

              await fs.remove(tempDir);
              resolve([uniqueExtractedFiles, tempDir]);
            } catch (err) {
              for (const movedFile of movedFiles) {
                try {
                  await fs.remove(movedFile);
                } catch (rollbackError) {
                  logger.warn(`Failed to roll back moved file ${movedFile}:`, rollbackError);
                }
              }

              try {
                await fs.remove(tempDir);
              } catch (cleanupError) {
                logger.warn(`Failed to clean up temp directory ${tempDir}:`, cleanupError);
              }
              reject(err);
            }
          })
          .on('error', async (err) => {
            try {
              await fs.remove(tempDir);
            } catch (cleanupError) {
              logger.warn(`Failed to clean up temp directory ${tempDir}:`, cleanupError);
            }
            reject(err);
          });
      } catch (error) {
        try {
          await fs.remove(tempDir);
        } catch (cleanupError) {
          logger.warn(`Failed to clean up temp directory ${tempDir}:`, cleanupError);
        }
        reject(error);
      }
    });
  }

  /**
   * Upload a file with optional ZIP extraction
   * Handles concurrent extractions safely with queuing mechanism
   */
  async uploadFileWithExtraction(
    serverId: string,
    filePath: string,
    buffer: Buffer,
    autoExtractZip: boolean = true
  ): Promise<ExtractedFileInfo> {
    const absolutePath = await this.validatePath(serverId, filePath);

    await fs.ensureDir(path.dirname(absolutePath));

    await fs.writeFile(absolutePath, buffer);
    logger.info(`File uploaded: ${filePath} for server ${serverId}`);

    const isZipFile = filePath.toLowerCase().endsWith('.zip');
    if (isZipFile && autoExtractZip) {
      const extractDir = path.dirname(absolutePath);

      try {
        const [extractedFiles] = await this.extractZip(absolutePath, extractDir);

        await fs.remove(absolutePath);
        logger.info(`ZIP extracted and deleted: ${filePath} for server ${serverId} (${extractedFiles.length} files extracted)`);

        return {
          fileName: path.basename(filePath),
          size: buffer.length,
          extractedFiles,
        };
      } catch (error) {
        const errorMessage = (error as Error).message || 'Unknown error';
        logger.error(`Failed to extract ZIP file ${filePath}: ${errorMessage}`, error);

        try {
          await fs.remove(absolutePath);
          logger.info(`Cleaned up failed ZIP file: ${absolutePath}`);
        } catch (zipRemoveError) {
          logger.warn(`Failed to remove ZIP file ${absolutePath}:`, zipRemoveError);
        }

        throw new Error(`Failed to extract ZIP file: ${errorMessage}`);
      }
    }

    return {
      fileName: path.basename(filePath),
      size: buffer.length,
      extractedFiles: [],
    };
  }
}
