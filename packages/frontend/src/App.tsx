/**
 * Main Application Component
 *
 * Root component that sets up routing, authentication, error handling,
 * and global providers for the Hytale Server Manager application.
 *
 * @module App
 */

import { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from './stores/authStore';
import { LoginPage } from './pages/auth/LoginPage';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { ToastContainer, CommandPalette } from './components/ui';
import { InstallationQueueWidget } from './components/widgets/InstallationQueueWidget';
import { ErrorBoundary, PageErrorBoundary } from './components/error';
import { RequirePermission } from './components/auth';
import { env, logger } from './config';
import { QueryProvider } from './providers/QueryProvider';
import { PERMISSIONS } from './types';

// Lazy load page components for better initial load performance
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage').then(m => ({ default: m.DashboardPage })));
const ServersPage = lazy(() => import('./pages/servers/ServersPage').then(m => ({ default: m.ServersPage })));
const ServerDetailPage = lazy(() => import('./pages/servers/ServerDetailPage').then(m => ({ default: m.ServerDetailPage })));
const ServerSettingsPage = lazy(() => import('./pages/servers/ServerSettingsPage').then(m => ({ default: m.ServerSettingsPage })));
const ServerWorldsPage = lazy(() => import('./pages/servers/ServerWorldsPage').then(m => ({ default: m.ServerWorldsPage })));
const ModsPage = lazy(() => import('./pages/mods/ModsPage').then(m => ({ default: m.ModsPage })));
const ModpacksPage = lazy(() => import('./pages/modpacks/ModpacksPage').then(m => ({ default: m.ModpacksPage })));
const BackupsPage = lazy(() => import('./pages/backups/BackupsPage').then(m => ({ default: m.BackupsPage })));
const ConsolePage = lazy(() => import('./pages/console/ConsolePage').then(m => ({ default: m.ConsolePage })));
const PlayersPage = lazy(() => import('./pages/players/PlayersPage').then(m => ({ default: m.PlayersPage })));
const PlayerDetailPage = lazy(() => import('./pages/players/PlayerDetailPage').then(m => ({ default: m.PlayerDetailPage })));
const BridgePage = lazy(() => import('./pages/bridge/BridgePage').then(m => ({ default: m.BridgePage })));
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage').then(m => ({ default: m.SettingsPage })));
const AutomationPage = lazy(() => import('./pages/automation/AutomationPage').then(m => ({ default: m.AutomationPage })));
const AnalyticsPage = lazy(() => import('./pages/analytics/AnalyticsPage').then(m => ({ default: m.AnalyticsPage })));
const FileManagerPage = lazy(() => import('./pages/files/FileManagerPage').then(m => ({ default: m.FileManagerPage })));
const PermissionsPage = lazy(() => import('./pages/permissions/PermissionsPage').then(m => ({ default: m.PermissionsPage })));
const EconomyPage = lazy(() => import('./pages/economy/EconomyPage').then(m => ({ default: m.EconomyPage })));
// WorldsPage is no longer used as a standalone page - worlds are now per-server at /servers/:id/worlds
const AlertsPage = lazy(() => import('./pages/alerts/AlertsPage').then(m => ({ default: m.AlertsPage })));
const UsersPage = lazy(() => import('./pages/users/UsersPage').then(m => ({ default: m.UsersPage })));
const ActivityLogPage = lazy(() => import('./pages/activity/ActivityLogPage').then(m => ({ default: m.ActivityLogPage })));
const HSMLogsPage = lazy(() => import('./pages/hsm-logs/HSMLogsPage').then(m => ({ default: m.HSMLogsPage })));

/**
 * Page loading fallback component
 */
function PageLoader() {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="flex flex-col items-center gap-4">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-accent-primary" />
        <p className="text-text-light-muted dark:text-text-muted text-sm">{t('app.loading')}</p>
      </div>
    </div>
  );
}

/**
 * Protected Route Component
 *
 * Wraps routes that require authentication. Redirects to login if
 * not authenticated and wraps content in error boundary.
 */
