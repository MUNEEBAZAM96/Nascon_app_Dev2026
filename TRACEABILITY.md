# Traceability

Maps every requirement ID to the source files that own it and the automated tests that cover it.

| ID | Requirement | Source files | Tests |
| --- | --- | --- | --- |
| FR-1.1 | Multi-sport taxonomy and event-sourced scoring | `backend/src/domain/sports/index.ts`, `backend/src/domain/scoring/index.ts`, `backend/src/audit/sports.ts`, `backend/src/audit/events.ts`, `backend/src/crypto/sign.ts`, `backend/src/db/seed.ts` | `tests/crypto/sign.test.ts`; `tests/sports/*.test.ts`; `tests/scoring/*.test.ts` |
| FR-1.2 | League and tournament setup | `backend/src/domain/standings/index.ts` (`registerLeague`), `backend/src/audit/leagues.ts` | `tests/standings/*.test.ts` |
| FR-1.3 | Match and fixture scheduling | `backend/src/domain/fixtures/*.ts`, `backend/src/audit/fixtures.ts` | `tests/fixtures/*.test.ts` |
| FR-1.4 | Automated standings and tables | `backend/src/domain/standings/index.ts`, `backend/src/audit/standings.ts`, `backend/src/crypto/sign.ts` (`lotsKey`) | `tests/crypto/sign.test.ts` (lots keys); `tests/standings/*.test.ts` |
| FR-2.1 | Club profiles and tenant isolation | `backend/src/db/schema.sql`, `backend/src/db/seed.ts`, `mobile/src/theme/tenant.ts` | stub |
| FR-2.2 | Roster and player registry | `backend/src/domain/roster/index.ts`, `backend/src/audit/roster.ts` | `tests/roster/*.test.ts` |
| FR-2.3 | Integrated club merchandise store | `backend/src/domain/store/index.ts`, `backend/src/audit/checkout.ts`, `backend/src/audit/inventory.ts`, `backend/src/queue/orders.ts`, `backend/src/worker.ts`, `backend/src/storage/minio.ts` | `tests/store/*.test.ts` |
| FR-5.1 | Five-tier RBAC | `backend/src/domain/rbac/index.ts`, `backend/src/domain/rbac/tokens.ts`, `backend/src/audit/rbac.ts`, `backend/src/api/auth.ts` | `tests/rbac/*.test.ts` |
| NFR-3 | Concurrency-safe checkout | `backend/src/domain/store/index.ts`, `backend/src/db/schema.sql` (`variants`) | `tests/store/*.test.ts` |
| NFR-4 | Offline tolerance | `backend/src/domain/sync/index.ts`, `backend/src/audit/offlineSync.ts`, `mobile/src/db/index.ts`, `mobile/src/queue/*.ts`, `mobile/src/sync/status.tsx`, `mobile/src/components/SyncBanner.tsx` | `tests/sync/*.test.ts` |
| NFR-5 | Security (JWT, rate limiting, validation, body limit) | `backend/src/domain/rbac/tokens.ts`, `backend/src/api/ping.ts`, `backend/src/http/validate.ts`, `backend/src/http/errors.ts`, `backend/src/app.ts`, `mobile/src/auth/token.ts` | `tests/rbac/*.test.ts` |
| NFR-7 | Reproducible one-command Docker stack | `docker-compose.yml`, `backend/Dockerfile`, `backend/src/index.ts`, `backend/src/db/pool.ts`, `backend/src/db/seed.ts` | stub |
| FR-3.1 | Stream key lifecycle (generate, rotate, revoke) | `backend/src/domain/stream/index.ts`, `backend/src/audit/stream.ts` | `tests/phase2/stream.test.ts` |
| FR-3.2 | Co-stream session layout and host handoff | `backend/src/domain/costream/index.ts`, `backend/src/audit/costream.ts` | `tests/phase2/costream.test.ts` |
| FR-3.3 | Media health gate on `/health` | `backend/src/media/probe.ts`, `backend/src/audit/health.ts`, `media/mediamtx.yml` | `tests/phase2/mediaHealth.test.ts` |
| FR-4.1 | QR entities, exports, and scan semantics | `backend/src/domain/qr/index.ts`, `backend/src/audit/qr.ts` | `tests/phase2/qr.test.ts` |
| FR-4.2 | Guest cart merge and write-block | `backend/src/domain/guest/index.ts`, `backend/src/audit/guest.ts`, `backend/src/audit/checkout.ts`, `backend/src/audit/events.ts` | `tests/phase2/guest.test.ts` |
| FR-4.3 | Guest live HTML page | `backend/src/domain/web/guestPage.ts`, `backend/src/audit/web.ts` | `tests/phase2/guestPage.test.ts` |
| FR-4.4 | Short URL redirect (`/q/:code`) | `backend/src/domain/qr/index.ts`, `backend/src/audit/qr.ts`, `backend/src/audit/web.ts` | `tests/phase2/qr.test.ts`; `tests/phase2/guestPage.test.ts` |
| FR-5.2 | Chat moderation, flood, profanity, DLQ | `backend/src/domain/moderation/index.ts`, `backend/src/audit/moderation.ts` | `tests/phase2/moderation.test.ts` |
| FR-5.3 | Progressive auth on guest chat send (web) | `backend/src/domain/web/guestPage.ts`, `backend/src/audit/web.ts` | `tests/phase2/guestPage.test.ts`; `tests/selenium/test_guest_grid.py` |
| NFR-1 | Load profile (550 VUs, audit routes) | `tests/k6_load.js`, `tests/k6_smoke.js` | local `k6 run tests/k6_load.js`; CI `tests/k6_smoke.js` |
| NFR-2 | Prometheus metrics | `backend/src/domain/metrics/index.ts`, `backend/src/audit/metrics.ts` | `tests/phase2/observability.test.ts` |
| NFR-6 | Privacy erasure | `backend/src/domain/privacy/index.ts`, `backend/src/audit/privacy.ts` | `tests/phase2/observability.test.ts` |
| NFR-8 | Selenium Grid guest flows | `docker-compose.yml`, `tests/selenium/test_guest_grid.py` | `pytest tests/selenium/test_guest_grid.py` (manual / Grid) |
| NFR-9 | Mobile deeplink readiness | `mobile/app.json`, `tests/appium/test_mobile_deeplink.py` | `pytest tests/appium/test_mobile_deeplink.py` (manual / Appium) |
