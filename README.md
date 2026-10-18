# Sideline

Sideline is a multi-tenant sports league and club operations platform built for NaSCon ’26. It covers rule-driven multi-sport scoring (sport rules are JSON data, never code), fixture generation, standings, club rosters with transfers and loans, and a concurrency-safe merchandise store. The backend is Node.js 20 + Fastify on PostgreSQL 16, Redis 7 (rate limiting + BullMQ), and MinIO, all self-hosted with Docker Compose. The mobile app is Expo Router (React Native) with offline caching in SQLite.

> **Status:** this slice is a bootable skeleton. `/health`, `/audit/v1/reset`, login, `/api/v1/ping`, and signing work. The domain algorithms (fixtures, scoring, standings, roster, store, RBAC matrix, offline sync) are stubs that return `501 NOT_IMPLEMENTED`.

## Run the backend

Requires Docker with Compose v2. Nothing else on the host.

```bash
DAY1_SALT=<salt> docker compose up -d --build
curl http://localhost:8080/health      # {"status":"ok"}
```

`DAY1_SALT` is read only from the environment at startup. The API refuses to start without it. Never commit the real salt; `.env.example` lists variable names only.

Services: `api` (host port 8080), `worker` (BullMQ consumer, same image), `postgres`, `redis`, `minio` (console on 9001), `media` (1935/8888/8889), Selenium Grid hub on **4444** (two Chromium nodes + one Firefox; browsers use `http://host.docker.internal:8080` to reach the API).

Reset to the baseline at any time:

```bash
curl -X POST http://localhost:8080/audit/v1/reset
```

## Demo accounts

All passwords are `Nascon@26`. They exist after every startup and every reset.

| Role | Email | Scope |
| --- | --- | --- |
| Platform Super-Admin | admin@nascon.test | Whole platform |
| League Organizer | organizer@nascon.test | `league-alpha-1` |
| Club Manager | manager@nascon.test | `club-alpha-1` |
| Player | player@nascon.test | `player-alpha-1` |
| General Viewer | viewer@nascon.test | Read-only in `tenant-alpha` |

## Mobile app

```bash
cd mobile
npm install
npx expo start
```

Server address: the Android emulator uses `http://10.0.2.2:8080` (the default). On a real phone, open **Settings** in the app and enter your laptop's LAN IP, for example `http://192.168.1.20:8080`.

The release APK goes to `mobile/release/app-release.apk` (`npx expo prebuild`, then `./gradlew assembleRelease` in `mobile/android`).

## Tests

```bash
./run_tests.sh
```

Runs Node's built-in test runner over `tests/`. Coverage per backend area is declared in `COVERAGE.json`.

### Slice 15 freeze checklist

Salts live in `.env` only (never commit). With Docker running:

```bash
./run_tests.sh
./scripts/freeze_slice15.sh          # compose + 120s health/grid/reset/DB probes
./scripts/day2_probes.sh             # live API probes only (stack already up)
k6 run --summary-export=tests/reports/k6-summary.json tests/k6_load.js
git merge-base --is-ancestor <saturday-sha> HEAD
```

Push `tests/reports/k6-summary.json` before the course deadline. iOS Simulator click-through is manual.

## Layout

```text
backend/src/audit/     graded /audit/v1/* routes (thin wrappers)
backend/src/domain/    sports, fixtures, scoring, standings, roster, store, rbac, sync
backend/src/crypto/    HMAC-SHA256 signing over canonical JSON
backend/src/db/        schema.sql and the /reset baseline seed
mobile/app/            Expo Router screens
mobile/src/            api client, secure token, SQLite cache, offline queue, sync status, theme
```
