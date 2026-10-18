import { createHash } from 'node:crypto';

import type { PoolClient } from 'pg';

import { loadConfig } from '../config';
import { canonical, sign } from '../crypto/sign';
import { getPool } from './pool';

export interface ResetInput {
  seed?: number;
  stock?: Record<string, number>;
}

export interface ResetResult {
  status: 'reset_complete';
  seed: number;
  sports: string[];
  tenants: string[];
  stock: Record<string, number>;
}

const DEFAULT_TIE_BREAK = ['h2h_points', 'h2h_diff', 'overall_diff', 'scored', 'fair_play', 'draw_lots'];

// Same shape as POST /audit/v1/sports. Domain code reads these as data only.
const BASELINE_SPORTS = [
  {
    sport_id: 'football',
    name: 'Football',
    scoring_model: 'event',
    periods: { count: 2, duration_minutes: 45 },
    scoring_events: { goal: { points: 1 } },
    draw_allowed: true,
    overtime: { policy: 'none' },
    tie_break_order: DEFAULT_TIE_BREAK,
    roster: { min_squad_size: 11, max_squad_size: 25, required_positions: { gk: 1 } },
  },
  {
    sport_id: 'basketball',
    name: 'Basketball',
    scoring_model: 'event',
    periods: { count: 4, duration_minutes: 12 },
    scoring_events: {
      free_throw: { points: 1 },
      two_pointer: { points: 2 },
      three_pointer: { points: 3 },
    },
    draw_allowed: false,
    overtime: { policy: 'extra_time', duration_minutes: 5 },
    tie_break_order: DEFAULT_TIE_BREAK,
    roster: { min_squad_size: 5, max_squad_size: 15, required_positions: {} },
  },
  {
    sport_id: 'cricket',
    name: 'Cricket',
    scoring_model: 'innings',
    periods: { innings_per_team: 1, overs_per_innings: 20, balls_per_over: 6, wickets_per_innings: 10 },
    scoring_events: {
      dot: { runs: 0, legal_ball: true, wicket: false },
      single: { runs: 1, legal_ball: true, wicket: false },
      two: { runs: 2, legal_ball: true, wicket: false },
      four: { runs: 4, legal_ball: true, wicket: false },
      six: { runs: 6, legal_ball: true, wicket: false },
      wide: { runs: 1, legal_ball: false, wicket: false },
      no_ball: { runs: 1, legal_ball: false, wicket: false },
      wicket: { runs: 0, legal_ball: true, wicket: true },
    },
    draw_allowed: true,
    overtime: { policy: 'super_over' },
    tie_break_order: DEFAULT_TIE_BREAK,
    roster: { min_squad_size: 11, max_squad_size: 18, required_positions: { wicketkeeper: 1 } },
  },
  {
    sport_id: 'esports',
    name: 'Esports',
    scoring_model: 'round',
    periods: { best_of: 3 },
    scoring_events: { round_win: { rounds: 1 } },
    draw_allowed: false,
    overtime: { policy: 'none' },
    tie_break_order: DEFAULT_TIE_BREAK,
    roster: { min_squad_size: 5, max_squad_size: 8, required_positions: {} },
  },
];

const TENANTS = [
  { id: 'tenant-alpha', name: 'Alpha Sports', primary: '#0B6E4F', secondary: '#E8F5E9' },
  { id: 'tenant-beta', name: 'Beta Athletics', primary: '#1D4E89', secondary: '#E3F2FD' },
];

const DEMO_PASSWORD = 'Nascon@26';

const USERS = [
  { id: 'user-admin', email: 'admin@nascon.test', role: 'super_admin', tenant: null, league: null, club: null, player: null },
  { id: 'user-organizer', email: 'organizer@nascon.test', role: 'league_organizer', tenant: 'tenant-alpha', league: 'league-alpha-1', club: null, player: null },
  { id: 'user-manager', email: 'manager@nascon.test', role: 'club_manager', tenant: 'tenant-alpha', league: null, club: 'club-alpha-1', player: null },
  { id: 'user-player', email: 'player@nascon.test', role: 'player', tenant: 'tenant-alpha', league: null, club: 'club-alpha-1', player: 'player-alpha-1' },
  { id: 'user-viewer', email: 'viewer@nascon.test', role: 'viewer', tenant: 'tenant-alpha', league: null, club: null, player: null },
];

const LEAGUES = [
  { id: 'league-alpha-1', tenant: 'tenant-alpha', name: 'Alpha Premier League' },
  { id: 'league-alpha-2', tenant: 'tenant-alpha', name: 'Alpha Championship' },
  { id: 'league-beta-1', tenant: 'tenant-beta', name: 'Beta League' },
];

