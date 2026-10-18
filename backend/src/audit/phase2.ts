import type { FastifyInstance } from 'fastify';

import { notImplemented } from '../http/errors';

/** Phase II audit paths. Each one is a stub until its slice is implemented. */
export function registerPhase2(app: FastifyInstance): void {
  app.post('/audit/v1/stream/key', async () => notImplemented('stream key'));
  app.post('/audit/v1/costream/session', async () => notImplemented('costream session'));
  app.get('/audit/v1/qr/:entity_id', async () => notImplemented('qr'));
  app.get('/audit/v1/qr/:entity_id/export.svg', async () => notImplemented('qr svg export'));
  app.get('/audit/v1/qr/:entity_id/export.png', async () => notImplemented('qr png export'));
  app.get('/audit/v1/qr/:entity_id/export.pdf', async () => notImplemented('qr pdf export'));
  app.get('/q/:short_code', async () => notImplemented('qr short link'));
  app.post('/audit/v1/guest/cart-merge', async () => notImplemented('guest cart merge'));
  app.post('/audit/v1/moderation/test', async () => notImplemented('moderation'));
  app.get('/metrics', async () => notImplemented('metrics'));
  app.delete('/audit/v1/privacy/user/:user_id', async () => notImplemented('privacy erasure'));
}
