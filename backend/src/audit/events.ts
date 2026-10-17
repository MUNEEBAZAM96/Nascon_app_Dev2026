import type { FastifyInstance } from 'fastify';

import { appendEvent, projectScore } from '../domain/scoring';

export function registerEvents(app: FastifyInstance): void {
  app.post('/audit/v1/events', async (request, reply) => {
    return reply.status(201).send(await appendEvent(request.body));
  });

  app.get<{ Params: { match_id: string } }>('/audit/v1/score/:match_id', async (request) => {
    return projectScore(request.params.match_id);
  });
}
