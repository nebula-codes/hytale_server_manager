// ============================================================================
// SERVER TYPES
// ============================================================================

export type ServerStatus = 'running' | 'stopped' | 'starting' | 'stopping' | 'crashed' | 'orphaned';
export type GameMode = 'exploration' | 'creative' | 'custom';
export type WorldType = 'normal' | 'nether' | 'end' | 'custom';
export type Difficulty = 'peaceful' | 'easy' | 'normal' | 'hard';

export interface World {
  id: string;
  serverId: string;
  name: string;
  type: WorldType;
  seed: string;
  difficulty: Difficulty;
  gameRules: Record<string, boolean | number | string>;
  spawn: {
    x: number;
    y: number;
    z: number;
  };
  border: {
    center: { x: number; z: number };
    size: number;
  };
  loaded: boolean;
  size: number; // bytes
  playerCount: number;
  lastPlayed?: Date;
  createdAt: Date;
}

export interface Server {
  id: string;
  name: string;
  status: ServerStatus;
  version: string;
  address: string;
  port: number;
  maxPlayers: number;
  currentPlayers: number;
  uptime: number; // seconds
  cpuUsage: number; // percentage
  memoryUsage: number; // MB
  memoryAllocated: number; // MB
  diskUsage: number; // MB
  lastBackup: Date;
  installedMods: number;
  gameMode: GameMode;
  tps: number; // Ticks per second
  worlds: World[]; // Server's dimensions/worlds
}

export interface ServerMetric {
  timestamp: Date;
  cpuUsage: number;
  memoryUsage: number;
  players: number;
  tps: number;
}

export interface ServerConfig {
  serverId: string;

  // General Settings
  general: {
    serverName: string;
    motd: string;
    maxPlayers: number;
    difficulty: 'peaceful' | 'easy' | 'normal' | 'hard';
    gameMode: 'exploration' | 'creative' | 'custom';
    hardcore: boolean;
    pvp: boolean;
    forceGameMode: boolean;
    allowFlight: boolean;
  };

  // World Settings
  world: {
    seed: string;
    generatorType: 'default' | 'flat' | 'amplified' | 'large_biomes' | 'custom';
    viewDistance: number; // 2-32 chunks
    simulationDistance: number; // 2-32 chunks
    spawnProtection: number; // radius in blocks
    spawnAnimals: boolean;
    spawnMonsters: boolean;
    spawnNPCs: boolean;
    generateStructures: boolean;
    maxWorldSize: number; // diameter in blocks
    levelType: string;
  };

  // Network Settings
  network: {
    serverIp: string;
    serverPort: number;
    queryPort: number;
    rconPort: number;
    rconPassword: string;
    enableQuery: boolean;
    enableRcon: boolean;
    enableStatus: boolean;
    maxTickTime: number; // milliseconds
    networkCompressionThreshold: number; // bytes
    rateLimitPackets: number;
  };

  // Gameplay Settings
  gameplay: {
    allowCommandBlocks: boolean;
    allowDatapacks: boolean;
    functionPermissionLevel: number; // 1-4
    opPermissionLevel: number; // 1-4
    playerIdleTimeout: number; // minutes
    announcePlayerAchievements: boolean;
    enablePlayerReporting: boolean;
    hideOnlinePlayers: boolean;
  };

  // Performance Settings
  performance: {
    maxChunkSendRate: number; // chunks per tick
    entityBroadcastRangePercentage: number; // 10-1000%
    maxEntityCramming: number;
    mobSpawnRange: number; // chunks
    tickDistance: number; // chunks
    useNativeTransport: boolean;
    syncChunkWrites: boolean;
  };

  // Security Settings
  security: {
    whitelist: boolean;
    whitelistPlayers: string[];
    enforceWhitelist: boolean;
    onlineMode: boolean; // Mojang authentication
    preventProxyConnections: boolean;
    requireResourcePack: boolean;
    resourcePackPrompt: string;
    resourcePackUrl: string;
    resourcePackSha1: string;
  };

  // Advanced Settings
  advanced: {
    jvmArgs: string;
    javaVersion: string;
    allocatedMemory: number; // MB
    garbageCollector: 'G1GC' | 'ZGC' | 'Shenandoah' | 'ParallelGC';
    environmentVars: Record<string, string>;
    autoRestart: boolean;
    restartWarningMinutes: number[];
    backupBeforeRestart: boolean;
    customStartupScript: string;
    enableDebugMode: boolean;
    logLevel: 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE';
  };

