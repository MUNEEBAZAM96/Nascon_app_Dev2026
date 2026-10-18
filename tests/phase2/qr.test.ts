process.env.DAY1_SALT ??= 'test-salt';
process.env.DAY2_SALT ??= 'test-salt-day2';
process.env.DATABASE_URL = 'postgres://sideline:sideline@127.0.0.1:5433/sideline';

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import type { FastifyInstance } from 'fastify';

describe('qr deep links', { concurrency: 1 }, () => {
  let app: FastifyInstance;
  let reset: () => Promise<unknown>;
  let signDay2: (entityId: string, sigPayload: unknown) => string;
  let sign: (salt: string, id: string, payload: unknown) => string;
  let day1Salt: string;
  let signatureBeforeEnd: string;

  before(async () => {
    const pool = await import('../../backend/src/db/pool');
    const seed = await import('../../backend/src/db/seed');
    const crypto = await import('../../backend/src/crypto/sign');
    const config = await import('../../backend/src/config');
    const { buildApp } = await import('../../backend/src/app');
    await pool.migrate();
    reset = seed.reset;
    signDay2 = crypto.signDay2;
    sign = crypto.sign;
    day1Salt = config.loadConfig().day1Salt;
    await reset();
    app = buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  test('inspect twice leaves scan_count at 0', async () => {
    const first = await app.inject({ method: 'GET', url: '/audit/v1/qr/match-m1?inspect=true' });
    const second = await app.inject({ method: 'GET', url: '/audit/v1/qr/match-m1?inspect=true' });
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(first.json().scan_count, 0);
    assert.equal(second.json().scan_count, 0);
  });

  test('normal GET increments scan_count to 1', async () => {
    const res = await app.inject({ method: 'GET', url: '/audit/v1/qr/match-m1' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().scan_count, 1);
  });

  test('inspect after scan shows live target and valid signature', async () => {
    const shortUrl = 'http://localhost:8080/q/m1-live';
    const targetRoute = '/web/matches/match-m1/live';
    const res = await app.inject({ method: 'GET', url: '/audit/v1/qr/match-m1?inspect=true' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.short_url, shortUrl);
    assert.equal(body.target_route, targetRoute);
    assert.equal(body.signature, signDay2('match-m1', { entity_id: 'match-m1', short_url: shortUrl, target_route: targetRoute }));
    signatureBeforeEnd = body.signature;
  });

  test('short link redirects to live page', async () => {
    const res = await app.inject({ method: 'GET', url: '/q/m1-live' });
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, '/web/matches/match-m1/live');
  });

  test('match_end moves target to vod and changes QR signature only', async () => {
    const endPayload = { event_id: 'match-m1-end', match_id: 'match-m1', type: 'match_end', payload: {} };
    const eventRes = await app.inject({ method: 'POST', url: '/audit/v1/events', payload: endPayload });
    assert.equal(eventRes.statusCode, 201);
    const eventBody = eventRes.json();
    assert.equal(eventBody.signature, sign(day1Salt, 'match-m1-end', {}));

    const res = await app.inject({ method: 'GET', url: '/audit/v1/qr/match-m1?inspect=true' });
    const body = res.json();
    assert.equal(body.short_url, 'http://localhost:8080/q/m1-live');
    assert.equal(body.target_route, '/web/matches/match-m1/vod');
    assert.notEqual(body.signature, signatureBeforeEnd);
  });

  test('unknown entity returns 404 QR_NOT_FOUND', async () => {
    const res = await app.inject({ method: 'GET', url: '/audit/v1/qr/unknown-entity' });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().error.code, 'QR_NOT_FOUND');
  });

  test('exports return expected media types and markers', async () => {
    const svg = await app.inject({ method: 'GET', url: '/audit/v1/qr/match-m1/export.svg' });
    assert.equal(svg.statusCode, 200);
    assert.match(svg.headers['content-type'] ?? '', /image\/svg\+xml/);
    assert.match(svg.body, /^<svg|<\?xml/);
    assert.match(svg.body, /http:\/\/localhost:8080\/q\/m1-live/);

    const png = await app.inject({ method: 'GET', url: '/audit/v1/qr/match-m1/export.png' });
    assert.equal(png.statusCode, 200);
    assert.match(png.headers['content-type'] ?? '', /image\/png/);
    const pngBuf = Buffer.from(png.rawPayload);
    assert.equal(pngBuf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.match(pngBuf.toString('latin1'), /http:\/\/localhost:8080\/q\/m1-live/);

    const pdf = await app.inject({ method: 'GET', url: '/audit/v1/qr/match-m1/export.pdf' });
    assert.equal(pdf.statusCode, 200);
    assert.match(pdf.headers['content-type'] ?? '', /application\/pdf/);
    assert.match(pdf.body, /^%PDF/);
    assert.match(pdf.body, /match-m1/);
  });
});
