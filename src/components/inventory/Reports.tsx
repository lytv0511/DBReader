import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect, type ReactNode } from 'react';
import { Printer, RefreshCw } from 'lucide-react';
import { executeQuery } from '../../lib/db';
import { printDom } from '../../lib/print';
import { todayLocalISO } from '../../lib/dates';
import { useI18n, I18nProvider } from '../../lib/language';
import { LANGS } from '../../lib/i18n';
import type { LanguageCode } from '../../types';
import { buildTxWhere, buildLogDateFilters, buildBatchDateFilters, buildProductWhere, buildBatchWhere, summarizeTx, sumByType, EMPTY_TX_FILTERS, TYPE_REPORT_SQL, type ReportType, type TxRow, type TxFilters } from '../../lib/reports';
import TagSelect, { type TagItem } from './TagSelect';

interface ProductRow {
  id: number;
  name: string;
  sku: string | null;
  category_name: string;
  reorder_threshold: number;
  base_unit_name: string;
  total_purchased: number;
  total_used: number;
  total_spoiled: number;
  current_stock: number;
  stock_value: number;
  money_spent: number;
  batch_count: number;
  batches_in_period: number;
  suppliers_in_period: number;
  provider_name: string;
  batch_number: string;
}

interface BatchRow {
  batch_number: string | null;
  product_name: string;
  category_name: string;
  supplier: string | null;
  purchase_date: string | null;
  unit_cost: number;
  status: string;
  batch_stock: number;
}

const REPORT_TYPES: ReportType[] = ['activities', ...Object.keys(TYPE_REPORT_SQL) as ReportType[], 'overall'];

type UnitKind = 'header' | 'h2count' | 'h2summary' | 'h2batch' | 'nodata' | 'gridTx' | 'gridOverall' | 'footer' | 'txrow' | 'prodrow' | 'batchrow';

interface Unit {
  kind: UnitKind;
  key: string;
  data?: TxRow | ProductRow | BatchRow;
}

const TABLE_KIND: Partial<Record<UnitKind, 'tx' | 'products' | 'batches'>> = {
  txrow: 'tx',
  prodrow: 'products',
  batchrow: 'batches',
};

const PAGE_CONTENT_H = (261 * 96) / 25.4;

const TX_QUERY = `
  SELECT
    il.id,
    il.created_at,
    p.name AS product_name,
    p.sku,
    b.batch_number,
    il.quantity_change,
    COALESCE(c.name, 'Uncategorized') AS category_name,
    pr.name AS provider_name,
    pr.sub_name AS provider_sub,
    (SELECT COALESCE(SUM(l2.quantity_change), 0)
       FROM inventory_logs l2
       WHERE l2.batch_id = il.batch_id
         AND datetime(l2.created_at) <= datetime(il.created_at)) AS current_stock,
    b.unit_cost_price,
    il.transaction_type
  FROM inventory_logs il
  JOIN batches b ON il.batch_id = b.id
  JOIN products p ON b.product_id = p.id
  LEFT JOIN categories c ON p.category_id = c.id
  LEFT JOIN providers pr ON il.provider_id = pr.id
`;

const buildOverallSql = (bundle: boolean, productWhere: string, logJoin: string, batchSub: string) => {
  const storageSelect = bundle
    ? "'' AS provider_name, '' AS batch_number"
    : "COALESCE(pr.name, '') AS provider_name, COALESCE(b.batch_number, '') AS batch_number";
  const group = bundle
    ? 'GROUP BY p.id, p.name, p.sku, c.name, p.reorder_threshold, p.base_unit_name'
    : 'GROUP BY p.id, p.name, p.sku, c.name, p.reorder_threshold, p.base_unit_name, b.id, b.batch_number, pr.id, pr.name';
  return `
  SELECT
    p.id,
    p.name,
    p.sku,
    COALESCE(c.name, 'Uncategorized') AS category_name,
    p.reorder_threshold,
    p.base_unit_name,
    COALESCE(SUM(CASE WHEN il.transaction_type = 'PURCHASE' THEN il.quantity_change ELSE 0 END), 0) AS total_purchased,
    COALESCE(SUM(CASE WHEN il.transaction_type = 'USAGE' THEN ABS(il.quantity_change) ELSE 0 END), 0) AS total_used,
    COALESCE(SUM(CASE WHEN il.transaction_type = 'SPOILAGE' THEN ABS(il.quantity_change) ELSE 0 END), 0) AS total_spoiled,
    COALESCE(SUM(il.quantity_change), 0) AS current_stock,
    COALESCE(SUM(il.quantity_change * b.unit_cost_price), 0) AS stock_value,
    COALESCE(SUM(CASE WHEN il.transaction_type IN ('PURCHASE', 'ADJUSTMENT') THEN il.quantity_change * b.unit_cost_price ELSE 0 END), 0) AS money_spent,
    COUNT(DISTINCT b.id) AS batch_count,
    COALESCE((SELECT COUNT(*) FROM batches b2 WHERE b2.product_id = p.id${bundle ? '' : ' AND b2.id = b.id'}${batchSub}), 0) AS batches_in_period,
    COALESCE((SELECT COUNT(DISTINCT b2.supplier_name) FROM batches b2 WHERE b2.product_id = p.id${bundle ? '' : ' AND b2.id = b.id'}${batchSub}), 0) AS suppliers_in_period,
    ${storageSelect}
  FROM products p
  LEFT JOIN categories c ON p.category_id = c.id
  LEFT JOIN batches b ON b.product_id = p.id
  LEFT JOIN inventory_logs il ON il.batch_id = b.id${logJoin}
  LEFT JOIN providers pr ON il.provider_id = pr.id
  ${productWhere}
  ${group}
  ORDER BY c.name, p.name, pr.name, b.purchase_date, p.id
`;
};

