import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { ArrowUpDown } from 'lucide-react';
import { useI18n } from '../../lib/language';

export interface OutputNodeData {
  columns: string[];
  rows: (string | number | null)[][];
  loading: boolean;
  error: string | null;
}

function OutputNode({ data }: NodeProps) {
  const { t } = useI18n();
  const { columns, rows, loading, error } = data as OutputNodeData;

  function formatCell(val: string | number | null): string {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'number') return val.toLocaleString();
    const str = String(val);
    return str.length > 30 ? str.slice(0, 27) + '...' : str;
  }

  return (
    <div className="bg-bg-secondary border border-border rounded-lg shadow-lg min-w-[280px] max-w-[400px]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-tertiary rounded-t-lg">
        <ArrowUpDown size={14} className="text-success" />
        <span className="text-xs font-semibold text-text-primary">{t('node.output.title')}</span>
        {rows.length > 0 && (
          <span className="ml-auto text-[10px] text-text-secondary">
            {t('node.output.rowsSummary', { count: rows.length })}
          </span>
        )}
      </div>

      <div className="p-2 max-h-[250px] overflow-auto">
        {loading ? (
          <div className="text-xs text-text-secondary p-3 text-center">{t('node.output.loading')}</div>
        ) : error ? (
          <div className="text-xs text-error p-3">{error}</div>
        ) : columns.length === 0 ? (
          <div className="text-xs text-text-secondary p-3 text-center">
            {t('node.output.empty')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] border-collapse">
              <thead>
                <tr className="bg-bg-primary">
                  {columns.map((col, i) => (
                    <th
                      key={i}
                      className="px-2 py-1 text-left text-text-secondary font-medium border-b border-border whitespace-nowrap"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 50).map((row, rowIdx) => (
                  <tr key={rowIdx} className="border-b border-border/50 hover:bg-bg-hover">
                    {row.map((cell, colIdx) => (
                      <td
                        key={colIdx}
                        className={`px-2 py-1 whitespace-nowrap ${
                          cell === null ? 'text-text-secondary italic opacity-50' : 'text-text-primary'
                        }`}
                      >
                        {formatCell(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 50 && (
              <div className="text-[10px] text-text-secondary text-center py-1">
                {t('node.output.showing', { count: rows.length })}
              </div>
            )}
          </div>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-success !border-2 !border-bg-secondary"
      />
    </div>
  );
}

export default memo(OutputNode);
