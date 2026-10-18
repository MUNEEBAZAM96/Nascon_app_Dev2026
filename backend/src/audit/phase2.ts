import type { FastifyInstance } from 'fastify';

import { notImplemented } from '../http/errors';

/** Phase II audit paths. Each one is a stub until its slice is implemented. */
export function registerPhase2(app: FastifyInstance): void {
  app.post('/audit/v1/costream/session', async () => notImplemented('costream session'));
  app.get('/metrics', async () => notImplemented('metrics'));
  app.delete('/audit/v1/privacy/user/:user_id', async () => notImplemented('privacy erasure'));
}
