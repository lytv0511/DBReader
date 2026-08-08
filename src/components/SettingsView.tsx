import {
  Languages,
  Monitor,
  Moon,
  Power,
  RotateCcw,
  Settings,
  Sun,
  ListRestart,
  Info,
  Palette,
  Flame,
  Waves,
  TreePine,
  Candy,
  Crown,
  MoonStar,
  Mountain,
  Coins,
  Mail,
  Send,
  Bell,
  BellRing,
  Loader2,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { AppPreferences, ThemeMode, LanguageCode } from '../types';
import { DEFAULT_TABS } from '../types';
import { LANGS } from '../lib/i18n';
import { isAndroid } from '../lib/platform';

interface SettingsViewProps {
  prefs: AppPreferences;
  tabs: { mode: string; labelKey: string }[];
  onChange: (patch: Partial<AppPreferences>) => void;
  onReset: () => void;
  t: (key: string) => string;
}

const LIMIT_OPTIONS = [50, 100, 250, 500, 1000];
const MAX_ENABLED_TABS = 6;

export default function SettingsView({ prefs, tabs, onChange, onReset, t }: SettingsViewProps) {
  const isMobile = isAndroid();
  const themes: { mode: ThemeMode; icon: React.ReactNode; label: string }[] = [
    { mode: 'dark', icon: <Moon size={14} />, label: t('settings.theme.dark') },
    { mode: 'light', icon: <Sun size={14} />, label: t('settings.theme.light') },
    { mode: 'system', icon: <Monitor size={14} />, label: t('settings.theme.system') },
    { mode: 'aurora', icon: <Palette size={14} />, label: t('settings.theme.aurora') },
    { mode: 'sunset', icon: <Flame size={14} />, label: t('settings.theme.sunset') },
    { mode: 'ocean', icon: <Waves size={14} />, label: t('settings.theme.ocean') },
    { mode: 'forest', icon: <TreePine size={14} />, label: t('settings.theme.forest') },
    { mode: 'candy', icon: <Candy size={14} />, label: t('settings.theme.candy') },
    { mode: 'gold', icon: <Crown size={14} />, label: t('settings.theme.gold') },
    { mode: 'midnight', icon: <MoonStar size={14} />, label: t('settings.theme.midnight') },
    { mode: 'lava', icon: <Mountain size={14} />, label: t('settings.theme.lava') },
  ];

  const sectionCls = 'flex flex-col gap-3';
  const rowLabel = 'text-xs font-semibold uppercase tracking-wide text-text-secondary';
  const selectCls =
    'px-3 py-2 bg-bg-tertiary border border-border rounded-md text-sm text-text-primary focus:outline-none focus:border-border-focus';
  const inputCls =
    'px-3 py-2 bg-bg-tertiary border border-border rounded-md text-sm text-text-primary focus:outline-none focus:border-border-focus';
  const [testing, setTesting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notifTesting, setNotifTesting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshLastError = () => {
    invoke<string>('get_email_last_error')
      .then((msg) => setLastError(msg))
      .catch(() => {});
  };

  useEffect(() => {
    if (prefs.emailAlertsEnabled) {
      refreshLastError();
      timerRef.current = setInterval(refreshLastError, 5000);
    } else {
      setLastError(null);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [prefs.emailAlertsEnabled]);

  const sendTestEmail = async () => {
    setTesting(true);
    try {
      await invoke('test_email_connection');
      setLastError(t('settings.email.testOk'));
    } catch (e) {
      setLastError(String(e));
    } finally {
      setTesting(false);
    }
  };

  const updateSlot = (i: number, patch: Partial<{ enabled: boolean; time: string }>) => {
    onChange({
      emailSlots: prefs.emailSlots.map((s, idx) =>
        idx === i ? { ...s, ...patch } : s
      ),
    });
  };

  const checkNow = async () => {
    setChecking(true);
    try {
      await invoke('check_stock_alerts');
      setLastError(t('settings.email.checkQueued'));
    } catch (e) {
      setLastError(String(e));
    } finally {
      setChecking(false);
    }
  };

  const sendTestNotification = async () => {
    setNotifTesting(true);
    try {
      await invoke('test_notification');
      setLastError(t('settings.email.testNotifQueued'));
    } catch (e) {
      setLastError(String(e));
    } finally {
      setNotifTesting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-bg-primary text-text-primary">
      <div className="max-w-2xl mx-auto p-6 flex flex-col gap-6">
        <div className="flex items-center gap-2">
          <Settings size={16} className="text-accent" />
          <h2 className="text-base font-bold">{t('settings.title')}</h2>
        </div>

        {/* Language */}
        <section className={`${sectionCls} p-4 bg-bg-secondary border border-border rounded-lg`}>
          <div className="flex items-center gap-2">
            <Languages size={14} className="text-accent" />
            <span className={rowLabel}>{t('settings.language')}</span>
          </div>
          <select
            className={selectCls}
            value={prefs.language}
            onChange={(e) => onChange({ language: e.target.value as LanguageCode })}
          >
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </section>

        {/* Theme */}
        <section className={`${sectionCls} p-4 bg-bg-secondary border border-border rounded-lg`}>
          <div className="flex items-center gap-2">
            <Sun size={14} className="text-accent" />
            <span className={rowLabel}>{t('settings.theme')}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {themes.map((th) => (
              <button
                key={th.mode}
                onClick={() => onChange({ theme: th.mode })}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm border transition-colors whitespace-nowrap ${
                  prefs.theme === th.mode
                    ? 'bg-accent text-white border-accent'
                    : 'bg-bg-tertiary text-text-secondary hover:text-text-primary border-border'
                }`}
              >
                {th.icon}
                {th.label}
              </button>
            ))}
          </div>
        </section>

        {/* Open on startup */}
        <section className={`${sectionCls} p-4 bg-bg-secondary border border-border rounded-lg`}>
          <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
              <Power size={14} className="text-accent" />
              <span className={rowLabel}>{t('settings.openOnStartup')}</span>
            </div>
            <button
              role="switch"
              aria-checked={prefs.openOnStartup}
              onClick={() => onChange({ openOnStartup: !prefs.openOnStartup })}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                prefs.openOnStartup ? 'bg-accent' : 'bg-bg-tertiary border border-border'
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                  prefs.openOnStartup ? 'left-[22px]' : 'left-0.5'
                }`}
              />
            </button>
          </div>
        </section>

        {/* Query limit */}
        <section className={`${sectionCls} p-4 bg-bg-secondary border border-border rounded-lg`}>
          <div className="flex items-center gap-2">
            <ListRestart size={14} className="text-accent" />
            <span className={rowLabel}>{t('settings.queryLimit')}</span>
          </div>
          <div className="flex items-center gap-2">
            {LIMIT_OPTIONS.map((n) => (
              <button
                key={n}
                onClick={() => onChange({ defaultQueryLimit: n })}
                className={`w-12 py-1.5 rounded-md text-sm border transition-colors ${
                  prefs.defaultQueryLimit === n
                    ? 'bg-accent text-white border-accent'
                    : 'bg-bg-tertiary text-text-secondary hover:text-text-primary border-border'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </section>

        {/* Tabs (desktop only - mobile has no tab bar) */}
        {!isMobile && (
        <section className={`${sectionCls} p-4 bg-bg-secondary border border-border rounded-lg`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings size={14} className="text-accent" />
              <span className={rowLabel}>{t('settings.tabs')}</span>
            </div>
            <span className="text-xs text-text-secondary">{t('settings.tabsMax')}</span>
          </div>
          <div className="flex items-center justify-between p-3 rounded-md border border-border bg-bg-tertiary">
            <span className="text-sm text-text-primary">{t('settings.defaultTaskbar')}</span>
            <button
              role="switch"
              aria-checked={prefs.useDefaultTaskbar}
              onClick={() => onChange({ useDefaultTaskbar: !prefs.useDefaultTaskbar })}
              className={`relative w-9 h-[18px] rounded-full transition-colors shrink-0 ${
                prefs.useDefaultTaskbar ? 'bg-accent' : 'bg-bg-tertiary border border-border'
              }`}
            >
              <span
                className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all ${
                  prefs.useDefaultTaskbar ? 'left-[18px]' : 'left-0.5'
                }`}
              />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {tabs.map((tab) => {
              const enabled = prefs.useDefaultTaskbar
                ? DEFAULT_TABS.includes(tab.mode)
                : prefs.enabledTabs
                  ? prefs.enabledTabs.includes(tab.mode)
                  : true;
              const enabledCount = prefs.enabledTabs ? prefs.enabledTabs.length : tabs.length;
              const atCap = !enabled && enabledCount >= MAX_ENABLED_TABS;
              const locked = prefs.useDefaultTaskbar;
              return (
                <div
                  key={tab.mode}
                  className={`flex items-center justify-between px-3 py-2 rounded-md border transition-colors ${
                    enabled ? 'bg-bg-tertiary border-border' : 'bg-bg-primary border-border opacity-60'
                  } ${locked ? 'opacity-50' : ''}`}
                >
                  <span className="text-sm text-text-primary">{t(tab.labelKey)}</span>
                  <button
                    role="switch"
                    aria-checked={enabled}
                    disabled={atCap || locked}
                    onClick={() => {
                      if (atCap || locked) return;
                      const all = tabs.map((x) => x.mode);
                      const enabledSet = new Set(prefs.enabledTabs ?? all);
                      if (enabledSet.has(tab.mode)) enabledSet.delete(tab.mode);
                      else enabledSet.add(tab.mode);
                      const next = all.filter((m) => enabledSet.has(m));
                      onChange({ enabledTabs: next.length === all.length ? null : next });
                    }}
                    title={atCap ? t('settings.tabsMax') : undefined}
                    className={`relative w-9 h-[18px] rounded-full transition-colors shrink-0 ${
                      enabled ? 'bg-accent' : 'bg-bg-tertiary border border-border'
                    } ${atCap ? 'cursor-not-allowed' : ''}`}
                  >
                    <span
                      className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all ${
                        enabled ? 'left-[18px]' : 'left-0.5'
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
        )}

        {/* Currency symbol */}
        <section className={`${sectionCls} p-4 bg-bg-secondary border border-border rounded-lg`}>
          <div className="flex items-center gap-2">
            <Coins size={14} className="text-accent" />
            <span className={rowLabel}>{t('settings.currency')}</span>
          </div>
          <div className="flex items-center gap-2">
            {['$', '€', '£', '¥', '฿'].map((sym) => (
              <button
                key={sym}
                onClick={() => onChange({ currencySymbol: sym })}
                className={`w-12 py-1.5 rounded-md text-sm border transition-colors ${
                  prefs.currencySymbol === sym
                    ? 'bg-accent text-white border-accent'
                    : 'bg-bg-tertiary text-text-secondary hover:text-text-primary border-border'
                }`}
              >
                {sym}
              </button>
            ))}
            <input
              value={prefs.currencySymbol}
              onChange={(e) => onChange({ currencySymbol: e.target.value || '$' })}
              maxLength={3}
              className="w-20 px-3 py-2 bg-bg-tertiary border border-border rounded-md text-sm text-center text-text-primary focus:outline-none focus:border-border-focus"
              placeholder="$"
            />
          </div>
        </section>

        {/* Email alerts */}
        <section className={`${sectionCls} p-4 bg-bg-secondary border border-border rounded-lg`}>
          {isMobile && (
          <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell size={14} className="text-accent" />
              <span className="text-sm text-text-primary">{t('settings.email.confirmDesktopNotifications')}</span>
            </div>
            <button
              role="switch"
              aria-checked={prefs.desktopNotifications}
              onClick={() => onChange({ desktopNotifications: !prefs.desktopNotifications })}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                prefs.desktopNotifications ? 'bg-accent' : 'bg-bg-tertiary border border-border'
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                  prefs.desktopNotifications ? 'left-[22px]' : 'left-0.5'
                }`}
              />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={sendTestNotification}
              disabled={notifTesting}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-tertiary hover:bg-bg-primary border border-border rounded-md text-xs text-text-primary transition-colors"
            >
              {notifTesting ? <Loader2 size={11} className="animate-spin" /> : <BellRing size={11} />}
              {t('settings.email.testNotif')}
            </button>
            {lastError && <span className="text-xs text-text-secondary truncate">{lastError}</span>}
          </div>
          </>
          )}
          {!isMobile && (
          <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail size={14} className="text-accent" />
              <span className={rowLabel}>{t('settings.email.title')}</span>
            </div>
            <button
              role="switch"
              aria-checked={prefs.emailAlertsEnabled}
              onClick={() => onChange({ emailAlertsEnabled: !prefs.emailAlertsEnabled })}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                prefs.emailAlertsEnabled ? 'bg-accent' : 'bg-bg-tertiary border border-border'
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                  prefs.emailAlertsEnabled ? 'left-[22px]' : 'left-0.5'
                }`}
              />
            </button>
          </div>
          <p className="text-xs text-text-secondary">{t('settings.email.desc')}</p>
          <div className={`flex flex-col gap-3 ${prefs.emailAlertsEnabled ? '' : 'opacity-40 pointer-events-none'}`}>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-secondary">{t('settings.email.recipients')}</span>
              <input
                value={prefs.emailRecipients}
                onChange={(e) => onChange({ emailRecipients: e.target.value })}
                className={inputCls}
                placeholder="a@example.com, b@example.com"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-secondary">{t('settings.email.slots')}</span>
              <div className="flex flex-col gap-2">
                {prefs.emailSlots.map((slot, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 rounded-md border border-border bg-bg-tertiary">
                    <div className="flex items-center gap-2">
                      <button
                        role="switch"
                        aria-checked={slot.enabled}
                        onClick={() => updateSlot(i, { enabled: !slot.enabled })}
                        className={`relative w-9 h-[18px] rounded-full transition-colors shrink-0 ${
                          slot.enabled ? 'bg-accent' : 'bg-bg-tertiary border border-border'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all ${
                            slot.enabled ? 'left-[18px]' : 'left-0.5'
                          }`}
                        />
                      </button>
                      <span className={`text-sm text-text-primary ${slot.enabled ? '' : 'opacity-50'}`}>
                        {t(`settings.email.slot${i + 1}`)}
                      </span>
                    </div>
                    <input
                      type="time"
                      value={slot.time}
                      disabled={!slot.enabled}
                      onChange={(e) => updateSlot(i, { time: e.target.value })}
                      className={`px-2 py-1 rounded-md border text-sm bg-bg-primary text-text-primary focus:outline-none focus:border-border-focus ${
                        slot.enabled ? 'border-border' : 'border-border opacity-40'
                      }`}
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={sendTestEmail}
                disabled={testing}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:opacity-90 disabled:opacity-50 rounded-md text-xs text-white transition-opacity"
              >
                {testing ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                {t('settings.email.test')}
              </button>
              <button
                onClick={checkNow}
                disabled={checking}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-tertiary hover:bg-bg-primary border border-border rounded-md text-xs text-text-primary transition-colors"
              >
                {checking ? <Loader2 size={11} className="animate-spin" /> : <Bell size={11} />}
                {t('settings.email.checkNow')}
              </button>
              <button
                onClick={sendTestNotification}
                disabled={notifTesting}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-tertiary hover:bg-bg-primary border border-border rounded-md text-xs text-text-primary transition-colors"
              >
                {notifTesting ? <Loader2 size={11} className="animate-spin" /> : <BellRing size={11} />}
                {t('settings.email.testNotif')}
              </button>
              {lastError && <span className="text-xs text-text-secondary truncate">{lastError}</span>}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell size={14} className="text-accent" />
              <span className="text-sm text-text-primary">{t('settings.email.confirmDesktopNotifications')}</span>
            </div>
            <button
              role="switch"
              aria-checked={prefs.desktopNotifications}
              onClick={() => onChange({ desktopNotifications: !prefs.desktopNotifications })}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                prefs.desktopNotifications ? 'bg-accent' : 'bg-bg-tertiary border border-border'
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                  prefs.desktopNotifications ? 'left-[22px]' : 'left-0.5'
                }`}
              />
            </button>
          </div>
          {!isMobile && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Power size={14} className="text-accent" />
              <span className="text-sm text-text-primary">{t('settings.email.launchAtLogin')}</span>
            </div>
            <button
              role="switch"
              aria-checked={prefs.launchAtLogin}
              onClick={() => {
                const next = !prefs.launchAtLogin;
                onChange({ launchAtLogin: next });
                invoke('set_launch_at_login', { enabled: next }).catch((e) => {
                  setLastError(String(e));
                  onChange({ launchAtLogin: !next });
                });
              }}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                prefs.launchAtLogin ? 'bg-accent' : 'bg-bg-tertiary border border-border'
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                  prefs.launchAtLogin ? 'left-[22px]' : 'left-0.5'
                }`}
              />
            </button>
          </div>
          )}
          </>
          )}
        </section>

        {/* Danger / reset */}
        <section className="flex items-center justify-between p-4 bg-bg-secondary border border-border rounded-lg">
          <div className="flex items-center gap-2">
            <Info size={14} className="text-accent" />
            <span className="text-xs text-text-secondary">{t('settings.appDesc')}</span>
          </div>
          <button
            onClick={onReset}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-error/10 hover:bg-error/20 border border-error/30 rounded-md text-xs text-error transition-colors"
          >
            <RotateCcw size={11} />
            {t('settings.reset')}
          </button>
        </section>
      </div>
    </div>
  );
}