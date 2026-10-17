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
| FR-2.3 | Integrated club merchandise store | `backend/src/domain/store/index.ts`, `backend/src/audit/checkout.ts`, `backend/src/audit/inventory.ts`, `backend/src/queue/orders.ts`, `backend/src/worker.ts`, `backend/src/storage/minio.ts` | stub |
| FR-5.1 | Five-tier RBAC | `backend/src/domain/rbac/index.ts`, `backend/src/domain/rbac/tokens.ts`, `backend/src/audit/rbac.ts`, `backend/src/api/auth.ts` | stub |
| NFR-3 | Concurrency-safe checkout | `backend/src/domain/store/index.ts`, `backend/src/db/schema.sql` (`variants`) | stub |
| NFR-4 | Offline tolerance | `backend/src/domain/sync/index.ts`, `backend/src/audit/offlineSync.ts`, `mobile/src/db/index.ts`, `mobile/src/queue/*.ts`, `mobile/src/sync/status.tsx`, `mobile/src/components/SyncBanner.tsx` | stub |
| NFR-5 | Security (JWT, rate limiting, validation, body limit) | `backend/src/domain/rbac/tokens.ts`, `backend/src/api/ping.ts`, `backend/src/http/validate.ts`, `backend/src/http/errors.ts`, `backend/src/app.ts`, `mobile/src/auth/token.ts` | stub |
| NFR-7 | Reproducible one-command Docker stack | `docker-compose.yml`, `backend/Dockerfile`, `backend/src/index.ts`, `backend/src/db/pool.ts`, `backend/src/db/seed.ts` | stub |
