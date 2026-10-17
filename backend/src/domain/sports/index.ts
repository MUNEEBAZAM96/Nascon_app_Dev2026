import { notImplemented } from '../../http/errors';

export type ScoringModel = 'event' | 'innings' | 'round';

export interface SportConfig {
  sport_id: string;
  name: string;
  scoring_model: ScoringModel;
  periods: Record<string, number>;
  scoring_events: Record<string, Record<string, number | boolean>>;
  draw_allowed: boolean;
  overtime: { policy: string; duration_minutes?: number };
  tie_break_order: string[];
  roster: { min_squad_size: number; max_squad_size: number; required_positions: Record<string, number> };
}

/** Loads a sport's rule set from the sports table; 404 SPORT_NOT_FOUND when absent. */
export async function getSport(_id: string): Promise<SportConfig> {
  return notImplemented('getSport');
}

/** Validates and stores a sport defined purely as JSON (Section 5.6); 409 SPORT_EXISTS on duplicates. */
export async function createSport(_input: unknown): Promise<{ sport_id: string; status: 'created'; config: SportConfig }> {
  return notImplemented('createSport');
}
