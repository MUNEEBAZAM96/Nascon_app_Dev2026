import { Queue } from 'bullmq';

import { bullConnection } from './redis';

export const ORDERS_QUEUE = 'orders';

export interface OrderStatusEvent {
  order_id: string;
  from: string | null;
  to: string;
}

let queue: Queue | null = null;

function getQueue(): Queue {
  if (!queue) queue = new Queue(ORDERS_QUEUE, { connection: bullConnection() });
  return queue;
}

export async function enqueueOrderStatus(input: { orderId: string; from: string | null; to: string }): Promise<void> {
  const event: OrderStatusEvent = { order_id: input.orderId, from: input.from, to: input.to };
  await getQueue().add('order.status_changed', event, { removeOnComplete: 1000, removeOnFail: 1000 });
}
