import { memo, useRef } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { Table, X } from 'lucide-react';
import type { ColumnInfo } from '../../types';
import { useI18n } from '../../lib/language';

export interface TableNodeData {
  selectedTable: string;
  tables: string[];
  columns: ColumnInfo[];
  onTableChange?: (table: string) => void;
  onDelete?: (id: string) => void;
}

function TableNode({ id, data }: NodeProps) {
  const { t } = useI18n();
  const { selectedTable, tables, columns, onTableChange, onDelete } = data as TableNodeData;
  const selectRef = useRef<HTMLSelectElement>(null);

  const stopAll = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  return (
    <div className="bg-bg-secondary border border-border rounded-lg shadow-lg min-w-[200px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-tertiary rounded-t-lg">
        <Table size={14} className="text-accent" />
        <span className="text-xs font-semibold text-text-primary">{t('node.table.title')}</span>
        {onDelete && (
          <button
            onClick={() => onDelete(id)}
            onPointerDown={stopAll}
            className="ml-auto text-text-secondary hover:text-error transition-colors"
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div className="p-3">
        <select
          ref={selectRef}
          value={selectedTable || ''}
          onChange={(e) => { selectRef.current?.blur(); onTableChange?.(e.target.value); }}
          onPointerDown={stopAll}
          onPointerUp={stopAll}
          onMouseDown={stopAll}
          onMouseUp={stopAll}
          onClick={stopAll}
          className="nodrag w-full px-2 py-1.5 bg-bg-primary border border-border rounded-md text-xs text-text-primary focus:outline-none focus:border-border-focus"
        >
          <option value="">{t('node.table.selectTable')}</option>
          {tables.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        {columns.length > 0 && (
          <div className="mt-2 flex flex-col gap-0.5">
            {columns.map((col) => (
              <div key={col.name} className="text-[10px] text-text-secondary flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-accent/40" />
                {col.name}
                <span className="opacity-50 ml-auto">{col.data_type}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-accent !border-2 !border-bg-secondary"
      />
    </div>
  );
}

export default memo(TableNode);