const buildBatchDetailSql = (where: string) => `
  SELECT
    b.batch_number,
    p.name AS product_name,
    COALESCE(c.name, 'Uncategorized') AS category_name,
    b.supplier_name,
    b.purchase_date,
    b.unit_cost_price,
    b.status,
    COALESCE(SUM(il.quantity_change), 0) AS batch_stock
  FROM batches b
  JOIN products p ON b.product_id = p.id
  LEFT JOIN categories c ON p.category_id = c.id
  LEFT JOIN inventory_logs il ON il.batch_id = b.id
  ${where}
  GROUP BY b.id
  ORDER BY p.name, b.purchase_date
`;

const fmtDate = (s: string | null | undefined) => (s ? String(s).replace('T', ' ').slice(0, 19) : '-');

const DateTimeCell = ({ value }: { value: string | null | undefined }) => {
  const s = fmtDate(value);
  if (s === '-') return <td className="py-1.5 text-gray-600">{s}</td>;
  return <td className="py-1.5 text-gray-600 whitespace-nowrap">{s.slice(0, 10)}</td>;
};

export default function Reports({ currencySymbol }: { currencySymbol: string }) {
  const appCtx = useI18n();
  const [reportLang, setReportLang] = useState('');
  const active = (reportLang || appCtx.lang) as LanguageCode;
  return (
    <I18nProvider language={active}>
      <ReportsInner reportLang={reportLang} setReportLang={setReportLang} currencySymbol={currencySymbol} />
    </I18nProvider>
  );
}

