import { createHash } from 'node:crypto';

import type { PoolClient } from 'pg';
import { z } from 'zod';

import { canonical } from '../../crypto/sign';
import { getPool } from '../../db/pool';
import { AppError } from '../../http/errors';
import { parseBody } from '../../http/validate';
import { getSport } from '../sports';

const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const Id = z.string().regex(ID_PATTERN);
const DateString = z.string().refine(isIsoDate);
const Role = z.enum(['captain', 'vice_captain', 'starter', 'substitute']);

const SetupBody = z.object({
  league: z.object({
    league_id: Id,
    tenant_id: Id,
    sport_id: Id,
    window: z.object({ open: DateString, close: DateString }),
    max_squad_size: z.number().int().min(1).optional(),
    required_positions: z.record(z.string(), z.number().int().min(0)).optional(),
  }),
  squads: z.array(z.object({
    squad_id: Id,
    tenant_id: Id,
    name: z.string(),
  })),
  players: z.array(z.object({
    player_id: Id,
    name: z.string(),
    position: z.string(),
    squad_id: Id,
    role: Role,
    parent_squad_id: Id.optional(),
    loan_end_date: DateString.optional(),
  })),
  matches_in_progress: z.array(z.object({
    match_id: Id,
    home_squad_id: Id,
    away_squad_id: Id,
  })),
});

const TransferBody = z.object({
  request_id: Id,
  league_id: Id,
  player_id: Id,
  type: z.enum(['transfer', 'loan', 'release']),
  from_squad_id: Id,
  to_squad_id: Id.optional(),
  effective_date: DateString,
  loan_end_date: DateString.optional(),
  requested_by: z.string(),
  reason: z.string(),
});

type SetupInput = z.infer<typeof SetupBody>;
type TransferInput = z.infer<typeof TransferBody>;

interface Baseline {
  player_id: string;
  squad_id: string;
  parent_squad_id: string | null;
  registration_type: 'signing' | 'loan';
  role: string;
  start_date: string;
  loan_end_date: string | null;
}

interface LeagueConfig {
  window: { open: string; close: string };
  max_squad_size: number;
  required_positions: Record<string, number>;
  matches_in_progress: Array<{ match_id: string; home_squad_id: string; away_squad_id: string }>;
  baseline: Baseline[];
}

interface RegistrationView {
  player_id: string;
  league_id: string;
  squad_id: string;
  parent_squad_id: string | null;
  registration_type: string;
  start_date: string;
  loan_end_date: string | null;
  role: string;
}

interface AuditEntry {
  audit_id: string;
  action: 'transfer' | 'loan' | 'release' | 'loan_return';
  player_id: string;
  league_id: string;
  from_squad_id: string;
  to_squad_id: string | null;
  effective_date: string;
  state: 'active' | 'deferred_until_match_end';
  who: string;
  when: string;
  why: string;
}

interface TransferResponse {
  request_id: string;
  status: 'accepted';
  state: AuditEntry['state'];
  blocking_match_id: string | null;
  registration: RegistrationView | null;
  audit_entry: AuditEntry;
}

interface RegRow {
  squad_id: string | null;
  parent_squad_id: string | null;
  registration_type: string;
  role: string | null;
  start_date: string | null;
  loan_end_date: string | null;
}

interface SquadRow {
  id: string;
  tenant_id: string;
}

interface AuditRow {
  action: AuditEntry['action'];
  player_id: string;
  roster_league_id: string;
  from_squad_id: string;
  to_squad_id: string | null;
  effective_date: string;
  state: AuditEntry['state'];
  who: string;
  why: string;
  when_stamp: string;
  payload: { audit_id?: string; loan_end_date?: string | null };
}

interface RosterState {
  squad_id: string | null;
  parent_squad_id: string | null;
  role: string | null;
  registration_type: string | null;
  start_date: string | null;
  loan_end_date: string | null;
}

