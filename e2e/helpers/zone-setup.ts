/**
 * Shared DB setup helpers for zone/plan permission tests.
 *
 * These poke the database directly (the only allowed backchannel) to build the
 * zone/plan/seat fixtures a test needs, then keep the sequences in sync so the
 * app's own inserts don't collide with the ids we forced.
 *
 * Zone types (warp/db.py):
 *   ZONE_TYPE_DISABLED    = 10
 *   ZONE_TYPE_ENABLED     = 20
 *   ZONE_TYPE_PUBLIC_VIEW = 30
 *   ZONE_TYPE_PUBLIC_BOOK = 40
 * Zone roles:
 *   ZONE_ROLE_ADMIN  = 10
 *   ZONE_ROLE_USER   = 20
 *   ZONE_ROLE_VIEWER = 30
 */
import { querySql } from './db';

export const ZONE_TYPE_DISABLED = 10;
export const ZONE_TYPE_ENABLED = 20;
export const ZONE_TYPE_PUBLIC_VIEW = 30;
export const ZONE_TYPE_PUBLIC_BOOK = 40;

export const ZONE_ROLE_ADMIN = 10;
export const ZONE_ROLE_USER = 20;
export const ZONE_ROLE_VIEWER = 30;

/** Set zone_type on an existing zone. */
export async function setZoneType(zid: number, zoneType: number): Promise<void> {
  await querySql('UPDATE zone SET zone_type = $1 WHERE id = $2', [zoneType, zid]);
}

/** Set zone_group on an existing zone (null clears it). */
export async function setZoneGroup(zid: number, group: string | null): Promise<void> {
  await querySql('UPDATE zone SET zone_group = $1 WHERE id = $2', [group, zid]);
}

/** Create a new zone and return its id. */
export async function createZone(name: string, zoneType: number, group: string | null = null): Promise<number> {
  const result = await querySql(
    'INSERT INTO zone (name, zone_type, zone_group) VALUES ($1, $2, $3) RETURNING id',
    [name, zoneType, group],
  );
  const zid = Number(result.rows[0].id);
  await querySql(
    "SELECT pg_catalog.setval(pg_get_serial_sequence('zone', 'id'), (SELECT MAX(id) FROM zone))",
  );
  return zid;
}

/** Create a new plan and return its id. */
export async function createPlan(name: string, iid: number | null = 1): Promise<number> {
  const result = await querySql(
    'INSERT INTO plan (name, iid) VALUES ($1, $2) RETURNING id',
    [name, iid],
  );
  const pid = Number(result.rows[0].id);
  await querySql(
    "SELECT pg_catalog.setval(pg_get_serial_sequence('plan', 'id'), (SELECT MAX(id) FROM plan))",
  );
  return pid;
}

/** Add seats to a plan+zone. Returns the new seat ids. */
export async function addSeats(pid: number, zid: number, names: string[]): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < names.length; i++) {
    const result = await querySql(
      'INSERT INTO seat (pid, zid, name, x, y) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [pid, zid, names[i], 100 + i * 70, 100],
    );
    ids.push(Number(result.rows[0].id));
  }
  await querySql(
    "SELECT pg_catalog.setval(pg_get_serial_sequence('seat', 'id'), (SELECT MAX(id) FROM seat))",
  );
  return ids;
}

/** Assign a user (or group) to a zone with a given role (upsert). */
export async function assignZoneRole(zid: number, login: string, role: number): Promise<void> {
  await querySql(
    'INSERT INTO zone_assign (zid, login, zone_role) VALUES ($1, $2, $3) ' +
      'ON CONFLICT (zid, login) DO UPDATE SET zone_role = $3',
    [zid, login, role],
  );
}

/** Remove every zone assignment for a login (e.g. to test the "unassigned" case). */
export async function clearZoneRoles(login: string): Promise<void> {
  await querySql('DELETE FROM zone_assign WHERE login = $1', [login]);
}

/** Count bookings for a login on a seat. */
export async function countBookings(login: string, sid: number): Promise<number> {
  const r = await querySql(
    'SELECT COUNT(*)::int AS cnt FROM book WHERE login = $1 AND sid = $2',
    [login, sid],
  );
  return r.rows[0].cnt;
}
