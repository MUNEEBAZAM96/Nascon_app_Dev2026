import Fastify, { type FastifyInstance } from 'fastify';

import { registerAuth } from './api/auth';
import { registerChat } from './api/chat';
import { registerPing } from './api/ping';
import { registerCheckout } from './audit/checkout';
import { registerEvents } from './audit/events';
import { registerGuest } from './audit/guest';
import { registerFixtures } from './audit/fixtures';
import { registerHealth } from './audit/health';
import { registerInventory } from './audit/inventory';
import { registerLeagues } from './audit/leagues';
import { registerModeration } from './audit/moderation';
import { registerOfflineSync } from './audit/offlineSync';
import { registerPhase2 } from './audit/phase2';
import { registerQr } from './audit/qr';
import { registerRbac } from './audit/rbac';
import { registerReset } from './audit/reset';
import { registerRoster } from './audit/roster';
import { registerSports } from './audit/sports';
import { registerStandings } from './audit/standings';
import { registerStream } from './audit/stream';
import { registerErrorHandling, registerJsonParser } from './http/errors';
import { registerSse } from './realtime/sse';

export const BODY_LIMIT_BYTES = 1024 * 1024;

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'warn' },
    bodyLimit: BODY_LIMIT_BYTES,
    trustProxy: true,
  });

  registerErrorHandling(app);
  registerJsonParser(app);

  registerHealth(app);
  registerReset(app);
  registerSports(app);
  registerFixtures(app);
  registerLeagues(app);
  registerEvents(app);
  registerStandings(app);
  registerRoster(app);
  registerCheckout(app);
  registerInventory(app);
  registerRbac(app);
  registerOfflineSync(app);
  registerStream(app);
  registerQr(app);
  registerGuest(app);
  registerModeration(app);
  registerPhase2(app);

  registerPing(app);
  registerAuth(app);
  registerChat(app);
  registerSse(app);

  return app;
}
