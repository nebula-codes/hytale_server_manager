import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs-extra';

// Load environment variables
// Use HSM_BASE_PATH in release (set by start scripts), fall back to dev path
const envPath = process.env.HSM_BASE_PATH
  ? path.join(process.env.HSM_BASE_PATH, '.env')
  : path.join(__dirname, '..', '.env');
console.log(`[Config] Loading .env from: ${envPath}`);
console.log(`[Config] HSM_BASE_PATH: ${process.env.HSM_BASE_PATH || 'not set'}`);
console.log(`[Config] __dirname: ${__dirname}`);
const dotenvResult = dotenv.config({ path: envPath });
if (dotenvResult.error) {
  console.error(`[Config] Error loading .env: ${dotenvResult.error.message}`);
} else {
  console.log(`[Config] .env loaded successfully`);
}
console.log(`[Config] JWT_SECRET loaded: ${process.env.JWT_SECRET ? 'YES (length: ' + process.env.JWT_SECRET.length + ')' : 'NO'}`);
console.log(`[Config] JWT_REFRESH_SECRET loaded: ${process.env.JWT_REFRESH_SECRET ? 'YES' : 'NO'}`);
console.log(`[Config] IS_DOCKER env: ${process.env.IS_DOCKER}`);

// Version info - update this on each release
export const VERSION = '0.3.25';
export const VERSION_NAME = 'Beta';

/**
 * Configuration interface
 */
export interface AppConfig {
  // Application
  version: string;
  versionName: string;
  nodeEnv: string;
  isDocker: boolean;

  // Server
  port: number;
  host: string;
  corsOrigin: string;

  // WebSocket
  wsPingInterval: number;
  wsPingTimeout: number;

  // Database
  databaseUrl: string;

  // Logging
  logLevel: string;
  logToFile: boolean;
  logMaxFiles: number;
  logMaxSize: string;

  // Discord Notifications
  discord: {
    enabled: boolean;
    webhookUrl?: string;
    username: string;
    avatarUrl?: string;
    enabledEvents: string[];
    mentionRoleId?: string;
  };

  // Security
  jwtSecret: string;
  jwtExpiresIn: string;
  rateLimitWindow: number;
  rateLimitMax: number;
  maxFileUploadSize: number;

  // Performance
  metricsRetentionDays: number;
  alertCheckInterval: number;
  statsRefreshInterval: number;
  chartRefreshInterval: number;

  // Paths
  dataPath: string;
  serversBasePath: string;
  backupsBasePath: string;
  logsPath: string;

  // FTP Storage
  ftp: {
    enabled: boolean;
    host: string;
    port: number;
    username: string;
    password: string;
    secure: boolean;
  };

  // Backup Settings
  backup: {
    excludePatterns: string[];
    retryAttempts: number;
    retryDelayMs: number;
  };

  // Updates
  updates: {
    checkOnStartup: boolean;
    autoDownload: boolean;
    githubRepo: string;
  };

  // HTTPS/SSL
  https: {
    enabled: boolean;
    certPath?: string;
    keyPath?: string;
    autoGenerate: boolean;
  };
  certsPath: string;
}

/**
 * Default configuration values
 */
const defaults: AppConfig = {
  // Application
  version: VERSION,
  versionName: VERSION_NAME,
  nodeEnv: 'production',
  isDocker: process.env.IS_DOCKER === 'true',

  // Server
  port: 3001,
  host: '0.0.0.0',
  corsOrigin: 'http://localhost:5173', // SECURITY: Never use '*' in production

  // WebSocket
  wsPingInterval: 10000,
  wsPingTimeout: 5000,

  // Database
  databaseUrl: 'file:./data/db/hytale-manager.db',

  // Logging
  logLevel: 'info',
  logToFile: true,
  logMaxFiles: 14,
  logMaxSize: '20m',

  // Discord Notifications
  discord: {
    enabled: false,
    webhookUrl: undefined,
    username: 'Hytale Server Manager',
    avatarUrl: undefined,
    enabledEvents: [
      'server_crash',
      'player_ban',
      'backup_failed',
      'alert_critical',
      'high_cpu',
      'high_memory',
      'high_disk',
    ],
    mentionRoleId: undefined,
  },

  // Security
  jwtSecret: '', // Must be set in config
  jwtExpiresIn: '7d',
  rateLimitWindow: 900000, // 15 minutes
  rateLimitMax: 100,
  maxFileUploadSize: 52428800, // 50MB

  // Performance
  metricsRetentionDays: 30,
  alertCheckInterval: 60000, // 1 minute
  statsRefreshInterval: 5000, // 5 seconds
  chartRefreshInterval: 60000, // 1 minute

  // Paths - will be resolved relative to data directory
  dataPath: './data',
  serversBasePath: './data/servers',
  backupsBasePath: './data/backups',
  logsPath: './data/logs',

  // FTP Storage
  ftp: {
    enabled: false,
    host: '',
    port: 21,
    username: '',
    password: '',
    secure: false,
  },

  // Backup Settings
  backup: {
    excludePatterns: [
      'session.lock',
      '*.lock',
      '*.lck',
      '*.tmp',
      '*.temp',
      'cache/**',
      'logs/**',
      '*.log',
    ],
    retryAttempts: 3,
    retryDelayMs: 1000,
  },

  // Updates
  updates: {
    checkOnStartup: true,
    autoDownload: false,
    githubRepo: 'yourusername/hytale-server-manager',
  },

  // HTTPS/SSL - enabled by default in production
  https: {
    enabled: true, // Auto-enables in production
    certPath: undefined,
    keyPath: undefined,
    autoGenerate: true, // Generate self-signed certs if no custom ones provided
  },
  certsPath: './data/certs',
};

