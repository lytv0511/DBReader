import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Filter, X } from 'lucide-react';
import { executeQuery } from '../../lib/db';
import { useI18n } from '../../lib/language';

interface TxEntry {
  id: number;
  product_name: string;
  product_sku: string | null;
  category_name: string;
  batch_number: string | null;
  storage_name: string | null;
  storage_sub: string | null;
  transaction_type: string;
  quantity_change: number;
  notes: string | null;
  log_date: string | null;
  created_at: string;
}

type Period = 'all' | 'week' | 'month' | 'year' | 'custom';

const PERIODS: Period[] = ['all', 'week', 'month', 'year', 'custom'];

const ACTIONS = ['PURCHASE', 'USAGE', 'SPOILAGE', 'ADJUSTMENT'];

export default function TransactionHistory() {
  const { t } = useI18n();
  const [entries, setEntries] = useState<TxEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filterStorage, setFilterStorage] = useState('');
  const [filterSku, setFilterSku] = useState('');
  const [filterProduct, setFilterProduct] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterAction, setFilterAction] = useState('');

  const buildDateWhere = (p: Period, from: string, to: string): string => {
    const d = `COALESCE(il.log_date, date(il.created_at))`;
    switch (p) {
      case 'week':
        return `${d} >= date('now', '-7 days')`;
      case 'month':
        return `${d} >= date('now', 'start of month')`;
      case 'year':
        return `${d} >= date('now', 'start of year')`;
      case 'custom': {
        const parts: string[] = [];
        if (from) parts.push(`${d} >= '${from}'`);
        if (to) parts.push(`${d} <= '${to}'`);
        return parts.join(' AND ');
      }
      default:
        return '';
    }
  };

  const esc = (v: string) => v.replace(/'/g, "''");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const parts: string[] = [];
      const dateWhere = buildDateWhere(period, fromDate, toDate);
      if (dateWhere) parts.push(dateWhere);
      if (filterStorage) {
        parts.push(`(pr.name LIKE '%${esc(filterStorage)}%' OR COALESCE(pr.sub_name, '') LIKE '%${esc(filterStorage)}%')`);
      }
      if (filterSku) parts.push(`p.sku LIKE '%${esc(filterSku)}%'`);
      if (filterProduct) parts.push(`p.name LIKE '%${esc(filterProduct)}%'`);
      if (filterCategory) parts.push(`c.name LIKE '%${esc(filterCategory)}%'`);
      if (filterAction) parts.push(`il.transaction_type = '${esc(filterAction)}'`);
      const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';

      const result = await executeQuery(`
        SELECT
          il.id,
          p.name AS product_name,
          p.sku AS product_sku,
          COALESCE(c.name, 'Uncategorized') AS category_name,
          b.batch_number,
          pr.name AS provider_name,
          pr.sub_name,
          il.transaction_type,
          il.quantity_change,
          il.notes,
          il.log_date,
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
        product_sku: r[2] as string | null,
        category_name: r[3] as string,
        batch_number: r[4] as string | null,
        storage_name: r[5] as string | null,
        storage_sub: r[6] as string | null,
        transaction_type: r[7] as string,
        quantity_change: r[8] as number,
        notes: r[9] as string | null,
        log_date: r[10] as string | null,
        created_at: r[11] as string,
      })));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [period, fromDate, toDate, filterStorage, filterSku, filterProduct, filterCategory, filterAction]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const hasCustomRange = fromDate !== '' || toDate !== '';
  const hasFilters = filterStorage !== '' || filterSku !== '' || filterProduct !== '' || filterCategory !== '' || filterAction !== '';

  const clearFilters = () => {
    setFilterStorage('');
    setFilterSku('');
    setFilterProduct('');
    setFilterCategory('');
    setFilterAction('');
  };

  const txColor: Record<string, string> = {
    PURCHASE: 'text-success',
    USAGE: 'text-warning',
    SPOILAGE: 'text-error',
    ADJUSTMENT: 'text-accent',
  };

  const txBg: Record<string, string> = {
    PURCHASE: 'bg-success/10 border-success/20',
    USAGE: 'bg-warning/10 border-warning/20',
    SPOILAGE: 'bg-error/10 border-error/20',
    ADJUSTMENT: 'bg-accent/10 border-accent/20',
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-bg-secondary flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-text-primary">{t('txhist.title')}</h2>
          <span className="text-xs text-text-secondary">{t('txhist.count', { count: entries.length })}</span>
        </div>
        <div className="flex items-center gap-2">
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 px-2 py-1 bg-error/10 hover:bg-error/20 border border-error/20 rounded-md text-[10px] text-error transition-colors"
            >
              <X size={10} /> {t('logs.clearFilters')}
            </button>
          )}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-md text-xs transition-colors ${
              showFilters ? 'bg-accent text-white border-accent' : 'bg-bg-tertiary hover:bg-bg-hover border-border text-text-secondary'
            }`}
          >
            <Filter size={12} />
            {t('logs.filters')}
          </button>
          <button
            onClick={fetchData}
            className="p-2 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-text-secondary transition-colors"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* Period bar */}
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

      {/* Filter bar */}
      {showFilters && (
        <div className="px-6 py-3 border-b border-border bg-bg-secondary flex items-center gap-4 flex-wrap shrink-0">
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-secondary">{t('txhist.col.storage')}:</label>
            <input
              value={filterStorage}
              onChange={(e) => setFilterStorage(e.target.value)}
              placeholder={t('txhist.col.storage')}
              className="px-2 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent w-[140px]"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-secondary">{t('txhist.col.sku')}:</label>
            <input
              value={filterSku}
              onChange={(e) => setFilterSku(e.target.value)}
              placeholder={t('txhist.col.sku')}
              className="px-2 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent w-[120px]"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-secondary">{t('txhist.col.product')}:</label>
            <input
              value={filterProduct}
              onChange={(e) => setFilterProduct(e.target.value)}
              placeholder={t('logs.searchPlaceholder')}
              className="px-2 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent w-[180px]"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-secondary">{t('txhist.col.category')}:</label>
            <input
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              placeholder={t('txhist.col.category')}
              className="px-2 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent w-[140px]"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-secondary">{t('txhist.col.type')}:</label>
            <select
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
              className="px-2 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
            >
              <option value="">{t('logs.all')}</option>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>{t(`logs.typeName.${a}`)}</option>
              ))}
            </select>
          </div>
        </div>
      )}

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
                <th className="text-left px-4 py-2.5 text-text-secondary font-semibold">{t('txhist.col.storage')}</th>
                <th className="text-left px-4 py-2.5 text-text-secondary font-semibold">{t('txhist.col.batch')}</th>
                <th className="text-left px-4 py-2.5 text-text-secondary font-semibold">{t('txhist.col.sku')}</th>
                <th className="text-left px-4 py-2.5 text-text-secondary font-semibold">{t('txhist.col.product')}</th>
                <th className="text-left px-4 py-2.5 text-text-secondary font-semibold">{t('txhist.col.category')}</th>
                <th className="text-left px-4 py-2.5 text-text-secondary font-semibold">{t('txhist.col.type')}</th>
                <th className="text-left px-4 py-2.5 text-text-secondary font-semibold">{t('txhist.col.notes')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-bg-hover transition-colors">
                  <td className="px-4 py-2.5 text-text-secondary whitespace-nowrap">{entry.log_date || entry.created_at?.slice(0, 10)}</td>
                  <td className="px-4 py-2.5 text-text-secondary">
                    {entry.storage_name
                      ? `${entry.storage_name}${entry.storage_sub ? ` - ${entry.storage_sub}` : ''}`
                      : '-'}
                  </td>
                  <td className="px-4 py-2.5 text-text-secondary font-mono">{entry.batch_number || '-'}</td>
                  <td className="px-4 py-2.5 text-text-secondary font-mono">{entry.product_sku || '-'}</td>
                  <td className="px-4 py-2.5 text-text-primary font-medium">{entry.product_name}</td>
                  <td className="px-4 py-2.5 text-text-secondary">{entry.category_name}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block px-2 py-0.5 rounded border text-[10px] font-semibold ${txBg[entry.transaction_type]} ${txColor[entry.transaction_type]}`}>
                      {t(`logs.typeName.${entry.transaction_type}`)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-text-secondary truncate max-w-[240px]">
                    <span className={`font-bold mr-1 ${entry.quantity_change > 0 ? 'text-success' : entry.quantity_change < 0 ? 'text-error' : ''}`}>
                      {entry.quantity_change !== 0 ? `${entry.quantity_change > 0 ? '+' : ''}${entry.quantity_change} ` : ''}
                    </span>
                    {entry.notes || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
