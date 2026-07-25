export interface ColumnInfo {
  name: string;
  data_type: string;
  not_null: boolean;
  default_value: string | null;
  primary_key: boolean;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
}

export interface QueryResult {
  columns: string[];
  rows: (string | number | null)[][];
  rows_affected: number | null;
}

export interface PresetData {
  name: string;
  nodes: unknown[];
  edges: unknown[];
  timestamp: number;
}

export type ViewMode = 'canvas' | 'query' | 'quickuse' | 'dashboard' | 'gallery' | 'detail' | 'products' | 'batches' | 'logs' | 'adjust' | 'used' | 'categories';
