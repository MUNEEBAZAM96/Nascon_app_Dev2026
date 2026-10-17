import type { FastifyInstance } from 'fastify';

import { projectStandings } from '../domain/standings';

export function registerStandings(app: FastifyInstance): void {
  app.get<{ Params: { league_id: string } }>('/audit/v1/standings/:league_id', async (request) => {
    return projectStandings(request.params.league_id);
  });
}
