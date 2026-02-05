import { useState, useEffect } from 'react';
import { Modal, ModalFooter, Button, Input } from '../ui';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  Swords,
  Clock,
  Settings,
  Info,
  AlertTriangle,
  Loader2,
  Code,
  SlidersHorizontal,
} from 'lucide-react';
import { api } from '../../services/api';
import { useToast } from '../../stores/toastStore';

/**
 * Hytale World Config structure
 */
export interface HytaleWorldConfig {
  // Read-only fields
  Version?: number;
  UUID?: { $binary: string; $type: string };
  Seed?: number;
  WorldGen?: { Type?: string; Name?: string };
  GameplayConfig?: string;

  // Gameplay settings
  IsPvpEnabled?: boolean;
  IsFallDamageEnabled?: boolean;
  IsSpawningNPC?: boolean;
  IsAllNPCFrozen?: boolean;
  IsSpawnMarkersEnabled?: boolean;
  IsObjectiveMarkersEnabled?: boolean;
  IsCompassUpdating?: boolean;

  // Time & Effects
  IsGameTimePaused?: boolean;
  GameTime?: string;
  ClientEffects?: {
    SunHeightPercent?: number;
    SunAngleDegrees?: number;
    SunIntensity?: number;
    BloomIntensity?: number;
    BloomPower?: number;
    SunshaftIntensity?: number;
    SunshaftScaleFactor?: number;
    [key: string]: unknown;
  };

  // World Management
  IsTicking?: boolean;
  IsBlockTicking?: boolean;
  IsSavingPlayers?: boolean;
  IsSavingChunks?: boolean;
  SaveNewChunks?: boolean;
  IsUnloadingChunks?: boolean;
  DeleteOnUniverseStart?: boolean;
  DeleteOnRemove?: boolean;

  [key: string]: unknown;
}

interface World {
  id: string;
  serverId: string;
  name: string;
  folderPath: string;
  sizeBytes: number;
  isActive: boolean;
}

interface HytaleWorldConfigModalProps {
  world: World;
  serverStatus: string;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

interface CollapsibleSectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

const CollapsibleSection = ({ title, icon, children, defaultOpen = true }: CollapsibleSectionProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-left"
      >
        {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        <span className="text-text-light-muted dark:text-text-muted">{icon}</span>
        <span className="font-medium text-text-light-primary dark:text-text-primary">{title}</span>
      </button>
      {isOpen && <div className="p-4 space-y-3">{children}</div>}
    </div>
  );
};

interface ToggleSettingProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

const ToggleSetting = ({ label, description, checked, onChange, disabled }: ToggleSettingProps) => (
  <div className="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
    <div className="flex-1 mr-4">
      <span className="text-sm font-medium text-text-light-primary dark:text-text-primary">{label}</span>
      {description && (
        <p className="text-xs text-text-light-muted dark:text-text-muted mt-0.5">{description}</p>
      )}
    </div>
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      disabled={disabled}
      className="w-5 h-5 accent-accent-primary disabled:opacity-50 disabled:cursor-not-allowed"
    />
  </div>
);

interface NumberSettingProps {
  label: string;
  description?: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
}

const NumberSetting = ({ label, description, value, onChange, disabled, min, max, step = 0.1 }: NumberSettingProps) => (
  <div className="flex items-center justify-between p-3 rounded-lg bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
    <div className="flex-1 mr-4">
      <span className="text-sm font-medium text-text-light-primary dark:text-text-primary">{label}</span>
      {description && (
        <p className="text-xs text-text-light-muted dark:text-text-muted mt-0.5">{description}</p>
      )}
    </div>
    <Input
      type="number"
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      disabled={disabled}
      min={min}
      max={max}
      step={step}
      className="w-24 text-right"
    />
  </div>
);

interface ReadOnlyFieldProps {
  label: string;
  value: string | number | undefined;
}

const ReadOnlyField = ({ label, value }: ReadOnlyFieldProps) => (
  <div className="flex items-center justify-between p-3 rounded-lg bg-gray-100 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700">
    <span className="text-sm text-text-light-muted dark:text-text-muted">{label}</span>
    <span className="text-sm font-mono text-text-light-primary dark:text-text-primary">
      {value ?? 'N/A'}
    </span>
  </div>
);

export const HytaleWorldConfigModal = ({
  world,
  serverStatus,
  isOpen,
  onClose,
  onSaved,
}: HytaleWorldConfigModalProps) => {
  const { t } = useTranslation();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<HytaleWorldConfig | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [viewMode, setViewMode] = useState<'form' | 'json'>('form');
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);

