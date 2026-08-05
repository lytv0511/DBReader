import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect, type ReactNode } from 'react';
import { Printer, RefreshCw } from 'lucide-react';
import { executeQuery } from '../../lib/db';
import { printDom } from '../../lib/print';
import { todayLocalISO } from '../../lib/dates';
import { useI18n, I18nProvider } from '../../lib/language';
import { LANGS } from '../../lib/i18n';
import type { LanguageCode } from '../../types';
import { buildTxWhere, buildLogDateFilters, summarizeTx, EMPTY_TX_FILTERS, type ReportType, type TxRow, type TxFilters, type ProductInfo } from '../../lib/reports';
import ProductSelect from './ProductSelect';

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
  batch_count: number;
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

const REPORT_TYPES: ReportType[] = ['transactions', 'overall'];

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
    pr.name AS provider_name
  FROM inventory_logs il
  JOIN batches b ON il.batch_id = b.id
  JOIN products p ON b.product_id = p.id
  LEFT JOIN categories c ON p.category_id = c.id
  LEFT JOIN providers pr ON il.provider_id = pr.id
`;

const buildOverallSql = (productWhere: string, logJoin: string, logSub: string) => `
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
    COALESCE((
      SELECT SUM(il3.quantity_change * b3.unit_cost)
      FROM inventory_logs il3
      JOIN batches b3 ON il3.batch_id = b3.id
      WHERE b3.product_id = p.id${logSub}
    ), 0) AS stock_value,
    COUNT(DISTINCT b.id) AS batch_count
  FROM products p
  LEFT JOIN categories c ON p.category_id = c.id
  LEFT JOIN batches b ON b.product_id = p.id
  LEFT JOIN inventory_logs il ON il.batch_id = b.id${logJoin}
  ${productWhere}
  GROUP BY p.id, p.name, p.sku, c.name, p.reorder_threshold, p.base_unit_name
  ORDER BY c.name, p.name
`;

const buildBatchDetailSql = (where: string) => `
  SELECT
    b.batch_number,
    p.name AS product_name,
    COALESCE(c.name, 'Uncategorized') AS category_name,
    b.supplier,
    b.purchase_date,
    b.unit_cost,
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
  const [d, tm] = s.split(' ');
  return (
    <td className="py-1.5 text-gray-600 whitespace-nowrap">
      {d}
      {tm && <span className="block text-[10px] text-gray-400">{tm}</span>}
    </td>
  );
};

export default function Reports() {
  const appCtx = useI18n();
  const [reportLang, setReportLang] = useState('');
  const active = (reportLang || appCtx.lang) as LanguageCode;
  return (
    <I18nProvider language={active}>
      <ReportsInner reportLang={reportLang} setReportLang={setReportLang} />
    </I18nProvider>
  );
}

