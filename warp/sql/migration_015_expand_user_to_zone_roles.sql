-- Expand user_to_zone_roles to be the single source of truth for zone access.
-- The view now also contains synthetic rows for public zones (PUBLIC_VIEW,
-- PUBLIC_BOOK) so that a row exists iff the user has effective access, and
-- zone_role is the effective (minimum) role.  See
-- plan-expand-user-to-zone-roles.md for the full rationale.
--
-- Tighten the unique index from (login, zid, zone_role) to (login, zid): the
-- natural key is "user X's access to zone Y"; role is an attribute, not part of
-- the identity.  CONCURRENTLY refresh uses the unique index to identify rows
-- between old and new versions, so (login, zid) makes a role change an UPDATE
-- rather than a DELETE+INSERT.

DROP MATERIALIZED VIEW IF EXISTS user_to_zone_roles;

CREATE MATERIALIZED VIEW user_to_zone_roles ("login",zid,zone_role) AS
WITH RECURSIVE zone_assign_expanded("login",zid,zone_role,account_type,zone_type) AS (
    SELECT za."login", za.zid, za.zone_role, u.account_type, z.zone_type
    FROM zone_assign za
    JOIN users u ON za."login" = u."login"
    JOIN zone z  ON za.zid = z.id
  UNION
    SELECT g."login", za.zid, za.zone_role, u.account_type, za.zone_type
    FROM zone_assign_expanded za
    JOIN groups g ON g."group" = za."login"
    JOIN users u ON g."login" = u."login"
),
explicit_roles AS (
    SELECT "login", zid, MIN(zone_role) AS zone_role
    FROM zone_assign_expanded
    WHERE account_type < 100
      -- DISABLED zones keep ADMIN only: filter out non-ADMIN rows before MIN.
      AND (zone_type != 10 OR zone_role = 10)
    GROUP BY "login", zid
),
synthetic_public AS (
    SELECT u."login", z.id AS zid,
           CASE WHEN z.zone_type = 40 THEN 20
                WHEN z.zone_type = 30 THEN 30
           END AS zone_role
    FROM users u
    CROSS JOIN zone z
    WHERE u.account_type < 100
      AND z.zone_type IN (30, 40)
)
SELECT "login", zid, MIN(zone_role) AS zone_role
FROM (
    SELECT "login", zid, zone_role FROM explicit_roles
    UNION ALL
    SELECT "login", zid, zone_role FROM synthetic_public
) combined
GROUP BY "login", zid;

CREATE UNIQUE INDEX user_to_zone_roles_idx
ON user_to_zone_roles("login",zid);

CREATE INDEX user_to_zone_roles_zid_idx
ON user_to_zone_roles(zid);

-- Zone type changes (e.g. ENABLED -> PUBLIC_BOOK) add/remove synthetic rows,
-- so a zone INSERT/UPDATE/DELETE must also refresh the view.
CREATE TRIGGER zone_update
AFTER INSERT OR UPDATE OR DELETE ON zone
FOR STATEMENT
EXECUTE PROCEDURE update_user_to_zone_roles();

-- User creation/deletion adds/removes synthetic public-zone rows.  No UPDATE
-- trigger: the app prevents User<->Group conversion, so account_type stays
-- within < 100 and synthetic rows are unchanged by an UPDATE.
CREATE TRIGGER users_insert_delete
AFTER INSERT OR DELETE ON users
FOR STATEMENT
EXECUTE PROCEDURE update_user_to_zone_roles();

REFRESH MATERIALIZED VIEW user_to_zone_roles;