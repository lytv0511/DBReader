import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search } from 'lucide-react';
import { executeQuery } from '../../lib/db';
import { rankProducts, type ProductInfo } from '../../lib/reports';
import { useI18n } from '../../lib/language';

interface Props {
  query: string;
  selected: ProductInfo | null;
  onQueryChange: (q: string) => void;
  onSelect: (p: ProductInfo | null) => void;
}

export default function ProductSelect({ query, selected, onQueryChange, onSelect }: Props) {
  const { t } = useI18n();
  const [products, setProducts] = useState<ProductInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    executeQuery('SELECT id, name, sku FROM products ORDER BY name')
      .then((r) => {
        setProducts(r.rows.map((row) => ({
          id: row[0] as number,
          name: row[1] as string,
          sku: row[2] as string | null,
        })));
      })
      .catch(() => {});
  }, []);

  const matches = useMemo(() => rankProducts(products, query), [products, query]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const select = (p: ProductInfo) => {
    onSelect(p);
    onQueryChange('');
    setOpen(false);
    inputRef.current?.focus();
  };

  const clear = () => {
    onSelect(null);
    onQueryChange('');
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div className="relative" ref={rootRef}>
      <div className="relative">
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
        <input
          ref={inputRef}
          value={selected && query === '' ? selected.name : query}
          onChange={(e) => {
            if (selected) onSelect(null);
            onQueryChange(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlight((h) => Math.min(h + 1, matches.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (open && matches[highlight]) select(matches[highlight]);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
          placeholder={t('logs.searchPlaceholder')}
          className="pl-6 pr-6 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent w-[180px]"
        />
        {selected && query === '' && (
          <button
            onClick={clear}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-error transition-colors"
            title={t('logs.clearFilters')}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {open && matches.length > 0 && (
        <div className="absolute z-30 mt-1 w-[240px] max-h-48 overflow-y-auto bg-bg-secondary border border-border rounded-md shadow-lg">
          {matches.slice(0, 50).map((p, i) => (
            <button
              key={p.id}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => select(p)}
              className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between gap-2 transition-colors ${
                i === highlight ? 'bg-accent/15 text-accent' : 'text-text-primary'
              }`}
            >
              <span className="truncate">{p.name}</span>
              {p.sku && <span className="text-[10px] text-text-secondary font-mono truncate">{p.sku}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
