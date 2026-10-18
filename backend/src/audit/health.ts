import type { FastifyInstance } from 'fastify';

import { loadConfig } from '../config';
import { getPool } from '../db/pool';
import { baselineSportCount } from '../db/seed';
import { AppError } from '../http/errors';
import { mediaPortAnswers } from '../media/probe';

export function registerHealth(app: FastifyInstance): void {
  app.get('/health', async () => {
    try {
      await getPool().query('SELECT 1');
      if ((await baselineSportCount()) < 4) {
        throw new AppError(503, 'NOT_READY', 'Database is not reachable or baseline data is not seeded yet.');
      }
      const mediaUrl = loadConfig().mediaHealthUrl;
      if (mediaUrl !== undefined && !(await mediaPortAnswers(mediaUrl))) {
        throw new AppError(503, 'NOT_READY', 'Media server is not reachable.');
      }
      return { status: 'ok' };
    } catch (err) {
      if (err instanceof AppError) throw err;
    }
    throw new AppError(503, 'NOT_READY', 'Database is not reachable or baseline data is not seeded yet.');
  });
}
