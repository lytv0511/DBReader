import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Plus, Pencil, Trash2, X, Save, ArrowRight } from 'lucide-react';
import { executeQuery, updateBatchStatus } from '../../lib/db';
import { todayLocalISO, stampForDate } from '../../lib/dates';
import { useI18n } from '../../lib/language';

interface Batch {
  id: number;
  product_id: number;
  product_name: string;
  batch_number: string | null;
  supplier_name: string | null;
  unit_cost_price: number;
  purchase_date: string;
  status: string;
  notes: string | null;
}

interface Product {
  id: number;
  name: string;
  sku: string | null;
}

interface Provider {
  id: number;
  name: string;
  sub_name: string | null;
}

const STATUSES = ['ordered', 'shipping', 'arrived', 'in_inventory', 'used', 'reserved'] as const;

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  ordered: { bg: 'bg-blue-500/10 border-blue-500/20', text: 'text-blue-400', dot: 'bg-blue-400' },
  shipping: { bg: 'bg-purple-500/10 border-purple-500/20', text: 'text-purple-400', dot: 'bg-purple-400' },
  arrived: { bg: 'bg-cyan-500/10 border-cyan-500/20', text: 'text-cyan-400', dot: 'bg-cyan-400' },
  in_inventory: { bg: 'bg-success/10 border-success/20', text: 'text-success', dot: 'bg-success' },
  used: { bg: 'bg-warning/10 border-warning/20', text: 'text-warning', dot: 'bg-warning' },
  reserved: { bg: 'bg-accent/10 border-accent/20', text: 'text-accent', dot: 'bg-accent' },
};

