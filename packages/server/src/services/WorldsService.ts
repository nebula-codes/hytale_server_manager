import prisma from '../lib/prisma';
import fs from 'fs-extra';
import path from 'path';
import archiver from 'archiver';
import unzipper from 'unzipper';
import logger from '../utils/logger';


/**
 * Hytale World Config.json structure
 */
export interface HytaleWorldConfig {
  // Read-only fields
  Version?: number;
  UUID?: { $binary: string; $type: string };
  Seed?: number;
  WorldGen?: { Type?: string; Name?: string };
  GameplayConfig?: string;

  // Gameplay settings
  IsPvpEnabled?: boolean;
  IsFallDamageEnabled?: boolean;
  IsSpawningNPC?: boolean;
  IsAllNPCFrozen?: boolean;
  IsSpawnMarkersEnabled?: boolean;
  IsObjectiveMarkersEnabled?: boolean;
  IsCompassUpdating?: boolean;

  // Time & Effects
  IsGameTimePaused?: boolean;
  GameTime?: string;
  ClientEffects?: {
    SunHeightPercent?: number;
    SunAngleDegrees?: number;
    SunIntensity?: number;
    BloomIntensity?: number;
    BloomPower?: number;
    SunshaftIntensity?: number;
    SunshaftScaleFactor?: number;
    [key: string]: unknown;
  };

  // World Management
  IsTicking?: boolean;
  IsBlockTicking?: boolean;
  IsSavingPlayers?: boolean;
  IsSavingChunks?: boolean;
  SaveNewChunks?: boolean;
  IsUnloadingChunks?: boolean;
  DeleteOnUniverseStart?: boolean;
  DeleteOnRemove?: boolean;

  // Allow any other fields
  [key: string]: unknown;
}

/** Fields that cannot be edited (immutable) */
const IMMUTABLE_FIELDS = ['Version', 'UUID', 'Seed', 'WorldGen', 'GameplayConfig', 'WorldMap', 'ChunkStorage', 'ChunkConfig', 'ResourceStorage', 'Plugin', 'RequiredPlugins'];

/**
 * Note: All fields not in IMMUTABLE_FIELDS are editable.
 * This allows custom fields from the JSON editor to be saved.
 * Known editable fields include: IsPvpEnabled, IsFallDamageEnabled, IsSpawningNPC,
 * IsAllNPCFrozen, IsSpawnMarkersEnabled, IsObjectiveMarkersEnabled, IsCompassUpdating,
 * IsGameTimePaused, GameTime, ClientEffects, IsTicking, IsBlockTicking, IsSavingPlayers,
 * IsSavingChunks, SaveNewChunks, IsUnloadingChunks, DeleteOnUniverseStart, DeleteOnRemove.
 */

export interface WorldInfo {
  id: string;
  serverId: string;
  name: string;
  folderPath: string;
  sizeBytes: number;
  isActive: boolean;
  description?: string;
  createdAt: Date;
  lastPlayed?: Date;
}

