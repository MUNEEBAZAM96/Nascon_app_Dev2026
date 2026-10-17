import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { getPool } from '../db/pool';
import { signToken, type Principal, type Role } from '../domain/rbac';
import { AppError } from '../http/errors';
import { parseBody } from '../http/validate';

const LoginBody = z.object({
  email: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
});

interface UserRow {
  id: string;
  email: string;
  password: string;
  role: Role;
  tenant_id: string | null;
  league_id: string | null;
  club_id: string | null;
  player_id: string | null;
}

export function registerAuth(app: FastifyInstance): void {
  app.post('/api/v1/auth/login', async (request) => {
    const { email, password } = parseBody(LoginBody, request.body);
    const result = await getPool().query<UserRow>('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
    const user = result.rows[0];
    if (!user || user.password !== password) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Email or password is incorrect.');
    }

    const principal: Principal = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenant_id: user.tenant_id,
      league_id: user.league_id,
      club_id: user.club_id,
      player_id: user.player_id,
    };
    return {
      token: signToken(principal),
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        tenant_id: user.tenant_id,
        league_id: user.league_id,
        club_id: user.club_id,
        player_id: user.player_id,
      },
    };
  });
}
