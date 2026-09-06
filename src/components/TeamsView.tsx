import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  ClipboardCopy,
  CloudDownload,
  Crown,
  Database,
  Loader2,
  Plus,
  RefreshCw,
  RotateCw,
  Shield,
  Trash2,
  UploadCloud,
  Users,
} from 'lucide-react';
import {
  accountInventories,
  cloudOpen,
  teamCode,
  teamCreate,
  teamDeleteFile,
  teamJoin,
  teamMembers,
  teamPublish,
  teamRotateCode,
  teamSetRole,
  type CloudTeam,
  type TeamMember,
} from '../lib/teams';

interface TeamsViewProps {
  t: (key: string) => string;
  onOpened: () => void;
  dbOpen: boolean;
}

function fmtSize(bytes: number, t: (key: string) => string): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} ${t('team.size.mb')}`;
  return `${Math.max(1, Math.round(bytes / 1024))} ${t('team.size.kb')}`;
}

export default function TeamsView({ t, onOpened, dbOpen }: TeamsViewProps) {
  const [teams, setTeams] = useState<CloudTeam[] | null>(null);
  const [selected, setSelected] = useState<CloudTeam | null>(null);
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const refresh = useCallback(async (preserveSelection = true) => {
    setError(null);
    setLoading(true);
    try {
      const inv = await accountInventories();
      setTeams(inv.teams);
      if (preserveSelection && selected) {
        const updated = inv.teams.find((x) => x.team_id === selected.team_id) ?? null;
        setSelected(updated);
        if (updated) {
          if (updated.role === 'owner') {
            teamCode(updated.team_id).then(setCode).catch(() => {});
          }
          teamMembers(updated.team_id)
            .then((r) => setMembers(r.members))
            .catch(() => setMembers(null));
        }
      }
    } catch (e) {
      setError(String(e));
      setTeams([]);
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    refresh(false);
  }, [refresh]);

  const selectTeam = async (team: CloudTeam) => {
    setSelected(team);
    setMembers(null);
    setCode(null);
    setError(null);
    setNotice(null);
    try {
      const r = await teamMembers(team.team_id);
      setMembers(r.members);
    } catch (e) {
      setError(String(e));
    }
    if (team.role === 'owner') {
      try {
        setCode(await teamCode(team.team_id));
      } catch {
        setCode(null);
      }
    }
  };

  const create = async () => {
    const name = teamName.trim();
    if (!name) return;
    setBusy('create');
    setError(null);
    setNotice(null);
    try {
      const team = await teamCreate(name);
      setCreateOpen(false);
      setTeamName('');
      await refresh(false);
      if (team.team_id) {
        const found = (await accountInventories()).teams.find((x) => x.team_id === team.team_id);
        if (found) selectTeam(found);
      }
      setNotice(t('team.created'));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const join = async () => {
    const codeText = joinCode.trim().toUpperCase();
    if (!codeText) return;
    setBusy('join');
    setError(null);
    setNotice(null);
    try {
      await teamJoin(codeText);
      setJoinOpen(false);
      setJoinCode('');
      await refresh(false);
      setNotice(t('team.joined'));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const rotateCode = async () => {
    if (!selected) return;
    setBusy('rotate');
    setError(null);
    try {
      const c = await teamRotateCode(selected.team_id);
      setCode(c);
      setNotice(t('team.codeChanged'));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const copyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const openFromTeam = async (fileId: string, fileName?: string) => {
    if (!selected) return;
    setBusy(`open-${fileId}`);
    setError(null);
    try {
      await cloudOpen(selected.team_id, fileId, fileName);
      onOpened();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const publishCurrent = async () => {
    if (!selected) return;
    setBusy('publish');
    setError(null);
    setNotice(null);
    try {
      await teamPublish(selected.team_id);
      setNotice(t('team.published'));
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const deleteFile = async (fileId: string) => {
    if (!selected) return;
    if (confirmDelete !== fileId) {
      setConfirmDelete(fileId);
      return;
    }
    setConfirmDelete(null);
    setError(null);
    setNotice(null);
    setBusy(`delete-${fileId}`);
    try {
      await teamDeleteFile(selected.team_id, fileId);
      setNotice(t('team.deleted'));
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const setRole = async (email: string, role: string) => {
    if (!selected) return;
    setBusy(`role-${email}`);
    setError(null);
    try {
      await teamSetRole(selected.team_id, email, role);
      setMembers((prev) => prev?.map((m) => (m.email === email ? { ...m, role } : m)) ?? null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const transferAdmin = async (email: string) => {
    if (!selected) return;
    if (!window.confirm(t('team.transferConfirm').replace('{email}', email))) return;
    setBusy('transfer');
    setError(null);
    try {
      await teamSetRole(selected.team_id, email, 'owner');
      setNotice(t('team.transferred'));
      await refresh(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const roleLabel = (role: string) => {
    if (role === 'owner') return t('team.role.owner');
    if (role === 'viewer') return t('team.role.viewer');
    return t('team.role.full');
  };

  const roleColor = (role: string) => {
    if (role === 'owner') return 'bg-accent/15 border-accent/30 text-accent';
    if (role === 'viewer') return 'bg-bg-tertiary border-border text-text-secondary';
    return 'bg-success/15 border-success/30 text-success';
  };

  if (selected) {
    const isAdmin = selected.role === 'owner';
    return (
      <div className="flex-1 overflow-y-auto bg-bg-primary text-text-primary">
        <div className="max-w-3xl mx-auto px-5 py-6 flex flex-col gap-4">
          <button
            onClick={() => setSelected(null)}
            className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors w-fit"
          >
            <ArrowLeft size={13} />
            {t('team.title')}
          </button>

          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-accent/15 border border-accent/30 grid place-items-center shrink-0">
              <Users size={20} className="text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-text-primary truncate">{selected.name}</h2>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border ${roleColor(selected.role)}`}>
                {isAdmin && <Crown size={10} />}
                {roleLabel(selected.role)}
              </span>
            </div>
            <div className="text-[11px] text-text-secondary text-right leading-tight">
              {t('team.realtime')}
            </div>
          </div>

          {error && (
            <div className="px-3 py-2 bg-error/10 border border-error/30 rounded-md text-xs text-error break-words">{error}</div>
          )}
          {notice && (
            <div className="px-3 py-2 bg-success/10 border border-success/30 rounded-md text-xs text-success break-words">{notice}</div>
          )}

          {isAdmin && (
            <div className="rounded-xl border border-border bg-bg-secondary p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Shield size={13} className="text-accent" />
                <span className="text-sm font-semibold text-text-primary">{t('team.code')}</span>
                <span className="flex-1 text-right font-mono text-lg tracking-[0.2em] text-accent">
                  {code ?? '……'}
                </span>
                <button
                  onClick={copyCode}
                  disabled={!code}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-[11px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
                >
                  {copied ? <Check size={11} className="text-success" /> : <ClipboardCopy size={11} />}
                  {copied ? t('team.copied') : t('team.codeCopy')}
                </button>
                <button
                  onClick={rotateCode}
                  disabled={busy === 'rotate'}
                  className="flex items-center gap-1 px-2.5 py-1.5 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-[11px] text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
                >
                  {busy === 'rotate' ? <Loader2 size={11} className="animate-spin" /> : <RotateCw size={11} />}
                  {t('team.codeChange')}
                </button>
              </div>
              <p className="text-[11px] text-text-secondary">{t('team.codeHint')}</p>
            </div>
          )}

          <div className="rounded-xl border border-border bg-bg-secondary overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
              <Users size={13} className="text-text-secondary" />
              <span className="flex-1 text-sm font-semibold text-text-primary">{t('team.members')}</span>
              <span className="text-[11px] text-text-secondary">{members?.length ?? 0}</span>
            </div>
            <div className="divide-y divide-border">
              {members === null && (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-text-secondary">
                  <Loader2 size={13} className="animate-spin" />…
                </div>
              )}
              {members?.map((m) => {
                const adminOf = isAdmin && m.role !== 'owner';
                return (
                  <div key={m.email} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="w-8 h-8 rounded-full bg-accent/15 border border-accent/30 grid place-items-center shrink-0">
                      <span className="text-xs font-bold text-accent">{(m.name || m.email)[0]?.toUpperCase()}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-text-primary truncate">
                        {m.name || m.email}
                        {m.role === 'owner' && <Crown size={11} className="inline ml-1 text-accent" />}
                      </div>
                      <div className="text-[11px] text-text-secondary truncate">{m.email}</div>
                    </div>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${roleColor(m.role)}`}>
                      {roleLabel(m.role)}
                    </span>
                    {adminOf && (
                      <select
                        value={m.role}
                        disabled={busy === `role-${m.email}`}
                        onChange={(e) => setRole(m.email, e.target.value)}
                        className="px-2 py-1 bg-bg-tertiary border border-border rounded-md text-[11px] text-text-primary outline-none focus:border-accent"
                      >
                        <option value="full">{t('team.role.full')}</option>
                        <option value="viewer">{t('team.role.viewer')}</option>
                      </select>
                    )}
                    {adminOf && (
                      <button
                        onClick={() => transferAdmin(m.email)}
                        disabled={busy === 'transfer' || !!busy}
                        className="flex items-center gap-1 px-2.5 py-1.5 bg-error/10 hover:bg-error/20 border border-error/30 rounded-md text-[11px] text-error transition-colors disabled:opacity-50 shrink-0"
                      >
                        {busy === 'transfer' ? <Loader2 size={11} className="animate-spin" /> : <Crown size={11} />}
                        {t('team.transfer')}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-bg-secondary overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border">
              <Database size={13} className="text-text-secondary" />
              <span className="flex-1 text-sm font-semibold text-text-primary">{t('team.inventories')}</span>
              {dbOpen && (
                <button
                  onClick={publishCurrent}
                  disabled={busy === 'publish' || !!busy}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded-md text-[11px] font-semibold text-accent transition-colors disabled:opacity-50"
                >
                  {busy === 'publish' ? <Loader2 size={11} className="animate-spin" /> : <UploadCloud size={11} />}
                  {t('team.publish')}
                </button>
              )}
            </div>
            <p className="px-4 pt-2 text-[11px] text-text-secondary">{t('team.publishHint')}</p>
            {selected.files.length === 0 ? (
              <div className="px-4 py-4 text-xs text-text-secondary">{t('team.noInv')}</div>
            ) : (
              <div className="divide-y divide-border">
                {selected.files.map((file) => {
                  const opening = busy === `open-${file.file_id}`;
                  return (
                    <div key={file.file_id} className="flex items-center gap-3 px-4 py-2.5">
                      <Database size={14} className="text-text-secondary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-text-primary truncate">{file.name}</div>
                        <div className="text-[11px] text-text-secondary">
                          {fmtSize(file.size, t)} · {new Date(file.created_ts * 1000).toLocaleDateString()}
                        </div>
                      </div>
                      <button
                        onClick={() => openFromTeam(file.file_id, file.name)}
                        disabled={!!busy}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:opacity-90 disabled:opacity-50 rounded-md text-[11px] font-semibold text-white transition-opacity shrink-0"
                      >
                        {opening ? <Loader2 size={11} className="animate-spin" /> : <CloudDownload size={11} />}
                        {t('team.open')}
                      </button>
                      {isAdmin &&
                        (confirmDelete === file.file_id ? (
                          <div className="flex items-center gap-2 rounded-md border border-error/30 bg-error/10 px-2 py-1 shrink-0">
                            <Trash2 size={11} className="text-error" />
                            <span className="text-[10px] text-error whitespace-nowrap">{t('team.deleteConfirm')}</span>
                            <button
                              onClick={() => deleteFile(file.file_id)}
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
                            onClick={() => deleteFile(file.file_id)}
                            disabled={!!busy}
                            title={t('team.deleteFile')}
                            className="w-7 h-7 grid place-items-center rounded-md bg-bg-tertiary hover:bg-bg-hover border border-border text-text-secondary hover:text-error hover:border-error/40 transition-colors shrink-0"
                          >
                            {busy === `delete-${file.file_id}` ? (
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
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-bg-primary text-text-primary">
      <div className="max-w-3xl mx-auto px-5 py-6 flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-bold text-text-primary">{t('team.title')}</h2>
          <p className="text-xs text-text-secondary leading-relaxed">{t('team.subtitle')}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setCreateOpen(true);
              setJoinOpen(false);
            }}
            className="flex items-center gap-1.5 px-3 py-2 bg-accent/10 hover:bg-accent/20 border border-accent/30 rounded-md text-xs font-semibold text-accent transition-colors"
          >
            <Plus size={12} />
            {t('team.create')}
          </button>
          <button
            onClick={() => {
              setJoinOpen(true);
              setCreateOpen(false);
            }}
            className="flex items-center gap-1.5 px-3 py-2 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-md text-xs text-text-secondary hover:text-text-primary transition-colors"
          >
            <Users size={12} />
            {t('team.join')}
          </button>
          <div className="flex-1" />
          <span className="text-[11px] text-text-secondary">{t('team.limit')}</span>
          <button
            onClick={() => refresh(false)}
            disabled={loading}
            className="w-8 h-8 grid place-items-center rounded-md bg-bg-tertiary hover:bg-bg-hover border border-border text-text-secondary hover:text-text-primary transition-colors"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {createOpen && (
          <div className="rounded-xl border border-accent/40 bg-bg-secondary p-4 flex flex-col gap-3">
            <label className="text-xs text-text-secondary">{t('team.name')}</label>
            <input
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
              autoFocus
              maxLength={60}
              className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-md text-sm text-text-primary outline-none focus:border-accent"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setCreateOpen(false)}
                className="flex-1 px-3 py-2 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-lg text-xs text-text-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={create}
                disabled={busy === 'create' || !teamName.trim()}
                className="flex-1 px-3 py-2 bg-accent hover:opacity-90 disabled:opacity-50 rounded-lg text-xs font-semibold text-white transition-opacity"
              >
                {busy === 'create' ? <Loader2 size={12} className="animate-spin mx-auto" /> : t('team.createAction')}
              </button>
            </div>
          </div>
        )}

        {joinOpen && (
          <div className="rounded-xl border border-accent/40 bg-bg-secondary p-4 flex flex-col gap-3">
            <label className="text-xs text-text-secondary">{t('team.joinCode')}</label>
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && join()}
              autoFocus
              placeholder={t('team.joinPlaceholder')}
              maxLength={8}
              className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-md text-sm font-mono tracking-widest text-text-primary outline-none focus:border-accent"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setJoinOpen(false)}
                className="flex-1 px-3 py-2 bg-bg-tertiary hover:bg-bg-hover border border-border rounded-lg text-xs text-text-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={join}
                disabled={busy === 'join' || joinCode.trim().length !== 8}
                className="flex-1 px-3 py-2 bg-accent hover:opacity-90 disabled:opacity-50 rounded-lg text-xs font-semibold text-white transition-opacity"
              >
                {busy === 'join' ? <Loader2 size={12} className="animate-spin mx-auto" /> : t('team.joinAction')}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="px-3 py-2 bg-error/10 border border-error/30 rounded-md text-xs text-error break-words">{error}</div>
        )}
        {notice && (
          <div className="px-3 py-2 bg-success/10 border border-success/30 rounded-md text-xs text-success break-words">{notice}</div>
        )}

        {loading && teams === null ? (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-text-secondary">
            <Loader2 size={14} className="animate-spin" />…
          </div>
        ) : teams && teams.length === 0 ? (
          <div className="py-12 text-center text-xs text-text-secondary">{t('team.empty')}</div>
        ) : (
          <div className="flex flex-col gap-2">
            {teams?.map((team) => (
              <button
                key={team.team_id}
                onClick={() => selectTeam(team)}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-bg-secondary border border-border hover:border-accent/40 hover:bg-bg-hover transition-colors text-left"
              >
                <div className="w-10 h-10 rounded-lg bg-accent/15 border border-accent/30 grid place-items-center shrink-0">
                  <Users size={16} className="text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-text-primary truncate">{team.name}</div>
                  <div className="text-[11px] text-text-secondary">
                    {team.files.length} {t('team.inventories').toLowerCase()}
                  </div>
                </div>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${roleColor(team.role)}`}>
                  {team.role === 'owner' && <Crown size={9} className="mr-0.5" />}
                  {roleLabel(team.role)}
                </span>
                <ChevronRight size={14} className="text-text-secondary" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
