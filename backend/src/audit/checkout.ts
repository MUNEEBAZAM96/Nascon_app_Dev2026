import type { FastifyInstance } from 'fastify';

import { checkout } from '../domain/store';

export function registerCheckout(app: FastifyInstance): void {
  app.post('/audit/v1/checkout', async (request, reply) => {
    return reply.status(201).send(await checkout(request.body));
  });
}
