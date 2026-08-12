import { useCallback, useEffect, useState } from 'react';
import { CloudDownload, Database, Loader2, RefreshCw, Shield, Users, X } from 'lucide-react';
import { accountInventories, cloudOpen, type CloudFile, type CloudTeam } from '../lib/teams';

interface CloudOpenModalProps {
  open: boolean;
  t: (key: string) => string;
  onClose: () => void;
  onOpened: () => void;
}

function formatSize(bytes: number, t: (key: string) => string): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} ${t('team.size.mb')}`;
  return `${Math.max(1, Math.round(bytes / 1024))} ${t('team.size.kb')}`;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString();
}

export default function CloudOpenModal({ open, t, onClose, onOpened }: CloudOpenModalProps) {
  const [teams, setTeams] = useState<CloudTeam[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const inv = await accountInventories();
      setTeams(inv.teams);
    } catch (e) {
      setError(String(e));
      setTeams([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setTeams(null);
      setBusy(null);
      refresh();
    }
  }, [open, refresh]);

  const doOpen = async (teamId: string, file: CloudFile) => {
    const key = `${teamId}/${file.file_id}`;
    setBusy(key);
    setError(null);
    try {
      await cloudOpen(teamId, file.file_id);
      onOpened();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!open) return null;

  const roleBadge = (role: string) => {
    if (role === 'owner') {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent/15 border border-accent/30 text-[10px] font-semibold text-accent">
          {t('team.role.owner')}
        </span>
      );
    }
    if (role === 'viewer') {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-tertiary border border-border text-[10px] text-text-secondary">
          {t('team.role.viewer')}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-success/15 border border-success/30 text-[10px] font-semibold text-success">
        {t('team.role.full')}
      </span>
    );
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 px-6">
      <div className="w-full max-w-lg rounded-2xl bg-bg-secondary border border-border shadow-2xl flex flex-col max-h-[80vh]">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
          <CloudDownload size={16} className="text-accent" />
          <h3 className="flex-1 text-base font-bold text-text-primary">{t('openFrom.cloud')}</h3>
          <button
            onClick={refresh}
            disabled={loading}
            className="w-8 h-8 grid place-items-center rounded-md bg-bg-tertiary hover:bg-bg-hover border border-border text-text-secondary hover:text-text-primary transition-colors"
            title="Refresh"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={onClose}
            className="w-8 h-8 grid place-items-center rounded-md bg-bg-tertiary hover:bg-bg-hover border border-border text-text-secondary hover:text-text-primary transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          <p className="text-xs text-text-secondary -mt-1">{t('openFrom.cloudDesc')}</p>
          {error && (
            <div className="px-3 py-2 bg-error/10 border border-error/30 rounded-md text-xs text-error break-words">
              {error}
            </div>
          )}
          {loading && teams === null ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-text-secondary">
              <Loader2 size={14} className="animate-spin" />
              {t('openFrom.opening')}
            </div>
          ) : teams && teams.length === 0 ? (
            <div className="py-10 text-center text-xs text-text-secondary">{t('openFrom.noCloud')}</div>
          ) : (
            teams?.map((team) => (
              <div key={team.team_id} className="rounded-xl border border-border bg-bg-tertiary/50 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary border-b border-border">
                  <Users size={13} className="text-text-secondary" />
                  <span className="flex-1 text-sm font-semibold text-text-primary truncate">{team.name}</span>
                  {roleBadge(team.role)}
                </div>
                {team.files.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-text-secondary">{t('openFrom.emptyTeam')}</div>
                ) : (
                  <div className="divide-y divide-border">
                    {team.files.map((file) => {
                      const key = `${team.team_id}/${file.file_id}`;
                      const opening = busy === key;
                      return (
                        <div key={file.file_id} className="flex items-center gap-3 px-3 py-2.5">
                          <Database size={14} className="text-text-secondary shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-text-primary truncate">{file.name}</div>
                            <div className="text-[11px] text-text-secondary">
                              {formatSize(file.size, t)} · {formatDate(file.created_ts)}
                            </div>
                          </div>
                          <button
                            onClick={() => doOpen(team.team_id, file)}
                            disabled={!!busy}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:opacity-90 disabled:opacity-50 rounded-md text-xs font-semibold text-white transition-opacity shrink-0"
                          >
                            {opening ? <Loader2 size={11} className="animate-spin" /> : <CloudDownload size={11} />}
                            {t('team.open')}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-border text-[11px] text-text-secondary">
          <Shield size={12} className="text-success" />
          {t('team.realtime')}
        </div>
      </div>
    </div>
  );
}