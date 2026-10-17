import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'sideline.token';

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export interface TokenClaims {
  sub: string;
  email: string;
  role: 'super_admin' | 'league_organizer' | 'club_manager' | 'player' | 'viewer';
  tenant_id: string | null;
  league_id: string | null;
  club_id: string | null;
  player_id: string | null;
  exp?: number;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const char of base64) {
    const value = BASE64_ALPHABET.indexOf(char);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return decodeURIComponent(bytes.map((byte) => `%${byte.toString(16).padStart(2, '0')}`).join(''));
}

// Display only: the server verifies the signature, the device just reads the claims.
export function decodeToken(token: string | null): TokenClaims | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(base64UrlDecode(parts[1])) as TokenClaims;
  } catch {
    return null;
  }
}
