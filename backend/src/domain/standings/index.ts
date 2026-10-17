import { notImplemented } from '../../http/errors';

/** Registers a league with its teams, fixtures, points, and tie-break settings (Section 5.8). */
export async function registerLeague(_input: unknown): Promise<unknown> {
  return notImplemented('registerLeague');
}

/** Recomputes the table, h2h matrix, tie-breaks, and qualification status from event logs (Section 5.10). */
export async function projectStandings(_leagueId: string): Promise<unknown> {
  return notImplemented('projectStandings');
}
