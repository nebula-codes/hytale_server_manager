/**
 * Server Update API Hooks
 *
 * React Query hooks for server version update operations.
 * Provides version checking, update execution, and history tracking.
 *
 * @module hooks/api/useServerUpdates
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import api from '../../services/api';
import type { VersionCheckResult, UpdateSession, ServerUpdateHistory } from '../../types';
import { useToast } from '../../stores/toastStore';
import { logger } from '../../config';
import { serverKeys } from './useServers';

/**
 * Query key factory for server updates
 */
export const serverUpdateKeys = {
  all: ['server-updates'] as const,
  checks: () => [...serverUpdateKeys.all, 'check'] as const,
  check: (serverId: string) => [...serverUpdateKeys.checks(), serverId] as const,
  checkAll: () => [...serverUpdateKeys.checks(), 'all'] as const,
  sessions: () => [...serverUpdateKeys.all, 'session'] as const,
  session: (sessionId: string) => [...serverUpdateKeys.sessions(), sessionId] as const,
  histories: () => [...serverUpdateKeys.all, 'history'] as const,
  history: (serverId: string) => [...serverUpdateKeys.histories(), serverId] as const,
};

/**
 * Hook to check for updates for a specific server
 *
 * @param serverId - Server ID
 * @param options - Additional query options
 * @returns Query result with version check info
 */
export function useCheckServerUpdate(
  serverId: string,
  options?: Omit<UseQueryOptions<VersionCheckResult, Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: serverUpdateKeys.check(serverId),
    queryFn: async () => {
      logger.debug('Checking for server updates:', serverId);
      return api.checkServerUpdate(serverId);
    },
    enabled: !!serverId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    ...options,
  });
}

/**
 * Hook to check for updates for all servers
 *
 * @param options - Additional query options
 * @returns Query result with version check info for all servers
 */
export function useCheckAllServerUpdates(
  options?: Omit<UseQueryOptions<VersionCheckResult[], Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: serverUpdateKeys.checkAll(),
    queryFn: async () => {
      logger.debug('Checking for updates on all servers');
      return api.checkAllServerUpdates();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    ...options,
  });
}

/**
 * Hook to get update session status
 *
 * @param sessionId - Update session ID
 * @param options - Additional query options
 * @returns Query result with session status
 */
export function useUpdateSession(
  sessionId: string | null,
  options?: Omit<UseQueryOptions<UpdateSession, Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: serverUpdateKeys.session(sessionId || ''),
    queryFn: async () => {
      logger.debug('Fetching update session:', sessionId);
      return api.getUpdateSession(sessionId!);
    },
    enabled: !!sessionId,
    refetchInterval: (query) => {
      // Poll while update is in progress
      const data = query.state.data;
      if (data && data.status !== 'completed' && data.status !== 'failed' && data.status !== 'rolled_back') {
        return 2000; // Poll every 2 seconds
      }
      return false;
    },
    ...options,
  });
}

/**
 * Hook to get server update history
 *
 * @param serverId - Server ID
 * @param limit - Number of records to fetch
 * @param options - Additional query options
 * @returns Query result with update history
 */
export function useServerUpdateHistory(
  serverId: string,
  limit = 10,
  options?: Omit<UseQueryOptions<ServerUpdateHistory[], Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: serverUpdateKeys.history(serverId),
    queryFn: async () => {
      logger.debug('Fetching server update history:', serverId);
      return api.getServerUpdateHistory(serverId, limit);
    },
    enabled: !!serverId,
    staleTime: 60 * 1000, // 1 minute
    ...options,
  });
}

/**
 * Hook to start a server update
 *
 * @returns Mutation for starting server update
 */
export function useStartServerUpdate() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: async ({ serverId, targetVersion }: { serverId: string; targetVersion?: string }) => {
      logger.debug('Starting server update:', serverId, targetVersion);
      return api.startServerUpdate(serverId, targetVersion);
    },
    onSuccess: (data, { serverId }) => {
      toast.success(`Update started for server. Version: ${data.fromVersion} → ${data.toVersion}`);
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: serverKeys.detail(serverId) });
      queryClient.invalidateQueries({ queryKey: serverUpdateKeys.check(serverId) });
    },
    onError: (error: Error) => {
      toast.error(`Failed to start update: ${error.message}`);
    },
  });
}

/**
 * Hook to cancel a server update
 *
 * @returns Mutation for cancelling server update
 */
export function useCancelServerUpdate() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      logger.debug('Cancelling server update:', sessionId);
      return api.cancelServerUpdate(sessionId);
    },
    onSuccess: (_, sessionId) => {
      toast.info('Update cancelled');
      queryClient.invalidateQueries({ queryKey: serverUpdateKeys.session(sessionId) });
    },
    onError: (error: Error) => {
      toast.error(`Failed to cancel update: ${error.message}`);
    },
  });
}

/**
 * Hook to rollback a server update
 *
 * @returns Mutation for rolling back server update
 */
export function useRollbackServerUpdate() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: async (serverId: string) => {
      logger.debug('Rolling back server update:', serverId);
      return api.rollbackServerUpdate(serverId);
    },
    onSuccess: (_, serverId) => {
      toast.success('Server rolled back to previous version');
      queryClient.invalidateQueries({ queryKey: serverKeys.detail(serverId) });
      queryClient.invalidateQueries({ queryKey: serverUpdateKeys.history(serverId) });
    },
    onError: (error: Error) => {
      toast.error(`Failed to rollback: ${error.message}`);
    },
  });
}

/**
 * Hook to manually trigger a version check
 *
 * @returns Mutation for checking server updates
 */
export function useRefreshVersionCheck() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: async (serverId: string) => {
      logger.debug('Refreshing version check:', serverId);
      return api.checkServerUpdate(serverId);
    },
    onSuccess: (data, serverId) => {
      queryClient.setQueryData(serverUpdateKeys.check(serverId), data);
      if (data.updateAvailable) {
        toast.info(`Update available: ${data.availableVersion}`);
      } else {
        toast.info('Server is up to date');
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to check for updates: ${error.message}`);
    },
  });
}

/**
 * Hook to force reset a stuck server update
 *
 * @returns Mutation for resetting server update state
 */
export function useForceResetServerUpdate() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: async (serverId: string) => {
      logger.debug('Force resetting server update:', serverId);
      return api.forceResetServerUpdate(serverId);
    },
    onSuccess: (_, serverId) => {
      toast.success('Update state reset successfully');
      queryClient.invalidateQueries({ queryKey: serverKeys.detail(serverId) });
      queryClient.invalidateQueries({ queryKey: serverUpdateKeys.check(serverId) });
    },
    onError: (error: Error) => {
      toast.error(`Failed to reset update: ${error.message}`);
    },
  });
}
