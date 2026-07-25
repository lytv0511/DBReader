import type { QueryResult } from '../types';
import { ArrowUpDown } from 'lucide-react';

interface ResultsGridProps {
  result: QueryResult | null;
}

export default function ResultsGrid({ result }: ResultsGridProps) {
  if (!result) {
    return (
      <div className="h-full flex items-center justify-center text-text-secondary text-sm">
        Run a query to see results
      </div>
    );
  }

  if (result.columns.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-text-secondary text-sm">
        Query executed. {result.rows_affected ?? 0} row(s) affected.
      </div>
    );
  }

  function formatCell(val: string | number | null): string {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'number') return val.toLocaleString();
    return String(val);
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="bg-bg-tertiary sticky top-0">
            <th className="px-3 py-2 text-left text-text-secondary font-medium border-b border-border w-12">
              #
            </th>
            {result.columns.map((col, i) => (
              <th
                key={i}
                className="px-3 py-2 text-left text-text-secondary font-medium border-b border-border whitespace-nowrap"
              >
                <div className="flex items-center gap-1">
                  {col}
                  <ArrowUpDown size={10} className="opacity-40" />
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, rowIdx) => (
            <tr
              key={rowIdx}
              className="border-b border-border hover:bg-bg-hover transition-colors"
            >
              <td className="px-3 py-1.5 text-text-secondary tabular-nums">
                {rowIdx + 1}
              </td>
              {row.map((cell, colIdx) => (
                <td
                  key={colIdx}
                  className={`px-3 py-1.5 whitespace-nowrap max-w-[300px] truncate ${
                    cell === null ? 'text-text-secondary italic opacity-50' : 'text-text-primary'
                  }`}
                  title={formatCell(cell)}
                >
                  {formatCell(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="px-3 py-2 border-t border-border text-xs text-text-secondary">
        {result.rows.length} row{result.rows.length !== 1 ? 's' : ''}
        {result.rows_affected !== null && result.rows_affected !== result.rows.length && (
          <> · {result.rows_affected} affected</>
        )}
      </div>
    </div>
  );
}
