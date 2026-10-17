import type { FastifyInstance } from 'fastify';

import { registerLeague } from '../domain/standings';

export function registerLeagues(app: FastifyInstance): void {
  app.post('/audit/v1/leagues', async (request, reply) => {
    return reply.status(201).send(await registerLeague(request.body));
  });
}