const CLUBS = [
  { id: 'club-alpha-1', tenant: 'tenant-alpha', name: 'Alpha United', venue: { name: 'Alpha Arena', lat: 33.6844, lng: 73.0479 } },
  { id: 'club-alpha-2', tenant: 'tenant-alpha', name: 'Alpha Rovers', venue: { name: 'Rovers Ground', lat: 33.7, lng: 73.06 } },
  { id: 'club-beta-1', tenant: 'tenant-beta', name: 'Beta City', venue: { name: 'Beta Stadium', lat: 31.5204, lng: 74.3587 } },
];

const PLAYERS = [
  { id: 'player-alpha-1', name: 'Ali', position: 'gk', club: 'club-alpha-1' },
  { id: 'player-alpha-2', name: 'Bilal', position: 'df', club: 'club-alpha-2' },
  { id: 'player-beta-1', name: 'Sara', position: 'gk', club: 'club-beta-1' },
  { id: 'player-beta-2', name: 'Hina', position: 'mf', club: 'club-beta-1' },
];

const APP_TABLES = [
  'app_meta',
  'tenants',
  'users',
  'sports',
  'clubs',
  'leagues',
  'league_teams',
  'matches',
  'match_events',
  'products',
  'variants',
  'discount_codes',
  'orders',
  'roster_leagues',
  'squads',
  'players',
  'registrations',
  'roster_audit',
  'roster_requests',
  'offline_actions',
  'qr_links',
  'guest_merge_requests',
  'guest_tokens',
  'carts',
  'stream_keys',
  'moderation_dlq',
];

