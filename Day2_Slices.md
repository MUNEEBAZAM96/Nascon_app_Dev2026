Day 1 still owns events, receipts, reset’s public JSON, /health, the error envelope, and the rate limit. Day 2 only adds routes and rows. A guest token is rejected before a Day 1 handler runs. A normal call with no guest token behaves exactly as it did on Saturday.

The error body stays:


{ "error": { "code": "PLAYER_NOT_FOUND", "message": "any text", "details": {} } }
Check order stays: bad JSON 400, missing id 404, guest or role block 403, business rule 409. /audit/v1/* and /health are not rate limited. /api/v1/ping still is.

Slice 1 — Reset, without changing Saturday’s answer
POST /audit/v1/reset still returns only:


{
  "status": "reset_complete",
  "seed": 42,
  "sports": ["football", "basketball", "cricket", "esports"],
  "tenants": ["tenant-alpha", "tenant-beta"],
  "stock": { "var-jersey-001-M": 1, "var-jersey-001-L": 5 }
}
Do not add keys to that JSON. The database, after that same response, also contains:

player-beta-2 in club-beta-1. player-beta-1 stays.
Match match-m1, league league-alpha-1, home club-alpha-1, away club-alpha-2, status in_progress, score 1–0.
That score is an event log, not a column. Insert match_init, match_start, and one score event whose points come from the football config. Sign each event with DAY1_SALT and the Day 1 recipe (event_id + "|" + canonical(payload)). GET /audit/v1/score/match-m1 then returns status: "in_progress", home score 1, away score 0.
QR rows for match-m1, player-alpha-1, and club-alpha-1 with the three short URLs. scan_count is 0.
Guest token guest_anon_tok_7721, unused.
Cart for player-alpha-1 empty.
league-alpha-1 is still the organizer’s league for RBAC. This match is in progress, so standings do not count it as played. Do not change win/draw/loss points or the five demo users.

Done when. The reset JSON is byte-for-shape the same as Saturday, Day 1 tests pass, and GET /audit/v1/score/match-m1 shows 1–0 from the log.

Slice 2 — Two salts, one canonical function
Keep sign() for Day 1. It still uses DAY1_SALT. Appendix A vector 1 must still match: salt demo-salt, id evt-1, payload {"team_id":"t1","event_type":"goal"} → 972a8b558690b19121cc5bea84978f85e8eb15a3735018db36616bab1d7ec501.

Add signDay2(entityId, sigPayload) using loadConfig().day2Salt and the same canonical():


HMAC-SHA256(UTF-8(DAY2_SALT), UTF-8(entityId + "|" + canonical(sigPayload)))
The salt is not trimmed and not hex-decoded. The digest is 64 lowercase hex characters. The pipe is the separator. Ids still must not contain |.

Route	entity id	keys in the signed object, and no others
Stream key
stream_key
action, player_id, status, stream_key
Co-stream
session_id
active_host, handoff_occurred, layout, participant_count, session_id, status
QR
entity_id
entity_id, short_url, target_route
Cart merge
guest_token
cart_merged, guest_token, registered_user_id, total_items, write_rejection_code
Moderation
chat_room_id
chat_room_id, flagged_count, kicked_users, queue_depth
Receipts and match events keep using sign() and DAY1_SALT. Tests set process.env.DAY2_SALT to test-salt-day2 before the first import. Do not write the real salt into a file.

Hand check. Entity id sk_live_9f83a1b2c3d4e5f6 and payload {"action":"rotate","player_id":"player-alpha-1","status":"active","stream_key":"sk_live_9f83a1b2c3d4e5f6"}. The message is that id, a pipe, then that JSON with no spaces.

Done when. signDay2 equals a direct createHmac of that message, and the Day 1 vector still passes.

Slice 3 — Stream key
POST /audit/v1/stream/key. The route sends http_status and leaves that field out of the JSON. The error envelope is the Day 1 shape.

Body: action (generate, rotate, or revoke), player_id, optional label (default "default", 1–64 chars), optional stream_key_override.

Order: schema 400 VALIDATION_ERROR → unknown player 404 PLAYER_NOT_FOUND → then the action. player-alpha-1 already exists from Saturday’s seed.

generate → 201. If a key already exists, replace it and still return 201.
rotate → 200. The old key dies. The new key is stream_key_override when that field is present, otherwise sk_live_ plus 16 lowercase hex characters.
revoke with no key → 404 STREAM_NOT_FOUND. With a key → 200, status: "revoked", ingest_endpoints: null, playback_url: null.
A later use of a revoked key → 409 KEY_REVOKED.
Active JSON uses the stored key in all three URLs:

rtmp://localhost:1935/live/{stream_key}
http://localhost:8889/live/{stream_key}/whip
http://localhost:8888/live/{stream_key}/index.m3u8
signature is signDay2(stream_key, { action, player_id, status, stream_key }). This does not change checkout or event signatures.

Tests. Bad action 400. Unknown player 404. Generate matches ^sk_live_[a-f0-9]{16}$ and is 201. Rotate with the override returns that exact key, the three URLs contain it, and the signature matches Slice 2. Revoke is 200 with null URLs. Revoke again is 404.

Slice 4 — QR, using Saturday’s match statuses
Routes: GET /audit/v1/qr/:entity_id, the three export.svg|png|pdf routes, and GET /q/:short_code (302, not under /audit).

Unknown id or short code → 404 QR_NOT_FOUND.

Short URLs, fixed forever:

Entity	Short URL
match-m1
http://localhost:8080/q/m1-live
player-alpha-1
http://localhost:8080/q/p-alpha-1
club-alpha-1
http://localhost:8080/q/c-alpha-1
target_route is computed from the Day 1 status on the event log:

Log status	Path
upcoming
/web/matches/{id}/preview
in_progress
/web/matches/{id}/live
completed
/web/matches/{id}/vod
postponed, cancelled, abandoned
/web/matches/{id}/notice?state={status}
player id
/web/players/{id}
club id
/web/clubs/{id}
cs-session-*
/web/costream/{id}
After reset, match-m1 is in_progress, so the target is /web/matches/match-m1/live. GET /q/m1-live is 302 to that path.

A normal QR GET adds 1 to scan_count (first read is 1). ?inspect=true does not add. The signature ignores scan_count. It is signDay2(entity_id, { entity_id, short_url, target_route }).

To finish the match, POST /audit/v1/events with match_end under Day 1 rules, signed with DAY1_SALT. Football allows a draw, and 1–0 is not a draw, so match_end is legal. Then short_url is still http://localhost:8080/q/m1-live, target_route is /web/matches/match-m1/vod, and the Day 2 signature changes. The event’s own signature still uses DAY1_SALT.

Exports: SVG image/svg+xml starting with <svg or <?xml and containing the short URL; PNG image/png with the 8-byte PNG header; PDF application/pdf starting with %PDF and containing the entity id.

The rest of the 200 body is entity_type, entity_status, deep_link_uri (nascon://entity/ plus the id), and export_formats pointing at the three export URLs.

Tests. Inspect twice, count unchanged. One normal GET, count increases by 1. After match_end, the short URL is unchanged, the target is /vod, and the signature differs. Unknown id is 404.

Slice 5 — Guest block in front of Saturday’s writes
POST /audit/v1/guest/cart-merge is 200 on the first success and on the identical replay.

If the header is Authorization: Bearer guest_anon_tok_7721, return 403 GUEST_WRITE_FORBIDDEN immediately, before schema and before stock, on:

POST /audit/v1/checkout
POST /audit/v1/events
POST /api/v1/chat
No guest header means Saturday’s handlers run unchanged: checkout still does 400, then 404, then discount 400, then stock 409, then payment 402, and the receipt is still signed with DAY1_SALT. Events still append to the log and still sign with DAY1_SALT. A guest call must not reserve stock and must not append an event.

Merge checks, first failure wins:

Schema 400. Token starts with guest_. Cart has 1–10 items. quantity is an integer ≥ 1. test_write_block defaults to true.
Unknown user 404 PLAYER_NOT_FOUND.
Unknown variant 404 VARIANT_NOT_FOUND.
Quantity above stock 409 OUT_OF_STOCK with details.variant_id.
test_write_block: true sets write_block_verified: true and write_rejection_code: 403.
Add lines to player-alpha-1’s cart. Same variant: sum quantities, still capped by stock. Prices stay 450000 paisa. total_items is the sum of quantities. Currency PKR.
The same token, user, and cart again returns 200 and total_items stays 1. No second stock hold. Same token with a different user or cart → 409 GUEST_TOKEN_ALREADY_MERGED.

Signature is signDay2(guest_token, { cart_merged, guest_token, registered_user_id, total_items, write_rejection_code }). write_rejection_code is the number 403.

Tests. One L jersey → total_items 1 and subtotal_minor 450000. Replay stays 1. Changed cart is 409. The three guest bearer calls are 403 and leave stock and the event log unchanged. A checkout without that header still follows Saturday’s rules.

Slice 6 — Moderation
POST /audit/v1/moderation/test is 200 when the body is valid, 400 VALIDATION_ERROR when it is not. It is under /audit/v1, so the Day 1 limiter must not return 429.

Sample room chat-cs-session-101:

msg-1, user-guest-1, Clean sports commentary → kept, flagged: false, reason: null.
msg-2, user-spammer, Watch this illegal stream b@d_w0rd now! → kept as Watch this illegal stream *** now!, flagged: true, reason: "profanity_leetspeak", sender in kicked_users.
msg-3, user-flooder, GOAL! AAAA!!! → not in filtered_messages, sender in muted_users.
dlq_status after reset: queue_depth 0, undelivered_events [].
Per message, flood first: 4 or more of the same character in a row, case-insensitive, or 3 or more ! or ?. Drop it. Do not mask it. Add the sender to muted_users once.

Otherwise match a normalized copy: @→a, 0→o, 1→i, !→i, 3→e, $→s, delete _ . - * between letters. Dictionary: badword, porn, scam, fuck, shit, bitch, asshole, and idiot_spam after the underscores are removed. Replace the token in the original text with ***. Append the sender to kicked_users once, first-seen order. Profanity does not also mute. Flood does not also kick. That matches the sample lists.

Ten parallel requests that flag user-spammer return ["user-spammer"] once and never 500.

simulate_failed_notifications: n pushes n failed records, then queue_depth is n.

Signature: signDay2(chat_room_id, { chat_room_id, flagged_count, kicked_users, queue_depth }). flagged_count is how many kept messages have flagged: true.

Slice 7 — Co-stream
POST /audit/v1/costream/session. First time 201. Identical body again 200, one session, same as Day 1’s idempotent replay rule.

player-beta-2 must exist from Slice 1 or the existence check returns 404 PLAYER_NOT_FOUND.

Order:

Schema 400. participants is a non-empty array of unique strings. simulate_host_drop defaults false. layout defaults grid_4 and is only solo, grid_2, grid_4, or spotlight.
Every participant and the host exist. Host not in participants → 400 VALIDATION_ERROR.
More than 4 → 409 COSTREAM_SESSION_FULL.
After the drop, solo with more than 1 remaining, or grid_2 with more than 2 remaining → 400 UNSUPPORTED_LAYOUT.
Drop false: host stays, handoff_occurred false, count is the full length, status active. Drop true and at least 2 people: remove the host, keep the rest in order, active_host is the first remaining id, handoff_occurred true, count is length minus 1, status stays active. Drop true and one person: active_host null, handoff_occurred false, count 0, status terminated.
The four ids player-alpha-1, player-alpha-2, player-beta-1, player-beta-2, host the first, drop true, layout grid_4, return host player-alpha-2, count 3, participants the last three, status active.

composite_playback_url is http://localhost:8888/costream/{session_id}/index.m3u8. chat_room_id is chat-{session_id}. Signature is signDay2 over active_host, handoff_occurred, layout, participant_count, session_id, status. Null host is JSON null.

Tests. That four-person result, replay 200, five people 409, host missing from the list 400, one person dropped is terminated, unknown player 404.

Slice 8 — Metrics, privacy, Saturday’s limiter
GET /health stays 200 and {"status":"ok"} only. Do not add fields. It may wait for the database, and later for the media server, but the body does not change.

GET /metrics is 200, content type text/plain; version=0.0.4, and includes nascon_active_ws_connections, nascon_active_streams_total, nascon_stream_bitrate_kbps, nascon_dlq_depth, nascon_qr_scans_total. A non-inspect QR read increases nascon_qr_scans_total. nascon_dlq_depth matches Slice 6.

DELETE /audit/v1/privacy/user/:user_id is 200 with status: "anonymized", pii_retained: false, tokens_wiped: true. Clearing PII must not delete the seeded ids the Day 1 RBAC matrix still returns (player-alpha-1 and the five demo logins). Anonymize profile fields and unlink guest tokens. Leave the account id in place so Saturday’s role probes still resolve.

Do not rate limit /audit/v1/*, /health, or /metrics. GET /api/v1/ping is still 100 per 10 seconds, with 429 and Retry-After. A burst of QR reads is not 429.

Push after this. Window 2 ends at 12:45.

Slice 9 — Guest page on port 8080
GET /web/matches/match-m1/live is HTML 200 from the same API. No login wall.

The nine attributes, exact spelling: guest-video-player, live-score-banner, pinned-merch-card, add-to-guest-cart-btn, guest-cart-count, chat-message-list, chat-input-field, chat-send-btn, progressive-auth-modal.

live-score-banner shows the Day 1 projection, 1 - 0, not a hardcoded string stored separately. When a later POST /audit/v1/events score is accepted under Saturday’s rules, the banner updates without a reload. The modal is hidden until chat send. Chat send does not append to chat-message-list and does not call a write API as the guest. Add-to-cart changes guest-cart-count from 0 to 1 for var-jersey-001-L.

Also serve /preview, /vod, /notice, /web/players/player-alpha-1, /web/clubs/club-alpha-1, and /web/costream/:id so the 302 from Slice 4 is not a 404.

Slice 10 — Media ports beside Saturday’s stack
Add the media server on 1935, 8888, and 8889. Leave Postgres, Redis, MinIO, and the API on 8080 as they are.

/health still returns {"status":"ok"} and only after Postgres and the media port answer.

Do not change the URL strings from Slices 3 and 7. A camera encode is optional.

Slice 11 — Grid, API stays 8080
Replace the single Chrome container with seleniarm/hub on 4444, two seleniarm/node-chromium nodes, and one seleniarm/node-firefox node. Each node has shm_size: "1gb" and SE_START_VNC=false.

Browsers inside the grid call http://host.docker.internal:8080. The Mac calls http://localhost:8080 and http://localhost:4444.

Done when. /status has value.ready == true and at least 3 nodes. Day 1 /health is still 200.

Slice 12 — The three test files
tests/k6_load.js matches section 6.4: 500 VUs GET /audit/v1/qr/match-m1?inspect=true for 15 seconds, 50 VUs POST /audit/v1/moderation/test with a clean message, zero HTTP failures, p95 under 800 ms. Inspect stays on so the 500 readers do not change scan_count. These are audit routes, so Saturday’s limiter must not turn them into 429.

tests/selenium/test_guest_grid.py uses hub http://localhost:4444 and the three cases: redirect to the live page with player and score and no modal; chat send shows the modal and does not append; add-to-cart sets the count to 1.

tests/appium/test_mobile_deeplink.py uses XCUITest, Appium 2.19.0, driver xcuitest@9.10.5, bundle id com.sideline.app. Do not install Appium 3. GET http://localhost:4723/status expects ready: true. The adb nascon://entity/match-m1 command is only for an Android device. Skip it when none is attached.

Slice 13 — Action
.github/workflows/autograde.yml runs on push to main: ./run_tests.sh so Saturday’s suite still passes, the Day 2 contract tests, Grid /status, and a short k6 smoke. The full 550-VU run stays local.

DAY1_SALT and DAY2_SALT come from GitHub secrets. Neither value is written in the yaml.

Slice 14 — Docs from a real run
Add TRACEABILITY.md rows for FR-3.1, FR-3.2, FR-3.3, FR-4.1, FR-4.2, FR-4.3, FR-4.4, FR-5.2, FR-5.3, NFR-1, NFR-2, NFR-6, NFR-8, NFR-9. Keep the Saturday rows.

COVERAGE.json (Day 1) stays honest. COVERAGE_DAY2.json gets measured numbers, each at least 85 and none above the measurement:


{
  "streaming": 0,
  "costream": 0,
  "qr_guest": 0,
  "moderation_dlq": 0,
  "observability": 0
}
Those map to Slices 3, 7, 4 plus 5, 6, and 8. Push before 13:45.

Slice 15 — Freeze
Salts only in .env. docker compose up -d --build. Within 120 seconds /health is {"status":"ok"}, port 4444 shows three nodes, and reset still returns the Saturday JSON while the database also has match-m1, player-beta-2, and guest_anon_tok_7721.

./run_tests.sh must pass, then the Day 2 probes, then:


k6 run --summary-export=tests/reports/k6-summary.json tests/k6_load.js
Push the reports before 14:05. git merge-base --is-ancestor <saturday-sha> HEAD must succeed. The Simulator click-through is the 20% check after this is green.