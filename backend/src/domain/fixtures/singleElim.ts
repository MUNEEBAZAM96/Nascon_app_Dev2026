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

export interface SingleElimResult {
  format: 'single_elim';
  bracket_size: number;
  rounds: { round: number; matches: BracketMatch[] }[];
}

/** Seeded single-elimination bracket with byes, result propagation, and optional third place (Section 5.7-C). */
export function generateSingleElim(teamsInput: string[], paramsInput: unknown): SingleElimResult {
  const teams = validateTeams(teamsInput, 2, 128);
  const params = asParams(paramsInput);
  const thirdPlace = optionalBool(params.third_place_match, 'third_place_match', false);
  const results = parseResults(params.results);

  const size = nextPowerOfTwo(teams.length);
  const roundCount = Math.log2(size);
  const bracket = new Bracket(teams);
  const rounds: { round: number; matches: BracketMatch[] }[] = [];

  rounds.push({ round: 1, matches: seedFirstRound(bracket, teams, size, (i) => `R1M${i}`, 'main') });
  for (let r = 2; r <= roundCount; r++) {
    const matches: BracketMatch[] = [];
    for (let i = 1; i <= size / 2 ** r; i++) matches.push(bracket.add(newMatch(`R${r}M${i}`, 'main', r, i)));
    rounds.push({ round: r, matches });
  }

  for (const { round, matches } of rounds) {
    if (round === roundCount) continue;
    for (const match of matches) {
      match.winner_to = { match_id: `R${round + 1}M${Math.ceil(match.index / 2)}`, slot: match.index % 2 === 1 ? 'home' : 'away' };
    }
  }

  if (thirdPlace && roundCount >= 2) {
    const semis = rounds[roundCount - 2].matches;
    const tp = bracket.add(newMatch('TP', 'third_place', roundCount, 1));
    semis[0].loser_to = { match_id: 'TP', slot: 'home' };
    semis[1].loser_to = { match_id: 'TP', slot: 'away' };
    rounds[roundCount - 1].matches.push(tp);
  }

  bracket.settle();
  bracket.applyResults(results);

  return { format: 'single_elim', bracket_size: size, rounds };
}