/**
 * Get the base path for the application
 * In production, this is the directory containing the executable/script
 * In development, this is the server directory
 */
function getBasePath(): string {
  if (process.env.NODE_ENV === 'development') {
    return path.join(__dirname, '..');
  }
  // In production, use the working directory or a custom base path
  return process.env.HSM_BASE_PATH || process.cwd();
}

/**
 * Get the path to the config file
 */
function getConfigPath(): string {
  const basePath = getBasePath();
  return process.env.HSM_CONFIG_PATH || path.join(basePath, 'config.json');
}

/**
 * Load configuration from config.json file
 */
function loadConfigFile(): Partial<AppConfig> {
  const configPath = getConfigPath();

  if (fs.existsSync(configPath)) {
    try {
      const fileContent = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(fileContent);
      console.log(`[Config] Loaded configuration from ${configPath}`);
      return parsed;
    } catch (error) {
      console.error(`[Config] Error loading config file: ${error}`);
      return {};
    }
  }

  console.log(`[Config] No config file found at ${configPath}, using defaults`);
  return {};
}

/**
 * Load configuration from environment variables
 */
function loadEnvConfig(): Partial<AppConfig> {
  const envConfig: Partial<AppConfig> = {};

  // Only set values that are explicitly defined in environment
  if (process.env.NODE_ENV) envConfig.nodeEnv = process.env.NODE_ENV;
  if (process.env.IS_DOCKER !== undefined) envConfig.isDocker = process.env.IS_DOCKER === 'true';
  if (process.env.PORT) envConfig.port = parseInt(process.env.PORT, 10);
  if (process.env.HOST) envConfig.host = process.env.HOST;
  if (process.env.CORS_ORIGIN) envConfig.corsOrigin = process.env.CORS_ORIGIN;
  if (process.env.DATABASE_URL) envConfig.databaseUrl = process.env.DATABASE_URL;
  if (process.env.LOG_LEVEL) envConfig.logLevel = process.env.LOG_LEVEL;
  if (process.env.JWT_SECRET) envConfig.jwtSecret = process.env.JWT_SECRET;
  if (process.env.JWT_EXPIRES_IN) envConfig.jwtExpiresIn = process.env.JWT_EXPIRES_IN;
  if (process.env.RATE_LIMIT_WINDOW) envConfig.rateLimitWindow = parseInt(process.env.RATE_LIMIT_WINDOW, 10);
  if (process.env.RATE_LIMIT_MAX) envConfig.rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX, 10);
  if (process.env.MAX_FILE_UPLOAD_SIZE) envConfig.maxFileUploadSize = parseInt(process.env.MAX_FILE_UPLOAD_SIZE, 10);

  // Paths
  if (process.env.DATA_PATH) envConfig.dataPath = process.env.DATA_PATH;
  if (process.env.SERVERS_BASE_PATH) envConfig.serversBasePath = process.env.SERVERS_BASE_PATH;
  if (process.env.BACKUPS_BASE_PATH) envConfig.backupsBasePath = process.env.BACKUPS_BASE_PATH;
  if (process.env.LOGS_PATH) envConfig.logsPath = process.env.LOGS_PATH;

  // Discord
  if (process.env.DISCORD_ENABLED === 'true' || process.env.DISCORD_WEBHOOK_URL) {
    envConfig.discord = {
      ...defaults.discord,
      enabled: process.env.DISCORD_ENABLED === 'true',
      webhookUrl: process.env.DISCORD_WEBHOOK_URL,
      username: process.env.DISCORD_USERNAME || defaults.discord.username,
      avatarUrl: process.env.DISCORD_AVATAR_URL,
      mentionRoleId: process.env.DISCORD_MENTION_ROLE_ID,
    };
  }

  // FTP
  if (process.env.FTP_ENABLED === 'true') {
    envConfig.ftp = {
      enabled: true,
      host: process.env.FTP_HOST || '',
      port: parseInt(process.env.FTP_PORT || '21', 10),
      username: process.env.FTP_USERNAME || '',
      password: process.env.FTP_PASSWORD || '',
      secure: process.env.FTP_SECURE === 'true',
    };
  }

  // HTTPS
  if (process.env.HTTPS_ENABLED !== undefined || process.env.SSL_CERT_PATH || process.env.SSL_KEY_PATH) {
    envConfig.https = {
      enabled: process.env.HTTPS_ENABLED !== 'false', // Default true unless explicitly disabled
      certPath: process.env.SSL_CERT_PATH,
      keyPath: process.env.SSL_KEY_PATH,
      autoGenerate: process.env.HTTPS_AUTO_GENERATE !== 'false',
    };
  }
  if (process.env.CERTS_PATH) envConfig.certsPath = process.env.CERTS_PATH;

  return envConfig;
}

