import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Filter, X } from 'lucide-react';
import { executeQuery } from '../../lib/db';
import { useI18n } from '../../lib/language';

interface LogEntry {
  id: number;
  product_name: string;
  batch_number: string | null;
  quantity_change: number;
  transaction_type: string;
  provider_name: string | null;
  provider_sub: string | null;
  notes: string | null;
  created_at: string;
}

export default function InventoryLog() {
  const { t } = useI18n();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string>('');
  const [filterProduct, setFilterProduct] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let where = 'WHERE 1=1';
      if (filterType) where += ` AND il.transaction_type = '${filterType}'`;
      if (filterProduct) where += ` AND p.name LIKE '%${filterProduct.replace(/'/g, "''")}%'`;

      const result = await executeQuery(`
        SELECT
          il.id,
          p.name AS product_name,
          b.batch_number,
          il.quantity_change,
          il.transaction_type,
          pr.name AS provider_name,
          pr.sub_name,
          il.notes,
          il.created_at
        FROM inventory_logs il
        JOIN batches b ON il.batch_id = b.id
        JOIN products p ON b.product_id = p.id
        LEFT JOIN providers pr ON il.provider_id = pr.id
        ${where}
        ORDER BY il.created_at DESC
        LIMIT 200
      `);

      setLogs(result.rows.map((r) => ({
        id: r[0] as number,
        product_name: r[1] as string,
        batch_number: r[2] as string | null,
        quantity_change: r[3] as number,
        transaction_type: r[4] as string,
        provider_name: r[5] as string | null,
        provider_sub: r[6] as string | null,
        notes: r[7] as string | null,
        created_at: r[8] as string,
      })));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [filterType, filterProduct]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

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

  const hasFilters = filterType || filterProduct;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-bg-secondary flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-text-primary">{t('logs.title')}</h2>
          <span className="text-xs text-text-secondary">{t('logs.entryCount', { count: logs.length })}</span>
        </div>
        <div className="flex items-center gap-2">
          {hasFilters && (
            <button
              onClick={() => { setFilterType(''); setFilterProduct(''); }}
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
            onClick={fetchLogs}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-xs text-text-secondary transition-colors"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* Filter bar */}
      {showFilters && (
        <div className="px-6 py-3 border-b border-border bg-bg-secondary flex items-center gap-4 shrink-0">
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-secondary">{t('logs.type')}</label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-2 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
            >
              <option value="">{t('logs.all')}</option>
              <option value="PURCHASE">PURCHASE</option>
              <option value="USAGE">USAGE</option>
              <option value="SPOILAGE">SPOILAGE</option>
              <option value="ADJUSTMENT">ADJUSTMENT</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-secondary">{t('logs.product')}:</label>
            <input
              value={filterProduct}
              onChange={(e) => setFilterProduct(e.target.value)}
              placeholder={t('logs.searchPlaceholder')}
              className="px-2 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent w-[200px]"
            />
          </div>
        </div>
      )}

      {/* Log table */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-text-secondary">
            <RefreshCw size={20} className="animate-spin mr-2" />
            {t('logs.loading')}
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-error">{error}</div>
        ) : logs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-secondary text-sm">
            {t('logs.empty')}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-bg-secondary border-b border-border">
              <tr>
                <th className="text-left px-4 py-2.5 text-text-secondary font-semibold">{t('logs.col.date')}</th>
                <th className="text-left px-4 py-2.5 text-text-secondary font-semibold">{t('logs.col.type')}</th>
                <th className="text-left px-4 py-2.5 text-text-secondary font-semibold">{t('logs.col.product')}</th>
                <th className="text-left px-4 py-2.5 text-text-secondary font-semibold">{t('logs.col.batch')}</th>
                <th className="text-right px-4 py-2.5 text-text-secondary font-semibold">{t('logs.col.qtyChange')}</th>
                <th className="text-left px-4 py-2.5 text-text-secondary font-semibold">{t('logs.col.provider')}</th>
                <th className="text-left px-4 py-2.5 text-text-secondary font-semibold">{t('logs.col.notes')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-bg-hover transition-colors">
                  <td className="px-4 py-2.5 text-text-secondary whitespace-nowrap">{log.created_at?.replace('T', ' ').slice(0, 19)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block px-2 py-0.5 rounded border text-[10px] font-semibold ${txBg[log.transaction_type]} ${txColor[log.transaction_type]}`}>
                      {log.transaction_type}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-text-primary font-medium">{log.product_name}</td>
                  <td className="px-4 py-2.5 text-text-secondary font-mono">{log.batch_number || '-'}</td>
                  <td className={`px-4 py-2.5 text-right font-bold ${log.quantity_change >= 0 ? 'text-success' : 'text-error'}`}>
                    {log.quantity_change >= 0 ? '+' : ''}{log.quantity_change}
                  </td>
                  <td className="px-4 py-2.5 text-text-secondary">
                    {log.provider_name ? `${log.provider_name}${log.provider_sub ? ` - ${log.provider_sub}` : ''}` : '-'}
                  </td>
                  <td className="px-4 py-2.5 text-text-secondary truncate max-w-[200px]">{log.notes || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
