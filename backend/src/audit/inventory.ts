import type { FastifyInstance } from 'fastify';

import { getInventory } from '../domain/store';

export function registerInventory(app: FastifyInstance): void {
  app.get<{ Params: { variant_id: string } }>('/audit/v1/inventory/:variant_id', async (request) => {
    return getInventory(request.params.variant_id);
  });
}