/**
 * Deep merge configuration objects
 */
function deepMerge<T extends Record<string, any>>(target: T, ...sources: Partial<T>[]): T {
  const result = { ...target };

  for (const source of sources) {
    if (!source) continue;

    for (const key of Object.keys(source) as (keyof T)[]) {
      const sourceValue = source[key];
      const targetValue = result[key];

      if (sourceValue !== undefined) {
        if (
          typeof sourceValue === 'object' &&
          sourceValue !== null &&
          !Array.isArray(sourceValue) &&
          typeof targetValue === 'object' &&
          targetValue !== null &&
          !Array.isArray(targetValue)
        ) {
          result[key] = deepMerge(targetValue, sourceValue as any);
        } else {
          result[key] = sourceValue as any;
        }
      }
    }
  }

  return result;
}

/**
 * Resolve paths to absolute paths
 */
function resolvePaths(config: AppConfig): AppConfig {
  const basePath = getBasePath();

  const resolvePath = (p: string): string => {
    if (path.isAbsolute(p)) return p;
    return path.resolve(basePath, p);
  };

  return {
    ...config,
    dataPath: resolvePath(config.dataPath),
    serversBasePath: resolvePath(config.serversBasePath),
    backupsBasePath: resolvePath(config.backupsBasePath),
    logsPath: resolvePath(config.logsPath),
    certsPath: resolvePath(config.certsPath),
    databaseUrl: config.databaseUrl.startsWith('file:')
      ? `file:${resolvePath(config.databaseUrl.replace('file:', ''))}`
      : config.databaseUrl,
  };
}

/**
 * Generate a random JWT secret
 */
function generateJwtSecret(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let result = '';
  for (let i = 0; i < 64; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Ensure required directories exist
 */
function ensureDirectories(config: AppConfig): void {
  const dirs = [
    config.dataPath,
    config.serversBasePath,
    config.backupsBasePath,
    config.logsPath,
    config.certsPath,
    path.dirname(config.databaseUrl.replace('file:', '')),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`[Config] Created directory: ${dir}`);
    }
  }
}

/**
 * Save default config file if it doesn't exist
 */
function saveDefaultConfig(configPath: string): void {
  if (!fs.existsSync(configPath)) {
    const defaultConfig = {
      port: defaults.port,
      host: defaults.host,
      corsOrigin: defaults.corsOrigin,
      logLevel: defaults.logLevel,
      logToFile: defaults.logToFile,
      jwtSecret: generateJwtSecret(),
      jwtExpiresIn: defaults.jwtExpiresIn,
      dataPath: defaults.dataPath,
      serversBasePath: defaults.serversBasePath,
      backupsBasePath: defaults.backupsBasePath,
      logsPath: defaults.logsPath,
      metricsRetentionDays: defaults.metricsRetentionDays,
      discord: {
        enabled: false,
        webhookUrl: '',
        username: defaults.discord.username,
      },
      ftp: {
        enabled: false,
        host: '',
        port: 21,
        username: '',
        password: '',
        secure: false,
      },
      updates: defaults.updates,
    };

    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    console.log(`[Config] Created default config file: ${configPath}`);
  }
}

/**
 * Build and validate configuration
 */
function buildConfig(): AppConfig {
  // Load from file and environment
  const fileConfig = loadConfigFile();
  const envConfig = loadEnvConfig();

  // Merge: defaults <- file config <- env config
  let config = deepMerge(defaults, fileConfig, envConfig);

  // Resolve paths
  config = resolvePaths(config);
  process.env.DATABASE_URL = config.databaseUrl;

  // Generate JWT secret if not set
  if (!config.jwtSecret) {
    config.jwtSecret = generateJwtSecret();
    console.warn('[Config] WARNING: No JWT secret configured. Generated a random one.');
    console.warn('[Config] For production, set jwtSecret in config.json');
  }

  // Ensure directories exist
  ensureDirectories(config);

  // Save default config if it doesn't exist
  const configPath = getConfigPath();
  saveDefaultConfig(configPath);

  // Always set version from code
  config.version = VERSION;
  config.versionName = VERSION_NAME;

  console.log(`[Config] Docker mode: ${config.isDocker}`);

  return config;
}

// Build config on module load
const config = buildConfig();

// Export helpers
export function getConfigPath_(): string {
  return getConfigPath();
}

export function getBasePath_(): string {
  return getBasePath();
}

export function reloadConfig(): AppConfig {
  const newConfig = buildConfig();
  Object.assign(config, newConfig);
  return config;
}

export default config;
