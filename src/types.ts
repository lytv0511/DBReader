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

export type ViewMode = 'canvas' | 'query' | 'dashboard' | 'gallery' | 'detail' | 'products' | 'batches' | 'logs' | 'adjust' | 'used' | 'categories' | 'reports' | 'txhistory' | 'settings' | 'workspace';

export const DEFAULT_TABS = ['gallery', 'categories', 'adjust', 'dashboard', 'products', 'txhistory'];

export type ThemeMode = 'dark' | 'light' | 'system' | 'aurora' | 'sunset' | 'ocean' | 'forest' | 'candy' | 'gold' | 'midnight' | 'lava';
export type LanguageCode = 'system' | 'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko' | 'es' | 'fr' | 'de';

export interface EmailSlot {
  enabled: boolean;
  time: string;
  lastFired: string | null;
}

export interface AppPreferences {
  lastDbPath: string | null;
  theme: ThemeMode;
  language: LanguageCode;
  openOnStartup: boolean;
  defaultQueryLimit: number;
  inventoryTabOrder: string[] | null;
  enabledTabs: string[] | null;
  useDefaultTaskbar: boolean;
  currencySymbol: string;
  emailAlertsEnabled: boolean;
  emailSmtpHost: string;
  emailSmtpPort: number;
  emailSmtpSecurity: 'ssl' | 'starttls' | 'none';
  emailSender: string;
  emailUsername: string;
  emailPassword: string;
  emailRecipients: string;
  emailSlots: EmailSlot[];
}
