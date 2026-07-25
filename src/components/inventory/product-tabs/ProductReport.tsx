import { useState, useEffect, useCallback } from 'react';
import { Printer } from 'lucide-react';
import { getProductReportData } from '../../../lib/db';

interface ReportData {
  product: { name: string; sku: string | null; category: string; icon: string; color: string };
  attributes: { key: string; value: string; type: string }[];
  history: { type: string; qty: number; month: string }[];
  cost_data: { date: string; cost: number; stock: number }[];
  notes: { title: string | null; body: string }[];
  reservations: { client: string; qty: number; date: string; status: string; notes: string | null }[];
}

const TYPE_COLORS: Record<string, string> = {
  PURCHASE: '#22c55e', USAGE: '#eab308', SPOILAGE: '#ef4444', ADJUSTMENT: '#8b5cf6',
};

export default function ProductReport({ productId }: { productId: number }) {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getProductReportData(productId);
      if (result && typeof result === 'object' && 'product' in result && 'history' in result) {
        setData(result as unknown as ReportData);
      } else {
        setData(null);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [productId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return <div className="flex items-center justify-center h-full text-text-secondary text-sm">Generating report...</div>;
  if (!data) return <div className="flex items-center justify-center h-full text-text-secondary text-sm">No data available</div>;

  const months = [...new Set(data.history.map((h) => h.month))].sort();
  const purchaseByMonth: Record<string, number> = {};
  const usageByMonth: Record<string, number> = {};
  data.history.forEach((h) => {
    if (h.type === 'PURCHASE') purchaseByMonth[h.month] = (purchaseByMonth[h.month] || 0) + h.qty;
    if (h.type === 'USAGE') usageByMonth[h.month] = (usageByMonth[h.month] || 0) + h.qty;
  });
  const maxQty = Math.max(1, ...months.map((m) => Math.max(purchaseByMonth[m] || 0, usageByMonth[m] || 0)));

  const now = new Date().toISOString().slice(0, 10);

  return (
    <div className="h-full overflow-y-auto">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .report-print, .report-print * { visibility: visible !important; }
          .report-print { position: absolute; left: 0; top: 0; width: 100%; background: white !important; color: #111 !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="no-print px-6 py-4 border-b border-border bg-bg-secondary flex items-center justify-between sticky top-0 z-10">
        <h2 className="text-sm font-bold text-text-primary">Product Report</h2>
        <button onClick={() => window.print()} className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover rounded-md text-xs text-white">
          <Printer size={12} /> Print / Save PDF
        </button>
      </div>

      <div className="report-print max-w-[800px] mx-auto p-8 bg-white text-gray-900">
        {/* Header */}
        <div className="flex items-center gap-4 pb-6 border-b-2 border-gray-200 mb-6">
          <div className="w-16 h-16 rounded-xl flex items-center justify-center text-4xl" style={{ backgroundColor: `${data.product.color}15` }}>
            {data.product.icon}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{data.product.name}</h1>
            <p className="text-sm text-gray-500">{data.product.category}{data.product.sku ? ` · SKU: ${data.product.sku}` : ''}</p>
          </div>
          <div className="ml-auto text-right text-xs text-gray-400">
            <p>Generated: {now}</p>
            <p>DBReader Report</p>
          </div>
        </div>

        {/* Attributes */}
        {data.attributes.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-bold text-gray-900 mb-3 pb-1 border-b border-gray-200">Product Details</h2>
            <div className="grid grid-cols-2 gap-2">
              {data.attributes.map((a, i) => (
                <div key={i} className="flex justify-between py-1 border-b border-gray-100">
                  <span className="text-sm font-medium text-gray-600">{a.key}</span>
                  <span className="text-sm text-gray-900">{a.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Usage/Purchase Graph */}
        {months.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-bold text-gray-900 mb-3 pb-1 border-b border-gray-200">Usage & Purchase History</h2>
            <div className="flex items-end gap-1 h-40 border-b border-l border-gray-300 pl-1 pb-1">
              {months.map((m) => (
                <div key={m} className="flex-1 flex items-end gap-px h-full" title={m}>
                  <div className="flex-1 rounded-t" style={{ height: `${((purchaseByMonth[m] || 0) / maxQty) * 100}%`, backgroundColor: TYPE_COLORS.PURCHASE, minHeight: purchaseByMonth[m] ? 2 : 0 }} title={`Purchased: ${purchaseByMonth[m] || 0}`} />
                  <div className="flex-1 rounded-t" style={{ height: `${((usageByMonth[m] || 0) / maxQty) * 100}%`, backgroundColor: TYPE_COLORS.USAGE, minHeight: usageByMonth[m] ? 2 : 0 }} title={`Used: ${usageByMonth[m] || 0}`} />
                </div>
              ))}
            </div>
            <div className="flex gap-1 pl-1 mt-1">
              {months.map((m) => (
                <div key={m} className="flex-1 text-center text-[8px] text-gray-400">{m.slice(5)}</div>
              ))}
            </div>
            <div className="flex gap-4 mt-2">
              <span className="flex items-center gap-1 text-xs"><span className="w-3 h-3 rounded" style={{ backgroundColor: TYPE_COLORS.PURCHASE }} /> Purchased</span>
              <span className="flex items-center gap-1 text-xs"><span className="w-3 h-3 rounded" style={{ backgroundColor: TYPE_COLORS.USAGE }} /> Used</span>
            </div>
          </div>
        )}

        {/* Cost History */}
        {data.cost_data.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-bold text-gray-900 mb-3 pb-1 border-b border-gray-200">Cost History</h2>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-1 text-gray-500 font-medium">Date</th>
                  <th className="text-right py-1 text-gray-500 font-medium">Unit Cost</th>
                </tr>
              </thead>
              <tbody>
                {data.cost_data.map((c, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-1 text-gray-700">{c.date?.slice(0, 10)}</td>
                    <td className="py-1 text-right font-mono text-gray-900">${Number(c.cost).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Notes */}
        {data.notes.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-bold text-gray-900 mb-3 pb-1 border-b border-gray-200">Notes</h2>
            <div className="space-y-2">
              {data.notes.map((n, i) => (
                <div key={i} className="p-3 bg-gray-50 rounded border border-gray-200">
                  {n.title && <p className="text-sm font-semibold text-gray-900 mb-1">{n.title}</p>}
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{n.body}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reservations */}
        {data.reservations.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-bold text-gray-900 mb-3 pb-1 border-b border-gray-200">Reservations</h2>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-1 text-gray-500 font-medium">Client</th>
                  <th className="text-right py-1 text-gray-500 font-medium">Qty</th>
                  <th className="text-left py-1 text-gray-500 font-medium">Date</th>
                  <th className="text-left py-1 text-gray-500 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.reservations.map((r, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-1 text-gray-900">{r.client}</td>
                    <td className="py-1 text-right font-mono text-gray-700">{r.qty}</td>
                    <td className="py-1 text-gray-600">{r.date?.slice(0, 10)}</td>
                    <td className="py-1 text-gray-600 capitalize">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div className="pt-4 border-t border-gray-200 text-center text-[10px] text-gray-400">
          Generated by DBReader · {now}
        </div>
      </div>
    </div>
  );
}
