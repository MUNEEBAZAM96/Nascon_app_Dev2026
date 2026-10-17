import {
  Bracket,
  asParams,
  nextPowerOfTwo,
  newMatch,
  optionalBool,
  parseResults,
  seedFirstRound,
  validateTeams,
  type BracketMatch,
} from './common';

export interface DoubleElimResult {
  format: 'double_elim';
  bracket_size: number;
  bracket_reset: boolean;
  winners: { round: number; matches: BracketMatch[] }[];
  losers: { round: number; matches: BracketMatch[] }[];
  grand_final: BracketMatch[];
}

/** Winners, losers, and grand-final brackets with an optional conditional reset match (Section 5.7-D). */
export function generateDoubleElim(teamsInput: string[], paramsInput: unknown): DoubleElimResult {
  const teams = validateTeams(teamsInput, 3, 128);
  const params = asParams(paramsInput);
  const bracketReset = optionalBool(params.bracket_reset, 'bracket_reset', false);
  const results = parseResults(params.results);

  const size = nextPowerOfTwo(teams.length);
  const k = Math.log2(size);
  const bracket = new Bracket(teams);

  // Winners bracket: WR{r} has B / 2^r matches.
  const winners: { round: number; matches: BracketMatch[] }[] = [
    { round: 1, matches: seedFirstRound(bracket, teams, size, (i) => `WR1M${i}`, 'winners') },
  ];
  for (let r = 2; r <= k; r++) {
    const matches: BracketMatch[] = [];
    for (let i = 1; i <= size / 2 ** r; i++) matches.push(bracket.add(newMatch(`WR${r}M${i}`, 'winners', r, i)));
    winners.push({ round: r, matches });
  }

  // Losers bracket: rounds 2j-1 and 2j each have B / 2^(j+1) matches, j = 1..k-1.
  const losers: { round: number; matches: BracketMatch[] }[] = [];
  for (let r = 1; r <= 2 * (k - 1); r++) {
    const j = Math.ceil(r / 2);
    const matches: BracketMatch[] = [];
    for (let i = 1; i <= size / 2 ** (j + 1); i++) matches.push(bracket.add(newMatch(`LR${r}M${i}`, 'losers', r, i)));
    losers.push({ round: r, matches });
  }

  const gf1 = bracket.add(newMatch('GF1', 'grand_final', 1, 1));
  const gf2 = bracketReset ? bracket.add(newMatch('GF2', 'grand_final', 2, 1, { conditional: true, required: null })) : null;

  // Winners routing.
  for (const { round, matches } of winners) {
    for (const match of matches) {
      const i = match.index;
      if (round < k) {
        match.winner_to = { match_id: `WR${round + 1}M${Math.ceil(i / 2)}`, slot: i % 2 === 1 ? 'home' : 'away' };
      } else {
        match.winner_to = { match_id: 'GF1', slot: 'home' };
      }
      if (round === 1) {
        // WR1 losers meet each other in LR1.
        match.loser_to = { match_id: `LR1M${Math.ceil(i / 2)}`, slot: i % 2 === 1 ? 'home' : 'away' };
      } else {
        // WR{r} losers (r >= 2) drop into LR{2r-2}, away slot, same index.
        match.loser_to = { match_id: `LR${2 * round - 2}M${i}`, slot: 'away' };
      }
    }
  }

  // Losers routing: odd rounds feed the home slot of the same index in the next (even) round;
  // even rounds pair up into the next odd round; the LB final feeds GF1.away.
  for (const { round, matches } of losers) {
    for (const match of matches) {
      const i = match.index;
      if (round === 2 * (k - 1)) {
        match.winner_to = { match_id: 'GF1', slot: 'away' };
      } else if (round % 2 === 1) {
        match.winner_to = { match_id: `LR${round + 1}M${i}`, slot: 'home' };
      } else {
        match.winner_to = { match_id: `LR${round + 1}M${Math.ceil(i / 2)}`, slot: i % 2 === 1 ? 'home' : 'away' };
      }
      match.loser_to = null;
    }
  }

  if (gf2) {
    gf1.winner_to = { match_id: 'GF2', slot: 'home' };
    gf1.loser_to = { match_id: 'GF2', slot: 'away' };
  }

  bracket.settle();
  bracket.applyResults(results);

  if (gf2) {
    // Same two teams as GF1; required only when the losers-bracket champion (GF1.away) takes game one.
    if (gf1.winner === null) {
      gf2.home = gf1.home;
      gf2.away = gf1.away;
      gf2.home_seed = gf1.home_seed;
      gf2.away_seed = gf1.away_seed;
      gf2.required = null;
    } else {
      gf2.required = gf1.winner === gf1.away;
    }
  }

  return {
    format: 'double_elim',
    bracket_size: size,
    bracket_reset: bracketReset,
    winners,
    losers,
    grand_final: gf2 ? [gf1, gf2] : [gf1],
  };
}
