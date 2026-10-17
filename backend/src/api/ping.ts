import type { FastifyInstance, FastifyRequest } from 'fastify';

import { AppError } from '../http/errors';
import { getRedis } from '../queue/redis';

const WINDOW_SECONDS = 10;
const LIMIT = 100;

function clientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return first || request.ip;
}

// Fixed window per IP. Fails open when Redis is unavailable.
async function enforceRateLimit(request: FastifyRequest): Promise<void> {
  const windowStart = Math.floor(Date.now() / 1000 / WINDOW_SECONDS) * WINDOW_SECONDS;
  const key = `rl:${clientIp(request)}:${windowStart}`;
  let count: number;
  try {
    const redis = getRedis();
    count = await redis.incr(key);
    if (count === 1) await redis.expire(key, WINDOW_SECONDS + 1);
  } catch (err) {
    request.log.error({ err }, 'rate limiter unavailable; allowing request');
    return;
  }
  if (count > LIMIT) {
    const retryAfter = Math.max(1, windowStart + WINDOW_SECONDS - Math.floor(Date.now() / 1000));
    throw new AppError(429, 'RATE_LIMITED', 'Too many requests. Try again shortly.', { retry_after: retryAfter });
  }
}

export function registerPing(app: FastifyInstance): void {
  app.addHook('onRequest', async (request) => {
    if (request.url.startsWith('/api/v1/')) await enforceRateLimit(request);
  });

  app.get('/api/v1/ping', async () => ({ pong: true }));
}