  const isServerRunning = serverStatus === 'running';
  const isDisabled = isServerRunning;

  // Load config when modal opens
  useEffect(() => {
    if (isOpen && world) {
      loadConfig();
    }
  }, [isOpen, world]);

  const loadConfig = async () => {
    setLoading(true);
    setError(null);
    setJsonError(null);
    try {
      const data = await api.getWorldConfig<HytaleWorldConfig>(world.serverId, world.id);
      setConfig(data);
      setJsonText(JSON.stringify(data, null, 2));
      setHasChanges(false);
    } catch (err: any) {
      setError(err.message || t('servers.world_config.toast.load_failed'));
    } finally {
      setLoading(false);
    }
  };

  // Handle switching from JSON to form view - parse and apply JSON changes
  const switchToFormView = () => {
    if (viewMode === 'json') {
      try {
        const parsed = JSON.parse(jsonText);
        setConfig(parsed);
        setJsonError(null);
        setViewMode('form');
      } catch (err: any) {
        setJsonError(t('servers.world_config.json.invalid', { error: err.message }));
      }
    }
  };

  // Handle switching from form to JSON view - serialize current config
  const switchToJsonView = () => {
    if (viewMode === 'form' && config) {
      setJsonText(JSON.stringify(config, null, 2));
      setJsonError(null);
      setViewMode('json');
    }
  };

  // Handle JSON text changes
  const handleJsonChange = (text: string) => {
    setJsonText(text);
    setHasChanges(true);
    setJsonError(null);
    // Try to validate JSON as user types
    try {
      JSON.parse(text);
    } catch {
      // Don't show error while typing, only on switch
    }
  };

