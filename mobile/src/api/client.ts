import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { getToken } from '../auth/token';

const BASE_URL_KEY = 'sideline.baseUrl';

// Android emulator reaches the host at 10.0.2.2. iOS Simulator shares the Mac network stack.
export const DEFAULT_BASE_URL =
  Platform.OS === 'android' ? 'http://10.0.2.2:8080' : 'http://127.0.0.1:8080';

export async function getBaseUrl(): Promise<string> {
  return (await SecureStore.getItemAsync(BASE_URL_KEY)) ?? DEFAULT_BASE_URL;
}

export async function setBaseUrl(url: string): Promise<void> {
  await SecureStore.setItemAsync(BASE_URL_KEY, url.trim().replace(/\/+$/, ''));
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const [baseUrl, token] = await Promise.all([getBaseUrl(), getToken()]);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...(init.headers as object) } });
  } catch {
    throw new ApiError(`Cannot reach the server at ${baseUrl}. Check your connection or the server address in Settings.`, 0, null);
  }

  const body = (await response.json().catch(() => ({}))) as T & ErrorEnvelope;
  if (!response.ok) {
    throw new ApiError(body.error?.message ?? 'Something went wrong. Please try again.', response.status, body.error?.code ?? null);
  }
  return body;
}

export interface LoginResponse {
  token: string;
  user: {
    id: string;
    email: string;
    role: string;
    tenant_id: string | null;
    league_id: string | null;
    club_id: string | null;
    player_id: string | null;
  };
}

export const api = {
  login(email: string, password: string) {
    return request<LoginResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },
};
