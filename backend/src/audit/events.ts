import type { FastifyInstance } from 'fastify';

import { appendEvent, projectScore } from '../domain/scoring';
import { assertGuestWriteAllowed } from '../http/guestWriteGuard';

export function registerEvents(app: FastifyInstance): void {
  app.post('/audit/v1/events', async (request, reply) => {
    await assertGuestWriteAllowed(request);
    const { http_status, ...body } = await appendEvent(request.body);
    return reply.status(http_status).send(body);
  });

  app.get<{ Params: { match_id: string } }>('/audit/v1/score/:match_id', async (request) => {
    return projectScore(request.params.match_id);
  });
}
