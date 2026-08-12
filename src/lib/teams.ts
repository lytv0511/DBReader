import { invoke } from '@tauri-apps/api/core';

export interface CloudFile {
  file_id: string;
  name: string;
  size: number;
  published_by: string;
  created_ts: number;
}

export interface CloudTeam {
  team_id: string;
  name: string;
  role: 'owner' | 'full' | 'viewer' | string;
  code: string | null;
  files: CloudFile[];
}

export interface CloudInventories {
  email: string;
  name: string;
  files: CloudFile[];
  teams: CloudTeam[];
}

export interface TeamMember {
  email: string;
  name: string;
  role: string;
}

export async function accountInventories(): Promise<CloudInventories> {
  return invoke<CloudInventories>('account_inventories');
}

export async function cloudOpen(teamId: string, fileId: string): Promise<void> {
  await invoke('cloud_open', { teamId, fileId });
}

export async function teamCreate(name: string): Promise<CloudTeam> {
  return invoke<CloudTeam>('team_create', { name });
}

export async function teamJoin(code: string): Promise<{ team_id: string; name: string; role: string }> {
  return invoke('team_join', { code });
}

export async function teamCode(teamId: string): Promise<string> {
  return invoke<string>('team_code', { teamId });
}

export async function teamRotateCode(teamId: string): Promise<string> {
  return invoke<string>('team_rotate_code', { teamId });
}

export async function teamMembers(teamId: string): Promise<{ members: TeamMember[] }> {
  return invoke('team_members', { teamId });
}

export async function teamSetRole(teamId: string, email: string, role: string): Promise<void> {
  await invoke('team_set_role', { teamId, email, role });
}

export async function teamPublish(teamId: string): Promise<void> {
  await invoke('team_publish', { teamId });
}

export async function teamUploadFile(path: string, teamId: string): Promise<string> {
  return invoke<string>('team_upload_file', { path, teamId });
}

export async function teamDeleteFile(teamId: string, fileId: string): Promise<void> {
  await invoke('team_delete_file', { teamId, fileId });
}