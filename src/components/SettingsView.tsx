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
} from 'lucide-react';
import type { AppPreferences, ThemeMode, LanguageCode } from '../types';
import { LANGS } from '../lib/i18n';

interface SettingsViewProps {
  prefs: AppPreferences;
  onChange: (patch: Partial<AppPreferences>) => void;
  onReset: () => void;
  t: (key: string) => string;
}

const LIMIT_OPTIONS = [50, 100, 250, 500, 1000];

export default function SettingsView({ prefs, onChange, onReset, t }: SettingsViewProps) {
  const themes: { mode: ThemeMode; icon: React.ReactNode; label: string }[] = [
    { mode: 'dark', icon: <Moon size={14} />, label: t('settings.theme.dark') },
    { mode: 'light', icon: <Sun size={14} />, label: t('settings.theme.light') },
    { mode: 'system', icon: <Monitor size={14} />, label: t('settings.theme.system') },
  ];

  const sectionCls = 'flex flex-col gap-3';
  const rowLabel = 'text-xs font-semibold uppercase tracking-wide text-text-secondary';
  const selectCls =
    'px-3 py-2 bg-bg-tertiary border border-border rounded-md text-sm text-text-primary focus:outline-none focus:border-border-focus';

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
          <div className="flex items-center gap-2">
            {themes.map((th) => (
              <button
                key={th.mode}
                onClick={() => onChange({ theme: th.mode })}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm border transition-colors ${
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