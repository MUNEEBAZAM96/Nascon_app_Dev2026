import type { FastifyInstance } from 'fastify';

import { createSport } from '../domain/sports';

export function registerSports(app: FastifyInstance): void {
  app.post('/audit/v1/sports', async (request, reply) => {
    return reply.status(201).send(await createSport(request.body));
  });
}
