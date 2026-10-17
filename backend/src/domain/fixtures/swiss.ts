import { AppError } from '../../http/errors';

import { asParams, isPlainObject, optionalInt, validateTeams, validationError } from './common';

export interface SwissPairing {
  match_id: string;
  home: string;
  away: string;
}

export interface SwissStanding {
  rank: number;
  team_id: string;
  score: number;
  buchholz: number;
}

export interface SwissResult {
  format: 'swiss';
  round: number;
  total_rounds: number;
  pairings: SwissPairing[];
  bye: string | null;
  standings: SwissStanding[];
}

interface HistoryMatch {
  home: string;
  away: string;
  result: 'home' | 'away' | 'draw';
}

interface HistoryRound {
  round: number;
  bye: string | null;
  matches: HistoryMatch[];
}

/** Pairs one Swiss round from history with minimum score gaps and no rematches (Section 5.7-B). */
export function generateSwiss(teamsInput: string[], paramsInput: unknown): SwissResult {
  const teams = validateTeams(teamsInput, 2, 64);
  const params = asParams(paramsInput);
  const n = teams.length;

  const defaultRounds = Math.max(1, Math.ceil(Math.log2(n)));
  const totalRounds = optionalInt(params.total_rounds, 'total_rounds', 1, n - 1, Math.min(defaultRounds, n - 1));
  const round = optionalInt(params.round, 'round', 1, totalRounds, 1);
  const history = parseHistory(params.history, teams, round);

  const seedOf = new Map(teams.map((team, index) => [team, index]));
  const score = new Map(teams.map((team) => [team, 0]));
  const opponents = new Map(teams.map((team) => [team, [] as string[]]));
  const hadBye = new Set<string>();

  for (const past of history) {
    if (past.bye) {
      score.set(past.bye, score.get(past.bye)! + 1);
      hadBye.add(past.bye);
    }
    for (const match of past.matches) {
      opponents.get(match.home)!.push(match.away);
      opponents.get(match.away)!.push(match.home);
      if (match.result === 'draw') {
        score.set(match.home, score.get(match.home)! + 0.5);
        score.set(match.away, score.get(match.away)! + 0.5);
      } else {
        const winner = match.result === 'home' ? match.home : match.away;
        score.set(winner, score.get(winner)! + 1);
      }
    }
  }

  const buchholz = new Map(
    teams.map((team) => [team, opponents.get(team)!.reduce((sum, opp) => sum + score.get(opp)!, 0)]),
  );

  const ranked = [...teams].sort(
    (a, b) => score.get(b)! - score.get(a)! || buchholz.get(b)! - buchholz.get(a)! || seedOf.get(a)! - seedOf.get(b)!,
  );
  const standings: SwissStanding[] = ranked.map((team, i) => ({
    rank: i + 1,
    team_id: team,
    score: score.get(team)!,
    buchholz: buchholz.get(team)!,
  }));

  let pairs: [string, string][];
  let bye: string | null = null;

  if (round === 1) {
    const m = Math.floor(n / 2);
    bye = n % 2 === 1 ? teams[n - 1] : null;
    pairs = [];
    for (let i = 0; i < m; i++) pairs.push([teams[i], teams[i + m]]);
  } else {
    const met = new Set<string>();
    for (const team of teams) for (const opp of opponents.get(team)!) met.add(pairKey(team, opp));

    const byeCandidates: (string | null)[] =
      n % 2 === 1
        ? [...orderByeCandidates(teams, hadBye, score, seedOf), ...orderByeCandidates(teams, new Set(), score, seedOf)]
        : [null];

    let found: [string, string][] | null = null;
    for (const candidate of byeCandidates) {
      const pool = ranked.filter((team) => team !== candidate);
      found = minimumPairing(pool, score, met);
      if (found) {
        bye = candidate;
        break;
      }
    }
    if (!found) {
      throw new AppError(409, 'NO_VALID_PAIRING', `No rematch-free pairing exists for round ${round}.`, { round });
    }
    // Home = better score, then better seed.
    pairs = found.map(([a, b]) => (compareRank(a, b, score, seedOf) <= 0 ? [a, b] : [b, a]));
    pairs.sort((x, y) => compareRank(x[0], y[0], score, seedOf));
  }

  return {
    format: 'swiss',
    round,
    total_rounds: totalRounds,
    pairings: pairs.map(([home, away], i) => ({ match_id: `SW-R${round}-M${i + 1}`, home, away })),
    bye,
    standings,
  };
}

