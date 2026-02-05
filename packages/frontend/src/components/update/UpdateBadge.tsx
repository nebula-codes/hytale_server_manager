import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Download, X } from 'lucide-react';
import { useUpdateStore } from '../../stores/updateStore';
import { motion, AnimatePresence } from 'framer-motion';

export const UpdateBadge = () => {
  const { t } = useTranslation();
  const { updateInfo, isLoading, dismissed, checkForUpdates, dismissUpdate } = useUpdateStore();

  useEffect(() => {
    // Check for updates on mount
    checkForUpdates();

    // Check periodically (every 4 hours)
    const interval = setInterval(() => checkForUpdates(), 4 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [checkForUpdates]);

  // Don't show if loading, no update, or dismissed
  if (isLoading || !updateInfo?.updateAvailable || dismissed) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="relative"
      >
        <Link
          to="/settings#updates"
          className="flex items-center gap-2 px-3 py-2 bg-accent-primary/20 hover:bg-accent-primary/30 text-accent-primary rounded-lg transition-colors"
        >
          <Download size={16} />
          <span className="text-sm font-medium hidden sm:inline">
            {t('updates.banner.version', { version: updateInfo.latestVersion })}
          </span>
          <span className="text-sm font-medium sm:hidden">
            {t('updates.banner.short')}
          </span>
        </Link>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            dismissUpdate();
          }}
          className="absolute -top-1 -right-1 p-0.5 bg-gray-800 rounded-full hover:bg-gray-700 text-white"
          aria-label={t('updates.banner.dismiss_aria')}
        >
          <X size={12} />
        </button>
      </motion.div>
    </AnimatePresence>
  );
};
