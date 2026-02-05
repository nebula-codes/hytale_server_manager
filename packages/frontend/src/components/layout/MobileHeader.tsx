import { Menu, Gamepad2, Sun, Moon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../stores/appStore';
import { useThemeStore } from '../../stores/themeStore';
import { motion, AnimatePresence } from 'framer-motion';

export const MobileHeader = () => {
  const { t } = useTranslation();
  const { toggleMobileMenu } = useAppStore();
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);

  return (
    <header className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white dark:bg-primary-bg-secondary border-b border-gray-300 dark:border-gray-800 z-40 flex items-center justify-between px-4">
      <div className="flex items-center">
        <button
          onClick={toggleMobileMenu}
          className="p-2 -ml-2 text-text-light-muted dark:text-text-muted hover:text-text-light-primary dark:hover:text-text-primary transition-colors"
          aria-label={t('header.user_menu.toggle_menu')}
        >
          <Menu size={24} />
        </button>

        <div className="flex items-center gap-2 ml-4">
          <Gamepad2 size={28} className="text-accent-primary" />
          <span className="text-lg font-heading font-bold text-gradient">HytalePanel</span>
        </div>
      </div>

      {/* Theme Toggle */}
      <button
        onClick={toggleTheme}
        className="p-2 text-text-light-muted dark:text-text-muted hover:text-text-light-primary dark:hover:text-text-primary transition-colors"
        aria-label={theme === 'dark' ? t('header.theme_toggle.light') : t('header.theme_toggle.dark')}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={theme}
            initial={{ rotate: -90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={{ rotate: 90, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {theme === 'dark' ? <Sun size={22} /> : <Moon size={22} />}
          </motion.div>
        </AnimatePresence>
      </button>
    </header>
  );
};
