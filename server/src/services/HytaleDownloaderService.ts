import path from 'path';
import fs from 'fs-extra';
import axios from 'axios';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { PrismaClient } from '@prisma/client';
import unzipper from 'unzipper';
import config, { getBasePath_ } from '../config';
import logger from '../utils/logger';

const prisma = new PrismaClient();

// ==========================================
// Types
// ==========================================

export interface TokenInfo {
  accessTokenExpiresAt: number | null;
  accessTokenExpiresIn: number | null;  // seconds remaining
  refreshTokenExpiresAt: number | null; // calculated: authenticatedAt + 30 days
  refreshTokenExpiresIn: number | null; // seconds remaining
  isAccessTokenExpired: boolean;
  isRefreshTokenExpired: boolean;
  branch: string | null;
}

export interface AutoRefreshSettings {
  enabled: boolean;
  intervalSeconds: number;
  lastRefresh: Date | null;
}

export interface HytaleDownloaderStatus {
  binaryInstalled: boolean;
  binaryVersion: string | null;
  binaryPath: string | null;
  isAuthenticated: boolean;
  accountEmail: string | null;
  lastBinaryCheck: Date | null;
  tokenInfo: TokenInfo | null;
  autoRefresh: AutoRefreshSettings;
}

export interface GameVersionInfo {
  version: string;
  patchline: string;
  checkedAt: Date;
}

export interface OAuthSession {
  sessionId: string;
  deviceCode: string;
  verificationUrl: string;
  expiresAt: Date;
  status: 'pending' | 'polling' | 'completed' | 'expired' | 'failed';
  error?: string;
}

export interface DownloadSession {
  sessionId: string;
  destinationPath: string;
  patchline: string;
  status: 'downloading' | 'extracting' | 'validating' | 'complete' | 'failed';
  progress: number;
  bytesDownloaded: number;
  totalBytes: number;
  speed: number;
  error?: string;
}

export interface DownloadOptions {
  destinationPath: string;
  patchline?: string;
  skipUpdateCheck?: boolean;
}

// ==========================================
// Service
// ==========================================

class HytaleDownloaderService extends EventEmitter {
  private dataDir: string;
  private cacheDir: string;
  private activeSessions: Map<string, ChildProcess> = new Map();
  private oauthSessions: Map<string, OAuthSession> = new Map();
  private downloadSessions: Map<string, DownloadSession> = new Map();
  private autoRefreshTimer: NodeJS.Timeout | null = null;
  private isAutoRefreshing: boolean = false;

  constructor() {
    super();
    this.dataDir = path.join(getBasePath_(), 'data', 'hytale-downloader');
    this.cacheDir = path.join(getBasePath_(), 'data', 'server_files');
    // Initialize auto-refresh on startup
    this.initAutoRefresh();
  }

  /**
   * Get cached server file path for a version
   */
  private getCacheFilePath(version: string, patchline: string): string {
    return path.join(this.cacheDir, `hytale-server-${patchline}-${version}.zip`);
  }

  /**
   * Check if a cached version exists
   */
  async hasCachedVersion(version: string, patchline: string): Promise<boolean> {
    const cachePath = this.getCacheFilePath(version, patchline);
    return fs.pathExists(cachePath);
  }

