import type { FastifyInstance } from 'fastify';

import { playerHistory, setupRoster, transferPlayer } from '../domain/roster';

export function registerRoster(app: FastifyInstance): void {
  app.post('/audit/v1/roster/setup', async (request, reply) => {
    return reply.status(201).send(await setupRoster(request.body));
  });

  app.post('/audit/v1/roster/transfer', async (request, reply) => {
    const { http_status, ...body } = await transferPlayer(request.body);
    return reply.status(http_status).send(body);
  });

  app.get<{ Params: { player_id: string }; Querystring: { as_of?: string } }>(
    '/audit/v1/roster/history/:player_id',
    async (request) => playerHistory(request.params.player_id, request.query.as_of),
  );
}
