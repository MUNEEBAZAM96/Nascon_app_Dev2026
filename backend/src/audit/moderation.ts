import type { FastifyInstance } from 'fastify';

import { moderateChat } from '../domain/moderation';

export function registerModeration(app: FastifyInstance): void {
  app.post('/audit/v1/moderation/test', async (request, reply) => {
    const body = await moderateChat(request.body);
    return reply.status(200).send(body);
  });
}
