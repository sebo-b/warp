import { readFileSync } from 'fs';
import path from 'path';
import { Client } from 'pg';
import { getRuntimeInfo } from './runtime';

// Structural scripts (clean_db.sql drops the schema, schema.sql rebuilds it)
// come straight from the application source — they ARE the schema, so app and
// tests can never disagree on structure. sample_data.sql is different: it is
// demo seed data (users, zones, seats, bookings) that may be edited for demo /
// marketing reasons, and the e2e suite asserts on specific values from it
// (user1/password, "Zone 1A", seat "1.1", …). To keep those assertions stable
// against demo edits, the suite owns a frozen snapshot under e2e/sql/ instead
// of reading warp/sql/sample_data.sql. The app still loads its own copy at
// first start in debug mode; resetDb() overrides it before every test.
const APP_SQL_DIR = path.resolve(__dirname, '../../warp/sql');
const E2E_SQL_DIR = path.resolve(__dirname, '../sql');
const RESET_SCRIPTS: { file: string; dir: string }[] = [
  { file: 'clean_db.sql', dir: APP_SQL_DIR },
  { file: 'schema.sql', dir: APP_SQL_DIR },
  { file: 'sample_data.sql', dir: E2E_SQL_DIR },
];

// Credentials match DevelopmentSettings component defaults in warp/config.py
// and the password baked into Dockerfile_debug. Host/port come from the
// runtime info (the container's Postgres is published on a random host port).
function dbClient(): Client {
  const rt = getRuntimeInfo();
  return new Client({
    host: rt.dbHost,
    port: rt.dbPort,
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
    for (const { file, dir } of RESET_SCRIPTS) {
      const sql = readFileSync(path.join(dir, file), 'utf8');
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
