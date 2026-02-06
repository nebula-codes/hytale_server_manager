import { ChildProcess, spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import pidusage from 'pidusage';
import pidtree from 'pidtree';
import os from 'os';
import { PrismaClient } from '@prisma/client';
import {
  ServerStatus,
  ServerMetrics,
  ServerConfig,
  LogEntry,
  CommandResponse,
  Player,
  Mod,
  ModMetadata,
  InstalledFile,
  Backup,
} from '../types';
import { IServerAdapter } from './IServerAdapter';
import logger from '../utils/logger';

/**
 * Java Server Adapter - Simplified
 * Uses stdin for commands and stdout/stderr for logs. No RCON, no log tailing.
 */
export class JavaServerAdapter implements IServerAdapter {
  private serverId: string;
  private config: ServerConfig;
  private status: ServerStatus;
  private process: ChildProcess | null = null;
  private logCallbacks: ((log: LogEntry) => void)[] = [];
  private startTime: Date | null = null;
  private logBuffer: LogEntry[] = [];
  private maxLogBuffer = 1000;

  // Java configuration
  private javaPath: string;
  private jarFile: string;
  private assetsPath: string;
  private javaArgs: string[];
  private serverArgs: string[];
  private workingDirectory: string;
  private maxMemory: string;

  private prisma: PrismaClient;

  constructor(
    serverId: string,
    config: ServerConfig,
    prisma: PrismaClient,
    _rconService: any, // Unused but kept for interface compatibility
    _logTailService: any, // Unused but kept for interface compatibility
    adapterConfig?: {
      javaPath?: string;
      jarFile?: string;
      assetsPath?: string;
      minMemory?: string;
      maxMemory?: string;
      cpuCores?: number;
      javaArgs?: string[];
      serverArgs?: string[];
    }
  ) {
    this.serverId = serverId;
    this.config = config;
    this.workingDirectory = config.serverPath;
    this.prisma = prisma;

    // Java configuration with defaults
    this.javaPath = adapterConfig?.javaPath || 'java';
    this.jarFile = adapterConfig?.jarFile || 'Server/HytaleServer.jar';
    this.assetsPath = adapterConfig?.assetsPath || '../Assets.zip';
    const minMemory = adapterConfig?.minMemory || '1G';
    this.maxMemory = adapterConfig?.maxMemory || '2G';

    // Build JVM arguments
    if (adapterConfig?.javaArgs) {
      // Use provided javaArgs as-is
      this.javaArgs = adapterConfig.javaArgs;
    } else {
      // Build default javaArgs with optional CPU core limits
      const args = [`-Xms${minMemory}`, `-Xmx${this.maxMemory}`];

      // Add CPU core limits if specified
      if (adapterConfig?.cpuCores && adapterConfig.cpuCores > 0) {
        const cores = adapterConfig.cpuCores;
        const concurrentThreads = Math.max(1, Math.floor(cores / 2));
        args.push(
          '-XX:+UseContainerSupport',        // Make JVM container-aware
          `-XX:ActiveProcessorCount=${cores}`, // Limit JVM to specified CPU cores
          `-XX:ParallelGCThreads=${cores}`,   // Limit parallel GC threads
          `-XX:ConcGCThreads=${concurrentThreads}`, // Limit concurrent GC threads
          '-XX:+UseG1GC',                     // Use G1 garbage collector (better for containers)
          '-XX:MaxGCPauseMillis=200'          // Target max GC pause time
        );
      }

      args.push('-jar');
      this.javaArgs = args;
    }

    // Extract -Xmx from javaArgs if provided (overrides default maxMemory)
    const xmxArg = this.javaArgs.find((arg) => arg.toLowerCase().startsWith('-xmx'));
    if (xmxArg) {
      const match = xmxArg.match(/^-Xmx(\d+)([MmGg]?)$/i);
      if (match) {
        const value = match[1];
        const unit = match[2]?.toUpperCase() || 'M';
        this.maxMemory = `${value}${unit === 'G' ? 'G' : 'M'}`;
      }
    }

    // Build server args with assets path and bind address
    const bindAddress = `${config.address || '0.0.0.0'}:${config.port}`;
    const defaultServerArgs = ['--assets', this.assetsPath, '--bind', bindAddress];
    // Append custom server args to defaults (don't replace)
    this.serverArgs = adapterConfig?.serverArgs
      ? [...defaultServerArgs, ...adapterConfig.serverArgs]
      : defaultServerArgs;

    this.status = {
      serverId,
      status: 'stopped',
      playerCount: 0,
      maxPlayers: config.maxPlayers,
      version: config.version || '1.0.0',
      uptime: 0,
    };

    logger.info(`[JavaAdapter] Created for server ${serverId}`);
    logger.info(`[JavaAdapter] Working directory: ${this.workingDirectory}`);
    logger.info(`[JavaAdapter] JAR file: ${this.jarFile}`);
    logger.info(`[JavaAdapter] Bind address: ${bindAddress}`);
  }

  // ============================================
  // Lifecycle Management
  // ============================================

  async start(): Promise<void> {
    if (this.process) {
      throw new Error('Server is already running');
    }

    const jarPath = path.join(this.workingDirectory, this.jarFile);
    const jarDir = path.dirname(jarPath);
    const jarFileName = path.basename(this.jarFile);

    if (!await fs.pathExists(jarPath)) {
      throw new Error(`JAR file not found: ${jarPath}`);
    }

    // Check for AOT cache file for faster startup
    const aotPath = path.join(jarDir, 'HytaleServer.aot');
    if (await fs.pathExists(aotPath)) {
      const aotArg = '-XX:AOTCache=HytaleServer.aot';
      if (!this.javaArgs.includes(aotArg)) {
        // Insert AOT flag before -jar
        const jarIndex = this.javaArgs.indexOf('-jar');
        if (jarIndex > 0) {
          this.javaArgs.splice(jarIndex, 0, aotArg);
        } else {
          this.javaArgs.unshift(aotArg);
        }
        logger.info(`[JavaAdapter] Using AOT cache for faster startup`);
      }
    }

    logger.info(`[JavaAdapter] Starting server ${this.serverId}`);
    logger.info(`[JavaAdapter] Command: ${this.javaPath} ${this.javaArgs.join(' ')} ${jarFileName} ${this.serverArgs.join(' ')}`);

    this.status.status = 'starting';

    try {
      this.process = spawn(
        this.javaPath,
        [...this.javaArgs, jarFileName, ...this.serverArgs],
        {
          cwd: jarDir,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env },
          windowsHide: true,
        }
      );

      this.startTime = new Date();

      // Save PID to database
      if (this.process.pid) {
        await this.prisma.server.update({
          where: { id: this.serverId },
          data: { pid: this.process.pid, startedAt: this.startTime },
        });
      }

      // Handle stdout
      this.process.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(line => line.trim());
        lines.forEach(line => {
          const logEntry = this.parseLogLine(line);
          this.emitLog(logEntry);

          // Detect server ready
          if (line.includes('Done') && line.includes('For help')) {
            this.status.status = 'running';
            logger.info(`[JavaAdapter] Server ${this.serverId} is now running`);
          }
        });
      });

      // Handle stderr
      this.process.stderr?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(line => line.trim());
        lines.forEach(line => {
          this.emitLog({
            timestamp: new Date(),
            level: 'error',
            message: line,
            source: 'server',
          });
        });
      });

      // Handle process exit
      this.process.on('exit', async (code) => {
        logger.info(`[JavaAdapter] Server ${this.serverId} exited with code ${code}`);
        this.process = null;
        this.status.playerCount = 0;
        this.startTime = null;

        // Exit code 8 = server requests restart for update (Hytale convention)
        if (code === 8) {
          this.status.status = 'stopped';
          logger.info(`[JavaAdapter] Server ${this.serverId} requested update (exit code 8)`);
        } else {
          this.status.status = code === 0 ? 'stopped' : 'crashed';
        }

        await this.prisma.server.update({
          where: { id: this.serverId },
          data: { pid: null, startedAt: null, status: this.status.status },
        });

        this.emitLog({
          timestamp: new Date(),
          level: code === 0 || code === 8 ? 'info' : 'error',
          message: code === 8
            ? 'Server stopped for update (exit code: 8)'
            : `Server ${code === 0 ? 'stopped' : 'crashed'} (exit code: ${code})`,
          source: 'system',
        });
      });

      this.process.on('error', (error) => {
        logger.error(`[JavaAdapter] Process error:`, error);
        this.emitLog({
          timestamp: new Date(),
          level: 'error',
          message: `Process error: ${error.message}`,
          source: 'system',
        });
      });

      // Wait and check if process is still running
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (!this.process || this.process.exitCode !== null) {
        throw new Error('Server process terminated unexpectedly');
      }

      // Auto-set to running after 30 seconds if not detected
      setTimeout(() => {
        if (this.process && this.status.status === 'starting') {
          this.status.status = 'running';
        }
      }, 30000);

      logger.info(`[JavaAdapter] Server ${this.serverId} started (PID: ${this.process.pid})`);
    } catch (error: any) {
      this.status.status = 'stopped';
      this.process = null;
      await this.prisma.server.update({
        where: { id: this.serverId },
        data: { pid: null, startedAt: null },
      });
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.process) {
      return;
    }

    logger.info(`[JavaAdapter] Stopping server ${this.serverId}`);
    this.status.status = 'stopping';

    // Send stop command via stdin
    await this.sendCommand('stop');

    // Wait for graceful shutdown
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 30000);
      this.process?.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    // Force kill if still running
    if (this.process) {
      logger.warn(`[JavaAdapter] Force killing server ${this.serverId}`);
      this.process.kill('SIGKILL');
      this.process = null;
    }

    this.status.status = 'stopped';
    await this.prisma.server.update({
      where: { id: this.serverId },
      data: { pid: null, startedAt: null },
    });
  }

  async restart(): Promise<void> {
    await this.stop();
    await new Promise(resolve => setTimeout(resolve, 2000));
    await this.start();
  }

  async kill(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGKILL');
      this.process = null;
    }
    this.status.status = 'stopped';
    this.status.playerCount = 0;
    this.startTime = null;
    await this.prisma.server.update({
      where: { id: this.serverId },
      data: { pid: null, startedAt: null },
    });
  }

  // ============================================
  // Status & Monitoring
  // ============================================

  async getStatus(): Promise<ServerStatus> {
    if (this.startTime && this.status.status === 'running') {
      this.status.uptime = Math.floor((Date.now() - this.startTime.getTime()) / 1000);
    }
    return { ...this.status };
  }

  async getMetrics(): Promise<ServerMetrics> {
    const uptime = this.startTime
      ? Math.floor((Date.now() - this.startTime.getTime()) / 1000)
      : 0;

    let cpuUsage = 0;
    let memoryUsage = 0;
    let memoryTotal = 2048;

    if (this.maxMemory) {
      const match = this.maxMemory.match(/^(\d+)([MG])$/i);
      if (match) {
        const value = parseInt(match[1]);
        const unit = match[2].toUpperCase();
        memoryTotal = unit === 'G' ? value * 1024 : value;
      }
    }

    const pid = this.process?.pid;
    if (pid && this.status.status === 'running') {
      try {
        if (os.platform() === 'win32') {
          const script = `$pids = @(${pid}); $allProcs = Get-CimInstance Win32_Process; for ($i = 0; $i -lt $pids.Count; $i++) { $children = $allProcs | Where-Object { $_.ParentProcessId -eq $pids[$i] }; foreach ($c in $children) { if ($pids -notcontains $c.ProcessId) { $pids += $c.ProcessId } } }; $mem = ($allProcs | Where-Object { $pids -contains $_.ProcessId } | Measure-Object -Property WorkingSetSize -Sum).Sum; if ($mem -eq $null) { 0 } else { [math]::Round($mem / 1MB) }`;
          const result = execSync(`powershell -NoProfile -Command "${script}"`, {
            encoding: 'utf8',
            timeout: 10000,
            windowsHide: true,
          });
          memoryUsage = parseInt(result.trim(), 10) || 0;
        } else {
          const pids = await pidtree(pid, { root: true });
          const stats = await pidusage(pids);
          for (const p of pids) {
            if (stats[p]) {
              memoryUsage += Math.round((stats[p].memory || 0) / (1024 * 1024));
              cpuUsage += stats[p].cpu || 0;
            }
          }
        }
      } catch (error) {
        logger.warn(`[JavaAdapter] Failed to get process metrics:`, error);
      }
    }

    return {
      cpuUsage,
      memoryUsage,
      memoryTotal,
      diskUsage: 0,
      tps: this.status.status === 'running' ? 20 : 0,
      uptime,
      timestamp: new Date(),
    };
  }

  // ============================================
  // Configuration
  // ============================================

  async getConfig(): Promise<ServerConfig> {
    return { ...this.config };
  }

  async updateConfig(config: Partial<ServerConfig> & { jvmArgs?: string }): Promise<void> {
    this.config = { ...this.config, ...config };
    if (config.maxPlayers) {
      this.status.maxPlayers = config.maxPlayers;
    }

    // Update javaArgs if jvmArgs is provided
    if (config.jvmArgs !== undefined) {
      const jvmArgsList = config.jvmArgs.split(/\s+/).filter((arg) => arg.trim());
      this.javaArgs = [...jvmArgsList, '-jar'];

      // Update maxMemory for metrics display
      const xmxArg = this.javaArgs.find((arg) => arg.toLowerCase().startsWith('-xmx'));
      if (xmxArg) {
        const match = xmxArg.match(/^-Xmx(\d+)([MmGg]?)$/i);
        if (match) {
          const value = match[1];
          const unit = match[2]?.toUpperCase() || 'M';
          this.maxMemory = `${value}${unit === 'G' ? 'G' : 'M'}`;
        }
      }
    }
  }

  // ============================================
  // Console & Commands - STDIN ONLY
  // ============================================

  async sendCommand(command: string): Promise<CommandResponse> {
    if (!this.process || !this.process.stdin || !this.process.stdin.writable) {
      return {
        success: false,
        output: 'Server is not running',
        executedAt: new Date(),
      };
    }

    try {
      this.process.stdin.write(command + '\n');
      return {
        success: true,
        output: `Command sent: ${command}`,
        executedAt: new Date(),
      };
    } catch (error: any) {
      return {
        success: false,
        output: `Failed to send command: ${error.message}`,
        executedAt: new Date(),
      };
    }
  }

  streamLogs(callback: (log: LogEntry) => void): void {
    this.logCallbacks.push(callback);
    // Send buffered logs
    this.logBuffer.forEach(log => callback(log));
  }

  stopLogStream(): void {
    this.logCallbacks = [];
  }

  async getLogs(limit: number = 100): Promise<LogEntry[]> {
    return this.logBuffer.slice(-limit);
  }

  // ============================================
  // Player Management
  // ============================================

  async getPlayers(): Promise<Player[]> {
    return [];
  }

  async kickPlayer(uuid: string, reason?: string): Promise<void> {
    await this.sendCommand(`kick ${uuid} ${reason || ''}`);
  }

  async banPlayer(uuid: string, reason?: string): Promise<void> {
    await this.sendCommand(`ban ${uuid} ${reason || ''}`);
  }

  async unbanPlayer(uuid: string): Promise<void> {
    await this.sendCommand(`pardon ${uuid}`);
  }

  async whitelistPlayer(uuid: string): Promise<void> {
    await this.sendCommand(`whitelist add ${uuid}`);
  }

  async unwhitelistPlayer(uuid: string): Promise<void> {
    await this.sendCommand(`whitelist remove ${uuid}`);
  }

  // ============================================
  // Mod Management
  // ============================================

  async installMod(modFile: Buffer, metadata: ModMetadata): Promise<InstalledFile[]> {
    const modsDir = this.getModsDir();
    const modsRelativePath = path.relative(this.workingDirectory, modsDir).replace(/\\/g, '/');
    await fs.ensureDir(modsDir);

    const installedFiles: InstalledFile[] = [];
    const isModpack = metadata.classification?.toUpperCase() === 'MODPACK';

    if (isModpack) {
      // Only modpacks get unzipped
      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip(modFile);
      const zipEntries = zip.getEntries();

      for (const entry of zipEntries) {
        if (entry.isDirectory) continue;
        const fileName = path.basename(entry.entryName);
        const ext = path.extname(fileName).toLowerCase().slice(1);

        if (['jar', 'yml', 'json', 'toml'].includes(ext)) {
          const targetPath = path.join(modsDir, fileName);
          const data = entry.getData();
          await fs.writeFile(targetPath, data);

          installedFiles.push({
            fileName,
            filePath: `${modsRelativePath}/${fileName}`,
            fileSize: data.length,
            fileType: ext,
          });
        }
      }
    } else {
      // Regular mods - keep as-is with their original extension
      let fileName = metadata.fileName;
      if (!fileName) {
        const sanitizedTitle = metadata.projectTitle
          .replace(/[<>:"/\\|?*]/g, '')
          .replace(/\s+/g, '-')
          .substring(0, 100);
        fileName = `${sanitizedTitle}.jar`;
      }

      // Determine file type from extension
      const ext = path.extname(fileName).toLowerCase().slice(1) || 'jar';
      const isZipFile = ext === 'zip';

      // Only append .jar if file has no recognized extension
      if (!isZipFile && !fileName.toLowerCase().endsWith('.jar')) {
        fileName = `${fileName}.jar`;
      }

      const targetPath = path.join(modsDir, fileName);
      await fs.writeFile(targetPath, modFile);

      installedFiles.push({
        fileName,
        filePath: `${modsRelativePath}/${fileName}`,
        fileSize: modFile.length,
        fileType: isZipFile ? 'zip' : 'jar',
      });
    }

    return installedFiles;
  }

  async deleteModFiles(filePaths: string[]): Promise<void> {
    for (const relativePath of filePaths) {
      const fullPath = path.join(this.workingDirectory, relativePath);
      if (await fs.pathExists(fullPath)) {
        await fs.remove(fullPath);
      }
    }
  }

  async uninstallMod(modId: string): Promise<void> {
    const mod = await this.prisma.mod.findUnique({
      where: { id: modId },
      include: { files: true },
    });
    if (mod?.files) {
      await this.deleteModFiles(mod.files.map(f => f.filePath));
    }
  }

  async enableMod(modId: string): Promise<void> {
    const mod = await this.prisma.mod.findUnique({
      where: { id: modId },
      include: { files: true },
    });
    if (!mod) return;

    for (const file of mod.files) {
      if (file.fileType !== 'jar') continue;
      const fullPath = path.join(this.workingDirectory, file.filePath);
      const disabledPath = `${fullPath}.disabled`;
      if (await fs.pathExists(disabledPath)) {
        await fs.rename(disabledPath, fullPath);
      }
    }
  }

  async disableMod(modId: string): Promise<void> {
    const mod = await this.prisma.mod.findUnique({
      where: { id: modId },
      include: { files: true },
    });
    if (!mod) return;

    for (const file of mod.files) {
      if (file.fileType !== 'jar') continue;
      const fullPath = path.join(this.workingDirectory, file.filePath);
      const disabledPath = `${fullPath}.disabled`;
      if (await fs.pathExists(fullPath)) {
        await fs.rename(fullPath, disabledPath);
      }
    }
  }

  private getModsDir(): string {
    const jarDir = path.dirname(path.join(this.workingDirectory, this.jarFile));
    return path.join(jarDir, 'mods');
  }

  async listInstalledMods(): Promise<Mod[]> {
    const mods = await this.prisma.mod.findMany({
      where: { serverId: this.serverId },
      include: { files: true },
    });

    return mods.map(mod => ({
      id: mod.id,
      serverId: mod.serverId,
      projectId: mod.projectId,
      projectTitle: mod.projectTitle,
      projectIconUrl: mod.projectIconUrl || undefined,
      versionId: mod.versionId,
      versionName: mod.versionName,
      classification: mod.classification,
      archiveSize: mod.archiveSize,
      fileHash: mod.fileHash || undefined,
      enabled: mod.enabled,
      installedAt: mod.installedAt,
      updatedAt: mod.updatedAt,
      files: mod.files.map(f => ({
        id: f.id,
        modId: f.modId,
        fileName: f.fileName,
        filePath: f.filePath,
        fileSize: Number(f.fileSize),  // Convert BigInt to number
        fileType: f.fileType,
        createdAt: f.createdAt,
      })),
    }));
  }

  // ============================================
  // Backup Management (stub)
  // ============================================

  async createBackup(_name: string): Promise<Backup> {
    throw new Error('Use BackupService for backup management');
  }

  async restoreBackup(_backupId: string): Promise<void> {
    throw new Error('Use BackupService for backup management');
  }

  async deleteBackup(_backupId: string): Promise<void> {
    throw new Error('Use BackupService for backup management');
  }

  // ============================================
  // File Management (stub)
  // ============================================

  async readFile(_relativePath: string): Promise<string> {
    throw new Error('Use FileService for file management');
  }

  async writeFile(_relativePath: string, _content: string): Promise<void> {
    throw new Error('Use FileService for file management');
  }

  async deleteFile(_relativePath: string): Promise<void> {
    throw new Error('Use FileService for file management');
  }

  async listFiles(_relativePath: string): Promise<string[]> {
    throw new Error('Use FileService for file management');
  }

  // ============================================
  // Reconnect (simplified - just check if process exists)
  // ============================================

  async reconnect(pid: number): Promise<boolean> {
    try {
      process.kill(pid, 0); // Check if process exists
      this.status.status = 'running';
      const server = await this.prisma.server.findUnique({ where: { id: this.serverId } });
      if (server?.startedAt) {
        this.startTime = server.startedAt;
      }
      return true;
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    // Nothing to disconnect - no RCON/log tail
  }

  isConnected(): boolean {
    return !!this.process;
  }

  getPid(): number | null {
    return this.process?.pid || null;
  }

  // ============================================
  // Private Helpers
  // ============================================

  private parseLogLine(line: string): LogEntry {
    let level: 'info' | 'warn' | 'error' | 'debug' = 'info';
    if (line.includes('/WARN') || line.includes('[WARN]') || line.includes('WARN]')) {
      level = 'warn';
    } else if (line.includes('/ERROR') || line.includes('[ERROR]') || line.includes('SEVERE]')) {
      level = 'error';
    } else if (line.includes('/DEBUG') || line.includes('[DEBUG]')) {
      level = 'debug';
    }
    return { timestamp: new Date(), level, message: line, source: 'server' };
  }

  private emitLog(log: LogEntry): void {
    this.logBuffer.push(log);
    if (this.logBuffer.length > this.maxLogBuffer) {
      this.logBuffer.shift();
    }
    this.logCallbacks.forEach(callback => {
      try {
        callback(log);
      } catch (error) {
        logger.error('Error in log callback:', error);
      }
    });
  }
}
