import type { FastifyRequest } from 'fastify';

import { getPool } from '../db/pool';
import { AppError } from './errors';

export async function assertGuestWriteAllowed(request: FastifyRequest): Promise<void> {
  const header = request.headers.authorization;
  const match = /^Bearer\s+(\S+)$/i.exec(typeof header === 'string' ? header : '');
  if (!match) return;

  const token = match[1];
  if (!token.startsWith('guest_')) return;

  const row = await getPool().query('SELECT 1 FROM guest_tokens WHERE token = $1', [token]);
  if (row.rows[0]) {
    throw new AppError(403, 'GUEST_WRITE_FORBIDDEN', 'Guest tokens cannot perform write operations.', { token });
  }
}
