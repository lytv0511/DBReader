import { useState, useCallback, useEffect } from 'react';
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
  Search,
  Grid3X3,
  Undo2,
  Tag,
} from 'lucide-react';

import Sidebar from './components/Sidebar';
import QueryEditor from './components/QueryEditor';
import ResultsGrid from './components/ResultsGrid';
import Canvas from './components/Canvas';
import Dashboard from './components/inventory/Dashboard';
import ProductManager from './components/inventory/ProductManager';
import BatchManager from './components/inventory/BatchManager';
import InventoryLog from './components/inventory/InventoryLog';
import QuickAdjust from './components/inventory/QuickAdjust';
import QuickUse from './components/inventory/QuickUse';
import ProductGallery from './components/inventory/ProductGallery';
import ProductDetail from './components/inventory/ProductDetail';
import UseHistory from './components/inventory/UseHistory';
import CategoryManager from './components/inventory/CategoryManager';
import { openDatabase, closeDatabase, createNewDatabase, migrateSchema, savePreferences, loadPreferences } from './lib/db';
import { savePreset, loadPreset } from './lib/presets';
import type { QueryResult, PresetData, ViewMode } from './types';
import type { Product } from './components/inventory/ProductGallery';

const INVENTORY_TABS: { mode: ViewMode; label: string; icon: React.ReactNode }[] = [
  { mode: 'quickuse', label: 'Quick Use', icon: <Search size={12} /> },
  { mode: 'gallery', label: 'Gallery', icon: <Grid3X3 size={12} /> },
  { mode: 'categories', label: 'Categories', icon: <Tag size={12} /> },
  { mode: 'adjust', label: 'Adjust', icon: <RefreshCw size={12} /> },
  { mode: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={12} /> },
  { mode: 'used', label: 'Used', icon: <Undo2 size={12} /> },
  { mode: 'products', label: 'Products', icon: <Package size={12} /> },
  { mode: 'batches', label: 'Batches', icon: <Boxes size={12} /> },
  { mode: 'logs', label: 'Logs', icon: <ScrollText size={12} /> },
];

