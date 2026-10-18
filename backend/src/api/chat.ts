import type { FastifyInstance } from 'fastify';

import { notImplemented } from '../http/errors';
import { assertGuestWriteAllowed } from '../http/guestWriteGuard';

export function registerChat(app: FastifyInstance): void {
  app.post('/api/v1/chat', async (request) => {
    await assertGuestWriteAllowed(request);
    notImplemented('chat');
  });
}