function ReportsInner({ reportLang, setReportLang, currencySymbol }: { reportLang: string; setReportLang: (l: string) => void; currencySymbol: string }) {
  const { t } = useI18n();
  const [reportType, setReportType] = useState<ReportType>('activities');
  const [filters, setFilters] = useState<TxFilters>({ ...EMPTY_TX_FILTERS });
  const [allProducts, setAllProducts] = useState<TagItem[]>([]);
  const [allCategories, setAllCategories] = useState<TagItem[]>([]);
  const [selProducts, setSelProducts] = useState<TagItem[]>([]);
  const [selCategories, setSelCategories] = useState<TagItem[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [categoryQuery, setCategoryQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<TxRow[]>([]);
  const [productRows, setProductRows] = useState<ProductRow[]>([]);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [printError, setPrintError] = useState<string | null>(null);
  const [bundleSimilar, setBundleSimilar] = useState(false);

  useEffect(() => {
    executeQuery('SELECT id, name, sku, category_id FROM products ORDER BY name')
      .then((r) => setAllProducts(r.rows.map((row) => ({ id: row[0] as number, name: row[1] as string, sku: row[2] as string | null, category_id: row[3] as number | null }))))
      .catch(() => {});
    executeQuery('SELECT id, name FROM categories ORDER BY name')
      .then((r) => setAllCategories(r.rows.map((row) => ({ id: row[0] as number, name: row[1] as string }))))
      .catch(() => {});
  }, []);

  const filteredProducts = useMemo(() => {
    if (!selCategories.length) return allProducts;
    const catIds = new Set(selCategories.map((c) => c.id));
    return allProducts.filter((p) => p.category_id != null && catIds.has(p.category_id));
  }, [allProducts, selCategories]);

  const toggleProduct = (item: TagItem) => {
    setSelProducts((prev) => {
      const next = prev.some((p) => p.id === item.id) ? prev.filter((p) => p.id !== item.id) : [...prev, item];
      set({ productIds: next.map((p) => p.id) });
      return next;
    });
  };

  const toggleCategory = (item: TagItem) => {
    setSelCategories((prev) => {
      const next = prev.some((c) => c.id === item.id) ? prev.filter((c) => c.id !== item.id) : [...prev, item];
      set({ categoryIds: next.map((c) => c.id) });
      return next;
    });
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (reportType === 'overall') {
        const productWhere = buildProductWhere(filters);
        const logDate = buildLogDateFilters(filters);
        const logJoin = logDate.length ? ` AND ${logDate.join(' AND ')}` : '';
        const batchWhere = buildBatchWhere(filters);
        const batchDate = buildBatchDateFilters(filters, 'b2');
        const batchSub = batchDate.length ? ` AND ${batchDate.join(' AND ')}` : '';
        const [products, batches] = await Promise.all([
          executeQuery(buildOverallSql(bundleSimilar, productWhere, logJoin, batchSub)),
          executeQuery(buildBatchDetailSql(batchWhere)),
        ]);
        setProductRows(products.rows.map((r) => ({
          id: r[0] as number,
          name: r[1] as string,
          sku: r[2] as string | null,
          category_name: r[3] as string,
          reorder_threshold: r[4] as number,
          base_unit_name: r[5] as string,
          total_purchased: r[6] as number,
          total_used: r[7] as number,
          total_spoiled: r[8] as number,
          current_stock: r[9] as number,
          stock_value: r[10] as number,
          money_spent: r[11] as number,
          batch_count: r[12] as number,
          batches_in_period: r[13] as number,
          suppliers_in_period: r[14] as number,
          provider_name: r[15] as string,
          batch_number: r[16] as string,
        })));
        setBatchRows(batches.rows.map((r) => ({
          batch_number: r[0] as string | null,
          product_name: r[1] as string,
          category_name: r[2] as string,
          supplier: r[3] as string | null,
          purchase_date: r[4] as string | null,
          unit_cost: r[5] as number,
          status: r[6] as string,
          batch_stock: r[7] as number,
        })));
      } else {
        const typeFilter = TYPE_REPORT_SQL[reportType] ?? null;
        const where = buildTxWhere(filters, typeFilter);
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const txResult = await executeQuery(`${TX_QUERY} ${whereSql} ORDER BY il.created_at ASC LIMIT 2000`);
        setRows(txResult.rows.map((r) => ({
          id: r[0] as number,
          created_at: r[1] as string,
          product_name: r[2] as string,
          sku: r[3] as string | null,
          batch_number: r[4] as string | null,
          quantity_change: r[5] as number,
          category_name: r[6] as string,
          provider_name: r[7] as string | null,
          provider_sub: r[8] as string | null,
          current_stock: r[9] as number,
          unit_cost: r[10] as number,
          transaction_type: r[11] as string,
        })));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [reportType, filters, bundleSimilar]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const set = (patch: Partial<TxFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const summary = summarizeTx(rows);
  const now = todayLocalISO();
  const totalUnits = productRows.reduce((s, p) => s + p.current_stock, 0);
  const totalValue = productRows.reduce((s, p) => s + p.stock_value, 0);
  const moneySpent = productRows.reduce((s, p) => s + p.money_spent, 0);
  const moneySpentTx = rows.reduce((s, r) => ((r.transaction_type === 'PURCHASE' || r.transaction_type === 'ADJUSTMENT') ? s + r.quantity_change * (r.unit_cost || 0) : s), 0);
  const lowStockCount = productRows.filter((p) => p.current_stock <= p.reorder_threshold && p.reorder_threshold > 0).length;
  const purchasedUnits = sumByType(rows, 'PURCHASE');
  const usedUnits = sumByType(rows, 'USAGE');
  const spoiledUnits = sumByType(rows, 'SPOILAGE');
  const adjustedUnits = sumByType(rows, 'ADJUSTMENT');
  const hasAdjustment = rows.some((r) => r.transaction_type === 'ADJUSTMENT');
  const totalPurchasedAll = productRows.reduce((s, p) => s + p.total_purchased, 0);
  const totalUsedAll = productRows.reduce((s, p) => s + p.total_used, 0);
  const totalSpoiledAll = productRows.reduce((s, p) => s + p.total_spoiled, 0);
  const batchesInPeriod = productRows.reduce((s, p) => s + p.batches_in_period, 0);
  const suppliersInPeriod = productRows.reduce((s, p) => s + p.suppliers_in_period, 0);

  const activeFilterParts: string[] = [];
  if (selProducts.length) activeFilterParts.push(`${t('reports.selectProducts')}: ${selProducts.map((p) => p.name).join(', ')}`);
  else if (filters.productFilter.trim()) activeFilterParts.push(`${t('reports.product')}: ${filters.productFilter.trim()}`);
  if (selCategories.length) activeFilterParts.push(`${t('reports.selectCategories')}: ${selCategories.map((c) => c.name).join(', ')}`);
  if (filters.fromDate) activeFilterParts.push(`${t('reports.from')}: ${filters.fromDate}${filters.fromTime ? ' ' + filters.fromTime : ''}`);
  if (filters.toDate) activeFilterParts.push(`${t('reports.to')}: ${filters.toDate}${filters.toTime ? ' ' + filters.toTime : ''}`);

  const units = useMemo<Unit[]>(() => {
    const u: Unit[] = [{ kind: 'header', key: 'header' }];
    if (reportType === 'overall') {
      if (productRows.length === 0) {
        u.push({ kind: 'nodata', key: 'nodata' });
      } else {
        u.push({ kind: 'h2count', key: 'h2count' });
        for (const r of productRows) u.push({ kind: 'prodrow', key: `pr-${r.id}`, data: r });
        u.push({ kind: 'h2summary', key: 'h2summary' });
        u.push({ kind: 'gridOverall', key: 'gridOverall' });
        if (batchRows.length) {
          u.push({ kind: 'h2batch', key: 'h2batch' });
          batchRows.forEach((r, i) => u.push({ kind: 'batchrow', key: `br-${i}`, data: r }));
        }
      }
    } else if (rows.length === 0) {
      u.push({ kind: 'nodata', key: 'nodata' });
    } else {
      for (const r of rows) u.push({ kind: 'txrow', key: `tx-${r.id}`, data: r });
      u.push({ kind: 'h2summary', key: 'h2summary' });
      u.push({ kind: 'gridTx', key: 'gridTx' });
    }
    u.push({ kind: 'footer', key: 'footer' });
    return u;
  }, [reportType, rows, productRows, batchRows]);

  const [pages, setPages] = useState<Unit[][]>([]);
  const measureRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el || loading) return;
    const heights = Array.from(el.querySelectorAll<HTMLElement>('[data-unit]')).map((m) => m.offsetHeight);
    const result: Unit[][] = [];
    let cur: number[] = [];
    let curH = 0;
    for (let i = 0; i < units.length; i++) {
      const h = heights[i] ?? 0;
      if (cur.length && curH + h > PAGE_CONTENT_H) {
        const last = units[cur[cur.length - 1]];
        if (last.kind === 'h2count' || last.kind === 'h2summary' || last.kind === 'h2batch') {
          const li = cur.pop()!;
          curH -= heights[li] ?? 0;
        }
        result.push(cur.map((ci) => units[ci]));
        cur = [];
        curH = 0;
      }
      cur.push(i);
      curH += h;
    }
    if (cur.length) result.push(cur.map((ci) => units[ci]));
    setPages(result);
  }, [units, loading]);

  const renderTxRow = (row: TxRow) => (
    <tr key={row.id} data-unit className="border-b border-gray-100">
      <DateTimeCell value={row.created_at} />
      <td className="py-1.5 col-indent text-gray-600">{row.category_name}</td>
      <td className="py-1.5 col-indent text-gray-600 font-mono">{row.sku || '-'}</td>
      <td className="py-1.5 col-indent text-gray-600 font-mono">{row.batch_number || '-'}</td>
      <td className="py-1.5 col-indent-sm text-gray-900">{row.product_name}</td>
      <td className="py-1.5 text-right font-mono text-gray-900">{Math.round(row.current_stock)}</td>
      <td className="py-1.5 notes-cell text-gray-600">
        {row.provider_name ? `${row.provider_name}${row.provider_sub ? ` - ${row.provider_sub}` : ''}` : '-'}
      </td>
    </tr>
  );

  const renderProdRow = (row: ProductRow) => (
    <tr key={`${row.id}-${row.batch_number}-${row.provider_name}`} data-unit className="border-b border-gray-100">
      <td className="py-1.5 text-gray-900">{row.name}</td>
      <td className="py-1.5 text-gray-600">{row.category_name}</td>
      <td className="py-1.5 text-gray-600 font-mono">{row.sku || '-'}</td>
      {!bundleSimilar && (
        <>
          <td className="py-1.5 text-gray-600 font-mono">{row.batch_number || '-'}</td>
          <td className="py-1.5 text-gray-600">{row.provider_name || '-'}</td>
        </>
      )}
      <td className="py-1.5 text-right font-mono text-gray-700">{row.total_purchased}</td>
      <td className="py-1.5 text-right font-mono text-gray-700">{row.total_used}</td>
      <td className="py-1.5 text-right font-mono text-gray-700">{row.total_spoiled}</td>
      <td className={`py-1.5 text-right font-mono ${row.current_stock <= row.reorder_threshold && row.reorder_threshold > 0 ? 'font-bold text-red-700' : 'text-gray-900'}`}>
        {row.current_stock}
        {row.current_stock <= row.reorder_threshold && row.reorder_threshold > 0 && ` (${t('dash.stock.status.low')})`}
      </td>
      <td className="py-1.5 text-right font-mono text-gray-900">{currencySymbol}{row.stock_value.toFixed(2)}</td>
    </tr>
  );

  const renderBatchRow = (row: BatchRow) => (
    <tr key={row.batch_number || row.product_name} data-unit className="border-b border-gray-100">
      <td className="py-1.5 text-gray-900">{row.product_name}</td>
      <td className="py-1.5 text-gray-600 font-mono">{row.batch_number || '-'}</td>
      <td className="py-1.5 text-gray-600">{row.supplier || '-'}</td>
      <td className="py-1.5 text-gray-600">{fmtDate(row.purchase_date).slice(0, 10)}</td>
      <td className="py-1.5 text-right font-mono text-gray-700">{currencySymbol}{Number(row.unit_cost).toFixed(2)}</td>
      <td className="py-1.5 text-right font-mono text-gray-900">{row.batch_stock}</td>
      <td className="py-1.5 text-gray-600 capitalize">{t(`common.status.${row.status}`)}</td>
    </tr>
  );

  const renderBlock = (u: Unit): ReactNode => {
    if (u.kind === 'header') {
      return (
        <div data-unit className="flex items-center gap-4 pb-6 border-b-2 border-gray-200 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t(`reports.type.${reportType}`)}</h1>
            <p className="text-sm text-gray-500">
              {t('reports.title')} · {t('preport.reportTitle')}
            </p>
            {activeFilterParts.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">{activeFilterParts.join(' · ')}</p>
            )}
          </div>
          <div className="ml-auto text-right text-xs text-gray-400">
            <p>{t('preport.generated', { date: now })}</p>
          </div>
        </div>
      );
    }
    if (u.kind === 'nodata') {
      return <p data-unit className="text-sm text-gray-500 text-center py-10">{t('reports.noData')}</p>;
    }
    if (u.kind === 'h2count') {
      return <h2 data-unit className="text-lg font-bold text-gray-900 mb-3 pb-1 border-b border-gray-200">{t('reports.productsCount', { count: productRows.length })}</h2>;
    }
    if (u.kind === 'h2summary') {
      return <h2 data-unit className="text-lg font-bold text-gray-900 mb-3 pb-1 border-b border-gray-200">{t('reports.summary')}</h2>;
    }
    if (u.kind === 'h2batch') {
      return <h2 data-unit className="text-lg font-bold text-gray-900 mb-3 pb-1 border-b border-gray-200">{t('reports.batchDetail')}</h2>;
    }
    if (u.kind === 'gridTx') {
      return (
        <div data-unit className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-2 mb-6">
          <div className="flex justify-between items-center py-1.5 border-b border-gray-200">
            <span className="text-sm text-gray-600">{t('reports.totalEntries')}</span>
            <span className="text-sm font-mono text-gray-900">{rows.length}</span>
          </div>
          <div className="flex justify-between items-center py-1.5 border-b border-gray-200">
            <span className="text-sm text-gray-600">{t('reports.netChange')}</span>
            <span className="text-sm font-mono text-gray-900">{summary}</span>
          </div>
          <div className="flex justify-between items-center py-1.5 border-b border-gray-200">
            <span className="text-sm text-gray-600">{t('reports.moneySpent')}</span>
            <span className="text-sm font-mono text-gray-900">{currencySymbol}{moneySpentTx.toFixed(2)}</span>
          </div>
          <div className="flex justify-between items-center py-1.5 border-b border-gray-200">
            <span className="text-sm text-gray-600">{t('reports.purchased')}</span>
            <span className="text-sm font-mono text-gray-900">{purchasedUnits}</span>
          </div>
          <div className="flex justify-between items-center py-1.5 border-b border-gray-200">
            <span className="text-sm text-gray-600">{t('reports.used')}</span>
            <span className="text-sm font-mono text-gray-900">{usedUnits}</span>
          </div>
          <div className="flex justify-between items-center py-1.5 border-b border-gray-200">
            <span className="text-sm text-gray-600">{t('reports.spoiled')}</span>
            <span className="text-sm font-mono text-gray-900">{spoiledUnits}</span>
          </div>
          <div className="flex justify-between items-center py-1.5 border-b border-gray-200">
            <span className="text-sm text-gray-600">{t('reports.adjusted')}</span>
            <span className="text-sm font-mono text-gray-900">{adjustedUnits}</span>
          </div>
        </div>
      );
    }
    if (u.kind === 'gridOverall') {
      return (
        <div data-unit className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-2 mb-6">
          <div className="flex justify-between items-center py-1.5 border-b border-gray-200">
            <span className="text-sm text-gray-600">{t('dash.sum.totalProducts')}</span>
            <span className="text-sm font-mono text-gray-900">{productRows.length}</span>
          </div>
          <div className="flex justify-between items-center py-1.5 border-b border-gray-200">
            <span className="text-sm text-gray-600">{t('dash.sum.totalUnits')}</span>
            <span className="text-sm font-mono text-gray-900">{totalUnits}</span>
          </div>
          <div className="flex justify-between items-center py-1.5 border-b border-gray-200">
            <span className="text-sm text-gray-600">{t('pie.header.invValue')}</span>
            <span className="text-sm font-mono text-gray-900">{currencySymbol}{totalValue.toFixed(2)}</span>
          </div>
          <div className="flex justify-between items-center py-1.5 border-b border-gray-200">
            <span className="text-sm text-gray-600">{t('reports.moneySpent')}</span>
            <span className="text-sm font-mono text-gray-900">{currencySymbol}{moneySpent.toFixed(2)}</span>
          </div>
          <div className="flex justify-between items-center py-1.5 border-b border-gray-200">
            <span className="text-sm text-gray-600">{t('reports.lowStockCount', { count: lowStockCount })}</span>
            <span className="text-sm font-mono text-gray-900">{lowStockCount}</span>
          </div>
          <div className="flex justify-between items-center py-1.5 border-b border-gray-200">
            <span className="text-sm text-gray-600">{t('reports.purchased')}</span>
            <span className="text-sm font-mono text-gray-900">{totalPurchasedAll}</span>
          </div>
          <div className="flex justify-between items-center py-1.5 border-b border-gray-200">
            <span className="text-sm text-gray-600">{t('reports.used')}</span>
            <span className="text-sm font-mono text-gray-900">{totalUsedAll}</span>
          </div>
          <div className="flex justify-between items-center py-1.5 border-b border-gray-200">
            <span className="text-sm text-gray-600">{t('reports.spoiled')}</span>
            <span className="text-sm font-mono text-gray-900">{totalSpoiledAll}</span>
          </div>
          <div className="flex justify-between items-center py-1.5 border-b border-gray-200">
            <span className="text-sm text-gray-600">{t('reports.batchesInPeriod')}</span>
            <span className="text-sm font-mono text-gray-900">{batchesInPeriod}</span>
          </div>
          <div className="flex justify-between items-center py-1.5 border-b border-gray-200">
            <span className="text-sm text-gray-600">{t('reports.suppliersInPeriod')}</span>
            <span className="text-sm font-mono text-gray-900">{suppliersInPeriod}</span>
          </div>
        </div>
      );
    }
    return <div data-unit className="pt-4 border-t border-gray-200 text-center text-[10px] text-gray-400">{t('preport.generatedBy', { date: now })}</div>;
  };

  const renderRow = (u: Unit): ReactNode => {
    if (u.kind === 'txrow') return renderTxRow(u.data as TxRow);
    if (u.kind === 'prodrow') return renderProdRow(u.data as ProductRow);
    return renderBatchRow(u.data as BatchRow);
  };

  const renderGroup = (list: Unit[]): ReactNode => {
    const out: ReactNode[] = [];
    let open: { kind: 'tx' | 'products' | 'batches'; rows: ReactNode[] } | null = null;
    const flush = (key: string) => {
      if (!open) return;
      const { kind, rows } = open;
      const head =
        kind === 'tx' ? (
          <>
            {reportType === 'activities' && hasAdjustment && (
              <caption className="text-left text-[10px] text-gray-400 pb-1">{t('reports.adjustNote')}</caption>
            )}
            <colgroup>
              <col style={{ width: '14.28%' }} />
              <col style={{ width: '14.28%' }} />
              <col style={{ width: '14.28%' }} />
              <col style={{ width: '14.28%' }} />
              <col style={{ width: '14.28%' }} />
              <col style={{ width: '14.28%' }} />
              <col style={{ width: '14.28%' }} />
            </colgroup>
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-1.5 text-gray-500 font-medium">{t('logs.col.date')}</th>
                <th className="text-left py-1.5 col-indent text-gray-500 font-medium">{t('dash.stock.category')}</th>
                <th className="text-left py-1.5 col-indent text-gray-500 font-medium">{t('logs.col.sku')}</th>
                <th className="text-left py-1.5 col-indent text-gray-500 font-medium">{t('logs.col.batch')}</th>
                <th className="text-left py-1.5 col-indent-sm text-gray-500 font-medium">{t('logs.col.product')}</th>
                <th className="text-right py-1.5 text-gray-500 font-medium">{t('dash.stock.current')}</th>
                <th className="text-left py-1.5 notes-cell text-gray-500 font-medium">{t('logs.col.provider')}</th>
              </tr>
            </thead>
          </>
        ) : kind === 'products' ? (
          <>
            <colgroup>
              <col style={{ width: bundleSimilar ? '12.5%' : '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: bundleSimilar ? '12.5%' : '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-1.5 text-gray-500 font-medium">{t('logs.col.product')}</th>
                <th className="text-left py-1.5 text-gray-500 font-medium">{t('dash.stock.category')}</th>
                <th className="text-left py-1.5 text-gray-500 font-medium">{t('detail.sku')}</th>
                {!bundleSimilar && (
                  <>
                    <th className="text-left py-1.5 text-gray-500 font-medium">{t('logs.col.batch')}</th>
                    <th className="text-left py-1.5 text-gray-500 font-medium">{t('logs.col.provider')}</th>
                  </>
                )}
                <th className="text-right py-1.5 text-gray-500 font-medium">{t('reports.purchased')}</th>
                <th className="text-right py-1.5 text-gray-500 font-medium">{t('reports.used')}</th>
                <th className="text-right py-1.5 text-gray-500 font-medium">{t('reports.spoiled')}</th>
                <th className="text-right py-1.5 text-gray-500 font-medium">{t('dash.stock.current')}</th>
                <th className="text-right py-1.5 text-gray-500 font-medium">{t('pie.header.invValue')}</th>
              </tr>
            </thead>
          </>
        ) : (
          <>
            <colgroup>
              <col style={{ width: '14.28%' }} />
              <col style={{ width: '14.28%' }} />
              <col style={{ width: '14.28%' }} />
              <col style={{ width: '14.28%' }} />
              <col style={{ width: '14.28%' }} />
              <col style={{ width: '14.28%' }} />
              <col style={{ width: '14.28%' }} />
            </colgroup>
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-1.5 text-gray-500 font-medium">{t('logs.col.product')}</th>
                <th className="text-left py-1.5 text-gray-500 font-medium">{t('logs.col.batch')}</th>
                <th className="text-left py-1.5 text-gray-500 font-medium">{t('batch.col.supplier')}</th>
                <th className="text-left py-1.5 text-gray-500 font-medium">{t('preport.date')}</th>
                <th className="text-right py-1.5 text-gray-500 font-medium">{t('batch.col.unitCost')}</th>
                <th className="text-right py-1.5 text-gray-500 font-medium">{t('reports.batchStock')}</th>
                <th className="text-left py-1.5 text-gray-500 font-medium">{t('preport.status')}</th>
              </tr>
            </thead>
          </>
        );
      out.push(
        <table key={key} className="w-full text-xs mb-6" style={{ tableLayout: 'fixed' }}>
          {head}
          <tbody>{rows}</tbody>
        </table>
      );
      open = null;
    };
    list.forEach((u) => {
      const tk = TABLE_KIND[u.kind];
      if (tk) {
        if (!open || open.kind !== tk) {
          flush(`${tk}-${u.key}`);
          open = { kind: tk, rows: [] };
        }
        open.rows.push(renderRow(u));
      } else {
        flush(`b-${u.key}`);
        out.push(renderBlock(u));
      }
    });
    flush('end');
    return <>{out}</>;
  };

  return (
    <div className="h-full flex flex-col">
      <style>{`
        .report-page {
          width: 210mm;
          height: 297mm;
          padding: 14mm 15mm 22mm;
          margin: 16px auto;
          overflow: hidden;
        }
        .report-measure {
          position: absolute;
          left: -10000px;
          top: 0;
          width: 210mm;
          padding: 14mm 15mm 22mm;
          visibility: hidden;
        }
        .report-print td, .report-print th, .report-measure td, .report-measure th {
          padding: 7px 15px !important;
          line-height: 1.5;
        }
          .report-print .notes-cell, .report-measure .notes-cell { padding-left: 40px !important; }
          .report-print .col-indent, .report-measure .col-indent { padding-left: 30px !important; }
          .report-print .col-indent-sm, .report-measure .col-indent-sm { padding-left: 20px !important; }
        .report-print table, .report-measure table { font-size: 11px; border-collapse: collapse; }
        @media print {
          @page { size: A4 portrait; margin: 0; }
          html, body, #root { height: auto !important; overflow: visible !important; margin: 0 !important; }
          .h-screen, .h-full { height: auto !important; overflow: visible !important; }
          .report-scroll { overflow: visible !important; height: auto !important; padding: 0 !important; }
          .report-page { margin: 0 auto !important; box-shadow: none !important; }
          .report-measure { display: none !important; }
          .report-print h1 { font-size: 24px !important; }
          .report-print h2 { font-size: 15px !important; margin: 22px 0 10px !important; }
          .report-print th, .report-measure th { padding: 5px 15px !important; }
          .report-print td, .report-measure td { padding: 6px 15px !important; vertical-align: top; word-break: normal; overflow-wrap: break-word; }
        .report-print .notes-cell, .report-measure .notes-cell { padding-left: 40px !important; }
        .report-print .col-indent, .report-measure .col-indent { padding-left: 30px !important; }
        .report-print .col-indent-sm, .report-measure .col-indent-sm { padding-left: 20px !important; }
          .report-print .grid { gap: 4px 28px !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      {/* Controls (not printed) */}
      <div className="no-print px-6 py-4 border-b border-border bg-bg-secondary shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-text-primary">{t('reports.title')}</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchData}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-xs text-text-secondary transition-colors"
            >
              <RefreshCw size={12} />
            </button>
            <button
              onClick={() => {
                setPrintError(null);
                printDom('.report-print').catch((e) => {
                  console.error('Print failed:', e);
                  setPrintError(e instanceof Error ? e.message : String(e));
                });
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover rounded-md text-xs text-white"
            >
              <Printer size={12} /> {t('reports.print')}
            </button>
          </div>
          {printError && (
            <p className="text-xs text-error mb-2 break-words">{printError}</p>
          )}
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-secondary">{t('reports.printLang')}</label>
            <select
              value={reportLang}
              onChange={(e) => setReportLang(e.target.value)}
              className="px-2 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
            >
              <option value="">{t('reports.appDefault')}</option>
              {LANGS.filter((l) => l.code !== 'system').map((l) => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-secondary">{t('reports.type')}</label>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value as ReportType)}
              className="px-2 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
            >
              {REPORT_TYPES.map((rt) => (
                <option key={rt} value={rt}>{t(`reports.type.${rt}`)}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-secondary">{t('reports.selectProducts')}</label>
            <TagSelect
              items={filteredProducts}
              selected={selProducts}
              search={productQuery}
              onSearchChange={(q) => {
                setProductQuery(q);
                set({ productFilter: q });
              }}
              onToggle={toggleProduct}
              placeholder={t('reports.selectProducts')}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-secondary">{t('reports.selectCategories')}</label>
            <TagSelect
              items={allCategories}
              selected={selCategories}
              search={categoryQuery}
              onSearchChange={setCategoryQuery}
              onToggle={toggleCategory}
              placeholder={t('reports.selectCategories')}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-secondary">{t('reports.from')}</label>
            <input
              type="date"
              value={filters.fromDate}
              onChange={(e) => set({ fromDate: e.target.value })}
              className="px-2 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-secondary">{t('reports.to')}</label>
            <input
              type="date"
              value={filters.toDate}
              onChange={(e) => set({ toDate: e.target.value })}
              className="px-2 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
            />
          </div>
          <button
            onClick={() => {
              const to = todayLocalISO();
              const d = new Date();
              d.setDate(d.getDate() - 6);
              const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              set({ fromDate: from, toDate: to, fromTime: '', toTime: '' });
            }}
            className="px-2 py-1 bg-bg-tertiary hover:bg-bg-hover border border-border rounded text-xs text-text-secondary hover:text-text-primary transition-colors"
          >
            {t('reports.last7Days')}
          </button>
          {reportType === 'overall' && (
            <button
              onClick={() => setBundleSimilar((v) => !v)}
              className={`px-2 py-1 border rounded text-xs transition-colors ${
                bundleSimilar
                  ? 'bg-accent text-white border-accent'
                  : 'bg-bg-tertiary hover:bg-bg-hover border-border text-text-secondary hover:text-text-primary'
              }`}
            >
              {t('reports.bundleAll')}
            </button>
          )}
        </div>
      </div>

      {/* Printable report */}
      <div className="flex-1 overflow-y-auto report-scroll px-6 py-4">
        <div ref={measureRef} className="report-measure" aria-hidden="true">
          {renderGroup(units)}
        </div>
        {loading ? (
          <div className="flex items-center justify-center h-full text-text-secondary text-sm">{t('logs.loading')}</div>
        ) : (
          pages.map((page, pi) => (
            <div key={pi} className="report-print report-page bg-white text-gray-900">
              {renderGroup(page)}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
