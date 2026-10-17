import { buildApp } from './app';
import { loadConfig } from './config';
import { migrate, waitForDb } from './db/pool';
import { isSeeded, reset } from './db/seed';
import { ensureReceiptsBucket } from './storage/minio';

async function main(): Promise<void> {
  const config = loadConfig();

  await waitForDb();
  await migrate();
  if (!(await isSeeded())) await reset();

  try {
    await ensureReceiptsBucket();
  } catch (err) {
    console.error(`[minio] receipts bucket not ready: ${String(err)}`);
  }

  const app = buildApp();
  await app.listen({ host: '0.0.0.0', port: config.port });
  console.log(`[api] Sideline listening on :${config.port}`);
}

main().catch((err) => {
  console.error(`[api] startup failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
