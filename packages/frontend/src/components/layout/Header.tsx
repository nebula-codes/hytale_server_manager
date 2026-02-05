import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Bell, Search, User, LogOut, ChevronDown, Sun, Moon, AlertCircle, AlertTriangle, Info, Loader2, KeyRound, Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/authStore';
import { useThemeStore } from '../../stores/themeStore';
import { useAlertsStore } from '../../stores/alertsStore';
import { SUPPORTED_LANGUAGES } from '../../types';
import { Badge } from '../ui';
import { UpdateBadge } from '../update/UpdateBadge';
import { motion, AnimatePresence } from 'framer-motion';

const getSeverityIcon = (severity: string) => {
  switch (severity) {
    case 'critical':
      return <AlertCircle size={14} className="text-red-500" />;
    case 'warning':
      return <AlertTriangle size={14} className="text-yellow-500" />;
    default:
      return <Info size={14} className="text-blue-500" />;
  }
};


export const Header = () => {
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  const getRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return t('common.time_ago.just_now');
    if (diffMins < 60) return t('common.time_ago.minutes_ago', { count: diffMins });
    if (diffHours < 24) return t('common.time_ago.hours_ago', { count: diffHours });
    if (diffDays < 7) return t('common.time_ago.days_ago', { count: diffDays });

    return date.toLocaleDateString();
  };

  // Alerts from backend
  const { alerts, unreadCount, isLoading, fetchAlerts, markAllAsRead } = useAlertsStore();

  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isMarkingRead, setIsMarkingRead] = useState(false);

  const notificationsRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch alerts on mount and periodically
  useEffect(() => {
    fetchAlerts();

    // Refresh alerts every 60 seconds
    const interval = setInterval(() => {
      fetchAlerts();
    }, 60000);

    return () => clearInterval(interval);
  }, [fetchAlerts]);

  // Fetch alerts when dropdown opens
  useEffect(() => {
    if (showNotifications) {
      fetchAlerts();
    }
  }, [showNotifications, fetchAlerts]);

  const handleMarkAllAsRead = async () => {
    if (isMarkingRead || unreadCount === 0) return;
    setIsMarkingRead(true);
    try {
      await markAllAsRead();
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    } finally {
      setIsMarkingRead(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="hidden lg:flex h-16 bg-white dark:bg-gray-100 dark:bg-primary-bg-secondary border-b border-gray-300 dark:border-gray-800 px-4 lg:px-6 items-center justify-between sticky top-0 z-40">
      {/* Search */}
      <div className="flex-1 max-w-md">
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-light-muted dark:text-text-muted" />
          <input
            disabled
            type="search"
            placeholder={t('common.search_placeholder')}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-primary-bg border border-gray-300 dark:border-gray-700 rounded-lg text-text-light-primary dark:text-text-primary placeholder-text-muted text-base focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary min-h-[44px]"
          />
        </div>
      </div>

      {/* Right Section */}
      <div className="flex items-center gap-2 lg:gap-4">
        {/* Update Badge */}
        <UpdateBadge />

        {/* Notifications */}
        <div className="relative" ref={notificationsRef}>
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative p-2.5 text-text-light-muted dark:text-text-muted hover:text-text-light-primary dark:text-text-primary hover:bg-gray-200 dark:bg-gray-800 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            aria-label={t('header.notifications')}
          >
            <Bell size={20} />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-4 h-4 bg-danger rounded-full text-xs text-white flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </button>

          <AnimatePresence>
            {showNotifications && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute right-0 mt-2 w-80 sm:w-96 glass-card shadow-xl max-h-96 overflow-auto custom-scrollbar z-50"
              >
                <div className="p-4 border-b border-gray-300 dark:border-gray-800 flex items-center justify-between">
                  <h3 className="font-heading font-semibold">{t('header.notifications')}</h3>
                  {unreadCount > 0 && (
                    <button
                      onClick={handleMarkAllAsRead}
                      disabled={isMarkingRead}
                      className="text-xs text-accent-primary hover:underline disabled:opacity-50 flex items-center gap-1"
                    >
                      {isMarkingRead && <Loader2 size={10} className="animate-spin" />}
                      {t('header.mark_all_read')}
                    </button>
                  )}
                </div>
                <div className="divide-y divide-gray-300 dark:divide-gray-800">
                  {isLoading && alerts.length === 0 ? (
                    <div className="p-8 text-center text-text-light-muted dark:text-text-muted">
                      <Loader2 size={20} className="animate-spin mx-auto mb-2" />
                      <p>{t('header.loading_alerts')}</p>
                    </div>
                  ) : alerts.length === 0 ? (
                    <div className="p-8 text-center text-text-light-muted dark:text-text-muted">
                      <Bell size={24} className="mx-auto mb-2 opacity-50" />
                      <p>{t('header.no_alerts')}</p>
                    </div>
                  ) : (
                    alerts.slice(0, 5).map((alert) => (
                      <Link
                        key={alert.id}
                        to="/alerts"
                        onClick={() => setShowNotifications(false)}
                        className={`block p-4 hover:bg-gray-200 dark:hover:bg-gray-800/50 cursor-pointer transition-colors ${!alert.isRead ? 'bg-accent-primary/5' : ''
                          }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5">
                            {getSeverityIcon(alert.severity)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <Badge
                                variant={
                                  alert.severity === 'critical'
                                    ? 'danger'
                                    : alert.severity === 'warning'
                                      ? 'warning'
                                      : 'info'
                                }
                                size="sm"
                              >
                                {alert.severity}
                              </Badge>
                              {!alert.isRead && (
                                <span className="w-2 h-2 bg-accent-primary rounded-full" />
                              )}
                            </div>
                            <p className="text-sm font-medium text-text-light-primary dark:text-text-primary mt-1 truncate">
                              {alert.title}
                            </p>
                            <p className="text-xs text-text-light-muted dark:text-text-muted mt-1 line-clamp-2">
                              {alert.message}
                            </p>
                            <p className="text-xs text-text-light-muted dark:text-text-muted mt-1">
                              {getRelativeTime(alert.createdAt)}
                            </p>
                          </div>
                        </div>
                      </Link>
                    ))
                  )}
                </div>
                {alerts.length > 0 && (
                  <Link
                    to="/alerts"
                    onClick={() => setShowNotifications(false)}
                    className="block p-3 text-center text-sm text-accent-primary hover:bg-gray-200 dark:hover:bg-gray-800/50 border-t border-gray-300 dark:border-gray-800"
                  >
                    {t('header.view_all')}
                  </Link>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="p-2.5 text-text-light-muted dark:text-text-muted hover:text-text-light-primary dark:hover:text-text-primary hover:bg-gray-200 dark:hover:bg-gray-800 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          aria-label={theme === 'dark' ? t('header.theme_toggle.light') : t('header.theme_toggle.dark')}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={theme}
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </motion.div>
          </AnimatePresence>
        </button>

        {/* User Menu */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 px-3 py-2 text-text-light-primary dark:text-text-primary hover:bg-gray-200 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <div className="w-8 h-8 bg-accent-primary rounded-full flex items-center justify-center">
              <User size={18} className="text-black" />
            </div>
            <div className="text-left hidden md:block">
              <p className="text-sm font-medium">{user?.username}</p>
              <p className="text-xs text-text-light-muted dark:text-text-muted capitalize">{user?.role}</p>
            </div>
            <ChevronDown size={16} className="text-text-light-muted dark:text-text-muted" />
          </button>

          <AnimatePresence>
            {showUserMenu && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute right-0 mt-2 w-48 glass-card shadow-xl z-50"
              >
                <div className="p-2 space-y-1">
                  <div className="px-3 py-2">
                    <div className="flex items-center gap-2 mb-2 text-text-light-primary dark:text-text-primary">
                      <Languages size={18} />
                      <span className="text-sm font-medium">{t('header.user_menu.language')}</span>
                    </div>
                    <div className="pl-6">
                      <select
                        value={i18n.language.split('-')[0]}
                        onChange={(e) => changeLanguage(e.target.value)}
                        className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-text-light-primary dark:text-text-primary text-sm rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent-primary"
                      >
                        {SUPPORTED_LANGUAGES.map((lang) => (
                          <option key={lang.code} value={lang.code}>
                            {lang.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="h-px bg-gray-200 dark:bg-gray-800 my-1" />
                  <Link
                    to="/settings#security"
                    onClick={() => setShowUserMenu(false)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-text-light-primary dark:text-text-primary hover:bg-gray-200 dark:hover:bg-gray-800 rounded-lg transition-colors"
                  >
                    <KeyRound size={18} />
                    <span>{t('header.user_menu.change_password')}</span>
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-3 py-2 text-danger hover:bg-danger/10 rounded-lg transition-colors"
                  >
                    <LogOut size={18} />
                    <span>{t('header.user_menu.logout')}</span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
};