/** Replaces one league's squads, registrations, and audit, and upserts players (Section 5.11). */
export async function setupRoster(input: unknown): Promise<{
  league_id: string;
  status: 'configured';
  squad_counts: Record<string, number>;
}> {
  const body = parseBody(SetupBody, input ?? {});
  const squadIds = new Set<string>();
  for (const squad of body.squads) {
    if (squadIds.has(squad.squad_id)) invalid(['squads']);
    squadIds.add(squad.squad_id);
  }
  const playerIds = new Set<string>();
  for (const player of body.players) {
    if (playerIds.has(player.player_id) || !squadIds.has(player.squad_id)) invalid(['players']);
    playerIds.add(player.player_id);
    const loanFields = Number(player.parent_squad_id !== undefined) + Number(player.loan_end_date !== undefined);
    if (loanFields === 1 || (player.parent_squad_id !== undefined && !squadIds.has(player.parent_squad_id))) {
      invalid(['players']);
    }
  }
  for (const match of body.matches_in_progress) {
    if (!squadIds.has(match.home_squad_id) || !squadIds.has(match.away_squad_id)) invalid(['matches_in_progress']);
  }

  const sport = await getSport(body.league.sport_id);
  const config: LeagueConfig = {
    window: body.league.window,
    max_squad_size: body.league.max_squad_size ?? sport.roster.max_squad_size,
    required_positions: body.league.required_positions ?? sport.roster.required_positions,
    matches_in_progress: body.matches_in_progress,
    baseline: body.players.map((player) => baselineOf(player, body.league.window.open)),
  };
  const squadCounts = Object.fromEntries(body.squads.map((squad) => [squad.squad_id, 0]));
  for (const player of config.baseline) squadCounts[player.squad_id] += 1;

  await withClient(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`roster-league:${body.league.league_id}`]);
    await client.query('DELETE FROM roster_audit WHERE roster_league_id = $1', [body.league.league_id]);
    await client.query('DELETE FROM registrations WHERE roster_league_id = $1', [body.league.league_id]);
    await client.query('DELETE FROM squads WHERE roster_league_id = $1', [body.league.league_id]);
    await client.query(
      `INSERT INTO roster_leagues (id, tenant_id, sport_id, config)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, sport_id = EXCLUDED.sport_id, config = EXCLUDED.config`,
      [body.league.league_id, body.league.tenant_id, body.league.sport_id, JSON.stringify(config)],
    );
    for (const squad of body.squads) {
      await client.query(
        'INSERT INTO squads (id, roster_league_id, tenant_id, name) VALUES ($1, $2, $3, $4)',
        [squad.squad_id, body.league.league_id, squad.tenant_id, squad.name],
      );
    }
    for (const player of body.players) {
      await client.query(
        `INSERT INTO players (id, name, position)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, position = EXCLUDED.position`,
        [player.player_id, player.name, player.position],
      );
    }
    for (const player of config.baseline) {
      await client.query(
        `INSERT INTO registrations (
           id, player_id, roster_league_id, squad_id, parent_squad_id, registration_type, role, start_date, loan_end_date
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date)`,
        [
          `${body.league.league_id}|${player.player_id}`,
          player.player_id,
          body.league.league_id,
          player.squad_id,
          player.parent_squad_id,
          player.registration_type,
          player.role,
          player.start_date,
          player.loan_end_date,
        ],
      );
    }
  });

  return { league_id: body.league.league_id, status: 'configured', squad_counts: squadCounts };
}

