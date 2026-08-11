import { invoke } from '@tauri-apps/api/core';

export interface AccountStatus {
  email: string;
}

export async function accountStatus(): Promise<AccountStatus> {
  return invoke<AccountStatus>('account_status');
}

export async function accountSignIn(email: string, password: string): Promise<AccountStatus> {
  return invoke<AccountStatus>('account_signin', { email, password });
}

export async function accountSignOut(): Promise<void> {
  return invoke<void>('account_signout');
}