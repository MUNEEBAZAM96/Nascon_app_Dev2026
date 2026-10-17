import { z } from 'zod';

import { lotsKey } from '../../crypto/sign';
import { getPool } from '../../db/pool';
import { projectScore } from '../scoring';
import { getSport, type SportConfig } from '../sports';
import { AppError } from '../../http/errors';
import { parseBody } from '../../http/validate';

const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const TIE_BREAKS = ['h2h_points', 'h2h_diff', 'overall_diff', 'scored', 'fair_play', 'draw_lots'] as const;
type TieBreak = (typeof TIE_BREAKS)[number];

const Id = z.string().regex(ID_PATTERN);

const LeagueBody = z.object({
  league_id: Id,
  sport_id: Id,
  teams: z.array(Id).min(2).max(40),
  fixtures: z.array(z.object({
    match_id: Id,
    home_team_id: Id,
    away_team_id: Id,
  })),
  qualification: z.object({ spots: z.number().int() }),
  points: z.object({
    win: z.number().finite(),
    draw: z.number().finite(),
    loss: z.number().finite(),
  }).optional(),
  tie_break_order: z.array(z.string()).optional(),
  lots_seed: z.number().int().optional(),
});

interface PointsRule {
  win: number;
  draw: number;
  loss: number;
}

interface Cell {
  played: number;
  points: number;
  scored: number;
  conceded: number;
}

interface PlayedMatch {
  homeId: string;
  awayId: string;
  homeScore: number;
  awayScore: number;
  homePoints: number;
  awayPoints: number;
  homeBalls: number;
  awayBalls: number;
  homeWickets: number;
  awayWickets: number;
}

interface TeamRow {
  team_id: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  scored: number;
  conceded: number;
  diff: number;
  points: number;
  fair_play: number;
  remaining: number;
  runsFor: number;
  oversFor: number;
  runsAgainst: number;
  oversAgainst: number;
}

interface Placed {
  team_id: string;
  resolved_by: TieBreak | null;
}