export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('canvas');
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentSql, setCurrentSql] = useState('SELECT * FROM ');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    loadPreferences()
      .then(async (prefs) => {
        if (prefs.lastDbPath) {
          try {
            await openDatabase(prefs.lastDbPath);
            await migrateSchema().catch(() => {});
            setIsConnected(true);
            setDbPath(prefs.lastDbPath);
          } catch {
            // File may have been deleted - clear saved path
            savePreferences(null).catch(() => {});
          }
        }
      })
      .catch(() => {})
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
      savePreferences(selected).catch(() => {});
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
      savePreferences(path).catch(() => {});
    } catch (err) {
      console.error('Failed to create database:', err);
    }
  }, []);

  const handleClose = useCallback(async () => {
    await closeDatabase();
    setIsConnected(false);
    setDbPath(null);
    setQueryResult(null);
    savePreferences(null).catch(() => {});
  }, []);

  const handleSavePreset = useCallback(async () => {
    const nodes = (window as unknown as Record<string, () => unknown[]>).__canvasGetNodes?.() || [];
    const edges = (window as unknown as Record<string, () => unknown[]>).__canvasGetEdges?.() || [];

    await savePreset({
      name: 'Current Layout',
      nodes,
      edges,
    });
  }, []);

  const handleLoadPreset = useCallback(async () => {
    const preset = await loadPreset();
    if (preset) {
      (window as unknown as Record<string, (p: PresetData) => void>).__canvasLoadPreset?.(preset);
    }
  }, []);

  const fileName = dbPath?.split(/[\\/]/).pop() || '';

  return (
    <div className="h-screen flex flex-col bg-bg-primary text-text-primary">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-2 border-b border-border bg-bg-secondary shrink-0">
        <div className="flex items-center gap-2">
          <Database size={18} className="text-accent" />
          <h1 className="text-sm font-bold tracking-tight">DBReader</h1>
        </div>

        <div className="h-4 w-px bg-border mx-1" />

        <button
          onClick={handleOpenFile}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-xs text-text-primary transition-colors"
        >
          <FolderOpen size={12} />
          Open DB
        </button>

        <button
          onClick={handleCreateNew}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded-md text-xs text-accent transition-colors"
        >
          <Plus size={12} />
          New Inventory DB
        </button>

        {isConnected && (
          <>
            <div className="flex items-center gap-1.5 px-2 py-1 bg-success/10 border border-success/20 rounded-md text-xs text-success">
              <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              {fileName}
              <button onClick={handleClose} className="ml-1 hover:text-error transition-colors">
                <X size={10} />
              </button>
            </div>

            <div className="h-4 w-px bg-border mx-1" />

            <div className="flex items-center bg-bg-tertiary border border-border rounded-md overflow-hidden">
              <button
                onClick={() => setViewMode('canvas')}
                className={`flex items-center gap-1 px-3 py-1.5 text-xs transition-colors ${
                  viewMode === 'canvas' ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                <Workflow size={12} />
                Canvas
              </button>
              <button
                onClick={() => setViewMode('query')}
                className={`flex items-center gap-1 px-3 py-1.5 text-xs transition-colors ${
                  viewMode === 'query' ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                <Terminal size={12} />
                Query
              </button>
            </div>

            <div className="h-4 w-px bg-border mx-1" />

            <div className="flex items-center bg-bg-tertiary border border-border rounded-md overflow-hidden">
              {INVENTORY_TABS.map((tab) => (
                <button
                  key={tab.mode}
                  onClick={() => setViewMode(tab.mode)}
                  className={`flex items-center gap-1 px-3 py-1.5 text-xs transition-colors ${
                    viewMode === tab.mode ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="h-4 w-px bg-border mx-1" />

            <button
              onClick={handleSavePreset}
              className="flex items-center gap-1 px-2 py-1 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-xs text-text-secondary transition-colors"
            >
              <Save size={10} /> Save
            </button>
            <button
              onClick={handleLoadPreset}
              className="flex items-center gap-1 px-2 py-1 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-xs text-text-secondary transition-colors"
            >
              <FolderOpenIcon size={10} /> Load
            </button>
          </>
        )}
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - only for canvas/query modes */}
        {sidebarOpen && isConnected && (viewMode === 'canvas' || viewMode === 'query') && (
          <div className="w-64 border-r border-border bg-bg-secondary shrink-0 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                Schema
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
                onSelectTable={(table) => {
                  setCurrentSql(`SELECT * FROM "${table}" LIMIT 100`);
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
        <div className="flex-1 flex flex-col overflow-hidden">
          {viewMode === 'canvas' && (
            <div className="flex-1 overflow-hidden">
              <Canvas isConnected={isConnected} />
            </div>
          )}
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
          {viewMode === 'dashboard' && <Dashboard />}
          {viewMode === 'quickuse' && <QuickUse />}
          {viewMode === 'adjust' && <QuickAdjust />}
          {viewMode === 'gallery' && (
            <ProductGallery
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
        </div>
      </div>

      {/* Welcome overlay */}
      {!isConnected && viewMode === 'canvas' && !initializing && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="text-center pointer-events-auto">
            <Database size={64} className="mx-auto mb-4 text-text-secondary/30" />
            <h2 className="text-xl font-bold text-text-primary mb-2">DBReader</h2>
            <p className="text-sm text-text-secondary mb-6">
              A local database GUI and query visualizer
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={handleOpenFile}
                className="px-4 py-2 bg-accent hover:bg-accent-hover rounded-lg text-sm font-medium text-white transition-colors"
              >
                Open a Database File
              </button>
              <button
                onClick={handleCreateNew}
                className="px-4 py-2 bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded-lg text-sm font-medium text-accent transition-colors"
              >
                Create New Inventory DB
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
