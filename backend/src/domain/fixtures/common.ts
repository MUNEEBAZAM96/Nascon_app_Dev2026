import { AppError } from '../../http/errors';

export const TEAM_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

export function validationError(fields: string[], message = 'Request body failed validation.'): never {
  throw new AppError(400, 'VALIDATION_ERROR', message, { fields });
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asParams(params: unknown): Record<string, unknown> {
  if (params === undefined || params === null) return {};
  if (!isPlainObject(params)) validationError(['params']);
  return params;
}

export function validateTeams(teams: unknown, min: number, max: number): string[] {
  if (!Array.isArray(teams)) validationError(['teams']);
  if (teams.length < min || teams.length > max) {
    validationError(['teams'], `teams must contain between ${min} and ${max} unique ids.`);
  }
  const seen = new Set<string>();
  for (const team of teams) {
    if (typeof team !== 'string' || !TEAM_ID_PATTERN.test(team) || seen.has(team)) validationError(['teams']);
    seen.add(team);
  }
  return teams as string[];
}

export function optionalInt(value: unknown, field: string, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) validationError([field]);
  return value;
}

export function optionalBool(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') validationError([field]);
  return value;
}

export function nextPowerOfTwo(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

/** order(2) = [1, 2]; order(2k) = for each s in order(k): [s, 2k + 1 - s]. */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const doubled = order.length * 2;
    order = order.flatMap((seed) => [seed, doubled + 1 - seed]);
  }
  return order;
}

export type Slot = 'home' | 'away';

export interface Link {
  match_id: string;
  slot: Slot;
}

export interface BracketMatch {
  match_id: string;
  bracket: string;
  round: number;
  index: number;
  home: string | null;
  away: string | null;
  home_seed: number | null;
  away_seed: number | null;
  bye: boolean;
  winner: string | null;
  loser: string | null;
  winner_to: Link | null;
  loser_to: Link | null;
  conditional?: boolean;
  required?: boolean | null;
}

export interface ResultInput {
  match_id: string;
  winner: string;
}

export function parseResults(value: unknown): ResultInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) validationError(['results']);
  return value.map((item) => {
    if (!isPlainObject(item) || typeof item.match_id !== 'string' || typeof item.winner !== 'string') {
      validationError(['results']);
    }
    return { match_id: item.match_id, winner: item.winner };
  });
}

/**
 * Shared elimination-bracket engine. Matches are nodes; winner_to / loser_to are edges.
 * A "dead" slot can never receive a team (fed by a bye's missing loser, or by a dead match),
 * which lets single-participant matches advance automatically.
 */
export class Bracket {
  readonly matches = new Map<string, BracketMatch>();
  private readonly dead = new Map<string, { home: boolean; away: boolean }>();
  private readonly seeds: Map<string, number>;

  constructor(teams: string[]) {
    this.seeds = new Map(teams.map((team, index) => [team, index + 1]));
  }

  add(match: BracketMatch): BracketMatch {
    this.matches.set(match.match_id, match);
    this.dead.set(match.match_id, { home: false, away: false });
    return match;
  }

  get(id: string): BracketMatch {
    const match = this.matches.get(id);
    if (!match) throw new Error(`bracket match ${id} missing`);
    return match;
  }

  markDead(link: Link | null): void {
    if (!link) return;
    this.dead.get(link.match_id)![link.slot] = true;
  }

  place(link: Link | null, team: string | null): void {
    if (!link) return;
    if (team === null) {
      this.markDead(link);
      return;
    }
    const target = this.get(link.match_id);
    target[link.slot] = team;
    target[link.slot === 'home' ? 'home_seed' : 'away_seed'] = this.seeds.get(team) ?? null;
  }

  /** Records a winner, propagates both teams, then advances any matches that became trivial. */
  decide(match: BracketMatch, winner: string, loser: string | null): void {
    match.winner = winner;
    match.loser = loser;
    this.place(match.winner_to, winner);
    this.place(match.loser_to, loser);
    this.settle();
  }

  /** Fixed point: auto-advance matches with one live participant; kill matches with none. */
  settle(): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const match of this.matches.values()) {
        if (match.winner !== null) continue;
        const dead = this.dead.get(match.match_id)!;
        const homeLive = match.home !== null;
        const awayLive = match.away !== null;
        if (homeLive && awayLive) continue;
        if (homeLive && dead.away) {
          match.bye = true;
          match.winner = match.home;
          match.loser = null;
          this.place(match.winner_to, match.home);
          this.markDead(match.loser_to);
          changed = true;
        } else if (awayLive && dead.home) {
          match.bye = true;
          match.winner = match.away;
          match.loser = null;
          this.place(match.winner_to, match.away);
          this.markDead(match.loser_to);
          changed = true;
        } else if (dead.home && dead.away && !match.bye) {
          match.bye = true;
          this.markDead(match.winner_to);
          this.markDead(match.loser_to);
          changed = true;
        }
      }
    }
  }

  /** Applies caller-supplied results in dependency order; unknown match or non-participant → 400. */
  applyResults(results: ResultInput[]): void {
    let pending = [...results];
    while (pending.length > 0) {
      const deferred: ResultInput[] = [];
      for (const result of pending) {
        const match = this.matches.get(result.match_id);
        if (!match) validationError(['results'], `Unknown match_id ${result.match_id}.`);
        const participants = [match.home, match.away];
        if (!participants.includes(result.winner)) {
          deferred.push(result);
          continue;
        }
        const loser = match.home === result.winner ? match.away : match.home;
        this.decide(match, result.winner, loser);
      }
      if (deferred.length === pending.length) {
        validationError(['results'], `Winner ${deferred[0].winner} is not a participant of ${deferred[0].match_id}.`);
      }
      pending = deferred;
    }
  }
}

export function newMatch(
  match_id: string,
  bracket: string,
  round: number,
  index: number,
  overrides: Partial<BracketMatch> = {},
): BracketMatch {
  return {
    match_id,
    bracket,
    round,
    index,
    home: null,
    away: null,
    home_seed: null,
    away_seed: null,
    bye: false,
    winner: null,
    loser: null,
    winner_to: null,
    loser_to: null,
    ...overrides,
  };
}

/** Fills round-1 matches from the recursive seed order; missing seeds (> n) become byes. */
export function seedFirstRound(bracket: Bracket, teams: string[], size: number, idFor: (index: number) => string, bracketName: string): BracketMatch[] {
  const order = seedOrder(size);
  const matches: BracketMatch[] = [];
  for (let i = 1; i <= size / 2; i++) {
    const seedA = order[2 * i - 2];
    const seedB = order[2 * i - 1];
    const [homeSeed, awaySeed] = seedA < seedB ? [seedA, seedB] : [seedB, seedA];
    const home = homeSeed <= teams.length ? teams[homeSeed - 1] : null;
    const away = awaySeed <= teams.length ? teams[awaySeed - 1] : null;
    const match = bracket.add(
      newMatch(idFor(i), bracketName, 1, i, {
        home,
        away,
        home_seed: home ? homeSeed : null,
        away_seed: away ? awaySeed : null,
        bye: away === null || home === null,
      }),
    );
    if (home === null) bracket.markDead({ match_id: match.match_id, slot: 'home' });
    if (away === null) bracket.markDead({ match_id: match.match_id, slot: 'away' });
    matches.push(match);
  }
  return matches;
}
