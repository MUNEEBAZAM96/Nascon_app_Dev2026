/**
 * Day 2 Slice 12 / section 6.4 load profile (550 VUs total).
 * Full run is local/heavy; Slice 13 CI uses a shorter smoke — not defined here.
 *
 *   k6 run tests/k6_load.js
 *   k6 run --summary-export=tests/reports/k6-summary.json tests/k6_load.js
 *
 * Requires API on BASE_URL (default http://127.0.0.1:8080), salts, and stack health.
 */
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:8080';

export const options = {
  scenarios: {
    qr_inspect: {
      executor: 'constant-vus',
      vus: 500,
      duration: '15s',
      exec: 'qrInspect',
    },
    moderation_clean: {
      executor: 'constant-vus',
      vus: 50,
      duration: '15s',
      exec: 'moderationPost',
      startTime: '0s',
    },
  },
  thresholds: {
    http_req_failed: ['rate==0'],
    http_req_duration: ['p(95)<800'],
  },
};

export function qrInspect() {
  const res = http.get(`${BASE_URL}/audit/v1/qr/match-m1?inspect=true`);
  check(res, {
    'qr inspect 200': (r) => r.status === 200,
    'qr not rate limited': (r) => r.status !== 429,
  });
}

export function moderationPost() {
  const payload = JSON.stringify({
    chat_room_id: `chat-k6-${__VU}-${__ITER}`,
    messages: [
      {
        message_id: `msg-k6-${__VU}-${__ITER}`,
        sender_id: 'user-guest-1',
        text: 'Nice match today',
      },
    ],
  });
  const res = http.post(`${BASE_URL}/audit/v1/moderation/test`, payload, {
    headers: { 'Content-Type': 'application/json' },
  });
  check(res, {
    'moderation 200': (r) => r.status === 200,
    'moderation not rate limited': (r) => r.status !== 429,
  });
}
