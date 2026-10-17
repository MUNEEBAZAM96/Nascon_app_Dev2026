import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { generateDoubleElim, generateRoundRobin, generateSingleElim, generateSwiss } from '../domain/fixtures';
import { parseBody } from '../http/validate';

const FixturesBody = z.object({
  format: z.enum(['round_robin', 'swiss', 'single_elim', 'double_elim']),
  teams: z.array(z.string()),
  params: z.record(z.string(), z.unknown()).optional(),
});

const generators = {
  round_robin: generateRoundRobin,
  swiss: generateSwiss,
  single_elim: generateSingleElim,
  double_elim: generateDoubleElim,
} as const;

export function registerFixtures(app: FastifyInstance): void {
  app.post('/audit/v1/fixtures', async (request, reply) => {
    const body = parseBody(FixturesBody, request.body);
    return reply.status(200).send(generators[body.format](body.teams, body.params ?? {}));
  });
}
