import { invoke } from '@tauri-apps/api/core';

export interface SyncStatus {
  dbOpen: boolean;
  enabled: boolean;
  siteId: string;
  dbId: string;
  transport: string;
  endpoint: string;
  token: string;
  cloudEmail: string;
  schemaKey: string;
  pushPending: number;
  cursor: string;
  peers: string[];
  syncedTables: string[];
  skippedTables: string[];
  lastSync: string | null;
  lastError: string | null;
}

export async function syncStatus(): Promise<SyncStatus> {
  return invoke<SyncStatus>('sync_status');
}

export async function syncDisable(): Promise<SyncStatus> {
  return invoke<SyncStatus>('sync_disable');
}

export async function syncEnable(): Promise<SyncStatus> {
  return invoke<SyncStatus>('sync_enable');
}

export async function syncNow(): Promise<SyncStatus> {
  return invoke<SyncStatus>('sync_now');
}

export async function syncJoin(code: string): Promise<SyncStatus> {
  return invoke<SyncStatus>('sync_join', { code });
}

export async function syncInviteCode(): Promise<string> {
  return invoke<string>('sync_invite_code');
}

export async function syncSignIn(email: string, password: string): Promise<SyncStatus> {
  return invoke<SyncStatus>('sync_signin', { email, password });
}

export async function syncSignOut(): Promise<SyncStatus> {
  return invoke<SyncStatus>('sync_signout');
}
