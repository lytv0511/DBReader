import { useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { executeQuery } from '../../lib/db';
import { useI18n } from '../../lib/language';

interface TxEntry {
  id: number;
  product_name: string;
  category_name: string;
  provider_name: string | null;
  notes: string | null;
  created_at: string;
}

type Period = 'all' | 'week' | 'month' | 'year' | 'custom';

const PERIODS: Period[] = ['all', 'week', 'month', 'year', 'custom'];

export default function TransactionHistory() {
  const { t } = useI18n();
  const [entries, setEntries] = useState<TxEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const buildDateWhere = (p: Period, from: string, to: string): string => {
    switch (p) {
      case 'week':
        return `date(il.created_at) >= date('now', '-7 days')`;
      case 'month':
        return `date(il.created_at) >= date('now', 'start of month')`;
      case 'year':
        return `date(il.created_at) >= date('now', 'start of year')`;
      case 'custom': {
        const parts: string[] = [];
        if (from) parts.push(`date(il.created_at) >= '${from}'`);
        if (to) parts.push(`date(il.created_at) <= '${to}'`);
        return parts.join(' AND ');
      }
      default:
        return '';
    }
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dateWhere = buildDateWhere(period, fromDate, toDate);
      const where = dateWhere ? `WHERE ${dateWhere}` : '';
      const result = await executeQuery(`
        SELECT
          il.id,
          p.name AS product_name,
          COALESCE(c.name, 'Uncategorized') AS category_name,
          pr.name AS provider_name,
          il.notes,
          il.created_at
        FROM inventory_logs il
        JOIN batches b ON il.batch_id = b.id
        JOIN products p ON b.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN providers pr ON il.provider_id = pr.id
        ${where}
        ORDER BY il.created_at DESC
      `);

      setEntries(result.rows.map((r) => ({
        id: r[0] as number,
        product_name: r[1] as string,
        category_name: r[2] as string,
        provider_name: r[3] as string | null,
        notes: r[4] as string | null,
        created_at: r[5] as string,
      })));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [period, fromDate, toDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const hasCustomRange = fromDate !== '' || toDate !== '';

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-bg-secondary flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-text-primary">{t('txhist.title')}</h2>
          <span className="text-xs text-text-secondary">{t('txhist.count', { count: entries.length })}</span>
        </div>
        <button
          onClick={fetchData}
          className="p-2 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-text-secondary transition-colors"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Filter bar */}
      <div className="px-6 py-3 border-b border-border bg-bg-secondary flex items-center gap-2 flex-wrap shrink-0">
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(period === p ? 'all' : p)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              period === p
                ? 'bg-accent text-white border-accent'
                : 'bg-bg-primary border-border text-text-secondary hover:border-accent/50'
            }`}
          >
            {t(`txhist.${p}`)}
          </button>
        ))}
        {period === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <label className="text-xs text-text-secondary">{t('txhist.from')}</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="px-2 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
            />
            <label className="text-xs text-text-secondary">{t('txhist.to')}</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="px-2 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
            />
            {hasCustomRange && (
              <button
                onClick={() => { setFromDate(''); setToDate(''); }}
                className="px-2 py-1 bg-error/10 hover:bg-error/20 border border-error/20 rounded text-[10px] text-error transition-colors"
              >
                {t('txhist.clear')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-text-secondary">
            <RefreshCw size={20} className="animate-spin mr-2" />
            {t('txhist.loading')}
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-error">{error}</div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-secondary text-sm">
            {t('txhist.empty')}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-bg-secondary border-b border-border">
              <tr>
                <th className="text-left px-4 py-2.5 text-text-secondary font-semibold">{t('txhist.col.date')}</th>
                <th className="text-left px-4 py-2.5 text-text-secondary font-semibold">{t('txhist.col.time')}</th>
                <th className="text-left px-4 py-2.5 text-text-secondary font-semibold">{t('txhist.col.product')}</th>
                <th className="text-left px-4 py-2.5 text-text-secondary font-semibold">{t('txhist.col.category')}</th>
                <th className="text-left px-4 py-2.5 text-text-secondary font-semibold">{t('txhist.col.provider')}</th>
                <th className="text-left px-4 py-2.5 text-text-secondary font-semibold">{t('txhist.col.notes')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-bg-hover transition-colors">
                  <td className="px-4 py-2.5 text-text-secondary whitespace-nowrap">{entry.created_at?.slice(0, 10)}</td>
                  <td className="px-4 py-2.5 text-text-secondary whitespace-nowrap font-mono">{entry.created_at?.slice(11, 16)}</td>
                  <td className="px-4 py-2.5 text-text-primary font-medium">{entry.product_name}</td>
                  <td className="px-4 py-2.5 text-text-secondary">{entry.category_name}</td>
                  <td className="px-4 py-2.5 text-text-secondary">{entry.provider_name || '-'}</td>
                  <td className="px-4 py-2.5 text-text-secondary truncate max-w-[300px]">{entry.notes || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
