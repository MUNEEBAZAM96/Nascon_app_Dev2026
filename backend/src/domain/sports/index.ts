import { z } from 'zod';

import { getPool } from '../../db/pool';
import { AppError } from '../../http/errors';
import { parseBody } from '../../http/validate';

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

const SportId = /^[a-z][a-z0-9_]{0,31}$/;
const EventKey = /^[a-z][a-z0-9_]{0,32}$/;

const SportBody = z.object({
  sport_id: z.string().regex(SportId),
  name: z.string().min(1).max(80),
  scoring_model: z.enum(['event', 'innings', 'round']),
  periods: z.record(z.string(), z.number().finite()).refine((periods) => Object.keys(periods).length > 0),
  scoring_events: z
    .record(
      z.string().regex(EventKey),
      z.record(z.string(), z.union([z.number().finite(), z.boolean()])).refine((value) => Object.keys(value).length > 0),
    )
    .refine((events) => Object.keys(events).length > 0),
  draw_allowed: z.boolean(),
  overtime: z.object({
    policy: z.string().min(1).max(40),
    duration_minutes: z.number().int().positive().optional(),
  }),
  tie_break_order: z.array(z.string().min(1)).min(1),
  roster: z
    .object({
      min_squad_size: z.number().int().min(1),
      max_squad_size: z.number().int().min(1),
      required_positions: z.record(z.string(), z.number().int().min(0)),
    })
    .refine((roster) => roster.min_squad_size <= roster.max_squad_size),
});

/** Loads a sport's rule set from the sports table; 404 SPORT_NOT_FOUND when absent. */
export async function getSport(id: string): Promise<SportConfig> {
  const result = await getPool().query<{ config: SportConfig }>('SELECT config FROM sports WHERE id = $1', [id]);
  const row = result.rows[0];
  if (!row) throw new AppError(404, 'SPORT_NOT_FOUND', 'Sport not found.', { sport_id: id });
  return row.config;
}

/** Validates and stores a sport defined purely as JSON (Section 5.6); 409 SPORT_EXISTS on duplicates. */
export async function createSport(input: unknown): Promise<{ sport_id: string; status: 'created'; config: SportConfig }> {
  const config = parseBody(SportBody, input);
  const inserted = await getPool().query(
    `INSERT INTO sports (id, name, scoring_model, config)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [config.sport_id, config.name, config.scoring_model, JSON.stringify(config)],
  );
  if (inserted.rowCount === 0) {
    throw new AppError(409, 'SPORT_EXISTS', 'Sport already exists.', { sport_id: config.sport_id });
  }
  return { sport_id: config.sport_id, status: 'created', config };
}
