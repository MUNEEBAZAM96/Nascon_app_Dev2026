process.env.DAY1_SALT ??= 'test-salt';
process.env.DAY2_SALT ??= 'test-salt-day2';

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';

import { canonical, lotsKey, sign, signDay2 } from '../../backend/src/crypto/sign';

test('canonical JSON sorts keys recursively with no whitespace', () => {
  assert.equal(canonical({ team_id: 't1', event_type: 'goal' }), '{"event_type":"goal","team_id":"t1"}');
  assert.equal(canonical({ b: [3, { z: 1, a: null }], a: true }), '{"a":true,"b":[3,{"a":null,"z":1}]}');
  assert.equal(canonical({ name: 'Zoë' }), '{"name":"Zoë"}');
});

test('signature matches Appendix A test vector 1', () => {
  assert.equal(
    sign('demo-salt', 'evt-1', { team_id: 't1', event_type: 'goal' }),
    '972a8b558690b19121cc5bea84978f85e8eb15a3735018db36616bab1d7ec501',
  );
});

test('day 2 stream-key signature matches a hand-computed HMAC', () => {
  const streamKey = 'sk_live_9f83a1b2c3d4e5f6';
  const payload = {
    action: 'rotate',
    player_id: 'player-alpha-1',
    status: 'active',
    stream_key: streamKey,
  };
  const message = `${streamKey}|{"action":"rotate","player_id":"player-alpha-1","status":"active","stream_key":"${streamKey}"}`;
  const digest = createHmac('sha256', Buffer.from('test-salt-day2', 'utf8')).update(Buffer.from(message, 'utf8')).digest('hex');
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(signDay2(streamKey, payload), digest);
});

test('draw-of-lots keys match Appendix A test vector 2', () => {
  assert.equal(lotsKey(42, 'lg-1', 't1'), '0613316991ce0ac31e88d6003e3ff4d5e21bb072ac5f81b42c0cdc6598453293');
  assert.equal(lotsKey(42, 'lg-1', 't2'), 'e3e3a14e22727f936e1f288cf5d02a8a9362b1da13c5432725fc10b2c7955dd9');
  assert.equal(lotsKey(42, 'lg-1', 't3'), 'c8f28e3c2f1eb6c4f636b4f57050e3362a2b39c07fda9b61742a26dd20397028');
});
