import { Redis } from 'ioredis';

import { loadConfig } from '../config';

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(loadConfig().redisUrl, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    client.on('error', (err: Error) => console.error(`[redis] ${err.message}`));
  }
  return client;
}

// BullMQ requires maxRetriesPerRequest: null on its own connections.
export function bullConnection(): { host: string; port: number; password?: string; maxRetriesPerRequest: null } {
  const url = new URL(loadConfig().redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  };
}
