import { getPool } from '../../db/pool';
import { AppError } from '../../http/errors';
import { signToken, type Principal, type Role } from './tokens';

export * from './tokens';

export type ProbeAction =
  | 'create_tenant'
  | 'manage_league_fixtures'
  | 'manage_club_roster'
  | 'manage_club_products'
  | 'patch_player'
  | 'read_club'
  | 'read_platform_config';

const ROLES: Role[] = ['super_admin', 'league_organizer', 'club_manager', 'player', 'viewer'];

const CONTEXT = {
  tenant_id: 'tenant-alpha',
  foreign_tenant_id: 'tenant-beta',
  own_league_id: 'league-alpha-1',
  other_league_id: 'league-alpha-2',
  foreign_league_id: 'league-beta-1',
  own_club_id: 'club-alpha-1',
  other_club_id: 'club-alpha-2',
  foreign_club_id: 'club-beta-1',
  own_player_id: 'player-alpha-1',
  other_player_id: 'player-alpha-2',
  foreign_player_id: 'player-beta-1',
};

interface UserRow {
  id: string;
  email: string;
  role: Role;
  tenant_id: string | null;
  league_id: string | null;
  club_id: string | null;
  player_id: string | null;
}

/** Issues one JWT per role plus the seeded scenario ids (Section 5.13). */
export async function issueMatrix(): Promise<{
  tokens: Record<Role, string>;
  context: typeof CONTEXT;
}> {
  const result = await getPool().query<UserRow>(
    'SELECT id, email, role, tenant_id, league_id, club_id, player_id FROM users WHERE role = ANY($1::text[])',
    [ROLES],
  );
  const byRole = new Map(result.rows.map((row) => [row.role, row]));
  const tokens = {} as Record<Role, string>;
  for (const role of ROLES) {
    const user = byRole.get(role);
    if (!user) throw new Error(`Seeded user for role ${role} is missing.`);
    tokens[role] = signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      tenant_id: user.tenant_id,
      league_id: user.league_id,
      club_id: user.club_id,
      player_id: user.player_id,
    });
  }
  return { tokens, context: CONTEXT };
}

/** Applies the policy matrix with tenant and ownership scope; throws 403 FORBIDDEN when denied. */
export async function authorize(principal: Principal, action: ProbeAction, targetId?: string): Promise<void> {
  const scope = targetId === undefined ? null : await loadScope(action, targetId);
  if (principal.role === 'super_admin') return;
  if (!permits(principal, action, targetId, scope)) {
    throw new AppError(403, 'FORBIDDEN', 'Not allowed.');
  }
}

async function loadScope(action: ProbeAction, targetId: string): Promise<{ tenantId: string | null; clubId: string | null }> {
  if (action === 'manage_league_fixtures') {
    const result = await getPool().query<{ tenant_id: string | null }>(
      'SELECT tenant_id FROM leagues WHERE id = $1',
      [targetId],
    );
    if (!result.rows[0]) throw new AppError(404, 'LEAGUE_NOT_FOUND', 'League not found.', { league_id: targetId });
    return { tenantId: result.rows[0].tenant_id, clubId: null };
  }
  if (action === 'patch_player') {
    const result = await getPool().query<{ club_id: string | null }>(
      'SELECT club_id FROM players WHERE id = $1',
      [targetId],
    );
    if (!result.rows[0]) throw new AppError(404, 'PLAYER_NOT_FOUND', 'Player not found.', { player_id: targetId });
    return { tenantId: null, clubId: result.rows[0].club_id };
  }
  if (action === 'manage_club_roster' || action === 'manage_club_products' || action === 'read_club') {
    const result = await getPool().query<{ tenant_id: string }>(
      'SELECT tenant_id FROM clubs WHERE id = $1',
      [targetId],
    );
    if (!result.rows[0]) throw new AppError(404, 'NOT_FOUND', 'Club not found.', { club_id: targetId });
    return { tenantId: result.rows[0].tenant_id, clubId: targetId };
  }
  return { tenantId: null, clubId: null };
}

function permits(
  principal: Principal,
  action: ProbeAction,
  targetId: string | undefined,
  scope: { tenantId: string | null; clubId: string | null } | null,
): boolean {
  if (action === 'create_tenant' || action === 'read_platform_config') return false;
  if (action === 'manage_league_fixtures') {
    return principal.role === 'league_organizer' && principal.league_id === targetId;
  }
  if (action === 'manage_club_roster' || action === 'manage_club_products') {
    return principal.role === 'club_manager' && principal.club_id === targetId;
  }
  if (action === 'patch_player') {
    if (principal.role === 'player') return principal.player_id === targetId;
    if (principal.role === 'club_manager') return scope?.clubId !== null && scope?.clubId === principal.club_id;
    return false;
  }
  return principal.tenant_id !== null && principal.tenant_id === scope?.tenantId;
}
