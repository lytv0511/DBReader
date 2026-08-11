import { Fragment, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import {
  Database,
  FolderOpen,
  X,
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
  ChevronLeft,
  UploadCloud,
  FilePlus2,
  Share2,
} from 'lucide-react';

import SettingsView from './components/SettingsView';
import HelpChat from './components/HelpChat';
import LoginView from './components/LoginView';
import { accountStatus, accountSignOut } from './lib/account';
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
import Workspace from './components/Workspace';
import { openDatabase, closeDatabase, createNewDatabase, migrateSchema, savePreferences, loadPreferences, getDatabasePath, mobileImportDatabase, mobileCreateDatabase, mobileExportDatabase } from './lib/db';
import { t as translate, resolveLang } from './lib/i18n';
import { I18nProvider } from './lib/language';
import { isMobile as isMobilePlatform, applyFormFactor } from './lib/platform';
import type { ViewMode, AppPreferences } from './types';
import { DEFAULT_TABS } from './types';
import type { Product } from './components/inventory/ProductGallery';

const DEFAULT_PREFS: AppPreferences = {
  lastDbPath: null,
  theme: 'dark',
  language: 'system',
  openOnStartup: true,
  defaultQueryLimit: 100,
  inventoryTabOrder: null,
  enabledTabs: null,
  useDefaultTaskbar: true,
  currencySymbol: '$',
  emailAlertsEnabled: false,
  emailSmtpHost: 'smtp.gmail.com',
  emailSmtpPort: 587,
  emailSmtpSecurity: 'starttls',
  emailSender: 'dbreaderauto@gmail.com',
  emailUsername: 'dbreaderauto@gmail.com',
  emailPassword: 'kimlkjrdxfawgmdm',
  emailRecipients: '',
  emailSlots: [
    { enabled: true, time: '08:00', lastFired: null },
    { enabled: true, time: '13:00', lastFired: null },
    { enabled: true, time: '18:00', lastFired: null },
  ],
  desktopNotifications: true,
  launchAtLogin: false,
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

const ALL_TABS: { mode: ViewMode; labelKey: string }[] = INVENTORY_TABS.map((t) => ({ mode: t.mode, labelKey: t.labelKey }));

export default function App() {
  const [isMobile, setIsMobile] = useState<boolean>(() => isMobilePlatform());
  const [debugInfo, setDebugInfo] = useState<string>('');
  const [debugVisible, setDebugVisible] = useState(() => sessionStorage.getItem('hideDbg') !== '1');
  const [isConnected, setIsConnected] = useState(false);
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('workspace');
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
  const [mobileCreateOpen, setMobileCreateOpen] = useState(false);
  const [mobileCreateName, setMobileCreateName] = useState('wine_inventory');
  const [mobileError, setMobileError] = useState<string | null>(null);
  const [mobileBusy, setMobileBusy] = useState(false);
  const viewModeRef = useRef<ViewMode>(viewMode);
  const [syncTick, setSyncTick] = useState(0);
  const [account, setAccount] = useState<{ email: string } | null>(null);
  const [accountChecked, setAccountChecked] = useState(false);

  useEffect(() => {
    let disposed = false;
    accountStatus()
      .then((s) => {
        if (!disposed) setAccount(s.email ? { email: s.email } : null);
      })
      .catch(() => {})
      .finally(() => {
        if (!disposed) setAccountChecked(true);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const handleSignOut = async () => {
    try {
      await accountSignOut();
    } catch {
      // ignore
    }
    setAccount(null);
  };

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen<number>('dbreader:synced', () => {
      if (!disposed) setSyncTick((t) => t + 1);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

useEffect(() => {
    applyFormFactor();
    const update = () => {
      applyFormFactor();
      setIsMobile(isMobilePlatform());
      setDebugInfo(`FF=${document.documentElement.dataset.formFactor} W=${window.innerWidth} UA=${navigator.userAgent}`);
    };
    update();
    const onResize = () => requestAnimationFrame(update);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const goBack = useCallback((): boolean => {
    if (viewModeRef.current !== 'workspace') {
      setViewMode('workspace');
      setMobileError(null);
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    if (!isMobile) return;
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (goBack()) event.preventDefault();
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, [isMobile, goBack]);

  const isTabEnabled = (mode: string) => {
    if (isMobile) return mode !== 'dashboard';
    if (mode === 'settings') return true;
    if (prefs.useDefaultTaskbar) {
      return DEFAULT_TABS.includes(mode);
    }
    return (prefs.enabledTabs ?? ALL_TABS.map((t) => t.mode)).includes(mode);
  };

  const fallbackView = () => {
    const first = ALL_TABS.find((t) => isTabEnabled(t.mode));
    return first ? first.mode : 'settings';
  };

  const orderedTabs = useMemo(() => {
    if (prefs.useDefaultTaskbar) {
      const byMode = new Map<string, (typeof INVENTORY_TABS)[number]>(INVENTORY_TABS.map((t) => [t.mode, t]));
      return DEFAULT_TABS.map((m) => byMode.get(m)).filter((t): t is (typeof INVENTORY_TABS)[number] => !!t);
    }
    const order = prefs.inventoryTabOrder ?? INVENTORY_TABS.map((t) => t.mode);
    const byMode = new Map<string, (typeof INVENTORY_TABS)[number]>(INVENTORY_TABS.map((t) => [t.mode, t]));
    const seen = new Set<string>();
    const result: typeof INVENTORY_TABS = [];
    for (const m of order) {
      const tab = byMode.get(m);
      if (tab && !seen.has(m) && isTabEnabled(m)) {
        result.push(tab);
        seen.add(m);
      }
    }
    for (const tab of INVENTORY_TABS) {
      if (!seen.has(tab.mode) && isTabEnabled(tab.mode)) result.push(tab);
    }
    return result;
  }, [prefs.inventoryTabOrder, prefs.enabledTabs, prefs.useDefaultTaskbar]);

  useEffect(() => {
    if (ALL_TABS.some((t) => t.mode === viewMode) && !isTabEnabled(viewMode)) {
      setViewMode(fallbackView());
    }
  }, [prefs.enabledTabs, viewMode]);

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

  const launcherTabs = useMemo(() => {
    const all: { mode: string; label: string; icon: React.ReactNode; enabled: boolean }[] = INVENTORY_TABS.map(
      (tb) => ({
        mode: tb.mode,
        label: t(tb.labelKey),
        icon: tb.icon,
        enabled: isTabEnabled(tb.mode),
      })
    );
    return all.filter((tb) => !(isMobile && tb.mode === 'dashboard'));
  }, [prefs.enabledTabs, lang, isMobile]);

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
          enabledTabs: loaded.enabledTabs ?? null,
          useDefaultTaskbar: loaded.useDefaultTaskbar ?? DEFAULT_PREFS.useDefaultTaskbar,
          currencySymbol: loaded.currencySymbol ?? DEFAULT_PREFS.currencySymbol,
          emailAlertsEnabled: loaded.emailAlertsEnabled ?? DEFAULT_PREFS.emailAlertsEnabled,
          emailSmtpHost: loaded.emailSmtpHost ?? DEFAULT_PREFS.emailSmtpHost,
          emailSmtpPort: loaded.emailSmtpPort ?? DEFAULT_PREFS.emailSmtpPort,
          emailSmtpSecurity: loaded.emailSmtpSecurity ?? DEFAULT_PREFS.emailSmtpSecurity,
          emailSender: loaded.emailSender ?? DEFAULT_PREFS.emailSender,
          emailUsername: loaded.emailUsername ?? DEFAULT_PREFS.emailUsername,
          emailPassword: loaded.emailPassword ?? DEFAULT_PREFS.emailPassword,
          emailRecipients: loaded.emailRecipients ?? '',
          emailSlots: Array.isArray(loaded.emailSlots) && loaded.emailSlots.length === 3
            ? loaded.emailSlots.map((s, i) => ({
                enabled: s?.enabled ?? DEFAULT_PREFS.emailSlots[i].enabled,
                time: s?.time ?? DEFAULT_PREFS.emailSlots[i].time,
                lastFired: s?.lastFired ?? null,
              }))
            : DEFAULT_PREFS.emailSlots,
          desktopNotifications: loaded.desktopNotifications ?? DEFAULT_PREFS.desktopNotifications,
          launchAtLogin: loaded.launchAtLogin ?? DEFAULT_PREFS.launchAtLogin,
        };
        prefsLoadedRef.current = true;
        setPrefs(merged);
        if (merged.openOnStartup && merged.lastDbPath) {
          try {
            await openDatabase(merged.lastDbPath);
            await migrateSchema().catch(() => {});
            setIsConnected(true);
            setDbPath(merged.lastDbPath);
            setViewMode(isTabEnabled('dashboard') ? 'dashboard' : fallbackView());
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
    if (isMobile) {
      setMobileError(null);
      setMobileBusy(true);
      try {
        const path = await mobileImportDatabase('dbreader.db');
        await openDatabase(path);
        await migrateSchema().catch(() => {});
        setIsConnected(true);
        setDbPath(path);
        setPrefs((p) => ({ ...p, lastDbPath: path }));
        setViewMode('workspace');
      } catch (err) {
        setMobileError(err instanceof Error ? err.message : String(err));
      } finally {
        setMobileBusy(false);
      }
      return;
    }
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
  }, [isMobile]);

  const handleCreateNew = useCallback(async () => {
    if (isMobile) {
      setMobileCreateName('wine_inventory');
      setMobileError(null);
      setMobileCreateOpen(true);
      return;
    }
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
  }, [isMobile]);

  const handleMobileCreateConfirm = useCallback(async () => {
    const name = mobileCreateName.trim() || 'wine_inventory';
    setMobileBusy(true);
    setMobileError(null);
    try {
      await mobileCreateDatabase(name);
      const currentPath = await getDatabasePath();
      setIsConnected(true);
      setDbPath(currentPath);
      setPrefs((p) => ({ ...p, lastDbPath: currentPath }));
      setMobileCreateOpen(false);
      setViewMode('workspace');
    } catch (e) {
      setMobileError(e instanceof Error ? e.message : String(e));
    } finally {
      setMobileBusy(false);
    }
  }, [mobileCreateName]);

  const handleMobileExport = useCallback(async () => {
    setMobileError(null);
    setMobileBusy(true);
    try {
      const currentPath = await getDatabasePath();
      if (!currentPath) {
        setMobileError('No database opened');
        return;
      }
      const fileName = currentPath.split('/').pop() || 'dbreader.db';
      await mobileExportDatabase(currentPath, fileName);
    } catch (e) {
      setMobileError(e instanceof Error ? e.message : String(e));
    } finally {
      setMobileBusy(false);
    }
  }, []);

  const handleClose = useCallback(async () => {
    await closeDatabase();
    setIsConnected(false);
    setDbPath(null);
    setPrefs((p) => ({ ...p, lastDbPath: null }));
  }, []);

  const fileName = dbPath?.split(/[\\/]/).pop() || '';

  return (
    <I18nProvider language={prefs.language}>
      {!accountChecked ? (
        <div className="h-screen flex items-center justify-center bg-bg-primary" />
      ) : !account ? (
        <LoginView t={t} onSignedIn={(email) => setAccount({ email })} />
      ) : (
      <>
      <div className="h-screen flex flex-col bg-bg-primary text-text-primary">
      {/* Header */}
      {!isMobile && (
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
          onClick={() => setViewMode(viewMode === 'settings' ? 'workspace' : 'settings')}
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

            <div className="h-4 w-px bg-border mx-1 shrink-0" />

            <button
              onClick={() => setViewMode('workspace')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors shrink-0 ${
                viewMode === 'workspace'
                  ? 'bg-accent text-white'
                  : 'bg-bg-tertiary border border-border text-text-secondary hover:text-text-primary'
              }`}
            >
              <Database size={12} />
              {t('view.workspace')}
            </button>

            <div className="h-4 w-px bg-border mx-1 shrink-0" />

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
          </div>
        )}
      </header>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Center area */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {isMobile && (
            <div className="mobile-topbar flex items-center gap-2 px-3 py-2 border-b border-border bg-bg-secondary shrink-0">
              {viewMode !== 'workspace' ? (
                <button
                  onClick={goBack}
                  className="flex items-center justify-center w-8 h-8 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-text-primary transition-colors shrink-0"
                  aria-label="Back"
                >
                  <ChevronLeft size={16} />
                </button>
              ) : (
                <div className="flex items-center gap-1.5 shrink-0">
                  <Database size={15} className="text-accent" />
                  <h1 className="text-sm font-bold tracking-tight">DBReader Lite</h1>
                </div>
              )}
              <div className="flex-1 min-w-0 text-right">
                {isConnected && (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-success/10 border border-success/20 rounded-md text-[11px] text-success max-w-full truncate">
                    <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse shrink-0" />
                    <span className="truncate">{dbPath?.split('/').pop() || ''}</span>
                  </span>
                )}
              </div>
              {isConnected && (
                <button
                  onClick={handleMobileExport}
                  disabled={mobileBusy}
                  className="flex items-center justify-center w-8 h-8 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-text-secondary hover:text-text-primary transition-colors shrink-0"
                  aria-label="Export database"
                >
                  <Share2 size={14} />
                </button>
              )}
            </div>
          )}
          <div key={viewMode} className={`${viewMode === 'workspace' || viewMode === 'settings' ? 'hidden' : 'flex-1'} flex flex-col overflow-hidden`}>
          {viewMode === 'dashboard' && (
            <Dashboard refreshKey={syncTick} onNavigate={(stockFilter) => {
              setGalleryStockFilter(stockFilter);
              setViewMode('gallery');
            }} />
          )}
          {viewMode === 'adjust' && <QuickAdjust refreshKey={syncTick} />}
          {viewMode === 'gallery' && (
            <ProductGallery
              refreshKey={syncTick}
              initialStockFilter={galleryStockFilter}
              onSelectProduct={(product) => {
                setSelectedProduct(product);
                setViewMode('detail');
              }}
            />
          )}
          {viewMode === 'detail' && selectedProduct && (
            <ProductDetail
              refreshKey={syncTick}
              product={selectedProduct}
              onBack={() => setViewMode('gallery')}
              currencySymbol={prefs.currencySymbol}
            />
          )}
          {viewMode === 'categories' && <CategoryManager refreshKey={syncTick} />}
          {viewMode === 'used' && <UseHistory refreshKey={syncTick} />}
          {viewMode === 'products' && <ProductManager refreshKey={syncTick} />}
          {viewMode === 'batches' && <BatchManager refreshKey={syncTick} currencySymbol={prefs.currencySymbol} />}
          {viewMode === 'logs' && <InventoryLog refreshKey={syncTick} />}
          {viewMode === 'txhistory' && <TransactionHistory refreshKey={syncTick} />}
          {viewMode === 'reports' && <Reports refreshKey={syncTick} currencySymbol={prefs.currencySymbol} />}
          </div>
          {viewMode === 'workspace' && !isMobile && (
            <Workspace
              tabs={launcherTabs}
              theme={prefs.theme}
              isMobile={isMobile}
              onNavigate={(mode) => {
                if (prefs.useDefaultTaskbar) {
                  if (!DEFAULT_TABS.includes(mode)) {
                    setPrefs((p) => ({ ...p, useDefaultTaskbar: false, enabledTabs: [...DEFAULT_TABS, mode] }));
                  }
                } else if (!isTabEnabled(mode)) {
                  const all = ALL_TABS.map((x) => x.mode);
                  const enabledSet = new Set(prefs.enabledTabs ?? all);
                  enabledSet.add(mode);
                  const next = all.filter((m) => enabledSet.has(m));
                  setPrefs((p) => ({ ...p, enabledTabs: next.length === all.length ? null : next }));
                }
                setViewMode(mode as ViewMode);
              }}
            />
          )}
          {viewMode === 'workspace' && isMobile && (
            <> 
              {!isConnected && !initializing ? (
                <div className="flex-1 overflow-y-auto">
                  <div className="max-w-md mx-auto px-5 py-10 flex flex-col items-center text-center">
                    <div className="w-20 h-20 rounded-2xl bg-accent/15 border border-accent/30 flex items-center justify-center mb-5">
                      <Database size={36} className="text-accent" />
                    </div>
                    <h2 className="text-lg font-bold text-text-primary mb-1">DBReader Lite</h2>
                    <p className="text-sm text-text-secondary mb-8 leading-relaxed">
                      {t('welcome.tagline')}
                    </p>
                    <p className="text-xs text-text-secondary mb-4">
                      To get started, import an existing database file or create a new one.
                    </p>
                    {mobileError && (
                      <div className="w-full mb-3 px-3 py-2 bg-error/10 border border-error/30 rounded-md text-xs text-error text-left break-words">
                        {mobileError}
                      </div>
                    )}
                    <div className="flex flex-col gap-3 w-full max-w-[260px]">
                      <button
                        onClick={handleOpenFile}
                        disabled={mobileBusy}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-accent hover:bg-accent-hover rounded-xl text-sm font-medium text-white transition-colors disabled:opacity-50"
                      >
                        <UploadCloud size={16} />
                        {t('welcome.open')}
                      </button>
                      <button
                        onClick={handleCreateNew}
                        disabled={mobileBusy}
                        className="flex items-center justify-center gap-2 px-4 py-3 bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded-xl text-sm font-medium text-accent transition-colors disabled:opacity-50"
                      >
                        <FilePlus2 size={16} />
                        {t('welcome.create')}
                      </button>
                      {mobileBusy && (
                        <span className="text-xs text-text-secondary animate-pulse">Working…</span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto">
                  <Workspace
                    tabs={launcherTabs}
                    theme={prefs.theme}
                    isMobile={isMobile}
                    onNavigate={(mode) => {
                      if (!isTabEnabled(mode)) {
                        const all = ALL_TABS.map((x) => x.mode);
                        const enabledSet = new Set(prefs.enabledTabs ?? all);
                        enabledSet.add(mode);
                        const next = all.filter((m) => enabledSet.has(m));
                        setPrefs((p) => ({ ...p, enabledTabs: next.length === all.length ? null : next }));
                      }
                      setViewMode(mode as ViewMode);
                    }}
                  />
                  <div className="px-4 pb-8">
                    <div className="grid grid-cols-3 gap-3">
                      <button
                        onClick={() => setViewMode('settings')}
                        className="flex flex-col items-center gap-2 p-4 rounded-xl bg-bg-secondary border border-border hover:bg-bg-hover transition-colors"
                      >
                        <SettingsIcon size={22} className="text-text-secondary" />
                        <span className="text-xs text-text-secondary">{t('app.settings')}</span>
                      </button>
                      <button
                        onClick={() => setHelpOpen(true)}
                        className="flex flex-col items-center gap-2 p-4 rounded-xl bg-bg-secondary border border-border hover:bg-bg-hover transition-colors"
                      >
                        <HelpCircle size={22} className="text-text-secondary" />
                        <span className="text-xs text-text-secondary">{t('app.help')}</span>
                      </button>
                      <button
                        onClick={handleClose}
                        className="flex flex-col items-center gap-2 p-4 rounded-xl bg-bg-secondary border border-border hover:bg-bg-hover transition-colors"
                      >
                        <X size={22} className="text-text-secondary" />
                        <span className="text-xs text-text-secondary">Close database</span>
                      </button>
                    </div>
                    {mobileError && (
                      <div className="mt-3 px-3 py-2 bg-error/10 border border-error/30 rounded-md text-xs text-error break-words">
                        {mobileError}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
          {viewMode === 'settings' && (
            <SettingsView
              prefs={prefs}
              tabs={ALL_TABS}
              onChange={(patch) => setPrefs((p) => ({ ...p, ...patch }))}
              onReset={() => setPrefs((p) => ({ ...DEFAULT_PREFS, lastDbPath: p.lastDbPath }))}
              t={t}
              accountEmail={account?.email ?? ''}
              onSignOut={handleSignOut}
            />
          )}
        </div>
      </div>

      {/* Welcome overlay */}      {!isMobile && !initializing && !isConnected && (
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

      {debugVisible && (
        <button
          onClick={() => { setDebugVisible(false); sessionStorage.setItem('hideDbg', '1'); }}
          className="fixed bottom-16 right-2 z-50 px-2 py-1 rounded bg-black/70 border border-white/20 text-xs text-white/90 font-mono max-w-[90%] truncate"
          title="Tap to hide"
        >
          {debugInfo}
        </button>
      )}

      <HelpChat open={helpOpen} onClose={() => setHelpOpen(false)} />

      {isMobile && mobileCreateOpen && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 px-6">
          <div className="w-full max-w-sm rounded-2xl bg-bg-secondary border border-border p-5">
            <h3 className="text-base font-bold text-text-primary mb-1">
              {t('welcome.create')}
            </h3>
            <p className="text-xs text-text-secondary mb-4">
              A new inventory database will be created on this device.
            </p>
            <label className="block text-xs text-text-secondary mb-1.5">Database name</label>
            <input
              value={mobileCreateName}
              onChange={(e) => setMobileCreateName(e.target.value)}
              placeholder="wine_inventory"
              autoFocus
              className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-md text-sm text-text-primary outline-none focus:border-accent mb-4"
            />
            {mobileError && (
              <div className="mb-3 px-3 py-2 bg-error/10 border border-error/30 rounded-md text-xs text-error break-words">
                {mobileError}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setMobileCreateOpen(false);
                  setMobileError(null);
                }}
                className="flex-1 px-3 py-2.5 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-lg text-sm text-text-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleMobileCreateConfirm}
                disabled={mobileBusy}
                className="flex-1 px-3 py-2.5 bg-accent hover:bg-accent-hover rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50"
              >
                {mobileBusy ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </I18nProvider>
  );
}
