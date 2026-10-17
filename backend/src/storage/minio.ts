import { Client } from 'minio';

import { loadConfig } from '../config';

let client: Client | null = null;

export function getMinio(): Client {
  if (!client) {
    const { minio } = loadConfig();
    client = new Client({
      endPoint: minio.endPoint,
      port: minio.port,
      useSSL: false,
      accessKey: minio.accessKey,
      secretKey: minio.secretKey,
    });
  }
  return client;
}

export async function ensureReceiptsBucket(): Promise<void> {
  const { bucket } = loadConfig().minio;
  const minio = getMinio();
  if (!(await minio.bucketExists(bucket))) {
    await minio.makeBucket(bucket);
  }
}
