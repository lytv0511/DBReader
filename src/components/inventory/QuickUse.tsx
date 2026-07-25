import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, Plus, Minus, Search, Check, Code, X } from 'lucide-react';
import { executeQuery } from '../../lib/db';

interface MatchedItem {
  product_id: number;
  product_name: string;
  sku: string | null;
  batch_id: number;
  batch_number: string | null;
  batch_date: string | null;
  supplier: string | null;
  current_stock: number;
  category_name: string;
  selected: boolean;
}

interface ParsedQuery {
  quantity: number;
  searchTerm: string;
  batchFilter: string;
  categoryFilter: string;
  supplierFilters: string[];
  locationFilter: string;
  attributeFilters: { key: string; op: string; value: string }[];
  sortByExpiry: boolean;
  rawInput: string;
}

const SAMPLE_PROMPTS = [
  '4 red wine',
  '2 merlot from batch LOT-2024-001',
  'wine from pacific wines ltd',
  'bottles of Dom Perignon',
  'sparkling from January',
  'any 6 spirits',
  '4 red wines closest to expiration from pacific or grand cru from italy with at least 4 years vintage',
  'white wine from france grape chardonnay',
];

function parseNaturalLanguage(input: string): ParsedQuery {
  const raw = input.trim();
  if (!raw) return { quantity: 0, searchTerm: '', batchFilter: '', categoryFilter: '', supplierFilters: [], locationFilter: '', attributeFilters: [], sortByExpiry: false, rawInput: raw };

  let quantity = 0;
  let searchTerm = '';
  let batchFilter = '';
  let categoryFilter = '';
  const supplierFilters: string[] = [];
  let locationFilter = '';
  const attributeFilters: { key: string; op: string; value: string }[] = [];
  let sortByExpiry = false;

  const currentYear = new Date().getFullYear();

  // Extract quantity — first number or word-number
  const wordNums: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, dozen: 12,
  };
  const numMatch = raw.match(/^(\d+|any\s+(\d+)|dozen)\b/i);
  if (numMatch) {
    if (numMatch[2]) {
      quantity = parseInt(numMatch[2], 10);
    } else if (numMatch[1].toLowerCase() === 'dozen') {
      quantity = 12;
    } else {
      quantity = parseInt(numMatch[1], 10);
    }
  } else {
    for (const [word, num] of Object.entries(wordNums)) {
      if (raw.toLowerCase().startsWith(word)) {
        quantity = num;
        break;
      }
    }
  }

  let cleaned = raw
    .replace(/^(any\s+)?(\d+|dozen|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*/i, '')
    .replace(/^(bottles?\s+(?:of\s+)?|cans?\s+(?:of\s+)?|cases?\s+(?:of\s+)?)\s*/i, '')
    .trim();

  // Extract "closest to expiration" / "nearest expiry" / "expiring soon"
  if (/\b(closest\s+to\s+expir|nearest\s+expir|expir\w*\s+soon|soonest|earliest\s+expir)\b/i.test(cleaned)) {
    sortByExpiry = true;
    cleaned = cleaned.replace(/\b(closest\s+to\s+expir|nearest\s+expir|expir\w*\s+soon|soonest|earliest\s+expir)\b/i, '').trim();
  }

  // Extract batch filter — "from batch X" or "from LOT-XXX"
  const batchMatch = cleaned.match(/(?:from\s+(?:the\s+)?(?:batch\s+)?)(LOT-[\w-]+)/i);
  if (batchMatch) {
    batchFilter = batchMatch[1];
    cleaned = cleaned.replace(batchMatch[0], '').trim();
  }

  // Extract date filter — "from January", "from June 27", "from 2024"
  const dateMatch = cleaned.match(/(?:from\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{1,2}))?(?:\s*,?\s*(\d{4}))?/i);
  if (dateMatch) {
    const monthNames: Record<string, string> = {
      january: '01', february: '02', march: '03', april: '04',
      may: '05', june: '06', july: '07', august: '08',
      september: '09', october: '10', november: '11', december: '12',
    };
    const month = monthNames[dateMatch[1].toLowerCase()];
    const day = dateMatch[2] ? dateMatch[2].padStart(2, '0') : '%';
    const year = dateMatch[3] || currentYear;
    locationFilter = `${year}-${month}-${day}`;
    cleaned = cleaned.replace(dateMatch[0], '').trim();
  }

  // Extract location filter — "from cellar", "from warehouse"
  const locMatch = cleaned.match(/(?:from\s+)?(cellar|warehouse|cold\s*storage)/i);
  if (locMatch) {
    locationFilter = locMatch[1].replace(/\s+/g, ' ').trim();
    cleaned = cleaned.replace(locMatch[0], '').trim();
  }

  // Extract category filter — match both full and partial names
  const categoryAliases: [RegExp, string][] = [
    [/\b(?:red\s*wine|reds?)\b/i, 'Red Wine'],
    [/\b(?:white\s*wine|whites?)\b/i, 'White Wine'],
    [/\b(?:ros[eé]s?)\b/i, 'Rosé'],
    [/\b(?:sparkling|champagne|prosecco|cava)\b/i, 'Sparkling'],
    [/\b(?:fortified|port|sherry|madeira)\b/i, 'Fortified'],
    [/\b(?:spirits?|liquor|vodka|whisky|whiskey|gin|rum|tequila|brandy)\b/i, 'Spirits'],
    [/\b(?:beer|ale|lager|stout|ipa)\b/i, 'Beer'],
    [/\b(?:tobacco|cigars?)\b/i, 'Tobacco'],
    [/\b(?:accessories?)\b/i, 'Accessories'],
  ];
  for (const [pattern, catName] of categoryAliases) {
    const match = cleaned.match(pattern);
    if (match) {
      categoryFilter = catName;
      cleaned = cleaned.replace(match[0], '').trim();
      break;
    }
  }

  // Extract vintage filter — "at least 4 years vintage", "vintage 2020", "from 2019", "5 year old"
  const vintagePatterns: [RegExp, { key: string; op: string; value: string }][] = [
    [/\b(?:at\s+least|over|more\s+than|min(?:imum)?\.?)\s+(\d+)\s+years?\s+vintage\b/i, { key: 'vintage', op: '>=', value: '' }],
    [/\b(?:at\s+least|over|more\s+than|min(?:imum)?\.?)\s+(\d+)\s+years?\s+old\b/i, { key: 'vintage', op: '>=', value: '' }],
    [/\bvintage\s+(?:of\s+)?(\d{4})\b/i, { key: 'vintage', op: '=', value: '' }],
    [/\bvintage\s+(\d{4})\b/i, { key: 'vintage', op: '=', value: '' }],
    [/\b(\d{4})\s+vintage\b/i, { key: 'vintage', op: '=', value: '' }],
    [/\bless\s+than\s+(\d+)\s+years?\s+vintage\b/i, { key: 'vintage', op: '<=', value: '' }],
    [/\bless\s+than\s+(\d+)\s+years?\s+old\b/i, { key: 'vintage', op: '<=', value: '' }],
    [/\b(\d+)\s+year\s+old\b/i, { key: 'vintage', op: '>=', value: '' }],
  ];
  for (const [pattern, filter] of vintagePatterns) {
    const match = cleaned.match(pattern);
    if (match) {
      if (filter.op === '=' || filter.op === '>=' && match[2]) {
        filter.value = match[1];
      } else if (filter.op === '>=' || filter.op === '<=') {
        const years = parseInt(match[1], 10);
        filter.value = String(currentYear - years);
      }
      attributeFilters.push(filter);
      cleaned = cleaned.replace(match[0], '').trim();
      break;
    }
  }

  // Extract attribute filters — "from italy", "grape cabernet", "region burgundy", "type dry"
  const attrPatterns: [RegExp, string][] = [
    [/\b(?:from|origin(?:ally)?\s+(?:from|in)?)\s+(?!batch|the|january|february|march|april|may|june|july|august|september|october|november|december|cellar|warehouse)([a-zA-Z][\w\s]*?)(?=\s+(?:and|that|with|who|from|grape|region|type|batch|closest|expir)|\s*$)/i, 'origin'],
    [/\b(?:grape|varietal|variety)\s+([a-zA-Z][\w\s]*?)(?=\s+(?:and|that|with|who|from|region|type|batch|closest|expir)|\s*$)/i, 'grape'],
    [/\b(?:region|appellation)\s+([a-zA-Z][\w\s]*?)(?=\s+(?:and|that|with|who|from|grape|type|batch|closest|expir)|\s*$)/i, 'region'],
    [/\b(?:type|style)\s+([a-zA-Z][\w\s]*?)(?=\s+(?:and|that|with|who|from|grape|region|batch|closest|expir)|\s*$)/i, 'type'],
    [/\b(?:organic|biodynamic|natural)\b/i, 'organic'],
  ];
  for (const [pattern, attrKey] of attrPatterns) {
    const match = cleaned.match(pattern);
    if (match) {
      if (attrKey === 'organic') {
        attributeFilters.push({ key: 'organic', op: '=', value: 'true' });
        cleaned = cleaned.replace(match[0], '').trim();
      } else {
        const val = match[1]?.trim();
        if (val) {
          attributeFilters.push({ key: attrKey, op: 'LIKE', value: val });
          cleaned = cleaned.replace(match[0], '').trim();
        }
      }
    }
  }

  // Extract supplier filter — "from pacific or grand cru" → multiple suppliers
  // Also "from pacific wines ltd" → single supplier
  const supplierMatch = cleaned.match(/\bfrom\s+(.+?)$/i);
  if (supplierMatch) {
    const rawSupplier = supplierMatch[1].trim();
    // Check for "X or Y" pattern — multiple suppliers
    const orMatch = rawSupplier.match(/^(.+?)\s+or\s+(.+?)$/i);
    if (orMatch) {
      supplierFilters.push(orMatch[1].trim(), orMatch[2].trim());
    } else {
      supplierFilters.push(rawSupplier);
    }
    cleaned = cleaned.replace(supplierMatch[0], '').trim();
  }

  // Clean up remaining filler words
  searchTerm = cleaned
    .replace(/^(of|the|a|an|and|or|any|all|some|from|bottle|bottles|that|are|with|who|minimum|at|least|years?|old|vintage)\s+/i, '')
    .replace(/\s+(of|the|a|an|and|or|any|all|some|from|bottle|bottles|that|are|with|who|minimum|at|least|years?|old|vintage)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!quantity) quantity = 1;

  return { quantity, searchTerm, batchFilter, categoryFilter, supplierFilters, locationFilter, attributeFilters, sortByExpiry, rawInput: raw };
}

