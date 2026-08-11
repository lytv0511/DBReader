import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Plus, Pencil, Trash2, X, Save } from 'lucide-react';
import { executeQuery } from '../../lib/db';
import { todayLocalISO, nowLocalStamp } from '../../lib/dates';
import { useI18n } from '../../lib/language';

interface Batch {
  id: number;
  product_id: number;
  product_name: string;
  batch_number: string | null;
  supplier_name: string | null;
  unit_cost_price: number;
  purchase_date: string;
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

export default function BatchManager({ currencySymbol = '$' }: { currencySymbol?: string }) {
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

  // Batch form
  const [formProductId, setFormProductId] = useState<number | ''>('');
  const [formBatchNumber, setFormBatchNumber] = useState('');
  const [formSupplier, setFormSupplier] = useState('');
  const [formCostPrice, setFormCostPrice] = useState('');
  const [formPurchaseDate, setFormPurchaseDate] = useState(todayLocalISO());
  const [formNotes, setFormNotes] = useState('');
  const [formQuantity, setFormQuantity] = useState('');

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
                 b.unit_cost_price, b.purchase_date, b.notes
          FROM batches b
          JOIN products p ON b.product_id = p.id
          WHERE b.is_removed IS NULL OR b.is_removed = 0
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
        notes: r[7] as string | null,
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
    setFormQuantity('');
    setShowModal(true);
  };

  const openEditBatch = async (b: Batch) => {
    setEditingBatch(b);
    setFormProductId(b.product_id);
    setFormBatchNumber(b.batch_number || '');
    setFormSupplier(b.supplier_name || '');
    setFormCostPrice(String(b.unit_cost_price));
    setFormPurchaseDate(b.purchase_date?.slice(0, 10) || todayLocalISO());
    setFormNotes(b.notes || '');
    try {
      const stockRes = await executeQuery(`SELECT COALESCE(SUM(quantity_change), 0) FROM inventory_logs WHERE batch_id = ${b.id}`);
      setFormQuantity(String(Number(stockRes.rows[0][0] || 0)));
    } catch {
      setFormQuantity('0');
    }
    setShowModal(true);
  };

  const saveBatch = async () => {
    if (formProductId === '' || !formCostPrice) return;
    try {
      const batchNum = formBatchNumber ? `'${formBatchNumber.replace(/'/g, "''")}'` : 'NULL';
      const supplier = formSupplier ? `'${formSupplier.replace(/'/g, "''")}'` : 'NULL';
      const notes = formNotes ? `'${formNotes.replace(/'/g, "''")}'` : 'NULL';

      if (editingBatch) {
        const oldRes = await executeQuery(`SELECT product_id, batch_number, purchase_date FROM batches WHERE id = ${editingBatch.id}`);
        const oldRow = oldRes.rows[0];
        const oldProductId = Number(oldRow[0]);
        const oldBatchNumber = (oldRow[1] as string) || '';
        const oldDate = ((oldRow[2] as string) || '').slice(0, 10);

        const stockRes = await executeQuery(`SELECT COALESCE(SUM(quantity_change), 0) FROM inventory_logs WHERE batch_id = ${editingBatch.id}`);
        const currentQty = Number(stockRes.rows[0][0] || 0);
        const newQty = formQuantity !== '' ? Number(formQuantity) : currentQty;

        const changes: string[] = [];
        let qtyDelta = 0;
        if (newQty !== currentQty) {
          changes.push(t('batch.changed.quantity'));
          qtyDelta = newQty - currentQty;
        }
        if (oldDate !== formPurchaseDate) changes.push(t('batch.changed.date'));
        if (oldProductId !== formProductId) changes.push(t('batch.changed.sku'));
        if (oldBatchNumber !== formBatchNumber) changes.push(t('batch.changed.batch'));

        await executeQuery(`UPDATE batches SET product_id = ${formProductId}, batch_number = ${batchNum}, supplier_name = ${supplier}, unit_cost_price = ${Number(formCostPrice)}, purchase_date = '${formPurchaseDate}', notes = ${notes} WHERE id = ${editingBatch.id}`);
        await executeQuery(`UPDATE inventory_logs SET log_date = '${formPurchaseDate}' WHERE batch_id = ${editingBatch.id}`);

        if (changes.length > 0) {
          const changeNote = changes.join(', ').replace(/'/g, "''");
          await executeQuery(`INSERT INTO inventory_logs (batch_id, provider_id, quantity_change, transaction_type, notes, created_at, log_date) VALUES (${editingBatch.id}, NULL, ${qtyDelta}, 'ADJUSTMENT', '${changeNote}', '${nowLocalStamp()}', '${todayLocalISO()}')`);
        }
      } else {
        await executeQuery(`INSERT INTO batches (product_id, batch_number, supplier_name, unit_cost_price, purchase_date, notes) VALUES (${formProductId}, ${batchNum}, ${supplier}, ${Number(formCostPrice)}, '${formPurchaseDate}', ${notes})`);
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
      const stockRes = await executeQuery(`SELECT COALESCE(SUM(quantity_change), 0) FROM inventory_logs WHERE batch_id = ${id}`);
      const stock = Number(stockRes.rows[0][0] || 0);
      if (stock !== 0) {
        const noteText = t('batch.removed').replace(/'/g, "''");
        await executeQuery(`INSERT INTO inventory_logs (batch_id, provider_id, quantity_change, transaction_type, notes, created_at, log_date) VALUES (${id}, NULL, ${-stock}, 'ADJUSTMENT', '${noteText}', '${nowLocalStamp()}', '${todayLocalISO()}')`);
      }
      await executeQuery(`UPDATE batches SET is_removed = 1 WHERE id = ${id}`);
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
      const logDate = ((batchInfo.rows[0][0] as string) || '').slice(0, 10);
      await executeQuery(`INSERT INTO inventory_logs (batch_id, provider_id, quantity_change, transaction_type, notes, created_at, log_date) VALUES (${logBatchId}, ${provVal}, ${qty}, '${logFormType}', ${notes}, '${nowLocalStamp()}', '${logDate}')`);
      setShowLogModal(false);
    } catch (err) {
      setError(String(err));
    }
  };

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
      {/* Header */}
      <div className="px-6 py-3 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-text-primary">{t('batch.title')}</h2>
          <span className="text-xs text-text-secondary">{t('batch.all', { count: batches.length })}</span>
        </div>
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
              <th className="text-center px-4 py-2.5 text-text-secondary font-semibold">{t('batch.col.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {batches.map((b) => (
              <tr key={b.id} className="hover:bg-bg-hover transition-colors">
                <td className="px-4 py-2.5 text-text-primary font-mono">{b.batch_number || '-'}</td>
                <td className="px-4 py-2.5 text-text-primary">{b.product_name}</td>
                <td className="px-4 py-2.5 text-text-secondary">{b.supplier_name || '-'}</td>
                <td className="px-4 py-2.5 text-text-primary text-right font-mono">{currencySymbol}{Number(b.unit_cost_price).toFixed(2)}</td>
                <td className="px-4 py-2.5 text-text-secondary">{b.purchase_date?.slice(0, 10)}</td>
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
            ))}
          </tbody>
        </table>
        {batches.length === 0 && (
          <div className="p-6 text-center text-text-secondary text-xs">
            {t('batch.noBatches')}
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
              {editingBatch && (
                <input
                  value={formQuantity}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '' || /^-?\d*\.?\d*$/.test(v)) setFormQuantity(v);
                  }}
                  type="text"
                  inputMode="decimal"
                  placeholder={t('batch.quantity')}
                  className="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
                />
              )}
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