function ProtectedRoute({ children, pageName }: { children: React.ReactNode; pageName?: string }) {
  const { isAuthenticated, isInitializing } = useAuthStore();
  const { t } = useTranslation();

  // Show loading while initializing auth state
  if (isInitializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-primary-light-bg dark:bg-primary-bg">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary" />
          <p className="text-text-light-muted dark:text-text-muted">{t('app.initializing')}</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Wrap in page-level error boundary if page name provided
  if (pageName) {
    return (
      <PageErrorBoundary name={pageName}>
        <Suspense fallback={<PageLoader />}>
          {children}
        </Suspense>
      </PageErrorBoundary>
    );
  }

  return <>{children}</>;
}

/**
 * Global error handler for unhandled errors
 */
function handleGlobalError(error: Error, errorInfo: React.ErrorInfo): void {
  logger.error('Global error caught:', error, errorInfo.componentStack);

  // In production, report to error tracking service
  if (env.isProduction) {
    // TODO: Implement error reporting (e.g., Sentry)
  }
}

/**
 * Main Application Component
 */
function App() {
  const initialize = useAuthStore((state) => state.initialize);
  const { t } = useTranslation();

  // Initialize authentication on app load
  useEffect(() => {
    logger.info(`${env.app.name} v${env.app.version} starting...`);
    logger.debug('Environment:', env.NODE_ENV);

    initialize();
  }, [initialize]);

  return (
    <ErrorBoundary
      name="Application"
      onError={handleGlobalError}
      fallback={(error, reset) => (
        <div className="min-h-screen flex items-center justify-center bg-primary-light-bg dark:bg-primary-bg p-4">
          <div className="max-w-md w-full text-center">
            <div className="inline-flex items-center justify-center w-20 h-20 bg-danger/20 rounded-full mb-6">
              <svg
                className="w-10 h-10 text-danger"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>

            <h1 className="text-2xl font-heading font-bold text-text-light-primary dark:text-text-primary mb-2">
              {t('app.error.title')}
            </h1>
            <p className="text-text-light-muted dark:text-text-muted mb-6">
              {error.message || t('app.error.unexpected')}
            </p>

            <div className="flex flex-col gap-3">
              <button
                onClick={reset}
                className="w-full px-4 py-3 bg-accent-primary text-black font-medium rounded-lg hover:bg-accent-primary/90 transition-colors"
              >
                {t('app.error.try_again')}
              </button>
              <button
                onClick={() => window.location.reload()}
                className="w-full px-4 py-3 bg-white dark:bg-primary-bg-secondary text-text-light-primary dark:text-text-primary font-medium rounded-lg border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                {t('app.error.reload')}
              </button>
            </div>

            {env.isDevelopment && error.stack && (
              <pre className="mt-6 p-4 bg-primary-bg dark:bg-primary-bg-secondary rounded-lg text-left text-xs text-danger overflow-auto max-h-48">
                {error.stack}
              </pre>
            )}
          </div>
        </div>
      )}
    >
      <QueryProvider>
        <BrowserRouter basename={env.app.basePath}>
          <ToastContainer />
          <CommandPalette />
          <InstallationQueueWidget />

          <Routes>
            {/* Public Routes */}
            <Route path="/login" element={<LoginPage />} />

            {/* Protected Routes */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <DashboardLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/dashboard" replace />} />

              <Route
                path="dashboard"
                element={
                  <ProtectedRoute pageName="Dashboard">
                    <DashboardPage />
                  </ProtectedRoute>
                }
              />

              <Route
                path="servers"
                element={
                  <ProtectedRoute pageName="Servers">
                    <RequirePermission permission={PERMISSIONS.SERVERS_VIEW}>
                      <ServersPage />
                    </RequirePermission>
                  </ProtectedRoute>
                }
              />

              <Route
                path="servers/:id"
                element={
                  <ProtectedRoute pageName="Server Detail">
                    <RequirePermission permission={PERMISSIONS.SERVERS_VIEW}>
                      <ServerDetailPage />
                    </RequirePermission>
                  </ProtectedRoute>
                }
              />

              <Route
                path="servers/:id/settings"
                element={
                  <ProtectedRoute pageName="Server Settings">
                    <RequirePermission permission={PERMISSIONS.SERVERS_UPDATE}>
                      <ServerSettingsPage />
                    </RequirePermission>
                  </ProtectedRoute>
                }
              />

              <Route
                path="servers/:id/worlds"
                element={
                  <ProtectedRoute pageName="Server Worlds">
                    <RequirePermission permission={PERMISSIONS.WORLDS_VIEW}>
                      <ServerWorldsPage />
                    </RequirePermission>
                  </ProtectedRoute>
                }
              />

              <Route
                path="mods"
                element={
                  <ProtectedRoute pageName="Mods">
                    <RequirePermission permission={PERMISSIONS.MODS_VIEW}>
                      <ModsPage />
                    </RequirePermission>
                  </ProtectedRoute>
                }
              />

              <Route
                path="modpacks"
                element={
                  <ProtectedRoute pageName="Modpacks">
                    <RequirePermission permission={PERMISSIONS.MODS_VIEW}>
                      <ModpacksPage />
                    </RequirePermission>
                  </ProtectedRoute>
                }
              />

              <Route
                path="backups"
                element={
                  <ProtectedRoute pageName="Backups">
                    <RequirePermission permission={PERMISSIONS.BACKUPS_VIEW}>
                      <BackupsPage />
                    </RequirePermission>
                  </ProtectedRoute>
                }
              />

              <Route
                path="console/:serverId?"
                element={
                  <ProtectedRoute pageName="Console">
                    <RequirePermission permission={PERMISSIONS.SERVERS_CONSOLE}>
                      <ConsolePage />
                    </RequirePermission>
                  </ProtectedRoute>
                }
              />

              <Route
                path="players"
                element={
                  <ProtectedRoute pageName="Players">
                    <RequirePermission permission={PERMISSIONS.PLAYERS_VIEW}>
                      <PlayersPage />
                    </RequirePermission>
                  </ProtectedRoute>
                }
              />

              <Route
                path="players/:id"
                element={
                  <ProtectedRoute pageName="Player Detail">
                    <RequirePermission permission={PERMISSIONS.PLAYERS_VIEW}>
                      <PlayerDetailPage />
                    </RequirePermission>
                  </ProtectedRoute>
                }
              />

              <Route
                path="automation"
                element={
                  <ProtectedRoute pageName="Automation">
                    <RequirePermission permission={PERMISSIONS.AUTOMATION_VIEW}>
                      <AutomationPage />
                    </RequirePermission>
                  </ProtectedRoute>
                }
              />

              <Route
                path="analytics"
                element={
                  <ProtectedRoute pageName="Analytics">
                    <RequirePermission permission={PERMISSIONS.SERVERS_VIEW}>
                      <AnalyticsPage />
                    </RequirePermission>
                  </ProtectedRoute>
                }
              />

              <Route
                path="files"
                element={
                  <ProtectedRoute pageName="File Manager">
                    <RequirePermission permission={PERMISSIONS.SERVERS_FILES}>
                      <FileManagerPage />
                    </RequirePermission>
                  </ProtectedRoute>
                }
              />

              {/* Redirect old /worlds route to servers - worlds are now per-server */}
              <Route
                path="worlds"
                element={<Navigate to="/servers" replace />}
              />

              <Route
                path="alerts"
                element={
                  <ProtectedRoute pageName="Alerts">
                    <RequirePermission permission={PERMISSIONS.ALERTS_VIEW}>
                      <AlertsPage />
                    </RequirePermission>
                  </ProtectedRoute>
                }
              />

              <Route
                path="permissions"
                element={
                  <ProtectedRoute pageName="Permissions">
                    <RequirePermission permission={PERMISSIONS.PERMISSIONS_VIEW}>
                      <PermissionsPage />
                    </RequirePermission>
                  </ProtectedRoute>
                }
              />

              <Route
                path="economy"
                element={
                  <ProtectedRoute pageName="Economy">
                    <RequirePermission permission={PERMISSIONS.SERVERS_VIEW}>
                      <EconomyPage />
                    </RequirePermission>
                  </ProtectedRoute>
                }
              />

              <Route
                path="bridge"
                element={
                  <ProtectedRoute pageName="Bridge">
                    <RequirePermission permission={PERMISSIONS.SERVERS_VIEW}>
                      <BridgePage />
                    </RequirePermission>
                  </ProtectedRoute>
                }
              />

              <Route
                path="settings"
                element={
                  <ProtectedRoute pageName="Settings">
                    <RequirePermission permission={PERMISSIONS.SETTINGS_VIEW}>
                      <SettingsPage />
                    </RequirePermission>
                  </ProtectedRoute>
                }
              />

              <Route
                path="users"
                element={
                  <ProtectedRoute pageName="Users">
                    <RequirePermission permission={PERMISSIONS.USERS_VIEW}>
                      <UsersPage />
                    </RequirePermission>
                  </ProtectedRoute>
                }
              />

              <Route
                path="activity"
                element={
                  <ProtectedRoute pageName="Activity Log">
                    <RequirePermission permission={PERMISSIONS.ACTIVITY_VIEW}>
                      <ActivityLogPage />
                    </RequirePermission>
                  </ProtectedRoute>
                }
              />

              <Route
                path="hsm-logs"
                element={
                  <ProtectedRoute pageName="HSM Logs">
                    <RequirePermission permission={PERMISSIONS.SETTINGS_VIEW}>
                      <HSMLogsPage />
                    </RequirePermission>
                  </ProtectedRoute>
                }
              />
            </Route>

            {/* Catch all - redirect to dashboard */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </QueryProvider>
    </ErrorBoundary>
  );
}

export default App;
