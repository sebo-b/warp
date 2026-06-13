import { readFileSync } from 'fs';
import path from 'path';
import { Client } from 'pg';

// SQL scripts are taken straight from the application source so the reset
// replays exactly what the app does on first start in debug mode
// (DevelopmentSettings: DATABASE_PRE_INIT_SCRIPTS + schema + POST_INIT_SCRIPTS).
// The component defaults (DATABASE_ADDRESS, DATABASE_NAME, etc.) in
// DevelopmentSettings resolve to the same database.
const SQL_DIR = path.resolve(__dirname, '../../warp/sql');
const RESET_SCRIPTS = ['clean_db.sql', 'schema.sql', 'sample_data.sql'];

// Credentials match DevelopmentSettings component defaults in warp/config.py
// and the password baked into Dockerfile_debug.
function dbClient(): Client {
  return new Client({
    host: process.env.E2E_DB_HOST ?? '127.0.0.1',
    port: Number(process.env.E2E_DB_PORT ?? 5432),
    user: 'postgres',
    password: 'postgres_password',
    database: 'postgres',
  });
}

/**
 * Restore the database to the pristine sample-data state.
 * Safe to call between tests; the running flask app holds no state besides
 * per-request DB connections.
 */
export async function resetDb(): Promise<void> {
  const client = dbClient();
  await client.connect();
  try {
    for (const script of RESET_SCRIPTS) {
      const sql = readFileSync(path.join(SQL_DIR, script), 'utf8');
      await client.query(sql);
    }
  } finally {
    await client.end();
  }
}

/** Run an arbitrary SQL statement — escape hatch for test setup/assertions. */
export async function querySql(sql: string, params: unknown[] = []) {
  const client = dbClient();
  await client.connect();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end();
  }
}
