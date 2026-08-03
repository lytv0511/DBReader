import { describe, it, expect } from 'vitest';
import { parseNaturalLanguage } from '../components/inventory/QuickUse';

describe('parseNaturalLanguage', () => {
  it('parses quantity + category', () => {
    const p = parseNaturalLanguage('4 red wine');
    expect(p.quantity).toBe(4);
    expect(p.categoryFilter).toBe('Red Wine');
  });

  it('parses batch filter from LOT code', () => {
    const p = parseNaturalLanguage('2 merlot from batch LOT-2024-001');
    expect(p.batchFilter).toBe('LOT-2024-001');
    expect(p.searchTerm).toBe('merlot');
  });

  it('parses single supplier', () => {
    const p = parseNaturalLanguage('wine from pacific wines ltd');
    expect(p.supplierFilters).toEqual(['pacific wines ltd']);
  });

  it('parses multiple suppliers without swallowing origin/vintage', () => {
    const p = parseNaturalLanguage('4 red wines closest to expiration from pacific or grand cru from italy with at least 4 years vintage');
    expect(p.supplierFilters).toEqual(['pacific', 'grand cru']);
    expect(p.attributeFilters.some((f) => f.key === 'origin' && f.value === 'italy')).toBe(true);
    expect(p.attributeFilters.some((f) => f.key === 'vintage')).toBe(true);
    expect(p.sortByExpiry).toBe(true);
  });

  it('keeps grape separate from supplier', () => {
    const p = parseNaturalLanguage('white wine from france grape chardonnay');
    expect(p.supplierFilters).toEqual(['france']);
    expect(p.attributeFilters.some((f) => f.key === 'grape' && f.value === 'chardonnay')).toBe(true);
  });

  it('parses date filter from month', () => {
    const p = parseNaturalLanguage('sparkling from January');
    expect(p.locationFilter).toMatch(/^\d{4}-01-%$/);
  });

  it('parses location from cellar', () => {
    const p = parseNaturalLanguage('3 red wine from cellar');
    expect(p.locationFilter).toBe('cellar');
  });

  it('parses word quantity into category', () => {
    const p = parseNaturalLanguage('any 6 spirits');
    expect(p.quantity).toBe(6);
    expect(p.categoryFilter).toBe('Spirits');
  });

  it('parses category from color', () => {
    const p = parseNaturalLanguage('4 red wine');
    expect(p.categoryFilter).toBe('Red Wine');
  });

  it('handles empty input', () => {
    const p = parseNaturalLanguage('');
    expect(p.quantity).toBe(0);
    expect(p.searchTerm).toBe('');
  });
});
