import type { FastifyInstance, FastifyReply } from 'fastify';

const subscribers = new Map<string, Set<FastifyReply>>();

export function subscribe(matchId: string, reply: FastifyReply): () => void {
  let set = subscribers.get(matchId);
  if (!set) {
    set = new Set();
    subscribers.set(matchId, set);
  }
  set.add(reply);
  return () => {
    set.delete(reply);
    if (set.size === 0) subscribers.delete(matchId);
  };
}

export function publish(matchId: string, payload: unknown): void {
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const reply of subscribers.get(matchId) ?? []) {
    reply.raw.write(frame);
  }
}

export function registerSse(app: FastifyInstance): void {
  app.get<{ Params: { matchId: string } }>('/api/v1/matches/:matchId/events', (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    reply.raw.write(': connected\n\n');

    const unsubscribe = subscribe(request.params.matchId, reply);
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
