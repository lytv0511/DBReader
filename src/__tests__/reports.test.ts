import { describe, it, expect } from 'vitest';
import { buildTxWhere, buildLogDateFilters, summarizeTx, rankProducts, EMPTY_TX_FILTERS, type TxRow } from '../lib/reports';

describe('buildTxWhere', () => {
  it('always restricts to PURCHASE (imports) transactions', () => {
    expect(buildTxWhere({ ...EMPTY_TX_FILTERS })).toEqual(["il.transaction_type = 'PURCHASE'"]);
  });

  it('escapes single quotes in the product filter', () => {
    const parts = buildTxWhere({ ...EMPTY_TX_FILTERS, productFilter: "O'Brien" });
    expect(parts).toEqual(["il.transaction_type = 'PURCHASE'", "p.name LIKE '%O''Brien%'"]);
  });

  it('builds from/to date filters inclusive of the end day', () => {
    const parts = buildTxWhere({ ...EMPTY_TX_FILTERS, fromDate: '2026-01-01', toDate: '2026-08-04' });
    expect(parts).toEqual([
      "il.transaction_type = 'PURCHASE'",
      "datetime(il.created_at) >= '2026-01-01'",
      "datetime(il.created_at) < date('2026-08-04', '+1 day')",
    ]);
  });

  it('uses 00:00:00 start when from has a date and time', () => {
    const parts = buildTxWhere({ ...EMPTY_TX_FILTERS, fromDate: '2026-08-01', fromTime: '09:30' });
    expect(parts).toEqual(["il.transaction_type = 'PURCHASE'", "datetime(il.created_at) >= '2026-08-01 09:30'"]);
  });

  it('uses start of day when from has a date but no time', () => {
    const parts = buildTxWhere({ ...EMPTY_TX_FILTERS, fromDate: '2026-08-01' });
    expect(parts).toEqual(["il.transaction_type = 'PURCHASE'", "datetime(il.created_at) >= '2026-08-01'"]);
  });

  it('uses end of the given time when to has a date and time', () => {
    const parts = buildTxWhere({ ...EMPTY_TX_FILTERS, toDate: '2026-08-04', toTime: '17:45' });
    expect(parts).toEqual(["il.transaction_type = 'PURCHASE'", "datetime(il.created_at) <= '2026-08-04 17:45:59'"]);
  });

  it('uses inclusive end of day when to has a date but no time', () => {
    const parts = buildTxWhere({ ...EMPTY_TX_FILTERS, toDate: '2026-08-04' });
    expect(parts).toEqual(["il.transaction_type = 'PURCHASE'", "datetime(il.created_at) < date('2026-08-04', '+1 day')"]);
  });

  it('builds full from/to range with times', () => {
    const parts = buildTxWhere({
      ...EMPTY_TX_FILTERS, fromDate: '2026-08-01', fromTime: '09:30', toDate: '2026-08-04', toTime: '17:45',
    });
    expect(parts).toEqual([
      "il.transaction_type = 'PURCHASE'",
      "datetime(il.created_at) >= '2026-08-01 09:30'",
      "datetime(il.created_at) <= '2026-08-04 17:45:59'",
    ]);
  });

  it('prefers productId over the text filter', () => {
    const parts = buildTxWhere({ ...EMPTY_TX_FILTERS, productId: 7, productFilter: 'Wine' });
    expect(parts).toEqual(["il.transaction_type = 'PURCHASE'", 'b.product_id = 7']);
  });

  it('ignores times without their date', () => {
    const parts = buildTxWhere({ ...EMPTY_TX_FILTERS, fromTime: '09:30', toTime: '17:45' });
    expect(parts).toEqual(["il.transaction_type = 'PURCHASE'"]);
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
  const row = (qty: number): TxRow => ({
    id: 1, created_at: '2026-01-01 10:00:00',
    product_name: 'Wine', sku: null, batch_number: null, quantity_change: qty,
    category_name: 'Beverages', provider_name: null,
  });

  it('returns the net quantity change', () => {
    expect(summarizeTx([row(12), row(3)])).toBe(15);
  });

  it('returns zero for empty input', () => {
    expect(summarizeTx([])).toBe(0);
  });
});
