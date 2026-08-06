import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search } from 'lucide-react';

export interface TagItem {
  id: number;
  name: string;
  sku?: string | null;
  category_id?: number | null;
}

interface Props {
  items: TagItem[];
  selected: TagItem[];
  search: string;
  onSearchChange: (s: string) => void;
  onToggle: (item: TagItem) => void;
  placeholder: string;
}

export default function TagSelect({ items, selected, search, onSearchChange, onToggle, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((i) => !selected.some((s) => s.id === i.id))
      .filter((i) => !q || i.name.toLowerCase().includes(q) || (i.sku || '').toLowerCase().includes(q))
      .slice(0, 30);
  }, [items, selected, search]);

  useEffect(() => {
    setHighlight(0);
  }, [search, open]);

  return (
    <div className="relative" ref={rootRef}>
      <div className="flex items-center gap-1 flex-wrap max-w-[300px]">
        {selected.map((s) => (
          <button
            key={s.id}
            onClick={() => onToggle(s)}
            className="flex items-center gap-1 px-2 py-0.5 bg-accent/15 text-accent border border-accent/30 rounded-full text-[10px] hover:bg-accent/25 transition-colors"
            title={`${placeholder}: ${s.name}`}
          >
            {s.name}
            <X size={9} />
          </button>
        ))}
        <div className="relative flex-1 min-w-[140px]">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => {
              onSearchChange(e.target.value);
              setOpen(true);
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
                if (open && matches[highlight]) onToggle(matches[highlight]);
              } else if (e.key === 'Escape') {
                setOpen(false);
              } else if (e.key === 'Backspace' && search === '' && selected.length) {
                onToggle(selected[selected.length - 1]);
              }
            }}
            placeholder={placeholder}
            className="pl-6 pr-2 py-1 bg-bg-primary border border-border rounded text-xs text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent w-full"
          />
        </div>
      </div>

      {open && matches.length > 0 && (
        <div className="absolute z-30 mt-1 w-[260px] max-h-48 overflow-y-auto bg-bg-secondary border border-border rounded-md shadow-lg">
          {matches.map((i, idx) => (
            <button
              key={i.id}
              onMouseEnter={() => setHighlight(idx)}
              onClick={() => {
                onToggle(i);
                onSearchChange('');
                inputRef.current?.focus();
              }}
              className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between gap-2 transition-colors ${
                idx === highlight ? 'bg-accent/15 text-accent' : 'text-text-primary'
              }`}
            >
              <span className="truncate">{i.name}</span>
              {i.sku && <span className="text-[10px] text-text-secondary font-mono truncate">{i.sku}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