function ReportsInner({ reportLang, setReportLang }: { reportLang: string; setReportLang: (l: string) => void }) {
  const { t } = useI18n();
  const [reportType, setReportType] = useState<ReportType>('transactions');
  const [filters, setFilters] = useState<TxFilters>({ ...EMPTY_TX_FILTERS });
  const [selectedProduct, setSelectedProduct] = useState<ProductInfo | null>(null);
  const [productQuery, setProductQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<TxRow[]>([]);
  const [productRows, setProductRows] = useState<ProductRow[]>([]);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (reportType === 'overall') {
        const productWhere = filters.productId != null ? `WHERE p.id = ${filters.productId}` : '';
        const logDate = buildLogDateFilters(filters);
        const logJoin = logDate.length ? ` AND ${logDate.join(' AND ')}` : '';
        const logSub = logDate.length ? ` AND ${logDate.join(' AND ').replaceAll('il.', 'il3.')}` : '';
        const batchWhere = filters.productId != null ? `WHERE b.product_id = ${filters.productId}` : '';
        const [products, batches] = await Promise.all([
          executeQuery(buildOverallSql(productWhere, logJoin, logSub)),
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
          batch_count: r[11] as number,
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
        const where = buildTxWhere(filters);
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
        })));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [reportType, filters]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const set = (patch: Partial<TxFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const summary = summarizeTx(rows);
  const now = todayLocalISO();
  const totalUnits = productRows.reduce((s, p) => s + p.current_stock, 0);
  const totalValue = productRows.reduce((s, p) => s + p.stock_value, 0);
  const lowStockCount = productRows.filter((p) => p.current_stock <= p.reorder_threshold && p.reorder_threshold > 0).length;

  const activeFilterParts: string[] = [];
  if (selectedProduct) activeFilterParts.push(`${t('reports.product')}: ${selectedProduct.name}`);
  else if (filters.productFilter.trim()) activeFilterParts.push(`${t('reports.product')}: ${filters.productFilter.trim()}`);
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
      <td className="py-1.5 text-gray-600">{row.category_name}</td>
      <td className="py-1.5 text-gray-900">{row.product_name}</td>
      <td className="py-1.5 text-gray-600 font-mono">{row.batch_number || '-'}</td>
      <td className="py-1.5 text-right font-mono text-gray-900">{row.quantity_change >= 0 ? '+' : ''}{row.quantity_change}</td>
      <td className="py-1.5 notes-cell text-gray-600">{row.provider_name || '-'}</td>
    </tr>
  );

  const renderProdRow = (row: ProductRow) => (
    <tr key={row.id} data-unit className="border-b border-gray-100">
      <td className="py-1.5 text-gray-900">{row.name}</td>
      <td className="py-1.5 text-gray-600">{row.category_name}</td>
      <td className="py-1.5 text-gray-600 font-mono">{row.sku || '-'}</td>
      <td className="py-1.5 text-right font-mono text-gray-700">{row.total_purchased}</td>
      <td className="py-1.5 text-right font-mono text-gray-700">{row.total_used}</td>
      <td className="py-1.5 text-right font-mono text-gray-700">{row.total_spoiled}</td>
      <td className={`py-1.5 text-right font-mono ${row.current_stock <= row.reorder_threshold && row.reorder_threshold > 0 ? 'font-bold text-red-700' : 'text-gray-900'}`}>
        {row.current_stock}
        {row.current_stock <= row.reorder_threshold && row.reorder_threshold > 0 && ` (${t('dash.stock.status.low')})`}
      </td>
      <td className="py-1.5 text-right font-mono text-gray-900">${row.stock_value.toFixed(2)}</td>
    </tr>
  );

  const renderBatchRow = (row: BatchRow) => (
    <tr key={row.batch_number || row.product_name} data-unit className="border-b border-gray-100">
      <td className="py-1.5 text-gray-900">{row.product_name}</td>
      <td className="py-1.5 text-gray-600 font-mono">{row.batch_number || '-'}</td>
      <td className="py-1.5 text-gray-600">{row.supplier || '-'}</td>
      <td className="py-1.5 text-gray-600">{fmtDate(row.purchase_date).slice(0, 10)}</td>
      <td className="py-1.5 text-right font-mono text-gray-700">${Number(row.unit_cost).toFixed(2)}</td>
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
        <div data-unit className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-6">
          <div className="flex justify-between py-1 border-b border-gray-100">
            <span className="text-sm text-gray-600">{t('reports.totalEntries')}</span>
            <span className="text-sm font-mono text-gray-900">{rows.length}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-gray-100">
            <span className="text-sm text-gray-600">{t('reports.purchased')}</span>
            <span className="text-sm font-mono text-gray-900">{summary}</span>
          </div>
        </div>
      );
    }
    if (u.kind === 'gridOverall') {
      return (
        <div data-unit className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
          <div className="flex justify-between py-1 border-b border-gray-100">
            <span className="text-sm text-gray-600">{t('dash.sum.totalProducts')}</span>
            <span className="text-sm font-mono text-gray-900">{productRows.length}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-gray-100">
            <span className="text-sm text-gray-600">{t('dash.sum.totalUnits')}</span>
            <span className="text-sm font-mono text-gray-900">{totalUnits}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-gray-100">
            <span className="text-sm text-gray-600">{t('pie.header.invValue')}</span>
            <span className="text-sm font-mono text-gray-900">${totalValue.toFixed(2)}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-gray-100">
            <span className="text-sm text-gray-600">{t('reports.lowStockCount', { count: lowStockCount })}</span>
            <span className="text-sm font-mono text-gray-900">{lowStockCount}</span>
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
            <colgroup>
              <col style={{ width: '14%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '26%' }} />
            </colgroup>
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-1.5 text-gray-500 font-medium">{t('logs.col.date')}</th>
                <th className="text-left py-1.5 text-gray-500 font-medium">{t('dash.stock.category')}</th>
                <th className="text-left py-1.5 text-gray-500 font-medium">{t('logs.col.product')}</th>
                <th className="text-left py-1.5 text-gray-500 font-medium">{t('logs.col.batch')}</th>
                <th className="text-right py-1.5 text-gray-500 font-medium">{t('logs.col.qtyChange')}</th>
                <th className="text-left py-1.5 notes-cell text-gray-500 font-medium">{t('logs.col.provider')}</th>
              </tr>
            </thead>
          </>
        ) : kind === 'products' ? (
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-1.5 text-gray-500 font-medium">{t('logs.col.product')}</th>
              <th className="text-left py-1.5 text-gray-500 font-medium">{t('dash.stock.category')}</th>
              <th className="text-left py-1.5 text-gray-500 font-medium">{t('detail.sku')}</th>
              <th className="text-right py-1.5 text-gray-500 font-medium">{t('reports.purchased')}</th>
              <th className="text-right py-1.5 text-gray-500 font-medium">{t('reports.used')}</th>
              <th className="text-right py-1.5 text-gray-500 font-medium">{t('reports.spoiled')}</th>
              <th className="text-right py-1.5 text-gray-500 font-medium">{t('dash.stock.current')}</th>
              <th className="text-right py-1.5 text-gray-500 font-medium">{t('pie.header.invValue')}</th>
            </tr>
          </thead>
        ) : (
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
        );
      out.push(
        <table key={key} className="w-full text-xs mb-6" style={kind === 'tx' ? { tableLayout: 'fixed' } : undefined}>
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
          padding: 8px 10px !important;
          line-height: 1.55;
        }
        .report-print .notes-cell, .report-measure .notes-cell { padding-left: 44px !important; }
        .report-print table, .report-measure table { font-size: 12px; border-collapse: collapse; }
        @media print {
          @page { size: A4 portrait; margin: 0; }
          html, body, #root { height: auto !important; overflow: visible !important; margin: 0 !important; }
          .h-screen, .h-full { height: auto !important; overflow: visible !important; }
          .report-scroll { overflow: visible !important; height: auto !important; padding: 0 !important; }
          .report-page { margin: 0 auto !important; box-shadow: none !important; }
          .report-measure { display: none !important; }
          .report-print h1 { font-size: 24px !important; }
          .report-print h2 { font-size: 15px !important; margin: 22px 0 10px !important; }
          .report-print th, .report-measure th { padding: 6px 10px !important; }
          .report-print td, .report-measure td { padding: 7px 10px !important; vertical-align: top; word-break: normal; overflow-wrap: break-word; }
          .report-print .notes-cell, .report-measure .notes-cell { padding-left: 44px !important; }
          .report-print .grid { gap: 2px 28px !important; }
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
              onClick={() => printDom('.report-print')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent-hover rounded-md text-xs text-white"
            >
              <Printer size={12} /> {t('reports.print')}
            </button>
          </div>
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
            <label className="text-xs text-text-secondary">{t('reports.product')}:</label>
            <ProductSelect
              query={productQuery}
              selected={selectedProduct}
              onQueryChange={(q) => {
                setProductQuery(q);
                if (q.trim()) {
                  set({ productId: null, productFilter: q });
                } else {
                  set({ productFilter: '' });
                }
              }}
              onSelect={(p) => {
                setSelectedProduct(p);
                set({ productId: p ? p.id : null, productFilter: '' });
              }}
            />
          </div>
          {reportType === 'transactions' && (
            <>
              <div className="flex items-center gap-2">
                <label className="text-xs text-text-secondary">{t('reports.from')}</label>
                <input
                  type="date"
                  value={filters.fromDate}
                  onChange={(e) => set({ fromDate: e.target.value })}
                  className="px-2 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
                />
                <input
                  type="time"
                  value={filters.fromTime}
                  onChange={(e) => set({ fromTime: e.target.value })}
                  title={t('reports.time')}
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
                <input
                  type="time"
                  value={filters.toTime}
                  onChange={(e) => set({ toTime: e.target.value })}
                  title={t('reports.time')}
                  className="px-2 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
            </>
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
