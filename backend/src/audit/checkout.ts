import type { FastifyInstance } from 'fastify';

import { checkout } from '../domain/store';

export function registerCheckout(app: FastifyInstance): void {
  app.post('/audit/v1/checkout', async (request, reply) => {
    const { http_status, ...body } = await checkout(request.body);
    return reply.status(http_status).send(body);
  });
}
