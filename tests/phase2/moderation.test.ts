process.env.DAY1_SALT ??= 'test-salt';
process.env.DAY2_SALT ??= 'test-salt-day2';
process.env.DATABASE_URL = 'postgres://sideline:sideline@127.0.0.1:5433/sideline';

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import type { FastifyInstance } from 'fastify';

describe('moderation', { concurrency: 1 }, () => {
  let app: FastifyInstance;
  let reset: () => Promise<unknown>;
  let signDay2: (entityId: string, sigPayload: unknown) => string;

  before(async () => {
    const pool = await import('../../backend/src/db/pool');
    const seed = await import('../../backend/src/db/seed');
    const crypto = await import('../../backend/src/crypto/sign');
    const { buildApp } = await import('../../backend/src/app');
    await pool.migrate();
    reset = seed.reset;
    signDay2 = crypto.signDay2;
    await reset();
    app = buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
    const handles = (process as unknown as { _getActiveHandles?: () => Array<{ unref?: () => void }> })._getActiveHandles?.() ?? [];
    for (const handle of handles) handle.unref?.();
  });

  function post(payload: Record<string, unknown>) {
    return app.inject({ method: 'POST', url: '/audit/v1/moderation/test', payload });
  }

  test('invalid body returns 400 VALIDATION_ERROR', async () => {
    const res = await post({});
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'VALIDATION_ERROR');
  });

  test('sample room chat-cs-session-101 matches the contract', async () => {
    await reset();
    const room = 'chat-cs-session-101';
    const res = await post({
      chat_room_id: room,
      messages: [
        { message_id: 'msg-1', sender_id: 'user-guest-1', text: 'Clean sports commentary' },
        { message_id: 'msg-2', sender_id: 'user-spammer', text: 'Watch this illegal stream b@d_w0rd now!' },
        { message_id: 'msg-3', sender_id: 'user-flooder', text: 'GOAL! AAAA!!!' },
      ],
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.filtered_messages.length, 2);
    assert.equal(body.filtered_messages[0].message_id, 'msg-1');
    assert.equal(body.filtered_messages[0].flagged, false);
    assert.equal(body.filtered_messages[0].reason, null);
    assert.equal(body.filtered_messages[1].message_id, 'msg-2');
    assert.equal(body.filtered_messages[1].text, 'Watch this illegal stream *** now!');
    assert.equal(body.filtered_messages[1].flagged, true);
    assert.equal(body.filtered_messages[1].reason, 'profanity_leetspeak');
    assert.deepEqual(body.kicked_users, ['user-spammer']);
    assert.deepEqual(body.muted_users, ['user-flooder']);
    assert.equal(body.flagged_count, 1);
    assert.equal(body.dlq_status.queue_depth, 0);
    assert.deepEqual(body.dlq_status.undelivered_events, []);
    assert.equal(
      body.signature,
      signDay2(room, {
        chat_room_id: room,
        flagged_count: 1,
        kicked_users: ['user-spammer'],
        queue_depth: 0,
      }),
    );
  });

  test('simulate_failed_notifications pushes DLQ records cleared on reset', async () => {
    await reset();
    const room = 'chat-dlq-room';
    const res = await post({
      chat_room_id: room,
      messages: [],
      simulate_failed_notifications: 3,
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.dlq_status.queue_depth, 3);
    assert.equal(body.dlq_status.undelivered_events.length, 3);
    for (const event of body.dlq_status.undelivered_events) {
      assert.equal(typeof event, 'object');
      assert.equal(event.chat_room_id, room);
    }
    await reset();
    const after = await post({ chat_room_id: room, messages: [] });
    assert.equal(after.json().dlq_status.queue_depth, 0);
    assert.deepEqual(after.json().dlq_status.undelivered_events, []);
  });

  test('ten parallel spammer requests return 200 with one kick each', async () => {
    await reset();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        post({
          chat_room_id: `room-parallel-${i}`,
          messages: [{ message_id: `msg-p-${i}`, sender_id: 'user-spammer', text: 'b@d_w0rd here' }],
        }),
      ),
    );
    for (const res of results) {
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.json().kicked_users, ['user-spammer']);
    }
  });

  test('flood drops message and mutes without kicking', async () => {
    await reset();
    const res = await post({
      chat_room_id: 'chat-flood-only',
      messages: [{ message_id: 'msg-f', sender_id: 'user-flooder', text: 'GOAL! AAAA!!!' }],
    });
    const body = res.json();
    assert.equal(body.filtered_messages.length, 0);
    assert.deepEqual(body.kicked_users, []);
    assert.deepEqual(body.muted_users, ['user-flooder']);
  });

  test('clean message is kept without kick or mute', async () => {
    await reset();
    const res = await post({
      chat_room_id: 'chat-clean',
      messages: [{ message_id: 'msg-c', sender_id: 'user-guest-1', text: 'Nice match today' }],
    });
    const body = res.json();
    assert.equal(body.filtered_messages.length, 1);
    assert.equal(body.filtered_messages[0].flagged, false);
    assert.deepEqual(body.kicked_users, []);
    assert.deepEqual(body.muted_users, []);
  });

  test('burst of moderation calls is not rate limited', async () => {
    await reset();
    const results = await Promise.all(Array.from({ length: 20 }, () => post({ chat_room_id: 'chat-burst', messages: [] })));
    assert.ok(results.every((res) => res.statusCode === 200));
    assert.ok(results.every((res) => res.statusCode !== 429));
  });
});