export async function registerLeague(input: unknown): Promise<{
  league_id: string;
  status: 'created';
  team_count: number;
  fixture_count: number;
}> {
  const body = parseBody(LeagueBody, input ?? {});
  if (new Set(body.teams).size !== body.teams.length) invalid(['teams']);
  const teamSet = new Set(body.teams);
  const matchIds = new Set<string>();
  for (const fixture of body.fixtures) {
    if (
      fixture.home_team_id === fixture.away_team_id
      || !teamSet.has(fixture.home_team_id)
      || !teamSet.has(fixture.away_team_id)
      || matchIds.has(fixture.match_id)
    ) {
      invalid(['fixtures']);
    }
    matchIds.add(fixture.match_id);
  }
  const spots = body.qualification.spots;
  if (spots < 1 || spots > body.teams.length) invalid(['qualification']);
  if (body.tie_break_order) {
    const seen = new Set<string>();
    for (const token of body.tie_break_order) {
      if (!isTieBreak(token) || seen.has(token)) invalid(['tie_break_order']);
      seen.add(token);
    }
  }

  const sport = await getSport(body.sport_id);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const league = await client.query('SELECT 1 FROM leagues WHERE id = $1', [body.league_id]);
    if ((league.rowCount ?? 0) > 0) {
      throw new AppError(409, 'LEAGUE_EXISTS', 'League already exists.', { league_id: body.league_id });
    }
    if (matchIds.size > 0) {
      const taken = await client.query<{ id: string }>('SELECT id FROM matches WHERE id = ANY($1::text[])', [[...matchIds]]);
      const takenIds = new Set(taken.rows.map((row) => row.id));
      const clash = body.fixtures.find((fixture) => takenIds.has(fixture.match_id));
      if (clash) throw new AppError(409, 'MATCH_EXISTS', 'Match already exists.', { match_id: clash.match_id });
    }

    const points = body.points ?? { win: 3, draw: 1, loss: 0 };
    const tieBreak = body.tie_break_order ?? sport.tie_break_order;
    const lots = body.lots_seed ?? await readLotsSeed(client);
    await client.query(
      `INSERT INTO leagues (id, tenant_id, sport_id, name, points, tie_break_order, qualification_spots, lots_seed)
       VALUES ($1, NULL, $2, NULL, $3::jsonb, $4::jsonb, $5, $6)`,
      [body.league_id, body.sport_id, JSON.stringify(points), JSON.stringify(tieBreak), spots, lots],
    );
    for (const [index, teamId] of body.teams.entries()) {
      await client.query(
        'INSERT INTO league_teams (league_id, team_id, position) VALUES ($1, $2, $3)',
        [body.league_id, teamId, index],
      );
    }
    for (const fixture of body.fixtures) {
      await client.query(
        `INSERT INTO matches (id, league_id, sport_id, home_team_id, away_team_id, status)
         VALUES ($1, $2, $3, $4, $5, 'upcoming')`,
        [fixture.match_id, body.league_id, body.sport_id, fixture.home_team_id, fixture.away_team_id],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  return {
    league_id: body.league_id,
    status: 'created',
    team_count: body.teams.length,
    fixture_count: body.fixtures.length,
  };
}

export async function projectStandings(leagueId: string): Promise<{
  league_id: string;
  sport_id: string;
  qualification_spots: number;
  table: Array<Omit<TeamRow, 'remaining' | 'runsFor' | 'oversFor' | 'runsAgainst' | 'oversAgainst'> & {
    rank: number;
    status: 'clinched' | 'eliminated' | 'still_possible';
    resolved_by: TieBreak | null;
  }>;
  h2h: Record<string, Record<string, Cell>>;
}> {
  const league = await getPool().query<{
    sport_id: string;
    points: PointsRule;
    tie_break_order: string[] | null;
    qualification_spots: number;
    lots_seed: number;
  }>(
    `SELECT sport_id, points, tie_break_order, qualification_spots, lots_seed FROM leagues WHERE id = $1`,
    [leagueId],
  );
  const row = league.rows[0];
  if (!row) throw new AppError(404, 'LEAGUE_NOT_FOUND', 'League not found.', { league_id: leagueId });

  const sport = await getSport(row.sport_id);
  const teams = await getPool().query<{ team_id: string }>(
    'SELECT team_id FROM league_teams WHERE league_id = $1 ORDER BY position ASC, team_id ASC',
    [leagueId],
  );
  const fixtures = await getPool().query<{ id: string; home_team_id: string; away_team_id: string }>(
    'SELECT id, home_team_id, away_team_id FROM matches WHERE league_id = $1 ORDER BY id ASC',
    [leagueId],
  );

  const teamIds = teams.rows.map((team) => team.team_id);
  const stats = new Map(teamIds.map((teamId) => [teamId, emptyTeam(teamId)]));
  const h2h = emptyHeadToHead(teamIds);
  const played: PlayedMatch[] = [];
  const points = row.points;

  for (const fixture of fixtures.rows) {
    const score = await projectScore(fixture.id);
    const counts = score.status === 'completed' && score.outcome !== 'undecided';
    if (!counts) {
      bumpRemaining(stats, fixture.home_team_id);
      bumpRemaining(stats, fixture.away_team_id);
      continue;
    }
    const homePts = matchPoints(score.outcome, true, points);
    const awayPts = matchPoints(score.outcome, false, points);
    applySide(stats.get(fixture.home_team_id), score.home.score, score.away.score, score.home.fair_play, homePts, score.outcome === 'home_win', score.outcome === 'draw');
    applySide(stats.get(fixture.away_team_id), score.away.score, score.home.score, score.away.fair_play, awayPts, score.outcome === 'away_win', score.outcome === 'draw');
    addCell(h2h, fixture.home_team_id, fixture.away_team_id, homePts, score.home.score, score.away.score);
    addCell(h2h, fixture.away_team_id, fixture.home_team_id, awayPts, score.away.score, score.home.score);
    if (sport.scoring_model === 'innings') {
      const homeOvers = oversFaced(score.home.balls ?? 0, score.home.wickets ?? 0, sport);
      const awayOvers = oversFaced(score.away.balls ?? 0, score.away.wickets ?? 0, sport);
      addOvers(stats.get(fixture.home_team_id), score.home.score, homeOvers, score.away.score, awayOvers);
      addOvers(stats.get(fixture.away_team_id), score.away.score, awayOvers, score.home.score, homeOvers);
    }
    played.push({
      homeId: fixture.home_team_id,
      awayId: fixture.away_team_id,
      homeScore: score.home.score,
      awayScore: score.away.score,
      homePoints: homePts,
      awayPoints: awayPts,
      homeBalls: score.home.balls ?? 0,
      awayBalls: score.away.balls ?? 0,
      homeWickets: score.home.wickets ?? 0,
      awayWickets: score.away.wickets ?? 0,
    });
  }

  for (const team of stats.values()) {
    team.diff = sport.scoring_model === 'innings'
      ? netRunRate(team.runsFor, team.oversFor, team.runsAgainst, team.oversAgainst)
      : team.scored - team.conceded;
  }

  const criteria = sortingOrder(row.tie_break_order ?? sport.tie_break_order);
  const byPoints = [...stats.values()].sort((a, b) => b.points - a.points || a.team_id.localeCompare(b.team_id));
  const groups: TeamRow[][] = [];
  for (const team of byPoints) {
    const last = groups.at(-1);
    if (!last || last[0].points !== team.points) groups.push([team]);
    else last.push(team);
  }

  const placed: Placed[] = [];
  for (const group of groups) {
    if (group.length === 1) placed.push({ team_id: group[0].team_id, resolved_by: null });
    else placed.push(...resolveGroup(group.map((team) => team.team_id), criteria, stats, played, sport, row.lots_seed, leagueId));
  }

  const table = placed.map((entry, index) => {
    const team = stats.get(entry.team_id)!;
    return {
      rank: index + 1,
      team_id: team.team_id,
      played: team.played,
      won: team.won,
      drawn: team.drawn,
      lost: team.lost,
      scored: team.scored,
      conceded: team.conceded,
      diff: team.diff,
      points: team.points,
      fair_play: team.fair_play,
      status: qualification(team, [...stats.values()], row.qualification_spots, points.win),
      resolved_by: entry.resolved_by,
    };
  });

  return { league_id: leagueId, sport_id: row.sport_id, qualification_spots: row.qualification_spots, table, h2h };
}

function resolveGroup(
  group: string[],
  criteria: TieBreak[],
  stats: Map<string, TeamRow>,
  played: PlayedMatch[],
  sport: SportConfig,
  lotsSeed: number,
  leagueId: string,
  from = 0,
): Placed[] {
  if (group.length <= 1) return group.map((teamId) => ({ team_id: teamId, resolved_by: null }));
  for (let index = from; index < criteria.length; index += 1) {
    const criterion = criteria[index];
    if (criterion === 'draw_lots') {
      const sorted = [...group].sort((a, b) => lotsKey(lotsSeed, leagueId, a).localeCompare(lotsKey(lotsSeed, leagueId, b)));
      return sorted.map((teamId, place) => ({
        team_id: teamId,
        resolved_by: place < sorted.length - 1 ? 'draw_lots' : null,
      }));
    }
    const values = group.map((teamId) => ({ teamId, value: criterionValue(teamId, group, criterion, stats, played, sport) }));
    if (values.every((item) => item.value === values[0].value)) continue;
    const unique = [...new Set(values.map((item) => item.value))].sort((a, b) => b - a);
    const sections = unique.map((value) => {
      const members = values.filter((item) => item.value === value).map((item) => item.teamId);
      return members.length > 1 ? resolveGroup(members, criteria, stats, played, sport, lotsSeed, leagueId, 0) : [{ team_id: members[0], resolved_by: null }];
    });
    for (let section = 0; section < sections.length - 1; section += 1) {
      sections[section][sections[section].length - 1].resolved_by = criterion;
    }
    return sections.flat();
  }
  return group.map((teamId) => ({ team_id: teamId, resolved_by: null }));
}

function criterionValue(
  teamId: string,
  group: string[],
  criterion: TieBreak,
  stats: Map<string, TeamRow>,
  played: PlayedMatch[],
  sport: SportConfig,
): number {
  const season = stats.get(teamId)!;
  if (criterion === 'overall_diff') return season.diff;
  if (criterion === 'scored') return season.scored;
  if (criterion === 'fair_play') return season.fair_play;
  const mini = miniLeague(teamId, new Set(group), played, sport);
  if (criterion === 'h2h_points') return mini.points;
  return mini.diff;
}

function miniLeague(teamId: string, group: Set<string>, played: PlayedMatch[], sport: SportConfig): { points: number; diff: number } {
  let points = 0;
  let scored = 0;
  let conceded = 0;
  let runsFor = 0;
  let oversFor = 0;
  let runsAgainst = 0;
  let oversAgainst = 0;
  for (const match of played) {
    const homeIn = group.has(match.homeId);
    const awayIn = group.has(match.awayId);
    if (!homeIn || !awayIn) continue;
    if (match.homeId === teamId) {
      points += match.homePoints;
      scored += match.homeScore;
      conceded += match.awayScore;
      if (sport.scoring_model === 'innings') {
        const faced = oversFaced(match.homeBalls, match.homeWickets, sport);
        const bowled = oversFaced(match.awayBalls, match.awayWickets, sport);
        runsFor += match.homeScore;
        oversFor += faced;
        runsAgainst += match.awayScore;
        oversAgainst += bowled;
      }
    } else if (match.awayId === teamId) {
      points += match.awayPoints;
      scored += match.awayScore;
      conceded += match.homeScore;
      if (sport.scoring_model === 'innings') {
        const faced = oversFaced(match.awayBalls, match.awayWickets, sport);
        const bowled = oversFaced(match.homeBalls, match.homeWickets, sport);
        runsFor += match.awayScore;
        oversFor += faced;
        runsAgainst += match.homeScore;
        oversAgainst += bowled;
      }
    }
  }
  const diff = sport.scoring_model === 'innings' ? netRunRate(runsFor, oversFor, runsAgainst, oversAgainst) : scored - conceded;
  return { points, diff };
}

function qualification(team: TeamRow, all: TeamRow[], spots: number, winPoints: number): 'clinched' | 'eliminated' | 'still_possible' {
  const maxFor = (row: TeamRow) => row.points + winPoints * row.remaining;
  const others = all.filter((row) => row.team_id !== team.team_id);
  const withinReach = others.filter((row) => maxFor(row) >= team.points).length;
  if (withinReach < spots) return 'clinched';
  const ahead = others.filter((row) => row.points > maxFor(team)).length;
  if (ahead >= spots) return 'eliminated';
  return 'still_possible';
}

function matchPoints(outcome: string, home: boolean, points: PointsRule): number {
  if (outcome === 'draw') return points.draw;
  if ((outcome === 'home_win' && home) || (outcome === 'away_win' && !home)) return points.win;
  return points.loss;
}

function applySide(
  team: TeamRow | undefined,
  scored: number,
  conceded: number,
  fairPlay: number,
  points: number,
  won: boolean,
  drawn: boolean,
): void {
  if (!team) return;
  team.played += 1;
  team.scored += scored;
  team.conceded += conceded;
  team.fair_play += fairPlay;
  team.points += points;
  if (won) team.won += 1;
  else if (drawn) team.drawn += 1;
  else team.lost += 1;
}

function addOvers(team: TeamRow | undefined, runsFor: number, oversFor: number, runsAgainst: number, oversAgainst: number): void {
  if (!team) return;
  team.runsFor += runsFor;
  team.oversFor += oversFor;
  team.runsAgainst += runsAgainst;
  team.oversAgainst += oversAgainst;
}

function oversFaced(balls: number, wickets: number, sport: SportConfig): number {
  const innings = positive(sport.periods.innings_per_team, 1);
  const wicketLimit = positive(sport.periods.wickets_per_innings, 0) * innings;
  const full = positive(sport.periods.overs_per_innings, 0) * innings;
  if (wicketLimit > 0 && wickets >= wicketLimit) return full;
  const perOver = positive(sport.periods.balls_per_over, 0);
  if (perOver <= 0) return 0;
  return balls / perOver;
}

function netRunRate(runsFor: number, oversFor: number, runsAgainst: number, oversAgainst: number): number {
  const attack = oversFor > 0 ? runsFor / oversFor : 0;
  const defense = oversAgainst > 0 ? runsAgainst / oversAgainst : 0;
  return Math.round((attack - defense) * 1000) / 1000;
}

function sortingOrder(stored: string[]): TieBreak[] {
  const body = stored.filter((token): token is TieBreak => isTieBreak(token) && token !== 'draw_lots');
  return [...body, 'draw_lots'];
}

function emptyHeadToHead(teamIds: string[]): Record<string, Record<string, Cell>> {
  const matrix: Record<string, Record<string, Cell>> = {};
  for (const left of teamIds) {
    matrix[left] = {};
    for (const right of teamIds) {
      if (left === right) continue;
      matrix[left][right] = { played: 0, points: 0, scored: 0, conceded: 0 };
    }
  }
  return matrix;
}

function addCell(matrix: Record<string, Record<string, Cell>>, left: string, right: string, points: number, scored: number, conceded: number): void {
  const cell = matrix[left]?.[right];
  if (!cell) return;
  cell.played += 1;
  cell.points += points;
  cell.scored += scored;
  cell.conceded += conceded;
}

function bumpRemaining(stats: Map<string, TeamRow>, teamId: string): void {
  const team = stats.get(teamId);
  if (team) team.remaining += 1;
}

function emptyTeam(teamId: string): TeamRow {
  return {
    team_id: teamId,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    scored: 0,
    conceded: 0,
    diff: 0,
    points: 0,
    fair_play: 0,
    remaining: 0,
    runsFor: 0,
    oversFor: 0,
    runsAgainst: 0,
    oversAgainst: 0,
  };
}

async function readLotsSeed(client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ value: number }> }> }): Promise<number> {
  const result = await client.query(`SELECT value FROM app_meta WHERE key = 'lots_seed'`);
  return Number(result.rows[0]?.value ?? 42);
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isTieBreak(token: string): token is TieBreak {
  return (TIE_BREAKS as readonly string[]).includes(token);
}

function invalid(fields: string[]): never {
  throw new AppError(400, 'VALIDATION_ERROR', 'Request body failed validation.', { fields });
}
