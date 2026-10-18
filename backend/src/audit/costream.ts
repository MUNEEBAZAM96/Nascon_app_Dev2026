import type { FastifyInstance } from 'fastify';

import { createCostreamSession } from '../domain/costream';

export function registerCostream(app: FastifyInstance): void {
  app.post('/audit/v1/costream/session', async (request, reply) => {
    const { http_status, ...body } = await createCostreamSession(request.body);
    return reply.status(http_status).send(body);
  });
}
