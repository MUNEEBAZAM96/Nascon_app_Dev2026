import { notImplemented } from '../../http/errors';
import type { Principal } from './tokens';

export * from './tokens';

export type ProbeAction =
  | 'create_tenant'
  | 'manage_league_fixtures'
  | 'manage_club_roster'
  | 'manage_club_products'
  | 'patch_player'
  | 'read_club'
  | 'read_platform_config';

/** Issues one JWT per role plus the seeded scenario ids (Section 5.13). */
export async function issueMatrix(): Promise<unknown> {
  return notImplemented('issueMatrix');
}

/** Applies the policy matrix with tenant and ownership scope; throws 403 FORBIDDEN when denied. */
export async function authorize(_principal: Principal, _action: ProbeAction, _targetId?: string): Promise<void> {
  return notImplemented('authorize');
}
