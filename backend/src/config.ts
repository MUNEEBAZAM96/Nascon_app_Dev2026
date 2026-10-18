export interface Config {
  port: number;
  day1Salt: string;
  /** Raw UTF-8 HMAC key from DAY2_SALT; undefined when unset (Phase I tests need not set it). */
  day2Salt: string | undefined;
  jwtSecret: string;
  databaseUrl: string;
  redisUrl: string;
  minio: {
    endPoint: string;
    port: number;
    accessKey: string;
    secretKey: string;
    bucket: string;
  };
  /** When set, /health probes this URL (e.g. http://media:8888/ in Compose). */
  mediaHealthUrl: string | undefined;
}

let cached: Config | null = null;

/** Clears cached config so tests can change env before buildApp(). */
export function resetConfigCache(): void {
  cached = null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (cached) return cached;

  // The salt is the raw UTF-8 HMAC key: never trimmed, never hex-decoded.
  const day1Salt = env.DAY1_SALT;
  if (day1Salt === undefined || day1Salt === '') {
    throw new Error('DAY1_SALT is missing or empty. Start with: DAY1_SALT=<salt> docker compose up -d --build');
  }

  const day2Raw = env.DAY2_SALT;
  const day2Salt = day2Raw === undefined || day2Raw === '' ? undefined : day2Raw;
  const mediaRaw = env.MEDIA_HEALTH_URL;
  const mediaHealthUrl = mediaRaw === undefined || mediaRaw === '' ? undefined : mediaRaw;

  cached = {
    port: Number(env.PORT ?? 8080),
    day1Salt,
    day2Salt,
    jwtSecret: env.JWT_SECRET || 'dev-jwt-secret',
    databaseUrl: env.DATABASE_URL ?? 'postgres://sideline:sideline@localhost:5432/sideline',
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
    minio: {
      endPoint: env.MINIO_ENDPOINT ?? 'localhost',
      port: Number(env.MINIO_PORT ?? 9000),
      accessKey: env.MINIO_ACCESS_KEY ?? 'sideline',
      secretKey: env.MINIO_SECRET_KEY ?? 'sideline-secret',
      bucket: env.MINIO_BUCKET ?? 'receipts',
    },
    mediaHealthUrl,
  };
  return cached;
}
