import type { FastifyInstance } from 'fastify';

import { collectMetrics, formatPrometheusMetrics } from '../domain/metrics';

export function registerMetrics(app: FastifyInstance): void {
  app.get('/metrics', async (_request, reply) => {
    const snapshot = await collectMetrics();
    return reply.type('text/plain; version=0.0.4').send(formatPrometheusMetrics(snapshot));
  });
}
