import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { reset } from '../db/seed';
import { parseBody } from '../http/validate';

const ResetBody = z.object({
  seed: z.number().int().optional(),
  stock: z.record(z.string(), z.number().int().min(0)).optional(),
});

export function registerReset(app: FastifyInstance): void {
  app.post('/audit/v1/reset', async (request, reply) => {
    const body = parseBody(ResetBody, request.body ?? {});
    return reply.status(200).send(await reset(body));
  });
}
