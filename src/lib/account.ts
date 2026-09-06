import { invoke } from '@tauri-apps/api/core';

export interface AccountStatus {
  email: string;
  name: string;
}

export async function accountStatus(): Promise<AccountStatus> {
  return invoke<AccountStatus>('account_status');
}

export async function accountSignIn(identifier: string, password: string): Promise<AccountStatus> {
  return invoke<AccountStatus>('account_signin', { identifier, password });
}

export async function accountSignUp(username: string, email: string, password: string): Promise<AccountStatus> {
  return invoke<AccountStatus>('account_signup', { username, email, password });
}

export async function accountSignOut(): Promise<void> {
  return invoke<void>('account_signout');
}