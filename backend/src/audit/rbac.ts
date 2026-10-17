import type { FastifyInstance, FastifyRequest } from 'fastify';

import { authorize, issueMatrix, principalFromHeader, type ProbeAction } from '../domain/rbac';

type Params = Record<string, string>;

// Probe routes only authorize: authenticate first, then check policy, never touch the body.
function probe(action: ProbeAction, targetParam?: string) {
  return async (request: FastifyRequest<{ Params: Params }>) => {
    const principal = principalFromHeader(request.headers.authorization);
    await authorize(principal, action, targetParam ? request.params[targetParam] : undefined);
    return { authorized: true };
  };
}

export function registerRbac(app: FastifyInstance): void {
  app.post('/audit/v1/rbac-matrix', async () => issueMatrix());

  app.post('/audit/v1/rbac/tenants', probe('create_tenant'));
  app.post('/audit/v1/rbac/leagues/:league_id/fixtures', probe('manage_league_fixtures', 'league_id'));
  app.post('/audit/v1/rbac/clubs/:club_id/roster', probe('manage_club_roster', 'club_id'));
  app.post('/audit/v1/rbac/clubs/:club_id/products', probe('manage_club_products', 'club_id'));
  app.patch('/audit/v1/rbac/players/:player_id', probe('patch_player', 'player_id'));
  app.get('/audit/v1/rbac/clubs/:club_id', probe('read_club', 'club_id'));
  app.get('/audit/v1/rbac/platform/config', probe('read_platform_config'));
}
