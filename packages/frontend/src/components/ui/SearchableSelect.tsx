import { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, X, Search, Check } from 'lucide-react';

interface SearchableSelectProps {
  options: string[];
  value: string | string[];
  onChange: (value: string | string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  multiple?: boolean;
  allLabel?: string;
}

export const SearchableSelect = ({
  options,
  value,
  onChange,
  placeholder: _placeholder,
  searchPlaceholder,
  multiple = false,
  allLabel,
}: SearchableSelectProps) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  // Filter options based on search query
  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options;
    const query = searchQuery.toLowerCase();
    return options.filter(option => option.toLowerCase().includes(query));
  }, [options, searchQuery]);

  // Get display text for the button
  const getDisplayText = () => {
    if (multiple) {
      const selectedValues = value as string[];
      if (selectedValues.length === 0) return allLabel ?? t('ui.searchable_select.all');
      if (selectedValues.length === 1) return selectedValues[0];
      return t('ui.searchable_select.selected_count', { count: selectedValues.length });
    } else {
      return (value as string) === 'all' ? (allLabel ?? t('ui.searchable_select.all')) : (value as string);
    }
  };

  // Handle option selection
  const handleSelect = (option: string) => {
    if (multiple) {
      const selectedValues = value as string[];
      if (selectedValues.includes(option)) {
        onChange(selectedValues.filter(v => v !== option));
      } else {
        onChange([...selectedValues, option]);
      }
    } else {
      onChange(option);
      setIsOpen(false);
      setSearchQuery('');
    }
  };

  // Handle "All" selection for single select
  const handleSelectAll = () => {
    if (multiple) {
      onChange([]);
    } else {
      onChange('all');
      setIsOpen(false);
      setSearchQuery('');
    }
  };

  // Check if an option is selected
  const isSelected = (option: string) => {
    if (multiple) {
      return (value as string[]).includes(option);
    }
    return value === option;
  };

  // Clear all selections (for multi-select)
  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(multiple ? [] : 'all');
  };

  const hasSelection = multiple
    ? (value as string[]).length > 0
    : value !== 'all';

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-text-light-primary dark:text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary flex items-center justify-between gap-2 min-h-[42px]"
      >
        <span className="truncate text-left">
          {getDisplayText()}
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {hasSelection && (
            <button
              type="button"
              onClick={handleClear}
              className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
            >
              <X size={14} />
            </button>
          )}
          <ChevronDown
            size={16}
            className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-[100] w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg shadow-xl overflow-hidden">
          {/* Search Input */}
          <div className="p-2 border-b border-gray-200 dark:border-gray-700">
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-light-muted dark:text-text-muted"
              />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={searchPlaceholder ?? t('ui.searchable_select.search')}
                className="w-full pl-9 pr-3 py-2 bg-gray-100 dark:bg-gray-900 border-0 rounded-md text-sm text-text-light-primary dark:text-text-primary placeholder-text-light-muted dark:placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
              />
            </div>
          </div>

          {/* Options List */}
          <div className="max-h-60 overflow-y-auto">
            {/* "All" option */}
            <button
              type="button"
              onClick={handleSelectAll}
              className={`w-full px-4 py-2 text-left text-sm flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 ${
                !hasSelection ? 'bg-accent-primary/10 text-accent-primary' : 'text-text-light-primary dark:text-text-primary'
              }`}
            >
              <span>{allLabel ?? t('ui.searchable_select.all')}</span>
              {!hasSelection && <Check size={16} />}
            </button>

            {/* Filtered Options */}
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => handleSelect(option)}
                  className={`w-full px-4 py-2 text-left text-sm flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 ${
                    isSelected(option) ? 'bg-accent-primary/10 text-accent-primary' : 'text-text-light-primary dark:text-text-primary'
                  }`}
                >
                  <span className="truncate">{option}</span>
                  {isSelected(option) && <Check size={16} className="flex-shrink-0" />}
                </button>
              ))
            ) : (
              <div className="px-4 py-3 text-sm text-text-light-muted dark:text-text-muted text-center">
                {t('ui.searchable_select.no_results')}
              </div>
            )}
          </div>

          {/* Selected count for multi-select */}
          {multiple && (value as string[]).length > 0 && (
            <div className="p-2 border-t border-gray-200 dark:border-gray-700 text-xs text-text-light-muted dark:text-text-muted">
              {t('ui.searchable_select.selected_count', { count: (value as string[]).length })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
