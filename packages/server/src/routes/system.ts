import { Router, Request, Response } from 'express';
import os from 'os';
import fs from 'fs-extra';
import path from 'path';
import config, { VERSION, VERSION_NAME, getConfigPath_, getBasePath_ } from '../config';
import logger from '../utils/logger';
import { updateService } from '../services/UpdateService';

const router = Router();

// GitHub Release API response type
interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  published_at: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
  }>;
}

// Script info for update instructions
interface ScriptInfo {
  filename: string;
  instructions: string[];
}

interface UpdateScripts {
  windows: ScriptInfo;
  linux: ScriptInfo;
}

/**
 * Get platform-specific update script instructions
 */
function getUpdateScriptInfo(githubRepo: string): UpdateScripts {
  const repoUrl = `https://github.com/${githubRepo}`;
  return {
    windows: {
      filename: 'update.ps1',
      instructions: [
        'Stop the Hytale Server Manager service if running',
        'Open PowerShell as Administrator',
        `Download the update script from: ${repoUrl}/raw/main/scripts/windows/update.ps1`,
        'Navigate to your installation directory (default: C:\\HytaleServerManager)',
        'Run: .\\update.ps1',
      ],
    },
    linux: {
      filename: 'update.sh',
      instructions: [
        'Stop the hytale-manager service: sudo systemctl stop hytale-manager',
        `Download the update script: curl -O ${repoUrl}/raw/main/scripts/linux/update.sh`,
        'Make it executable: chmod +x update.sh',
        'Run with sudo: sudo ./update.sh',
      ],
    },
  };
}

/**
 * GET /api/system/version
 * Get current application version and update info
 */
router.get('/version', (_req: Request, res: Response) => {
  res.json({
    version: VERSION,
    versionName: VERSION_NAME,
    nodeVersion: process.version,
    platform: os.platform(),
    arch: os.arch(),
  });
});

/**
 * GET /api/system/health
 * Health check endpoint
 */
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: VERSION,
  });
});

/**
 * GET /api/system/info
 * Get system information (requires authentication in production)
 */
router.get('/info', (_req: Request, res: Response) => {
  const info = {
    app: {
      version: VERSION,
      versionName: VERSION_NAME,
      nodeEnv: config.nodeEnv,
      configPath: getConfigPath_(),
      basePath: getBasePath_(),
    },
    system: {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      cpus: os.cpus().length,
      totalMemory: Math.round(os.totalmem() / 1024 / 1024 / 1024 * 100) / 100,
      freeMemory: Math.round(os.freemem() / 1024 / 1024 / 1024 * 100) / 100,
      uptime: os.uptime(),
      nodeVersion: process.version,
    },
    paths: {
      data: config.dataPath,
      servers: config.serversBasePath,
      backups: config.backupsBasePath,
      logs: config.logsPath,
    },
    features: {
      discord: config.discord.enabled,
      ftp: config.ftp.enabled,
      updateCheck: config.updates.checkOnStartup,
    },
  };

  res.json(info);
});

/**
 * GET /api/system/updates/check
 * Check for available updates from GitHub
 */
