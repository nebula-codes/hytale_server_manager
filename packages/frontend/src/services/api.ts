/**
 * API Service
 *
 * Centralized HTTP client for all API requests. Handles authentication,
 * error handling, and request/response transformation.
 *
 * @module services/api
 */

import { env, logger } from '../config';
import { authService, AuthError } from './auth';
import type { ServerStatus, ServerConfig, VersionCheckResult, UpdateSession, ServerUpdateHistory } from '../types';

/**
 * Server status response from API
 */
export interface ServerStatusResponse {
  status: ServerStatus;
  uptime: number;
  players: number;
  playerCount: number;
  maxPlayers: number;
  tps?: number;
}

/**
 * Server metrics response from API
 */
export interface ServerMetricsResponse {
  cpuUsage: number;
  memoryUsage: number;
  memoryAllocated: number;
  memoryTotal: number;
  diskUsage: number;
  tps: number;
  players: number;
  uptime: number;
  timestamp?: Date;
}

/**
 * API Error class with status code and response data
 */
export class ApiError extends Error {
  statusCode: number;
  data?: unknown;

  constructor(
    message: string,
    statusCode: number,
    data?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.data = data;
  }
}

/**
 * API Service Class
 *
 * Provides a centralized HTTP client with:
 * - Automatic authentication token injection
 * - Token refresh on 401 responses
 * - Consistent error handling
 * - Request/response logging in development
 */
class ApiService {
  private baseUrl: string;
  private isRefreshing = false;
  private refreshSubscribers: Array<(token: string) => void> = [];

  constructor(baseUrl: string = env.api.baseUrl) {
    this.baseUrl = baseUrl;
  }

  /**
   * Adds a subscriber to be notified when token refresh completes
   */
  private subscribeToRefresh(callback: (token: string) => void): void {
    this.refreshSubscribers.push(callback);
  }

  /**
   * Notifies all subscribers that token refresh completed
   */
  private onRefreshed(token: string): void {
    this.refreshSubscribers.forEach((callback) => callback(token));
    this.refreshSubscribers = [];
  }

