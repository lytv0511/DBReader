import { useState, useEffect } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Database,
  Table,
  Hash,
  Type,
  Link2,
  Search,
} from 'lucide-react';
import { getTables, getTableColumns } from '../lib/db';
import { useI18n } from '../lib/language';
import type { ColumnInfo } from '../types';

interface TableSchema {
  name: string;
  columns: ColumnInfo[];
}

interface SidebarProps {
  isConnected: boolean;
  dbPath?: string | null;
  onSelectTable?: (table: string) => void;
  tables?: string[];
  onRefresh?: () => void;
}

export default function Sidebar({ isConnected, dbPath, onSelectTable, tables: externalTables }: SidebarProps) {
  const { t } = useI18n();
  const [tables, setTables] = useState<TableSchema[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isConnected) {
      setTables([]);
      return;
    }
    loadSchema();
  }, [isConnected, dbPath, externalTables]);

  async function loadSchema() {
    setLoading(true);
    try {
      const tableNames = await getTables();
      const schemas: TableSchema[] = [];
      for (const name of tableNames) {
        const columns = await getTableColumns(name);
        schemas.push({ name, columns });
      }
      setTables(schemas);
      const expandedState: Record<string, boolean> = {};
      tableNames.forEach((n) => (expandedState[n] = true));
      setExpanded(expandedState);
    } catch (err) {
      console.error('Failed to load schema:', err);
    } finally {
      setLoading(false);
    }
  }

  function toggleTable(name: string) {
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  const filtered = tables.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center">
        <Database size={48} className="text-text-secondary mb-4" />
        <p className="text-text-secondary text-sm">
          {t('sidebar.notConnected')}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-border">
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            type="text"
            placeholder={t('sidebar.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-7 pr-3 py-1.5 bg-bg-primary border border-border rounded-md text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-focus"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="text-text-secondary text-sm p-3">{t('sidebar.schemaLoading')}</div>
        ) : filtered.length === 0 ? (
          <div className="text-text-secondary text-sm p-3">{t('sidebar.noTablesFound')}</div>
        ) : (
          filtered.map((table) => (
            <div key={table.name} className="mb-1">
              <button
                onClick={() => toggleTable(table.name)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm hover:bg-bg-hover transition-colors text-left"
              >
                {expanded[table.name] ? (
                  <ChevronDown size={14} className="text-text-secondary shrink-0" />
                ) : (
                  <ChevronRight size={14} className="text-text-secondary shrink-0" />
                )}
                <Table size={14} className="text-accent shrink-0" />
                <span
                  className="truncate cursor-pointer hover:text-accent"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectTable?.(table.name);
                  }}
                >
                  {table.name}
                </span>
                <span className="ml-auto text-text-secondary text-xs">
                  {table.columns.length}
                </span>
              </button>

              {expanded[table.name] && (
                <div className="ml-5 border-l border-border pl-2">
                  {table.columns.map((col) => (
                    <div
                      key={col.name}
                      className="flex items-center gap-1.5 px-2 py-1 text-xs text-text-secondary hover:text-text-primary"
                    >
                      {col.primary_key ? (
                        <Link2 size={10} className="text-warning shrink-0" />
                      ) : col.data_type.toLowerCase().includes('int') ? (
                        <Hash size={10} className="text-accent shrink-0" />
                      ) : (
                        <Type size={10} className="text-text-secondary shrink-0" />
                      )}
                      <span className="truncate">{col.name}</span>
                      <span className="ml-auto text-text-secondary opacity-60">
                        {col.data_type}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="p-3 border-t border-border">
        <button
          onClick={loadSchema}
          className="w-full px-3 py-1.5 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-xs text-text-secondary transition-colors"
        >
          {t('sidebar.refreshSchema')}
        </button>
      </div>
    </div>
  );
}
