import { NavLink, useLocation } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import {
  LayoutDashboard,
  Server,
  Blocks,
  Package,
  Database,
  Terminal,
  Users,
  UserCog,
  Settings,
  ChevronLeft,
  ChevronRight,
  Gamepad2,
  Calendar,
  BarChart3,
  FileText,
  Shield,
  X,
  Bell,
  History,
  Construction,
  ScrollText,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { usePermissions } from '../../hooks/usePermissions';
import { motion, AnimatePresence } from 'framer-motion';
import type { PermissionCode } from '../../types';
import type { LucideIcon } from 'lucide-react';

interface NavigationItem {
  path: string;
  icon: LucideIcon;
  labelKey: string;
  permission?: PermissionCode | PermissionCode[];
  permissionMode?: 'all' | 'any';
}

const navigationItems: NavigationItem[] = [
  { path: '/dashboard', icon: LayoutDashboard, labelKey: 'nav.dashboard' }, // Always visible
  { path: '/servers', icon: Server, labelKey: 'nav.servers', permission: 'servers:view' },
  { path: '/console', icon: Terminal, labelKey: 'nav.console', permission: 'servers:console' },
  { path: '/mods', icon: Blocks, labelKey: 'nav.marketplace', permission: 'mods:view' },
  { path: '/modpacks', icon: Package, labelKey: 'nav.modpacks', permission: 'mods:view' },
  { path: '/backups', icon: Database, labelKey: 'nav.backups', permission: 'backups:view' },
  { path: '/automation', icon: Calendar, labelKey: 'nav.automation', permission: 'automation:view' },
  { path: '/files', icon: FileText, labelKey: 'nav.files', permission: 'servers:files' },
  { path: '/alerts', icon: Bell, labelKey: 'nav.alerts', permission: 'alerts:view' },
  { path: '/activity', icon: History, labelKey: 'nav.activity_log', permission: 'activity:view' },
  { path: '/hsm-logs', icon: ScrollText, labelKey: 'nav.hsm_logs', permission: 'settings:view' },
  { path: '/permissions', icon: Shield, labelKey: 'nav.permissions', permission: 'permissions:view' },
  { path: '/users', icon: UserCog, labelKey: 'nav.users', permission: 'users:view' },
  { path: '/settings', icon: Settings, labelKey: 'nav.settings', permission: 'settings:view' },
];

const comingSoonItems: NavigationItem[] = [
  { path: '/players', icon: Users, labelKey: 'nav.players', permission: 'players:view' },
  { path: '/analytics', icon: BarChart3, labelKey: 'nav.analytics', permission: 'servers:view' },
];

export const Sidebar = () => {
  const { t } = useTranslation();
  const { sidebarCollapsed, toggleSidebar, mobileMenuOpen, closeMobileMenu } = useAppStore();
  const { hasPermission, hasAllPermissions, hasAnyPermission } = usePermissions();
  const location = useLocation();

  // Close mobile menu when route changes
  useEffect(() => {
    closeMobileMenu();
  }, [location.pathname, closeMobileMenu]);

  // Filter navigation items based on user permissions
  const filterItems = (items: NavigationItem[]) => {
    return items.filter((item) => {
      // No permission required - always visible
      if (!item.permission) return true;

      const permissions = Array.isArray(item.permission) ? item.permission : [item.permission];
      const mode = item.permissionMode || 'all';

      return mode === 'all'
        ? hasAllPermissions(...permissions)
        : hasAnyPermission(...permissions);
    });
  };

  const visibleItems = useMemo(() => filterItems(navigationItems), [hasPermission, hasAllPermissions, hasAnyPermission]);
  const visibleComingSoon = useMemo(() => filterItems(comingSoonItems), [hasPermission, hasAllPermissions, hasAnyPermission]);

  const renderNavItem = (item: NavigationItem, isComingSoon = false) => (
    <li key={item.path}>
      <NavLink
        to={item.path}
        className={({ isActive }) =>
          `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 ${isActive
            ? 'bg-accent-primary/20 text-accent-primary border border-accent-primary/30'
            : isComingSoon
              ? 'text-text-light-muted/60 dark:text-text-muted/60 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-text-light-muted dark:hover:text-text-muted'
              : 'text-text-light-muted dark:text-text-muted hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-text-light-primary dark:hover:text-text-primary'
          }`
        }
      >
        <item.icon size={20} className="flex-shrink-0" />
        {!sidebarCollapsed && (
          <span className="font-medium">{t(item.labelKey)}</span>
        )}
      </NavLink>
    </li>
  );

  return (
    <>
      {/* Mobile Backdrop */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="lg:hidden fixed inset-0 bg-black/50 z-40"
            onClick={closeMobileMenu}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside
        className={`w-64 ${sidebarCollapsed ? 'lg:w-20' : 'lg:w-64'} bg-white dark:bg-primary-bg-secondary border-r border-gray-300 dark:border-gray-800 flex flex-col h-screen fixed z-50 lg:relative lg:z-auto transition-all duration-200 ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
          }`}
      >
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-gray-300 dark:border-gray-800">
          {sidebarCollapsed ? (
            <Gamepad2 size={32} className="text-accent-primary mx-auto" />
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Gamepad2 size={32} className="text-accent-primary" />
                <span className="text-xl font-heading font-bold text-gradient">HytalePanel</span>
              </div>
              {/* Mobile close button */}
              <button
                onClick={closeMobileMenu}
                className="lg:hidden p-2 -mr-2 text-text-light-muted dark:text-text-muted hover:text-text-light-primary dark:hover:text-text-primary transition-colors"
                aria-label="Close menu"
              >
                <X size={24} />
              </button>
            </>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 overflow-y-auto custom-scrollbar">
          <ul className="space-y-1">
            {visibleItems.map((item) => renderNavItem(item))}
          </ul>

          {/* Coming Soon Section */}
          {visibleComingSoon.length > 0 && (
            <div className="mt-6">
              {!sidebarCollapsed && (
                <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-text-light-muted/60 dark:text-text-muted/60 uppercase tracking-wider">
                  <Construction size={14} />
                  <span>{t('nav.coming_soon')}</span>
                </div>
              )}
              {sidebarCollapsed && (
                <div className="flex justify-center py-2">
                  <Construction size={16} className="text-text-light-muted/60 dark:text-text-muted/60" />
                </div>
              )}
              <ul className="space-y-1">
                {visibleComingSoon.map((item) => renderNavItem(item, true))}
              </ul>
            </div>
          )}
        </nav>

        {/* Collapse Toggle - Desktop Only */}
        <div className="hidden lg:block p-3 border-t border-gray-300 dark:border-gray-800">
          <button
            onClick={toggleSidebar}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-text-light-muted dark:text-text-muted hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-text-light-primary dark:hover:text-text-primary transition-colors"
          >
            {sidebarCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
            {!sidebarCollapsed && <span className="font-medium">{t('nav.collapse')}</span>}
          </button>
        </div>
      </aside>
    </>
  );
};
