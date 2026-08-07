export type ReportType = 'activities' | 'purchased' | 'used' | 'spoiled' | 'adjusted' | 'overall';

export const TYPE_REPORT_SQL: Record<string, string> = {
  purchased: 'PURCHASE',
  used: 'USAGE',
  spoiled: 'SPOILAGE',
  adjusted: 'ADJUSTMENT',
};

export const TYPE_REPORTS: ReportType[] = Object.keys(TYPE_REPORT_SQL) as ReportType[];

export interface TxRow {
  id: number;
  created_at: string;
  product_name: string;
  sku: string | null;
  batch_number: string | null;
  quantity_change: number;
  category_name: string;
  provider_name: string | null;
  provider_sub: string | null;
  current_stock: number;
  unit_cost: number;
  transaction_type: string;
}

export interface ProductInfo {
  id: number;
  name: string;
  sku: string | null;
}

export interface TxFilters {
  productIds: number[];
  productFilter: string;
  categoryIds: number[];
  fromDate: string;
  fromTime: string;
  toDate: string;
  toTime: string;
}

export const EMPTY_TX_FILTERS: TxFilters = {
  productIds: [],
  productFilter: '',
  categoryIds: [],
  fromDate: '',
  fromTime: '',
  toDate: '',
  toTime: '',
};

export function buildLogDateFilters(f: TxFilters): string[] {
  const parts: string[] = [];
  if (f.fromDate) {
    parts.push(`datetime(il.created_at) >= '${f.fromDate}${f.fromTime ? ' ' + f.fromTime : ''}'`);
  }
  if (f.toDate) {
    if (f.toTime) {
      parts.push(`datetime(il.created_at) <= '${f.toDate} ${f.toTime.length === 5 ? f.toTime + ':59' : f.toTime}'`);
    } else {
      parts.push(`datetime(il.created_at) < date('${f.toDate}', '+1 day')`);
    }
  }
  return parts;
}

export function buildTxWhere(f: TxFilters, type: string | null = null): string[] {
  const parts: string[] = [];
  if (type) {
    parts.push(`il.transaction_type = '${type}'`);
  }
  if (f.productIds.length) {
    parts.push(`b.product_id IN (${f.productIds.join(', ')})`);
  } else {
    const product = f.productFilter.trim();
    if (product) {
      parts.push(`p.name LIKE '%${product.replace(/'/g, "''")}%'`);
    }
  }
  if (f.categoryIds.length) {
    parts.push(`p.category_id IN (${f.categoryIds.join(', ')})`);
  }
  return parts.concat(buildLogDateFilters(f));
}

export function buildProductWhere(f: TxFilters): string {
  const parts: string[] = [];
  if (f.productIds.length) {
    parts.push(`p.id IN (${f.productIds.join(', ')})`);
  } else {
    const product = f.productFilter.trim();
    if (product) {
      parts.push(`p.name LIKE '%${product.replace(/'/g, "''")}%'`);
    }
  }
  if (f.categoryIds.length) {
    parts.push(`p.category_id IN (${f.categoryIds.join(', ')})`);
  }
  const batchDates = buildBatchDateFilters(f, 'b2');
  if (batchDates.length) {
    parts.push(`p.id IN (SELECT b2.product_id FROM batches b2 WHERE ${batchDates.join(' AND ')})`);
  }
  return parts.length ? `WHERE ${parts.join(' AND ')}` : '';
}

export function buildBatchWhere(f: TxFilters): string {
  const parts: string[] = [];
  if (f.productIds.length) {
    parts.push(`b.product_id IN (${f.productIds.join(', ')})`);
  } else {
    const product = f.productFilter.trim();
    if (product) {
      parts.push(`b.product_id IN (SELECT id FROM products WHERE name LIKE '%${product.replace(/'/g, "''")}%')`);
    }
  }
  if (f.categoryIds.length) {
    parts.push(`b.product_id IN (SELECT id FROM products WHERE category_id IN (${f.categoryIds.join(', ')}))`);
  }
  return parts.length ? `WHERE ${parts.join(' AND ')}` : '';
}

export function buildBatchDateFilters(f: TxFilters, alias: string): string[] {
  const parts: string[] = [];
  if (f.fromDate) {
    parts.push(`${alias}.purchase_date >= '${f.fromDate}'`);
  }
  if (f.toDate) {
    parts.push(`${alias}.purchase_date < date('${f.toDate}', '+1 day')`);
  }
  return parts;
}

export function sumByType(rows: TxRow[], type: string): number {
  return rows
    .filter((r) => r.transaction_type === type)
    .reduce((s, r) => s + Math.abs(r.quantity_change), 0);
}

export function rankProducts(products: ProductInfo[], query: string): ProductInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [...products].sort((a, b) => a.name.localeCompare(b.name));
  }
  const score = (p: ProductInfo): number => {
    const name = p.name.toLowerCase();
    const sku = (p.sku || '').toLowerCase();
    if (name.startsWith(q)) return 0;
    if (sku.startsWith(q)) return 1;
    if (name.includes(q)) return 2000 + name.indexOf(q);
    if (sku.includes(q)) return 3000 + sku.indexOf(q);
    return -1;
  };
  return products
    .filter((p) => score(p) >= 0)
    .sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
}

export function summarizeTx(rows: TxRow[]): number {
  return rows.reduce((s, r) => s + r.quantity_change, 0);
}
