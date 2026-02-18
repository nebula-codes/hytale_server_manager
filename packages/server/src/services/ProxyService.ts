import { ChildProcess, spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import readline from 'readline';
import chokidar, { FSWatcher } from 'chokidar';
import config from '../config';
import { LogEntry, CommandResponse } from '../types';
import logger from '../utils/logger';

export interface ProxyNetworkConfig {
  startOrder?: 'proxy_first' | 'backends_first';
  version?: number;
  bindAddress?: string;
  bindPort?: number;
  publicAddress?: string;
  publicPort?: number;
  certificatePath?: string;
  privateKeyPath?: string;
  proxySecret?: string;
  debugMode?: boolean;
  autoInstallBridge?: boolean;
  defaultServer?: string;
  fallbackServer?: string;
  poolEnabled?: boolean;
  pool?: Record<string, { strategy?: 'round-robin' | 'random' | 'least-connections'; servers: string[] }>;
  routes?: { hostname: string; target: string }[];
}

export interface ProxyBackendServer {
  id: string;
  name: string;
  address: string;
  port: number;
  serverPath: string;
  version?: string;
}

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface ReleaseResponse {
  assets: ReleaseAsset[];
  tag_name?: string;
}

interface AssetBundle {
  proxyBinaryPath: string;
  bridgeJarPath: string | null;
}

type ProxyPty = {
  pid: number;
  write: (data: string) => void;
  kill: (signal?: string) => void;
  on: (event: 'data' | 'exit', listener: (...args: any[]) => void) => void;
  once?: (event: 'exit', listener: (...args: any[]) => void) => void;
};

export class ProxyService {
  private processes = new Map<string, ChildProcess | ProxyPty>();
  private statuses = new Map<string, 'stopped' | 'starting' | 'running' | 'stopping'>();
  private runningProxyVersions = new Map<string, string>();
  private supportedVersionCache = new Map<string, { supported: boolean; checkedAt: number }>();
  private proxiesBasePath: string;
  private cachePath: string;
  private runtimeRootPath: string;
  private logListeners = new Map<string, Set<(log: LogEntry) => void>>();
  private logHistory = new Map<string, LogEntry[]>();
  private readonly LOG_HISTORY_LIMIT = 300;
  private logWatchers = new Map<string, FSWatcher>();
  private logPositions = new Map<string, number>();

  constructor() {
    this.proxiesBasePath = config.proxiesBasePath;
    this.cachePath = path.join(this.proxiesBasePath, 'cache');
    this.runtimeRootPath = path.join(this.proxiesBasePath, 'networks');
  }

  getStatus(networkId: string): 'stopped' | 'starting' | 'running' | 'stopping' {
    return this.statuses.get(networkId) || 'stopped';
  }

  getRunningProxyVersion(networkId: string): string | null {
    return this.runningProxyVersions.get(networkId) || null;
  }

  async startProxy(
    networkId: string,
    _networkName: string,
    backendServers: ProxyBackendServer[],
    rawConfig: ProxyNetworkConfig
  ): Promise<void> {
    const current = this.processes.get(networkId);
    if (current) {
      if (this.isChildProcess(current) && current.exitCode === null) {
        logger.info(`[ProxyService] Proxy already running for network ${networkId}`);
        this.statuses.set(networkId, 'running');
        return;
      }
      if (!this.isChildProcess(current)) {
        logger.info(`[ProxyService] Proxy already running for network ${networkId} (pty mode)`);
        this.statuses.set(networkId, 'running');
        return;
      }
    }

    this.statuses.set(networkId, 'starting');

    const config = this.buildEffectiveConfig(rawConfig);

    const runtimePath = await this.ensureRuntimePath(networkId);
    const backendVersion = backendServers.find(b => b.version)?.version;
    const targetProxyVersion = this.getTargetProxyVersion(backendServers);
    const assets = await this.ensureAssets(backendVersion);

    await this.writeProxyConfig(runtimePath, backendServers, config);
    await this.startLogTail(networkId, path.join(runtimePath, 'logs', 'proxy.log'));

    if (config.autoInstallBridge !== false) {
      await this.installBridgeComponents(backendServers, assets, config.proxySecret);
    }

    const { command, args } = await this.buildLaunchCommand(assets.proxyBinaryPath);
    const procEnv = {
      ...process.env,
    };

    logger.info(
      `[ProxyService] Starting proxy for network ${networkId} with command: ${command} ${args.join(' ')}`
    );

    let childProcess: ChildProcess | ProxyPty;
    let usedPty = false;

    try {
      // Lazy-require to keep optional and avoid type dependency
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pty: any = require('node-pty');
      childProcess = pty.spawn(command, args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: runtimePath,
        env: procEnv,
      });
      usedPty = true;
      logger.info('[ProxyService] node-pty detected, starting proxy with PTY for interactive console support');
    } catch (error) {
      logger.info('[ProxyService] node-pty unavailable, falling back to spawn (commands may be limited)');
      childProcess = spawn(command, args, {
        cwd: runtimePath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: procEnv,
        windowsHide: true,
      });
    }

    this.processes.set(networkId, childProcess);

    if (usedPty) {
      childProcess.on('data', (data: Buffer | string) => {
        this.emitProcessLogs(networkId, data.toString(), 'info');
      });
      const exitHandler = (code: number | null, signal?: number | string) => {
        logger.info(`[ProxyService] Proxy for network ${networkId} exited (pty) code=${code} signal=${signal}`);
        this.processes.delete(networkId);
        this.statuses.set(networkId, 'stopped');
      };
      (childProcess.once ?? childProcess.on).call(childProcess, 'exit', exitHandler);
    } else {
      const cp = childProcess as ChildProcess;

      cp.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        this.emitProcessLogs(networkId, text, 'info');
      });

      cp.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        this.emitProcessLogs(networkId, text, 'warn');
      });

      cp.on('exit', (code: number | null) => {
        logger.info(`[ProxyService] Proxy for network ${networkId} exited with code ${code}`);
        this.processes.delete(networkId);
        this.statuses.set(networkId, 'stopped');
      });

      cp.on('error', (error: Error) => {
        logger.error(`[ProxyService] Proxy process error for network ${networkId}:`, error);
        this.processes.delete(networkId);
        this.statuses.set(networkId, 'stopped');
      });
    }

    // Give the process a moment to crash if something is wrong
    await new Promise(resolve => setTimeout(resolve, 1500));
    const runningProc = this.processes.get(networkId);
    const exitCode = runningProc && this.isChildProcess(runningProc)
      ? runningProc.exitCode
      : null;
    if (!runningProc || exitCode !== null) {
      this.statuses.set(networkId, 'stopped');
      throw new Error('Proxy process terminated unexpectedly during startup');
    }

    this.statuses.set(networkId, 'running');
    this.runningProxyVersions.set(networkId, targetProxyVersion);
  }

  async stopProxy(networkId: string): Promise<void> {
    const process = this.processes.get(networkId);
    if (!process) {
      this.statuses.set(networkId, 'stopped');
      this.stopLogTail(networkId);
      return;
    }

    this.statuses.set(networkId, 'stopping');

    try {
      if ('stdin' in process && process.stdin) {
        process.stdin.write('stop\n');
      } else if ('write' in process) {
        (process as ProxyPty).write('stop\r\n');
      }
    } catch {
      // Ignore stdin failures and fallback to kill
    }

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 10000);
      const handler = () => {
        clearTimeout(timeout);
        resolve();
      };
      if ('once' in process && typeof (process as any).once === 'function') {
        (process as any).once('exit', handler);
      } else if ('on' in process) {
        (process as any).on('exit', handler);
      } else {
        resolve();
      }
    });

    const exitCode = (process as ChildProcess)?.exitCode ?? null;
    if (exitCode === null) {
      process.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    const exitCodeAfter = (process as ChildProcess)?.exitCode ?? null;
    if (exitCodeAfter === null) {
      process.kill('SIGKILL');
    }

    this.processes.delete(networkId);
    this.statuses.set(networkId, 'stopped');
    this.runningProxyVersions.delete(networkId);
    this.stopLogTail(networkId);
  }

  /**
   * Rewrite proxy config for a network without starting/stopping the proxy process.
   */
  async syncProxyConfig(
    networkId: string,
    backendServers: ProxyBackendServer[],
    rawConfig: ProxyNetworkConfig
  ): Promise<Required<Pick<ProxyNetworkConfig, 'bindAddress' | 'bindPort' | 'publicPort' | 'proxySecret'>> & ProxyNetworkConfig> {
    const config = this.buildEffectiveConfig(rawConfig);

    const runtimePath = await this.ensureRuntimePath(networkId);
    await this.writeProxyConfig(runtimePath, backendServers, config);
    return config;
  }

  async syncBridgeForBackends(
    backendServers: ProxyBackendServer[],
    proxySecret: string
  ): Promise<void> {
    if (backendServers.length === 0) {
      return;
    }

    const backendVersion = backendServers.find(b => b.version)?.version;
    const assets = await this.ensureAssets(backendVersion);
    await this.installBridgeComponents(backendServers, assets, proxySecret);
  }

  async restartIfProxyVersionChanged(
    networkId: string,
    networkName: string,
    backendServers: ProxyBackendServer[],
    rawConfig: ProxyNetworkConfig
  ): Promise<boolean> {
    if (this.getStatus(networkId) !== 'running') {
      return false;
    }

    const targetVersion = this.getTargetProxyVersion(backendServers);
    const currentVersion = this.runningProxyVersions.get(networkId);
    if (currentVersion === targetVersion) {
      return false;
    }

    logger.info(
      `[ProxyService] Proxy version change detected for ${networkId}: ${currentVersion || 'unknown'} -> ${targetVersion}. Restarting proxy.`
    );

    await this.stopProxy(networkId);
    await this.startProxy(networkId, networkName, backendServers, rawConfig);
    return true;
  }

  async canSupportVersion(version?: string): Promise<boolean> {
    if (!version || version === 'latest') {
      return true;
    }

    const cached = this.supportedVersionCache.get(version);
    const now = Date.now();
    if (cached && now - cached.checkedAt < 5 * 60 * 1000) {
      return cached.supported;
    }

    try {
      const release = await this.getReleaseExact(version);
      const supported = Boolean(this.pickProxyAsset(release.assets));
      this.supportedVersionCache.set(version, { supported, checkedAt: now });
      return supported;
    } catch {
      this.supportedVersionCache.set(version, { supported: false, checkedAt: now });
      return false;
    }
  }

  async cleanup(): Promise<void> {
    const networkIds = Array.from(this.processes.keys());
    for (const networkId of networkIds) {
      try {
        await this.stopProxy(networkId);
      } catch (error) {
        logger.warn(`[ProxyService] Failed to stop proxy ${networkId} during cleanup:`, error);
      }
    }
  }

  private async ensureRuntimePath(networkId: string): Promise<string> {
    const runtimePath = path.join(this.runtimeRootPath, networkId);
    await fs.ensureDir(runtimePath);
    await fs.ensureDir(path.join(runtimePath, 'config'));
    return runtimePath;
  }

  private async ensureAssets(version?: string): Promise<AssetBundle> {
    const cacheRoot = version ? path.join(this.cachePath, version) : this.cachePath;
    await fs.ensureDir(cacheRoot);

    const release = await this.getRelease(version);
    const proxyAsset = this.pickProxyAsset(release.assets);
    const bridgeAsset = release.assets.find(asset => /^bridge-(?!packets).*\.jar$/i.test(asset.name));
    const bridgePacketsAsset = release.assets.find(asset => /^bridge-packets-.*\.jar$/i.test(asset.name));

    if (!proxyAsset) {
      throw new Error('Could not find proxy binary in OrbisProxy release');
    }

    const proxyBinaryPath = await this.downloadAsset(cacheRoot, proxyAsset.name, proxyAsset.browser_download_url);
    const bridgeJarPath = bridgeAsset
      ? await this.downloadAsset(cacheRoot, bridgeAsset.name, bridgeAsset.browser_download_url)
      : null;
    // Keep download support for bridge-packets for compatibility, but Orbis backend setup does not require it.
    if (bridgePacketsAsset) {
      await this.downloadAsset(cacheRoot, bridgePacketsAsset.name, bridgePacketsAsset.browser_download_url);
    }

    logger.info(
      `[ProxyService] Using proxy asset ${proxyAsset.name} for ${process.platform}/${process.arch} (cache: ${cacheRoot})`
    );

    return {
      proxyBinaryPath,
      bridgeJarPath,
    };
  }

  private async getRelease(version?: string): Promise<ReleaseResponse> {
    const baseUrl = 'https://api.github.com/repos/OrbisProxy/proxy/releases';
    const url = version
      ? `${baseUrl}/tags/${version.startsWith('v') ? version : `v${version}`}`
      : `${baseUrl}/latest`;

    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'HytaleServerManager/0.3',
      },
    });

    if (!response.ok) {
      // Fallback to latest if the requested tag is missing
      if (version && response.status === 404) {
        return this.getRelease(undefined);
      }
      const details = await response.text();
      throw new Error(`Failed to fetch OrbisProxy release${version ? ` for ${version}` : ''}: HTTP ${response.status} - ${details}`);
    }

    return response.json() as Promise<ReleaseResponse>;
  }

  private async getReleaseExact(version: string): Promise<ReleaseResponse> {
    const baseUrl = 'https://api.github.com/repos/OrbisProxy/proxy/releases';
    const url = `${baseUrl}/tags/${version.startsWith('v') ? version : `v${version}`}`;

    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'HytaleServerManager/0.3',
      },
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Failed to fetch exact OrbisProxy release for ${version}: HTTP ${response.status} - ${details}`);
    }

    return response.json() as Promise<ReleaseResponse>;
  }

  private async downloadAsset(cacheRoot: string, fileName: string, url: string): Promise<string> {
    const targetPath = path.join(cacheRoot, fileName);
    if (await fs.pathExists(targetPath)) {
      return targetPath;
    }

    logger.info(`[ProxyService] Downloading ${fileName}`);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'HytaleServerManager/0.3',
      },
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Failed to download ${fileName}: HTTP ${response.status} - ${details}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(targetPath, Buffer.from(arrayBuffer));
    return targetPath;
  }

  private async writeProxyConfig(
    runtimePath: string,
    backendServers: ProxyBackendServer[],
    config: Required<Pick<ProxyNetworkConfig, 'bindAddress' | 'bindPort' | 'proxySecret' | 'publicPort'>> & ProxyNetworkConfig
  ): Promise<void> {
    const configPath = path.join(runtimePath, 'config.yml');
    const legacyConfigPath = path.join(runtimePath, 'config', 'proxy.yml');
    const publicAddress = config.publicAddress || config.bindAddress;
    const defaultServer = config.defaultServer || backendServers[0]?.name || '';
    const fallbackServer = config.fallbackServer || backendServers[1]?.name || defaultServer;
    const poolEnabled = config.poolEnabled ?? false;
    const poolEntries = config.pool || {};
    const routes = config.routes || [];

    const serversBlock = backendServers
      .map(server => {
        const host = this.resolveBackendHost(server.address);
        return [
          `  - name: "${server.name}"`,
          `    host: ${host}`,
          `    port: ${server.port}`,
          '',
        ].join('\n');
      })
      .join('\n')
      .trimEnd();

    const poolBlock = Object.entries(poolEntries)
      .map(([poolName, poolConfig]) => {
        const strategy = poolConfig.strategy || 'round-robin';
        const poolServers = (poolConfig.servers || []).map(serverName => `      - ${serverName}`).join('\n');
        return [
          `  ${poolName}:`,
          `    strategy: ${strategy}`,
          '    servers:',
          poolServers || '      []',
        ].join('\n');
      })
      .join('\n\n');

    const routesBlock = routes
      .map(route => [
        `  - hostname: "${route.hostname}"`,
        `    target: "${route.target}"`,
      ].join('\n'))
      .join('\n\n');

    const payload = [
      '# Auto-generated by Hytale Server Manager',
      `version: ${config.version ?? 3}`,
      `listen: ${config.bindAddress}:${config.bindPort}`,
      `publicAddress: "${publicAddress}"`,
      `publicPort: ${config.publicPort}`,
      `proxySecret: "${config.proxySecret}"`,
      `certFile: ${config.certificatePath || 'certs/server.crt'}`,
      `keyFile: ${config.privateKeyPath || 'certs/server.key'}`,
      `debug: ${config.debugMode ?? false}`,
      '',
      'servers:',
      serversBlock || '  []',
      '',
      `defaultServer: "${defaultServer}"`,
      `fallbackServer: "${fallbackServer}"`,
      '',
      `poolEnabled: ${poolEnabled}`,
      '',
      'pool:',
      poolBlock || '  {}',
      '',
      'routes:',
      routesBlock || '  []',
      '',
    ].join('\n');

    await fs.writeFile(configPath, payload, 'utf8');

    // Cleanup legacy path from previous implementation to avoid two diverging config files.
    if (await fs.pathExists(legacyConfigPath)) {
      await fs.remove(legacyConfigPath);
    }
  }

  private async installBridgeComponents(
    backendServers: ProxyBackendServer[],
    assets: AssetBundle,
    proxySecret: string
  ): Promise<void> {
    const hasBridge = Boolean(assets.bridgeJarPath);
    if (!hasBridge) {
      logger.warn(
        `[ProxyService] Bridge asset missing: bridge=${hasBridge}. Backends will not get OrbisProxy backend mod.`
      );
    }

    for (const server of backendServers) {
      const serverRoot = path.resolve(server.serverPath);
      const modsPath = path.join(serverRoot, 'mods');
      const modConfigDir = path.join(modsPath, 'OrbisProxy_OrbisProxy');
      await fs.ensureDir(modsPath);
      await fs.ensureDir(modConfigDir);

      if (assets.bridgeJarPath) {
        await fs.copyFile(assets.bridgeJarPath, path.join(modsPath, path.basename(assets.bridgeJarPath)));
        logger.info(
          `[ProxyService] Installed OrbisProxy backend mod to ${modsPath} for server ${server.name}`
        );
      }

      const bridgeConfigPath = path.join(modConfigDir, 'config.json');
      const bridgeConfig = {
        SecretKey: proxySecret,
      };
      await fs.writeJson(bridgeConfigPath, bridgeConfig, { spaces: 2 });
    }
  }

  private resolveBackendHost(host: string): string {
    if (!host || host === '0.0.0.0') {
      return '127.0.0.1';
    }
    return host;
  }

  /**
   * Tail proxy.log to capture messages not printed to stdout (e.g., commands).
   */
  private async startLogTail(networkId: string, logPath: string): Promise<void> {
    try {
      await fs.ensureDir(path.dirname(logPath));
    } catch (error) {
      logger.warn(`[ProxyService] Cannot ensure log dir for ${networkId}:`, error);
    }

    // Initialize position at end of file to avoid replaying old logs
    let position = 0;
    try {
      const stats = await fs.stat(logPath);
      position = stats.size;
    } catch {
      position = 0;
    }
    this.logPositions.set(networkId, position);

    const watcher = chokidar.watch(logPath, {
      persistent: true,
      usePolling: true,
      interval: 200,
      ignoreInitial: true,
    });

    watcher.on('add', () => this.readNewLogLines(networkId, logPath));
    watcher.on('change', () => this.readNewLogLines(networkId, logPath));
    watcher.on('error', (err) => logger.warn(`[ProxyService] Log tail error for ${networkId}:`, err));

    this.logWatchers.set(networkId, watcher);
  }

  private async readNewLogLines(networkId: string, logPath: string): Promise<void> {
    const start = this.logPositions.get(networkId) ?? 0;
    try {
      const stats = await fs.stat(logPath);
      if (stats.size <= start) {
        this.logPositions.set(networkId, stats.size);
        return;
      }

      const stream = fs.createReadStream(logPath, {
        start,
        end: stats.size,
        encoding: 'utf8',
      });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      for await (const line of rl) {
        if (line.trim().length === 0) continue;
        this.emitProcessLogs(networkId, line, 'info');
      }

      this.logPositions.set(networkId, stats.size);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(`[ProxyService] Failed reading proxy log for ${networkId}:`, error);
      }
    }
  }

  private stopLogTail(networkId: string): void {
    const watcher = this.logWatchers.get(networkId);
    if (watcher) {
      watcher.close().catch(() => {});
      this.logWatchers.delete(networkId);
    }
    this.logPositions.delete(networkId);
  }

  private emitProcessLogs(networkId: string, raw: string, level: LogEntry['level']): void {
    const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length === 0) return;

    const listeners = this.logListeners.get(networkId);
    let history = this.logHistory.get(networkId) || [];

    for (const line of lines) {
      const log: LogEntry = {
        timestamp: new Date(),
        level,
        message: line,
        source: 'proxy',
      };

      if (listeners && listeners.size > 0) {
        listeners.forEach(cb => cb(log));
      }

      history.push(log);
    }

    if (history.length > this.LOG_HISTORY_LIMIT) {
      history = history.slice(history.length - this.LOG_HISTORY_LIMIT);
    }
    this.logHistory.set(networkId, history);
  }

  streamLogs(networkId: string, callback: (log: LogEntry) => void): void {
    if (!this.logListeners.has(networkId)) {
      this.logListeners.set(networkId, new Set());
    }
    this.logListeners.get(networkId)!.add(callback);
  }

  stopLogStream(networkId: string): void {
    this.logListeners.delete(networkId);
  }

  async getLogs(networkId: string, limit = 100): Promise<LogEntry[]> {
    const history = this.logHistory.get(networkId) || [];
    if (limit >= history.length) return history;
    return history.slice(history.length - limit);
  }

  async sendCommand(networkId: string, command: string): Promise<CommandResponse> {
    const proc = this.processes.get(networkId);
    const exitCode = proc && 'exitCode' in (proc as any)
      ? (proc as ChildProcess).exitCode
      : null;
    if (!proc || exitCode !== null) {
      return {
        success: false,
        output: 'Proxy is not running',
        executedAt: new Date(),
        error: 'not_running',
      };
    }

    try {
      // Use CRLF to better match console expectations
      if ('stdin' in proc && proc.stdin) {
        proc.stdin.write(`${command}\r\n`);
        logger.info(`[ProxyService] Sent command to proxy ${networkId} via stdin`);
      } else if ('write' in proc) {
        (proc as ProxyPty).write(`${command}\r\n`);
        logger.info(`[ProxyService] Sent command to proxy ${networkId} via PTY`);
      }
      return { success: true, output: 'Command sent to proxy', executedAt: new Date() };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to send command';
      return { success: false, output: msg, executedAt: new Date(), error: msg };
    }
  }

  /**
   * Pick the best proxy asset for the current platform/arch.
   * Supports native binaries (preferred) and .jar artifacts as fallback.
   */
  private pickProxyAsset(assets: ReleaseAsset[]): ReleaseAsset | undefined {
    const arch = process.arch;
    const platform = process.platform;

    const archKeywords: Record<string, string[]> = {
      arm64: ['aarch64', 'arm64'],
      aarch64: ['aarch64', 'arm64'],
      x64: ['x86_64', 'amd64', 'x64'],
    };

    const platformKeywords: Record<NodeJS.Platform, string[]> = {
      linux: ['linux'],
      darwin: ['mac', 'darwin', 'osx'],
      win32: ['win', 'windows'],
      aix: [],
      android: ['android'],
      freebsd: ['freebsd'],
      openbsd: ['openbsd'],
      sunos: ['sunos'],
      cygwin: ['win', 'windows'],
      netbsd: ['netbsd'],
      haiku: [],
    };

    const archKeys = archKeywords[arch] || [arch];
    const platformKeys = platformKeywords[platform] || [platform];

    const matches = (asset: ReleaseAsset, keys: string[]) => keys.some(k => asset.name.toLowerCase().includes(k));
    const proxyAssets = assets.filter(asset => this.isProxyRuntimeAsset(asset.name));
    const runnableAssets = proxyAssets.filter(asset => !this.isArchiveAsset(asset.name));

    // Prefer platform+arch specific asset
    const exact = runnableAssets.find(a => matches(a, archKeys) && matches(a, platformKeys));
    if (exact) return exact;

    // Then arch-specific
    const archOnly = runnableAssets.find(a => matches(a, archKeys));
    if (archOnly) return archOnly;

    // Then platform-specific
    const platformOnly = runnableAssets.find(a => matches(a, platformKeys));
    if (platformOnly) return platformOnly;

    // Fallback generic runnable asset
    return runnableAssets[0];
  }

  private isProxyRuntimeAsset(assetName: string): boolean {
    const lower = assetName.toLowerCase();
    if (!lower.includes('proxy')) return false;
    if (lower.includes('bridge')) return false;
    if (lower.includes('source') || lower.includes('src')) return false;
    if (lower.endsWith('.sha256') || lower.endsWith('.sig') || lower.includes('checksum')) return false;
    return true;
  }

  private isArchiveAsset(assetName: string): boolean {
    const lower = assetName.toLowerCase();
    return lower.endsWith('.zip') || lower.endsWith('.tar') || lower.endsWith('.tar.gz') || lower.endsWith('.tgz');
  }

  private async buildLaunchCommand(
    proxyBinaryPath: string
  ): Promise<{ command: string; args: string[] }> {
    if (/\.jar$/i.test(proxyBinaryPath)) {
      return {
        command: 'java',
        args: ['-Xms512M', '-Xmx1024M', '-jar', proxyBinaryPath],
      };
    }

    if (process.platform !== 'win32') {
      await fs.chmod(proxyBinaryPath, 0o755);
    }

    return {
      command: proxyBinaryPath,
      args: [],
    };
  }

  private generateSecret(): string {
    return crypto.randomBytes(24).toString('hex');
  }

  private getTargetProxyVersion(backendServers: ProxyBackendServer[]): string {
    return backendServers.find(server => server.version)?.version || 'latest';
  }

  private buildEffectiveConfig(
    rawConfig: ProxyNetworkConfig
  ): Required<Pick<ProxyNetworkConfig, 'bindAddress' | 'bindPort' | 'publicPort' | 'proxySecret'>> & ProxyNetworkConfig {
    const sanitizedSecret = typeof rawConfig.proxySecret === 'string'
      ? rawConfig.proxySecret.trim()
      : '';
    const proxySecret = sanitizedSecret && sanitizedSecret !== 'undefined' && sanitizedSecret !== 'null'
      ? sanitizedSecret
      : this.generateSecret();

    return {
      version: rawConfig.version ?? 3,
      bindAddress: rawConfig.bindAddress || '0.0.0.0',
      bindPort: rawConfig.bindPort || 24322,
      publicPort: rawConfig.publicPort || rawConfig.bindPort || 24322,
      proxySecret,
      debugMode: rawConfig.debugMode ?? false,
      defaultServer: rawConfig.defaultServer || '',
      fallbackServer: rawConfig.fallbackServer || '',
      poolEnabled: rawConfig.poolEnabled ?? false,
      pool: rawConfig.pool || {},
      routes: rawConfig.routes || [],
      ...rawConfig,
      publicAddress: rawConfig.publicAddress || 'play.myserver.com',
      certificatePath: rawConfig.certificatePath?.trim() || 'certs/server.crt',
      privateKeyPath: rawConfig.privateKeyPath?.trim() || 'certs/server.key',
    };
  }

  private isChildProcess(proc: ChildProcess | ProxyPty): proc is ChildProcess {
    return (proc as ChildProcess).exitCode !== undefined;
  }
}