  const updateConfig = <K extends keyof HytaleWorldConfig>(key: K, value: HytaleWorldConfig[K]) => {
    if (!config) return;
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);
    setJsonText(JSON.stringify(newConfig, null, 2));
    setHasChanges(true);
  };

  const updateClientEffect = (key: string, value: number) => {
    if (!config) return;
    const newConfig = {
      ...config,
      ClientEffects: {
        ...config.ClientEffects,
        [key]: value,
      },
    };
    setConfig(newConfig);
    setJsonText(JSON.stringify(newConfig, null, 2));
    setHasChanges(true);
  };

  const handleSave = async () => {
    let configToSave: HytaleWorldConfig | null = config;

    // If in JSON mode, parse the JSON first
    if (viewMode === 'json') {
      try {
        configToSave = JSON.parse(jsonText);
        setJsonError(null);
      } catch (err: any) {
        setJsonError(t('servers.world_config.json.invalid', { error: err.message }));
        return;
      }
    }

    if (!configToSave) return;

    setSaving(true);
    try {
      await api.updateWorldConfig(world.serverId, world.id, configToSave);
      toast.success(t('servers.world_config.toast.saved.title'), t('servers.world_config.toast.saved.description'));
      setHasChanges(false);
      onSaved?.();
      onClose();
    } catch (err: any) {
      toast.error(t('servers.world_config.toast.save_failed.title'), err.message || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('servers.world_config.title', { name: world.name })} size="lg">
      {/* Server Running Warning */}
      {isServerRunning && (
        <div className="flex items-center gap-3 p-4 mb-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <AlertTriangle className="text-amber-500 flex-shrink-0" size={20} />
          <div>
            <p className="text-sm font-medium text-amber-500">{t('servers.world_config.running.title')}</p>
            <p className="text-xs text-amber-500/80">
              {t('servers.world_config.running.subtitle')}
            </p>
          </div>
        </div>
      )}

      {/* View Mode Toggle */}
      {!loading && !error && config && (
        <div className="flex gap-2 mb-4">
          <button
            onClick={switchToFormView}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              viewMode === 'form'
                ? 'bg-accent-primary text-black'
                : 'bg-gray-100 dark:bg-gray-800 text-text-light-muted dark:text-text-muted hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            <SlidersHorizontal size={16} />
            {t('servers.world_config.view.form')}
          </button>
          <button
            onClick={switchToJsonView}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              viewMode === 'json'
                ? 'bg-accent-primary text-black'
                : 'bg-gray-100 dark:bg-gray-800 text-text-light-muted dark:text-text-muted hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            <Code size={16} />
            {t('servers.world_config.view.json')}
          </button>
        </div>
      )}

      {/* JSON Error */}
      {jsonError && (
        <div className="flex items-center gap-3 p-3 mb-4 bg-red-500/10 border border-red-500/30 rounded-lg">
          <AlertTriangle className="text-red-500 flex-shrink-0" size={18} />
          <p className="text-sm text-red-500">{jsonError}</p>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-accent-primary" size={32} />
        </div>
      ) : error ? (
        <div className="text-center py-12">
          <p className="text-red-500 mb-4">{error}</p>
          <Button variant="secondary" onClick={loadConfig}>
            {t('common.retry')}
          </Button>
        </div>
      ) : config && viewMode === 'json' ? (
        <div className="max-h-[60vh] overflow-hidden">
          <textarea
            value={jsonText}
            onChange={(e) => handleJsonChange(e.target.value)}
            disabled={isDisabled}
            className="w-full h-[60vh] p-4 font-mono text-sm bg-gray-900 text-gray-100 border border-gray-700 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-accent-primary/50 disabled:opacity-50 disabled:cursor-not-allowed"
            spellCheck={false}
          />
        </div>
      ) : config ? (
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
         {/* Gameplay Section */}
          <CollapsibleSection title={t('servers.world_config.sections.gameplay')} icon={<Swords size={18} />}>
            <ToggleSetting
              label={t('servers.world_config.gameplay.pvp')}
              description={t('servers.world_config.gameplay.pvp_desc')}
              checked={config.IsPvpEnabled ?? true}
              onChange={(v) => updateConfig('IsPvpEnabled', v)}
              disabled={isDisabled}
            />
            <ToggleSetting
              label={t('servers.world_config.gameplay.fall_damage')}
              description={t('servers.world_config.gameplay.fall_damage_desc')}
              checked={config.IsFallDamageEnabled ?? true}
              onChange={(v) => updateConfig('IsFallDamageEnabled', v)}
              disabled={isDisabled}
            />
            <ToggleSetting
              label={t('servers.world_config.gameplay.npc_spawning')}
              description={t('servers.world_config.gameplay.npc_spawning_desc')}
              checked={config.IsSpawningNPC ?? true}
              onChange={(v) => updateConfig('IsSpawningNPC', v)}
              disabled={isDisabled}
            />
            <ToggleSetting
              label={t('servers.world_config.gameplay.freeze_npc')}
              description={t('servers.world_config.gameplay.freeze_npc_desc')}
              checked={config.IsAllNPCFrozen ?? false}
              onChange={(v) => updateConfig('IsAllNPCFrozen', v)}
              disabled={isDisabled}
            />
            <ToggleSetting
              label={t('servers.world_config.gameplay.spawn_markers')}
              description={t('servers.world_config.gameplay.spawn_markers_desc')}
              checked={config.IsSpawnMarkersEnabled ?? true}
              onChange={(v) => updateConfig('IsSpawnMarkersEnabled', v)}
              disabled={isDisabled}
            />
            <ToggleSetting
              label={t('servers.world_config.gameplay.objective_markers')}
              description={t('servers.world_config.gameplay.objective_markers_desc')}
              checked={config.IsObjectiveMarkersEnabled ?? true}
              onChange={(v) => updateConfig('IsObjectiveMarkersEnabled', v)}
              disabled={isDisabled}
            />
            <ToggleSetting
              label={t('servers.world_config.gameplay.compass')}
              description={t('servers.world_config.gameplay.compass_desc')}
              checked={config.IsCompassUpdating ?? true}
              onChange={(v) => updateConfig('IsCompassUpdating', v)}
              disabled={isDisabled}
            />
          </CollapsibleSection>

          {/* Time & Effects Section */}
          <CollapsibleSection title={t('servers.world_config.sections.time')} icon={<Clock size={18} />}>
            <ToggleSetting
              label={t('servers.world_config.time.paused')}
              description={t('servers.world_config.time.paused_desc')}
              checked={config.IsGameTimePaused ?? false}
              onChange={(v) => updateConfig('IsGameTimePaused', v)}
              disabled={isDisabled}
            />
            {config.ClientEffects && (
              <>
                <NumberSetting
                  label={t('servers.world_config.time.sun_height')}
                  description={t('servers.world_config.time.sun_height_desc')}
                  value={config.ClientEffects.SunHeightPercent ?? 100}
                  onChange={(v) => updateClientEffect('SunHeightPercent', v)}
                  disabled={isDisabled}
                  min={0}
                  max={100}
                  step={1}
                />
                <NumberSetting
                  label={t('servers.world_config.time.sun_angle')}
                  description={t('servers.world_config.time.sun_angle_desc')}
                  value={config.ClientEffects.SunAngleDegrees ?? 0}
                  onChange={(v) => updateClientEffect('SunAngleDegrees', v)}
                  disabled={isDisabled}
                  min={0}
                  max={360}
                  step={1}
                />
                <NumberSetting
                  label={t('servers.world_config.time.sun_intensity')}
                  description={t('servers.world_config.time.sun_intensity_desc')}
                  value={config.ClientEffects.SunIntensity ?? 0.25}
                  onChange={(v) => updateClientEffect('SunIntensity', v)}
                  disabled={isDisabled}
                  min={0}
                  max={2}
                />
                <NumberSetting
                  label={t('servers.world_config.time.bloom_intensity')}
                  description={t('servers.world_config.time.bloom_intensity_desc')}
                  value={config.ClientEffects.BloomIntensity ?? 0.3}
                  onChange={(v) => updateClientEffect('BloomIntensity', v)}
                  disabled={isDisabled}
                  min={0}
                  max={2}
                />
                <NumberSetting
                  label={t('servers.world_config.time.bloom_power')}
                  description={t('servers.world_config.time.bloom_power_desc')}
                  value={config.ClientEffects.BloomPower ?? 8}
                  onChange={(v) => updateClientEffect('BloomPower', v)}
                  disabled={isDisabled}
                  min={0}
                  max={16}
                  step={1}
                />
              </>
            )}
          </CollapsibleSection>

          {/* World Management Section */}
          <CollapsibleSection title={t('servers.world_config.sections.management')} icon={<Settings size={18} />}>
            <ToggleSetting
              label={t('servers.world_config.management.world_ticking')}
              description={t('servers.world_config.management.world_ticking_desc')}
              checked={config.IsTicking ?? true}
              onChange={(v) => updateConfig('IsTicking', v)}
              disabled={isDisabled}
            />
            <ToggleSetting
              label={t('servers.world_config.management.block_ticking')}
              description={t('servers.world_config.management.block_ticking_desc')}
              checked={config.IsBlockTicking ?? true}
              onChange={(v) => updateConfig('IsBlockTicking', v)}
              disabled={isDisabled}
            />
            <ToggleSetting
              label={t('servers.world_config.management.save_players')}
              description={t('servers.world_config.management.save_players_desc')}
              checked={config.IsSavingPlayers ?? true}
              onChange={(v) => updateConfig('IsSavingPlayers', v)}
              disabled={isDisabled}
            />
            <ToggleSetting
              label={t('servers.world_config.management.save_chunks')}
              description={t('servers.world_config.management.save_chunks_desc')}
              checked={config.IsSavingChunks ?? true}
              onChange={(v) => updateConfig('IsSavingChunks', v)}
              disabled={isDisabled}
            />
            <ToggleSetting
              label={t('servers.world_config.management.save_new_chunks')}
              description={t('servers.world_config.management.save_new_chunks_desc')}
              checked={config.SaveNewChunks ?? true}
              onChange={(v) => updateConfig('SaveNewChunks', v)}
              disabled={isDisabled}
            />
            <ToggleSetting
              label={t('servers.world_config.management.unload_chunks')}
              description={t('servers.world_config.management.unload_chunks_desc')}
              checked={config.IsUnloadingChunks ?? true}
              onChange={(v) => updateConfig('IsUnloadingChunks', v)}
              disabled={isDisabled}
            />
            <ToggleSetting
              label={t('servers.world_config.management.delete_on_start')}
              description={t('servers.world_config.management.delete_on_start_desc')}
              checked={config.DeleteOnUniverseStart ?? false}
              onChange={(v) => updateConfig('DeleteOnUniverseStart', v)}
              disabled={isDisabled}
            />
            <ToggleSetting
              label={t('servers.world_config.management.delete_on_remove')}
              description={t('servers.world_config.management.delete_on_remove_desc')}
              checked={config.DeleteOnRemove ?? false}
              onChange={(v) => updateConfig('DeleteOnRemove', v)}
              disabled={isDisabled}
            />
          </CollapsibleSection>

          {/* Info Section (Read-only) */}
          <CollapsibleSection title={t('servers.world_config.sections.info')} icon={<Info size={18} />} defaultOpen={false}>
            <ReadOnlyField label={t('servers.world_config.info.version')} value={config.Version} />
            <ReadOnlyField label={t('servers.world_config.info.seed')} value={config.Seed} />
            <ReadOnlyField label={t('servers.world_config.info.generator')} value={config.WorldGen?.Name} />
            <ReadOnlyField label={t('servers.world_config.info.gameplay')} value={config.GameplayConfig} />
          </CollapsibleSection>
        </div>
      ) : null}

      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={isDisabled || saving || !hasChanges}
        >
          {saving ? t('common.saving') : t('common.save_changes')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