router.get('/updates/check', async (_req: Request, res: Response) => {
  try {
    const { githubRepo } = config.updates;

    // When running in Docker, skip GitHub API and return simplified response
    if (config.isDocker) {
      res.json({
        updateAvailable: false,
        currentVersion: VERSION,
        isDocker: true,
        message: 'Running in Docker - update via container image',
        checkedAt: new Date().toISOString(),
      });
      return;
    }

    if (!githubRepo || githubRepo === 'yourusername/hytale-server-manager') {
      res.json({
        updateAvailable: false,
        currentVersion: VERSION,
        message: 'Update checking not configured. Set updates.githubRepo in config.json',
        scripts: getUpdateScriptInfo('yourusername/hytale-server-manager'),
        checkedAt: new Date().toISOString(),
      });
      return;
    }

    // Fetch latest release from GitHub API
    const response = await fetch(`https://api.github.com/repos/${githubRepo}/releases/latest`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'HytaleServerManager',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        res.json({
          updateAvailable: false,
          currentVersion: VERSION,
          message: 'No releases found',
          scripts: getUpdateScriptInfo(githubRepo),
          checkedAt: new Date().toISOString(),
        });
        return;
      }
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const release = await response.json() as GitHubRelease;
    const latestVersion = release.tag_name.replace(/^v/, '');
    const updateAvailable = compareVersions(latestVersion, VERSION) > 0;

    res.json({
      updateAvailable,
      currentVersion: VERSION,
      latestVersion,
      releaseUrl: release.html_url,
      releaseName: release.name,
      releaseNotes: release.body,
      publishedAt: release.published_at,
      downloadUrl: getDownloadUrl(release.assets),
      scripts: getUpdateScriptInfo(githubRepo),
      checkedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error('Error checking for updates:', error);
    res.status(500).json({
      error: 'Failed to check for updates',
      message: error.message,
      currentVersion: VERSION,
      scripts: getUpdateScriptInfo(config.updates.githubRepo || 'yourusername/hytale-server-manager'),
      checkedAt: new Date().toISOString(),
    });
  }
});

/**
 * Compare two semantic versions
 * Returns: 1 if a > b, -1 if a < b, 0 if equal
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);

  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;

    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }

  return 0;
}

/**
 * Get the appropriate download URL based on platform
 */
function getDownloadUrl(assets: any[]): string | null {
  const platform = os.platform();
  const patterns: Record<string, RegExp> = {
    win32: /windows.*\.zip$/i,
    linux: /linux.*\.tar\.gz$/i,
    darwin: /darwin|macos.*\.tar\.gz$/i,
  };

  const pattern = patterns[platform];
  if (!pattern) return null;

  const asset = assets.find((a: any) => pattern.test(a.name));
  return asset?.browser_download_url || null;
}

interface ParsedLogEntry {
  timestamp: string;
  level: 'error' | 'warn' | 'info' | 'debug';
  message: string;
}

// HTTP request log pattern (Morgan logs) - filter these out from HSM logs
const HTTP_REQUEST_PATTERN = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\//;

/**
 * Parse a Winston log line into structured format
 * Expected format: "2024-01-15 10:30:45 [INFO]: Log message here"
 */
function parseLogLine(line: string, excludeHttpLogs: boolean = true): ParsedLogEntry | null {
  // Match Winston default format: "YYYY-MM-DD HH:mm:ss [LEVEL]: message"
  const match = line.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+\[(\w+)\]:\s*(.*)$/);
  if (match) {
    const [, timestamp, level, message] = match;
    const normalizedLevel = level.toLowerCase() as ParsedLogEntry['level'];
    if (['error', 'warn', 'info', 'debug'].includes(normalizedLevel)) {
      // Filter out HTTP request logs (Morgan middleware logs) if requested
      if (excludeHttpLogs && HTTP_REQUEST_PATTERN.test(message)) {
        return null;
      }
      return { timestamp, level: normalizedLevel, message };
    }
  }
  // Return null for unparseable lines instead of fallback
  return null;
}

/**
 * GET /api/system/logs
 * Get recent application logs with optional level filtering
 *
 * Query params:
 * - lines: number of lines to return (default: 100)
 * - level: filter by log level (error, warn, info, debug)
 * - includeHttp: include HTTP request logs (default: false)
 */
router.get('/logs', async (req: Request, res: Response) => {
  try {
    const lines = parseInt(req.query.lines as string) || 100;
    const levelFilter = req.query.level as string | undefined;
    const includeHttp = req.query.includeHttp === 'true';
    const logFile = path.join(config.logsPath, 'combined.log');

    if (!await fs.pathExists(logFile)) {
      res.json({ logs: [], message: 'No log file found' });
      return;
    }

    const content = await fs.readFile(logFile, 'utf-8');
    const logLines = content.trim().split('\n');

    // Parse all log lines into structured format (filter HTTP logs by default)
    let parsedLogs = logLines
      .map(line => parseLogLine(line, !includeHttp))
      .filter((log): log is ParsedLogEntry => log !== null);

    // Apply level filter if specified
    if (levelFilter && ['error', 'warn', 'info', 'debug'].includes(levelFilter.toLowerCase())) {
      parsedLogs = parsedLogs.filter(log => log.level === levelFilter.toLowerCase());
    }

    // Get last N lines
    parsedLogs = parsedLogs.slice(-lines);

    res.json({
      logs: parsedLogs,
      file: logFile,
      count: parsedLogs.length,
    });
  } catch (error: any) {
    logger.error('Error reading logs:', error);
    res.status(500).json({ error: 'Failed to read logs', message: error.message });
  }
});

/**
 * POST /api/system/restart
 * Trigger application restart (for update application)
 */
router.post('/restart', (_req: Request, res: Response) => {
  res.json({ message: 'Restart initiated', success: true });

  // Give time for response to be sent
  setTimeout(() => {
    logger.info('Application restart requested via API');
    process.exit(0); // Process manager (systemd/NSSM) will restart us
  }, 1000);
});

/**
 * POST /api/system/updates/apply
 * Download and apply the latest update
 */
router.post('/updates/apply', async (_req: Request, res: Response) => {
  try {
    logger.info('Update application requested via API');

    const result = await updateService.applyUpdate();

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        status: 'The server will restart with the new version. Please wait...',
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message,
      });
    }
  } catch (error: any) {
    logger.error('Error applying update:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to apply update',
      message: error.message,
    });
  }
});

/**
 * GET /api/system/updates/status
 * Get the current update status
 */
router.get('/updates/status', (_req: Request, res: Response) => {
  res.json(updateService.getStatus());
});

export default router;