/** Applies a transfer, loan, or release after the eight ordered checks. A repeated body replays as 200. */
export async function transferPlayer(input: unknown): Promise<{ http_status: 200 | 201 } & TransferResponse> {
  const body = parseBody(TransferBody, input ?? {});
  if (body.type !== 'release' && body.to_squad_id === undefined) invalid(['to_squad_id']);
  if (body.type === 'loan' && body.loan_end_date === undefined) invalid(['loan_end_date']);
  if (body.loan_end_date !== undefined && body.loan_end_date <= body.effective_date) invalid(['loan_end_date']);
  const hashed = canonicalTransfer(body);
  const hash = createHash('sha256').update(canonical(hashed), 'utf8').digest('hex');

  return withClient(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`roster-request:${body.request_id}`]);
    const prior = await client.query<{ request_hash: string; response: TransferResponse }>(
      'SELECT request_hash, response FROM roster_requests WHERE request_id = $1',
      [body.request_id],
    );
    const stored = prior.rows[0];
    if (stored) {
      if (stored.request_hash !== hash) {
        throw new AppError(409, 'VALIDATION_ERROR', 'Request body failed validation.', { fields: ['request_id'] });
      }
      return { http_status: 200, ...stored.response };
    }

    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`roster-league:${body.league_id}`]);
    const league = await loadLeague(client, body.league_id);
    const player = await client.query<{ id: string; position: string | null }>(
      'SELECT id, position FROM players WHERE id = $1',
      [body.player_id],
    );
    if (!player.rows[0]) throw new AppError(404, 'PLAYER_NOT_FOUND', 'Player not found.', { player_id: body.player_id });
    const fromSquad = await loadSquad(client, body.from_squad_id);
    const toSquad = body.type === 'release' ? null : await loadSquad(client, body.to_squad_id as string);

    if (fromSquad.tenant_id !== league.tenant_id) conflict('CROSS_TENANT_TRANSFER', 'Squad is outside the league tenant.');
    if (toSquad && toSquad.tenant_id !== league.tenant_id) conflict('CROSS_TENANT_TRANSFER', 'Squad is outside the league tenant.');

    const current = await loadRegistration(client, body.league_id, body.player_id);
    if (!current || current.squad_id !== body.from_squad_id) conflict('NOT_IN_SQUAD', 'Player is not in that squad.');

    if (body.type !== 'release' && !insideWindow(body.effective_date, league.config.window)) {
      conflict('TRANSFER_WINDOW_CLOSED', 'Effective date is outside the transfer window.');
    }
    if (isOnLoan(current, body.effective_date)) conflict('PLAYER_ON_LOAN', 'Player is already on loan.');

    if (body.type !== 'release') {
      const destination = await countSquad(client, body.league_id, body.to_squad_id as string);
      if (destination + 1 > league.config.max_squad_size) conflict('SQUAD_FULL', 'Destination squad is full.');
    }
    const minimum = league.config.required_positions[player.rows[0].position ?? ''] ?? 0;
    const staying = await countPosition(client, body.league_id, body.from_squad_id, player.rows[0].position ?? '');
    if (staying - 1 < minimum) conflict('MIN_POSITION_VIOLATION', 'Squad would fall below the position minimum.');

    const blocking = league.config.matches_in_progress.find(
      (match) => match.home_squad_id === body.from_squad_id || match.away_squad_id === body.from_squad_id,
    );
    const state: AuditEntry['state'] = blocking ? 'deferred_until_match_end' : 'active';
    const when = serverStamp();
    const auditId = await nextAuditId(client, body.league_id);
    const toSquadId = body.type === 'release' ? null : body.to_squad_id as string;

    let registration: RegistrationView | null;
    if (state === 'deferred_until_match_end') {
      registration = viewOf(body.league_id, body.player_id, current);
    } else if (body.type === 'release') {
      registration = null;
      await applyRelease(client, body);
    } else if (body.type === 'loan') {
      registration = await applyLoan(client, body, toSquadId ?? '');
    } else {
      registration = await applyTransfer(client, body, toSquadId ?? '');
    }

    const audit = await insertAudit(client, {
      leagueId: body.league_id,
      auditId,
      action: body.type,
      playerId: body.player_id,
      fromSquadId: body.from_squad_id,
      toSquadId,
      effectiveDate: body.effective_date,
      state,
      who: body.requested_by,
      why: body.reason,
      when,
      loanEnd: body.type === 'loan' ? body.loan_end_date ?? null : null,
    });

    const response: TransferResponse = {
      request_id: body.request_id,
      status: 'accepted',
      state,
      blocking_match_id: blocking ? blocking.match_id : null,
      registration,
      audit_entry: audit,
    };
    await client.query(
      'INSERT INTO roster_requests (request_id, request_hash, response) VALUES ($1, $2, $3::jsonb)',
      [body.request_id, hash, JSON.stringify(response)],
    );
    return { http_status: 201, ...response };
  });
}

