import type { ItemStack } from '../../types/inventory';
import { useTranslation } from 'react-i18next';
import { Badge } from '../ui';

interface InventoryGridProps {
  items: (ItemStack | null)[];
  columns?: number;
  showTooltip?: boolean;
}

export const InventoryGrid = ({ items, columns = 9, showTooltip = true }: InventoryGridProps) => {
  const { t } = useTranslation();
  const getRarityColor = (rarity: ItemStack['rarity']) => {
    switch (rarity) {
      case 'legendary': return 'border-accent-primary shadow-accent-primary/30';
      case 'epic': return 'border-purple-500 shadow-purple-500/30';
      case 'rare': return 'border-accent-secondary shadow-accent-secondary/30';
      case 'uncommon': return 'border-success shadow-success/30';
      default: return 'border-gray-700';
    }
  };

  return (
    <div
      className="grid gap-1"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {items.map((item, index) => (
        <div
          key={index}
          className={`aspect-square bg-primary-bg border-2 rounded-lg p-1 relative group ${
            item ? getRarityColor(item.rarity) : 'border-gray-800'
          }`}
        >
          {item ? (
            <>
              {/* Item Icon */}
              <div className="w-full h-full flex items-center justify-center">
                <img
                  src={item.iconUrl}
                  alt={item.name}
                  className="w-full h-full object-contain"
                />
              </div>

              {/* Stack Amount */}
              {item.amount > 1 && (
                <span className="absolute bottom-1 right-1 text-xs font-bold text-white drop-shadow-lg">
                  {item.amount}
                </span>
              )}

              {/* Durability Bar */}
              {item.durability && (
                <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-800 rounded-b">
                  <div
                    className={`h-full rounded-b ${
                      (item.durability.current / item.durability.max) > 0.5
                        ? 'bg-success'
                        : (item.durability.current / item.durability.max) > 0.25
                        ? 'bg-warning'
                        : 'bg-danger'
                    }`}
                    style={{
                      width: `${(item.durability.current / item.durability.max) * 100}%`,
                    }}
                  />
                </div>
              )}

              {/* Tooltip */}
              {showTooltip && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                  <div className="glass-card p-3 min-w-max shadow-xl">
                    <p className="font-heading font-semibold text-text-primary">{item.name}</p>
                    <Badge size="sm" variant="default" className="mt-1">
                      {t(`inventory.rarity.${item.rarity}`, { defaultValue: item.rarity })}
                    </Badge>
                    {item.description && (
                      <p className="text-xs text-text-muted mt-2">{item.description}</p>
                    )}
                    {item.durability && (
                      <p className="text-xs text-text-muted mt-1">
                        {t('inventory.durability', { current: item.durability.current, max: item.durability.max })}
                      </p>
                    )}
                    {item.enchantments && item.enchantments.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {item.enchantments.map((ench) => (
                          <p key={ench.id} className="text-xs text-accent-primary">
                            {ench.name} {ench.level}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
};
