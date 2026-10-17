import { createHash } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import { canonical, sign } from '../../crypto/sign';
import { loadConfig } from '../../config';
import { getPool } from '../../db/pool';
import { getSport, type SportConfig } from '../sports';
import { AppError } from '../../http/errors';
import { parseBody } from '../../http/validate';

const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

const Envelope = z.object({
  event_id: z.string().regex(ID_PATTERN),
  match_id: z.string().regex(ID_PATTERN),
  type: z.enum(['match_init', 'match_start', 'score', 'discipline', 'tiebreak_winner', 'match_end', 'compensation']),
  payload: z.record(z.string(), z.unknown()).default({}),
});

type EnvelopeBody = z.infer<typeof Envelope>;
type Db = Pool | PoolClient;
type Phase = 'none' | 'upcoming' | 'in_progress' | 'completed';
type Outcome = 'pending' | 'home_win' | 'away_win' | 'draw' | 'undecided';

interface EventRow {
  id: string;
  match_id: string;
  type: string;
  payload: Record<string, unknown>;
  sequence: number;
  signature: string;
  request_hash: string;
}

interface Totals {
  score: number;
  fairPlay: number;
  wickets: number;
  balls: number;
}

interface State {
  sport: SportConfig | null;
  leagueId: string | null;
  homeId: string | null;
  awayId: string | null;
  home: Totals;
  away: Totals;
  hasInit: boolean;
  hasStart: boolean;
  hasEnd: boolean;
  tiebreakTeamId: string | null;
  compensatedBy: Map<string, string>;
}

export interface AppendResult {
  http_status: 200 | 201;
  event_id: string;
  match_id: string;
  type: string;
  sequence: number;
  match_version: number;
  signature: string;
}

interface TeamTotal {
  team_id: string;
  score: number;
  wickets: number | null;
  balls: number | null;
  overs: string | null;
  fair_play: number;
}

export interface ScoreView {
  match_id: string;
  sport_id: string;
  league_id: string | null;
  status: 'upcoming' | 'in_progress' | 'completed';
  outcome: Outcome;
  winner_team_id: string | null;
  tiebreak_winner_team_id: string | null;
  home: TeamTotal;
  away: TeamTotal;
  version: number;
  events: Array<{
    sequence: number;
    event_id: string;
    type: string;
    payload: Record<string, unknown>;
    signature: string;
    compensated: boolean;
    compensated_by: string | null;
  }>;
}

