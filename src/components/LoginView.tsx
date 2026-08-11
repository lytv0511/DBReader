import { useState } from 'react';
import { Database, Loader2, Lock, Mail } from 'lucide-react';
import { accountSignIn } from '../lib/account';
import { isMobile as isMobilePlatform } from '../lib/platform';

const inputCls =
  'w-full px-3 py-2.5 bg-bg-tertiary border border-border rounded-md text-sm text-text-primary focus:outline-none focus:border-border-focus';

interface LoginViewProps {
  t: (key: string) => string;
  onSignedIn: (email: string) => void;
}

export default function LoginView({ t, onSignedIn }: LoginViewProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isMobile = isMobilePlatform();

  const canSubmit = email.trim().length > 0 && password.length > 0;

  const submit = async () => {
    if (!canSubmit || busy) return;
    setError(null);
    setBusy(true);
    try {
      const s = await accountSignIn(email.trim(), password);
      onSignedIn(s.email);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const centered = !isMobile;

  return (
    <div
      className={`h-screen w-screen overflow-y-auto bg-bg-primary text-text-primary ${
        centered ? 'flex items-center justify-center' : ''
      }`}
    >
      <div
        className={`w-full ${
          centered
            ? 'max-w-sm p-8 bg-bg-secondary border border-border rounded-2xl flex flex-col gap-4 shadow-xl'
            : 'max-w-md mx-auto px-5 py-12 flex flex-col items-center text-center gap-4'
        }`}
      >
        <div
          className={`rounded-2xl bg-accent/15 border border-accent/30 flex items-center justify-center ${
            centered ? 'w-14 h-14 mb-1' : 'w-20 h-20 mb-2'
          }`}
        >
          <Database size={centered ? 26 : 36} className="text-accent" />
        </div>
        <h1 className="text-xl font-bold text-text-primary">{t('login.title')}</h1>
        <p className="text-sm text-text-secondary leading-relaxed">{t('login.tagline')}</p>

        <div className="flex flex-col gap-3 w-full mt-2 text-left">
          <div className="relative">
            <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              className={`${inputCls} pl-9`}
              type="email"
              value={email}
              autoFocus={!isMobile}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('login.email')}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </div>
          <div className="relative">
            <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <input
              className={`${inputCls} pl-9`}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('login.password')}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
            />
          </div>
          <button
            onClick={submit}
            disabled={!canSubmit || busy}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-accent hover:opacity-90 disabled:opacity-50 rounded-md text-sm font-semibold text-white transition-opacity"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
            {t('login.submit')}
          </button>
          {error && (
            <div className="px-3 py-2 bg-error/10 border border-error/30 rounded-md text-xs text-error break-words">
              {error}
            </div>
          )}
        </div>

        <p className="text-xs text-text-secondary leading-relaxed">{t('login.createHint')}</p>
      </div>
    </div>
  );
}