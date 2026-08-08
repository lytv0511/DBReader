import { invoke } from '@tauri-apps/api/core';

export interface SyncStatus {
  dbOpen: boolean;
  enabled: boolean;
  siteId: string;
  dbId: string;
  transport: string;
  endpoint: string;
  token: string;
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

export async function syncConfigure(
  transport: string,
  endpoint: string,
  token: string,
  dbId: string
): Promise<SyncStatus> {
  return invoke<SyncStatus>('sync_configure', { transport, endpoint, token, dbId });
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