/** Validates and appends one signed event. The same body replays as 200; a changed body is 409. */
export async function appendEvent(input: unknown): Promise<AppendResult> {
  const body = parseBody(Envelope, input ?? {});
  const hash = requestHash(body);
  const signature = sign(loadConfig().day1Salt, body.event_id, body.payload);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [body.match_id]);

    const existing = await client.query<EventRow>('SELECT * FROM match_events WHERE id = $1', [body.event_id]);
    const prior = existing.rows[0];
    if (prior) {
      if (prior.request_hash !== hash) {
        throw new AppError(409, 'DUPLICATE_EVENT_ID', 'An event with this id already exists.', { event_id: body.event_id });
      }
      await client.query('COMMIT');
      return accepted(200, prior);
    }

    const events = await loadMatchEvents(client, body.match_id);
    const state = await buildState(events);
    const sequence = (events.at(-1)?.sequence ?? 0) + 1;
    await assertLegal(body, state);
    await client.query(
      `INSERT INTO match_events (id, match_id, type, payload, sequence, signature, request_hash)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
      [body.event_id, body.match_id, body.type, JSON.stringify(body.payload), sequence, signature, hash],
    );
    await persistMatch(client, body, state, sequence === 1);
    await client.query('COMMIT');
    return {
      http_status: 201,
      event_id: body.event_id,
      match_id: body.match_id,
      type: body.type,
      sequence,
      match_version: sequence,
      signature,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Rebuilds the score, status, and outcome by replaying the match log. */
export async function projectScore(matchId: string): Promise<ScoreView> {
  const events = await loadMatchEvents(getPool(), matchId);
  if (!events.some((event) => event.type === 'match_init')) {
    throw new AppError(404, 'MATCH_NOT_FOUND', 'Match not found.', { match_id: matchId });
  }
  const state = await buildState(events);
  return toView(matchId, state, events);
}

function accepted(httpStatus: 200 | 201, row: EventRow): AppendResult {
  return {
    http_status: httpStatus,
    event_id: row.id,
    match_id: row.match_id,
    type: row.type,
    sequence: row.sequence,
    match_version: row.sequence,
    signature: row.signature,
  };
}

function requestHash(body: EnvelopeBody): string {
  return createHash('sha256').update(canonical({
    event_id: body.event_id,
    match_id: body.match_id,
    type: body.type,
    payload: body.payload,
  }), 'utf8').digest('hex');
}

async function loadMatchEvents(db: Db, matchId: string): Promise<EventRow[]> {
  const result = await db.query<EventRow>(
    `SELECT id, match_id, type, payload, sequence, signature, request_hash
     FROM match_events WHERE match_id = $1 ORDER BY sequence ASC`,
    [matchId],
  );
  return result.rows.map((row) => ({ ...row, payload: asObject(row.payload) }));
}

async function buildState(events: EventRow[]): Promise<State> {
  const init = events.find((event) => event.type === 'match_init');
  const state = emptyState();
  if (!init) return state;
  const sportId = init.payload.sport_id;
  state.sport = await getSport(typeof sportId === 'string' ? sportId : '');
  state.leagueId = typeof init.payload.league_id === 'string' && init.payload.league_id.length > 0 ? init.payload.league_id : null;
  state.homeId = stringField(init.payload, 'home_team_id');
  state.awayId = stringField(init.payload, 'away_team_id');
  state.hasInit = true;
  state.compensatedBy = compensationMap(events);
  for (const event of events) {
    if (event.type === 'match_start') state.hasStart = true;
    if (event.type === 'match_end') state.hasEnd = true;
    if (state.compensatedBy.has(event.id)) continue;
    applyLive(state, event);
  }
  return state;
}

function applyLive(state: State, event: EventRow): void {
  if (event.type === 'score' && state.sport) addScore(state, event.payload, state.sport);
  if (event.type === 'discipline') addFairPlay(state, event.payload);
  if (event.type === 'tiebreak_winner') {
    const teamId = stringField(event.payload, 'team_id');
    if (teamId) state.tiebreakTeamId = teamId;
  }
}

function addScore(state: State, payload: Record<string, unknown>, sport: SportConfig): void {
  const teamId = stringField(payload, 'team_id');
  const totals = totalsFor(state, teamId);
  if (!totals) return;
  const eventType = stringField(payload, 'event_type');
  const definition = eventType ? sport.scoring_events[eventType] : undefined;
  if (!definition) return;
  if (sport.scoring_model === 'event') totals.score += numeric(definition, 'points');
  if (sport.scoring_model === 'innings') {
    totals.score += numeric(definition, 'runs');
    if (definition.legal_ball === true) totals.balls += 1;
    if (definition.wicket === true) totals.wickets += 1;
  }
  if (sport.scoring_model === 'round') totals.score += numeric(definition, 'rounds');
}

function addFairPlay(state: State, payload: Record<string, unknown>): void {
  const totals = totalsFor(state, stringField(payload, 'team_id'));
  const points = payload.points;
  if (totals && typeof points === 'number' && Number.isFinite(points)) totals.fairPlay += points;
}

async function assertLegal(body: EnvelopeBody, state: State): Promise<void> {
  const phase = phaseOf(state);
  if (body.type === 'match_init') return assertInit(body, state);
  if (body.type === 'match_start') {
    if (phase !== 'upcoming') throw new AppError(409, 'ILLEGAL_TRANSITION', 'Match cannot start from its current state.', { match_id: body.match_id });
    return;
  }
  if (body.type === 'match_end') return assertEnd(body, state, phase);
  if (body.type === 'compensation') return assertCompensation(body, state, phase);
  if (phase !== 'in_progress') {
    throw new AppError(409, 'MATCH_NOT_IN_PROGRESS', 'Match is not in progress.', { match_id: body.match_id });
  }
  if (body.type === 'score') return assertScore(body, state);
  if (body.type === 'discipline') return assertDiscipline(body, state);
  return assertTiebreak(body, state);
}

async function assertInit(body: EnvelopeBody, state: State): Promise<void> {
  if (state.hasInit) throw new AppError(409, 'MATCH_EXISTS', 'Match already exists.', { match_id: body.match_id });
  const sportId = stringField(body.payload, 'sport_id');
  const homeId = stringField(body.payload, 'home_team_id');
  const awayId = stringField(body.payload, 'away_team_id');
  if (!sportId || !homeId || !awayId || homeId === awayId) validationPayload();
  await getSport(sportId);
}

function assertEnd(body: EnvelopeBody, state: State, phase: Phase): void {
  if (phase !== 'in_progress' || !state.sport) {
    throw new AppError(409, 'ILLEGAL_TRANSITION', 'Match cannot end from its current state.', { match_id: body.match_id });
  }
  if (state.home.score === state.away.score && !state.sport.draw_allowed && state.tiebreakTeamId === null) {
    throw new AppError(409, 'TIE_NOT_ALLOWED', 'A level score needs a tie-break winner.', { match_id: body.match_id });
  }
}

async function assertCompensation(body: EnvelopeBody, state: State, phase: Phase): Promise<void> {
  if (phase !== 'in_progress' && phase !== 'completed') {
    throw new AppError(409, 'MATCH_NOT_IN_PROGRESS', 'Match is not in progress.', { match_id: body.match_id });
  }
  const targetId = stringField(body.payload, 'compensates');
  if (!targetId) validationPayload();
  const found = await getPool().query<EventRow>('SELECT id, match_id, type FROM match_events WHERE id = $1', [targetId]);
  const target = found.rows[0];
  if (!target) throw new AppError(404, 'EVENT_NOT_FOUND', 'Event not found.', { event_id: targetId });
  const compensatable = target.type === 'score' || target.type === 'discipline' || target.type === 'tiebreak_winner';
  if (target.match_id !== body.match_id || !compensatable || state.compensatedBy.has(targetId)) {
    throw new AppError(409, 'INVALID_COMPENSATION', 'This event cannot be compensated.', { event_id: targetId });
  }
}

function assertScore(body: EnvelopeBody, state: State): void {
  const sport = state.sport;
  if (!sport) validationPayload();
  const teamId = stringField(body.payload, 'team_id');
  const totals = totalsFor(state, teamId);
  if (!totals) validationPayload();
  const eventType = stringField(body.payload, 'event_type');
  if (!eventType) validationPayload();
  if (!sport.scoring_events[eventType]) {
    throw new AppError(400, 'UNKNOWN_EVENT_TYPE', 'Event type is not defined for this sport.', { event_type: eventType });
  }
  if (sport.scoring_model === 'innings') {
    const ballsCap = period(sport, 'innings_per_team') * period(sport, 'overs_per_innings') * period(sport, 'balls_per_over');
    const wicketCap = period(sport, 'innings_per_team') * period(sport, 'wickets_per_innings');
    if (totals.balls >= ballsCap || totals.wickets >= wicketCap) {
      throw new AppError(409, 'INNINGS_COMPLETE', 'Innings is complete.', { match_id: body.match_id, team_id: teamId });
    }
  }
  if (sport.scoring_model === 'round') {
    const winsNeeded = Math.ceil(period(sport, 'best_of') / 2);
    if (state.home.score >= winsNeeded || state.away.score >= winsNeeded) {
      throw new AppError(409, 'SERIES_ALREADY_DECIDED', 'Series is already decided.', { match_id: body.match_id });
    }
  }
}

function assertDiscipline(body: EnvelopeBody, state: State): void {
  const points = body.payload.points;
  if (!totalsFor(state, stringField(body.payload, 'team_id')) || typeof points !== 'number' || !Number.isFinite(points)) {
    validationPayload();
  }
}

function assertTiebreak(body: EnvelopeBody, state: State): void {
  if (!totalsFor(state, stringField(body.payload, 'team_id'))) validationPayload();
  if (state.tiebreakTeamId !== null) {
    throw new AppError(409, 'ILLEGAL_TRANSITION', 'A tie-break winner is already active.', { match_id: body.match_id });
  }
}

async function persistMatch(client: PoolClient, body: EnvelopeBody, state: State, isFirst: boolean): Promise<void> {
  const status = body.type === 'match_end' ? 'completed' : body.type === 'match_start' ? 'in_progress' : phaseOf(state) === 'none' ? 'upcoming' : phaseOf(state);
  if (body.type === 'match_init' || isFirst) {
    const leagueId = typeof body.payload.league_id === 'string' && body.payload.league_id.length > 0 ? body.payload.league_id : null;
    await client.query(
      `INSERT INTO matches (id, league_id, sport_id, home_team_id, away_team_id, status)
       VALUES ($1, $2, $3, $4, $5, 'upcoming')
       ON CONFLICT (id) DO NOTHING`,
      [body.match_id, leagueId, body.payload.sport_id, body.payload.home_team_id, body.payload.away_team_id],
    );
  }
  await client.query('UPDATE matches SET status = $2 WHERE id = $1', [body.match_id, status]);
}

function toView(matchId: string, state: State, events: EventRow[]): ScoreView {
  const sport = state.sport;
  const decided = decide(state);
  const innings = sport?.scoring_model === 'innings';
  const perOver = innings && sport ? period(sport, 'balls_per_over') : 0;
  const team = (teamId: string, totals: Totals): TeamTotal => ({
    team_id: teamId,
    score: totals.score,
    wickets: innings ? totals.wickets : null,
    balls: innings ? totals.balls : null,
    overs: innings ? oversText(totals.balls, perOver) : null,
    fair_play: totals.fairPlay,
  });
  return {
    match_id: matchId,
    sport_id: sport?.sport_id ?? '',
    league_id: state.leagueId,
    status: phaseOf(state) === 'completed' ? 'completed' : phaseOf(state) === 'in_progress' ? 'in_progress' : 'upcoming',
    outcome: decided.outcome,
    winner_team_id: decided.winnerTeamId,
    tiebreak_winner_team_id: state.tiebreakTeamId,
    home: team(state.homeId ?? '', state.home),
    away: team(state.awayId ?? '', state.away),
    version: events.at(-1)?.sequence ?? 0,
    events: events.map((event) => ({
      sequence: event.sequence,
      event_id: event.id,
      type: event.type,
      payload: event.payload,
      signature: event.signature,
      compensated: state.compensatedBy.has(event.id),
      compensated_by: state.compensatedBy.get(event.id) ?? null,
    })),
  };
}

function decide(state: State): { outcome: Outcome; winnerTeamId: string | null } {
  if (!state.hasEnd) return { outcome: 'pending', winnerTeamId: null };
  if (state.tiebreakTeamId) {
    const homeWins = state.tiebreakTeamId === state.homeId;
    return { outcome: homeWins ? 'home_win' : 'away_win', winnerTeamId: state.tiebreakTeamId };
  }
  if (state.home.score > state.away.score) return { outcome: 'home_win', winnerTeamId: state.homeId };
  if (state.away.score > state.home.score) return { outcome: 'away_win', winnerTeamId: state.awayId };
  if (state.sport?.draw_allowed) return { outcome: 'draw', winnerTeamId: null };
  return { outcome: 'undecided', winnerTeamId: null };
}

function phaseOf(state: State): Phase {
  if (!state.hasInit) return 'none';
  if (state.hasEnd) return 'completed';
  if (state.hasStart) return 'in_progress';
  return 'upcoming';
}

function compensationMap(events: EventRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const event of events) {
    if (event.type !== 'compensation') continue;
    const target = stringField(event.payload, 'compensates');
    if (target && !map.has(target)) map.set(target, event.id);
  }
  return map;
}

function period(sport: SportConfig, key: string): number {
  const value = sport.periods[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) validationPayload();
  return value;
}

function numeric(definition: Record<string, number | boolean>, key: string): number {
  const value = definition[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function totalsFor(state: State, teamId: string | null): Totals | null {
  if (teamId && teamId === state.homeId) return state.home;
  if (teamId && teamId === state.awayId) return state.away;
  return null;
}

function emptyTotals(): Totals {
  return { score: 0, fairPlay: 0, wickets: 0, balls: 0 };
}

function emptyState(): State {
  return {
    sport: null,
    leagueId: null,
    homeId: null,
    awayId: null,
    home: emptyTotals(),
    away: emptyTotals(),
    hasInit: false,
    hasStart: false,
    hasEnd: false,
    tiebreakTeamId: null,
    compensatedBy: new Map(),
  };
}

function oversText(balls: number, perOver: number): string {
  if (perOver <= 0) return '0.0';
  return `${Math.floor(balls / perOver)}.${balls % perOver}`;
}

function stringField(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asObject(payload: unknown): Record<string, unknown> {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
}

function validationPayload(): never {
  throw new AppError(400, 'VALIDATION_ERROR', 'Request body failed validation.', { fields: ['payload'] });
}
