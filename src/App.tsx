import { Fragment, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import {
  Database,
  FolderOpen,
  X,
  Workflow,
  Terminal,
  Save,
  FolderOpenIcon,
  LayoutDashboard,
  Package,
  Boxes,
  ScrollText,
  Plus,
  RefreshCw,
  Grid3X3,
  Undo2,
  Tag,
  Printer,
  History,
  Settings as SettingsIcon,
  HelpCircle,
} from 'lucide-react';

import Sidebar from './components/Sidebar';
import QueryEditor from './components/QueryEditor';
import ResultsGrid from './components/ResultsGrid';
import Canvas from './components/Canvas';
import SettingsView from './components/SettingsView';
import HelpChat from './components/HelpChat';
import Dashboard from './components/inventory/Dashboard';
import ProductManager from './components/inventory/ProductManager';
import BatchManager from './components/inventory/BatchManager';
import InventoryLog from './components/inventory/InventoryLog';
import QuickAdjust from './components/inventory/QuickAdjust';
import ProductGallery, { type StockFilter } from './components/inventory/ProductGallery';
import ProductDetail from './components/inventory/ProductDetail';
import UseHistory from './components/inventory/UseHistory';
import CategoryManager from './components/inventory/CategoryManager';
import Reports from './components/inventory/Reports';
import TransactionHistory from './components/inventory/TransactionHistory';
import { openDatabase, closeDatabase, createNewDatabase, migrateSchema, savePreferences, loadPreferences } from './lib/db';
import { savePreset, loadPreset } from './lib/presets';
import { t as translate, resolveLang } from './lib/i18n';
import { I18nProvider } from './lib/language';
import type { QueryResult, PresetData, ViewMode, AppPreferences } from './types';
import type { Product } from './components/inventory/ProductGallery';

const DEFAULT_PREFS: AppPreferences = {
  lastDbPath: null,
  theme: 'dark',
  language: 'system',
  openOnStartup: true,
  defaultQueryLimit: 100,
  inventoryTabOrder: null,
};

const INVENTORY_TABS: { mode: ViewMode; labelKey: string; icon: React.ReactNode }[] = [
  { mode: 'gallery', labelKey: 'tab.gallery', icon: <Grid3X3 size={12} /> },
  { mode: 'categories', labelKey: 'tab.categories', icon: <Tag size={12} /> },
  { mode: 'adjust', labelKey: 'tab.adjust', icon: <RefreshCw size={12} /> },
  { mode: 'dashboard', labelKey: 'tab.dashboard', icon: <LayoutDashboard size={12} /> },
  { mode: 'used', labelKey: 'tab.used', icon: <Undo2 size={12} /> },
  { mode: 'products', labelKey: 'tab.products', icon: <Package size={12} /> },
  { mode: 'batches', labelKey: 'tab.batches', icon: <Boxes size={12} /> },
  { mode: 'logs', labelKey: 'tab.logs', icon: <ScrollText size={12} /> },
  { mode: 'txhistory', labelKey: 'tab.txhistory', icon: <History size={12} /> },
  { mode: 'reports', labelKey: 'tab.reports', icon: <Printer size={12} /> },
];

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('canvas');
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentSql, setCurrentSql] = useState('SELECT * FROM ');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [galleryStockFilter, setGalleryStockFilter] = useState<StockFilter>('all');
  const [initializing, setInitializing] = useState(true);
  const [prefs, setPrefs] = useState<AppPreferences>(DEFAULT_PREFS);
  const prefsLoadedRef = useRef(false);
  const [dragTab, setDragTab] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const suppressClickRef = useRef(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const orderedTabs = useMemo(() => {
    const order = prefs.inventoryTabOrder ?? INVENTORY_TABS.map((t) => t.mode);
    const byMode = new Map<string, (typeof INVENTORY_TABS)[number]>(INVENTORY_TABS.map((t) => [t.mode, t]));
    const seen = new Set<string>();
    const result: typeof INVENTORY_TABS = [];
    for (const m of order) {
      const tab = byMode.get(m);
      if (tab && !seen.has(m)) {
        result.push(tab);
        seen.add(m);
      }
    }
    for (const tab of INVENTORY_TABS) {
      if (!seen.has(tab.mode)) result.push(tab);
    }
    return result;
  }, [prefs.inventoryTabOrder]);

  const getDropIndex = (clientX: number) => {
    let idx = orderedTabs.length;
    for (let i = 0; i < orderedTabs.length; i++) {
      const el = tabRefs.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientX < r.left + r.width / 2) {
        idx = i;
        break;
      }
    }
    return idx;
  };

  const reorderTab = (from: string, idx: number) => {
    const order = prefs.inventoryTabOrder ?? INVENTORY_TABS.map((t) => t.mode);
    const next = order.filter((m) => m !== from);
    const fromOriginal = order.indexOf(from);
    let target = idx;
    if (fromOriginal !== -1 && fromOriginal < idx) target = Math.max(0, idx - 1);
    next.splice(Math.min(target, next.length), 0, from);
    setPrefs((p) => ({ ...p, inventoryTabOrder: next }));
  };

  const handleTabDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!dragTab) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const idx = getDropIndex(e.clientX);
    if (idx !== dropIndex) setDropIndex(idx);
  };

  const handleTabDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const from = dragTab;
    suppressClickRef.current = true;
    setDragTab(null);
    setDropIndex(null);
    if (from) reorderTab(from, getDropIndex(e.clientX));
  };

  const handleTabDragEnd = () => {
    setDragTab(null);
    setDropIndex(null);
  };

  const lang = resolveLang(prefs.language);
  const t = (key: string) => translate(lang, key);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const gradientThemes = ['aurora', 'sunset', 'ocean', 'forest', 'candy', 'gold', 'midnight', 'lava'];
    const apply = () => {
      const el = document.documentElement;
      const isGradient = gradientThemes.includes(prefs.theme);
      const dark =
        prefs.theme === 'dark' || (prefs.theme === 'system' && mq.matches) || isGradient;
      el.classList.toggle('light', !dark);
      gradientThemes.forEach((th) => el.classList.remove(`theme-${th}`));
      if (isGradient) el.classList.add(`theme-${prefs.theme}`);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [prefs.theme]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    if (!prefsLoadedRef.current) return;
    savePreferences(prefs).catch(() => {});
  }, [prefs]);

  useEffect(() => {
    loadPreferences()
      .then(async (loaded) => {
        const merged: AppPreferences = {
          ...DEFAULT_PREFS,
          ...loaded,
          lastDbPath: loaded.lastDbPath ?? null,
          theme: loaded.theme ?? DEFAULT_PREFS.theme,
          language: loaded.language ?? DEFAULT_PREFS.language,
          openOnStartup: loaded.openOnStartup ?? DEFAULT_PREFS.openOnStartup,
          defaultQueryLimit: loaded.defaultQueryLimit ?? DEFAULT_PREFS.defaultQueryLimit,
          inventoryTabOrder: loaded.inventoryTabOrder ?? null,
        };
        prefsLoadedRef.current = true;
        setPrefs(merged);
        if (merged.openOnStartup && merged.lastDbPath) {
          try {
            await openDatabase(merged.lastDbPath);
            await migrateSchema().catch(() => {});
            setIsConnected(true);
            setDbPath(merged.lastDbPath);
            setViewMode('dashboard');
          } catch {
            setPrefs((p) => ({ ...p, lastDbPath: null }));
          }
        }
      })
      .catch(() => {
        prefsLoadedRef.current = true;
      })
      .finally(() => setInitializing(false));
  }, []);

  const handleOpenFile = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [
        {
          name: 'SQLite Database',
          extensions: ['db', 'sqlite', 'sqlite3', 'db3'],
        },
      ],
    });

    if (!selected || Array.isArray(selected)) return;

    try {
      await openDatabase(selected);
      await migrateSchema().catch(() => {});
      setIsConnected(true);
      setDbPath(selected);
      setPrefs((p) => ({ ...p, lastDbPath: selected }));
    } catch (err) {
      console.error('Failed to open database:', err);
    }
  }, []);

  const handleCreateNew = useCallback(async () => {
    const path = await save({
      defaultPath: 'wine_inventory.db',
      filters: [
        {
          name: 'SQLite Database',
          extensions: ['db'],
        },
      ],
    });

    if (!path) return;

    try {
      await createNewDatabase(path);
      setIsConnected(true);
      setDbPath(path);
      setPrefs((p) => ({ ...p, lastDbPath: path }));
    } catch (err) {
      console.error('Failed to create database:', err);
    }
  }, []);

  const handleClose = useCallback(async () => {
    await closeDatabase();
    setIsConnected(false);
    setDbPath(null);
    setQueryResult(null);
    setPrefs((p) => ({ ...p, lastDbPath: null }));
  }, []);

  const handleSavePreset = useCallback(async () => {
    const nodes = (window as unknown as Record<string, () => unknown[]>).__canvasGetNodes?.() || [];
    const edges = (window as unknown as Record<string, () => unknown[]>).__canvasGetEdges?.() || [];

    await savePreset({
      name: t('preset.currentLayout'),
      nodes,
      edges,
    });
  }, [t]);

  const handleLoadPreset = useCallback(async () => {
    const preset = await loadPreset();
    if (preset) {
      (window as unknown as Record<string, (p: PresetData) => void>).__canvasLoadPreset?.(preset);
    }
  }, []);

  const fileName = dbPath?.split(/[\\/]/).pop() || '';

  return (
    <I18nProvider language={prefs.language}>
      <div className="h-screen flex flex-col bg-bg-primary text-text-primary">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-2 border-b border-border bg-bg-secondary shrink-0 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <Database size={18} className="text-accent" />
          <h1 className="text-sm font-bold tracking-tight">DBReader</h1>
        </div>

        <div className="h-4 w-px bg-border mx-1 shrink-0" />

        <button
          onClick={handleOpenFile}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-xs text-text-primary transition-colors shrink-0"
        >
          <FolderOpen size={12} />
          {t('app.open')}
        </button>

        <button
          onClick={handleCreateNew}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded-md text-xs text-accent transition-colors shrink-0"
        >
          <Plus size={12} />
          {t('app.new')}
        </button>

        <button
          onClick={() => setViewMode(viewMode === 'settings' ? 'canvas' : 'settings')}
          className={`flex items-center justify-center w-7 h-7 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md transition-colors shrink-0 ${
            viewMode === 'settings' ? 'text-accent border-accent/50' : 'text-text-secondary hover:text-text-primary'
          }`}
          title={t('app.settings')}
        >
          <SettingsIcon size={12} />
        </button>

        <button
          onClick={() => setHelpOpen(true)}
          className="flex items-center justify-center w-7 h-7 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-text-secondary hover:text-text-primary transition-colors shrink-0"
          title={t('app.help')}
        >
          <HelpCircle size={12} className="help-icon-anim" />
        </button>

        {isConnected && (
          <div className="flex-1 flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-1.5 px-2 py-1 bg-success/10 border border-success/20 rounded-md text-xs text-success shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              {fileName}
              <button onClick={handleClose} className="ml-1 hover:text-error transition-colors">
                <X size={10} />
              </button>
            </div>

            <div className="flex items-center bg-bg-tertiary border border-border rounded-md overflow-hidden shrink-0">
              <button
                onClick={() => setViewMode('canvas')}
                className={`flex items-center gap-1 px-3 py-1.5 text-xs transition-colors ${
                  viewMode === 'canvas' ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                <Workflow size={12} />
                {t('view.canvas')}
              </button>
              <button
                onClick={() => setViewMode('query')}
                className={`flex items-center gap-1 px-3 py-1.5 text-xs transition-colors ${
                  viewMode === 'query' ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                <Terminal size={12} />
                {t('view.query')}
              </button>
            </div>

            <div
              className="flex items-center bg-bg-tertiary border border-border rounded-md overflow-x-auto"
              onDragOver={handleTabDragOver}
              onDrop={handleTabDrop}
            >
              {orderedTabs.map((tab, i) => (
                <Fragment key={tab.mode}>
                  {dragTab && dropIndex === i && (
                    <div className="w-0.5 shrink-0 self-stretch bg-accent rounded my-1.5 transition-all" />
                  )}
                  <button
                    ref={(el) => { tabRefs.current[i] = el; }}
                    draggable
                    onDragStart={(e) => {
                      setDragTab(tab.mode);
                      setDropIndex(i);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', tab.mode);
                    }}
                    onDragEnd={handleTabDragEnd}
                    onClick={() => {
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false;
                        return;
                      }
                      setViewMode(tab.mode);
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs whitespace-nowrap transition-colors cursor-grab active:cursor-grabbing ${
                      viewMode === tab.mode ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'
                    } ${dragTab === tab.mode ? 'opacity-50' : ''}`}
                  >
                    {tab.icon}
                    {t(tab.labelKey)}
                  </button>
                </Fragment>
              ))}
              {dragTab && dropIndex === orderedTabs.length && (
                <div className="w-0.5 shrink-0 self-stretch bg-accent rounded my-1.5 transition-all" />
              )}
            </div>

            <button
              onClick={handleSavePreset}
              className="flex items-center gap-1 px-2 py-1 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-xs text-text-secondary transition-colors shrink-0"
            >
              <Save size={10} /> {t('action.save')}
            </button>
            <button
              onClick={handleLoadPreset}
              className="flex items-center gap-1 px-2 py-1 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-xs text-text-secondary transition-colors shrink-0"
            >
              <FolderOpenIcon size={10} /> {t('action.load')}
            </button>
          </div>
        )}
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - only for canvas/query modes */}
        {sidebarOpen && isConnected && (viewMode === 'canvas' || viewMode === 'query') && (
          <div className="w-64 border-r border-border bg-bg-secondary shrink-0 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                {t('sidebar.schema')}
              </span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="text-text-secondary hover:text-text-primary"
              >
                <X size={12} />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <Sidebar
                isConnected={isConnected}
                dbPath={dbPath}
                onSelectTable={(table) => {
                  setCurrentSql(`SELECT * FROM "${table}" LIMIT ${prefs.defaultQueryLimit}`);
                }}
              />
            </div>
          </div>
        )}

        {!sidebarOpen && isConnected && (viewMode === 'canvas' || viewMode === 'query') && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="w-8 border-r border-border bg-bg-secondary hover:bg-bg-hover flex items-center justify-center shrink-0 transition-colors"
          >
            <Database size={14} className="text-text-secondary" />
          </button>
        )}

        {/* Center area */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          <div className={viewMode === 'canvas' ? 'flex-1 overflow-hidden' : 'hidden'}>
            <Canvas isConnected={isConnected} dbPath={dbPath} />
          </div>
          {viewMode === 'query' && (
            <>
              <div className="h-[200px] shrink-0 border-b border-border">
                <QueryEditor
                  isConnected={isConnected}
                  onResult={setQueryResult}
                  initialSql={currentSql}
                  onSqlChange={setCurrentSql}
                />
              </div>
              <div className="flex-1 overflow-hidden">
                <ResultsGrid result={queryResult} />
              </div>
            </>
          )}
          {viewMode === 'dashboard' && (
            <Dashboard onNavigate={(stockFilter) => {
              setGalleryStockFilter(stockFilter);
              setViewMode('gallery');
            }} />
          )}
          {viewMode === 'adjust' && <QuickAdjust />}
          {viewMode === 'gallery' && (
            <ProductGallery
              initialStockFilter={galleryStockFilter}
              onSelectProduct={(product) => {
                setSelectedProduct(product);
                setViewMode('detail');
              }}
            />
          )}
          {viewMode === 'detail' && selectedProduct && (
            <ProductDetail
              product={selectedProduct}
              onBack={() => setViewMode('gallery')}
            />
          )}
          {viewMode === 'categories' && <CategoryManager />}
          {viewMode === 'used' && <UseHistory />}
          {viewMode === 'products' && <ProductManager />}
          {viewMode === 'batches' && <BatchManager />}
          {viewMode === 'logs' && <InventoryLog />}
          {viewMode === 'txhistory' && <TransactionHistory />}
          {viewMode === 'reports' && <Reports />}
          {viewMode === 'settings' && (
            <SettingsView
              prefs={prefs}
              onChange={(patch) => setPrefs((p) => ({ ...p, ...patch }))}
              onReset={() => setPrefs((p) => ({ ...DEFAULT_PREFS, lastDbPath: p.lastDbPath }))}
              t={t}
            />
          )}
        </div>
      </div>

      {/* Welcome overlay */}      {!isConnected && viewMode === 'canvas' && !initializing && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="text-center pointer-events-auto">
            <Database size={64} className="mx-auto mb-4 text-text-secondary/30" />
            <h2 className="text-xl font-bold text-text-primary mb-2">DBReader</h2>
            <p className="text-sm text-text-secondary mb-6">
              {t('welcome.tagline')}
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={handleOpenFile}
                className="px-4 py-2 bg-accent hover:bg-accent-hover rounded-lg text-sm font-medium text-white transition-colors"
              >
                {t('welcome.open')}
              </button>
              <button
                onClick={handleCreateNew}
                className="px-4 py-2 bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded-lg text-sm font-medium text-accent transition-colors"
              >
                {t('welcome.create')}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>

      <HelpChat open={helpOpen} onClose={() => setHelpOpen(false)} />
    </I18nProvider>
  );
}
