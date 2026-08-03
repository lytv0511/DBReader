import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { PieChart, Pie, Cell, Sector } from 'recharts';
import { DollarSign, Package, ArrowLeft } from 'lucide-react';
import { executeQuery } from '../../lib/db';
import { useI18n } from '../../lib/language';

interface PieItem {
  id: number;
  name: string;
  icon: string;
  color: string;
  value: number;
}

interface PieChartWidgetProps {
  mode: 'spending' | 'quantity';
}

const PRODUCT_PALETTE = ['#5b6abf', '#4ade80', '#fbbf24', '#f87171', '#60a5fa', '#f472b6', '#34d399', '#a78bfa', '#fb923c', '#22d3ee'];

function formatPct(pct: number): string {
  return `${(pct * 100).toFixed(1)}%`;
}

function PieSector(props: Record<string, unknown>) {
  const isActive = props.isActive as boolean;
  const cx = props.cx as number;
  const cy = props.cy as number;
  const ref = useRef<SVGGElement>(null);
  const mounted = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!mounted.current) {
      mounted.current = true;
      el.style.transform = isActive ? 'scale(1.07)' : 'scale(1)';
    } else {
      el.style.transform = isActive ? 'scale(1.07)' : 'scale(1)';
    }
  }, [isActive]);

  return (
    <g
      ref={ref}
      style={{
        transformOrigin: `${cx}px ${cy}px`,
        transform: 'scale(1)',
        transition: 'transform 200ms ease-out',
      }}
    >
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={props.innerRadius as number}
        outerRadius={props.outerRadius as number}
        startAngle={props.startAngle as number}
        endAngle={props.endAngle as number}
        fill={props.fill as string}
        stroke={props.stroke as string}
        strokeWidth={props.strokeWidth as number}
      />
    </g>
  );
}

