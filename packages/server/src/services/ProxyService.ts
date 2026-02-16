import { ChildProcess, spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import { getBasePath_ } from '../config';
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
}

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface ReleaseResponse {
  assets: ReleaseAsset[];
}

interface AssetBundle {
  proxyJarPath: string;
  bridgeJarPath: string | null;
  bridgePacketsJarPath: string | null;
}

export class ProxyService {
  private processes = new Map<string, ChildProcess>();
  private statuses = new Map<string, 'stopped' | 'starting' | 'running' | 'stopping'>();
  private basePath: string;
  private cachePath: string;
  private runtimeRootPath: string;

  constructor() {
    this.basePath = getBasePath_();
    this.cachePath = path.join(this.basePath, 'data', 'proxy-cache');
    this.runtimeRootPath = path.join(this.basePath, 'data', 'proxy-networks');
  }

  getStatus(networkId: string): 'stopped' | 'starting' | 'running' | 'stopping' {
    return this.statuses.get(networkId) || 'stopped';
  }

  async startProxy(
    networkId: string,
    networkName: string,
    backendServers: ProxyBackendServer[],
    rawConfig: ProxyNetworkConfig
  ): Promise<void> {
    const current = this.processes.get(networkId);
    if (current && current.exitCode === null) {
      logger.info(`[ProxyService] Proxy already running for network ${networkId}`);
      this.statuses.set(networkId, 'running');
      return;
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
    const assets = await this.ensureAssets();

    await this.writeProxyConfig(runtimePath, backendServers, config);

    if (config.autoInstallBridge !== false) {
      await this.installBridgeComponents(backendServers, assets, config.proxySecret);
    }

    const javaArgs = this.parseJvmArgs(config.jvmArgs);
    const args = [...javaArgs, '-jar', path.basename(assets.proxyJarPath)];

    logger.info(
      `[ProxyService] Starting proxy for network ${networkId} with command: ${config.javaPath} ${args.join(' ')}`
    );

    const childProcess: ChildProcess = spawn(config.javaPath, args, {
      cwd: runtimePath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      windowsHide: true,
    });

    this.processes.set(networkId, childProcess);

    childProcess.stdout?.on('data', (data: Buffer) => {
      logger.info(`[Proxy ${networkName}] ${data.toString().trim()}`);
    });

    childProcess.stderr?.on('data', (data: Buffer) => {
      logger.warn(`[Proxy ${networkName}] ${data.toString().trim()}`);
    });

    childProcess.on('exit', (code: number | null) => {
      logger.info(`[ProxyService] Proxy for network ${networkId} exited with code ${code}`);
      this.processes.delete(networkId);
      this.statuses.set(networkId, 'stopped');
    });

    childProcess.on('error', (error: Error) => {
      logger.error(`[ProxyService] Proxy process error for network ${networkId}:`, error);
      this.processes.delete(networkId);
      this.statuses.set(networkId, 'stopped');
    });

    await new Promise(resolve => setTimeout(resolve, 1500));
    if (!this.processes.get(networkId) || childProcess.exitCode !== null) {
      this.statuses.set(networkId, 'stopped');
      throw new Error('Proxy process terminated unexpectedly during startup');
    }

    this.statuses.set(networkId, 'running');
  }

  async stopProxy(networkId: string): Promise<void> {
    const process = this.processes.get(networkId);
    if (!process) {
      this.statuses.set(networkId, 'stopped');
      return;
    }

    this.statuses.set(networkId, 'stopping');

    try {
      process.stdin?.write('stop\n');
    } catch {
      // Ignore stdin failures and fallback to kill
    }

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 10000);
      process.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    if (process.exitCode === null) {
      process.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    if (process.exitCode === null) {
      process.kill('SIGKILL');
    }

    this.processes.delete(networkId);
    this.statuses.set(networkId, 'stopped');
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

  private async ensureAssets(): Promise<AssetBundle> {
    await fs.ensureDir(this.cachePath);

    const release = await this.getLatestRelease();
    const proxyAsset = release.assets.find(asset => /^proxy-.*\.jar$/i.test(asset.name));
    const bridgeAsset = release.assets.find(asset => /^bridge-(?!packets).*\.jar$/i.test(asset.name));
    const bridgePacketsAsset = release.assets.find(asset => /^bridge-packets-.*\.jar$/i.test(asset.name));

    if (!proxyAsset) {
      throw new Error('Could not find proxy binary in latest Numdrassl release');
    }

    const proxyJarPath = await this.downloadAsset(proxyAsset.name, proxyAsset.browser_download_url);
    const bridgeJarPath = bridgeAsset
      ? await this.downloadAsset(bridgeAsset.name, bridgeAsset.browser_download_url)
      : null;
    const bridgePacketsJarPath = bridgePacketsAsset
      ? await this.downloadAsset(bridgePacketsAsset.name, bridgePacketsAsset.browser_download_url)
      : null;

    return {
      proxyJarPath,
      bridgeJarPath,
      bridgePacketsJarPath,
    };
  }

  private async getLatestRelease(): Promise<ReleaseResponse> {
    const response = await fetch('https://api.github.com/repos/Numdrassl/proxy/releases/latest', {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'HytaleServerManager/0.3',
      },
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Failed to fetch latest Numdrassl release: HTTP ${response.status} - ${details}`);
    }

    return response.json() as Promise<ReleaseResponse>;
  }

  private async downloadAsset(fileName: string, url: string): Promise<string> {
    const targetPath = path.join(this.cachePath, fileName);
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
      'debugMode: false',
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
    for (const server of backendServers) {
      const pluginsPath = path.join(server.serverPath, 'plugins');
      const earlyPluginsPath = path.join(server.serverPath, 'earlyplugins');
      await fs.ensureDir(pluginsPath);
      await fs.ensureDir(earlyPluginsPath);
      await fs.ensureDir(path.join(pluginsPath, 'Bridge'));

      if (assets.bridgeJarPath) {
        await fs.copyFile(assets.bridgeJarPath, path.join(pluginsPath, path.basename(assets.bridgeJarPath)));
      }
      if (assets.bridgePacketsJarPath) {
        await fs.copyFile(
          assets.bridgePacketsJarPath,
          path.join(earlyPluginsPath, path.basename(assets.bridgePacketsJarPath))
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

  private generateSecret(): string {
    return crypto.randomBytes(24).toString('hex');
  }
}
