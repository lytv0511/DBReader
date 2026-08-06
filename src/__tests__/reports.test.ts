import { describe, it, expect } from 'vitest';
import { buildTxWhere, buildLogDateFilters, buildProductWhere, buildBatchWhere, summarizeTx, rankProducts, EMPTY_TX_FILTERS, type TxRow } from '../lib/reports';

describe('buildTxWhere', () => {
  it('returns no type restriction for empty filters', () => {
    expect(buildTxWhere({ ...EMPTY_TX_FILTERS })).toEqual([]);
  });

  it('escapes single quotes in the product filter', () => {
    const parts = buildTxWhere({ ...EMPTY_TX_FILTERS, productFilter: "O'Brien" });
    expect(parts).toEqual(["p.name LIKE '%O''Brien%'"]);
  });

  it('builds from/to date filters inclusive of the end day', () => {
    const parts = buildTxWhere({ ...EMPTY_TX_FILTERS, fromDate: '2026-01-01', toDate: '2026-08-04' });
    expect(parts).toEqual([
      "datetime(il.created_at) >= '2026-01-01'",
      "datetime(il.created_at) < date('2026-08-04', '+1 day')",
    ]);
  });

  it('uses 00:00:00 start when from has a date and time', () => {
    const parts = buildTxWhere({ ...EMPTY_TX_FILTERS, fromDate: '2026-08-01', fromTime: '09:30' });
    expect(parts).toEqual(["datetime(il.created_at) >= '2026-08-01 09:30'"]);
  });

  it('uses start of day when from has a date but no time', () => {
    const parts = buildTxWhere({ ...EMPTY_TX_FILTERS, fromDate: '2026-08-01' });
    expect(parts).toEqual(["datetime(il.created_at) >= '2026-08-01'"]);
  });

  it('uses end of the given time when to has a date and time', () => {
    const parts = buildTxWhere({ ...EMPTY_TX_FILTERS, toDate: '2026-08-04', toTime: '17:45' });
    expect(parts).toEqual(["datetime(il.created_at) <= '2026-08-04 17:45:59'"]);
  });

  it('uses inclusive end of day when to has a date but no time', () => {
    const parts = buildTxWhere({ ...EMPTY_TX_FILTERS, toDate: '2026-08-04' });
    expect(parts).toEqual(["datetime(il.created_at) < date('2026-08-04', '+1 day')"]);
  });

  it('builds full from/to range with times', () => {
    const parts = buildTxWhere({
      ...EMPTY_TX_FILTERS, fromDate: '2026-08-01', fromTime: '09:30', toDate: '2026-08-04', toTime: '17:45',
    });
    expect(parts).toEqual([
      "datetime(il.created_at) >= '2026-08-01 09:30'",
      "datetime(il.created_at) <= '2026-08-04 17:45:59'",
    ]);
  });

  it('prefers productIds over the text filter', () => {
    const parts = buildTxWhere({ ...EMPTY_TX_FILTERS, productIds: [7], productFilter: 'Wine' });
    expect(parts).toEqual(['b.product_id IN (7)']);
  });

  it('filters by multiple products and categories', () => {
    const parts = buildTxWhere({ ...EMPTY_TX_FILTERS, productIds: [1, 3], categoryIds: [2, 5] });
    expect(parts).toEqual(['b.product_id IN (1, 3)', 'p.category_id IN (2, 5)']);
  });

  it('filters by transaction type when provided', () => {
    const parts = buildTxWhere({ ...EMPTY_TX_FILTERS }, 'USAGE');
    expect(parts).toEqual(["il.transaction_type = 'USAGE'"]);
  });

  it('combines type and multi-select filters', () => {
    const parts = buildTxWhere({ ...EMPTY_TX_FILTERS, categoryIds: [2] }, 'SPOILAGE');
    expect(parts).toEqual(["il.transaction_type = 'SPOILAGE'", 'p.category_id IN (2)']);
  });

  it('ignores times without their date', () => {
    const parts = buildTxWhere({ ...EMPTY_TX_FILTERS, fromTime: '09:30', toTime: '17:45' });
    expect(parts).toEqual([]);
  });
});

