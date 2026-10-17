import jwt from 'jsonwebtoken';

import { loadConfig } from '../../config';
import { AppError } from '../../http/errors';

export type Role = 'super_admin' | 'league_organizer' | 'club_manager' | 'player' | 'viewer';

export interface Principal {
  sub: string;
  email: string;
  role: Role;
  tenant_id: string | null;
  league_id: string | null;
  club_id: string | null;
  player_id: string | null;
}

export function signToken(principal: Principal, expiresInSeconds = 2 * 60 * 60): string {
  return jwt.sign(principal, loadConfig().jwtSecret, { algorithm: 'HS256', expiresIn: expiresInSeconds });
}

// Pinning algorithms to HS256 rejects alg:none and any other algorithm.
export function verifyToken(token: string): Principal {
  try {
    return jwt.verify(token, loadConfig().jwtSecret, { algorithms: ['HS256'] }) as Principal;
  } catch {
    throw new AppError(401, 'UNAUTHENTICATED', 'Token is missing, invalid, or expired.');
  }
}

export function principalFromHeader(header: string | undefined): Principal {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  if (!match) throw new AppError(401, 'UNAUTHENTICATED', 'Authorization header must be "Bearer <jwt>".');
  return verifyToken(match[1]);
}
