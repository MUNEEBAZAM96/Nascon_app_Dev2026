import * as SQLite from 'expo-sqlite';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) dbPromise = SQLite.openDatabaseAsync('sideline.db');
  return dbPromise;
}

export async function initDb(): Promise<void> {
  const db = await getDb();
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS cache_fixtures (id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL, saved_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cache_standings (league_id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL, saved_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cache_profiles (club_id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL, saved_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pending_actions (action_id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS local_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  `);
}

export async function deviceId(): Promise<string> {
  await initDb();
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM local_meta WHERE key = ?', ['device_id']);
  if (row?.value) return row.value;
  await db.runAsync('INSERT INTO local_meta (key, value) VALUES (?, ?)', ['device_id', 'dev-phone-1']);
  return 'dev-phone-1';
}

export async function saveFixture(matchId: string, score: unknown): Promise<void> {
  await initDb();
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO cache_fixtures (id, body, saved_at) VALUES (?, ?, ?)',
    [matchId, JSON.stringify(score), new Date().toISOString()],
  );
}

export async function loadFixture<T>(matchId: string): Promise<T | null> {
  await initDb();
  const db = await getDb();
  const row = await db.getFirstAsync<{ body: string }>('SELECT body FROM cache_fixtures WHERE id = ?', [matchId]);
  return row ? JSON.parse(row.body) as T : null;
}

export async function saveStandings(leagueId: string, table: unknown): Promise<void> {
  await initDb();
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO cache_standings (league_id, body, saved_at) VALUES (?, ?, ?)',
    [leagueId, JSON.stringify(table), new Date().toISOString()],
  );
}

export async function loadStandings<T>(leagueId: string): Promise<T | null> {
  await initDb();
  const db = await getDb();
  const row = await db.getFirstAsync<{ body: string }>('SELECT body FROM cache_standings WHERE league_id = ?', [leagueId]);
  return row ? JSON.parse(row.body) as T : null;
}

export async function saveProfile(userId: string, profile: unknown): Promise<void> {
  await initDb();
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO cache_profiles (club_id, body, saved_at) VALUES (?, ?, ?)',
    [userId, JSON.stringify(profile), new Date().toISOString()],
  );
}

export async function loadProfile<T>(userId: string): Promise<T | null> {
  await initDb();
  const db = await getDb();
  const row = await db.getFirstAsync<{ body: string }>('SELECT body FROM cache_profiles WHERE club_id = ?', [userId]);
  return row ? JSON.parse(row.body) as T : null;
}