describe('buildProductWhere / buildBatchWhere', () => {
  it('builds product id and category filters', () => {
    expect(buildProductWhere({ ...EMPTY_TX_FILTERS, productIds: [1, 2], categoryIds: [3] }))
      .toBe('WHERE p.id IN (1, 2) AND p.category_id IN (3)');
  });

  it('falls back to a name LIKE filter', () => {
    expect(buildProductWhere({ ...EMPTY_TX_FILTERS, productFilter: "O'Brien" }))
      .toBe("WHERE p.name LIKE '%O''Brien%'");
  });

  it('returns empty when no filters', () => {
    expect(buildProductWhere({ ...EMPTY_TX_FILTERS })).toBe('');
    expect(buildBatchWhere({ ...EMPTY_TX_FILTERS })).toBe('');
  });

  it('restricts products to batches purchased within the date window', () => {
    expect(buildProductWhere({ ...EMPTY_TX_FILTERS, fromDate: '2026-01-01', toDate: '2026-08-04' }))
      .toBe("WHERE p.id IN (SELECT b2.product_id FROM batches b2 WHERE b2.purchase_date >= '2026-01-01' AND b2.purchase_date < date('2026-08-04', '+1 day'))");
  });

  it('builds batch where from category ids via subquery', () => {
    expect(buildBatchWhere({ ...EMPTY_TX_FILTERS, categoryIds: [2] }))
      .toBe('WHERE b.product_id IN (SELECT id FROM products WHERE category_id IN (2))');
  });
});

describe('buildLogDateFilters', () => {
  it('returns empty when no dates are set', () => {
    expect(buildLogDateFilters({ ...EMPTY_TX_FILTERS })).toEqual([]);
  });

  it('builds from/to parts with times', () => {
    expect(buildLogDateFilters({
      ...EMPTY_TX_FILTERS, fromDate: '2026-08-01', fromTime: '09:30', toDate: '2026-08-04', toTime: '17:45',
    })).toEqual([
      "datetime(il.created_at) >= '2026-08-01 09:30'",
      "datetime(il.created_at) <= '2026-08-04 17:45:59'",
    ]);
  });

  it('defaults to end of day for a to-date without a time', () => {
    expect(buildLogDateFilters({ ...EMPTY_TX_FILTERS, toDate: '2026-08-04' })).toEqual([
      "datetime(il.created_at) < date('2026-08-04', '+1 day')",
    ]);
  });
});

describe('rankProducts', () => {
  const products = [
    { id: 1, name: 'Red Wine', sku: 'RW-001' },
    { id: 2, name: 'White Wine', sku: 'WW-001' },
    { id: 3, name: 'Cooking Wine', sku: 'CW-001' },
    { id: 4, name: 'Apples', sku: 'AP-001' },
  ];

  it('ranks starts-with names first, then substrings by earliest index', () => {
    const ranked = rankProducts(products, 'wine');
    expect(ranked.map((p) => p.id)).toEqual([1, 2, 3]);
  });

  it('matches sku when name does not contain the query', () => {
    const ranked = rankProducts(products, 'rw-001');
    expect(ranked.map((p) => p.id)).toEqual([1]);
  });

  it('is case-insensitive', () => {
    const ranked = rankProducts(products, 'WINE');
    expect(ranked.map((p) => p.id)).toEqual([1, 2, 3]);
  });

  it('returns all products for an empty query in alphabetical order', () => {
    const ranked = rankProducts(products, '');
    expect(ranked.map((p) => p.id)).toEqual([4, 3, 1, 2]);
  });

  it('returns an empty list when nothing matches', () => {
    expect(rankProducts(products, 'zzz')).toEqual([]);
  });
});

describe('summarizeTx', () => {
  const row = (qty: number, type = 'PURCHASE'): TxRow => ({
    id: 1, created_at: '2026-01-01 10:00:00',
    product_name: 'Wine', sku: null, batch_number: null, quantity_change: qty,
    category_name: 'Beverages', provider_name: null, unit_cost: 0, transaction_type: type,
  });

  it('returns the net quantity change', () => {
    expect(summarizeTx([row(12), row(3)])).toBe(15);
  });

  it('returns zero for empty input', () => {
    expect(summarizeTx([])).toBe(0);
  });
});