function buildSearchSQL(parsed: ParsedQuery): string {
  const hasExpiry = parsed.attributeFilters.some((f) => f.key === 'expiry');

  let sql = `
    SELECT
      b.id AS batch_id,
      b.batch_number,
      b.purchase_date AS batch_date,
      b.supplier_name AS supplier,
      p.id AS product_id,
      p.name AS product_name,
      p.sku,
      COALESCE(c.name, 'Uncategorized') AS category_name,
      COALESCE(SUM(il.quantity_change), 0) AS current_stock
      ${hasExpiry ? ', MIN(CASE WHEN pa.attr_key = \'expiry\' THEN pa.attr_value END) AS nearest_expiry' : ''}
    FROM batches b
    JOIN products p ON b.product_id = p.id
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN inventory_logs il ON il.batch_id = b.id
  `;

  // Join product_attributes for each unique attribute key we need
  const attrKeys = [...new Set(parsed.attributeFilters.map((f) => f.key))];
  for (let i = 0; i < attrKeys.length; i++) {
    sql += ` LEFT JOIN product_attributes pa${i} ON pa${i}.product_id = p.id AND pa${i}.attr_key = '${attrKeys[i]}'`;
  }

  sql += ` WHERE 1=1`;

  if (parsed.searchTerm) {
    const term = parsed.searchTerm.replace(/'/g, "''");
    sql += ` AND (p.name LIKE '%${term}%' OR p.sku LIKE '%${term}%' OR p.name LIKE '%${term.split(' ').join('%')}%')`;
  }

  if (parsed.batchFilter) {
    const bf = parsed.batchFilter.replace(/'/g, "''");
    sql += ` AND b.batch_number LIKE '%${bf}%'`;
  }

  if (parsed.categoryFilter) {
    const cf = parsed.categoryFilter.replace(/'/g, "''");
    sql += ` AND LOWER(c.name) = LOWER('${cf}')`;
  }

  // Multiple suppliers with OR logic
  if (parsed.supplierFilters.length > 0) {
    const supplierConditions = parsed.supplierFilters
      .map((sf) => `LOWER(b.supplier_name) LIKE '%${sf.replace(/'/g, "''").toLowerCase()}%'`)
      .join(' OR ');
    sql += ` AND (${supplierConditions})`;
  }

  if (parsed.locationFilter && parsed.locationFilter.includes('-')) {
    sql += ` AND b.purchase_date LIKE '${parsed.locationFilter}%'`;
  } else if (parsed.locationFilter) {
    sql += ` AND (l.name LIKE '%${parsed.locationFilter.replace(/'/g, "''")}%' OR l.sub_location LIKE '%${parsed.locationFilter.replace(/'/g, "''")}%')`;
    if (!sql.includes('LEFT JOIN locations')) {
      sql = sql.replace('LEFT JOIN inventory_logs il', 'LEFT JOIN locations l ON il.location_id = l.id\n    LEFT JOIN inventory_logs il');
    }
  }

  // Attribute filters
  for (let i = 0; i < attrKeys.length; i++) {
    const key = attrKeys[i];
    const filtersForKey = parsed.attributeFilters.filter((f) => f.key === key);
    const conditions = filtersForKey.map((f) => {
      const val = f.value.replace(/'/g, "''");
      if (f.op === 'LIKE') {
        return `LOWER(pa${i}.attr_value) LIKE '%${val.toLowerCase()}%'`;
      }
      // For numeric comparisons, cast attr_value to real
      if (f.op === '=' || f.op === '>=' || f.op === '<=' || f.op === '>' || f.op === '<') {
        return `CAST(pa${i}.attr_value AS REAL) ${f.op} ${Number(val)}`;
      }
      return `pa${i}.attr_value ${f.op} '${val}'`;
    });
    sql += ` AND (${conditions.join(' AND ')})`;
  }

  sql += ` GROUP BY b.id, b.batch_number, b.purchase_date, b.supplier_name, p.id, p.name, p.sku, c.name`;
  sql += ` HAVING current_stock > 0`;

  if (parsed.sortByExpiry && hasExpiry) {
    sql += ` ORDER BY nearest_expiry ASC NULLS LAST, p.name`;
  } else {
    sql += ` ORDER BY p.name, b.purchase_date DESC`;
  }

  sql += ` LIMIT 50`;

  return sql;
}

interface QuickUseProps {
  onRefresh?: () => void;
}

export default function QuickUse({ onRefresh }: QuickUseProps) {
  const [mode, setMode] = useState<'use' | 'add'>('use');
  const [queryInput, setQueryInput] = useState('');
  const [parsed, setParsed] = useState<ParsedQuery | null>(null);
  const [sqlPreview, setSqlPreview] = useState('');
  const [results, setResults] = useState<MatchedItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [qty, setQty] = useState('1');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  const handleSearch = useCallback(async () => {
    if (!queryInput.trim()) {
      setParsed(null);
      setSqlPreview('');
      setResults([]);
      return;
    }

    const p = parseNaturalLanguage(queryInput);
    setParsed(p);
    const sql = buildSearchSQL(p);
    setSqlPreview(sql);

    setSearching(true);
    setError(null);
    try {
      const result = await executeQuery(sql);
      const items: MatchedItem[] = result.rows.map((r) => ({
        batch_id: r[0] as number,
        batch_number: r[1] as string | null,
        batch_date: r[2] as string | null,
        supplier: r[3] as string | null,
        product_id: r[4] as number,
        product_name: r[5] as string,
        sku: r[6] as string | null,
        category_name: r[7] as string,
        current_stock: r[8] as number,
        selected: false,
      }));
      setResults(items);
    } catch (err) {
      setError(String(err));
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [queryInput]);

  // Re-search on input change with debounce
  useEffect(() => {
    if (!queryInput.trim()) {
      setParsed(null);
      setSqlPreview('');
      setResults([]);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(handleSearch, 300);
    return () => { clearTimeout(debounceRef.current); };
  }, [queryInput, handleSearch]);

  const toggleItem = (batchId: number) => {
    setResults((prev) =>
      prev.map((item) =>
        item.batch_id === batchId ? { ...item, selected: !item.selected } : item
      )
    );
  };

  const selectAll = () => {
    setResults((prev) => prev.map((item) => ({ ...item, selected: true })));
  };

  const deselectAll = () => {
    setResults((prev) => prev.map((item) => ({ ...item, selected: false })));
  };

  const selectedItems = results.filter((r) => r.selected);

  const handleSubmit = async () => {
    const qtyNum = Number(qty);
    if (selectedItems.length === 0 || qtyNum <= 0) return;

    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      for (const item of selectedItems) {
        const adjustedQty = mode === 'use'
          ? -Math.abs(qtyNum)
          : Math.abs(qtyNum);

        const notesVal = notes.trim()
          ? `'${notes.trim().replace(/'/g, "''")}'`
          : `'Quick ${mode === 'use' ? 'Usage' : 'Purchase'} via search'`;

        await executeQuery(`
          INSERT INTO inventory_logs (batch_id, location_id, quantity_change, transaction_type, notes)
          VALUES (${item.batch_id}, NULL, ${adjustedQty}, '${mode === 'use' ? 'USAGE' : 'PURCHASE'}', ${notesVal})
        `);
      }

      const totalQty = qtyNum * selectedItems.length;
      setSuccessMsg(
        `${mode === 'use' ? 'Removed' : 'Added'} ${totalQty} unit${totalQty !== 1 ? 's' : ''} from ${selectedItems.length} item${selectedItems.length !== 1 ? 's' : ''}`
      );

      // Reset selection and re-search to refresh stock levels
      setResults((prev) => prev.map((item) => ({ ...item, selected: false })));
      setQty('1');
      setNotes('');
      await handleSearch();
      onRefresh?.();

      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const txActiveBg = mode === 'use' ? 'bg-warning text-white border-warning' : 'bg-success text-white border-success';
  const txHoverBg = mode === 'use' ? 'hover:bg-warning/20' : 'hover:bg-success/20';

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Mode toggle + search bar */}
      <div className="border-b border-border bg-bg-secondary px-6 py-4 shrink-0">
        <div className="flex items-center gap-4">
          {/* Use / Add toggle */}
          <div className="flex bg-bg-primary border border-border rounded-lg overflow-hidden shrink-0">
            <button
              onClick={() => setMode('use')}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold transition-colors ${
                mode === 'use' ? txActiveBg : `text-text-secondary ${txHoverBg}`
              }`}
            >
              <Minus size={14} />
              Use
            </button>
            <button
              onClick={() => setMode('add')}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold transition-colors ${
                mode === 'add' ? txActiveBg : `text-text-secondary ${txHoverBg}`
              }`}
            >
              <Plus size={14} />
              Add
            </button>
          </div>

          {/* Search input */}
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              ref={inputRef}
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter') { clearTimeout(debounceRef.current); handleSearch(); } }}
              placeholder="Search like: 4 red wine, 2 merlot from batch LOT-2024-001, any 6 sparkling..."
              className="w-full pl-9 pr-4 py-2.5 bg-bg-primary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent"
            />
            {queryInput && (
              <button
                onClick={() => { setQueryInput(''); setResults([]); setParsed(null); setSqlPreview(''); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Sample prompts */}
        {!queryInput && (
          <div className="flex gap-2 mt-3 flex-wrap">
            {SAMPLE_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                onClick={() => setQueryInput(prompt)}
                className="px-3 py-1 bg-bg-primary border border-border rounded-full text-[11px] text-text-secondary hover:text-text-primary hover:border-accent/50 transition-colors"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {searching ? (
            <div className="flex items-center justify-center h-full text-text-secondary">
              <RefreshCw size={16} className="animate-spin mr-2" />
              Searching...
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-text-secondary">
              <Search size={32} className="mb-3 opacity-30" />
              <p className="text-sm">
                {queryInput ? 'No items match your search' : 'Type a search query to find inventory items'}
              </p>
            </div>
          ) : (
            <div>
              {/* Results header */}
              <div className="sticky top-0 bg-bg-primary border-b border-border px-4 py-2 flex items-center justify-between z-10">
                <span className="text-xs text-text-secondary">
                  {results.length} item{results.length !== 1 ? 's' : ''} found
                  {selectedItems.length > 0 && (
                    <span className="ml-2 text-accent font-semibold">
                      · {selectedItems.length} selected
                    </span>
                  )}
                </span>
                <div className="flex gap-2">
                  <button onClick={selectAll} className="text-[10px] text-accent hover:text-accent-hover transition-colors">Select all</button>
                  <button onClick={deselectAll} className="text-[10px] text-text-secondary hover:text-text-primary transition-colors">Clear</button>
                </div>
              </div>

              {/* Results list */}
              <div className="divide-y divide-border">
                {results.map((item) => (
                  <button
                    key={item.batch_id}
                    onClick={() => toggleItem(item.batch_id)}
                    className={`w-full text-left px-4 py-3 flex items-center gap-4 transition-colors ${
                      item.selected
                        ? 'bg-accent/5 border-l-2 border-accent'
                        : 'hover:bg-bg-hover border-l-2 border-transparent'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-colors ${
                      item.selected ? 'bg-accent border-accent' : 'border-border'
                    }`}>
                      {item.selected && <Check size={12} className="text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text-primary truncate">{item.product_name}</span>
                        {item.sku && <span className="text-[10px] font-mono text-text-secondary">{item.sku}</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-[10px] text-text-secondary">{item.category_name}</span>
                        {item.batch_number && (
                          <span className="text-[10px] font-mono text-accent">{item.batch_number}</span>
                        )}
                        {item.batch_date && (
                          <span className="text-[10px] text-text-secondary">{item.batch_date.slice(0, 10)}</span>
                        )}
                        {item.supplier && (
                          <span className="text-[10px] text-text-secondary truncate">{item.supplier}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`text-sm font-bold ${
                        item.current_stock <= 0 ? 'text-error' : item.current_stock <= 5 ? 'text-warning' : 'text-success'
                      }`}>
                        {Math.round(item.current_stock)}
                      </span>
                      <span className="text-[10px] text-text-secondary ml-1">in stock</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right panel — quantity + confirm */}
        <div className="w-[280px] border-l border-border bg-bg-secondary flex flex-col shrink-0">
          <div className="p-4 border-b border-border">
            <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-3">
              {mode === 'use' ? 'Use Stock' : 'Add Stock'}
            </h3>

            {/* Quantity */}
            <div className="mb-3">
              <label className="text-[10px] text-text-secondary mb-1 block">Quantity per item</label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setQty(String(Math.max(1, Number(qty) - 1)))}
                  className="p-2 bg-bg-primary hover:bg-bg-hover border border-border rounded-md text-text-secondary transition-colors"
                >
                  <Minus size={12} />
                </button>
                <input
                  value={qty}
                  onChange={(e) => { if (e.target.value === '' || /^\d*\.?\d*$/.test(e.target.value)) setQty(e.target.value); }}
                  className="flex-1 px-2 py-1.5 bg-bg-primary border border-border rounded-md text-center text-sm font-bold text-text-primary focus:outline-none focus:border-accent"
                />
                <button
                  onClick={() => setQty(String(Number(qty) + 1))}
                  className="p-2 bg-bg-primary hover:bg-bg-hover border border-border rounded-md text-text-secondary transition-colors"
                >
                  <Plus size={12} />
                </button>
              </div>
              <div className="flex gap-1.5 mt-2">
                {[1, 2, 6, 12].map((n) => (
                  <button
                    key={n}
                    onClick={() => setQty(String(n))}
                    className={`flex-1 py-1 text-[10px] font-medium rounded border transition-colors ${
                      qty === String(n) ? 'bg-accent/20 border-accent text-accent' : 'bg-bg-primary border-border text-text-secondary hover:border-accent/50'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="text-[10px] text-text-secondary mb-1 block">Notes (optional)</label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. VIP dinner, restock..."
                className="w-full px-2 py-1.5 bg-bg-primary border border-border rounded-md text-xs text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          {/* Summary + submit */}
          <div className="p-4 flex-1 flex flex-col">
            {selectedItems.length > 0 && (
              <div className="mb-3 p-3 bg-bg-primary border border-border rounded-lg">
                <p className="text-[10px] text-text-secondary mb-1">
                  {selectedItems.length} item{selectedItems.length !== 1 ? 's' : ''} selected
                </p>
                <p className="text-sm font-bold text-text-primary">
                  Total: {Number(qty) * selectedItems.length} unit{(Number(qty) * selectedItems.length) !== 1 ? 's' : ''}
                </p>
                <div className="mt-2 space-y-1 max-h-[100px] overflow-y-auto">
                  {selectedItems.map((item) => (
                    <div key={item.batch_id} className="flex items-center justify-between text-[10px]">
                      <span className="text-text-secondary truncate">{item.product_name}</span>
                      <span className="text-text-secondary shrink-0 ml-2">×{qty}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-auto">
              {successMsg && (
                <div className="mb-3 p-2 bg-success/10 border border-success/20 rounded-lg text-xs text-success text-center">
                  {successMsg}
                </div>
              )}
              {error && (
                <div className="mb-3 p-2 bg-error/10 border border-error/20 rounded-lg text-xs text-error text-center">
                  {error}
                </div>
              )}
              <button
                onClick={handleSubmit}
                disabled={submitting || selectedItems.length === 0 || Number(qty) <= 0}
                className={`w-full py-2.5 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                  submitting || selectedItems.length === 0 || Number(qty) <= 0
                    ? 'bg-bg-tertiary text-text-secondary/50 cursor-not-allowed'
                    : mode === 'use'
                      ? 'bg-warning hover:bg-warning/90 text-white'
                      : 'bg-success hover:bg-success/90 text-white'
                }`}
              >
                {submitting ? (
                  <RefreshCw size={14} className="animate-spin" />
                ) : (
                  <>
                    {mode === 'use' ? <Minus size={14} /> : <Plus size={14} />}
                    {mode === 'use' ? 'Use' : 'Add'} {Number(qty) * selectedItems.length} unit{(Number(qty) * selectedItems.length) !== 1 ? 's' : ''}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* SQL Preview bar */}
      {sqlPreview && (
        <div className="border-t border-border bg-bg-secondary px-6 py-3 shrink-0">
          <div className="flex items-center gap-2 mb-1.5">
            <Code size={12} className="text-accent" />
            <span className="text-[10px] font-semibold text-text-secondary uppercase tracking-wide">Generated SQL</span>
            {parsed && (
              <span className="text-[10px] text-text-secondary ml-auto flex flex-wrap gap-x-2 justify-end">
                {parsed.quantity > 0 && <span className="text-accent">{parsed.quantity}×</span>}
                {parsed.searchTerm && <span className="ml-1">"{parsed.searchTerm}"</span>}
                {parsed.batchFilter && <span className="ml-1 text-warning">batch:{parsed.batchFilter}</span>}
                {parsed.categoryFilter && <span className="ml-1 text-success">cat:{parsed.categoryFilter}</span>}
                {parsed.supplierFilters.length > 0 && (
                  <span className="ml-1 text-purple-400">supplier:{parsed.supplierFilters.join(' | ')}</span>
                )}
                {parsed.attributeFilters.map((af, i) => (
                  <span key={i} className="ml-1 text-cyan-400">{af.key}{af.op}{af.value}</span>
                ))}
                {parsed.sortByExpiry && <span className="ml-1 text-amber-400">by expiry</span>}
              </span>
            )}
          </div>
          <pre className="text-[11px] text-text-secondary font-mono bg-bg-primary border border-border rounded-md px-3 py-2 overflow-x-auto max-h-[80px] overflow-y-auto whitespace-pre-wrap">
            {sqlPreview}
          </pre>
        </div>
      )}
    </div>
  );
}
