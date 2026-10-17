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
  `);
}
