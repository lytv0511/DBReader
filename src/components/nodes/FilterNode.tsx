import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { Filter } from 'lucide-react';

export interface FilterNodeData {
  filterColumn: string;
  filterOp: string;
  filterValue: string;
  customSql: string;
  columns: string[];
  onFilterChange?: (column: string, op: string, value: string) => void;
  onCustomSqlChange?: (sql: string) => void;
}

const OPERATORS = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'NOT LIKE', 'IN', 'IS NULL', 'IS NOT NULL'];

function FilterNode({ data }: NodeProps) {
  const { filterColumn, filterOp, filterValue, customSql, columns, onFilterChange, onCustomSqlChange } =
    data as FilterNodeData;
  const [useCustom, setUseCustom] = useState(!filterColumn && !!customSql);

  return (
    <div className="bg-bg-secondary border border-border rounded-lg shadow-lg min-w-[220px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-tertiary rounded-t-lg">
        <Filter size={14} className="text-warning" />
        <span className="text-xs font-semibold text-text-primary">Filter</span>
      </div>

      <div className="p-3">
        <div className="flex gap-1 mb-2">
          <button
            onClick={() => setUseCustom(false)}
            className={`flex-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
              !useCustom ? 'bg-accent text-white' : 'bg-bg-primary text-text-secondary hover:bg-bg-hover'
            }`}
          >
            GUI
          </button>
          <button
            onClick={() => setUseCustom(true)}
            className={`flex-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
              useCustom ? 'bg-accent text-white' : 'bg-bg-primary text-text-secondary hover:bg-bg-hover'
            }`}
          >
            SQL
          </button>
        </div>

        {!useCustom ? (
          <div className="flex flex-col gap-2">
            <select
              value={filterColumn || ''}
              onChange={(e) => onFilterChange?.(e.target.value, filterOp || '=', filterValue || '')}
              className="w-full px-2 py-1.5 bg-bg-primary border border-border rounded-md text-xs text-text-primary focus:outline-none focus:border-border-focus"
            >
              <option value="">Column...</option>
              {columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <select
              value={filterOp || '='}
              onChange={(e) => onFilterChange?.(filterColumn || '', e.target.value, filterValue || '')}
              className="w-full px-2 py-1.5 bg-bg-primary border border-border rounded-md text-xs text-text-primary focus:outline-none focus:border-border-focus"
            >
              {OPERATORS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>

            {!['IS NULL', 'IS NOT NULL'].includes(filterOp) && (
              <input
                type="text"
                value={filterValue || ''}
                onChange={(e) => onFilterChange?.(filterColumn || '', filterOp || '=', e.target.value)}
                placeholder="Value..."
                className="w-full px-2 py-1.5 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-focus"
              />
            )}
          </div>
        ) : (
          <textarea
            value={customSql || ''}
            onChange={(e) => onCustomSqlChange?.(e.target.value)}
            placeholder="WHERE column = 'value'"
            spellCheck={false}
            className="w-full h-20 p-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary resize-none focus:outline-none focus:border-border-focus"
          />
        )}
      </div>

      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-warning !border-2 !border-bg-secondary"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-warning !border-2 !border-bg-secondary"
      />
    </div>
  );
}

export default memo(FilterNode);
