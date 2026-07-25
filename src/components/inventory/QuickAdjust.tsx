import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Plus, Minus, ShoppingCart, Trash2, Wrench, AlertTriangle } from 'lucide-react';
import { executeQuery } from '../../lib/db';

interface Product {
  id: number;
  name: string;
  sku: string | null;
  category_name: string;
  current_stock: number;
  reorder_threshold: number;
}

interface Location {
  id: number;
  name: string;
  sub_location: string | null;
}

interface RecentAdjustment {
  id: number;
  product_name: string;
  quantity_change: number;
  transaction_type: string;
  notes: string | null;
  created_at: string;
}

const TX_TYPES = [
  { value: 'PURCHASE', label: 'Stock In', icon: <ShoppingCart size={16} />, color: 'bg-success/10 border-success/30 text-success hover:bg-success/20', activeColor: 'bg-success/20 border-success text-success' },
  { value: 'USAGE', label: 'Usage', icon: <Minus size={16} />, color: 'bg-warning/10 border-warning/30 text-warning hover:bg-warning/20', activeColor: 'bg-warning/20 border-warning text-warning' },
  { value: 'SPOILAGE', label: 'Spoilage', icon: <Trash2 size={16} />, color: 'bg-error/10 border-error/30 text-error hover:bg-error/20', activeColor: 'bg-error/20 border-error text-error' },
  { value: 'ADJUSTMENT', label: 'Adjust', icon: <Wrench size={16} />, color: 'bg-accent/10 border-accent/30 text-accent hover:bg-accent/20', activeColor: 'bg-accent/20 border-accent text-accent' },
];

const QUICK_QTY = [1, 6, 12, 24];

