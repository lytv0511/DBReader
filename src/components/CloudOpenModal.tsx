import { useCallback, useEffect, useState } from 'react';
import { CloudDownload, Database, Loader2, RefreshCw, Shield, Trash2, UploadCloud, Users, X } from 'lucide-react';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import {
  accountInventories,
  cloudOpen,
  teamDeleteFile,
  teamUploadFile,
  type CloudFile,
  type CloudTeam,
} from '../lib/teams';
import { isMobile as isMobilePlatform } from '../lib/platform';
import { mobileImportDatabase } from '../lib/db';

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
  const [myFiles, setMyFiles] = useState<CloudFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const inv = await accountInventories();
      setTeams(inv.teams);
      setMyFiles(inv.files ?? []);
    } catch (e) {
      setError(String(e));
      setTeams([]);
      setMyFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setTeams(null);
      setMyFiles([]);
      setBusy(null);
      setConfirmDelete(null);
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

  const pickUploadPath = async (): Promise<string | null> => {
    if (isMobilePlatform()) {
      try {
        return await mobileImportDatabase('dbreader_upload.db');
      } catch {
        return null;
      }
    }
    const selected = await dialogOpen({
      multiple: false,
      filters: [{ name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] }],
    });
    return selected && !Array.isArray(selected) ? selected : null;
  };

  const doUpload = async (teamId: string) => {
    if (busy) return;
    setError(null);
    const path = await pickUploadPath();
    if (!path) return;
    setBusy(`upload-${teamId}`);
    try {
      await teamUploadFile(path, teamId);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async (teamId: string, file: CloudFile) => {
    const key = `${teamId}/${file.file_id}`;
    if (confirmDelete !== key) {
      setConfirmDelete(key);
      return;
    }
    setConfirmDelete(null);
    setError(null);
    setBusy(`delete-${key}`);
    try {
      await teamDeleteFile(teamId, file.file_id);
      await refresh();
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
          ) : teams && teams.length === 0 && myFiles.length === 0 ? (
            <div className="py-10 text-center text-xs text-text-secondary">{t('openFrom.noCloud')}</div>
          ) : (
            <>
              <div className="rounded-xl border border-border bg-bg-tertiary/50 overflow-hidden shrink-0">
                <div className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary border-b border-border">
                  <Database size={13} className="text-text-secondary" />
                  <span className="flex-1 text-sm font-semibold text-text-primary truncate">
                    {t('openFrom.myFiles')}
                  </span>
                  <button
                    onClick={() => doUpload('')}
                    disabled={!!busy}
                    title={t('team.upload')}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded-md text-[11px] font-semibold text-accent transition-colors disabled:opacity-50 shrink-0"
                  >
                    {busy === 'upload-' ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <UploadCloud size={11} />
                    )}
                    {t('team.upload')}
                  </button>
                </div>
                {myFiles.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-text-secondary">{t('openFrom.emptyTeam')}</div>
                ) : (
                  <div className="divide-y divide-border">
                    {myFiles.map((file) => {
                      const key = `/${file.file_id}`;
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
                            onClick={() => doOpen('', file)}
                            disabled={!!busy}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:opacity-90 disabled:opacity-50 rounded-md text-xs font-semibold text-white transition-opacity shrink-0"
                          >
                            {opening ? <Loader2 size={11} className="animate-spin" /> : <CloudDownload size={11} />}
                            {t('team.open')}
                          </button>
                          {confirmDelete === key ? (
                            <div className="flex items-center gap-2 rounded-md border border-error/30 bg-error/10 px-2 py-1 shrink-0">
                              <Trash2 size={11} className="text-error" />
                              <span className="text-[10px] text-error whitespace-nowrap">{t('team.deleteConfirm')}</span>
                              <button
                                onClick={() => doDelete('', file)}
                                disabled={!!busy}
                                className="text-[10px] font-semibold text-error hover:underline"
                              >
                                {t('team.deleteYes')}
                              </button>
                              <button
                                onClick={() => setConfirmDelete(null)}
                                className="text-[10px] text-text-secondary hover:underline"
                              >
                                {t('team.deleteNo')}
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => doDelete('', file)}
                              disabled={!!busy}
                              title={t('team.deleteFile')}
                              className="w-7 h-7 grid place-items-center rounded-md bg-bg-tertiary hover:bg-bg-hover border border-border text-text-secondary hover:text-error hover:border-error/40 transition-colors shrink-0"
                            >
                              {busy === `delete-${key}` ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                <Trash2 size={11} />
                              )}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {teams?.map((team) => (
                <div key={team.team_id} className="rounded-xl border border-border bg-bg-tertiary/50 overflow-hidden shrink-0">
                  <div className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary border-b border-border">
                    <Users size={13} className="text-text-secondary" />
                    <span className="flex-1 text-sm font-semibold text-text-primary truncate">{team.name}</span>
                    {roleBadge(team.role)}
                    <button
                      onClick={() => doUpload(team.team_id)}
                      disabled={!!busy}
                      title={t('team.upload')}
                      className="flex items-center gap-1 px-2.5 py-1.5 bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded-md text-[11px] font-semibold text-accent transition-colors disabled:opacity-50 shrink-0"
                    >
                      {busy === `upload-${team.team_id}` ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <UploadCloud size={11} />
                      )}
                      {t('team.upload')}
                    </button>
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
                            {team.role === 'owner' &&
                              (confirmDelete === key ? (
                                <div className="flex items-center gap-2 rounded-md border border-error/30 bg-error/10 px-2 py-1 shrink-0">
                                  <Trash2 size={11} className="text-error" />
                                  <span className="text-[10px] text-error whitespace-nowrap">
                                    {t('team.deleteConfirm')}
                                  </span>
                                  <button
                                    onClick={() => doDelete(team.team_id, file)}
                                    disabled={!!busy}
                                    className="text-[10px] font-semibold text-error hover:underline"
                                  >
                                    {t('team.deleteYes')}
                                  </button>
                                  <button
                                    onClick={() => setConfirmDelete(null)}
                                    className="text-[10px] text-text-secondary hover:underline"
                                  >
                                    {t('team.deleteNo')}
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => doDelete(team.team_id, file)}
                                  disabled={!!busy}
                                  title={t('team.deleteFile')}
                                  className="w-7 h-7 grid place-items-center rounded-md bg-bg-tertiary hover:bg-bg-hover border border-border text-text-secondary hover:text-error hover:border-error/40 transition-colors shrink-0"
                                >
                                  {busy === `delete-${key}` ? (
                                    <Loader2 size={11} className="animate-spin" />
                                  ) : (
                                    <Trash2 size={11} />
                                  )}
                                </button>
                              ))}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </>
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