  // Legacy properties (for backward compatibility)
  properties?: Record<string, any>;
  motd?: string;
  javaArgs?: string;
  environmentVars?: Record<string, string>;
}

// ============================================================================
// MOD TYPES
// ============================================================================

export type ModType = 'plugin' | 'data-asset' | 'art-asset' | 'world-save';
export type ModSource = 'hytalemods' | 'hytalecore' | 'curseforge' | 'manual';
export type DependencyStatus = 'satisfied' | 'missing' | 'outdated' | 'conflict';

export interface Dependency {
  modId: string;
  modName: string;
  required: boolean;
  versionRange: string;
  status: DependencyStatus;
}

export interface Mod {
  id: string;
  name: string;
  slug: string;
  type: ModType;
  version: string;
  latestVersion: string;
  author: string;
  description: string;
  shortDescription: string;
  downloads: number;
  rating: number;
  iconUrl: string;
  bannerUrl?: string;
  categories: string[];
  dependencies: Dependency[];
  conflicts: string[];
  gameVersions: string[];
  size: number; // bytes
  installedAt?: Date;
  enabled: boolean;
  configurable: boolean;
  source: ModSource;
}

// ============================================================================
// MODPACK TYPES
// ============================================================================

export interface ModpackMod {
  modId: string;
  modName: string;
  version: string;
  required: boolean;
  clientSide: boolean; // Always false for Hytale
}

export interface Modpack {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  iconUrl: string;
  mods: ModpackMod[];
  totalSize: number;
  gameVersion: string;
  lastUpdated: Date;
  downloads: number;
  tags: string[];
  featured: boolean;
}

// ============================================================================
// BACKUP TYPES
// ============================================================================

export type BackupType = 'full' | 'incremental' | 'world-only' | 'config-only';
export type BackupStatus = 'completed' | 'in-progress' | 'failed' | 'scheduled';
export type BackupTrigger = 'manual' | 'scheduled' | 'pre-update' | 'auto';
export type BackupFrequency = 'hourly' | 'daily' | 'weekly' | 'custom';

export interface Backup {
  id: string;
  serverId: string;
  serverName: string;
  type: BackupType;
  status: BackupStatus;
  size: number;
  createdAt: Date;
  completedAt?: Date;
  trigger: BackupTrigger;
  retention: number; // days
  notes?: string;
  downloadUrl?: string;
}

export interface BackupSchedule {
  id: string;
  serverId: string;
  enabled: boolean;
  frequency: BackupFrequency;
  time?: string; // HH:MM
  dayOfWeek?: number; // 0-6
  cronExpression?: string;
  backupType: BackupType;
  retention: number;
  maxBackups: number;
  notifyOnComplete: boolean;
  notifyOnFailure: boolean;
}

// ============================================================================
// PLAYER TYPES
// ============================================================================

export type PlayerStatus = 'online' | 'offline';
export type WarningSeverity = 'minor' | 'moderate' | 'severe';

export interface Warning {
  id: string;
  reason: string;
  issuedBy: string;
  issuedAt: Date;
  severity: WarningSeverity;
}

export interface Player {
  uuid: string;
  username: string;
  displayName: string;
  firstJoin: Date;
  lastSeen: Date;
  totalPlaytime: number; // minutes
  status: PlayerStatus;
  currentServer?: string;
  ipAddress?: string;
  role: string;
  notes?: string;
  banned: boolean;
  banReason?: string;
  banExpires?: Date;
  warnings: Warning[];
  skinUrl?: string;
}

// ============================================================================
// CONSOLE & LOGS TYPES
// ============================================================================

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export interface ConsoleLog {
  id: string;
  timestamp: Date;
  level: LogLevel;
  source: string;
  message: string;
}

export interface LogFile {
  id: string;
  serverId: string;
  filename: string;
  size: number;
  createdAt: Date;
  lines: number;
}

// ============================================================================
// BRIDGE TYPES
// ============================================================================

export interface BridgeFeature {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  configurable: boolean;
}

export interface BridgeStatus {
  connected: boolean;
  pluginVersion: string;
  lastHeartbeat: Date;
  latency: number; // ms
  features: BridgeFeature[];
}