export async function reset(input: ResetInput = {}): Promise<ResetResult> {
  const seed = input.seed ?? 42;
  const stock: Record<string, number> = {
    'var-jersey-001-M': 1,
    'var-jersey-001-L': 5,
    ...(input.stock ?? {}),
  };

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // Serialises concurrent resets so two calls never interleave their inserts.
    await client.query('SELECT pg_advisory_xact_lock(4242)');
    await client.query(`TRUNCATE ${APP_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
    await insertBaseline(client, seed, stock);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  return {
    status: 'reset_complete',
    seed,
    sports: BASELINE_SPORTS.map((sport) => sport.sport_id),
    tenants: TENANTS.map((tenant) => tenant.id),
    stock: {
      'var-jersey-001-M': stock['var-jersey-001-M'],
      'var-jersey-001-L': stock['var-jersey-001-L'],
    },
  };
}

async function insertBaseline(client: PoolClient, seed: number, stock: Record<string, number>): Promise<void> {
  await client.query(`INSERT INTO app_meta (key, value) VALUES ('lots_seed', $1::jsonb)`, [JSON.stringify(seed)]);

  for (const sport of BASELINE_SPORTS) {
    await client.query('INSERT INTO sports (id, name, scoring_model, config) VALUES ($1, $2, $3, $4)', [
      sport.sport_id,
      sport.name,
      sport.scoring_model,
      JSON.stringify(sport),
    ]);
  }

  for (const tenant of TENANTS) {
    await client.query(
      'INSERT INTO tenants (id, name, logo_url, primary_color, secondary_color) VALUES ($1, $2, $3, $4, $5)',
      [tenant.id, tenant.name, null, tenant.primary, tenant.secondary],
    );
  }

  for (const user of USERS) {
    await client.query(
      `INSERT INTO users (id, email, password, role, tenant_id, league_id, club_id, player_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [user.id, user.email, DEMO_PASSWORD, user.role, user.tenant, user.league, user.club, user.player],
    );
  }

  for (const league of LEAGUES) {
    await client.query(
      `INSERT INTO leagues (id, tenant_id, sport_id, name, points, tie_break_order, qualification_spots, lots_seed)
       VALUES ($1, $2, 'football', $3, $4, $5, NULL, $6)`,
      [league.id, league.tenant, league.name, JSON.stringify({ win: 3, draw: 1, loss: 0 }), JSON.stringify(DEFAULT_TIE_BREAK), seed],
    );
  }

  for (const club of CLUBS) {
    await client.query('INSERT INTO clubs (id, tenant_id, name, home_venue, social) VALUES ($1, $2, $3, $4, $5)', [
      club.id,
      club.tenant,
      club.name,
      JSON.stringify(club.venue),
      JSON.stringify({}),
    ]);
  }

  for (const player of PLAYERS) {
    await client.query('INSERT INTO players (id, name, position, club_id) VALUES ($1, $2, $3, $4)', [
      player.id,
      player.name,
      player.position,
      player.club,
    ]);
  }

  await client.query(
    `INSERT INTO products (id, tenant_id, club_id, name, kind) VALUES ('prod-jersey-001', 'tenant-alpha', 'club-alpha-1', 'Home Jersey', 'apparel')`,
  );
  for (const [id, size] of [
    ['var-jersey-001-M', 'M'],
    ['var-jersey-001-L', 'L'],
  ] as const) {
    await client.query(
      `INSERT INTO variants (id, product_id, size, color, price_minor, currency, stock, reserved)
       VALUES ($1, 'prod-jersey-001', $2, 'green', 450000, 'PKR', $3, 0)`,
      [id, size, stock[id]],
    );
  }
  for (const [variantId, qty] of Object.entries(stock)) {
    if (variantId === 'var-jersey-001-M' || variantId === 'var-jersey-001-L') continue;
    await client.query(
      `INSERT INTO variants (id, product_id, size, color, price_minor, currency, stock, reserved)
       VALUES ($1, 'prod-jersey-001', NULL, NULL, 450000, 'PKR', $2, 0)`,
      [variantId, qty],
    );
  }
  await client.query(`INSERT INTO discount_codes (code, percent) VALUES ('WELCOME10', 10)`);

  // Demo competition for the mobile app; "demo-" ids never collide with grader ids.
  await client.query(
    `INSERT INTO leagues (id, tenant_id, sport_id, name, points, tie_break_order, qualification_spots, lots_seed)
     VALUES ('demo-league-1', 'tenant-alpha', 'football', 'Sideline Demo League', $1, $2, 2, $3)`,
    [JSON.stringify({ win: 3, draw: 1, loss: 0 }), JSON.stringify(DEFAULT_TIE_BREAK), seed],
  );
  const demoTeams = ['demo-t1', 'demo-t2', 'demo-t3', 'demo-t4'];
  for (const [index, teamId] of demoTeams.entries()) {
    await client.query('INSERT INTO league_teams (league_id, team_id, position) VALUES ($1, $2, $3)', [
      'demo-league-1',
      teamId,
      index,
    ]);
  }
  for (const [id, home, away] of [
    ['demo-match-1', 'demo-t1', 'demo-t2'],
    ['demo-match-2', 'demo-t3', 'demo-t4'],
  ]) {
    await client.query(
      `INSERT INTO matches (id, league_id, sport_id, home_team_id, away_team_id, status)
       VALUES ($1, 'demo-league-1', 'football', $2, $3, 'upcoming')`,
      [id, home, away],
    );
  }

  await client.query(
    `INSERT INTO matches (id, league_id, sport_id, home_team_id, away_team_id, status)
     VALUES ('match-m1', 'league-alpha-1', 'football', 'club-alpha-1', 'club-alpha-2', 'in_progress')`,
  );
  await insertSignedEvent(client, 'match-m1-start', 'match-m1', 'match_start', {}, 1);
  await insertSignedEvent(client, 'match-m1-goal', 'match-m1', 'score', { team_id: 'club-alpha-1', event_type: 'goal' }, 2);

  await client.query(
    `INSERT INTO qr_links (entity_id, entity_type, short_url, scan_count) VALUES
       ('match-m1', 'match', 'http://localhost:8080/q/m1-live', 0),
       ('player-alpha-1', 'player', 'http://localhost:8080/q/p-alpha-1', 0),
       ('club-alpha-1', 'club', 'http://localhost:8080/q/c-alpha-1', 0)`,
  );
  await client.query(
    `INSERT INTO guest_tokens (token, merged, role) VALUES ('guest_anon_tok_7721', false, 'read-only')`,
  );
  await client.query(`INSERT INTO carts (user_id, items) VALUES ('player-alpha-1', '[]'::jsonb)`);
}

function insertSignedEvent(
  client: PoolClient,
  eventId: string,
  matchId: string,
  type: string,
  payload: Record<string, unknown>,
  sequence: number,
): Promise<unknown> {
  const signature = sign(loadConfig().day1Salt, eventId, payload);
  const requestHash = createHash('sha256').update(canonical({
    event_id: eventId,
    match_id: matchId,
    type,
    payload,
  }), 'utf8').digest('hex');
  return client.query(
    `INSERT INTO match_events (id, match_id, type, payload, sequence, signature, request_hash)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
    [eventId, matchId, type, JSON.stringify(payload), sequence, signature, requestHash],
  );
}

export async function isSeeded(): Promise<boolean> {
  const result = await getPool().query(`SELECT 1 FROM app_meta WHERE key = 'lots_seed'`);
  return (result.rowCount ?? 0) > 0;
}

export async function baselineSportCount(): Promise<number> {
  const result = await getPool().query<{ n: string }>('SELECT count(*)::text AS n FROM sports WHERE id = ANY($1)', [
    BASELINE_SPORTS.map((sport) => sport.sport_id),
  ]);
  return Number(result.rows[0]?.n ?? 0);
}
