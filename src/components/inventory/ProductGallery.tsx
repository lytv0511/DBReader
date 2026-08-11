import { useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { executeQuery } from '../../lib/db';
import { useI18n } from '../../lib/language';

interface Product {
  id: number;
  name: string;
  sku: string | null;
  category_name: string;
  category_id: number | null;
  category_icon: string;
  category_color: string;
  current_stock: number;
  reorder_threshold: number;
  base_unit_name: string;
  batch_id: number | null;
  provider_id: number | null;
  provider_name: string;
  batch_number: string;
}

interface ProductGalleryProps {
  onSelectProduct: (product: Product) => void;
}

export type StockFilter = 'all' | 'total' | 'out' | 'low' | 'ok';

const stockStatus = (p: Product): Exclude<StockFilter, 'all' | 'total'> => {
  const stock = Math.round(p.current_stock);
  if (stock <= 0) return 'out';
  if (p.reorder_threshold > 0 && stock <= p.reorder_threshold) return 'low';
  return 'ok';
};

const matchesStock = (p: Product, filter: StockFilter): boolean => {
  if (filter === 'all') return true;
  if (filter === 'total') return Math.round(p.current_stock) >= 1;
  if (filter === 'low') {
    const stock = Math.round(p.current_stock);
    return p.reorder_threshold > 0 && stock <= p.reorder_threshold;
  }
  return stockStatus(p) === filter;
};

interface ProductGalleryProps {
  onSelectProduct: (product: Product) => void;
  initialStockFilter?: StockFilter;
}

export default function ProductGallery({ onSelectProduct, initialStockFilter = 'all' }: ProductGalleryProps) {
  const { t } = useI18n();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterCategoryId, setFilterCategoryId] = useState<number | null>(null);
  const [filterStock, setFilterStock] = useState<StockFilter>(initialStockFilter);
  const [categories, setCategories] = useState<{ id: number; name: string; icon: string; color: string; count: number }[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [productsResult, categoriesResult] = await Promise.all([
        executeQuery(`
          SELECT
            p.id, p.name, p.sku,
            COALESCE(c.name, 'Uncategorized') AS category_name,
            p.category_id,
            COALESCE(c.icon, '📋') AS category_icon,
            COALESCE(c.color, '#5b6abf') AS category_color,
            COALESCE(SUM(il.quantity_change), 0) AS current_stock,
            p.reorder_threshold,
            p.base_unit_name,
            b.id AS batch_id,
            COALESCE(b.batch_number, '') AS batch_number,
            pr.id AS provider_id,
            COALESCE(pr.name, '') AS provider_name
          FROM products p
          LEFT JOIN categories c ON p.category_id = c.id
          LEFT JOIN batches b ON b.product_id = p.id
          LEFT JOIN inventory_logs il ON il.batch_id = b.id
          LEFT JOIN providers pr ON il.provider_id = pr.id
          GROUP BY p.id, p.name, p.sku, c.name, p.category_id, c.icon, c.color, p.reorder_threshold, p.base_unit_name, b.id, b.batch_number, pr.id, pr.name
          ORDER BY c.name, p.name, pr.name, b.purchase_date
        `),
        executeQuery(`
          SELECT c.id, c.name, c.icon, c.color, COUNT(p.id) AS cnt
          FROM categories c
          LEFT JOIN products p ON p.category_id = c.id
          GROUP BY c.id, c.name, c.icon, c.color
          ORDER BY c.name
        `),
      ]);

      setProducts(productsResult.rows.map((r) => ({
        id: r[0] as number,
        name: r[1] as string,
        sku: r[2] as string | null,
        category_name: r[3] as string,
        category_id: r[4] as number | null,
        category_icon: r[5] as string || '📋',
        category_color: r[6] as string || '#5b6abf',
        current_stock: r[7] as number,
        reorder_threshold: r[8] as number,
        base_unit_name: r[9] as string || 'unit',
        batch_id: r[10] as number | null,
        batch_number: r[11] as string || '',
        provider_id: r[12] as number | null,
        provider_name: r[13] as string || '',
      })));

      const cats = categoriesResult.rows.map((r) => ({
        id: r[0] as number,
        name: r[1] as string,
        icon: r[2] as string || '📋',
        color: r[3] as string || '#5b6abf',
        count: r[4] as number,
      }));

      // Add uncategorized count
      const uncatCount = productsResult.rows.filter((r) => r[4] === null).length;
      if (uncatCount > 0) {
        cats.push({ id: -1, name: 'Uncategorized', icon: '📋', color: '#78716c', count: uncatCount });
      }

      setCategories(cats);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = products.filter((p) => {
    const inCategory = filterCategoryId === null
      || (filterCategoryId === -1 ? p.category_id === null : p.category_id === filterCategoryId);
    return inCategory && matchesStock(p, filterStock);
  });

  const stockCounts = {
    total: products.filter((p) => matchesStock(p, 'total')).length,
    low: products.filter((p) => matchesStock(p, 'low')).length,
    out: products.filter((p) => matchesStock(p, 'out')).length,
    ok: products.filter((p) => matchesStock(p, 'ok')).length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary">
        <RefreshCw size={20} className="animate-spin mr-2" />
        {t('gallery.loading')}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Category bar */}
      <div className="px-6 py-4 border-b border-border bg-bg-secondary shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-text-primary">{t('gallery.title')}</h2>
          <button onClick={fetchData} className="p-2 text-text-secondary hover:text-text-primary transition-colors">
            <RefreshCw size={14} />
          </button>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilterCategoryId(null)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              filterCategoryId === null ? 'bg-accent text-white border-accent' : 'bg-bg-primary border-border text-text-secondary hover:border-accent/50'
            }`}
          >
            {t('gallery.all', { count: products.length })}
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setFilterCategoryId(filterCategoryId === cat.id ? null : cat.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                filterCategoryId === cat.id ? 'text-white border-current' : 'bg-bg-primary border-border text-text-secondary hover:border-accent/50'
              }`}
              style={filterCategoryId === cat.id ? { backgroundColor: cat.color, borderColor: cat.color } : {}}
            >
              <span>{cat.icon}</span>
              {cat.name} ({cat.count})
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-3">
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">{t('gallery.stockLabel')}</span>
          <button
            onClick={() => setFilterStock('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              filterStock === 'all' ? 'bg-accent text-white border-accent' : 'bg-bg-primary border-border text-text-secondary hover:border-accent/50'
            }`}
          >
            {t('gallery.all', { count: products.length })}
          </button>
          <button
            onClick={() => setFilterStock(filterStock === 'total' ? 'all' : 'total')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              filterStock === 'total'
                ? 'bg-accent text-white border-accent'
                : 'bg-bg-primary border-border text-text-secondary hover:border-accent/50'
            }`}
          >
            {t('gallery.stockTotal')} ({stockCounts.total})
          </button>
          <button
            onClick={() => setFilterStock(filterStock === 'out' ? 'all' : 'out')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              filterStock === 'out'
                ? 'bg-error text-white border-error'
                : 'bg-bg-primary border-border text-text-secondary hover:border-error/50'
            }`}
          >
            {t('gallery.stockOut')} ({stockCounts.out})
          </button>
          <button
            onClick={() => setFilterStock(filterStock === 'low' ? 'all' : 'low')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              filterStock === 'low'
                ? 'bg-warning text-white border-warning'
                : 'bg-bg-primary border-border text-text-secondary hover:border-warning/50'
            }`}
          >
            {t('gallery.stockLow')} ({stockCounts.low})
          </button>
          <button
            onClick={() => setFilterStock(filterStock === 'ok' ? 'all' : 'ok')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              filterStock === 'ok'
                ? 'bg-success text-white border-success'
                : 'bg-bg-primary border-border text-text-secondary hover:border-success/50'
            }`}
          >
            {t('gallery.stockOk')} ({stockCounts.ok})
          </button>
        </div>
      </div>

      {/* Product grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {error ? (
          <div className="text-center text-error text-sm">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-text-secondary text-sm">
            {filterCategoryId !== null ? t('gallery.noInCategory') : t('gallery.noFound')}
          </div>
        ) : (
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {filtered.map((product) => {
              const stock = Math.round(product.current_stock);
              const isLow = product.reorder_threshold > 0 && stock <= product.reorder_threshold;
              const isOut = stock <= 0;

              return (
                <button
                  key={`${product.id}-${product.batch_id ?? 0}-${product.provider_id ?? 0}`}
                  onClick={() => onSelectProduct(product)}
                  className="group bg-bg-secondary border border-border rounded-xl p-4 flex flex-col items-center text-center hover:border-accent/40 hover:shadow-lg hover:shadow-accent/5 transition-all hover:scale-[1.02]"
                >
                  <div
                    className="w-16 h-16 rounded-xl flex items-center justify-center text-3xl mb-3 border group-hover:scale-110 transition-transform"
                    style={{ backgroundColor: `${product.category_color}15`, borderColor: `${product.category_color}30` }}
                  >
                    {product.category_icon}
                  </div>
                  <p className="text-xs font-semibold text-text-primary truncate w-full mb-1 group-hover:text-accent transition-colors">
                    {product.name}
                  </p>
                  <p className="text-[10px] text-text-secondary mb-2">{product.category_name}</p>
                  <p className="text-[10px] text-text-secondary truncate w-full mb-2 text-accent/80">
                    {[product.provider_name, product.batch_number].filter(Boolean).join(' · ') || '-'}
                  </p>
                  <div className={`text-lg font-bold ${isOut ? 'text-error' : isLow ? 'text-warning' : 'text-success'}`}>
                    {stock}
                  </div>
                  <p className="text-[10px] text-text-secondary">{t('gallery.inStock')}</p>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export type { Product };
