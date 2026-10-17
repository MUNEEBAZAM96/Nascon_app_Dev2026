import type { FastifyInstance } from 'fastify';

import { replayOffline } from '../domain/sync';

export function registerOfflineSync(app: FastifyInstance): void {
  app.post('/audit/v1/offline-sync', async (request, reply) => {
    return reply.status(200).send(await replayOffline(request.body));
  });
}
