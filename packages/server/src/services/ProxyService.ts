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
  javaPath?: string;
  jvmArgs?: string;
  bindAddress?: string;
  bindPort?: number;
  publicAddress?: string;
  publicPort?: number;
  proxySecret?: string;
  autoInstallBridge?: boolean;
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
  proxyJarPath: string;
  bridgeJarPath: string | null;
  bridgePacketsJarPath: string | null;
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

    const config: Required<Pick<ProxyNetworkConfig, 'javaPath' | 'bindAddress' | 'bindPort' | 'publicPort' | 'proxySecret'>> & ProxyNetworkConfig = {
      javaPath: rawConfig.javaPath || 'java',
      bindAddress: rawConfig.bindAddress || '0.0.0.0',
      bindPort: rawConfig.bindPort || 45585,
      publicPort: rawConfig.publicPort || rawConfig.bindPort || 45585,
      proxySecret: rawConfig.proxySecret || this.generateSecret(),
      ...rawConfig,
    };

    const runtimePath = await this.ensureRuntimePath(networkId);
    const backendVersion = backendServers.find(b => b.version)?.version;
    const assets = await this.ensureAssets(backendVersion);

    await this.writeProxyConfig(runtimePath, backendServers, config);
    await this.startLogTail(networkId, path.join(runtimePath, 'logs', 'proxy.log'));

    if (config.autoInstallBridge !== false) {
      await this.installBridgeComponents(backendServers, assets, config.proxySecret);
    }

    const javaArgs = this.parseJvmArgs(config.jvmArgs);
    // Use absolute jar path so runtime cwd does not matter
    const args = [...javaArgs, '-jar', assets.proxyJarPath];

    logger.info(
      `[ProxyService] Starting proxy for network ${networkId} with command: ${config.javaPath} ${args.join(' ')}`
    );

    let childProcess: ChildProcess | ProxyPty;
    let usedPty = false;

    try {
      // Lazy-require to keep optional and avoid type dependency
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pty: any = require('node-pty');
      childProcess = pty.spawn(config.javaPath, args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: runtimePath,
        env: { ...process.env },
      });
      usedPty = true;
      logger.info('[ProxyService] node-pty detected, starting proxy with PTY for interactive console support');
    } catch (error) {
      logger.info('[ProxyService] node-pty unavailable, falling back to spawn (commands may be limited)');
      childProcess = spawn(config.javaPath, args, {
        cwd: runtimePath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
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
    this.stopLogTail(networkId);
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
      throw new Error('Could not find proxy binary in Numdrassl release');
    }

    const proxyJarPath = await this.downloadAsset(cacheRoot, proxyAsset.name, proxyAsset.browser_download_url);
    const bridgeJarPath = bridgeAsset
      ? await this.downloadAsset(cacheRoot, bridgeAsset.name, bridgeAsset.browser_download_url)
      : null;
    const bridgePacketsJarPath = bridgePacketsAsset
      ? await this.downloadAsset(cacheRoot, bridgePacketsAsset.name, bridgePacketsAsset.browser_download_url)
      : null;

    logger.info(
      `[ProxyService] Using proxy asset ${proxyAsset.name} for ${process.platform}/${process.arch} (cache: ${cacheRoot})`
    );

    return {
      proxyJarPath,
      bridgeJarPath,
      bridgePacketsJarPath,
    };
  }

  private async getRelease(version?: string): Promise<ReleaseResponse> {
    const baseUrl = 'https://api.github.com/repos/Numdrassl/proxy/releases';
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
      throw new Error(`Failed to fetch Numdrassl release${version ? ` for ${version}` : ''}: HTTP ${response.status} - ${details}`);
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
    const configPath = path.join(runtimePath, 'config', 'proxy.yml');
    const backendsBlock = backendServers
      .map((server, index) => {
        const host = this.resolveBackendHost(server.address);
        return [
          '  - name: "' + server.name + '"',
          '    host: "' + host + '"',
          `    port: ${server.port}`,
          `    defaultServer: ${index === 0 ? 'true' : 'false'}`,
        ].join('\n');
      })
      .join('\n\n');

    const publicAddress = config.publicAddress || config.bindAddress;
    const payload = [
      '# Auto-generated by Hytale Server Manager',
      `bindAddress: "${config.bindAddress}"`,
      `bindPort: ${config.bindPort}`,
      `publicAddress: "${publicAddress}"`,
      `publicPort: ${config.publicPort}`,
      `proxySecret: "${config.proxySecret}"`,
      'debugMode: true',
      '',
      'backends:',
      backendsBlock || '  []',
      '',
    ].join('\n');

    await fs.writeFile(configPath, payload, 'utf8');
  }

  private async installBridgeComponents(
    backendServers: ProxyBackendServer[],
    assets: AssetBundle,
    proxySecret: string
  ): Promise<void> {
    const hasBridge = Boolean(assets.bridgeJarPath);
    const hasPackets = Boolean(assets.bridgePacketsJarPath);
    if (!hasBridge || !hasPackets) {
      logger.warn(
        `[ProxyService] Bridge assets missing: bridge=${hasBridge} bridge-packets=${hasPackets}. ` +
        'Backends will not get bridge mods/plugins.'
      );
    }

    for (const server of backendServers) {
      const serverRoot = path.resolve(server.serverPath);
      const earlyPluginsPath = path.join(serverRoot, 'earlyplugins');
      const modsPath = path.join(serverRoot, 'mods');
      const pluginsPath = path.join(serverRoot, 'plugins');
      await fs.ensureDir(pluginsPath);
      await fs.ensureDir(earlyPluginsPath);
      await fs.ensureDir(modsPath);
      await fs.ensureDir(path.join(pluginsPath, 'Bridge'));

      if (assets.bridgeJarPath) {
        await fs.copyFile(assets.bridgeJarPath, path.join(modsPath, path.basename(assets.bridgeJarPath)));
        logger.info(
          `[ProxyService] Installed bridge jar to ${modsPath} for server ${server.name}`
        );
      }
      if (assets.bridgePacketsJarPath) {
        await fs.copyFile(
          assets.bridgePacketsJarPath,
          path.join(earlyPluginsPath, path.basename(assets.bridgePacketsJarPath))
        );
        logger.info(
          `[ProxyService] Installed bridge-packets jar to ${earlyPluginsPath} for server ${server.name}`
        );
      }

      const bridgeConfigPath = path.join(pluginsPath, 'Bridge', 'config.json');
      const bridgeConfig = {
        SecretKey: proxySecret,
        ServerName: server.name,
        proxySecret,
        serverName: server.name,
      };
      await fs.writeJson(bridgeConfigPath, bridgeConfig, { spaces: 2 });
    }
  }

  private parseJvmArgs(jvmArgs?: string): string[] {
    if (!jvmArgs?.trim()) {
      return ['-Xms512M', '-Xmx1024M'];
    }
    return jvmArgs.split(/\s+/).filter(Boolean);
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
   * Prefers arch-specific builds when available, otherwise falls back to the first generic jar.
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

    // Prefer platform+arch specific asset
    const exact = assets.find(
      a => /^proxy-.*\.jar$/i.test(a.name) && matches(a, archKeys) && matches(a, platformKeys)
    );
    if (exact) return exact;

    // Then arch-specific
    const archOnly = assets.find(a => /^proxy-.*\.jar$/i.test(a.name) && matches(a, archKeys));
    if (archOnly) return archOnly;

    // Fallback generic
    return assets.find(a => /^proxy-.*\.jar$/i.test(a.name));
  }

  private generateSecret(): string {
    return crypto.randomBytes(24).toString('hex');
  }

  private isChildProcess(proc: ChildProcess | ProxyPty): proc is ChildProcess {
    return (proc as ChildProcess).exitCode !== undefined;
  }
}
