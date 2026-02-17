// Server Types
export interface ServerStatus {
  serverId: string;
  status: 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed' | 'orphaned';
  playerCount: number;
  maxPlayers: number;
  version: string;
  uptime: number;
}

export interface ServerMetrics {
  cpuUsage: number; // percentage
  memoryUsage: number; // MB
  memoryTotal: number; // MB
  diskUsage: number; // MB
  tps: number; // ticks per second
  uptime: number; // seconds
  timestamp: Date;
}

export interface ServerConfig {
  name: string;
  address: string;
  port: number;
  maxPlayers: number;
  gameMode: string;
  difficulty?: string;
  worldPath: string;
  serverPath: string;
  javaArgs?: string;
  [key: string]: any; // Allow adapter-specific config
}

// Console Types
export interface LogEntry {
  id?: string;
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  source?: string;
}

export interface CommandResponse {
  success: boolean;
  output: string;
  executedAt: Date;
  error?: string;
}

// Player Types
export interface Player {
  id: string;
  serverId: string;
  uuid: string;
  username: string;
  displayName?: string;
  isOnline: boolean;
  firstJoined: Date;
  lastSeen: Date;
  playtime: number;
  permissions?: string[];
  isBanned: boolean;
  banReason?: string;
  bannedAt?: Date;
  bannedUntil?: Date;
  isWhitelisted: boolean;
  isOperator: boolean;
}

// Mod Types
export interface ModFile {
  id: string;
  modId: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  fileType: string;
  createdAt: Date;
}

export interface Mod {
  id: string;
  serverId: string;
  projectId: string;
  projectTitle: string;
  projectIconUrl?: string;
  versionId: string;
  versionName: string;
  classification: string;
  archiveSize: number;
  fileHash?: string;
  enabled: boolean;
  installedAt: Date;
  updatedAt: Date;
  files?: ModFile[];
}

export interface ModMetadata {
  providerId?: string;  // Provider ID (modtale, curseforge, etc.) - defaults to 'modtale'
  projectId: string;
  projectTitle: string;
  projectIconUrl?: string;
  versionId: string;
  versionName: string;
  classification: string;
  fileSize: number;
  fileHash?: string;
  fileName?: string;  // Original file name from provider
}

// Installed file info returned from adapter
export interface InstalledFile {
  fileName: string;
  filePath: string;
  fileSize: number;
  fileType: string;
}

// Backup Types
export interface Backup {
  id: string;
  serverId: string;
  name: string;
  description?: string;
  filePath: string;
  fileSize: number;
  status: 'pending' | 'creating' | 'completed' | 'failed' | 'restoring';
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

// Scheduled Task Types
export interface ScheduledTask {
  id: string;
  serverId: string;
  name: string;
  type: 'backup' | 'restart' | 'command';
  enabled: boolean;
  cronExpression: string;
  taskData?: any;
  lastRun?: Date;
  nextRun?: Date;
  lastStatus?: 'success' | 'failed';
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

// WebSocket Event Types
export interface WSServerStatusEvent {
  serverId: string;
  status: ServerStatus;
}

export interface WSServerMetricsEvent {
  serverId: string;
  metrics: ServerMetrics;
}

export interface WSPlayerEvent {
  serverId: string;
  player: Player;
  event: 'joined' | 'left' | 'kicked' | 'banned';
}

export interface WSLogEvent {
  serverId: string;
  log: LogEntry;
}

// ==========================================
// Network Types
// ==========================================

export type NetworkType = 'logical' | 'proxy';
export type NetworkStatusType = 'running' | 'stopped' | 'starting' | 'stopping' | 'partial';
export type MemberRole = 'proxy' | 'member' | 'backend';

export interface ServerNetwork {
  id: string;
  name: string;
  description?: string;
  networkType: NetworkType;
  proxyServerId?: string;
  proxyConfig?: string; // JSON
  color?: string;
  sortOrder: number;
  bulkActionsEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ServerNetworkMember {
  id: string;
  networkId: string;
  serverId: string;
  role: MemberRole;
  sortOrder: number;
  addedAt: Date;
}

export interface NetworkWithMembers extends ServerNetwork {
  members: (ServerNetworkMember & { server: { id: string; name: string; status: string } })[];
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
  timestamp: Date;
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
  createdAt: Date;
  completedAt?: Date;
  serverBackups?: Backup[];
}

export interface ProxyConfig {
  startOrder?: 'proxy_first' | 'backends_first';
  javaPath?: string;
  jvmArgs?: string;
  bindAddress?: string;
  bindPort?: number;
  publicAddress?: string;
  publicPort?: number;
  certificatePath?: string;
  privateKeyPath?: string;
  maxConnections?: number;
  connectionTimeoutSeconds?: number;
  proxySecret?: string;
  debugMode?: boolean;
  passthroughMode?: boolean;
  metricsEnabled?: boolean;
  autoInstallBridge?: boolean;
  metricsPort?: number;
  metricsLogIntervalSeconds?: number;
  clusterEnabled?: boolean;
  proxyId?: string;
  proxyRegion?: string;
  redisHost?: string;
  redisPort?: number;
  redisPassword?: string;
  redisSsl?: boolean;
  redisDatabase?: number;
  fallbackEnabled?: boolean;
  globalFallbackServer?: string;
  backendFallbackServers?: Record<string, boolean>;
  proxyProtocol?: {
    enabled?: boolean;
    required?: boolean;
    headerTimeoutSeconds?: number;
    trustedProxies?: string[];
  };
}

// Network WebSocket Events
export interface WSNetworkStatusEvent {
  networkId: string;
  status: NetworkStatus;
}

export interface WSNetworkMetricsEvent {
  networkId: string;
  metrics: AggregatedMetrics;
}

export interface WSBulkOperationEvent {
  networkId: string;
  operation: 'start' | 'stop' | 'restart';
  progress: {
    total: number;
    completed: number;
    failed: number;
    current?: string;
  };
}
