import { getPool } from '../../db/pool';
import { AppError } from '../../http/errors';

const ANONYMIZED_PASSWORD = 'REDACTED_NOT_LOGIN';

function anonymizedEmail(userId: string): string {
  return `anon-${userId}@redacted.invalid`;
}

export interface PrivacyErasureResult {
  status: 'anonymized';
  pii_retained: false;
  tokens_wiped: true;
}

export async function eraseUserPrivacy(userId: string): Promise<PrivacyErasureResult> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const user = await client.query<{ id: string }>('SELECT id FROM users WHERE id = $1', [userId]);
    if (!user.rows[0]) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found.', { user_id: userId });
    }

    await client.query('UPDATE users SET email = $2, password = $3 WHERE id = $1', [
      userId,
      anonymizedEmail(userId),
      ANONYMIZED_PASSWORD,
    ]);
    await client.query('DELETE FROM guest_tokens');

    await client.query('COMMIT');
    return { status: 'anonymized', pii_retained: false, tokens_wiped: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
