import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Undo2, MessageSquare } from 'lucide-react';
import { executeQuery, deleteInventoryLog, updateInventoryLogNotes } from '../../lib/db';
import { useI18n } from '../../lib/language';

interface UsedEntry {
  id: number;
  product_name: string;
  sku: string | null;
  category_name: string;
  batch_number: string | null;
  quantity: number;
  notes: string | null;
  created_at: string;
}

export default function UseHistory({ refreshKey }: { refreshKey?: number }) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<UsedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState<number | null>(null);
  const [notesValue, setNotesValue] = useState('');

  const fetchData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const result = await executeQuery(`
        SELECT
          il.id,
          p.name AS product_name,
          p.sku,
          COALESCE(c.name, 'Uncategorized') AS category_name,
          b.batch_number,
          il.quantity_change,
          il.notes,
          il.created_at
        FROM inventory_logs il
        JOIN batches b ON il.batch_id = b.id
        JOIN products p ON b.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE il.transaction_type = 'USAGE'
        ORDER BY il.created_at DESC
      `);

      setEntries(result.rows.map((r) => ({
        id: r[0] as number,
        product_name: r[1] as string,
        sku: r[2] as string | null,
        category_name: r[3] as string,
        batch_number: r[4] as string | null,
        quantity: r[5] as number,
        notes: r[6] as string | null,
        created_at: r[7] as string,
      })));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) fetchData(true);
  }, [refreshKey, fetchData]);

  const handleUndo = async (logId: number) => {
    if (!confirm(t('used.confirmUndo'))) return;
    try {
      await deleteInventoryLog(logId);
      await fetchData();
    } catch (err) {
      setError(String(err));
    }
  };

  const startEditNotes = (id: number, currentNotes: string | null) => {
    setEditingNotes(id);
    setNotesValue(currentNotes || '');
  };

  const saveNotes = async (id: number) => {
    try {
      await updateInventoryLogNotes(id, notesValue.trim() || null);
      setEditingNotes(null);
      await fetchData();
    } catch (err) {
      setError(String(err));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary">
        <RefreshCw size={20} className="animate-spin mr-2" />
        {t('used.loading')}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border bg-bg-secondary flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-bold text-text-primary">{t('used.title')}</h2>
          <p className="text-xs text-text-secondary mt-0.5">
            {t('used.subtitle', { count: entries.length })}
          </p>
        </div>
        <button onClick={() => fetchData()} className="p-2 text-text-secondary hover:text-text-primary transition-colors">
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-secondary text-sm">
            {t('used.empty')}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-bg-secondary border-b border-border">
              <tr>
                <th className="text-left px-4 py-2.5 text-text-secondary font-semibold">{t('used.col.date')}</th>
                <th className="text-left px-4 py-2.5 text-text-secondary font-semibold">{t('used.col.product')}</th>
                <th className="text-left px-4 py-2.5 text-text-secondary font-semibold">{t('used.col.batch')}</th>
                <th className="text-right px-4 py-2.5 text-text-secondary font-semibold">{t('used.col.qty')}</th>
                <th className="text-left px-4 py-2.5 text-text-secondary font-semibold">{t('used.col.notes')}</th>
                <th className="text-center px-4 py-2.5 text-text-secondary font-semibold">{t('used.col.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-bg-hover transition-colors">
                  <td className="px-4 py-2.5 text-text-secondary whitespace-nowrap">
                    {entry.created_at?.replace('T', ' ').slice(0, 16)}
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="text-text-primary font-medium">{entry.product_name}</p>
                    <p className="text-[10px] text-text-secondary">{entry.category_name}{entry.sku ? ` · ${entry.sku}` : ''}</p>
                  </td>
                  <td className="px-4 py-2.5 text-text-secondary font-mono">{entry.batch_number || '-'}</td>
                  <td className="px-4 py-2.5 text-error text-right font-bold">{entry.quantity}</td>
                  <td className="px-4 py-2.5">
                    {editingNotes === entry.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          value={notesValue}
                          onChange={(e) => setNotesValue(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && saveNotes(entry.id)}
                          className="flex-1 px-2 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
                          autoFocus
                        />
                        <button onClick={() => saveNotes(entry.id)} className="text-accent hover:text-accent-hover text-[10px]">{t('common.save')}</button>
                        <button onClick={() => setEditingNotes(null)} className="text-text-secondary hover:text-text-primary text-[10px]">{t('common.cancel')}</button>
                      </div>
                    ) : (
                      <span
                        onClick={() => startEditNotes(entry.id, entry.notes)}
                        className="cursor-pointer hover:text-text-primary transition-colors"
                        title={t('used.clickToEdit')}
                      >
                        {entry.notes || <span className="text-text-secondary/50 italic">{t('used.addNote')}</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => startEditNotes(entry.id, entry.notes)}
                        className="p-1.5 rounded hover:bg-bg-tertiary text-text-secondary hover:text-accent transition-colors"
                        title={t('used.editNotes')}
                      >
                        <MessageSquare size={12} />
                      </button>
                      <button
                        onClick={() => handleUndo(entry.id)}
                        className="p-1.5 rounded hover:bg-warning/10 text-text-secondary hover:text-warning transition-colors"
                        title={t('used.undoUsage')}
                      >
                        <Undo2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {error && (
        <div className="fixed bottom-4 right-4 bg-error/10 border border-error/20 text-error px-4 py-2 rounded-lg text-xs shadow-lg z-50">
          {error}
          <button onClick={() => setError(null)} className="ml-2 hover:underline">{t('common.dismiss')}</button>
        </div>
      )}
    </div>
  );
}
