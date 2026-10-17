import assert from 'node:assert/strict';
import { test } from 'node:test';

import { canonical, lotsKey, sign } from '../../backend/src/crypto/sign';

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

test('draw-of-lots keys match Appendix A test vector 2', () => {
  assert.equal(lotsKey(42, 'lg-1', 't1'), '0613316991ce0ac31e88d6003e3ff4d5e21bb072ac5f81b42c0cdc6598453293');
  assert.equal(lotsKey(42, 'lg-1', 't2'), 'e3e3a14e22727f936e1f288cf5d02a8a9362b1da13c5432725fc10b2c7955dd9');
  assert.equal(lotsKey(42, 'lg-1', 't3'), 'c8f28e3c2f1eb6c4f636b4f57050e3362a2b39c07fda9b61742a26dd20397028');
});
