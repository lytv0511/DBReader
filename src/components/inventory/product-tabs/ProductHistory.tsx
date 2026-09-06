import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, ChevronUp, ChevronDown, Search } from 'lucide-react';
import { executeQuery } from '../../../lib/db';
import { useI18n } from '../../../lib/language';
import { isMobile } from '../../../lib/platform';

interface LogEntry {
  id: number;
  batch_number: string | null;
  quantity_change: number;
  transaction_type: string;
  notes: string | null;
  provider_name: string | null;
  provider_sub: string | null;
  created_at: string;
}

type SortField = 'created_at' | 'transaction_type' | 'batch_number' | 'quantity_change' | 'notes' | 'provider_name';
type SortDir = 'asc' | 'desc';

interface ProductHistoryProps {
  productId: number;
  refreshKey?: number;
}

const TX_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  PURCHASE: { text: 'text-success', bg: 'bg-success/10', border: 'border-success/20' },
  USAGE: { text: 'text-warning', bg: 'bg-warning/10', border: 'border-warning/20' },
  SPOILAGE: { text: 'text-error', bg: 'bg-error/10', border: 'border-error/20' },
  ADJUSTMENT: { text: 'text-accent', bg: 'bg-accent/10', border: 'border-accent/20' },
};

export default function ProductHistory({ productId, refreshKey }: ProductHistoryProps) {
  const { t } = useI18n();
  const mobile = isMobile();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterType, setFilterType] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterNotes, setFilterNotes] = useState('');

  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const fetchLogs = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const result = await executeQuery(`
        SELECT
          il.id,
          b.batch_number,
          il.quantity_change,
          il.transaction_type,
          il.notes,
          pr.name AS provider_name,
          pr.sub_name,
          il.created_at
        FROM inventory_logs il
        JOIN batches b ON il.batch_id = b.id
        LEFT JOIN providers pr ON il.provider_id = pr.id
        WHERE b.product_id = ${productId}
        ORDER BY il.created_at DESC
      `);

      setLogs(result.rows.map((r) => ({
        id: r[0] as number,
        batch_number: r[1] as string | null,
        quantity_change: r[2] as number,
        transaction_type: r[3] as string,
        notes: r[4] as string | null,
        provider_name: r[5] as string | null,
        provider_sub: r[6] as string | null,
        created_at: r[7] as string,
      })));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) fetchLogs(true);
  }, [refreshKey, fetchLogs]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />;
  };

  const filtered = useMemo(() => {
    let result = [...logs];

    if (filterType) {
      result = result.filter((l) => l.transaction_type === filterType);
    }
    if (filterDateFrom) {
      result = result.filter((l) => l.created_at?.slice(0, 10) >= filterDateFrom);
    }
    if (filterDateTo) {
      result = result.filter((l) => l.created_at?.slice(0, 10) <= filterDateTo);
    }
    if (filterNotes) {
      const q = filterNotes.toLowerCase();
      result = result.filter((l) => l.notes?.toLowerCase().includes(q));
    }

    result.sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      switch (sortField) {
        case 'created_at':
          aVal = a.created_at || '';
          bVal = b.created_at || '';
          break;
        case 'transaction_type':
          aVal = a.transaction_type || '';
          bVal = b.transaction_type || '';
          break;
        case 'batch_number':
          aVal = a.batch_number || '';
          bVal = b.batch_number || '';
          break;
        case 'quantity_change':
          aVal = a.quantity_change;
          bVal = b.quantity_change;
          break;
        case 'notes':
          aVal = a.notes || '';
          bVal = b.notes || '';
          break;
        case 'provider_name':
          aVal = a.provider_name || '';
          bVal = b.provider_name || '';
          break;
        default:
          aVal = 0;
          bVal = 0;
      }

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      const cmp = String(aVal).localeCompare(String(bVal));
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [logs, filterType, filterDateFrom, filterDateTo, filterNotes, sortField, sortDir]);

  const summary = useMemo(() => {
    let totalPurchased = 0;
    let totalUsed = 0;
    let totalSpoiled = 0;
    for (const log of logs) {
      if (log.transaction_type === 'PURCHASE') totalPurchased += log.quantity_change;
      else if (log.transaction_type === 'USAGE') totalUsed += log.quantity_change;
      else if (log.transaction_type === 'SPOILAGE') totalSpoiled += log.quantity_change;
    }
    return {
      totalPurchased,
      totalUsed,
      totalSpoiled,
      net: totalPurchased + totalUsed + totalSpoiled,
    };
  }, [logs]);

  const hasFilters = filterType || filterDateFrom || filterDateTo || filterNotes;

  const sortHeaderClass = 'cursor-pointer select-none hover:text-text-primary transition-colors';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary">
        <RefreshCw size={20} className="animate-spin mr-2" />
        {t('phist.loading')}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 sm:px-6 py-3 border-b border-border bg-bg-secondary shrink-0">
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-bold text-text-primary">{t('phist.title')}</h3>
            <span className="text-[10px] text-text-secondary">{t('phist.entriesCount', { shown: filtered.length, total: logs.length })}</span>
          </div>
          <div className="flex items-center gap-2">
            {hasFilters && (
              <button
                onClick={() => { setFilterType(''); setFilterDateFrom(''); setFilterDateTo(''); setFilterNotes(''); }}
                className="text-[10px] text-error hover:text-error/80 transition-colors"
              >
                {t('phist.clearFilters')}
              </button>
            )}
            <button
              onClick={() => fetchLogs()}
              className="p-1.5 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-text-secondary transition-colors"
            >
              <RefreshCw size={12} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-wrap min-w-0">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-2 py-1 bg-bg-primary border border-border rounded text-[10px] text-text-primary focus:outline-none focus:border-accent"
          >
            <option value="">{t('phist.allTypes')}</option>
            <option value="PURCHASE">{t('common.tx.PURCHASE')}</option>
            <option value="USAGE">{t('common.tx.USAGE')}</option>
            <option value="SPOILAGE">{t('common.tx.SPOILAGE')}</option>
            <option value="ADJUSTMENT">{t('common.tx.ADJUSTMENT')}</option>
          </select>

          <input
            type="date"
            value={filterDateFrom}
            onChange={(e) => setFilterDateFrom(e.target.value)}
            className="px-2 py-1 bg-bg-primary border border-border rounded text-[10px] text-text-primary focus:outline-none focus:border-accent"
          />
          <span className="text-[10px] text-text-secondary">{t('phist.to')}</span>
          <input
            type="date"
            value={filterDateTo}
            onChange={(e) => setFilterDateTo(e.target.value)}
            className="px-2 py-1 bg-bg-primary border border-border rounded text-[10px] text-text-primary focus:outline-none focus:border-accent"
          />

          <div className="relative ml-auto min-w-0">
            <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              value={filterNotes}
              onChange={(e) => setFilterNotes(e.target.value)}
              placeholder={t('phist.searchNotes')}
              className="pl-6 pr-2 py-1 bg-bg-primary border border-border rounded text-[10px] text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent w-[160px] max-w-full"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-secondary text-xs">
            {logs.length === 0 ? t('phist.empty') : t('phist.emptyFiltered')}
          </div>
        ) : (
          <table className="w-full table-fixed text-xs">
            <thead className="sticky top-0 bg-bg-secondary border-b border-border">
              <tr>
                <th
                  onClick={() => handleSort('created_at')}
                  className={`text-left px-2 sm:px-4 py-2.5 text-text-secondary font-semibold w-[36%] sm:w-[24%] ${sortHeaderClass}`}
                >
                  <span className="inline-flex items-center gap-1">{t('phist.col.date')} <SortIcon field="created_at" /></span>
                </th>
                {!mobile && (
                <th
                  onClick={() => handleSort('transaction_type')}
                  className={`text-left px-2 sm:px-4 py-2.5 text-text-secondary font-semibold w-[13%] ${sortHeaderClass}`}
                >
                  <span className="inline-flex items-center gap-1">{t('phist.col.type')} <SortIcon field="transaction_type" /></span>
                </th>
                )}
                <th
                  onClick={() => handleSort('batch_number')}
                  className={`text-left px-2 sm:px-4 py-2.5 text-text-secondary font-semibold w-[22%] sm:w-[14%] ${sortHeaderClass}`}
                >
                  <span className="inline-flex items-center gap-1">{t('phist.col.batch')} <SortIcon field="batch_number" /></span>
                </th>
                <th
                  onClick={() => handleSort('quantity_change')}
                  className={`text-right px-2 sm:px-4 py-2.5 text-text-secondary font-semibold w-[16%] sm:w-[11%] ${sortHeaderClass}`}
                >
                  <span className="inline-flex items-center gap-1 justify-end">{t('phist.col.qty')} <SortIcon field="quantity_change" /></span>
                </th>
                {!mobile && (
                <th
                  onClick={() => handleSort('notes')}
                  className={`text-left px-2 sm:px-4 py-2.5 text-text-secondary font-semibold w-[20%] ${sortHeaderClass}`}
                >
                  <span className="inline-flex items-center gap-1">{t('phist.col.notes')} <SortIcon field="notes" /></span>
                </th>
                )}
                <th
                  onClick={() => handleSort('provider_name')}
                  className={`text-left px-2 sm:px-4 py-2.5 text-text-secondary font-semibold w-[26%] sm:w-[18%] ${sortHeaderClass}`}
                >
                  <span className="inline-flex items-center gap-1">{t('phist.col.provider')} <SortIcon field="provider_name" /></span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((log) => {
                const tc = TX_COLORS[log.transaction_type] || { text: 'text-text-secondary', bg: 'bg-bg-tertiary', border: 'border-border' };
                return (
                  <tr key={log.id} className="hover:bg-bg-hover transition-colors">
                    <td className="px-2 sm:px-4 py-2.5 text-text-secondary truncate">
                      {log.created_at?.replace('T', ' ').slice(0, 16)}
                    </td>
                    {!mobile && (
                    <td className="px-2 sm:px-4 py-2.5">
                      <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-semibold truncate max-w-full ${tc.bg} ${tc.text} ${tc.border}`}>
                        {log.transaction_type}
                      </span>
                    </td>
                    )}
                    <td className="px-2 sm:px-4 py-2.5 text-text-secondary font-mono truncate">{log.batch_number || '-'}</td>
                    <td className={`px-2 sm:px-4 py-2.5 text-right font-bold ${log.quantity_change >= 0 ? 'text-success' : 'text-error'}`}>
                      {log.quantity_change >= 0 ? '+' : ''}{log.quantity_change}
                    </td>
                    {!mobile && (
                    <td className="px-2 sm:px-4 py-2.5 text-text-secondary truncate">{log.notes || '-'}</td>
                    )}
                    <td className="px-2 sm:px-4 py-2.5 text-text-secondary truncate">
                      {log.provider_name ? `${log.provider_name}${log.provider_sub ? ` - ${log.provider_sub}` : ''}` : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {!mobile && (
            <tfoot className="border-t border-border bg-bg-tertiary">
              <tr className="text-[10px] font-semibold">
                <td className="px-2 sm:px-4 py-2.5 text-text-secondary" colSpan={3}>{t('phist.summary')}</td>
                <td className="px-2 sm:px-4 py-2.5 text-right truncate">
                  <span className="text-success">+{summary.totalPurchased}</span>
                  <span className="text-warning">{summary.totalUsed}</span>
                  <span className="text-error">{summary.totalSpoiled}</span>
                  <span className="text-text-primary">= {summary.net}</span>
                </td>
                <td className="px-2 sm:px-4 py-2.5 text-text-secondary truncate">
                  <span className="text-success">{t('phist.purchased')}</span>{' '}
                  <span className="text-warning">{t('phist.used')}</span>{' '}
                  <span className="text-error">{t('phist.spoiled')}</span>{' '}
                  <span className="text-text-primary">{t('phist.net')}</span>
                </td>
                <td />
              </tr>
            </tfoot>
            )}
          </table>
        )}
      </div>

      {error && (
        <div className="fixed bottom-4 right-4 bg-error/10 border border-error/20 text-error px-4 py-2 rounded-lg text-xs shadow-lg z-50">
          {error}
          <button onClick={() => setError(null)} className="ml-2 hover:underline">{t('phist.dismiss')}</button>
        </div>
      )}
    </div>
  );
}
