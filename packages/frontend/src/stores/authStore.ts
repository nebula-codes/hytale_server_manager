/**
 * Authentication Store
 *
 * Zustand store for managing authentication state. Integrates with the
 * AuthService for JWT-based authentication and provides reactive state
 * for the UI.
 *
 * @module stores/authStore
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, PermissionCode } from '../types';
import { authService, AuthError } from '../services/auth';
import type { LoginCredentials } from '../services/auth';
import { logger } from '../config';
import { api } from '../services/api';

/**
 * Authentication state interface
 */
interface AuthState {
  /** Current authenticated user */
  user: User | null;
  /** Whether the user is authenticated */
  isAuthenticated: boolean;
  /** Whether authentication is being initialized */
  isInitializing: boolean;
  /** Whether initial admin setup is required */
  setupRequired: boolean | null;
  /** Whether setup status is loading */
  isSetupLoading: boolean;
  /** Whether a login request is in progress */
  isLoading: boolean;
  /** Last authentication error */
  error: string | null;
}

/**
 * Authentication actions interface
 */
interface AuthActions {
  /**
   * Logs in a user with credentials
   * @param credentials - Login credentials
   * @returns Success status and optional error message
   */
  login: (credentials: LoginCredentials) => Promise<{ success: boolean; error?: string }>;

  /**
   * Logs out the current user
   */
  logout: () => Promise<void>;

  /**
   * Checks if the current session is valid
   * @returns True if authenticated
   */
  checkAuth: () => Promise<boolean>;

  /**
   * Initializes authentication state from stored tokens
   */
  initialize: () => Promise<void>;

  /**
   * Clears the current error state
   */
  clearError: () => void;

  /**
   * Refreshes the current user data
   */
  refreshUser: () => Promise<void>;

  /**
   * Fetches and updates user permissions from the API
   */
  fetchPermissions: () => Promise<void>;
}

/**
 * Combined auth store type
 */
type AuthStore = AuthState & AuthActions;

/**
 * Creates the authentication store with persist middleware
 */
export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      // Initial state
      user: null,
      isAuthenticated: false,
      isInitializing: true,
      setupRequired: null,
      isSetupLoading: true,
      isLoading: false,
      error: null,

      /**
       * Logs in a user with the provided credentials
       */
      login: async (credentials: LoginCredentials) => {
        set({ isLoading: true, error: null });

        try {
          const response = await authService.login(credentials);

          set({
            user: response.user,
            isAuthenticated: true,
            isLoading: false,
            error: null,
            setupRequired: false,
            isSetupLoading: false,
          });

          // Fetch user permissions after successful login
          try {
            const permissionsResponse = await api.getMyPermissions();
            set((state) => ({
              user: state.user
                ? { ...state.user, permissions: permissionsResponse.permissions as PermissionCode[] }
                : null,
            }));
            logger.debug('User permissions loaded:', permissionsResponse.permissions.length);
          } catch (permError) {
            logger.warn('Failed to fetch permissions:', permError);
          }

          logger.info('User logged in:', response.user.email);
          return { success: true };
        } catch (error) {
          const message = error instanceof AuthError
            ? error.message
            : 'An unexpected error occurred';

          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: message,
          });

          logger.error('Login failed:', message);
          return { success: false, error: message };
        }
      },

      /**
       * Logs out the current user
       */
      logout: async () => {
        try {
          await authService.logout();
        } catch (error) {
          logger.warn('Logout error:', error);
        }

        set({
          user: null,
          isAuthenticated: false,
          error: null,
        });

        logger.info('User logged out');
      },

      /**
       * Checks if the current session is valid and refreshes if needed
       */
      checkAuth: async () => {
        const isValid = await authService.isSessionValid();

        if (isValid) {
          const user = await authService.getCurrentUser();
          if (user) {
            set({ user, isAuthenticated: true });
            return true;
          }
        }

        set({ user: null, isAuthenticated: false });
        return false;
      },

      /**
       * Initializes authentication state from stored tokens
       */
      initialize: async () => {
        set({ isInitializing: true, isSetupLoading: true });

        try {
          const setupStatus = await authService.getSetupStatus();

          if (setupStatus.setupRequired) {
            set({
              user: null,
              isAuthenticated: false,
              isInitializing: false,
              setupRequired: true,
              isSetupLoading: false,
            });
            logger.info('Auth initialized: setup required');
            return;
          }

          // Check if there's an access token in localStorage before attempting refresh
          // This prevents unnecessary API calls on the login page
          const hasToken = !!localStorage.getItem('accessToken');

          if (!hasToken) {
            set({
              user: null,
              isAuthenticated: false,
              isInitializing: false,
              setupRequired: false,
              isSetupLoading: false,
            });
            logger.debug('Auth initialized: no stored token');
            return;
          }

          // getCurrentUser() calls refreshAccessToken internally
          const user = await authService.getCurrentUser();

          set({
            user,
            isAuthenticated: !!user,
            isInitializing: false,
            setupRequired: false,
            isSetupLoading: false,
          });

          // Fetch permissions if user is authenticated
          if (user) {
            try {
              const permissionsResponse = await api.getMyPermissions();
              set((state) => ({
                user: state.user
                  ? { ...state.user, permissions: permissionsResponse.permissions as PermissionCode[] }
                  : null,
              }));
              logger.debug('User permissions loaded:', permissionsResponse.permissions.length);
            } catch (permError) {
              logger.warn('Failed to fetch permissions:', permError);
            }
            logger.info('Auth initialized:', user.email);
          } else {
            logger.debug('Auth initialized: no valid session');
          }
        } catch (error) {
          logger.error('Auth initialization error:', error);
          set({
            user: null,
            isAuthenticated: false,
            isInitializing: false,
            setupRequired: false,
            isSetupLoading: false,
          });
        }
      },

      /**
       * Clears the current error state
       */
      clearError: () => {
        set({ error: null });
      },

      /**
       * Refreshes the current user data from the token
       */
      refreshUser: async () => {
        const user = await authService.getCurrentUser();
        if (user) {
          set({ user });
        }
      },

      /**
       * Fetches and updates user permissions from the API
       */
      fetchPermissions: async () => {
        try {
          const permissionsResponse = await api.getMyPermissions();
          set((state) => ({
            user: state.user
              ? { ...state.user, permissions: permissionsResponse.permissions as PermissionCode[] }
              : null,
          }));
          logger.debug('User permissions refreshed:', permissionsResponse.permissions.length);
        } catch (error) {
          logger.error('Failed to fetch permissions:', error);
        }
      },
    }),
    {
      name: 'hytalepanel-auth',
      // Only persist user data, not loading states
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

/**
 * Hook to get only the user from the auth store
 */
export const useUser = () => useAuthStore((state) => state.user);

/**
 * Hook to get only the authentication status
 */
export const useIsAuthenticated = () => useAuthStore((state) => state.isAuthenticated);

/**
 * Hook to get loading state
 */
export const useAuthLoading = () => useAuthStore((state) => state.isLoading);

/**
 * Hook to get auth error
 */
export const useAuthError = () => useAuthStore((state) => state.error);

export default useAuthStore;