export interface ServerEvent {
  id: string;
  type: 'player_join' | 'player_leave' | 'chat' | 'achievement' | 'alert';
  timestamp: Date;
  data: any;
}

// ============================================================================
// AUTH TYPES
// ============================================================================

export type UserRole = 'admin' | 'moderator' | 'viewer';

export interface User {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  avatar?: string;
  permissions?: PermissionCode[];
}

// ============================================================================
// PERMISSION TYPES
// ============================================================================

export const PERMISSIONS = {
  // Server Management
  SERVERS_VIEW: 'servers:view',
  SERVERS_CREATE: 'servers:create',
  SERVERS_UPDATE: 'servers:update',
  SERVERS_DELETE: 'servers:delete',
  SERVERS_START: 'servers:start',
  SERVERS_STOP: 'servers:stop',
  SERVERS_RESTART: 'servers:restart',
  SERVERS_KILL: 'servers:kill',
  SERVERS_CONSOLE: 'servers:console',
  SERVERS_FILES: 'servers:files',
  SERVERS_FILES_WRITE: 'servers:files:write',

  // Backups
  BACKUPS_VIEW: 'backups:view',
  BACKUPS_CREATE: 'backups:create',
  BACKUPS_RESTORE: 'backups:restore',
  BACKUPS_DELETE: 'backups:delete',

  // Players
  PLAYERS_VIEW: 'players:view',
  PLAYERS_KICK: 'players:kick',
  PLAYERS_BAN: 'players:ban',
  PLAYERS_UNBAN: 'players:unban',

  // Mods
  MODS_VIEW: 'mods:view',
  MODS_INSTALL: 'mods:install',
  MODS_UNINSTALL: 'mods:uninstall',
  MODS_TOGGLE: 'mods:toggle',

  // Worlds
  WORLDS_VIEW: 'worlds:view',
  WORLDS_UPDATE: 'worlds:update',
  WORLDS_DELETE: 'worlds:delete',
  WORLDS_ACTIVATE: 'worlds:activate',

  // Automation & Tasks
  AUTOMATION_VIEW: 'automation:view',
  AUTOMATION_CREATE: 'automation:create',
  AUTOMATION_UPDATE: 'automation:update',
  AUTOMATION_DELETE: 'automation:delete',
  AUTOMATION_EXECUTE: 'automation:execute',

  // Alerts
  ALERTS_VIEW: 'alerts:view',
  ALERTS_MANAGE: 'alerts:manage',

  // Networks
  NETWORKS_VIEW: 'networks:view',
  NETWORKS_CREATE: 'networks:create',
  NETWORKS_UPDATE: 'networks:update',
  NETWORKS_DELETE: 'networks:delete',
  NETWORKS_MANAGE: 'networks:manage',

  // Users
  USERS_VIEW: 'users:view',
  USERS_CREATE: 'users:create',
  USERS_UPDATE: 'users:update',
  USERS_DELETE: 'users:delete',

  // Settings & Permissions
  SETTINGS_VIEW: 'settings:view',
  SETTINGS_UPDATE: 'settings:update',
  PERMISSIONS_VIEW: 'permissions:view',
  PERMISSIONS_MANAGE: 'permissions:manage',

  // Activity Log
  ACTIVITY_VIEW: 'activity:view',
  ACTIVITY_VIEW_ALL: 'activity:view:all',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export interface PermissionDefinition {
  code: PermissionCode;
  name: string;
  description: string;
  category: string;
}

export interface RolePermissions {
  role: UserRole;
  permissions: PermissionCode[];
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
}

// ============================================================================
// NOTIFICATION TYPES
// ============================================================================

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  actionUrl?: string;
}

// ============================================================================
// STATISTICS TYPES
// ============================================================================

export interface ServerStats {
  totalServers: number;
  runningServers: number;
  totalPlayers: number;
  totalMods: number;
  totalBackups: number;
  diskUsage: number;
  diskTotal: number;
}

// ============================================================================
// CHART DATA TYPES
// ============================================================================

export interface ChartDataPoint {
  timestamp: string | number;
  value: number;
  label?: string;
}

export interface MultiSeriesChartData {
  timestamp: string | number;
  [key: string]: string | number;
}

