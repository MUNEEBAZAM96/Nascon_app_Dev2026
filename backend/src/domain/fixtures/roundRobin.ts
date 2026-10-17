import { asParams, isPlainObject, optionalInt, validateTeams, validationError } from './common';

export type RoundRobinStatus = 'scheduled' | 'forfeit' | 'voided';

export interface RoundRobinMatch {
  match_id: string;
  leg: number;
  home: string;
  away: string;
  status: RoundRobinStatus;
  awarded_to: string | null;
}

export interface RoundRobinRound {
  round: number;
  matches: RoundRobinMatch[];
  byes: string[];
}

export interface RoundRobinResult {
  format: 'round_robin';
  legs: number;
  team_count: number;
  round_count: number;
  rounds: RoundRobinRound[];
  summary: { total: number; scheduled: number; forfeit: number; voided: number };
}

interface Withdrawal {
  team_id: string;
  after_round: number;
}

/** Circle-method round robin (1 or 2 legs) with byes and withdrawal policies (Section 5.7-A). */
export function generateRoundRobin(teamsInput: string[], paramsInput: unknown): RoundRobinResult {
  const teams = validateTeams(teamsInput, 2, 40);
  const params = asParams(paramsInput);
  const legs = optionalInt(params.legs, 'legs', 1, 2, 1);

  const policy = params.withdrawal_policy ?? 'forfeit_remaining';
  if (policy !== 'forfeit_remaining' && policy !== 'void_all') validationError(['withdrawal_policy']);

  const n = teams.length;
  // Odd fields get a fixed bye slot (null) so the circle is even-sized.
  const circle: (string | null)[] = n % 2 === 0 ? [...teams] : [null, ...teams];
  const size = circle.length;
  const roundsPerLeg = size - 1;
  const roundCount = roundsPerLeg * legs;

  const withdrawals = parseWithdrawals(params.withdrawals, teams, roundCount);

  const legOne = buildLeg(circle, roundsPerLeg);
  const rounds: RoundRobinRound[] = [];
  for (let leg = 1; leg <= legs; leg++) {
    for (const base of legOne) {
      const round = base.round + (leg - 1) * roundsPerLeg;
      rounds.push({
        round,
        matches: base.pairs.map(([home, away], i) => ({
          match_id: `RR-L${leg}-R${round}-M${i + 1}`,
          leg,
          home: leg === 1 ? home : away,
          away: leg === 1 ? away : home,
          status: 'scheduled',
          awarded_to: null,
        })),
        byes: base.bye ? [base.bye] : [],
      });
    }
  }

  applyWithdrawals(rounds, withdrawals, policy);

  const summary = { total: 0, scheduled: 0, forfeit: 0, voided: 0 };
  for (const round of rounds) {
    for (const match of round.matches) {
      summary.total++;
      summary[match.status]++;
    }
  }

  return { format: 'round_robin', legs, team_count: n, round_count: roundCount, rounds, summary };
}

interface LegRound {
  round: number;
  pairs: [string, string][];
  bye: string | null;
}

function buildLeg(circle: (string | null)[], roundsPerLeg: number): LegRound[] {
  const size = circle.length;
  const fixed = circle[0];
  let rotating = circle.slice(1);
  const rounds: LegRound[] = [];

  for (let r = 0; r < roundsPerLeg; r++) {
    const positions = [fixed, ...rotating];
    const pairs: [string, string][] = [];
    let bye: string | null = null;

    // Pair 0 involves the fixed slot; alternate its home/away by round parity.
    const opponent = positions[size - 1];
    if (fixed === null) {
      bye = opponent as string;
    } else {
      pairs.push(r % 2 === 0 ? [fixed, opponent as string] : [opponent as string, fixed]);
    }

    // Left positions are home, mirrored right positions are away. Every rotating team visits
    // each position once per leg, so home/away counts differ by at most one.
    for (let i = 1; i < size / 2; i++) {
      pairs.push([positions[i] as string, positions[size - 1 - i] as string]);
    }

    rounds.push({ round: r + 1, pairs, bye });
    rotating = [rotating[rotating.length - 1], ...rotating.slice(0, -1)];
  }
  return rounds;
}

function parseWithdrawals(value: unknown, teams: string[], roundCount: number): Withdrawal[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) validationError(['withdrawals']);
  return value.map((item) => {
    if (
      !isPlainObject(item) ||
      typeof item.team_id !== 'string' ||
      !teams.includes(item.team_id) ||
      typeof item.after_round !== 'number' ||
      !Number.isInteger(item.after_round) ||
      item.after_round < 0 ||
      item.after_round > roundCount
    ) {
      validationError(['withdrawals']);
    }
    return { team_id: item.team_id, after_round: item.after_round };
  });
}

function applyWithdrawals(rounds: RoundRobinRound[], withdrawals: Withdrawal[], policy: string): void {
  if (withdrawals.length === 0) return;
  const afterRound = new Map(withdrawals.map((w) => [w.team_id, w.after_round]));

  for (const round of rounds) {
    for (const match of round.matches) {
      const homeOut = isWithdrawn(match.home, round.round, afterRound, policy);
      const awayOut = isWithdrawn(match.away, round.round, afterRound, policy);
      if (!homeOut && !awayOut) continue;
      if (policy === 'void_all' || (homeOut && awayOut)) {
        match.status = 'voided';
        match.awarded_to = null;
      } else {
        match.status = 'forfeit';
        match.awarded_to = homeOut ? match.away : match.home;
      }
    }
  }
}

function isWithdrawn(team: string, round: number, afterRound: Map<string, number>, policy: string): boolean {
  const limit = afterRound.get(team);
  if (limit === undefined) return false;
  return policy === 'void_all' || round > limit;
}
