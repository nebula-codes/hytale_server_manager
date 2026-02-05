import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, ChevronsUpDown, Download, Eye, Search } from 'lucide-react';
import { Button } from './Button';
import { Input } from './Input';

export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  filterable?: boolean;
  render?: (item: T) => React.ReactNode;
  className?: string;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  keyExtractor: (item: T) => string;
  itemsPerPage?: number;
  searchable?: boolean;
  exportable?: boolean;
  selectable?: boolean;
  onRowClick?: (item: T) => void;
  onSelectionChange?: (selectedItems: T[]) => void;
  bulkActions?: React.ReactNode;
}

export function DataTable<T extends Record<string, any>>({
  data,
  columns,
  keyExtractor,
  itemsPerPage: initialItemsPerPage = 10,
  searchable = true,
  exportable = true,
  selectable = false,
  onRowClick,
  onSelectionChange,
  bulkActions,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState(initialItemsPerPage);

  // Clear selection when data changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [data]);

  // Notify parent of selection changes
  useEffect(() => {
    if (onSelectionChange) {
      const selectedItems = data.filter(item => selectedIds.has(keyExtractor(item)));
      onSelectionChange(selectedItems);
    }
  }, [selectedIds, data, keyExtractor, onSelectionChange]);

  // Filter data based on search query
  const filteredData = useMemo(() => {
    if (!searchQuery.trim()) return data;

    const lowerQuery = searchQuery.toLowerCase();
    return data.filter((item) =>
      columns.some((col) => {
        const value = item[col.key];
        if (value === null || value === undefined) return false;
        return String(value).toLowerCase().includes(lowerQuery);
      })
    );
  }, [data, searchQuery, columns]);

  // Sort data
  const sortedData = useMemo(() => {
    if (!sortColumn) return filteredData;

    return [...filteredData].sort((a, b) => {
      const aVal = a[sortColumn];
      const bVal = b[sortColumn];

      if (aVal === null || aVal === undefined) return 1;
      if (bVal === null || bVal === undefined) return -1;

      let comparison = 0;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        comparison = aVal.localeCompare(bVal);
      } else if (typeof aVal === 'number' && typeof bVal === 'number') {
        comparison = aVal - bVal;
      } else {
        comparison = String(aVal).localeCompare(String(bVal));
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredData, sortColumn, sortDirection]);

  // Paginate data
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return sortedData.slice(startIndex, startIndex + pageSize);
  }, [sortedData, currentPage, pageSize]);

  const totalPages = Math.ceil(sortedData.length / pageSize);

  // Handle select all for current page
  const handleSelectAll = useCallback(() => {
    const currentPageIds = paginatedData.map(item => keyExtractor(item));
    const allSelected = currentPageIds.every(id => selectedIds.has(id));

    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (allSelected) {
        // Deselect all on current page
        currentPageIds.forEach(id => newSet.delete(id));
      } else {
        // Select all on current page
        currentPageIds.forEach(id => newSet.add(id));
      }
      return newSet;
    });
  }, [paginatedData, keyExtractor, selectedIds]);

  // Handle individual row selection
  const handleSelectRow = useCallback((id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Check if all on current page are selected
  const allCurrentPageSelected = paginatedData.length > 0 && paginatedData.every(item => selectedIds.has(keyExtractor(item)));
  const someCurrentPageSelected = paginatedData.some(item => selectedIds.has(keyExtractor(item))) && !allCurrentPageSelected;

  const handleSort = (columnKey: string) => {
    if (sortColumn === columnKey) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(columnKey);
      setSortDirection('asc');
    }
  };

  const toggleColumnVisibility = (columnKey: string) => {
    setHiddenColumns((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(columnKey)) {
        newSet.delete(columnKey);
      } else {
        newSet.add(columnKey);
      }
      return newSet;
    });
  };

  const exportToCSV = () => {
    const visibleColumns = columns.filter((col) => !hiddenColumns.has(col.key));
    const headers = visibleColumns.map((col) => col.label).join(',');
    const rows = sortedData
      .map((item) =>
        visibleColumns
          .map((col) => {
            const value = item[col.key];
            const str = String(value ?? '');
            // Escape quotes and wrap in quotes if contains comma
            return str.includes(',') ? `"${str.replace(/"/g, '""')}"` : str;
          })
          .join(',')
      )
      .join('\n');

    const csv = `${headers}\n${rows}`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `export-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const visibleColumns = columns.filter((col) => !hiddenColumns.has(col.key));

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        {searchable && (
          <div className="flex-1 max-w-sm">
            <Input
              placeholder={t('table.search')}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              icon={<Search size={16} />}
            />
          </div>
        )}
        <div className="flex items-center gap-2">
          {/* Column Visibility */}
          <div className="relative group">
            <Button variant="ghost" size="sm" icon={<Eye size={16} />}>
              {t('table.columns')}
            </Button>
            <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-primary-bg-secondary border border-gray-300 dark:border-gray-800 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
              <div className="p-2 space-y-1">
                {columns.map((col) => (
                  <label
                    key={col.key}
                    className="flex items-center gap-2 px-2 py-1.5 hover:bg-primary-bg dark:hover:bg-primary-bg rounded cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={!hiddenColumns.has(col.key)}
                      onChange={() => toggleColumnVisibility(col.key)}
                      className="rounded"
                    />
                    <span className="text-sm text-text-light-primary dark:text-text-primary">{col.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Export */}
          {exportable && (
            <Button variant="ghost" size="sm" icon={<Download size={16} />} onClick={exportToCSV}>
              {t('table.export')}
            </Button>
          )}
        </div>
      </div>

      {/* Selection Bar */}
      {selectable && selectedIds.size > 0 && (
        <div className="flex items-center justify-between bg-accent-primary/10 border border-accent-primary/30 rounded-lg px-4 py-2">
          <span className="text-sm text-text-light-primary dark:text-text-primary">
            {t('table.selection.count', { count: selectedIds.size })}
          </span>
          <div className="flex items-center gap-2">
            {bulkActions}
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              {t('table.selection.clear')}
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-300 dark:border-gray-800">
        <table className="w-full">
          <thead className="bg-primary-bg-secondary/60 dark:bg-primary-bg-secondary/60">
            <tr>
              {selectable && (
                <th className="w-12 px-4 py-3">
                  <div className="flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={allCurrentPageSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someCurrentPageSelected;
                      }}
                      onChange={handleSelectAll}
                      className="w-4 h-4 rounded border-2 border-gray-400 dark:border-gray-600 bg-transparent checked:bg-accent-primary checked:border-accent-primary focus:ring-2 focus:ring-accent-primary focus:ring-offset-0 cursor-pointer transition-colors"
                    />
                  </div>
                </th>
              )}
              {visibleColumns.map((column) => (
                <th
                  key={column.key}
                  className={`text-left px-4 py-3 text-sm font-heading font-semibold text-text-light-muted dark:text-text-muted ${column.className || ''}`}
                >
                  {column.sortable !== false ? (
                    <button
                      onClick={() => handleSort(column.key)}
                      className="flex items-center gap-2 hover:text-text-primary dark:hover:text-text-primary transition-colors"
                    >
                      {column.label}
                      {sortColumn === column.key ? (
                        sortDirection === 'asc' ? (
                          <ChevronUp size={14} />
                        ) : (
                          <ChevronDown size={14} />
                        )
                      ) : (
                        <ChevronsUpDown size={14} className="opacity-50" />
                      )}
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedData.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length + (selectable ? 1 : 0)}
                  className="px-4 py-12 text-center text-text-light-muted dark:text-text-muted"
                >
                  {t('table.no_data')}
                </td>
              </tr>
            ) : (
              paginatedData.map((item) => {
                const itemId = keyExtractor(item);
                const isSelected = selectedIds.has(itemId);

                return (
                  <tr
                    key={itemId}
                    onClick={() => onRowClick?.(item)}
                    className={`border-t border-gray-800/50 dark:border-gray-800/50 ${onRowClick ? 'cursor-pointer hover:bg-primary-bg/50 dark:hover:bg-primary-bg/50' : ''
                      } ${isSelected ? 'bg-accent-primary/5' : ''} transition-colors`}
                  >
                    {selectable && (
                      <td className="w-12 px-4 py-3">
                        <div className="flex items-center justify-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleSelectRow(itemId);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-4 h-4 rounded border-2 border-gray-400 dark:border-gray-600 bg-transparent checked:bg-accent-primary checked:border-accent-primary focus:ring-2 focus:ring-accent-primary focus:ring-offset-0 cursor-pointer transition-colors"
                          />
                        </div>
                      </td>
                    )}
                    {visibleColumns.map((column) => (
                      <td
                        key={column.key}
                        className={`px-4 py-3 text-sm text-text-light-primary dark:text-text-primary ${column.className || ''}`}
                      >
                        {column.render ? column.render(item) : item[column.key]}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <p className="text-sm text-text-light-muted dark:text-text-muted">
            {t('table.pagination.showing', {
              start: sortedData.length > 0 ? (currentPage - 1) * pageSize + 1 : 0,
              end: Math.min(currentPage * pageSize, sortedData.length),
              total: sortedData.length
            })}
          </p>
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-light-muted dark:text-text-muted">{t('table.pagination.per_page')}</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="px-2 py-1 text-sm bg-white dark:bg-primary-bg-secondary border border-gray-300 dark:border-gray-700 rounded text-text-light-primary dark:text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              {t('table.pagination.previous')}
            </Button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }

                return (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={`px-3 py-1 rounded text-sm transition-colors ${currentPage === pageNum
                      ? 'bg-accent-primary text-black font-medium'
                      : 'text-text-light-muted dark:text-text-muted hover:text-text-primary dark:hover:text-text-primary hover:bg-primary-bg dark:hover:bg-primary-bg'
                      }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              {t('table.pagination.next')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