export class WorldsService {
  /**
   * List all worlds for a server
   */
  async listWorlds(serverId: string): Promise<WorldInfo[]> {
    const server = await prisma.server.findUnique({
      where: { id: serverId },
    });

    if (!server) {
      throw new Error('Server not found');
    }

    const serverPath = server.serverPath;
    const worldsInDB = await prisma.world.findMany({
      where: { serverId },
    });

    // Scan for worlds in multiple locations for Hytale compatibility
    let worldsInFS: Array<{ name: string; path: string; size: number }> = [];

    // Determine possible root directories (serverPath itself, or Server subdirectory)
    const possibleRoots: string[] = [serverPath];
    const serverSubdir = path.join(serverPath, 'Server');
    if (await fs.pathExists(serverSubdir)) {
      possibleRoots.push(serverSubdir);
    }

    for (const rootPath of possibleRoots) {
      // 1. Check for universe folder (Hytale structure: universe/worlds/)
      const universeDir = path.join(rootPath, 'universe');
      const universeWorldsDir = path.join(universeDir, 'worlds');
      if (await fs.pathExists(universeWorldsDir)) {
        const universeWorlds = await this.scanWorldFolders(universeWorldsDir);
        worldsInFS.push(...universeWorlds);
      }

      // 2. Also check for universes (plural) folder structure
      const universesDir = path.join(rootPath, 'universes');
      if (await fs.pathExists(universesDir)) {
        const universes = await fs.readdir(universesDir);
        for (const universe of universes) {
          const uWorldsDir = path.join(universesDir, universe, 'worlds');
          if (await fs.pathExists(uWorldsDir)) {
            const uWorlds = await this.scanWorldFolders(uWorldsDir);
            worldsInFS.push(...uWorlds);
          }
        }
      }
    }

    // 3. Check if worldPath points to a universe folder with worlds subdirectory
    if (server.worldPath) {
      const worldsDir = path.join(server.worldPath, 'worlds');
      if (await fs.pathExists(worldsDir)) {
        const universeWorlds = await this.scanWorldFolders(worldsDir);
        worldsInFS.push(...universeWorlds);
      }
      // Also check if worldPath itself is a world
      if (await this.isWorldFolder(server.worldPath)) {
        const size = await this.getDirectorySize(server.worldPath);
        worldsInFS.push({
          name: path.basename(server.worldPath),
          path: server.worldPath,
          size,
        });
      }
    }

    // 4. Fall back to scanning server root for world folders (Minecraft style)
    if (worldsInFS.length === 0) {
      worldsInFS = await this.scanWorldFolders(serverPath);
    }

    // Deduplicate by path
    const uniqueWorlds = new Map<string, { name: string; path: string; size: number }>();
    for (const w of worldsInFS) {
      uniqueWorlds.set(w.path, w);
    }
    const deduplicatedWorlds = Array.from(uniqueWorlds.values());

    // Merge and update database
    const allWorlds: WorldInfo[] = [];

    for (const worldFolder of deduplicatedWorlds) {
      let world = worldsInDB.find(w => w.folderPath === worldFolder.path);

      if (!world) {
        // Create new world entry
        world = await prisma.world.create({
          data: {
            serverId,
            name: worldFolder.name,
            folderPath: worldFolder.path,
            sizeBytes: worldFolder.size,
            isActive: worldFolder.name === path.basename(server.worldPath),
          },
        });
      } else {
        // Update size
        world = await prisma.world.update({
          where: { id: world.id },
          data: {
            sizeBytes: worldFolder.size,
          },
        });
      }

      allWorlds.push({
        id: world.id,
        serverId: world.serverId,
        name: world.name,
        folderPath: world.folderPath,
        sizeBytes: world.sizeBytes,
        isActive: world.isActive,
        description: world.description || undefined,
        createdAt: world.createdAt,
        lastPlayed: world.lastPlayed || undefined,
      });
    }

    return allWorlds;
  }

  /**
   * Scan server directory for world folders
   */
  private async scanWorldFolders(serverPath: string): Promise<Array<{ name: string; path: string; size: number }>> {
    const worlds: Array<{ name: string; path: string; size: number }> = [];

    try {
      if (!await fs.pathExists(serverPath)) {
        return worlds;
      }

      const items = await fs.readdir(serverPath);

      for (const item of items) {
        const itemPath = path.join(serverPath, item);
        const stats = await fs.stat(itemPath);

        if (stats.isDirectory()) {
          // Check if it looks like a world folder (contains level.dat or similar)
          const isWorld = await this.isWorldFolder(itemPath);

          if (isWorld) {
            const size = await this.getDirectorySize(itemPath);
            worlds.push({
              name: item,
              path: itemPath,
              size,
            });
          }
        }
      }
    } catch (error: any) {
      logger.error('Error scanning world folders:', error);
    }

    return worlds;
  }

