import { useState } from 'react';
import { Play, Loader2 } from 'lucide-react';
import { executeQuery } from '../lib/db';
import type { QueryResult } from '../types';

interface QueryEditorProps {
  isConnected: boolean;
  onResult?: (result: QueryResult) => void;
  initialSql?: string;
  onSqlChange?: (sql: string) => void;
}

export default function QueryEditor({
  isConnected,
  onResult,
  initialSql,
  onSqlChange,
}: QueryEditorProps) {
  const [sql, setSql] = useState(initialSql || 'SELECT * FROM ');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (val: string) => {
    setSql(val);
    onSqlChange?.(val);
  };

  async function handleExecute() {
    if (!sql.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await executeQuery(sql);
      onResult?.(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleExecute();
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs text-text-secondary font-medium uppercase tracking-wide">
          SQL Query
        </span>
        <button
          onClick={handleExecute}
          disabled={!isConnected || loading}
          className="flex items-center gap-1.5 px-3 py-1 bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed rounded-md text-xs font-medium text-white transition-colors"
        >
          {loading ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Play size={12} />
          )}
          Run
          <kbd className="ml-1 text-[10px] opacity-60">⌘↵</kbd>
        </button>
      </div>

      <div className="flex-1 relative">
        <textarea
          value={sql}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!isConnected}
          placeholder={isConnected ? 'Enter SQL query...' : 'Open a database first'}
          spellCheck={false}
          className="w-full h-full p-3 bg-bg-primary text-text-primary text-sm resize-none focus:outline-none placeholder:text-text-secondary disabled:opacity-40"
        />
      </div>

      {error && (
        <div className="px-3 py-2 border-t border-error/20 bg-error/5 text-error text-xs">
          {error}
        </div>
      )}
    </div>
  );
}
