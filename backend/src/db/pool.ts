import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Pool } from 'pg';

import { loadConfig } from '../config';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: loadConfig().databaseUrl, max: 30 });
  }
  return pool;
}

export async function waitForDb(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await getPool().query('SELECT 1');
      return;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`Postgres not reachable after ${timeoutMs} ms: ${String(lastError)}`);
}

export async function migrate(): Promise<void> {
  // schema.sql is copied next to the compiled files by the build (see Dockerfile).
  const candidates = [join(__dirname, 'schema.sql'), join(__dirname, '..', '..', 'src', 'db', 'schema.sql')];
  let sql: string | null = null;
  for (const path of candidates) {
    try {
      sql = readFileSync(path, 'utf8');
      break;
    } catch {
      // try the next location
    }
  }
  if (sql === null) throw new Error('schema.sql not found');
  await getPool().query(sql);
}