export default function QuickAdjust() {
  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [recent, setRecent] = useState<RecentAdjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedProductId, setSelectedProductId] = useState<number | ''>('');
  const [txType, setTxType] = useState('PURCHASE');
  const [qty, setQty] = useState('1');
  const [locationId, setLocationId] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const selectedProduct = products.find((p) => p.id === selectedProductId);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [productsResult, locationsResult, recentResult] = await Promise.all([
        executeQuery(`
          SELECT
            p.id, p.name, p.sku,
            COALESCE(c.name, 'Uncategorized') AS category_name,
            COALESCE(SUM(il.quantity_change), 0) AS current_stock,
            p.reorder_threshold
          FROM products p
          LEFT JOIN categories c ON p.category_id = c.id
          LEFT JOIN batches b ON b.product_id = p.id
          LEFT JOIN inventory_logs il ON il.batch_id = b.id
          GROUP BY p.id, p.name, p.sku, c.name, p.reorder_threshold
          ORDER BY c.name, p.name
        `),
        executeQuery('SELECT id, name, sub_location FROM locations ORDER BY name, sub_location'),
        executeQuery(`
          SELECT il.id, p.name AS product_name, il.quantity_change, il.transaction_type, il.notes, il.created_at
          FROM inventory_logs il
          JOIN batches b ON il.batch_id = b.id
          JOIN products p ON b.product_id = p.id
          ORDER BY il.created_at DESC
          LIMIT 10
        `),
      ]);

      setProducts(productsResult.rows.map((r) => ({
        id: r[0] as number,
        name: r[1] as string,
        sku: r[2] as string | null,
        category_name: r[3] as string,
        current_stock: r[4] as number,
        reorder_threshold: r[5] as number,
      })));

      setLocations(locationsResult.rows.map((r) => ({
        id: r[0] as number,
        name: r[1] as string,
        sub_location: r[2] as string | null,
      })));

      setRecent(recentResult.rows.map((r) => ({
        id: r[0] as number,
        product_name: r[1] as string,
        quantity_change: r[2] as number,
        transaction_type: r[3] as string,
        notes: r[4] as string | null,
        created_at: r[5] as string,
      })));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSubmit = async () => {
    if (selectedProductId === '' || !qty || Number(qty) <= 0) return;
    setSubmitting(true);
    setError(null);

    try {
      // Find or create an open batch for this product
      const batchResult = await executeQuery(`
        SELECT b.id FROM batches b
        WHERE b.product_id = ${selectedProductId}
        ORDER BY b.purchase_date DESC
        LIMIT 1
      `);

      let batchId: number;

      if (batchResult.rows.length > 0) {
        batchId = batchResult.rows[0][0] as number;
      } else {
        // Auto-create a batch
        const today = new Date().toISOString().slice(0, 10);
        await executeQuery(`
          INSERT INTO batches (product_id, batch_number, supplier_name, unit_cost_price, purchase_date, notes)
          VALUES (${selectedProductId}, NULL, NULL, 0, '${today}', 'Auto-created by Quick Adjust')
        `);
        const newBatch = await executeQuery(`SELECT last_insert_rowid()`);
        batchId = newBatch.rows[0][0] as number;
      }

      const qtyNum = Number(qty);
      const adjustedQty = txType === 'USAGE' || txType === 'SPOILAGE'
        ? -Math.abs(qtyNum)
        : Math.abs(qtyNum);

      const locVal = locationId === '' ? 'NULL' : String(locationId);
      const notesVal = notes.trim() ? `'${notes.trim().replace(/'/g, "''")}'` : 'NULL';

      await executeQuery(`
        INSERT INTO inventory_logs (batch_id, location_id, quantity_change, transaction_type, notes)
        VALUES (${batchId}, ${locVal}, ${adjustedQty}, '${txType}', ${notesVal})
      `);

      // Reset form but keep product selected
      setQty('1');
      setNotes('');
      await fetchData();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const txBg: Record<string, string> = {
    PURCHASE: 'bg-success/10',
    USAGE: 'bg-warning/10',
    SPOILAGE: 'bg-error/10',
    ADJUSTMENT: 'bg-accent/10',
  };

  const txColor: Record<string, string> = {
    PURCHASE: 'text-success',
    USAGE: 'text-warning',
    SPOILAGE: 'text-error',
    ADJUSTMENT: 'text-accent',
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary">
        <RefreshCw size={20} className="animate-spin mr-2" />
        Loading inventory...
      </div>
    );
  }

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left: Adjust form */}
      <div className="w-[420px] border-r border-border bg-bg-secondary flex flex-col shrink-0 overflow-y-auto">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-base font-bold text-text-primary">Quick Adjust</h2>
          <p className="text-xs text-text-secondary mt-0.5">Add, remove, or adjust stock levels</p>
        </div>

        <div className="p-5 space-y-5">
          {/* Product selector */}
          <div>
            <label className="text-xs font-semibold text-text-secondary uppercase tracking-wide block mb-1.5">Product</label>
            <select
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full px-3 py-2.5 bg-bg-primary border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent"
            >
              <option value="">Select a product...</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.sku ? ` (${p.sku})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Current stock badge */}
          {selectedProduct && (
            <div className={`flex items-center justify-between px-4 py-3 rounded-lg border ${
              selectedProduct.current_stock <= 0
                ? 'bg-error/5 border-error/20'
                : selectedProduct.current_stock <= selectedProduct.reorder_threshold
                  ? 'bg-warning/5 border-warning/20'
                  : 'bg-success/5 border-success/20'
            }`}>
              <div>
                <p className="text-xs text-text-secondary">Current Stock</p>
                <p className={`text-2xl font-bold ${
                  selectedProduct.current_stock <= 0 ? 'text-error' :
                  selectedProduct.current_stock <= selectedProduct.reorder_threshold ? 'text-warning' : 'text-success'
                }`}>
                  {Math.round(selectedProduct.current_stock)}
                </p>
              </div>
              {selectedProduct.reorder_threshold > 0 && selectedProduct.current_stock <= selectedProduct.reorder_threshold && (
                <div className="flex items-center gap-1.5 text-warning">
                  <AlertTriangle size={14} />
                  <span className="text-xs font-medium">
                    {selectedProduct.current_stock <= 0 ? 'Out of stock!' : 'Low stock'}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Transaction type */}
          <div>
            <label className="text-xs font-semibold text-text-secondary uppercase tracking-wide block mb-1.5">Action</label>
            <div className="grid grid-cols-2 gap-2">
              {TX_TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setTxType(t.value)}
                  className={`flex items-center gap-2 px-3 py-3 rounded-lg border text-sm font-medium transition-all ${
                    txType === t.value ? t.activeColor : t.color
                  }`}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Quantity */}
          <div>
            <label className="text-xs font-semibold text-text-secondary uppercase tracking-wide block mb-1.5">Quantity</label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setQty(String(Math.max(1, Number(qty) - 1)))}
                className="p-2.5 bg-bg-primary hover:bg-bg-hover border border-border rounded-lg text-text-secondary hover:text-text-primary transition-colors"
              >
                <Minus size={14} />
              </button>
              <input
                value={qty}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '' || /^\d*\.?\d*$/.test(v)) setQty(v);
                }}
                type="text"
                inputMode="decimal"
                className="flex-1 px-3 py-2.5 bg-bg-primary border border-border rounded-lg text-center text-lg font-bold text-text-primary focus:outline-none focus:border-accent"
              />
              <button
                onClick={() => setQty(String(Number(qty) + 1))}
                className="p-2.5 bg-bg-primary hover:bg-bg-hover border border-border rounded-lg text-text-secondary hover:text-text-primary transition-colors"
              >
                <Plus size={14} />
              </button>
            </div>
            <div className="flex gap-2 mt-2">
              {QUICK_QTY.map((q) => (
                <button
                  key={q}
                  onClick={() => setQty(String(q))}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                    Number(qty) === q
                      ? 'bg-accent/20 border-accent text-accent'
                      : 'bg-bg-primary border-border text-text-secondary hover:border-accent/50 hover:text-text-primary'
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Location (optional) */}
          <div>
            <label className="text-xs font-semibold text-text-secondary uppercase tracking-wide block mb-1.5">
              Location <span className="font-normal text-text-secondary/60">(optional)</span>
            </label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full px-3 py-2.5 bg-bg-primary border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-accent"
            >
              <option value="">No location</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}{l.sub_location ? ` - ${l.sub_location}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Notes (optional) */}
          <div>
            <label className="text-xs font-semibold text-text-secondary uppercase tracking-wide block mb-1.5">
              Notes <span className="font-normal text-text-secondary/60">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Restock from supplier, event service..."
              rows={2}
              className="w-full px-3 py-2.5 bg-bg-primary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent resize-none"
            />
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={submitting || selectedProductId === '' || !qty || Number(qty) <= 0}
            className={`w-full py-3 rounded-lg text-sm font-bold transition-all ${
              submitting || selectedProductId === '' || !qty || Number(qty) <= 0
                ? 'bg-bg-tertiary text-text-secondary/50 cursor-not-allowed'
                : txType === 'PURCHASE'
                  ? 'bg-success hover:bg-success/90 text-white'
                  : txType === 'USAGE'
                    ? 'bg-warning hover:bg-warning/90 text-white'
                    : txType === 'SPOILAGE'
                      ? 'bg-error hover:bg-error/90 text-white'
                      : 'bg-accent hover:bg-accent-hover text-white'
            }`}
          >
            {submitting ? 'Saving...' : `Record ${TX_TYPES.find((t) => t.value === txType)?.label || 'Transaction'}`}
          </button>
        </div>
      </div>

      {/* Right: Recent adjustments + full stock overview */}
      <div className="flex-1 overflow-y-auto">
        {/* Recent adjustments */}
        <div className="border-b border-border">
          <div className="px-5 py-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary">Recent Adjustments</h3>
            <button onClick={fetchData} className="text-text-secondary hover:text-text-primary transition-colors">
              <RefreshCw size={12} />
            </button>
          </div>
          <div className="divide-y divide-border max-h-[280px] overflow-y-auto">
            {recent.length === 0 ? (
              <div className="px-5 py-6 text-center text-xs text-text-secondary">No adjustments yet</div>
            ) : (
              recent.map((r) => (
                <div key={r.id} className="px-5 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${txBg[r.transaction_type]} ${txColor[r.transaction_type]}`}>
                      {r.transaction_type}
                    </span>
                    <div>
                      <p className="text-sm text-text-primary">{r.product_name}</p>
                      {r.notes && <p className="text-[11px] text-text-secondary truncate max-w-[250px]">{r.notes}</p>}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold ${r.quantity_change >= 0 ? 'text-success' : 'text-error'}`}>
                      {r.quantity_change >= 0 ? '+' : ''}{r.quantity_change}
                    </p>
                    <p className="text-[10px] text-text-secondary">{r.created_at?.replace('T', ' ').slice(0, 16)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Stock overview */}
        <div className="px-5 py-3">
          <h3 className="text-sm font-semibold text-text-primary mb-3">All Stock Levels</h3>
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
            {products.map((p) => {
              const stock = Math.round(p.current_stock);
              const isLow = p.reorder_threshold > 0 && stock <= p.reorder_threshold;
              const isOut = stock <= 0;
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedProductId(p.id)}
                  className={`text-left px-3 py-2.5 rounded-lg border transition-all hover:scale-[1.01] ${
                    selectedProductId === p.id
                      ? 'border-accent bg-accent/5 ring-1 ring-accent/30'
                      : isOut
                        ? 'border-error/20 bg-error/5 hover:border-error/40'
                        : isLow
                          ? 'border-warning/20 bg-warning/5 hover:border-warning/40'
                          : 'border-border bg-bg-secondary hover:border-accent/30'
                  }`}
                >
                  <p className="text-xs text-text-primary font-medium truncate">{p.name}</p>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className={`text-lg font-bold ${isOut ? 'text-error' : isLow ? 'text-warning' : 'text-success'}`}>
                      {stock}
                    </span>
                    <span className="text-[10px] text-text-secondary">{p.category_name}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {error && (
        <div className="fixed bottom-4 right-4 bg-error/10 border border-error/20 text-error px-4 py-2 rounded-lg text-xs shadow-lg z-50">
          {error}
          <button onClick={() => setError(null)} className="ml-2 hover:underline">dismiss</button>
        </div>
      )}
    </div>
  );
}
