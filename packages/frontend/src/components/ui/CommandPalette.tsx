import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Server, Users, Settings, FileText, Package, Database, DollarSign, Shield, Activity, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchStore } from '../../stores/searchStore';
import { mockServers, mockPlayers } from '../../data/mockData';

interface SearchResult {
  id: string;
  title: string;
  description: string;
  category: 'server' | 'player' | 'page';
  icon: React.ReactNode;
  path: string;
}

export const CommandPalette = () => {
  const { t } = useTranslation();
  const { isOpen, closeSearch } = useSearchStore();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const navigate = useNavigate();

  // Define all searchable items
  const allItems: SearchResult[] = useMemo(() => {
    const items: SearchResult[] = [];

    // Pages
    items.push(
      { id: 'dashboard', title: t('nav.dashboard'), description: t('ui.command.pages.dashboard'), category: 'page', icon: <Activity size={18} />, path: '/dashboard' },
      { id: 'servers', title: t('nav.servers'), description: t('ui.command.pages.servers'), category: 'page', icon: <Server size={18} />, path: '/servers' },
      { id: 'players', title: t('nav.players'), description: t('ui.command.pages.players'), category: 'page', icon: <Users size={18} />, path: '/players' },
      { id: 'mods', title: t('nav.mods', { defaultValue: 'Mods' }), description: t('ui.command.pages.mods'), category: 'page', icon: <Package size={18} />, path: '/mods' },
      { id: 'modpacks', title: t('nav.modpacks'), description: t('ui.command.pages.modpacks'), category: 'page', icon: <Package size={18} />, path: '/modpacks' },
      { id: 'backups', title: t('nav.backups'), description: t('ui.command.pages.backups'), category: 'page', icon: <Database size={18} />, path: '/backups' },
      { id: 'console', title: t('nav.console'), description: t('ui.command.pages.console'), category: 'page', icon: <FileText size={18} />, path: '/console' },
      { id: 'automation', title: t('nav.automation'), description: t('ui.command.pages.automation'), category: 'page', icon: <Activity size={18} />, path: '/automation' },
      { id: 'analytics', title: t('nav.analytics'), description: t('ui.command.pages.analytics'), category: 'page', icon: <Activity size={18} />, path: '/analytics' },
      { id: 'files', title: t('nav.files'), description: t('ui.command.pages.files'), category: 'page', icon: <FileText size={18} />, path: '/files' },
      { id: 'permissions', title: t('nav.permissions'), description: t('ui.command.pages.permissions'), category: 'page', icon: <Shield size={18} />, path: '/permissions' },
      { id: 'economy', title: t('nav.economy', { defaultValue: 'Economy' }), description: t('ui.command.pages.economy'), category: 'page', icon: <DollarSign size={18} />, path: '/economy' },
      { id: 'bridge', title: t('nav.bridge', { defaultValue: 'Hytale Bridge' }), description: t('ui.command.pages.bridge'), category: 'page', icon: <Activity size={18} />, path: '/bridge' },
      { id: 'settings', title: t('nav.settings'), description: t('ui.command.pages.settings'), category: 'page', icon: <Settings size={18} />, path: '/settings' }
    );

    // Servers
    mockServers.forEach((server) => {
      items.push({
        id: `server-${server.id}`,
        title: server.name,
        description: t('ui.command.server_desc', {
          version: server.version,
          current: server.currentPlayers,
          max: server.maxPlayers,
        }),
        category: 'server',
        icon: <Server size={18} />,
        path: `/servers/${server.id}`,
      });
    });

    // Players
    mockPlayers.forEach((player) => {
      items.push({
        id: `player-${player.uuid}`,
        title: player.username,
        description: t('ui.command.player_desc', {
          role: player.role,
          status: player.status,
        }),
        category: 'player',
        icon: <Users size={18} />,
        path: `/players/${player.uuid}`,
      });
    });

    return items;
  }, [t]);

  // Filter results based on query
  const results = useMemo(() => {
    if (!query.trim()) return allItems.slice(0, 10);

    const lowerQuery = query.toLowerCase();
    return allItems.filter(
      (item) =>
        item.title.toLowerCase().includes(lowerQuery) ||
        item.description.toLowerCase().includes(lowerQuery) ||
        item.category.toLowerCase().includes(lowerQuery)
    ).slice(0, 10);
  }, [query, allItems]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + K to open
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        useSearchStore.getState().toggleSearch();
      }

      if (!isOpen) return;

      // Arrow navigation
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % results.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (results[selectedIndex]) {
          handleSelect(results[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        closeSearch();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, results, selectedIndex, closeSearch]);

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  const handleSelect = (result: SearchResult) => {
    navigate(result.path);
    closeSearch();
  };

  const categoryColors = {
    page: 'text-accent-primary',
    server: 'text-success',
    player: 'text-accent-secondary',
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9998] flex items-start justify-center pt-[10vh]">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={closeSearch}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        />

        {/* Command Palette */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: -20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -20 }}
          className="relative w-full max-w-2xl mx-4 bg-white dark:bg-primary-bg-secondary border-2 border-gray-300 dark:border-gray-800 rounded-xl shadow-2xl overflow-hidden"
        >
          {/* Search Input */}
          <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-300 dark:border-gray-800">
            <Search size={20} className="text-text-light-muted dark:text-text-muted flex-shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('ui.command.placeholder')}
              className="flex-1 bg-transparent text-text-light-primary dark:text-text-primary placeholder-text-muted dark:placeholder-text-muted outline-none text-lg"
              autoFocus
            />
            <button
              onClick={closeSearch}
              className="text-text-light-muted dark:text-text-muted hover:text-text-primary dark:hover:text-text-primary transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Results */}
          <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
            {results.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <p className="text-text-light-muted dark:text-text-muted">{t('ui.command.no_results')}</p>
              </div>
            ) : (
              <div className="py-2">
                {results.map((result, index) => (
                  <button
                    key={result.id}
                    onClick={() => handleSelect(result)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`w-full px-4 py-3 flex items-center gap-3 transition-colors ${
                      index === selectedIndex
                        ? 'bg-accent-primary/10 border-l-2 border-accent-primary'
                        : 'border-l-2 border-transparent hover:bg-primary-bg/50 dark:hover:bg-primary-bg/50'
                    }`}
                  >
                    <div className={categoryColors[result.category]}>
                      {result.icon}
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <p className="text-sm font-medium text-text-light-primary dark:text-text-primary truncate">
                        {result.title}
                      </p>
                      <p className="text-xs text-text-light-muted dark:text-text-muted truncate">
                        {result.description}
                      </p>
                    </div>
                    <span className="text-xs text-text-light-muted dark:text-text-muted capitalize px-2 py-1 rounded bg-gray-800/50 dark:bg-gray-800/50">
                      {t(`ui.command.categories.${result.category}`)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-gray-300 dark:border-gray-800 flex items-center justify-between text-xs text-text-light-muted dark:text-text-muted">
            <div className="flex items-center gap-4">
              <span>{t('ui.command.hints.navigate')}</span>
              <span>{t('ui.command.hints.select')}</span>
              <span>{t('ui.command.hints.close')}</span>
            </div>
            <div className="flex items-center gap-1">
              <kbd className="px-2 py-1 rounded bg-gray-800 dark:bg-gray-800 font-mono">⌘K</kbd>
              <span>{t('ui.command.hints.toggle')}</span>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