function compareRank(a: string, b: string, score: Map<string, number>, seedOf: Map<string, number>): number {
  return score.get(b)! - score.get(a)! || seedOf.get(a)! - seedOf.get(b)!;
}

function orderByeCandidates(
  teams: string[],
  exclude: Set<string>,
  score: Map<string, number>,
  seedOf: Map<string, number>,
): string[] {
  // Lowest score first; ties go to the lowest seed, i.e. the largest index.
  return teams
    .filter((team) => !exclude.has(team))
    .sort((a, b) => score.get(a)! - score.get(b)! || seedOf.get(b)! - seedOf.get(a)!);
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/**
 * Exact minimum-cost perfect matching (cost = |score difference|) avoiding rematches.
 * Branch and bound over the score-sorted pool; the lower bound is each free team's cheapest legal partner.
 */
function minimumPairing(pool: string[], score: Map<string, number>, met: Set<string>): [string, string][] | null {
  const n = pool.length;
  if (n % 2 === 1) return null;
  const cost = (a: number, b: number) => Math.abs(score.get(pool[a])! - score.get(pool[b])!);
  const legal = (a: number, b: number) => !met.has(pairKey(pool[a], pool[b]));

  const used = new Array<boolean>(n).fill(false);
  const current: [number, number][] = [];
  let best: [number, number][] | null = null;
  let bestCost = Number.POSITIVE_INFINITY;

  const lowerBound = (): number => {
    let total = 0;
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      let cheapest = Number.POSITIVE_INFINITY;
      for (let j = 0; j < n; j++) {
        if (i === j || used[j] || !legal(i, j)) continue;
        cheapest = Math.min(cheapest, cost(i, j));
      }
      if (cheapest === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
      total += cheapest;
    }
    return total / 2;
  };

  const search = (soFar: number): void => {
    if (soFar >= bestCost) return;
    const first = used.indexOf(false);
    if (first === -1) {
      best = [...current];
      bestCost = soFar;
      return;
    }
    const bound = lowerBound();
    if (bound === Number.POSITIVE_INFINITY || soFar + bound >= bestCost) return;

    const partners: number[] = [];
    for (let j = first + 1; j < n; j++) if (!used[j] && legal(first, j)) partners.push(j);
    partners.sort((a, b) => cost(first, a) - cost(first, b));

    used[first] = true;
    for (const j of partners) {
      used[j] = true;
      current.push([first, j]);
      search(soFar + cost(first, j));
      current.pop();
      used[j] = false;
    }
    used[first] = false;
  };

  search(0);
  return best ? (best as [number, number][]).map(([a, b]) => [pool[a], pool[b]]) : null;
}

function parseHistory(value: unknown, teams: string[], round: number): HistoryRound[] {
  const raw = value === undefined ? [] : value;
  if (!Array.isArray(raw) || raw.length !== round - 1) validationError(['history']);

  const teamSet = new Set(teams);
  return raw.map((item, index) => {
    if (!isPlainObject(item) || item.round !== index + 1 || !Array.isArray(item.matches)) validationError(['history']);
    const bye = item.bye ?? null;
    if (bye !== null && (typeof bye !== 'string' || !teamSet.has(bye))) validationError(['history']);
    const matches = item.matches.map((m: unknown) => {
      if (
        !isPlainObject(m) ||
        typeof m.home !== 'string' ||
        typeof m.away !== 'string' ||
        !teamSet.has(m.home) ||
        !teamSet.has(m.away) ||
        m.home === m.away ||
        (m.result !== 'home' && m.result !== 'away' && m.result !== 'draw')
      ) {
        validationError(['history']);
      }
      return { home: m.home, away: m.away, result: m.result } as HistoryMatch;
    });
    return { round: index + 1, bye: bye as string | null, matches };
  });
}