  /**
   * Makes an authenticated request to the API
   *
   * @param endpoint - API endpoint (e.g., '/api/servers')
   * @param options - Fetch options
   * @returns Response data
   */
  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options?.headers,
    };

    // Note: Authentication tokens are stored in httpOnly cookies
    // They are sent automatically with credentials: 'include'

    try {
      logger.debug(`API Request: ${options?.method || 'GET'} ${endpoint}`);

      const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include', // Always include cookies for authentication
      });

      // Handle 401 - attempt token refresh
      if (response.status === 401) {
        return this.handleUnauthorized<T>(endpoint, options);
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new ApiError(
          error.error || error.message || 'Request failed',
          response.status,
          error
        );
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return null as T;
      }

      const data = await response.json();
      logger.debug(`API Response: ${endpoint}`, { status: response.status });

      return data;
    } catch (error) {
      if (error instanceof ApiError || error instanceof AuthError) {
        throw error;
      }

      logger.error(`API request failed: ${endpoint}`, error);
      throw new ApiError(
        error instanceof Error ? error.message : 'Request failed',
        0
      );
    }
  }

  /**
   * Handles 401 responses by refreshing the token and retrying
   * With httpOnly cookies, the refresh will update cookies automatically
   */
  private async handleUnauthorized<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    if (this.isRefreshing) {
      // Wait for ongoing refresh to complete
      return new Promise((resolve, reject) => {
        this.subscribeToRefresh(async () => {
          try {
            const result = await this.retryRequest<T>(endpoint, options);
            resolve(result);
          } catch (error) {
            reject(error);
          }
        });
      });
    }

    this.isRefreshing = true;

    try {
      await authService.refreshAccessToken();
      this.onRefreshed(''); // Token is in cookie, we just notify subscribers
      return this.retryRequest<T>(endpoint, options);
    } catch {
      // Refresh failed - clear auth state
      logger.error('Token refresh failed, logging out');
      await authService.logout({ callApi: false });
      throw new AuthError('Session expired. Please login again.', 'TOKEN_EXPIRED', 401);
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Retries a request after token refresh
   * Tokens are in httpOnly cookies, sent automatically
   */
  private async retryRequest<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options?.headers,
    };

    const response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include', // Cookies sent automatically
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new ApiError(
        error.error || error.message || 'Request failed',
        response.status,
        error
      );
    }

    if (response.status === 204) {
      return null as T;
    }

    return response.json();
  }

  // ============================================
  // Generic HTTP Methods
  // ============================================

  /**
   * Makes a GET request to the specified endpoint
   */
  async get<T = unknown>(endpoint: string): Promise<T> {
    return this.request<T>(`/api${endpoint}`);
  }

  /**
   * Makes a POST request to the specified endpoint
   */
  async post<T = unknown>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(`/api${endpoint}`, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * Makes a PUT request to the specified endpoint
   */
  async put<T = unknown>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(`/api${endpoint}`, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * Makes a PATCH request to the specified endpoint
   */
  async patch<T = unknown>(endpoint: string, data?: unknown): Promise<T> {
    return this.request<T>(`/api${endpoint}`, {
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  /**
   * Makes a DELETE request to the specified endpoint
   */
  async delete<T = unknown>(endpoint: string): Promise<T> {
    return this.request<T>(`/api${endpoint}`, {
      method: 'DELETE',
    });
  }

  // ============================================
  // Server Endpoints
  // ============================================

  async getServers<T = unknown>(): Promise<T[]> {
    return this.request<T[]>('/api/servers');
  }

  async getServer<T = unknown>(id: string): Promise<T> {
    return this.request<T>(`/api/servers/${id}`);
  }

  async createServer<T = unknown>(data: {
    name: string;
    serverPath: string;
    address: string;
    port: number;
    version: string;
    maxPlayers: number;
    gameMode: string;
    adapterType?: string;
    adapterConfig?: Record<string, unknown>;
    jvmArgs?: string;
  }): Promise<T> {
    return this.request<T>('/api/servers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateServer<T = unknown>(id: string, data: Partial<{
    name: string;
    address: string;
    port: number;
    maxPlayers: number;
    gameMode: string;
    serverPath: string;
    backupPath: string | null;
    backupType: 'local' | 'ftp';
    backupExclusions: string[] | null;
    jvmArgs: string;
    serverArgs: string;
    adapterConfig: {
      jarFile?: string;
      assetsPath?: string;
      javaPath?: string;
      [key: string]: unknown;
    };
  }>): Promise<T> {
    return this.request<T>(`/api/servers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteServer(id: string) {
    return this.request<void>(`/api/servers/${id}`, {
      method: 'DELETE',
    });
  }

  // ============================================
  // Server Lifecycle
  // ============================================

  async startServer(id: string) {
    return this.request<{ message: string }>(`/api/servers/${id}/start`, {
      method: 'POST',
    });
  }

  async stopServer(id: string) {
    return this.request<{ message: string }>(`/api/servers/${id}/stop`, {
      method: 'POST',
    });
  }

  async restartServer(id: string) {
    return this.request<{ message: string }>(`/api/servers/${id}/restart`, {
      method: 'POST',
    });
  }

  async killServer(id: string) {
    return this.request<{ message: string }>(`/api/servers/${id}/kill`, {
      method: 'POST',
    });
  }

  // ============================================
  // Server Status & Metrics
  // ============================================

  async getServerStatus(id: string) {
    return this.request<ServerStatusResponse>(`/api/servers/${id}/status`);
  }

  async getServerMetrics(id: string) {
    return this.request<ServerMetricsResponse>(`/api/servers/${id}/metrics`);
  }

  async getServerConfig(id: string) {
    return this.request<ServerConfig>(`/api/servers/${id}/config`);
  }

  // ============================================
  // Console
  // ============================================

  async sendCommand(serverId: string, command: string) {
    return this.request<{ output: string }>(`/api/servers/${serverId}/console/command`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    });
  }

  async getConsoleLogs<T = unknown>(serverId: string, limit = 100, offset = 0, level?: string): Promise<T[]> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
      ...(level && { level }),
    });
    return this.request<T[]>(`/api/servers/${serverId}/console/logs?${params}`);
  }

  // ============================================
  // Mods
  // ============================================

  async getServerMods<T = unknown>(serverId: string): Promise<T[]> {
    return this.request<T[]>(`/api/servers/${serverId}/mods`);
  }

  async installMod<T = unknown>(serverId: string, metadata: unknown): Promise<T> {
    return this.request<T>(`/api/servers/${serverId}/mods`, {
      method: 'POST',
      body: JSON.stringify({ metadata }),
    });
  }

  async uninstallMod(serverId: string, modId: string) {
    return this.request<void>(`/api/servers/${serverId}/mods/${modId}`, {
      method: 'DELETE',
    });
  }

  async enableMod<T = unknown>(serverId: string, modId: string): Promise<T> {
    return this.request<T>(`/api/servers/${serverId}/mods/${modId}/enable`, {
      method: 'PATCH',
    });
  }

  async disableMod<T = unknown>(serverId: string, modId: string): Promise<T> {
    return this.request<T>(`/api/servers/${serverId}/mods/${modId}/disable`, {
      method: 'PATCH',
    });
  }

  // ============================================
  // Players
  // ============================================

  async getServerPlayers<T = unknown>(serverId: string, onlineOnly = false): Promise<T[]> {
    const params = new URLSearchParams({
      ...(onlineOnly && { online: 'true' }),
    });
    return this.request<T[]>(`/api/servers/${serverId}/players?${params}`);
  }

  async kickPlayer(serverId: string, uuid: string, reason?: string) {
    return this.request<{ message: string }>(`/api/servers/${serverId}/players/${uuid}/kick`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  async banPlayer<T = unknown>(serverId: string, uuid: string, reason?: string, duration?: number): Promise<T> {
    return this.request<T>(`/api/servers/${serverId}/players/${uuid}/ban`, {
      method: 'POST',
      body: JSON.stringify({ reason, duration }),
    });
  }

  async unbanPlayer<T = unknown>(serverId: string, uuid: string): Promise<T> {
    return this.request<T>(`/api/servers/${serverId}/players/${uuid}/unban`, {
      method: 'POST',
    });
  }

  // ============================================
  // Backups
  // ============================================

  async getServerBackups<T = unknown>(serverId: string): Promise<T[]> {
    return this.request<T[]>(`/api/servers/${serverId}/backups`);
  }

  async getBackupStats<T = unknown>(serverId: string): Promise<T> {
    return this.request<T>(`/api/servers/${serverId}/backups/stats`);
  }

  async createBackup<T = unknown>(serverId: string, description?: string): Promise<T> {
    return this.request<T>(`/api/servers/${serverId}/backups`, {
      method: 'POST',
      body: JSON.stringify({ description }),
    });
  }

  async getBackup<T = unknown>(backupId: string): Promise<T> {
    return this.request<T>(`/api/servers/backups/${backupId}`);
  }

  async restoreBackup(backupId: string) {
    return this.request<{ message: string }>(`/api/servers/backups/${backupId}/restore`, {
      method: 'POST',
    });
  }

  async deleteBackup(backupId: string) {
    return this.request<void>(`/api/servers/backups/${backupId}`, {
      method: 'DELETE',
    });
  }

  async deleteBackups(backupIds: string[]): Promise<{ deleted: number; failed: number; errors?: string[] }> {
    return this.request<{ deleted: number; failed: number; errors?: string[] }>('/api/servers/bulk/delete-backups', {
      method: 'POST',
      body: JSON.stringify({ backupIds }),
    });
  }

  // ============================================
  // Scheduled Tasks
  // ============================================

  async getAllTasks<T = unknown>(): Promise<T[]> {
    return this.request<T[]>('/api/servers/tasks');
  }

  async getServerTasks<T = unknown>(serverId: string): Promise<T[]> {
    return this.request<T[]>(`/api/servers/${serverId}/tasks`);
  }

  async createTask<T = unknown>(serverId: string, data: {
    name: string;
    type: string;
    cronExpression: string;
    taskData?: unknown;
    enabled?: boolean;
  }): Promise<T> {
    return this.request<T>(`/api/servers/${serverId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getTask<T = unknown>(taskId: string): Promise<T> {
    return this.request<T>(`/api/servers/tasks/${taskId}`);
  }

  async updateTask<T = unknown>(taskId: string, data: Partial<{
    name: string;
    cronExpression: string;
    taskData: unknown;
    enabled: boolean;
  }>): Promise<T> {
    return this.request<T>(`/api/servers/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async toggleTask<T = unknown>(taskId: string, enabled: boolean): Promise<T> {
    return this.request<T>(`/api/servers/tasks/${taskId}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    });
  }

  async runTaskNow(taskId: string) {
    return this.request<{ message: string }>(`/api/servers/tasks/${taskId}/run`, {
      method: 'POST',
    });
  }

  async deleteTask(taskId: string) {
    return this.request<void>(`/api/servers/tasks/${taskId}`, {
      method: 'DELETE',
    });
  }

  // ============================================
  // Task Groups
  // ============================================

  async getTaskGroups<T = unknown>(): Promise<T[]> {
    return this.request<T[]>('/api/task-groups');
  }

  async getTaskGroup<T = unknown>(groupId: string): Promise<T> {
    return this.request<T>(`/api/task-groups/${groupId}`);
  }

  async createTaskGroup<T = unknown>(data: {
    name: string;
    description?: string;
    cronExpression: string;
    failureMode?: 'stop' | 'continue';
    delayBetweenTasks?: number;
    enabled?: boolean;
    taskIds?: string[];
  }): Promise<T> {
    return this.request<T>('/api/task-groups', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateTaskGroup<T = unknown>(groupId: string, data: Partial<{
    name: string;
    description: string;
    cronExpression: string;
    failureMode: 'stop' | 'continue';
    delayBetweenTasks: number;
    enabled: boolean;
  }>): Promise<T> {
    return this.request<T>(`/api/task-groups/${groupId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteTaskGroup(groupId: string): Promise<void> {
    return this.request<void>(`/api/task-groups/${groupId}`, {
      method: 'DELETE',
    });
  }

  async toggleTaskGroup<T = unknown>(groupId: string, enabled: boolean): Promise<T> {
    return this.request<T>(`/api/task-groups/${groupId}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    });
  }

  async runTaskGroupNow<T = unknown>(groupId: string): Promise<T> {
    return this.request<T>(`/api/task-groups/${groupId}/run`, {
      method: 'POST',
    });
  }

  async getTaskGroupExecutions<T = unknown>(groupId: string, limit = 20): Promise<T[]> {
    return this.request<T[]>(`/api/task-groups/${groupId}/executions?limit=${limit}`);
  }

  async addTaskToGroup(groupId: string, taskId: string, sortOrder?: number): Promise<void> {
    return this.request<void>(`/api/task-groups/${groupId}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ taskId, sortOrder }),
    });
  }

  async removeTaskFromGroup(groupId: string, taskId: string): Promise<void> {
    return this.request<void>(`/api/task-groups/${groupId}/tasks/${taskId}`, {
      method: 'DELETE',
    });
  }

  async reorderTasksInGroup(groupId: string, taskIds: string[]): Promise<void> {
    return this.request<void>(`/api/task-groups/${groupId}/tasks/order`, {
      method: 'PUT',
      body: JSON.stringify({ taskIds }),
    });
  }

  // ============================================
  // Server Version Updates
  // ============================================

  async checkServerUpdate(serverId: string) {
    return this.request<VersionCheckResult>(`/api/server-updates/${serverId}/check`);
  }

  async checkAllServerUpdates() {
    return this.request<VersionCheckResult[]>(`/api/server-updates/check-all`);
  }

  async startServerUpdate(serverId: string, targetVersion?: string) {
    return this.request<UpdateSession>(`/api/server-updates/${serverId}/update`, {
      method: 'POST',
      body: JSON.stringify({ targetVersion }),
    });
  }

  async getUpdateSession(sessionId: string) {
    return this.request<UpdateSession>(`/api/server-updates/session/${sessionId}`);
  }

  async cancelServerUpdate(sessionId: string) {
    return this.request<{ success: boolean }>(`/api/server-updates/session/${sessionId}/cancel`, {
      method: 'POST',
    });
  }

  async rollbackServerUpdate(serverId: string) {
    return this.request<{ success: boolean }>(`/api/server-updates/${serverId}/rollback`, {
      method: 'POST',
    });
  }

  async getServerUpdateHistory(serverId: string, limit = 10) {
    return this.request<ServerUpdateHistory[]>(`/api/server-updates/${serverId}/history?limit=${limit}`);
  }

  async forceResetServerUpdate(serverId: string) {
    return this.request<{ success: boolean; message: string }>(`/api/server-updates/${serverId}/force-reset`, {
      method: 'POST',
    });
  }

  // ============================================
  // File Management
  // ============================================

  async listFiles<T = unknown>(serverId: string, path = ''): Promise<T[]> {
    return this.request<T[]>(`/api/servers/${serverId}/files?path=${encodeURIComponent(path)}`);
  }

  async readFile(serverId: string, path: string) {
    return this.request<{ content: string }>(`/api/servers/${serverId}/files/read?path=${encodeURIComponent(path)}`);
  }

  async writeFile(serverId: string, path: string, content: string) {
    return this.request<{ message: string }>(`/api/servers/${serverId}/files/write`, {
      method: 'POST',
      body: JSON.stringify({ path, content }),
    });
  }

  async createFile(serverId: string, path: string, content = '') {
    return this.request<{ message: string }>(`/api/servers/${serverId}/files/create`, {
      method: 'POST',
      body: JSON.stringify({ path, content }),
    });
  }

  async createDirectory(serverId: string, path: string) {
    return this.request<{ message: string }>(`/api/servers/${serverId}/files/mkdir`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
  }

  async deleteFile(serverId: string, path: string) {
    return this.request<void>(`/api/servers/${serverId}/files?path=${encodeURIComponent(path)}`, {
      method: 'DELETE',
    });
  }

  async renameFile(serverId: string, oldPath: string, newPath: string) {
    return this.request<{ message: string }>(`/api/servers/${serverId}/files/rename`, {
      method: 'POST',
      body: JSON.stringify({ oldPath, newPath }),
    });
  }

  async getFileInfo<T = unknown>(serverId: string, path: string): Promise<T> {
    return this.request<T>(`/api/servers/${serverId}/files/info?path=${encodeURIComponent(path)}`);
  }

  async searchFiles<T = unknown>(serverId: string, pattern: string, path = ''): Promise<T[]> {
    return this.request<T[]>(`/api/servers/${serverId}/files/search?pattern=${encodeURIComponent(pattern)}&path=${encodeURIComponent(path)}`);
  }

  async getDiskUsage(serverId: string) {
    return this.request<{ total: number; used: number }>(`/api/servers/${serverId}/files/usage`);
  }

  getFileDownloadUrl(serverId: string, path: string): string {
    return `${this.baseUrl}/api/servers/${serverId}/files/download?path=${encodeURIComponent(path)}`;
  }

  async uploadFile(
    serverId: string,
    filePath: string,
    file: File,
    autoExtractZip: boolean = true,
    onProgress?: (progress: number) => void,
    signal?: AbortSignal
  ) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('path', filePath);
    formData.append('autoExtractZip', String(autoExtractZip));

    return new Promise<{ fileName: string; size: number; extractedFiles: string[] }>((resolve, reject) => {
      let retried = false;
      const xhr = new XMLHttpRequest();

      let abortHandler: ((this: AbortSignal, ev: Event) => void) | undefined;
      if (signal) {
        if (signal.aborted) {
          reject(new Error('Upload cancelled'));
          return;
        }
        abortHandler = () => {
          xhr.abort();
        };
        signal.addEventListener('abort', abortHandler);
      }

      // Track upload progress
      if (onProgress) {
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable) {
            const progress = (event.loaded / event.total) * 100;
            onProgress(progress);
          }
        });
      }

      xhr.addEventListener('load', async () => {
        if (xhr.status === 401) {
          try {
            if (this.isRefreshing) {
              await new Promise<void>((resolveRefresh, rejectRefresh) => {
                this.subscribeToRefresh(async () => {
                  try {
                    resolveRefresh();
                  } catch (e) {
                    rejectRefresh(e);
                  }
                });
              });
            } else {
              this.isRefreshing = true;
              try {
                await authService.refreshAccessToken();
                this.onRefreshed('');
              } catch {
                await authService.logout({ callApi: false });
                reject(new AuthError('Session expired. Please login again.', 'TOKEN_EXPIRED', 401));
                return;
              } finally {
                this.isRefreshing = false;
              }
            }

            if (!retried) {
              retried = true;

              try {
                const result = await this.uploadFile(serverId, filePath, file, autoExtractZip, onProgress, signal);
                resolve(result);
              } catch (err) {
                reject(err);
              }
              return;
            }

            reject(new AuthError('Session expired. Please login again.', 'TOKEN_EXPIRED', 401));
          } catch {
            reject(new AuthError('Session expired. Please login again.', 'TOKEN_EXPIRED', 401));
          }
        } else if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            resolve(response);
          } catch {
            reject(new Error('Failed to parse upload response'));
          }
        } else {
          try {
            const error = JSON.parse(xhr.responseText);
            reject(new Error(error.error || 'Upload failed'));
          } catch {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Upload failed'));
      });

      xhr.addEventListener('abort', () => {
        reject(new Error('Upload cancelled'));
      });

      xhr.addEventListener('loadend', () => {
        if (signal && abortHandler) {
          signal.removeEventListener('abort', abortHandler);
        }
      });

      xhr.open('POST', `${this.baseUrl}/api/servers/${serverId}/files/upload`);
      xhr.withCredentials = true;

      xhr.send(formData);
    });
  }

  // ===================================
  // Performance Metrics
  // ===================================

  async getMetrics(serverId: string, options?: { startTime?: Date; endTime?: Date; limit?: number }) {
    const params = new URLSearchParams();
    if (options?.startTime) params.append('startTime', options.startTime.toISOString());
    if (options?.endTime) params.append('endTime', options.endTime.toISOString());
    if (options?.limit) params.append('limit', options.limit.toString());

    const query = params.toString();
    return this.request<ServerMetricsResponse[]>(`/api/servers/${serverId}/metrics${query ? `?${query}` : ''}`);
  }

  async getLatestMetrics(serverId: string) {
    return this.request<ServerMetricsResponse>(`/api/servers/${serverId}/metrics/latest`);
  }

  async getAggregatedMetrics(serverId: string, interval: '1h' | '6h' | '24h' | '7d' | '30d') {
    return this.request<ServerMetricsResponse[]>(`/api/servers/${serverId}/metrics/aggregate/${interval}`);
  }

  // ===================================
  // Worlds Management
  // ===================================

  async listWorlds<T = unknown>(serverId: string): Promise<T[]> {
    return this.request<T[]>(`/api/servers/${serverId}/worlds`);
  }

  async getWorld<T = unknown>(serverId: string, worldId: string): Promise<T> {
    return this.request<T>(`/api/servers/${serverId}/worlds/${worldId}`);
  }

  async activateWorld(serverId: string, worldId: string) {
    return this.request<{ message: string }>(`/api/servers/${serverId}/worlds/${worldId}/activate`, {
      method: 'POST',
    });
  }

  async updateWorld<T = unknown>(serverId: string, worldId: string, data: { name?: string; description?: string }): Promise<T> {
    return this.request<T>(`/api/servers/${serverId}/worlds/${worldId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteWorld(serverId: string, worldId: string) {
    return this.request<void>(`/api/servers/${serverId}/worlds/${worldId}`, {
      method: 'DELETE',
    });
  }

  async getWorldConfig<T = unknown>(serverId: string, worldId: string): Promise<T> {
    return this.request<T>(`/api/servers/${serverId}/worlds/${worldId}/config`);
  }

  async updateWorldConfig<T = unknown>(serverId: string, worldId: string, config: unknown): Promise<T> {
    return this.request<T>(`/api/servers/${serverId}/worlds/${worldId}/config`, {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  }

  // ===================================
  // Alerts & Notifications
  // ===================================

  async getAlerts<T = unknown>(serverId?: string, options?: { unreadOnly?: boolean; unresolvedOnly?: boolean; limit?: number }): Promise<T[]> {
    const params = new URLSearchParams();
    if (options?.unreadOnly) params.append('unreadOnly', 'true');
    if (options?.unresolvedOnly) params.append('unresolvedOnly', 'true');
    if (options?.limit) params.append('limit', options.limit.toString());

    const query = params.toString();
    const url = serverId
      ? `/api/servers/${serverId}/alerts${query ? `?${query}` : ''}`
      : `/api/alerts${query ? `?${query}` : ''}`;

    return this.request<T[]>(url);
  }

  async getUnreadCount(serverId?: string) {
    const url = serverId ? `/api/servers/${serverId}/alerts/unread-count` : '/api/alerts/unread-count';
    return this.request<{ count: number }>(url);
  }

  async markAlertAsRead(serverId: string, alertId: string) {
    return this.request<{ message: string }>(`/api/servers/${serverId}/alerts/${alertId}/read`, {
      method: 'PUT',
    });
  }

  async markAllAlertsAsRead(serverId: string) {
    return this.request<{ message: string }>(`/api/servers/${serverId}/alerts/read-all`, {
      method: 'PUT',
    });
  }

  async markAllAlertsAsReadGlobal() {
    return this.request<{ message: string }>('/api/alerts/read-all', {
      method: 'PUT',
    });
  }

  async resolveAlert(serverId: string, alertId: string) {
    return this.request<{ message: string }>(`/api/servers/${serverId}/alerts/${alertId}/resolve`, {
      method: 'PUT',
    });
  }

  async deleteAlert(serverId: string, alertId: string) {
    return this.request<void>(`/api/servers/${serverId}/alerts/${alertId}`, {
      method: 'DELETE',
    });
  }

  async deleteAlertsBatch(alertIds: string[]): Promise<{ deleted: number; message: string }> {
    return this.request<{ deleted: number; message: string }>('/api/alerts/batch', {
      method: 'DELETE',
      body: JSON.stringify({ alertIds }),
    });
  }

  // ===================================
  // Automation Rules
  // ===================================

  async getAutomationRules<T = unknown>(serverId?: string): Promise<T[]> {
    const url = serverId ? `/api/servers/${serverId}/automation-rules` : '/api/automation-rules';
    return this.request<T[]>(url);
  }

  async getAutomationRule<T = unknown>(serverId: string, ruleId: string): Promise<T> {
    return this.request<T>(`/api/servers/${serverId}/automation-rules/${ruleId}`);
  }

  async createAutomationRule<T = unknown>(serverId: string, data: unknown): Promise<T> {
    return this.request<T>(`/api/servers/${serverId}/automation-rules`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateAutomationRule<T = unknown>(serverId: string, ruleId: string, data: unknown): Promise<T> {
    return this.request<T>(`/api/servers/${serverId}/automation-rules/${ruleId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteAutomationRule(serverId: string, ruleId: string) {
    return this.request<void>(`/api/servers/${serverId}/automation-rules/${ruleId}`, {
      method: 'DELETE',
    });
  }

  async toggleAutomationRule(serverId: string, ruleId: string, enabled: boolean) {
    return this.request<{ message: string }>(`/api/servers/${serverId}/automation-rules/${ruleId}/toggle`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
  }

  async executeAutomationRule(serverId: string, ruleId: string) {
    return this.request<{ message: string }>(`/api/servers/${serverId}/automation-rules/${ruleId}/execute`, {
      method: 'POST',
    });
  }

  // ============================================
  // Network Endpoints
  // ============================================

  async getNetworks<T = unknown>(): Promise<T[]> {
    return this.request<T[]>('/api/networks');
  }

  async getNetwork<T = unknown>(id: string): Promise<T> {
    return this.request<T>(`/api/networks/${id}`);
  }

  async getUngroupedServers<T = unknown>(): Promise<T[]> {
    return this.request<T[]>('/api/networks/ungrouped');
  }

  async createNetwork<T = unknown>(data: {
    name: string;
    description?: string;
    networkType?: 'logical' | 'proxy';
    proxyServerId?: string;
    proxyConfig?: { startOrder?: 'proxy_first' | 'backends_first' };
    color?: string;
    serverIds?: string[];
  }): Promise<T> {
    return this.request<T>('/api/networks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateNetwork<T = unknown>(id: string, data: {
    name?: string;
    description?: string;
    proxyServerId?: string;
    proxyConfig?: { startOrder?: 'proxy_first' | 'backends_first' };
    color?: string;
    sortOrder?: number;
    bulkActionsEnabled?: boolean;
  }): Promise<T> {
    return this.request<T>(`/api/networks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteNetwork(id: string) {
    return this.request<{ message: string }>(`/api/networks/${id}`, {
      method: 'DELETE',
    });
  }

  // Network membership
  async addServerToNetwork(networkId: string, serverId: string, role?: string) {
    return this.request<{ message: string }>(`/api/networks/${networkId}/servers`, {
      method: 'POST',
      body: JSON.stringify({ serverId, role }),
    });
  }

  async removeServerFromNetwork(networkId: string, serverId: string) {
    return this.request<{ message: string }>(`/api/networks/${networkId}/servers/${serverId}`, {
      method: 'DELETE',
    });
  }

  async updateMemberRole(networkId: string, serverId: string, role: string) {
    return this.request<{ message: string }>(`/api/networks/${networkId}/servers/${serverId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
  }

  async reorderNetworkMembers(networkId: string, serverIds: string[]) {
    return this.request<{ message: string }>(`/api/networks/${networkId}/servers/order`, {
      method: 'PUT',
      body: JSON.stringify({ serverIds }),
    });
  }

  // Network bulk operations
  async startNetwork(networkId: string) {
    return this.request<{
      networkId: string;
      results: { serverId: string; serverName: string; success: boolean; error?: string }[];
      success: boolean;
    }>(`/api/networks/${networkId}/start`, {
      method: 'POST',
    });
  }

  async stopNetwork(networkId: string) {
    return this.request<{
      networkId: string;
      results: { serverId: string; serverName: string; success: boolean; error?: string }[];
      success: boolean;
    }>(`/api/networks/${networkId}/stop`, {
      method: 'POST',
    });
  }

  async restartNetwork(networkId: string) {
    return this.request<{
      networkId: string;
      results: { serverId: string; serverName: string; success: boolean; error?: string }[];
      success: boolean;
    }>(`/api/networks/${networkId}/restart`, {
      method: 'POST',
    });
  }

  // Network status & metrics
  async getNetworkStatus<T = unknown>(networkId: string): Promise<T> {
    return this.request<T>(`/api/networks/${networkId}/status`);
  }

  async getNetworkMetrics<T = unknown>(networkId: string): Promise<T> {
    return this.request<T>(`/api/networks/${networkId}/metrics`);
  }

  async getNetworkPlayers<T = unknown>(networkId: string): Promise<T[]> {
    return this.request<T[]>(`/api/networks/${networkId}/players`);
  }

  // Network backups
  async getNetworkBackups<T = unknown>(networkId: string): Promise<T[]> {
    return this.request<T[]>(`/api/networks/${networkId}/backups`);
  }

  async createNetworkBackup<T = unknown>(networkId: string, description?: string): Promise<T> {
    return this.request<T>(`/api/networks/${networkId}/backups`, {
      method: 'POST',
      body: JSON.stringify({ description }),
    });
  }

  async deleteNetworkBackup(networkId: string, backupId: string) {
    return this.request<{ message: string }>(`/api/networks/${networkId}/backups/${backupId}`, {
      method: 'DELETE',
    });
  }

  // ============================================
  // Settings Endpoints
  // ============================================

  async getDiscordSettings<T = unknown>(): Promise<T> {
    return this.request<T>('/api/settings/discord');
  }

  async updateDiscordSettings(data: unknown) {
    return this.request<{ success: boolean; message: string }>('/api/settings/discord', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async testDiscordNotification() {
    return this.request<{ success: boolean; message: string }>('/api/settings/discord/test', {
      method: 'POST',
    });
  }

  // ============================================
  // Permissions Endpoints
  // ============================================

  /**
   * Get current user's permissions
   */
  async getMyPermissions(): Promise<{ role: string; permissions: string[] }> {
    return this.request<{ role: string; permissions: string[] }>('/api/permissions/me');
  }

  /**
   * Get all permission definitions
   */
  async getAllPermissions<T = unknown>(): Promise<T> {
    return this.request<T>('/api/permissions');
  }

  /**
   * Get all role-permission mappings
   */
  async getRolePermissions(): Promise<{
    roles: string[];
    rolePermissions: Record<string, string[]>;
  }> {
    return this.request('/api/permissions/roles');
  }

  /**
   * Get permissions for a specific role
   */
  async getRolePermission(role: string): Promise<{ role: string; permissions: string[] }> {
    return this.request<{ role: string; permissions: string[] }>(`/api/permissions/roles/${role}`);
  }

  /**
   * Update permissions for a role
   */
  async updateRolePermissions(
    role: string,
    permissions: string[]
  ): Promise<{ message: string; role: string; permissions: string[] }> {
    return this.request(`/api/permissions/roles/${role}`, {
      method: 'PUT',
      body: JSON.stringify({ permissions }),
    });
  }

  /**
   * Reset role permissions to defaults
   */
  async resetRolePermissions(
    role: string
  ): Promise<{ message: string; role: string; permissions: string[] }> {
    return this.request(`/api/permissions/roles/${role}/reset`, {
      method: 'POST',
    });
  }

  // ============================================
  // User Management (Admin only)
  // ============================================

  async getUsers<T = unknown>(): Promise<T[]> {
    return this.request<T[]>('/api/users');
  }

  async getUser<T = unknown>(id: string): Promise<T> {
    return this.request<T>(`/api/users/${id}`);
  }

  async createUser<T = unknown>(data: {
    email: string;
    username: string;
    password: string;
    role?: 'admin' | 'moderator' | 'viewer';
  }): Promise<T> {
    return this.request<T>('/api/users', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateUser<T = unknown>(id: string, data: Partial<{
    email: string;
    username: string;
    password: string;
    role: 'admin' | 'moderator' | 'viewer';
  }>): Promise<T> {
    return this.request<T>(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteUser(id: string) {
    return this.request<{ message: string }>(`/api/users/${id}`, {
      method: 'DELETE',
    });
  }

  // ============================================
  // Activity Log Endpoints
  // ============================================

  /**
   * Query activity logs with filters and pagination
   */
  async getActivityLogs<T = unknown>(params?: {
    userId?: string;
    action?: string;
    actionCategory?: string;
    resourceType?: string;
    resourceId?: string;
    status?: 'success' | 'failed';
    startDate?: string;
    endDate?: string;
    search?: string;
    page?: number;
    limit?: number;
    sortBy?: 'timestamp' | 'action' | 'username';
    sortOrder?: 'asc' | 'desc';
  }): Promise<{
    data: T[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          queryParams.append(key, String(value));
        }
      });
    }
    const query = queryParams.toString();
    return this.request(`/api/activity${query ? `?${query}` : ''}`);
  }

  /**
   * Get recent activity for dashboard
   */
  async getRecentActivity<T = unknown>(limit = 10): Promise<T[]> {
    return this.request<T[]>(`/api/activity/recent?limit=${limit}`);
  }

  /**
   * Get activity statistics
   */
  async getActivityStats(startDate?: string, endDate?: string): Promise<{
    totalActions: number;
    actionsByCategory: Record<string, number>;
    actionsByStatus: Record<string, number>;
    topUsers: Array<{ username: string; count: number }>;
  }> {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    const query = params.toString();
    return this.request(`/api/activity/stats${query ? `?${query}` : ''}`);
  }

  /**
   * Get activity for a specific server
   */
  async getServerActivity<T = unknown>(serverId: string, limit = 50): Promise<T[]> {
    return this.request<T[]>(`/api/activity/server/${serverId}?limit=${limit}`);
  }

  /**
   * Get activity for a specific user
   */
  async getUserActivity<T = unknown>(userId: string, limit = 50): Promise<T[]> {
    return this.request<T[]>(`/api/activity/user/${userId}?limit=${limit}`);
  }

  /**
   * Get single activity log entry
   */
  async getActivityEntry<T = unknown>(id: string): Promise<T> {
    return this.request<T>(`/api/activity/${id}`);
  }

  // ============================================
  // Dashboard Endpoints
  // ============================================

  /**
   * Get aggregated dashboard stats
   */
  async getDashboardStats(): Promise<{
    totalServers: number;
    runningServers: number;
    stoppedServers: number;
    totalPlayers: number;
    host: {
      cpu: { usage: number; cores: number; model: string };
      memory: { usage: number; usedGB: number; totalGB: number; freeGB: number };
      system: { uptime: number; platform: string; hostname: string };
    };
    serverMetrics: {
      totalCpu: number;
      totalMemoryMB: number;
      avgCpu: number;
      avgMemory: number;
    };
    alerts: { critical: number; warning: number; info: number };
    statusDistribution: Record<string, number>;
  }> {
    return this.request('/api/dashboard/stats');
  }

  /**
   * Get historical metrics for dashboard charts
   */
  async getDashboardMetricsHistory(range: '1h' | '24h' | '7d' | '30d' = '24h'): Promise<{
    timestamps: string[];
    cpu: number[];
    memory: number[];
    players: number[];
  }> {
    return this.request(`/api/dashboard/metrics/history?range=${range}`);
  }

  /**
   * Get server health overview
   */
  async getDashboardHealth(): Promise<Array<{
    id: string;
    name: string;
    status: ServerStatus;
    healthStatus: 'healthy' | 'warning' | 'critical' | 'offline';
    playerCount: number;
    maxPlayers: number;
    cpuUsage: number;
    memoryUsage: number;
    memoryUsedMB: number;
    diskUsage: number;
  }>> {
    return this.request('/api/dashboard/health');
  }

  /**
   * Get alerts summary for dashboard
   */
  async getDashboardAlertsSummary(): Promise<{
    counts: { critical: number; warning: number; info: number; total: number };
    unreadCount: number;
    recentAlerts: Array<{
      id: string;
      serverId: string;
      type: string;
      severity: 'info' | 'warning' | 'critical';
      title: string;
      message: string;
      createdAt: string;
    }>;
  }> {
    return this.request('/api/dashboard/alerts-summary');
  }

  /**
   * Execute quick action from dashboard
   */
  async dashboardQuickAction(action: 'start-all' | 'stop-all' | 'restart-all', serverIds?: string[]): Promise<{
    action: string;
    results: Array<{ serverId: string; serverName: string; success: boolean; error?: string }>;
    successCount: number;
    failedCount: number;
  }> {
    return this.request(`/api/dashboard/quick-action/${action}`, {
      method: 'POST',
      body: JSON.stringify({ serverIds }),
    });
  }
}

/**
 * Singleton API service instance
 */
export const api = new ApiService();

export default api;
