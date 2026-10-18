import type { FastifyInstance } from 'fastify';

import { manageStreamKey } from '../domain/stream';

export function registerStream(app: FastifyInstance): void {
  app.post('/audit/v1/stream/key', async (request, reply) => {
    const { http_status, ...body } = await manageStreamKey(request.body);
    return reply.status(http_status).send(body);
  });
}
