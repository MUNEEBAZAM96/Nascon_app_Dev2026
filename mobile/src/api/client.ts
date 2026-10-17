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

export function formatPkr(minor: number): string {
  return `PKR ${(minor / 100).toFixed(2)}`;
}

export const JERSEY_PRICE_MINOR = 450000;
export const JERSEY_PRICE = formatPkr(JERSEY_PRICE_MINOR);

export interface ScoreSide {
  team_id: string;
  score: number;
}

export interface ScoreEvent {
  sequence: number;
  event_id: string;
  type: string;
  payload: { team_id?: string; event_type?: string; compensates?: string };
  compensated?: boolean;
}

export interface ScoreView {
  status: 'upcoming' | 'in_progress' | 'completed' | string;
  outcome: string;
  home: ScoreSide;
  away: ScoreSide;
  events: ScoreEvent[];
}

export interface StandingRow {
  rank: number;
  team_id: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  scored: number;
  conceded: number;
  diff: number;
  points: number;
  status: 'clinched' | 'still_possible' | 'eliminated';
}

export interface StandingsView {
  league_id: string;
  qualification_spots: number;
  table: StandingRow[];
}

export interface InventoryView {
  variant_id: string;
  stock: number;
  reserved: number;
}

export interface CheckoutView {
  order_id: string;
  status: string;
  total_minor: number;
}

export interface PlayerHistory {
  player_id: string;
  current_squad_id: string | null;
  role: string | null;
}

export interface EventBody {
  event_id: string;
  match_id: string;
  type: string;
  payload: Record<string, unknown>;
}

const STATUS_LABEL: Record<string, string> = {
  clinched: 'Clinched',
  still_possible: 'Still possible',
  eliminated: 'Eliminated',
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

export const DEMO = {
  leagueId: 'demo-league-1',
  matches: [
    { id: 'demo-match-1', home: 'demo-t1', away: 'demo-t2' },
    { id: 'demo-match-2', home: 'demo-t3', away: 'demo-t4' },
  ],
  variants: { M: 'var-jersey-001-M', L: 'var-jersey-001-L' },
  rosterPlayer: 'p-demo-1',
  asOf: '2026-10-17',
} as const;

export const api = {
  login(email: string, password: string) {
    return request<LoginResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },
  standings(leagueId: string) {
    return request<StandingsView>(`/audit/v1/standings/${leagueId}`);
  },
  score(matchId: string) {
    return request<ScoreView>(`/audit/v1/score/${matchId}`);
  },
  postEvent(body: EventBody) {
    return request<unknown>('/audit/v1/events', { method: 'POST', body: JSON.stringify(body) });
  },
  inventory(variantId: string) {
    return request<InventoryView>(`/audit/v1/inventory/${variantId}`);
  },
  checkout(body: Record<string, unknown>) {
    return request<CheckoutView>('/audit/v1/checkout', { method: 'POST', body: JSON.stringify(body) });
  },
  setupRoster(body: Record<string, unknown>) {
    return request<{ league_id: string; status: string; squad_counts: Record<string, number> }>('/audit/v1/roster/setup', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  transfer(body: Record<string, unknown>) {
    return request<unknown>('/audit/v1/roster/transfer', { method: 'POST', body: JSON.stringify(body) });
  },
  playerHistory(playerId: string, asOf: string) {
    return request<PlayerHistory>(`/audit/v1/roster/history/${playerId}?as_of=${asOf}`);
  },
};

/** Posts the four demo events once, when the seeded match has not started. A 200 means that event is already stored. */
export async function ensureDemoMatchPlayed(): Promise<void> {
  const view = await api.score('demo-match-1');
  if (view.status === 'completed' || view.status !== 'upcoming' || view.events.length > 0) return;
  const posts: EventBody[] = [
    { event_id: 'demo-match-1-start', match_id: 'demo-match-1', type: 'match_start', payload: {} },
    { event_id: 'demo-match-1-g1', match_id: 'demo-match-1', type: 'score', payload: { team_id: 'demo-t1', event_type: 'goal' } },
    { event_id: 'demo-match-1-g2', match_id: 'demo-match-1', type: 'score', payload: { team_id: 'demo-t1', event_type: 'goal' } },
    { event_id: 'demo-match-1-end', match_id: 'demo-match-1', type: 'match_end', payload: {} },
  ];
  for (const body of posts) await api.postEvent(body);
}