// ============================================================================
// NETWORK TYPES
// ============================================================================

export type NetworkType = 'logical' | 'proxy';
export type NetworkStatusType = 'running' | 'stopped' | 'starting' | 'stopping' | 'partial';
export type MemberRole = 'proxy' | 'member' | 'backend';

export interface ServerNetwork {
  id: string;
  name: string;
  description?: string;
  networkType: NetworkType;
  proxyServerId?: string;
  proxyConfig?: {
    startOrder?: 'proxy_first' | 'backends_first';
  };
  color?: string;
  sortOrder: number;
  bulkActionsEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ServerNetworkMember {
  id: string;
  networkId: string;
  serverId: string;
  role: MemberRole;
  sortOrder: number;
  addedAt: string;
  server: {
    id: string;
    name: string;
    status: string;
  };
}

export interface NetworkWithMembers extends ServerNetwork {
  members: ServerNetworkMember[];
}

export interface NetworkStatus {
  networkId: string;
  status: NetworkStatusType;
  totalServers: number;
  runningServers: number;
  stoppedServers: number;
  memberStatuses: {
    serverId: string;
    serverName: string;
    status: string;
    cpuUsage?: number;
    memoryUsage?: number;
    playerCount?: number;
  }[];
}

export interface AggregatedMetrics {
  networkId: string;
  totalPlayers: number;
  totalCpuUsage: number;
  averageCpuUsage: number;
  totalMemoryUsage: number;
  totalMemoryAllocated: number;
  averageTps: number;
  serverCount: number;
  timestamp: string;
}

export interface NetworkPlayerInfo {
  uuid: string;
  username: string;
  serverId: string;
  serverName: string;
  isOnline: boolean;
}

export interface BulkOperationResult {
  networkId: string;
  results: ServerOperationResult[];
  success: boolean;
}

export interface ServerOperationResult {
  serverId: string;
  serverName: string;
  success: boolean;
  error?: string;
}

export interface NetworkBackup {
  id: string;
  networkId: string;
  name: string;
  description?: string;
  status: 'pending' | 'creating' | 'completed' | 'failed';
  error?: string;
  createdAt: string;
  completedAt?: string;
  serverBackups?: {
    id: string;
    serverId: string;
    name: string;
    status: string;
    fileSize: number;
  }[];
}

export interface CreateNetworkDto {
  name: string;
  description?: string;
  networkType?: NetworkType;
  proxyServerId?: string;
  proxyConfig?: {
    startOrder?: 'proxy_first' | 'backends_first';
  };
  color?: string;
  serverIds?: string[];
}

export interface UpdateNetworkDto {
  name?: string;
  description?: string;
  proxyServerId?: string;
  proxyConfig?: {
    startOrder?: 'proxy_first' | 'backends_first';
  };
  color?: string;
  sortOrder?: number;
  bulkActionsEnabled?: boolean;
}

// ============================================================================
// SERVER UPDATE TYPES
// ============================================================================

export type UpdateStatus =
  | 'pending'
  | 'stopping'
  | 'backing_up'
  | 'preserving'
  | 'downloading'
  | 'installing'
  | 'restoring'
  | 'starting'
  | 'completed'
  | 'failed'
  | 'rolled_back';

export interface VersionCheckResult {
  serverId: string;
  serverName: string;
  currentVersion: string;
  availableVersion: string | null;
  updateAvailable: boolean;
  checkedAt: string;
}

export interface UpdateSession {
  sessionId: string;
  serverId: string;
  fromVersion: string;
  toVersion: string;
  status: UpdateStatus;
  progress: number;
  message?: string;
  error?: string;
  backupId?: string;
  startedAt: string;
  wasRunning: boolean;
}

export interface ServerUpdateHistory {
  id: string;
  serverId: string;
  fromVersion: string;
  toVersion: string;
  status: UpdateStatus;
  error?: string;
  backupId?: string;
  startedAt: string;
  completedAt?: string;
}

export interface ServerUpdateProgressEvent {
  sessionId: string;
  serverId: string;
  status: UpdateStatus;
  progress: number;
  message?: string;
}

// ============================================================================
// I18N TYPES & CONSTANTS
// ============================================================================

export interface Language {
  code: string;
  label: string;
}

export const SUPPORTED_LANGUAGES: Language[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
];
