import { Worker } from 'bullmq';

import { ORDERS_QUEUE, type OrderStatusEvent } from './queue/orders';
import { bullConnection } from './queue/redis';

function startWorker(): void {
  const worker = new Worker<OrderStatusEvent>(
    ORDERS_QUEUE,
    async (job) => {
      const { order_id, from, to } = job.data;
      console.log(`[worker] order ${order_id}: ${from ?? 'none'} -> ${to}`);
    },
    { connection: bullConnection() },
  );

  // BullMQ reconnects on its own; logging keeps the process alive while Redis comes up.
  worker.on('error', (err) => console.error(`[worker] ${err.message}`));
  worker.on('failed', (job, err) => console.error(`[worker] job ${job?.id} failed: ${err.message}`));
  console.log(`[worker] listening on queue "${ORDERS_QUEUE}"`);
}

process.on('unhandledRejection', (reason) => console.error('[worker] unhandled rejection', reason));
startWorker();
