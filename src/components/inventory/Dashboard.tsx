import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, AlertTriangle, TrendingUp, Package, Clock } from 'lucide-react';
import { executeQuery } from '../../lib/db';
import PieChartWidget from './PieChartWidget';

interface StockRow {
  product_id: number;
  product_name: string;
  sku: string | null;
  category_name: string;
  total_purchased: number;
  total_used: number;
  total_spoiled: number;
  total_adjusted: number;
  current_stock: number;
  reorder_threshold: number;
}

interface RecentActivity {
  id: number;
  product_name: string;
  quantity_change: number;
  transaction_type: string;
  notes: string | null;
  created_at: string;
}

interface SummaryCardProps {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: string;
}

function SummaryCard({ icon, label, value, color }: SummaryCardProps) {
  return (
    <div className="bg-bg-secondary border border-border rounded-lg p-4 flex items-start gap-3">
      <div className={`p-2 rounded-md ${color}`}>
        {icon}
      </div>
      <div>
        <p className="text-xs text-text-secondary">{label}</p>
        <p className="text-xl font-bold text-text-primary">{value}</p>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [stockLevels, setStockLevels] = useState<StockRow[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [lowStockItems, setLowStockItems] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [stockResult, activityResult] = await Promise.all([
        executeQuery(`
          SELECT
            p.id AS product_id,
            p.name AS product_name,
            p.sku,
            COALESCE(c.name, 'Uncategorized') AS category_name,
            COALESCE(SUM(CASE WHEN il.transaction_type = 'PURCHASE' THEN il.quantity_change ELSE 0 END), 0) AS total_purchased,
            COALESCE(SUM(CASE WHEN il.transaction_type = 'USAGE' THEN ABS(il.quantity_change) ELSE 0 END), 0) AS total_used,
            COALESCE(SUM(CASE WHEN il.transaction_type = 'SPOILAGE' THEN ABS(il.quantity_change) ELSE 0 END), 0) AS total_spoiled,
            COALESCE(SUM(CASE WHEN il.transaction_type = 'ADJUSTMENT' THEN il.quantity_change ELSE 0 END), 0) AS total_adjusted,
            COALESCE(SUM(il.quantity_change), 0) AS current_stock,
            p.reorder_threshold
          FROM products p
          LEFT JOIN categories c ON p.category_id = c.id
          LEFT JOIN batches b ON b.product_id = p.id
          LEFT JOIN inventory_logs il ON il.batch_id = b.id
          GROUP BY p.id, p.name, p.sku, c.name, p.reorder_threshold
          ORDER BY c.name, p.name
        `),
        executeQuery(`
          SELECT
            il.id,
            p.name AS product_name,
            il.quantity_change,
            il.transaction_type,
            il.notes,
            il.created_at
          FROM inventory_logs il
          JOIN batches b ON il.batch_id = b.id
          JOIN products p ON b.product_id = p.id
          ORDER BY il.created_at DESC
          LIMIT 15
        `),
      ]);

      const stockRows: StockRow[] = stockResult.rows.map((r) => ({
        product_id: r[0] as number,
        product_name: r[1] as string,
        sku: r[2] as string | null,
        category_name: r[3] as string,
        total_purchased: r[4] as number,
        total_used: r[5] as number,
        total_spoiled: r[6] as number,
        total_adjusted: r[7] as number,
        current_stock: r[8] as number,
        reorder_threshold: r[9] as number,
      }));

      setStockLevels(stockRows);
      setLowStockItems(stockRows.filter((s) => s.current_stock <= s.reorder_threshold && s.reorder_threshold > 0));

      const activityRows: RecentActivity[] = activityResult.rows.map((r) => ({
        id: r[0] as number,
        product_name: r[1] as string,
        quantity_change: r[2] as number,
        transaction_type: r[3] as string,
        notes: r[4] as string | null,
        created_at: r[5] as string,
      }));

      setRecentActivity(activityRows);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalProducts = stockLevels.length;
  const totalStock = stockLevels.reduce((sum, s) => sum + s.current_stock, 0);
  const alertCount = lowStockItems.length;

  const txColor: Record<string, string> = {
    PURCHASE: 'text-success',
    USAGE: 'text-warning',
    SPOILAGE: 'text-error',
    ADJUSTMENT: 'text-accent',
  };

  const txBg: Record<string, string> = {
    PURCHASE: 'bg-success/10',
    USAGE: 'bg-warning/10',
    SPOILAGE: 'bg-error/10',
    ADJUSTMENT: 'bg-accent/10',
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary">
        <RefreshCw size={20} className="animate-spin mr-2" />
        Loading dashboard...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-error">
        {error}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-text-primary">Inventory Dashboard</h2>
        <button
          onClick={fetchData}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-xs text-text-secondary transition-colors"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <SummaryCard
          icon={<Package size={18} className="text-accent" />}
          label="Total Products"
          value={totalProducts}
          color="bg-accent/10"
        />
        <SummaryCard
          icon={<TrendingUp size={18} className="text-success" />}
          label="Total Units in Stock"
          value={Math.round(totalStock)}
          color="bg-success/10"
        />
        <SummaryCard
          icon={<AlertTriangle size={18} className="text-warning" />}
          label="Low Stock Alerts"
          value={alertCount}
          color={alertCount > 0 ? 'bg-warning/10' : 'bg-bg-tertiary'}
        />
        <SummaryCard
          icon={<Clock size={18} className="text-text-secondary" />}
          label="Recent Transactions"
          value={recentActivity.length}
          color="bg-bg-tertiary"
        />
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Low Stock Alerts */}
        <div className="bg-bg-secondary border border-border rounded-lg">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <AlertTriangle size={14} className="text-warning" />
            <h3 className="text-sm font-semibold text-text-primary">Low Stock Alerts</h3>
          </div>
          <div className="divide-y divide-border max-h-[300px] overflow-y-auto">
            {lowStockItems.length === 0 ? (
              <div className="p-4 text-xs text-text-secondary text-center">All items above reorder threshold</div>
            ) : (
              lowStockItems.map((item) => (
                <div key={item.product_id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm text-text-primary font-medium">{item.product_name}</p>
                    <p className="text-xs text-text-secondary">{item.category_name}{item.sku ? ` · ${item.sku}` : ''}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold ${item.current_stock <= 0 ? 'text-error' : 'text-warning'}`}>
                      {Math.round(item.current_stock)}
                    </p>
                    <p className="text-xs text-text-secondary">min {Math.round(item.reorder_threshold)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-bg-secondary border border-border rounded-lg">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Clock size={14} className="text-text-secondary" />
            <h3 className="text-sm font-semibold text-text-primary">Recent Activity</h3>
          </div>
          <div className="divide-y divide-border max-h-[300px] overflow-y-auto">
            {recentActivity.length === 0 ? (
              <div className="p-4 text-xs text-text-secondary text-center">No recent transactions</div>
            ) : (
              recentActivity.map((item) => (
                <div key={item.id} className="px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${txBg[item.transaction_type]} ${txColor[item.transaction_type]}`}>
                      {item.transaction_type}
                    </span>
                    <div>
                      <p className="text-sm text-text-primary">{item.product_name}</p>
                      {item.notes && <p className="text-xs text-text-secondary truncate max-w-[200px]">{item.notes}</p>}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold ${item.quantity_change >= 0 ? 'text-success' : 'text-error'}`}>
                      {item.quantity_change >= 0 ? '+' : ''}{item.quantity_change}
                    </p>
                    <p className="text-[10px] text-text-secondary">{item.created_at?.slice(0, 10)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Pie chart widgets */}
      <div className="grid grid-cols-2 gap-6">
        <PieChartWidget mode="spending" />
        <PieChartWidget mode="quantity" />
      </div>

      {/* Full Stock Levels Table */}
      <div className="bg-bg-secondary border border-border rounded-lg">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-text-primary">Current Stock Levels</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-2 text-text-secondary font-semibold">Product</th>
                <th className="text-left px-4 py-2 text-text-secondary font-semibold">Category</th>
                <th className="text-right px-4 py-2 text-text-secondary font-semibold">Purchased</th>
                <th className="text-right px-4 py-2 text-text-secondary font-semibold">Used</th>
                <th className="text-right px-4 py-2 text-text-secondary font-semibold">Spoiled</th>
                <th className="text-right px-4 py-2 text-text-secondary font-semibold">Current Stock</th>
                <th className="text-right px-4 py-2 text-text-secondary font-semibold">Reorder At</th>
                <th className="text-center px-4 py-2 text-text-secondary font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stockLevels.map((item) => (
                <tr key={item.product_id} className="hover:bg-bg-hover transition-colors">
                  <td className="px-4 py-2 text-text-primary font-medium">{item.product_name}</td>
                  <td className="px-4 py-2 text-text-secondary">{item.category_name}</td>
                  <td className="px-4 py-2 text-text-secondary text-right">{item.total_purchased}</td>
                  <td className="px-4 py-2 text-text-secondary text-right">{item.total_used}</td>
                  <td className="px-4 py-2 text-error text-right">{item.total_spoiled > 0 ? item.total_spoiled : '-'}</td>
                  <td className={`px-4 py-2 text-right font-bold ${item.current_stock <= 0 ? 'text-error' : item.current_stock <= item.reorder_threshold ? 'text-warning' : 'text-success'}`}>
                    {Math.round(item.current_stock)}
                  </td>
                  <td className="px-4 py-2 text-text-secondary text-right">{item.reorder_threshold > 0 ? Math.round(item.reorder_threshold) : '-'}</td>
                  <td className="px-4 py-2 text-center">
                    {item.current_stock <= 0 ? (
                      <span className="px-2 py-0.5 rounded bg-error/10 text-error text-[10px] font-semibold">OUT OF STOCK</span>
                    ) : item.current_stock <= item.reorder_threshold ? (
                      <span className="px-2 py-0.5 rounded bg-warning/10 text-warning text-[10px] font-semibold">LOW</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-success/10 text-success text-[10px] font-semibold">OK</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