export default function BatchManager() {
  const { t } = useI18n();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingBatch, setEditingBatch] = useState<Batch | null>(null);
  const [showLogModal, setShowLogModal] = useState(false);
  const [logBatchId, setLogBatchId] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('');

  // Batch form
  const [formProductId, setFormProductId] = useState<number | ''>('');
  const [formBatchNumber, setFormBatchNumber] = useState('');
  const [formSupplier, setFormSupplier] = useState('');
  const [formCostPrice, setFormCostPrice] = useState('');
  const [formPurchaseDate, setFormPurchaseDate] = useState(todayLocalISO());
  const [formNotes, setFormNotes] = useState('');

  // Log form
  const [logFormProviderId, setLogFormProviderId] = useState<number | ''>('');
  const [logFormQty, setLogFormQty] = useState('');
  const [logFormType, setLogFormType] = useState('PURCHASE');
  const [logFormNotes, setLogFormNotes] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [batchesResult, productsResult, providersResult] = await Promise.all([
        executeQuery(`
          SELECT b.id, b.product_id, p.name AS product_name, b.batch_number, b.supplier_name,
                 b.unit_cost_price, b.purchase_date, COALESCE(b.status, 'in_inventory') AS status, b.notes
          FROM batches b
          JOIN products p ON b.product_id = p.id
          ORDER BY b.purchase_date DESC
        `),
        executeQuery('SELECT id, name, sku FROM products ORDER BY name'),
        executeQuery('SELECT id, name, sub_name FROM providers ORDER BY name, sub_name'),
      ]);

      setBatches(batchesResult.rows.map((r) => ({
        id: r[0] as number,
        product_id: r[1] as number,
        product_name: r[2] as string,
        batch_number: r[3] as string | null,
        supplier_name: r[4] as string | null,
        unit_cost_price: r[5] as number,
        purchase_date: r[6] as string,
        status: r[7] as string || 'in_inventory',
        notes: r[8] as string | null,
      })));

      setProducts(productsResult.rows.map((r) => ({
        id: r[0] as number,
        name: r[1] as string,
        sku: r[2] as string | null,
      })));

      setProviders(providersResult.rows.map((r) => ({
        id: r[0] as number,
        name: r[1] as string,
        sub_name: r[2] as string | null,
      })));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openNewBatch = () => {
    setEditingBatch(null);
    setFormProductId('');
    setFormBatchNumber('');
    setFormSupplier('');
    setFormCostPrice('');
    setFormPurchaseDate(todayLocalISO());
    setFormNotes('');
    setShowModal(true);
  };

  const openEditBatch = (b: Batch) => {
    setEditingBatch(b);
    setFormProductId(b.product_id);
    setFormBatchNumber(b.batch_number || '');
    setFormSupplier(b.supplier_name || '');
    setFormCostPrice(String(b.unit_cost_price));
    setFormPurchaseDate(b.purchase_date?.slice(0, 10) || todayLocalISO());
    setFormNotes(b.notes || '');
    setShowModal(true);
  };

  const saveBatch = async () => {
    if (formProductId === '' || !formCostPrice) return;
    try {
      const batchNum = formBatchNumber ? `'${formBatchNumber.replace(/'/g, "''")}'` : 'NULL';
      const supplier = formSupplier ? `'${formSupplier.replace(/'/g, "''")}'` : 'NULL';
      const notes = formNotes ? `'${formNotes.replace(/'/g, "''")}'` : 'NULL';

      if (editingBatch) {
        await executeQuery(`UPDATE batches SET product_id = ${formProductId}, batch_number = ${batchNum}, supplier_name = ${supplier}, unit_cost_price = ${Number(formCostPrice)}, purchase_date = '${formPurchaseDate}', notes = ${notes} WHERE id = ${editingBatch.id}`);
        await executeQuery(`
          UPDATE inventory_logs
          SET created_at = CASE
            WHEN length(created_at) > 10 THEN '${formPurchaseDate}' || substr(created_at, 11)
            ELSE '${formPurchaseDate}'
          END
          WHERE batch_id = ${editingBatch.id}
        `);
      } else {
        await executeQuery(`INSERT INTO batches (product_id, batch_number, supplier_name, unit_cost_price, purchase_date, notes) VALUES (${formProductId}, ${batchNum}, ${supplier}, ${Number(formCostPrice)}, '${formPurchaseDate}', ${notes})`);
        const newBatch = await executeQuery(`SELECT last_insert_rowid()`);
        await executeQuery(`
          UPDATE inventory_logs
          SET created_at = '${formPurchaseDate}' || substr(created_at, 11)
          WHERE batch_id = ${newBatch.rows[0][0] as number}
        `);
      }
      setShowModal(false);
      await fetchData();
    } catch (err) {
      setError(String(err));
    }
  };

  const deleteBatch = async (id: number) => {
    if (!confirm(t('batch.confirmDelete'))) return;
    try {
      await executeQuery(`DELETE FROM inventory_logs WHERE batch_id = ${id}`);
      await executeQuery(`DELETE FROM batches WHERE id = ${id}`);
      await fetchData();
    } catch (err) {
      setError(String(err));
    }
  };

  const handleStatusChange = async (batchId: number, newStatus: string) => {
    try {
      await updateBatchStatus(batchId, newStatus);
      await fetchData();
    } catch (err) {
      setError(String(err));
    }
  };

  const openAddLog = (batchId: number) => {
    setLogBatchId(batchId);
    setLogFormProviderId('');
    setLogFormQty('');
    setLogFormType('USAGE');
    setLogFormNotes('');
    setShowLogModal(true);
  };

  const saveLog = async () => {
    if (!logBatchId || !logFormQty) return;
    try {
      const qty = logFormType === 'USAGE' || logFormType === 'SPOILAGE'
        ? -Math.abs(Number(logFormQty))
        : Number(logFormQty);
      const provVal = logFormProviderId === '' ? 'NULL' : String(logFormProviderId);
      const notes = logFormNotes ? `'${logFormNotes.replace(/'/g, "''")}'` : 'NULL';
      const batchInfo = await executeQuery(`SELECT purchase_date FROM batches WHERE id = ${logBatchId}`);
      const stamp = stampForDate(batchInfo.rows[0][0] as string);
      await executeQuery(`INSERT INTO inventory_logs (batch_id, provider_id, quantity_change, transaction_type, notes, created_at) VALUES (${logBatchId}, ${provVal}, ${qty}, '${logFormType}', ${notes}, '${stamp}')`);
      setShowLogModal(false);
    } catch (err) {
      setError(String(err));
    }
  };

  const filtered = filterStatus
    ? batches.filter((b) => b.status === filterStatus)
    : batches;

  const statusCounts = STATUSES.reduce((acc, s) => {
    acc[s] = batches.filter((b) => b.status === s).length;
    return acc;
  }, {} as Record<string, number>);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary">
        <RefreshCw size={20} className="animate-spin mr-2" />
        {t('batch.loading')}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Status filter bar */}
      <div className="px-6 py-3 border-b border-border bg-bg-secondary shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => setFilterStatus('')}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              !filterStatus ? 'bg-accent text-white border-accent' : 'bg-bg-primary border-border text-text-secondary hover:border-accent/50'
            }`}
          >
            {t('batch.all', { count: batches.length })}
          </button>
          {STATUSES.map((s) => {
            const st = STATUS_STYLES[s];
            return (
              <button
                key={s}
                onClick={() => setFilterStatus(filterStatus === s ? '' : s)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  filterStatus === s ? `${st.bg} ${st.text} border-current` : 'bg-bg-primary border-border text-text-secondary hover:border-accent/50'
                }`}
              >
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${st.dot} mr-1.5`} />
                {t(`common.status.${s}`)} ({statusCounts[s] || 0})
              </button>
            );
          })}
        </div>
        {/* Lifecycle visualization */}
        <div className="flex items-center gap-1 text-[10px] text-text-secondary">
          {STATUSES.map((s, i) => (
            <span key={s} className="flex items-center gap-1">
              <span className={`px-1.5 py-0.5 rounded ${STATUS_STYLES[s].bg} ${STATUS_STYLES[s].text} font-medium`}>
                {t(`common.status.${s}`)}
              </span>
              {i < STATUSES.length - 1 && <ArrowRight size={8} className="text-text-secondary/30" />}
            </span>
          ))}
        </div>
      </div>

      {/* Header */}
      <div className="px-6 py-3 border-b border-border flex items-center justify-between shrink-0">
        <h2 className="text-lg font-bold text-text-primary">{t('batch.title')}</h2>
        <button onClick={openNewBatch} className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover rounded-md text-xs text-white transition-colors">
          <Plus size={12} /> {t('batch.newBatch')}
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-bg-secondary border-b border-border">
            <tr>
              <th className="text-left px-4 py-2.5 text-text-secondary font-semibold">{t('batch.col.batch')}</th>
              <th className="text-left px-4 py-2.5 text-text-secondary font-semibold">{t('batch.col.product')}</th>
              <th className="text-left px-4 py-2.5 text-text-secondary font-semibold">{t('batch.col.supplier')}</th>
              <th className="text-right px-4 py-2.5 text-text-secondary font-semibold">{t('batch.col.unitCost')}</th>
              <th className="text-left px-4 py-2.5 text-text-secondary font-semibold">{t('batch.col.date')}</th>
              <th className="text-center px-4 py-2.5 text-text-secondary font-semibold">{t('batch.col.status')}</th>
              <th className="text-center px-4 py-2.5 text-text-secondary font-semibold">{t('batch.col.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((b) => {
              const st = STATUS_STYLES[b.status] || STATUS_STYLES.in_inventory;
              return (
                <tr key={b.id} className="hover:bg-bg-hover transition-colors">
                  <td className="px-4 py-2.5 text-text-primary font-mono">{b.batch_number || '-'}</td>
                  <td className="px-4 py-2.5 text-text-primary">{b.product_name}</td>
                  <td className="px-4 py-2.5 text-text-secondary">{b.supplier_name || '-'}</td>
                  <td className="px-4 py-2.5 text-text-primary text-right font-mono">${Number(b.unit_cost_price).toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-text-secondary">{b.purchase_date?.slice(0, 10)}</td>
                  <td className="px-4 py-2.5 text-center">
                    <select
                      value={b.status}
                      onChange={(e) => handleStatusChange(b.id, e.target.value)}
                      className={`px-2 py-1 rounded-md border text-[10px] font-semibold ${st.bg} ${st.text} focus:outline-none cursor-pointer`}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{t(`common.status.${s}`)}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => openAddLog(b.id)} className="p-1 rounded hover:bg-bg-tertiary text-text-secondary hover:text-accent transition-colors" title={t('batch.logTx')}>
                        <Plus size={10} />
                      </button>
                      <button onClick={() => openEditBatch(b)} className="p-1 rounded hover:bg-bg-tertiary text-text-secondary hover:text-text-primary transition-colors" title={t('common.edit')}>
                        <Pencil size={10} />
                      </button>
                      <button onClick={() => deleteBatch(b.id)} className="p-1 rounded hover:bg-bg-tertiary text-text-secondary hover:text-error transition-colors" title={t('common.delete')}>
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="p-6 text-center text-text-secondary text-xs">
            {filterStatus ? t('batch.noBatchesStatus', { status: t(`common.status.${filterStatus}`) }) : t('batch.noBatches')}
          </div>
        )}
      </div>

      {/* Batch Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
          <div className="bg-bg-secondary border border-border rounded-lg p-5 w-[420px] shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-text-primary">{editingBatch ? t('batch.editBatch') : t('batch.newBatch')}</h3>
              <button onClick={() => setShowModal(false)} className="text-text-secondary hover:text-text-primary"><X size={14} /></button>
            </div>
            <div className="space-y-3">
              <select value={formProductId} onChange={(e) => setFormProductId(e.target.value === '' ? '' : Number(e.target.value))} className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary focus:outline-none focus:border-accent">
                <option value="">{t('batch.ph.selectProduct')}</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ''}</option>)}
              </select>
              <input value={formBatchNumber} onChange={(e) => setFormBatchNumber(e.target.value)} placeholder={t('batch.ph.batchNumber')} className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
              <input value={formSupplier} onChange={(e) => setFormSupplier(e.target.value)} placeholder={t('batch.ph.supplier')} className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
              <div className="grid grid-cols-2 gap-3">
                <input value={formCostPrice} onChange={(e) => setFormCostPrice(e.target.value)} type="number" step="0.01" placeholder={t('batch.ph.unitCost')} className="px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
                <input value={formPurchaseDate} onChange={(e) => setFormPurchaseDate(e.target.value)} type="date" className="px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary focus:outline-none focus:border-accent" />
              </div>
              <textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} placeholder={t('batch.ph.notes')} rows={2} className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent resize-none" />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowModal(false)} className="px-3 py-1.5 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-xs text-text-secondary transition-colors">{t('common.cancel')}</button>
              <button onClick={saveBatch} className="flex items-center gap-1 px-3 py-1.5 bg-accent hover:bg-accent-hover rounded-md text-xs text-white transition-colors">
                <Save size={10} /> {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Log Modal */}
      {showLogModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowLogModal(false)}>
          <div className="bg-bg-secondary border border-border rounded-lg p-5 w-[380px] shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-text-primary">{t('batch.recordTx')}</h3>
              <button onClick={() => setShowLogModal(false)} className="text-text-secondary hover:text-text-primary"><X size={14} /></button>
            </div>
            <div className="space-y-3">
              <select value={logFormType} onChange={(e) => setLogFormType(e.target.value)} className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary focus:outline-none focus:border-accent">
                <option value="PURCHASE">{t('batch.txPURCHASE')}</option>
                <option value="USAGE">{t('batch.txUSAGE')}</option>
                <option value="SPOILAGE">{t('batch.txSPOILAGE')}</option>
                <option value="ADJUSTMENT">{t('batch.txADJUSTMENT')}</option>
              </select>
              <input value={logFormQty} onChange={(e) => setLogFormQty(e.target.value)} type="number" placeholder={t('batch.ph.qty')} className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent" />
              <select value={logFormProviderId} onChange={(e) => setLogFormProviderId(e.target.value === '' ? '' : Number(e.target.value))} className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary focus:outline-none focus:border-accent">
                <option value="">{t('batch.ph.provider')}</option>
                {providers.map((l) => <option key={l.id} value={l.id}>{l.name}{l.sub_name ? ` - ${l.sub_name}` : ''}</option>)}
              </select>
              <textarea value={logFormNotes} onChange={(e) => setLogFormNotes(e.target.value)} placeholder={t('batch.ph.notes')} rows={2} className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent resize-none" />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowLogModal(false)} className="px-3 py-1.5 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-xs text-text-secondary transition-colors">{t('common.cancel')}</button>
              <button onClick={saveLog} className="flex items-center gap-1 px-3 py-1.5 bg-accent hover:bg-accent-hover rounded-md text-xs text-white transition-colors">
                <Save size={10} /> {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="fixed bottom-4 right-4 bg-error/10 border border-error/20 text-error px-4 py-2 rounded-lg text-xs shadow-lg z-50">
          {error}
          <button onClick={() => setError(null)} className="ml-2 hover:underline">{t('common.dismiss')}</button>
        </div>
      )}
    </div>
  );
}