  /**
   * Extract a zip file using native system tools (handles large files)
   */
  private async extractZip(zipPath: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const isWindows = process.platform === 'win32';

      let command: string;
      let args: string[];

      if (isWindows) {
        // Use PowerShell's Expand-Archive for reliable extraction on Windows
        command = 'powershell.exe';
        args = [
          '-NoProfile',
          '-Command',
          `Expand-Archive -Path "${zipPath}" -DestinationPath "${destPath}" -Force`,
        ];
      } else {
        // Use unzip on Linux/Mac
        command = 'unzip';
        args = ['-o', zipPath, '-d', destPath];
      }

      logger.info(`[HytaleDownloader] Running extraction: ${command} ${args.join(' ')}`);

      const proc = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Extraction failed with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to start extraction: ${err.message}`));
      });
    });
  }

  /**
   * Initialize auto-refresh from saved settings
   */
  private async initAutoRefresh(): Promise<void> {
    try {
      const state = await prisma.hytaleDownloaderState.findUnique({
        where: { id: 'singleton' },
      });

      if (state?.autoRefreshEnabled && state?.isAuthenticated) {
        this.startAutoRefreshTimer(state.autoRefreshInterval);
        logger.info('[HytaleDownloader] Auto-refresh initialized with interval:', state.autoRefreshInterval, 'seconds');
      }
    } catch (err) {
      logger.error('[HytaleDownloader] Failed to initialize auto-refresh:', err);
    }
  }

  /**
   * Start the auto-refresh timer
   */
  private startAutoRefreshTimer(intervalSeconds: number): void {
    this.stopAutoRefreshTimer();

    const intervalMs = intervalSeconds * 1000;
    logger.info('[HytaleDownloader] Starting auto-refresh timer with interval:', intervalSeconds, 'seconds');

    this.autoRefreshTimer = setInterval(async () => {
      await this.performAutoRefresh();
    }, intervalMs);
  }

  /**
   * Stop the auto-refresh timer
   */
  private stopAutoRefreshTimer(): void {
    if (this.autoRefreshTimer) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
      logger.info('[HytaleDownloader] Auto-refresh timer stopped');
    }
  }

  /**
   * Perform the auto-refresh
   */
  private async performAutoRefresh(): Promise<void> {
    if (this.isAutoRefreshing) {
      logger.debug('[HytaleDownloader] Auto-refresh already in progress, skipping');
      return;
    }

    try {
      this.isAutoRefreshing = true;

      // Check if still authenticated
      const hasCredentials = await this.credentialsExist();
      if (!hasCredentials) {
        logger.warn('[HytaleDownloader] No credentials found, stopping auto-refresh');
        await this.setAutoRefreshSettings(false);
        return;
      }

      logger.info('[HytaleDownloader] Performing auto-refresh of token...');
      await this.refreshToken();

      // Update last refresh time
      await prisma.hytaleDownloaderState.update({
        where: { id: 'singleton' },
        data: { lastAutoRefresh: new Date() },
      });

      logger.info('[HytaleDownloader] Auto-refresh completed successfully');
      this.emit('token:refreshed');
    } catch (err) {
      logger.error('[HytaleDownloader] Auto-refresh failed:', err);
      this.emit('token:refresh-failed', err);
    } finally {
      this.isAutoRefreshing = false;
    }
  }

  /**
   * Get auto-refresh settings
   */
  async getAutoRefreshSettings(): Promise<AutoRefreshSettings> {
    const state = await prisma.hytaleDownloaderState.findUnique({
      where: { id: 'singleton' },
    });

    return {
      enabled: state?.autoRefreshEnabled ?? false,
      intervalSeconds: state?.autoRefreshInterval ?? 1800,
      lastRefresh: state?.lastAutoRefresh ?? null,
    };
  }

  /**
   * Set auto-refresh enabled/disabled
   */
  async setAutoRefreshSettings(enabled: boolean, intervalSeconds?: number): Promise<AutoRefreshSettings> {
    const currentSettings = await this.getAutoRefreshSettings();
    const newInterval = intervalSeconds ?? currentSettings.intervalSeconds;

    await prisma.hytaleDownloaderState.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        autoRefreshEnabled: enabled,
        autoRefreshInterval: newInterval,
      },
      update: {
        autoRefreshEnabled: enabled,
        autoRefreshInterval: newInterval,
      },
    });

    if (enabled) {
      // Check if authenticated before starting
      const hasCredentials = await this.credentialsExist();
      if (hasCredentials) {
        this.startAutoRefreshTimer(newInterval);
      } else {
        logger.warn('[HytaleDownloader] Cannot enable auto-refresh: not authenticated');
      }
    } else {
      this.stopAutoRefreshTimer();
    }

    logger.info('[HytaleDownloader] Auto-refresh settings updated:', { enabled, intervalSeconds: newInterval });

    return {
      enabled,
      intervalSeconds: newInterval,
      lastRefresh: currentSettings.lastRefresh,
    };
  }

  // ==========================================
  // Binary Management
  // ==========================================

  /**
   * Get the binary name for the current platform
   */
  private getBinaryName(): string {
    return process.platform === 'win32'
      ? 'hytale-downloader-windows-amd64.exe'
      : 'hytale-downloader-linux-amd64';
  }

  /**
   * Get the full path to the binary
   */
  getBinaryPath(): string {
    return path.join(this.dataDir, this.getBinaryName());
  }

  /**
   * Get the path to the credentials file
   */
  getCredentialsPath(): string {
    return path.join(this.dataDir, '.hytale-downloader-credentials.json');
  }

  /**
   * Check if the binary exists
   */
  async binaryExists(): Promise<boolean> {
    return fs.pathExists(this.getBinaryPath());
  }

  /**
   * Check if credentials file exists (basic auth check)
   */
  async credentialsExist(): Promise<boolean> {
    return fs.pathExists(this.getCredentialsPath());
  }

  /**
   * Read and parse the credentials file
   */
  async getCredentials(): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    branch: string;
  } | null> {
    const credPath = this.getCredentialsPath();
    if (!await fs.pathExists(credPath)) return null;

    try {
      const content = await fs.readJson(credPath);
      return {
        accessToken: content.access_token || '',
        refreshToken: content.refresh_token || '',
        expiresAt: content.expires_at || 0,
        branch: content.branch || 'release',
      };
    } catch (err) {
      logger.error('[HytaleDownloader] Failed to read credentials file:', err);
      return null;
    }
  }

  /**
   * Ensure data directory exists
   */
  private async ensureDataDir(): Promise<void> {
    await fs.ensureDir(this.dataDir);
  }

  /**
   * Download and install the hytale-downloader binary
   */
  async installBinary(): Promise<void> {
    const binaryUrl = 'https://downloader.hytale.com/hytale-downloader.zip';

    logger.info('[HytaleDownloader] Downloading binary from', binaryUrl);

    await this.ensureDataDir();

    const tempZipPath = path.join(this.dataDir, 'hytale-downloader-temp.zip');
    const extractPath = path.join(this.dataDir, 'extracted');

    try {
      // Download the zip file
      const response = await axios.get(binaryUrl, {
        responseType: 'stream',
        timeout: 60000, // 60 second timeout
        headers: {
          'User-Agent': 'HytaleServerManager/1.0',
          'Accept': 'application/octet-stream, application/zip, */*',
        },
      });

      const writer = fs.createWriteStream(tempZipPath);
      (response.data as NodeJS.ReadableStream).pipe(writer);

      await new Promise<void>((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      logger.info('[HytaleDownloader] Download complete, extracting...');

      // Extract the zip
      await fs.ensureDir(extractPath);
      await new Promise<void>((resolve, reject) => {
        fs.createReadStream(tempZipPath)
          .pipe(unzipper.Extract({ path: extractPath }))
          .on('close', resolve)
          .on('error', reject);
      });

      // Find and move the binary
      const binaryName = this.getBinaryName();
      const extractedFiles = await fs.readdir(extractPath);

      // Handle nested directories
      let sourceBinaryPath: string | null = null;

      for (const file of extractedFiles) {
        const filePath = path.join(extractPath, file);
        const stat = await fs.stat(filePath);

        if (stat.isFile() && file === binaryName) {
          sourceBinaryPath = filePath;
          break;
        } else if (stat.isDirectory()) {
          // Check inside directory
          const nestedBinary = path.join(filePath, binaryName);
          if (await fs.pathExists(nestedBinary)) {
            sourceBinaryPath = nestedBinary;
            break;
          }
        }
      }

      if (!sourceBinaryPath) {
        throw new Error(`Binary ${binaryName} not found in downloaded archive`);
      }

      // Move binary to final location
      const destPath = this.getBinaryPath();
      await fs.move(sourceBinaryPath, destPath, { overwrite: true });

      // Set executable permission on Linux
      if (process.platform !== 'win32') {
        await fs.chmod(destPath, 0o755);
      }

      // Get version and update database
      const version = await this.getToolVersion();
      await this.updateState({
        binaryPath: destPath,
        binaryVersion: version,
        lastBinaryCheck: new Date(),
      });

      logger.info('[HytaleDownloader] Binary installed successfully, version:', version);

    } finally {
      // Cleanup
      await fs.remove(tempZipPath).catch(() => {});
      await fs.remove(extractPath).catch(() => {});
    }
  }

  /**
   * Get the tool version by running -version
   */
  async getToolVersion(): Promise<string | null> {
    if (!(await this.binaryExists())) {
      return null;
    }

    return new Promise((resolve) => {
      const proc = spawn(this.getBinaryPath(), ['-version'], {
        cwd: this.dataDir,
        timeout: 10000,
      });

      let output = '';

      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', () => {
        // Parse version from output (format: "hytale-downloader version 2025.01.31-abc1234")
        const match = output.match(/version\s+(\S+)/i) || output.match(/(\d{4}\.\d{2}\.\d{2}[^\s]*)/);
        resolve(match ? match[1] : output.trim() || null);
      });

      proc.on('error', () => {
        resolve(null);
      });
    });
  }

  /**
   * Check for tool updates
   */
  async checkToolUpdate(): Promise<{ updateAvailable: boolean; currentVersion: string | null; latestVersion?: string; downloadUrl?: string }> {
    if (!(await this.binaryExists())) {
      return { updateAvailable: false, currentVersion: null };
    }

    return new Promise((resolve) => {
      const proc = spawn(this.getBinaryPath(), ['-check-update'], {
        cwd: this.dataDir,
        timeout: 30000,
      });

      let output = '';

      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', async () => {
        const currentVersion = await this.getToolVersion();

        // Parse output for update info
        // Expected: "A new version of hytale-downloader is available: 2025.01.31-abc1234 (current: 2025.01.15-def5678)"
        const updateMatch = output.match(/new version.*?available:\s*(\S+)/i);
        const downloadMatch = output.match(/Download.*?:\s*(https?:\/\/\S+)/i);

        if (updateMatch) {
          resolve({
            updateAvailable: true,
            currentVersion,
            latestVersion: updateMatch[1],
            downloadUrl: downloadMatch ? downloadMatch[1] : 'https://downloader.hytale.com/hytale-downloader.zip',
          });
        } else {
          resolve({ updateAvailable: false, currentVersion });
        }
      });

      proc.on('error', async () => {
        const currentVersion = await this.getToolVersion();
        resolve({ updateAvailable: false, currentVersion });
      });
    });
  }

  // ==========================================
  // OAuth Flow
  // ==========================================

  /**
   * Start OAuth device code flow
   */
  async startOAuthFlow(): Promise<OAuthSession> {
    if (!(await this.binaryExists())) {
      throw new Error('Hytale downloader binary not installed');
    }

    const sessionId = `oauth-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    logger.info('[HytaleDownloader] Starting OAuth flow, session:', sessionId);

    // Create initial session state
    const session: OAuthSession = {
      sessionId,
      deviceCode: '',
      verificationUrl: '',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minute default expiry
      status: 'pending',
    };
    this.oauthSessions.set(sessionId, session);

    // Spawn the process - just running the tool will trigger OAuth if not authenticated
    const proc = spawn(this.getBinaryPath(), ['-print-version'], {
      cwd: this.dataDir,
      env: { ...process.env },
    });

    this.activeSessions.set(sessionId, proc);

    let outputBuffer = '';

    // Ensure we get string data
    if (proc.stdout) {
      proc.stdout.setEncoding('utf8');
    }
    if (proc.stderr) {
      proc.stderr.setEncoding('utf8');
    }

    if (!proc.stdout) {
      logger.error('[HytaleDownloader] No stdout available from process');
    }

    proc.stdout?.on('data', (data) => {
      const text = data.toString();
      outputBuffer += text;
      logger.info('[HytaleDownloader] stdout:', text);

      // Skip if we already have the device code
      if (session.status !== 'pending') {
        return;
      }

      // Parse device code and URL from CLI output
      // The URL contains the device code as a query parameter:
      // https://oauth.accounts.hytale.com/oauth2/device/verify?user_code=XXXXXXXX

      const parseDeviceCodeAndUrl = (source: string): { url: string | null; deviceCode: string | null } => {
        // Extract the URL first
        const urlMatch = source.match(/(https?:\/\/[^\s<>"]+)/i);
        const url = urlMatch?.[1] || null;

        let deviceCode: string | null = null;

        // The device code is in the URL's user_code query parameter
        // Example: https://oauth.accounts.hytale.com/oauth2/device/verify?user_code=c3rzQPMY
        if (url) {
          const userCodeMatch = url.match(/[?&]user_code=([^&\s]+)/i);
          if (userCodeMatch) {
            deviceCode = userCodeMatch[1];
            logger.info('[HytaleDownloader] Extracted device code from URL:', deviceCode);
          }
        }

        // Fallback: look for code mentioned explicitly in the text (in case format changes)
        if (!deviceCode) {
          const sourceWithoutUrls = source.replace(/https?:\/\/[^\s<>"]+/gi, ' ');
          const explicitCodeMatch = sourceWithoutUrls.match(/code[:\s]+([A-Za-z0-9]{4,})/i);
          if (explicitCodeMatch) {
            deviceCode = explicitCodeMatch[1];
          }
        }

        return { url, deviceCode };
      };

      // Try current text first
      let { url, deviceCode } = parseDeviceCodeAndUrl(text);

      // If we don't have both from current text, try the full buffer
      if (!url || !deviceCode) {
        const bufferResult = parseDeviceCodeAndUrl(outputBuffer);
        url = url || bufferResult.url;
        deviceCode = deviceCode || bufferResult.deviceCode;
      }

      logger.info('[HytaleDownloader] Parsed - url:', url, 'deviceCode:', deviceCode);

      // Only update if we have BOTH url and code, and code doesn't look like a URL
      if (url && deviceCode && !deviceCode.startsWith('http') && !deviceCode.includes('://')) {
        session.deviceCode = deviceCode;
        session.verificationUrl = url;
        session.status = 'polling';
        this.oauthSessions.set(sessionId, session);

        this.emit('oauth:device-code', {
          sessionId,
          deviceCode: session.deviceCode,
          verificationUrl: session.verificationUrl,
          expiresAt: session.expiresAt,
        });

        logger.info('[HytaleDownloader] Device code received:', session.deviceCode);
      }

      // Check for successful auth (tool continues to print version after auth)
      if (session.status === 'polling' && text.match(/\d{4}\.\d{2}\.\d{2}/)) {
        session.status = 'completed';
        this.oauthSessions.set(sessionId, session);

        // Update database state
        this.updateAuthState(true).catch(err =>
          logger.error('[HytaleDownloader] Failed to update auth state:', err)
        );

        this.emit('oauth:status', { sessionId, status: 'completed' });
        logger.info('[HytaleDownloader] OAuth completed successfully');
      }
    });

    proc.stderr?.on('data', (data) => {
      const text = data.toString();
      outputBuffer += text;
      logger.info('[HytaleDownloader] stderr:', text);

      // Skip if we already have the device code
      if (session.status !== 'pending') {
        return;
      }

      // Also check stderr for device code (some tools output there)
      // Use same parsing logic as stdout
      const parseDeviceCodeAndUrl = (source: string): { url: string | null; deviceCode: string | null } => {
        // Extract the URL first
        const urlMatch = source.match(/(https?:\/\/[^\s<>"]+)/i);
        const url = urlMatch?.[1] || null;

        let deviceCode: string | null = null;

        // The device code is in the URL's user_code query parameter
        // Example: https://oauth.accounts.hytale.com/oauth2/device/verify?user_code=c3rzQPMY
        if (url) {
          const userCodeMatch = url.match(/[?&]user_code=([^&\s]+)/i);
          if (userCodeMatch) {
            deviceCode = userCodeMatch[1];
          }
        }

        // Fallback: look for code mentioned explicitly in the text
        if (!deviceCode) {
          const sourceWithoutUrls = source.replace(/https?:\/\/[^\s<>"]+/gi, ' ');
          const explicitCodeMatch = sourceWithoutUrls.match(/code[:\s]+([A-Za-z0-9]{4,})/i);
          if (explicitCodeMatch) {
            deviceCode = explicitCodeMatch[1];
          }
        }

        return { url, deviceCode };
      };

      let { url, deviceCode } = parseDeviceCodeAndUrl(text);

      if (!url || !deviceCode) {
        const bufferResult = parseDeviceCodeAndUrl(outputBuffer);
        url = url || bufferResult.url;
        deviceCode = deviceCode || bufferResult.deviceCode;
      }

      logger.info('[HytaleDownloader] stderr Parsed - url:', url, 'deviceCode:', deviceCode);

      // Only update if we have BOTH url and code, and code doesn't look like URL
      if (url && deviceCode && !deviceCode.startsWith('http') && !deviceCode.includes('://')) {
        session.deviceCode = deviceCode;
        session.verificationUrl = url;
        session.status = 'polling';
        this.oauthSessions.set(sessionId, session);

        this.emit('oauth:device-code', {
          sessionId,
          deviceCode: session.deviceCode,
          verificationUrl: session.verificationUrl,
          expiresAt: session.expiresAt,
        });
      }
    });

    proc.on('close', async (code) => {
      logger.info('[HytaleDownloader] OAuth process exited with code:', code);
      logger.info('[HytaleDownloader] Full output buffer:', outputBuffer);
      this.activeSessions.delete(sessionId);

      const currentSession = this.oauthSessions.get(sessionId);
      if (!currentSession) return;

      // Check if credentials exist (user might already be authenticated)
      const hasCredentials = await this.credentialsExist();

      if (currentSession.status === 'pending') {
        // Never got device code - check if already authenticated
        if (hasCredentials && code === 0) {
          // CLI exited successfully without prompting for auth - already authenticated
          logger.info('[HytaleDownloader] Already authenticated (no OAuth prompt needed)');
          currentSession.status = 'completed';
          await this.updateAuthState(true);
          this.emit('oauth:status', { sessionId, status: 'completed' });
        } else if (code !== 0) {
          // CLI failed
          currentSession.status = 'failed';
          currentSession.error = `Process exited with code ${code}. Output: ${outputBuffer.substring(0, 500)}`;
          this.emit('oauth:status', { sessionId, status: 'failed', error: currentSession.error });
        } else {
          // CLI exited with code 0 but no credentials - unexpected
          currentSession.status = 'failed';
          currentSession.error = 'Authentication did not complete. Please try again.';
          this.emit('oauth:status', { sessionId, status: 'failed', error: currentSession.error });
        }
      } else if (currentSession.status === 'polling') {
        // Was waiting for user to authenticate
        if (hasCredentials) {
          currentSession.status = 'completed';
          await this.updateAuthState(true);
          this.emit('oauth:status', { sessionId, status: 'completed' });
        } else if (code !== 0) {
          currentSession.status = 'failed';
          currentSession.error = 'Authentication process failed';
          this.emit('oauth:status', { sessionId, status: 'failed', error: currentSession.error });
        }
      }
      this.oauthSessions.set(sessionId, currentSession);
    });

    proc.on('error', (err) => {
      logger.error('[HytaleDownloader] OAuth process error:', err);
      session.status = 'failed';
      session.error = err.message;
      this.oauthSessions.set(sessionId, session);
      this.activeSessions.delete(sessionId);
      this.emit('oauth:status', { sessionId, status: 'failed', error: err.message });
    });

    // Wait a moment for initial output
    await new Promise(resolve => setTimeout(resolve, 2000));

    const finalSession = this.oauthSessions.get(sessionId)!;
    logger.info('[HytaleDownloader] Returning OAuth session:', JSON.stringify(finalSession));
    return finalSession;
  }

  /**
   * Get OAuth session status
   */
  getOAuthSession(sessionId: string): OAuthSession | undefined {
    return this.oauthSessions.get(sessionId);
  }

  /**
   * Cancel an OAuth flow
   */
  cancelOAuthFlow(sessionId: string): void {
    const proc = this.activeSessions.get(sessionId);
    if (proc) {
      proc.kill();
      this.activeSessions.delete(sessionId);
    }
    const session = this.oauthSessions.get(sessionId);
    if (session) {
      session.status = 'expired';
      this.oauthSessions.set(sessionId, session);
    }
  }

  /**
   * Clear stored credentials
   */
  async clearCredentials(): Promise<void> {
    const credPath = this.getCredentialsPath();
    if (await fs.pathExists(credPath)) {
      await fs.remove(credPath);
    }
    await this.updateAuthState(false);
    logger.info('[HytaleDownloader] Credentials cleared');
  }

  /**
   * Refresh the OAuth token
   * The CLI binary handles token refresh automatically when running commands
   */
  async refreshToken(): Promise<TokenInfo | null> {
    if (!(await this.binaryExists())) {
      throw new Error('Hytale downloader binary not installed');
    }

    if (!(await this.credentialsExist())) {
      throw new Error('Not authenticated. Please authenticate first.');
    }

    logger.info('[HytaleDownloader] Refreshing token...');

    // Running any CLI command triggers automatic token refresh if needed
    // We use -print-version as it's a quick, read-only operation
    await this.getGameVersion();

    // Re-read credentials to get updated expiry
    const credentials = await this.getCredentials();
    if (!credentials) {
      throw new Error('Failed to read credentials after refresh');
    }

    // Update authenticatedAt to track when we last refreshed
    await this.updateAuthState(true);

    const now = Math.floor(Date.now() / 1000);
    const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60;

    const accessTokenExpiresAt = credentials.expiresAt || null;
    const accessTokenExpiresIn = accessTokenExpiresAt
      ? Math.max(0, accessTokenExpiresAt - now)
      : null;
    const isAccessTokenExpired = accessTokenExpiresAt ? accessTokenExpiresAt <= now : false;

    // For refresh token, use current time + 30 days as new baseline
    const refreshTokenExpiresAt = now + REFRESH_TOKEN_TTL;
    const refreshTokenExpiresIn = REFRESH_TOKEN_TTL;

    logger.info('[HytaleDownloader] Token refreshed successfully');

    return {
      accessTokenExpiresAt,
      accessTokenExpiresIn,
      refreshTokenExpiresAt,
      refreshTokenExpiresIn,
      isAccessTokenExpired,
      isRefreshTokenExpired: false,
      branch: credentials.branch,
    };
  }

  // ==========================================
  // Download Flow
  // ==========================================

  /**
   * Get game version info
   */
  async getGameVersion(patchline?: string): Promise<GameVersionInfo | null> {
    if (!(await this.binaryExists())) {
      return null;
    }

    const args = ['-print-version'];
    if (patchline) {
      args.push('-patchline', patchline);
    }

    return new Promise((resolve) => {
      const proc = spawn(this.getBinaryPath(), args, {
        cwd: this.dataDir,
        timeout: 30000,
      });

      let output = '';

      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          resolve(null);
          return;
        }

        // Parse version from output
        const versionMatch = output.match(/(\d{4}\.\d{2}\.\d{2}[^\s]*)/);
        if (versionMatch) {
          resolve({
            version: versionMatch[1],
            patchline: patchline || 'release',
            checkedAt: new Date(),
          });
        } else {
          resolve(null);
        }
      });

      proc.on('error', () => {
        resolve(null);
      });
    });
  }

  /**
   * Start server download
   */
  async startDownload(options: DownloadOptions): Promise<DownloadSession> {
    if (!(await this.binaryExists())) {
      throw new Error('Hytale downloader binary not installed');
    }

    if (!(await this.credentialsExist())) {
      throw new Error('Not authenticated. Please authenticate first.');
    }

    const sessionId = `download-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Determine the actual download path
    // If destinationPath is a directory, append the default filename
    let downloadPath = options.destinationPath;

    // Ensure the path is absolute - use serversBasePath for relative paths
    // This ensures consistency with ServerService which also uses serversBasePath
    if (!path.isAbsolute(downloadPath)) {
      downloadPath = path.join(config.serversBasePath, path.basename(downloadPath));
    }

    // Check if it's a directory (or looks like one - no extension)
    const hasExtension = path.extname(downloadPath).length > 0;
    const isExistingDir = await fs.pathExists(downloadPath) && (await fs.stat(downloadPath)).isDirectory();

    if (isExistingDir || !hasExtension) {
      // Ensure the directory exists
      await fs.ensureDir(downloadPath);
      // Append default filename
      downloadPath = path.join(downloadPath, 'hytale-server.zip');
    }

    const patchline = options.patchline || 'release';
    const extractPath = path.dirname(downloadPath);

    logger.info(`[HytaleDownloader] Starting download, session: ${sessionId}, path: ${downloadPath}`);

    // Check if we have a cached version available
    const currentVersion = await this.getGameVersion(patchline);
    if (currentVersion?.version) {
      const hasCached = await this.hasCachedVersion(currentVersion.version, patchline);
      if (hasCached) {
        logger.info(`[HytaleDownloader] Found cached version: ${currentVersion.version}`);

        // Create session for cache extraction
        const session: DownloadSession = {
          sessionId,
          destinationPath: extractPath,
          patchline,
          status: 'extracting',
          progress: 100,
          bytesDownloaded: 0,
          totalBytes: 0,
          speed: 0,
        };
        this.downloadSessions.set(sessionId, session);

        // Emit extracting status
        this.emit('download:progress', {
          sessionId,
          progress: 100,
          bytesDownloaded: 0,
          totalBytes: 0,
          speed: 0,
          status: 'extracting',
        });

        // Extract from cache
        const cachePath = this.getCacheFilePath(currentVersion.version, patchline);
        try {
          await fs.ensureDir(extractPath);
          await this.extractZip(cachePath, extractPath);

          logger.info(`[HytaleDownloader] Extracted from cache to ${extractPath}`);

          session.status = 'complete';
          this.downloadSessions.set(sessionId, session);
          this.emit('download:complete', {
            sessionId,
            outputPath: extractPath,
          });

          return session;
        } catch (cacheError: any) {
          logger.warn(`[HytaleDownloader] Cache extraction failed, will download fresh: ${cacheError.message}`);
          // Continue to download if cache extraction fails
        }
      }
    }

    // Create session state
    const session: DownloadSession = {
      sessionId,
      destinationPath: downloadPath,
      patchline,
      status: 'downloading',
      progress: 0,
      bytesDownloaded: 0,
      totalBytes: 0,
      speed: 0,
    };
    this.downloadSessions.set(sessionId, session);

    // Build command args
    const args: string[] = [];

    if (downloadPath) {
      args.push('-download-path', downloadPath);
    }

    if (options.patchline) {
      args.push('-patchline', options.patchline);
    }

    if (options.skipUpdateCheck) {
      args.push('-skip-update-check');
    }

    // Log the full command for debugging
    const binaryPath = this.getBinaryPath();
    const credentialsPath = this.getCredentialsPath();

    // Verify files exist before spawning
    const binaryExists = await fs.pathExists(binaryPath);
    const credsExist = await fs.pathExists(credentialsPath);
    logger.info(`[HytaleDownloader] Binary exists: ${binaryExists} at ${binaryPath}`);
    logger.info(`[HytaleDownloader] Credentials exist: ${credsExist} at ${credentialsPath}`);
    logger.info(`[HytaleDownloader] Executing: ${binaryPath} with args: ${args.join(' ')}`);
    logger.info(`[HytaleDownloader] Working directory: ${this.dataDir}`);

    // Spawn download process
    // Use shell on Windows to better capture output
    const isWindows = process.platform === 'win32';
    const proc = spawn(binaryPath, args, {
      cwd: this.dataDir,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: isWindows,
      windowsHide: true,
    });

    this.activeSessions.set(sessionId, proc);

    let lastSpeedCalcTime = Date.now();
    let lastBytesDownloaded = 0;

    const parseProgress = (text: string) => {
      // Parse progress output - adapt to actual CLI output format
      // Common formats:
      // "Downloading: 45% (100MB/220MB)"
      // "Downloaded 100MB of 220MB (45%)"
      // Progress bar with percentage

      const percentMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
      const bytesMatch = text.match(/(\d+(?:\.\d+)?)\s*(MB|GB|KB|B)\s*(?:of|\/)\s*(\d+(?:\.\d+)?)\s*(MB|GB|KB|B)/i);

      if (percentMatch) {
        session.progress = parseFloat(percentMatch[1]);
      }

      if (bytesMatch) {
        const downloaded = parseFloat(bytesMatch[1]) * this.getByteMultiplier(bytesMatch[2]);
        const total = parseFloat(bytesMatch[3]) * this.getByteMultiplier(bytesMatch[4]);
        session.bytesDownloaded = downloaded;
        session.totalBytes = total;

        // Calculate speed
        const now = Date.now();
        const timeDiff = (now - lastSpeedCalcTime) / 1000;
        if (timeDiff >= 1) {
          session.speed = (downloaded - lastBytesDownloaded) / timeDiff;
          lastBytesDownloaded = downloaded;
          lastSpeedCalcTime = now;
        }
      }

      // Check for extraction phase
      if (text.match(/extract/i)) {
        session.status = 'extracting';
      }

      // Check for validation phase
      if (text.match(/validat|verify|checksum/i)) {
        session.status = 'validating';
      }

      this.downloadSessions.set(sessionId, session);
      this.emit('download:progress', {
        sessionId,
        progress: session.progress,
        bytesDownloaded: session.bytesDownloaded,
        totalBytes: session.totalBytes,
        speed: session.speed,
        status: session.status,
      });
    };

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      logger.debug('[HytaleDownloader] download stdout:', text);
      parseProgress(text);
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      logger.debug('[HytaleDownloader] download stderr:', text);
      parseProgress(text);
    });

    proc.on('close', async (code, signal) => {
      logger.info(`[HytaleDownloader] Download process exited with code: ${code}, signal: ${signal}`);
      this.activeSessions.delete(sessionId);

      if (code === 0) {
        // Download complete, now extract
        session.status = 'extracting';
        session.progress = 100;
        this.downloadSessions.set(sessionId, session);
        this.emit('download:progress', {
          sessionId,
          progress: 100,
          bytesDownloaded: session.bytesDownloaded,
          totalBytes: session.totalBytes,
          speed: 0,
          status: 'extracting',
        });

        // Extract to the parent directory of the zip file
        const extractPath = path.dirname(session.destinationPath);
        logger.info(`[HytaleDownloader] Extracting ${session.destinationPath} to ${extractPath}`);

        try {
          // Use native tar command for extraction (handles large files)
          // Windows 10+ has tar built-in that supports zip files
          await this.extractZip(session.destinationPath, extractPath);

          logger.info(`[HytaleDownloader] Extraction complete`);

          // Cache the zip file for future use (before deleting)
          const patchline = session.patchline || 'release';
          const version = await this.getGameVersion(patchline);
          if (version?.version) {
            const cachePath = this.getCacheFilePath(version.version, patchline);
            await fs.ensureDir(this.cacheDir);
            await fs.copy(session.destinationPath, cachePath);
            logger.info(`[HytaleDownloader] Cached server files: ${cachePath}`);
          }

          // Delete the zip file after extraction and caching
          await fs.remove(session.destinationPath);
          logger.info(`[HytaleDownloader] Removed zip file: ${session.destinationPath}`);

          session.status = 'complete';
          session.destinationPath = extractPath; // Update to extracted path
          this.downloadSessions.set(sessionId, session);
          this.emit('download:complete', {
            sessionId,
            outputPath: extractPath,
          });
        } catch (extractError: any) {
          logger.error(`[HytaleDownloader] Extraction failed:`, extractError);
          session.status = 'failed';
          session.error = `Extraction failed: ${extractError.message}`;
          this.downloadSessions.set(sessionId, session);
          this.emit('download:error', {
            sessionId,
            error: session.error,
          });
        }
      } else {
        session.status = 'failed';
        session.error = `Download failed with exit code ${code}`;
        this.emit('download:error', {
          sessionId,
          error: session.error,
        });
        this.downloadSessions.set(sessionId, session);
      }
    });

    proc.on('error', (err) => {
      logger.error('[HytaleDownloader] Download process error:', err);
      session.status = 'failed';
      session.error = err.message;
      this.downloadSessions.set(sessionId, session);
      this.activeSessions.delete(sessionId);
      this.emit('download:error', { sessionId, error: err.message });
    });

    return session;
  }

  /**
   * Get download session status
   */
  getDownloadSession(sessionId: string): DownloadSession | undefined {
    return this.downloadSessions.get(sessionId);
  }

  /**
   * Cancel a download
   */
  cancelDownload(sessionId: string): void {
    const proc = this.activeSessions.get(sessionId);
    if (proc) {
      proc.kill();
      this.activeSessions.delete(sessionId);
    }
    const session = this.downloadSessions.get(sessionId);
    if (session) {
      session.status = 'failed';
      session.error = 'Download cancelled by user';
      this.downloadSessions.set(sessionId, session);
      this.emit('download:error', { sessionId, error: session.error });
    }
  }

  // ==========================================
  // State Management
  // ==========================================

  /**
   * Get current status
   */
  async getStatus(): Promise<HytaleDownloaderStatus> {
    const state = await prisma.hytaleDownloaderState.findUnique({
      where: { id: 'singleton' },
    });

    const binaryInstalled = await this.binaryExists();
    const credentialsExist = await this.credentialsExist();
    const isAuthenticated = credentialsExist && (state?.isAuthenticated ?? false);

    // Get token info if authenticated
    let tokenInfo: TokenInfo | null = null;
    if (isAuthenticated) {
      const credentials = await this.getCredentials();
      if (credentials) {
        const now = Math.floor(Date.now() / 1000);

        // Access token expiry (from credentials file)
        const accessTokenExpiresAt = credentials.expiresAt || null;
        const accessTokenExpiresIn = accessTokenExpiresAt
          ? Math.max(0, accessTokenExpiresAt - now)
          : null;
        const isAccessTokenExpired = accessTokenExpiresAt ? accessTokenExpiresAt <= now : false;

        // Refresh token expiry (30 days from authenticatedAt)
        // If we don't have authenticatedAt, estimate from access token expiry
        // (access token is 1 hour, so refresh token issued at expiresAt - 3600)
        const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days in seconds
        let refreshTokenExpiresAt: number | null = null;

        if (state?.authenticatedAt) {
          refreshTokenExpiresAt = Math.floor(state.authenticatedAt.getTime() / 1000) + REFRESH_TOKEN_TTL;
        } else if (accessTokenExpiresAt) {
          // Estimate: access token expires in 1 hour from issue
          const estimatedIssueTime = accessTokenExpiresAt - 3600;
          refreshTokenExpiresAt = estimatedIssueTime + REFRESH_TOKEN_TTL;
        }

        const refreshTokenExpiresIn = refreshTokenExpiresAt
          ? Math.max(0, refreshTokenExpiresAt - now)
          : null;
        const isRefreshTokenExpired = refreshTokenExpiresAt ? refreshTokenExpiresAt <= now : false;

        tokenInfo = {
          accessTokenExpiresAt,
          accessTokenExpiresIn,
          refreshTokenExpiresAt,
          refreshTokenExpiresIn,
          isAccessTokenExpired,
          isRefreshTokenExpired,
          branch: credentials.branch,
        };
      }
    }

    return {
      binaryInstalled,
      binaryVersion: state?.binaryVersion || null,
      binaryPath: binaryInstalled ? this.getBinaryPath() : null,
      isAuthenticated,
      accountEmail: state?.accountEmail || null,
      lastBinaryCheck: state?.lastBinaryCheck || null,
      tokenInfo,
      autoRefresh: {
        enabled: state?.autoRefreshEnabled ?? false,
        intervalSeconds: state?.autoRefreshInterval ?? 1800,
        lastRefresh: state?.lastAutoRefresh ?? null,
      },
    };
  }

  /**
   * Update state in database
   */
  private async updateState(updates: {
    binaryVersion?: string | null;
    binaryPath?: string | null;
    lastBinaryCheck?: Date;
    isAuthenticated?: boolean;
    accountEmail?: string | null;
    authenticatedAt?: Date;
  }): Promise<void> {
    await prisma.hytaleDownloaderState.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        ...updates,
      },
      update: updates,
    });
  }

  /**
   * Update authentication state
   */
  private async updateAuthState(isAuthenticated: boolean, accountEmail?: string): Promise<void> {
    await this.updateState({
      isAuthenticated,
      accountEmail: accountEmail || null,
      authenticatedAt: isAuthenticated ? new Date() : undefined,
    });
  }

  // ==========================================
  // Helpers
  // ==========================================

  private getByteMultiplier(unit: string): number {
    switch (unit.toUpperCase()) {
      case 'GB': return 1024 * 1024 * 1024;
      case 'MB': return 1024 * 1024;
      case 'KB': return 1024;
      default: return 1;
    }
  }

  /**
   * Cleanup on shutdown
   */
  cleanup(): void {
    // Stop auto-refresh timer
    this.stopAutoRefreshTimer();

    for (const [sessionId, proc] of this.activeSessions) {
      logger.info('[HytaleDownloader] Killing session on cleanup:', sessionId);
      proc.kill();
    }
    this.activeSessions.clear();
  }
}

export const hytaleDownloaderService = new HytaleDownloaderService();
