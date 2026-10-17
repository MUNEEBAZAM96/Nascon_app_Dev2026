import type { FastifyInstance } from 'fastify';

import { getPool } from '../db/pool';
import { baselineSportCount } from '../db/seed';
import { AppError } from '../http/errors';

export function registerHealth(app: FastifyInstance): void {
  app.get('/health', async () => {
    try {
      await getPool().query('SELECT 1');
      if ((await baselineSportCount()) >= 4) return { status: 'ok' };
    } catch {
      // fall through to NOT_READY
    }
    throw new AppError(503, 'NOT_READY', 'Database is not reachable or baseline data is not seeded yet.');
  });
}
