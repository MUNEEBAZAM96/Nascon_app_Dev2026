import type { FastifyInstance } from 'fastify';

import { mergeGuestCart } from '../domain/guest';

export function registerGuest(app: FastifyInstance): void {
  app.post('/audit/v1/guest/cart-merge', async (request, reply) => {
    const body = await mergeGuestCart(request.body);
    return reply.status(200).send(body);
  });
}
