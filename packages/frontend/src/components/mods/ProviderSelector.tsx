import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Check, AlertCircle, Globe } from 'lucide-react';
import { useModProviderStore } from '../../stores/modProviderStore';

interface ProviderSelectorProps {
  className?: string;
  showConfigurationWarning?: boolean;
}

export const ProviderSelector = ({
  className = '',
  showConfigurationWarning = true,
}: ProviderSelectorProps) => {
  const { t } = useTranslation();
  const {
    selectedProvider,
    providers,
    providersLoading,
    setSelectedProvider,
    loadProviders,
  } = useModProviderStore();

  // Load providers on mount
  useEffect(() => {
    if (providers.length === 0) {
      loadProviders();
    }
  }, [providers.length, loadProviders]);

  const currentProvider =
    selectedProvider === 'all'
      ? null
      : providers.find((p) => p.id === selectedProvider);

  const isCurrentProviderConfigured =
    selectedProvider === 'all'
      ? providers.some((p) => p.isConfigured)
      : currentProvider?.isConfigured ?? false;

  if (providersLoading) {
    return (
      <div className={`px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 ${className}`}>
        <span className="text-text-light-muted dark:text-text-muted text-sm">
          {t('providers.loading')}
        </span>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <div className="flex items-center gap-2">
        <div className="relative inline-block">
          <select
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
            className="appearance-none px-4 py-2 pr-10 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-text-light-primary dark:text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary cursor-pointer min-w-[180px]"
          >
            <option value="all">{t('providers.all')}</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.displayName}
                {!provider.isConfigured && provider.requiresApiKey ? ` (${t('providers.not_configured')})` : ''}
              </option>
            ))}
          </select>
          <ChevronDown
            size={16}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-light-muted dark:text-text-muted pointer-events-none"
          />
        </div>

        {/* Status indicator */}
        {selectedProvider !== 'all' && currentProvider && (
          <div className="flex items-center gap-1">
            {currentProvider.isConfigured ? (
              <span className="flex items-center gap-1 text-green-500 text-xs">
                <Check size={14} />
                {t('providers.configured')}
              </span>
            ) : currentProvider.requiresApiKey ? (
              <span className="flex items-center gap-1 text-amber-500 text-xs">
                <AlertCircle size={14} />
                {t('providers.api_key_required')}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-green-500 text-xs">
                <Check size={14} />
                {t('providers.ready')}
              </span>
            )}
          </div>
        )}

        {selectedProvider === 'all' && (
          <span className="flex items-center gap-1 text-text-light-muted dark:text-text-muted text-xs">
            <Globe size={14} />
            {t('providers.search_all')}
          </span>
        )}
      </div>

      {/* Configuration warning */}
      {showConfigurationWarning && !isCurrentProviderConfigured && (
        <div className="mt-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <p className="text-amber-600 dark:text-amber-400 text-xs">
            {selectedProvider === 'all'
              ? t('providers.warning.none')
              : t('providers.warning.single', { provider: currentProvider?.displayName || t('providers.this_provider') })}
          </p>
        </div>
      )}
    </div>
  );
};

/**
 * Compact provider selector for inline use
 */
export const ProviderSelectorCompact = ({
  className = '',
}: {
  className?: string;
}) => {
  const { t } = useTranslation();
  const { selectedProvider, providers, setSelectedProvider, loadProviders } =
    useModProviderStore();

  useEffect(() => {
    if (providers.length === 0) {
      loadProviders();
    }
  }, [providers.length, loadProviders]);

  return (
    <div className={`relative inline-block ${className}`}>
      <select
        value={selectedProvider}
        onChange={(e) => setSelectedProvider(e.target.value)}
        className="appearance-none px-3 py-1.5 pr-8 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-text-light-primary dark:text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary cursor-pointer text-sm"
      >
        <option value="all">{t('providers.all')}</option>
        {providers.map((provider) => (
          <option key={provider.id} value={provider.id}>
            {provider.displayName}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-text-light-muted dark:text-text-muted pointer-events-none"
      />
    </div>
  );
};

/**
 * Provider badge to show which provider a mod is from
 */
export const ProviderBadge = ({
  providerId,
  className = '',
}: {
  providerId: string;
  className?: string;
}) => {
  const { providers } = useModProviderStore();
  const provider = providers.find((p) => p.id === providerId);

  if (!provider) {
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-text-light-secondary dark:text-text-secondary ${className}`}
      >
        {providerId}
      </span>
    );
  }

  // Different colors for different providers
  const colorClasses: Record<string, string> = {
    modtale: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
    curseforge: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
  };

  const colorClass =
    colorClasses[providerId] ||
    'bg-gray-100 dark:bg-gray-700 text-text-light-secondary dark:text-text-secondary';

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colorClass} ${className}`}
    >
      {provider.displayName}
    </span>
  );
};

export default ProviderSelector;