/** Rebuilds the squad a player counts for on as_of, and writes one loan_return row the first time it is due. */
export async function playerHistory(playerId: string, asOf?: string): Promise<{
  player_id: string;
  as_of: string;
  current_squad_id: string | null;
  parent_squad_id: string | null;
  role: string | null;
  history: AuditEntry[];
}> {
  const as_of = resolveAsOf(asOf);
  return withClient(async (client) => {
    const player = await client.query('SELECT 1 FROM players WHERE id = $1', [playerId]);
    if ((player.rowCount ?? 0) === 0) {
      throw new AppError(404, 'PLAYER_NOT_FOUND', 'Player not found.', { player_id: playerId });
    }
    const leagueId = await leagueFor(client, playerId);
    if (!leagueId) {
      return { player_id: playerId, as_of, current_squad_id: null, parent_squad_id: null, role: null, history: [] };
    }
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`roster-league:${leagueId}`]);
    const league = await loadLeague(client, leagueId);
    await ensureLoanReturns(client, league.config, leagueId, playerId, as_of);
    const entries = await loadAudit(client, leagueId, playerId);
    const state = project(league.config.baseline.find((row) => row.player_id === playerId), entries, as_of);
    return {
      player_id: playerId,
      as_of,
      current_squad_id: state.squad_id,
      parent_squad_id: state.parent_squad_id,
      role: state.role,
      history: entries.map(toAuditEntry),
    };
  });
}

function baselineOf(player: SetupInput['players'][number], start: string): Baseline {
  const loan = player.parent_squad_id !== undefined && player.loan_end_date !== undefined;
  return {
    player_id: player.player_id,
    squad_id: player.squad_id,
    parent_squad_id: loan ? player.parent_squad_id ?? null : null,
    registration_type: loan ? 'loan' : 'signing',
    role: player.role,
    start_date: start,
    loan_end_date: loan ? player.loan_end_date ?? null : null,
  };
}

function canonicalTransfer(body: TransferInput): Record<string, unknown> {
  const value: Record<string, unknown> = {
    request_id: body.request_id,
    league_id: body.league_id,
    player_id: body.player_id,
    type: body.type,
    from_squad_id: body.from_squad_id,
    effective_date: body.effective_date,
    requested_by: body.requested_by,
    reason: body.reason,
  };
  if (body.to_squad_id !== undefined) value.to_squad_id = body.to_squad_id;
  if (body.loan_end_date !== undefined) value.loan_end_date = body.loan_end_date;
  return value;
}

async function loadLeague(client: PoolClient, leagueId: string): Promise<{ tenant_id: string; config: LeagueConfig }> {
  const result = await client.query<{ tenant_id: string; config: LeagueConfig }>(
    'SELECT tenant_id, config FROM roster_leagues WHERE id = $1',
    [leagueId],
  );
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'LEAGUE_NOT_FOUND', 'League not found.', { league_id: leagueId });
  return row;
}

async function loadSquad(client: PoolClient, squadId: string): Promise<SquadRow> {
  const result = await client.query<SquadRow>('SELECT id, tenant_id FROM squads WHERE id = $1', [squadId]);
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'SQUAD_NOT_FOUND', 'Squad not found.', { squad_id: squadId });
  return row;
}

async function loadRegistration(client: PoolClient, leagueId: string, playerId: string): Promise<RegRow | null> {
  const result = await client.query<RegRow>(
    `SELECT squad_id, parent_squad_id, registration_type, role,
            to_char(start_date, 'YYYY-MM-DD') AS start_date,
            to_char(loan_end_date, 'YYYY-MM-DD') AS loan_end_date
     FROM registrations WHERE roster_league_id = $1 AND player_id = $2`,
    [leagueId, playerId],
  );
  return result.rows[0] ?? null;
}

function viewOf(leagueId: string, playerId: string, row: RegRow): RegistrationView {
  return {
    player_id: playerId,
    league_id: leagueId,
    squad_id: row.squad_id as string,
    parent_squad_id: row.parent_squad_id,
    registration_type: row.registration_type,
    start_date: row.start_date as string,
    loan_end_date: row.loan_end_date,
    role: row.role as string,
  };
}