export default function PieChartWidget({ mode }: PieChartWidgetProps) {
  const { t } = useI18n();
  const isSpending = mode === 'spending';
  const [metricMode, setMetricMode] = useState<'historical' | 'current'>('current');
  const [selectedCategory, setSelectedCategory] = useState<{ id: number; name: string; icon: string; color: string } | null>(null);
  const [data, setData] = useState<PieItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (selectedCategory) {
        const catId = selectedCategory.id;
        const catClause = catId === -1 ? 'c.id IS NULL' : `c.id = ${catId}`;
        if (isSpending && metricMode === 'historical') {
          const r = await executeQuery(`
            SELECT p.id, p.name,
                   COALESCE(c.icon, '📋') AS icon, COALESCE(c.color, '#888') AS color,
                   ROUND(SUM(ABS(il.quantity_change) * b.unit_cost_price), 2) AS value
            FROM inventory_logs il
            JOIN batches b ON il.batch_id = b.id
            JOIN products p ON b.product_id = p.id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE il.transaction_type = 'PURCHASE' AND ${catClause}
            GROUP BY p.id, p.name
            ORDER BY value DESC
          `);
          setData(r.rows.map((row, i) => ({ id: row[0] as number, name: row[1] as string, icon: row[2] as string || '📦', color: PRODUCT_PALETTE[i % PRODUCT_PALETTE.length], value: row[4] as number })));
        } else if (isSpending && metricMode === 'current') {
          const r = await executeQuery(`
            SELECT p.id, p.name,
                   COALESCE(c.icon, '📋') AS icon, COALESCE(c.color, '#888') AS color,
                   ROUND(SUM(b.unit_cost_price * s.qty), 2) AS value
            FROM (SELECT batch_id, SUM(quantity_change) AS qty FROM inventory_logs GROUP BY batch_id HAVING qty > 0) s
            JOIN batches b ON b.id = s.batch_id
            JOIN products p ON p.id = b.product_id
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE ${catClause}
            GROUP BY p.id, p.name
            ORDER BY value DESC
          `);
          setData(r.rows.map((row, i) => ({ id: row[0] as number, name: row[1] as string, icon: row[2] as string || '📦', color: PRODUCT_PALETTE[i % PRODUCT_PALETTE.length], value: row[4] as number })));
        } else if (!isSpending && metricMode === 'historical') {
          const r = await executeQuery(`
            SELECT p.id, p.name,
                   COALESCE(c.icon, '📋') AS icon, COALESCE(c.color, '#888') AS color,
                   CAST(SUM(ABS(il.quantity_change)) AS REAL) AS value
            FROM inventory_logs il
            JOIN batches b ON il.batch_id = b.id
            JOIN products p ON b.product_id = p.id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE il.transaction_type = 'PURCHASE' AND ${catClause}
            GROUP BY p.id, p.name
            ORDER BY value DESC
          `);
          setData(r.rows.map((row, i) => ({ id: row[0] as number, name: row[1] as string, icon: row[2] as string || '📦', color: PRODUCT_PALETTE[i % PRODUCT_PALETTE.length], value: row[4] as number })));
        } else {
          const r = await executeQuery(`
            SELECT p.id, p.name,
                   COALESCE(c.icon, '📋') AS icon, COALESCE(c.color, '#888') AS color,
                   CAST(SUM(s.qty) AS REAL) AS value
            FROM (SELECT batch_id, SUM(quantity_change) AS qty FROM inventory_logs GROUP BY batch_id HAVING qty > 0) s
            JOIN batches b ON b.id = s.batch_id
            JOIN products p ON p.id = b.product_id
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE ${catClause}
            GROUP BY p.id, p.name
            ORDER BY value DESC
          `);
          setData(r.rows.map((row, i) => ({ id: row[0] as number, name: row[1] as string, icon: row[2] as string || '📦', color: PRODUCT_PALETTE[i % PRODUCT_PALETTE.length], value: row[4] as number })));
        }
      } else {
        if (isSpending && metricMode === 'historical') {
          const r = await executeQuery(`
            SELECT COALESCE(c.id, -1) AS id, COALESCE(c.name, 'Uncategorized') AS name,
                   COALESCE(c.icon, '📋') AS icon, COALESCE(c.color, '#888') AS color,
                   ROUND(SUM(ABS(il.quantity_change) * b.unit_cost_price), 2) AS value
            FROM inventory_logs il
            JOIN batches b ON il.batch_id = b.id
            JOIN products p ON b.product_id = p.id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE il.transaction_type = 'PURCHASE'
            GROUP BY c.id, c.name, c.icon, c.color
            ORDER BY value DESC
          `);
          setData(r.rows.map((row) => ({ id: row[0] as number, name: row[1] as string, icon: row[2] as string || '📋', color: row[3] as string || '#888', value: row[4] as number })));
        } else if (isSpending && metricMode === 'current') {
          const r = await executeQuery(`
            SELECT COALESCE(c.id, -1) AS id, COALESCE(c.name, 'Uncategorized') AS name,
                   COALESCE(c.icon, '📋') AS icon, COALESCE(c.color, '#888') AS color,
                   ROUND(SUM(b.unit_cost_price * s.qty), 2) AS value
            FROM (SELECT batch_id, SUM(quantity_change) AS qty FROM inventory_logs GROUP BY batch_id HAVING qty > 0) s
            JOIN batches b ON b.id = s.batch_id
            JOIN products p ON p.id = b.product_id
            LEFT JOIN categories c ON c.id = p.category_id
            GROUP BY c.id, c.name, c.icon, c.color
            ORDER BY value DESC
          `);
          setData(r.rows.map((row) => ({ id: row[0] as number, name: row[1] as string, icon: row[2] as string || '📋', color: row[3] as string || '#888', value: row[4] as number })));
        } else if (!isSpending && metricMode === 'historical') {
          const r = await executeQuery(`
            SELECT COALESCE(c.id, -1) AS id, COALESCE(c.name, 'Uncategorized') AS name,
                   COALESCE(c.icon, '📋') AS icon, COALESCE(c.color, '#888') AS color,
                   CAST(SUM(ABS(il.quantity_change)) AS REAL) AS value
            FROM inventory_logs il
            JOIN batches b ON il.batch_id = b.id
            JOIN products p ON b.product_id = p.id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE il.transaction_type = 'PURCHASE'
            GROUP BY c.id, c.name, c.icon, c.color
            ORDER BY value DESC
          `);
          setData(r.rows.map((row) => ({ id: row[0] as number, name: row[1] as string, icon: row[2] as string || '📋', color: row[3] as string || '#888', value: row[4] as number })));
        } else {
          const r = await executeQuery(`
            SELECT COALESCE(c.id, -1) AS id, COALESCE(c.name, 'Uncategorized') AS name,
                   COALESCE(c.icon, '📋') AS icon, COALESCE(c.color, '#888') AS color,
                   CAST(SUM(s.qty) AS REAL) AS value
            FROM (SELECT batch_id, SUM(quantity_change) AS qty FROM inventory_logs GROUP BY batch_id HAVING qty > 0) s
            JOIN batches b ON b.id = s.batch_id
            JOIN products p ON p.id = b.product_id
            LEFT JOIN categories c ON c.id = p.category_id
            GROUP BY c.id, c.name, c.icon, c.color
            ORDER BY value DESC
          `);
          setData(r.rows.map((row) => ({ id: row[0] as number, name: row[1] as string, icon: row[2] as string || '📋', color: row[3] as string || '#888', value: row[4] as number })));
        }
      }
    } catch (err) {
      console.error('PieChartWidget error:', err);
      setError(String(err));
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [mode, metricMode, selectedCategory]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const total = data.reduce((s, d) => s + d.value, 0);

  const handleSliceClick = useCallback((_: unknown, index: number) => {
    const item = data[index];
    if (selectedCategory) return;
    setSelectedCategory({ id: item.id, name: item.name, icon: item.icon, color: item.color });
  }, [data, selectedCategory]);

  const handleBack = useCallback(() => {
    setSelectedCategory(null);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;
    const svg = container.querySelector('svg');
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const dx = mx - 90;
    const dy = my - 90;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 50 || dist > 75) {
      setHoveredIndex(undefined);
      return;
    }
    const angleRad = Math.atan2(dy, dx);
    const angleDeg = (angleRad * 180) / Math.PI;
    const rechartsAngle = ((-angleDeg) % 360 + 360) % 360;
    const total = data.reduce((s, d) => s + d.value, 0);
    if (total === 0) return;
    let cumulative = 0;
    for (let i = 0; i < data.length; i++) {
      const sweep = (data[i].value / total) * 360;
      if (rechartsAngle >= cumulative && rechartsAngle < cumulative + sweep) {
        setHoveredIndex(i);
        return;
      }
      cumulative += sweep;
    }
  }, [data]);

  const handleMouseLeaveContainer = useCallback(() => {
    setHoveredIndex(undefined);
  }, []);

  const headerTitle = isSpending
    ? (metricMode === 'current' ? t('pie.header.invValue') : t('pie.header.histSpend'))
    : (metricMode === 'current' ? t('pie.header.currentStock') : t('pie.header.histPurch'));

  const emptyMsg = isSpending ? t('pie.empty.spend') : t('pie.empty.qty');

  return (
    <div className="bg-bg-secondary border border-border rounded-lg">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        {isSpending ? <DollarSign size={14} className="text-accent" /> : <Package size={14} className="text-accent" />}
        <h3 className="text-sm font-semibold text-text-primary">{headerTitle}</h3>
        <div className="ml-auto flex bg-bg-tertiary border border-border rounded-md overflow-hidden">
          <button
            onClick={() => setMetricMode('current')}
            className={`px-2 py-1 text-[10px] font-medium transition-colors ${metricMode === 'current' ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'}`}
          >
            {t('pie.toggle.current')}
          </button>
          <button
            onClick={() => setMetricMode('historical')}
            className={`px-2 py-1 text-[10px] font-medium transition-colors ${metricMode === 'historical' ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'}`}
          >
            {t('pie.toggle.hist')}
          </button>
        </div>
      </div>

      <div className="p-4" style={{ maxHeight: 300, overflowY: 'auto' }}>
        {loading ? (
          <div className="flex items-center justify-center h-[200px] text-xs text-text-secondary">{t('pie.loading')}</div>
        ) : error ? (
          <div className="flex items-center justify-center h-[200px] text-xs text-error">{error}</div>
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center h-[200px] text-xs text-text-secondary">{emptyMsg}</div>
        ) : (
          <div className="flex items-start gap-3">
            <div ref={containerRef} className="shrink-0" onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeaveContainer}>
              {selectedCategory && (
                <button
                  onClick={handleBack}
                  className="flex items-center gap-1 text-[10px] text-text-secondary hover:text-text-primary mb-2 transition-colors"
                >
                  <ArrowLeft size={10} />
                  {t('pie.back')}
                </button>
              )}
              <PieChart width={180} height={180}>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx={90}
                  cy={90}
                  innerRadius={50}
                  outerRadius={75}
                  paddingAngle={2}
                  animationDuration={400}
                  animationEasing="ease-out"
                  shape={<PieSector />}
                  onClick={handleSliceClick}
                  cursor={selectedCategory ? 'default' : 'pointer'}
                >
                  {data.map((entry, index) => (
                    <Cell key={`${mode}-${index}-${entry.name}`} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </div>

            <div className="flex-1 min-w-0 space-y-1">
              {selectedCategory && (
                <p className="text-[11px] font-semibold text-text-primary mb-1 truncate">
                  {selectedCategory.icon} {selectedCategory.name}
                </p>
              )}
              {data.slice(0, 12).map((item, idx) => {
                const pct = total > 0 ? item.value / total : 0;
                const highlighted = hoveredIndex === idx;
                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-2 px-2 py-1 rounded text-xs transition-colors ${
                      highlighted ? 'bg-bg-hover' : ''
                    } ${!selectedCategory ? 'hover:bg-bg-hover cursor-pointer' : ''}`}
                    onClick={() => !selectedCategory && setSelectedCategory({ id: item.id, name: item.name, icon: item.icon, color: item.color })}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className={`truncate flex-1 ${highlighted ? 'text-text-primary font-semibold' : 'text-text-primary'}`}>
                      {item.icon} {item.name}
                    </span>
                    <span className="text-text-secondary shrink-0 text-[10px] tabular-nums">
                      {isSpending ? `$${Math.round(item.value).toLocaleString()}` : `${Math.round(item.value).toLocaleString()}`}
                    </span>
                    <span className="text-text-secondary shrink-0 text-[10px] w-[42px] text-right tabular-nums">
                      {formatPct(pct)}
                    </span>
                  </div>
                );
              })}
              {data.length > 12 && (
                <div className="text-[10px] text-text-secondary text-center pt-1">
                  {t('pie.more', { count: data.length - 12 })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
