export type ReportType = 'transactions' | 'overall';

export interface TxRow {
  id: number;
  created_at: string;
  product_name: string;
  sku: string | null;
  batch_number: string | null;
  quantity_change: number;
  category_name: string;
  provider_name: string | null;
}

export interface ProductInfo {
  id: number;
  name: string;
  sku: string | null;
}

export interface TxFilters {
  productId: number | null;
  productFilter: string;
  fromDate: string;
  fromTime: string;
  toDate: string;
  toTime: string;
}

export const EMPTY_TX_FILTERS: TxFilters = {
  productId: null,
  productFilter: '',
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

export function buildTxWhere(f: TxFilters): string[] {
  const parts: string[] = ["il.transaction_type = 'PURCHASE'"];
  if (f.productId != null) {
    parts.push(`b.product_id = ${f.productId}`);
  } else {
    const product = f.productFilter.trim();
    if (product) {
      parts.push(`p.name LIKE '%${product.replace(/'/g, "''")}%'`);
    }
  }
  return parts.concat(buildLogDateFilters(f));
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