function insideWindow(date: string, window: { open: string; close: string }): boolean {
  return date >= window.open && date <= window.close;
}

function isOnLoan(row: RegRow, effective: string): boolean {
  return row.registration_type === 'loan'
    && row.start_date !== null
    && row.loan_end_date !== null
    && effective >= row.start_date
    && effective <= row.loan_end_date;
}

async function countSquad(client: PoolClient, leagueId: string, squadId: string): Promise<number> {
  const result = await client.query<{ n: number }>(
    'SELECT COUNT(*)::int AS n FROM registrations WHERE roster_league_id = $1 AND squad_id = $2',
    [leagueId, squadId],
  );
  return Number(result.rows[0]?.n ?? 0);
}

async function countPosition(client: PoolClient, leagueId: string, squadId: string, position: string): Promise<number> {
  const result = await client.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n
     FROM registrations r
     JOIN players p ON p.id = r.player_id
     WHERE r.roster_league_id = $1 AND r.squad_id = $2 AND p.position = $3`,
    [leagueId, squadId, position],
  );
  return Number(result.rows[0]?.n ?? 0);
}

async function applyRelease(client: PoolClient, body: TransferInput): Promise<void> {
  await client.query(
    `UPDATE registrations
     SET squad_id = NULL, parent_squad_id = NULL, registration_type = 'release', role = NULL,
         start_date = $3::date, loan_end_date = NULL
     WHERE roster_league_id = $1 AND player_id = $2`,
    [body.league_id, body.player_id, body.effective_date],
  );
}

async function applyTransfer(client: PoolClient, body: TransferInput, toSquadId: string): Promise<RegistrationView> {
  await client.query(
    `UPDATE registrations
     SET squad_id = $3, parent_squad_id = NULL, registration_type = 'transfer', role = 'substitute',
         start_date = $4::date, loan_end_date = NULL
     WHERE roster_league_id = $1 AND player_id = $2`,
    [body.league_id, body.player_id, toSquadId, body.effective_date],
  );
  return {
    player_id: body.player_id,
    league_id: body.league_id,
    squad_id: toSquadId,
    parent_squad_id: null,
    registration_type: 'transfer',
    start_date: body.effective_date,
    loan_end_date: null,
    role: 'substitute',
  };
}

async function applyLoan(client: PoolClient, body: TransferInput, toSquadId: string): Promise<RegistrationView> {
  const loanEnd = body.loan_end_date as string;
  await client.query(
    `UPDATE registrations
     SET squad_id = $3, parent_squad_id = $4, registration_type = 'loan', role = 'substitute',
         start_date = $5::date, loan_end_date = $6::date
     WHERE roster_league_id = $1 AND player_id = $2`,
    [body.league_id, body.player_id, toSquadId, body.from_squad_id, body.effective_date, loanEnd],
  );
  return {
    player_id: body.player_id,
    league_id: body.league_id,
    squad_id: toSquadId,
    parent_squad_id: body.from_squad_id,
    registration_type: 'loan',
    start_date: body.effective_date,
    loan_end_date: loanEnd,
    role: 'substitute',
  };
}

async function nextAuditId(client: PoolClient, leagueId: string): Promise<string> {
  const result = await client.query<{ n: number }>(
    'SELECT COUNT(*)::int AS n FROM roster_audit WHERE roster_league_id = $1',
    [leagueId],
  );
  return `au-${String(Number(result.rows[0]?.n ?? 0) + 1).padStart(4, '0')}`;
}

async function insertAudit(client: PoolClient, entry: {
  leagueId: string;
  auditId: string;
  action: AuditEntry['action'];
  playerId: string;
  fromSquadId: string;
  toSquadId: string | null;
  effectiveDate: string;
  state: AuditEntry['state'];
  who: string;
  why: string;
  when: string;
  loanEnd: string | null;
}): Promise<AuditEntry> {
  const audit: AuditEntry = {
    audit_id: entry.auditId,
    action: entry.action,
    player_id: entry.playerId,
    league_id: entry.leagueId,
    from_squad_id: entry.fromSquadId,
    to_squad_id: entry.toSquadId,
    effective_date: entry.effectiveDate,
    state: entry.state,
    who: entry.who,
    when: entry.when,
    why: entry.why,
  };
  await client.query(
    `INSERT INTO roster_audit (
       id, player_id, roster_league_id, action, from_squad_id, to_squad_id, effective_date, state, who, why, at, payload
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10, $11::timestamptz, $12::jsonb)`,
    [
      `${entry.leagueId}|${entry.auditId}`,
      entry.playerId,
      entry.leagueId,
      entry.action,
      entry.fromSquadId,
      entry.toSquadId,
      entry.effectiveDate,
      entry.state,
      entry.who,
      entry.why,
      entry.when,
      JSON.stringify({ audit_id: entry.auditId, loan_end_date: entry.loanEnd }),
    ],
  );
  return audit;
}

async function leagueFor(client: PoolClient, playerId: string): Promise<string | null> {
  const registered = await client.query<{ roster_league_id: string }>(
    `SELECT roster_league_id FROM registrations
     WHERE player_id = $1
     ORDER BY start_date DESC NULLS LAST
     LIMIT 1`,
    [playerId],
  );
  if (registered.rows[0]) return registered.rows[0].roster_league_id;
  const audited = await client.query<{ roster_league_id: string }>(
    'SELECT roster_league_id FROM roster_audit WHERE player_id = $1 ORDER BY seq DESC LIMIT 1',
    [playerId],
  );
  return audited.rows[0]?.roster_league_id ?? null;
}

async function loadAudit(client: PoolClient, leagueId: string, playerId: string): Promise<AuditRow[]> {
  const result = await client.query<AuditRow>(
    `SELECT action, player_id, roster_league_id, from_squad_id, to_squad_id,
            to_char(effective_date, 'YYYY-MM-DD') AS effective_date,
            state, who, why,
            to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS when_stamp,
            payload
     FROM roster_audit
     WHERE roster_league_id = $1 AND player_id = $2
     ORDER BY seq ASC`,
    [leagueId, playerId],
  );
  return result.rows;
}

function toAuditEntry(row: AuditRow): AuditEntry {
  return {
    audit_id: row.payload?.audit_id ?? '',
    action: row.action,
    player_id: row.player_id,
    league_id: row.roster_league_id,
    from_squad_id: row.from_squad_id,
    to_squad_id: row.to_squad_id,
    effective_date: row.effective_date,
    state: row.state,
    who: row.who,
    when: row.when_stamp,
    why: row.why,
  };
}

async function ensureLoanReturns(
  client: PoolClient,
  config: LeagueConfig,
  leagueId: string,
  playerId: string,
  asOf: string,
): Promise<void> {
  const entries = await loadAudit(client, leagueId, playerId);
  const due: Array<{ fromSquadId: string; toSquadId: string; effective: string }> = [];
  for (const entry of entries) {
    if (entry.action !== 'loan' || entry.state !== 'active' || !entry.payload?.loan_end_date) continue;
    if (asOf <= entry.payload.loan_end_date) continue;
    due.push({
      fromSquadId: entry.to_squad_id as string,
      toSquadId: entry.from_squad_id,
      effective: nextDay(entry.payload.loan_end_date),
    });
  }
  const baseline = config.baseline.find((row) => row.player_id === playerId);
  const returnDate = baseline?.loan_end_date ? nextDay(baseline.loan_end_date) : null;
  const superseded = entries.some(
    (entry) => entry.state === 'active' && entry.action !== 'loan_return' && returnDate !== null && entry.effective_date <= returnDate,
  );
  if (
    baseline
    && baseline.registration_type === 'loan'
    && baseline.parent_squad_id
    && baseline.loan_end_date
    && asOf > baseline.loan_end_date
    && !superseded
  ) {
    due.push({ fromSquadId: baseline.squad_id, toSquadId: baseline.parent_squad_id, effective: nextDay(baseline.loan_end_date) });
  }

  for (const item of due) {
    const already = entries.some((entry) =>
      entry.action === 'loan_return'
      && entry.from_squad_id === item.fromSquadId
      && entry.to_squad_id === item.toSquadId
      && entry.effective_date === item.effective);
    if (already) continue;
    const auditId = await nextAuditId(client, leagueId);
    await insertAudit(client, {
      leagueId,
      auditId,
      action: 'loan_return',
      playerId,
      fromSquadId: item.fromSquadId,
      toSquadId: item.toSquadId,
      effectiveDate: item.effective,
      state: 'active',
      who: 'system',
      why: 'Loan ended',
      when: serverStamp(),
      loanEnd: null,
    });
    await client.query(
      `UPDATE registrations
       SET squad_id = $3, parent_squad_id = NULL, registration_type = 'signing', role = 'substitute',
           start_date = $4::date, loan_end_date = NULL
       WHERE roster_league_id = $1 AND player_id = $2 AND registration_type = 'loan' AND squad_id = $5`,
      [leagueId, playerId, item.toSquadId, item.effective, item.fromSquadId],
    );
    entries.push({
      action: 'loan_return',
      player_id: playerId,
      roster_league_id: leagueId,
      from_squad_id: item.fromSquadId,
      to_squad_id: item.toSquadId,
      effective_date: item.effective,
      state: 'active',
      who: 'system',
      why: 'Loan ended',
      when_stamp: '',
      payload: {},
    });
  }
}

function project(baseline: Baseline | undefined, entries: AuditRow[], asOf: string): RosterState {
  let state: RosterState = baseline
    ? {
      squad_id: baseline.squad_id,
      parent_squad_id: baseline.parent_squad_id,
      role: baseline.role,
      registration_type: baseline.registration_type,
      start_date: baseline.start_date,
      loan_end_date: baseline.loan_end_date,
    }
    : emptyState();

  if (
    state.registration_type === 'loan'
    && state.parent_squad_id
    && state.start_date
    && asOf < state.start_date
  ) {
    state = {
      squad_id: state.parent_squad_id,
      parent_squad_id: null,
      role: 'substitute',
      registration_type: 'signing',
      start_date: null,
      loan_end_date: null,
    };
  }

  for (const entry of entries) {
    if (entry.state === 'deferred_until_match_end' || entry.effective_date > asOf) continue;
    state = reduce(state, entry, asOf);
  }
  return state;
}

function reduce(state: RosterState, entry: AuditRow, asOf: string): RosterState {
  if (entry.action === 'transfer') {
    return {
      squad_id: entry.to_squad_id,
      parent_squad_id: null,
      role: 'substitute',
      registration_type: 'transfer',
      start_date: entry.effective_date,
      loan_end_date: null,
    };
  }
  if (entry.action === 'release') return emptyState();
  if (entry.action === 'loan_return') {
    return {
      squad_id: entry.to_squad_id,
      parent_squad_id: null,
      role: 'substitute',
      registration_type: 'signing',
      start_date: entry.effective_date,
      loan_end_date: null,
    };
  }
  const loanEnd = entry.payload?.loan_end_date ?? null;
  if (loanEnd && asOf > loanEnd) {
    return {
      squad_id: entry.from_squad_id,
      parent_squad_id: null,
      role: 'substitute',
      registration_type: 'signing',
      start_date: nextDay(loanEnd),
      loan_end_date: null,
    };
  }
  return {
    squad_id: entry.to_squad_id,
    parent_squad_id: entry.from_squad_id,
    role: 'substitute',
    registration_type: 'loan',
    start_date: entry.effective_date,
    loan_end_date: loanEnd,
  };
}

function emptyState(): RosterState {
  return {
    squad_id: null,
    parent_squad_id: null,
    role: null,
    registration_type: null,
    start_date: null,
    loan_end_date: null,
  };
}

function resolveAsOf(asOf: string | undefined): string {
  if (asOf === undefined) return serverDate();
  if (!isIsoDate(asOf)) invalid(['as_of']);
  return asOf;
}

async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

function serverStamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function serverDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function nextDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function invalid(fields: string[]): never {
  throw new AppError(400, 'VALIDATION_ERROR', 'Request body failed validation.', { fields });
}

function conflict(code: string, message: string): never {
  throw new AppError(409, code, message);
}
