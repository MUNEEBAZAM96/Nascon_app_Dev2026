import type { FastifyInstance } from 'fastify';

import { renderLiveGuestPage, renderStubPage } from '../domain/web/guestPage';
import { projectScore } from '../domain/scoring';

export function registerWeb(app: FastifyInstance): void {
  app.get<{ Params: { match_id: string } }>('/web/matches/:match_id/live', async (request, reply) => {
    const score = await projectScore(request.params.match_id);
    const html = renderLiveGuestPage(request.params.match_id, score.home.score, score.away.score);
    return reply.type('text/html; charset=utf-8').send(html);
  });

  app.get<{ Params: { match_id: string } }>('/web/matches/:match_id/preview', async (request, reply) => {
    const { match_id: matchId } = request.params;
    return reply
      .type('text/html; charset=utf-8')
      .send(renderStubPage('Match preview', `/web/matches/${matchId}/preview`));
  });

  app.get<{ Params: { match_id: string } }>('/web/matches/:match_id/vod', async (request, reply) => {
    const { match_id: matchId } = request.params;
    return reply
      .type('text/html; charset=utf-8')
      .send(renderStubPage('Match VOD', `/web/matches/${matchId}/vod`));
  });

  app.get<{ Params: { match_id: string } }>('/web/matches/:match_id/notice', async (request, reply) => {
    const { match_id: matchId } = request.params;
    return reply
      .type('text/html; charset=utf-8')
      .send(renderStubPage('Match notice', `/web/matches/${matchId}/notice`));
  });

  app.get('/preview', async (_request, reply) =>
    reply.type('text/html; charset=utf-8').send(renderStubPage('Preview', '/preview')),
  );

  app.get('/vod', async (_request, reply) =>
    reply.type('text/html; charset=utf-8').send(renderStubPage('VOD', '/vod')),
  );

  app.get('/notice', async (_request, reply) =>
    reply.type('text/html; charset=utf-8').send(renderStubPage('Notice', '/notice')),
  );

  app.get<{ Params: { player_id: string } }>('/web/players/:player_id', async (request, reply) => {
    const { player_id: playerId } = request.params;
    return reply
      .type('text/html; charset=utf-8')
      .send(renderStubPage('Player', `/web/players/${playerId}`));
  });

  app.get<{ Params: { club_id: string } }>('/web/clubs/:club_id', async (request, reply) => {
    const { club_id: clubId } = request.params;
    return reply
      .type('text/html; charset=utf-8')
      .send(renderStubPage('Club', `/web/clubs/${clubId}`));
  });

  app.get<{ Params: { id: string } }>('/web/costream/:id', async (request, reply) => {
    const { id } = request.params;
    return reply.type('text/html; charset=utf-8').send(renderStubPage('Co-stream', `/web/costream/${id}`));
  });
}
