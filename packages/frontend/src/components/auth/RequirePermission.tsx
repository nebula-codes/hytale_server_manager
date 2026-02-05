/**
 * RequirePermission Component
 *
 * Route guard component that checks if the current user has the required
 * permissions before rendering children. Shows an access denied page if not.
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { ShieldX, ArrowLeft } from 'lucide-react';
import { usePermissions } from '../../hooks/usePermissions';
import { Button } from '../ui';
import type { PermissionCode } from '../../types';

interface RequirePermissionProps {
  /**
   * Permission(s) required to access the content
   */
  permission: PermissionCode | PermissionCode[];
  /**
   * Whether to require all permissions (default) or any of them
   */
  mode?: 'all' | 'any';
  /**
   * Content to render if permission check passes
   */
  children: ReactNode;
  /**
   * Whether to redirect to dashboard instead of showing access denied
   */
  redirectOnDeny?: boolean;
  /**
   * Custom fallback component to show when access is denied
   */
  fallback?: ReactNode;
}

/**
 * Default access denied component
 */
function AccessDenied() {
  const { t } = useTranslation();

  return (
    <div className="min-h-[400px] flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-danger/20 rounded-full mb-6">
          <ShieldX className="w-10 h-10 text-danger" />
        </div>
        <h1 className="text-2xl font-heading font-bold text-text-light-primary dark:text-text-primary mb-2">
          {t('auth.permission.denied_title')}
        </h1>
        <p className="text-text-light-muted dark:text-text-muted mb-6">
          {t('auth.permission.denied_message')}
        </p>
        <Button
          variant="secondary"
          icon={<ArrowLeft size={18} />}
          onClick={() => window.history.back()}
        >
          {t('auth.permission.go_back')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Route guard that checks permissions before rendering content
 */
export function RequirePermission({
  permission,
  mode = 'all',
  children,
  redirectOnDeny = false,
  fallback,
}: RequirePermissionProps) {
  const { hasAllPermissions, hasAnyPermission } = usePermissions();

  const permissions = Array.isArray(permission) ? permission : [permission];
  const hasAccess =
    mode === 'all' ? hasAllPermissions(...permissions) : hasAnyPermission(...permissions);

  if (!hasAccess) {
    if (redirectOnDeny) {
      return <Navigate to="/dashboard" replace />;
    }
    return <>{fallback ?? <AccessDenied />}</>;
  }

  return <>{children}</>;
}