  /**
   * Check if a directory is a world folder
   */
  private async isWorldFolder(dirPath: string): Promise<boolean> {
    // Hytale world indicator - config.json with world-specific fields
    const hytaleConfigPath = path.join(dirPath, 'config.json');
    if (await fs.pathExists(hytaleConfigPath)) {
      try {
        const content = await fs.readFile(hytaleConfigPath, 'utf-8');
        const config = JSON.parse(content);
        // Check for Hytale world-specific fields (UUID, Seed, WorldGen, IsTicking)
        if (config.UUID !== undefined || config.Seed !== undefined || config.WorldGen !== undefined || config.IsTicking !== undefined) {
          return true;
        }
      } catch {
        // Not a valid Hytale world config
      }
    }

    // Minecraft-style world file indicators (fallback)
    const minecraftIndicators = ['level.dat', 'world.dat', 'region', 'data'];
    for (const indicator of minecraftIndicators) {
      if (await fs.pathExists(path.join(dirPath, indicator))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get total size of a directory
   */
  private async getDirectorySize(dirPath: string): Promise<number> {
    let totalSize = 0;

    try {
      const files = await fs.readdir(dirPath);

      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = await fs.stat(filePath);

        if (stats.isFile()) {
          totalSize += stats.size;
        } else if (stats.isDirectory()) {
          totalSize += await this.getDirectorySize(filePath);
        }
      }
    } catch (error) {
      // Ignore errors
    }

    return totalSize;
  }

  /**
   * Get world details
   */
  async getWorld(worldId: string): Promise<WorldInfo | null> {
    const world = await prisma.world.findUnique({
      where: { id: worldId },
    });

    if (!world) return null;

    return {
      id: world.id,
      serverId: world.serverId,
      name: world.name,
      folderPath: world.folderPath,
      sizeBytes: world.sizeBytes,
      isActive: world.isActive,
      description: world.description || undefined,
      createdAt: world.createdAt,
      lastPlayed: world.lastPlayed || undefined,
    };
  }

  /**
   * Set active world
   */
  async setActiveWorld(serverId: string, worldId: string): Promise<void> {
    const server = await prisma.server.findUnique({
      where: { id: serverId },
    });

    if (!server) {
      throw new Error('Server not found');
    }

    if (server.status === 'running') {
      throw new Error('Cannot change world while server is running');
    }

    const world = await prisma.world.findUnique({
      where: { id: worldId },
    });

    if (!world || world.serverId !== serverId) {
      throw new Error('World not found');
    }

    // Deactivate all worlds for this server
    await prisma.world.updateMany({
      where: { serverId },
      data: { isActive: false },
    });

    // Activate the selected world
    await prisma.world.update({
      where: { id: worldId },
      data: {
        isActive: true,
        lastPlayed: new Date(),
      },
    });

    // Update server worldPath
    await prisma.server.update({
      where: { id: serverId },
      data: {
        worldPath: world.folderPath,
      },
    });

    logger.info(`Set active world for server ${serverId} to ${world.name}`);
  }

  /**
   * Create world archive (zip)
   */
  async exportWorld(worldId: string, outputPath: string): Promise<void> {
    const world = await prisma.world.findUnique({
      where: { id: worldId },
    });

    if (!world) {
      throw new Error('World not found');
    }

    if (!await fs.pathExists(world.folderPath)) {
      throw new Error('World folder not found');
    }

    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip', {
        zlib: { level: 9 },
      });

      output.on('close', () => {
        logger.info(`World ${world.name} exported: ${archive.pointer()} bytes`);
        resolve();
      });

      archive.on('error', (err) => {
        reject(err);
      });

      archive.pipe(output);
      archive.directory(world.folderPath, false);
      archive.finalize();
    });
  }

  /**
   * Import world from archive (zip)
   */
  async importWorld(serverId: string, name: string, archivePath: string): Promise<WorldInfo> {
    const server = await prisma.server.findUnique({
      where: { id: serverId },
    });

    if (!server) {
      throw new Error('Server not found');
    }

    if (server.status === 'running') {
      throw new Error('Cannot import world while server is running');
    }

    const worldPath = path.join(server.serverPath, name);

    if (await fs.pathExists(worldPath)) {
      throw new Error('World with this name already exists');
    }

    // Extract archive to world folder
    await fs.ensureDir(worldPath);

    try {
      await fs.createReadStream(archivePath)
        .pipe(unzipper.Extract({ path: worldPath }))
        .promise();

      const size = await this.getDirectorySize(worldPath);

      const world = await prisma.world.create({
        data: {
          serverId,
          name,
          folderPath: worldPath,
          sizeBytes: size,
          isActive: false,
        },
      });

      logger.info(`World ${name} imported successfully`);

      return {
        id: world.id,
        serverId: world.serverId,
        name: world.name,
        folderPath: world.folderPath,
        sizeBytes: world.sizeBytes,
        isActive: world.isActive,
        description: world.description || undefined,
        createdAt: world.createdAt,
        lastPlayed: world.lastPlayed || undefined,
      };
    } catch (error: any) {
      // Clean up on error
      await fs.remove(worldPath);
      throw error;
    }
  }

  /**
   * Delete a world
   */
  async deleteWorld(worldId: string): Promise<void> {
    const world = await prisma.world.findUnique({
      where: { id: worldId },
      include: {
        server: true,
      },
    });

    if (!world) {
      throw new Error('World not found');
    }

    if (world.server.status === 'running') {
      throw new Error('Cannot delete world while server is running');
    }

    if (world.isActive) {
      throw new Error('Cannot delete active world');
    }

    // Delete from filesystem
    if (await fs.pathExists(world.folderPath)) {
      await fs.remove(world.folderPath);
    }

    // Delete from database
    await prisma.world.delete({
      where: { id: worldId },
    });

    logger.info(`World ${world.name} deleted`);
  }

  /**
   * Update world metadata
   */
  async updateWorld(worldId: string, data: { name?: string; description?: string }): Promise<WorldInfo> {
    const world = await prisma.world.findUnique({
      where: { id: worldId },
    });

    if (!world) {
      throw new Error('World not found');
    }

    const updated = await prisma.world.update({
      where: { id: worldId },
      data,
    });

    return {
      id: updated.id,
      serverId: updated.serverId,
      name: updated.name,
      folderPath: updated.folderPath,
      sizeBytes: updated.sizeBytes,
      isActive: updated.isActive,
      description: updated.description || undefined,
      createdAt: updated.createdAt,
      lastPlayed: updated.lastPlayed || undefined,
    };
  }

  /**
   * Get world config.json
   */
  async getWorldConfig(worldId: string): Promise<HytaleWorldConfig> {
    const world = await prisma.world.findUnique({
      where: { id: worldId },
    });

    if (!world) {
      throw new Error('World not found');
    }

    const configPath = path.join(world.folderPath, 'config.json');

    if (!await fs.pathExists(configPath)) {
      throw new Error('World config.json not found');
    }

    try {
      const configContent = await fs.readFile(configPath, 'utf-8');
      return JSON.parse(configContent) as HytaleWorldConfig;
    } catch (error: any) {
      logger.error('Error reading world config:', error);
      throw new Error('Failed to parse world config.json');
    }
  }

  /**
   * Update world config.json
   * Only allows editing whitelisted fields when server is stopped
   */
  async updateWorldConfig(worldId: string, updates: Partial<HytaleWorldConfig>): Promise<HytaleWorldConfig> {
    const world = await prisma.world.findUnique({
      where: { id: worldId },
      include: {
        server: true,
      },
    });

    if (!world) {
      throw new Error('World not found');
    }

    // Check if server is running
    if (world.server.status === 'running') {
      throw new Error('Cannot edit world config while server is running');
    }

    const configPath = path.join(world.folderPath, 'config.json');

    if (!await fs.pathExists(configPath)) {
      throw new Error('World config.json not found');
    }

    // Read existing config
    let existingConfig: HytaleWorldConfig;
    try {
      const configContent = await fs.readFile(configPath, 'utf-8');
      existingConfig = JSON.parse(configContent);
    } catch (error: any) {
      logger.error('Error reading world config:', error);
      throw new Error('Failed to parse world config.json');
    }

    // Filter out immutable fields from updates
    const filteredUpdates: Partial<HytaleWorldConfig> = {};
    for (const key of Object.keys(updates)) {
      if (IMMUTABLE_FIELDS.includes(key)) {
        logger.warn(`Attempted to modify immutable field: ${key}`);
        continue;
      }
      // Allow all non-immutable fields (including custom fields from JSON editor)
      filteredUpdates[key] = updates[key];
    }

    // Merge updates with existing config
    const updatedConfig: HytaleWorldConfig = {
      ...existingConfig,
      ...filteredUpdates,
    };

    // Handle nested ClientEffects separately
    if (updates.ClientEffects && existingConfig.ClientEffects) {
      updatedConfig.ClientEffects = {
        ...existingConfig.ClientEffects,
        ...updates.ClientEffects,
      };
    }

    // Write updated config
    try {
      await fs.writeFile(configPath, JSON.stringify(updatedConfig, null, 2), 'utf-8');
      logger.info(`Updated world config for ${world.name}`);
    } catch (error: any) {
      logger.error('Error writing world config:', error);
      throw new Error('Failed to write world config.json');
    }

    return updatedConfig;
  }
}
