
CREATE TABLE blobs (
    id SERIAL PRIMARY KEY,
    mimetype text NOT NULL,
    data bytea NOT NULL,
    etag integer NOT NULL
);

-- TODO_X type limit
CREATE TABLE users (
    login text PRIMARY KEY,
    password text,
    name text,
    account_type integer NOT NULL
    );

-- create initial admin with password 'noneshallpass'
INSERT INTO users VALUES ('admin','pbkdf2:sha256:260000$LdN4KNf6xzb0XlSu$810ca4acafd3b6955e6ebc39d2edafd582c8020ab87fd56e3cede1bfebb7df03','Admin',10);

CREATE INDEX users_account_type_idx ON users(account_type);

-- ACCOUNT_TYPE_GROUP == 100
CREATE TABLE groups (
    "group" text NOT NULL,
    login text NOT NULL,
    PRIMARY KEY ("group",login),
    FOREIGN KEY ("group") REFERENCES users(login) ON DELETE CASCADE,
    FOREIGN KEY (login) REFERENCES users(login) ON DELETE CASCADE
    );

CREATE FUNCTION check_group_is_group()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM users
        WHERE login = NEW."group"
          AND account_type >= 100
    ) THEN
        RAISE EXCEPTION 'Only group accounts (account_type >= 100) can be used as a group';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER groups_account_type_check
BEFORE INSERT OR UPDATE ON groups
FOR EACH ROW
EXECUTE PROCEDURE check_group_is_group();

-- zone_type: 10 == ZONE_TYPE_DISABLED
-- zone_group: when non-NULL, user may hold at most one seat across all zones sharing the same group name
CREATE TABLE zone (
    id SERIAL PRIMARY KEY,
    name text NOT NULL,
    zone_type integer NOT NULL DEFAULT 10,
    zone_group text DEFAULT NULL
    );

-- TODO_X zone_role limit
CREATE TABLE zone_assign (
    zid integer NOT NULL,
    login text NOT NULL,
    zone_role integer NOT NULL,
    PRIMARY KEY (zid,login),
    FOREIGN KEY (zid) REFERENCES zone(id) ON DELETE CASCADE,
    FOREIGN KEY (login) REFERENCES users(login) ON DELETE CASCADE
    );

CREATE TABLE plan (
    id SERIAL PRIMARY KEY,
    name text NOT NULL,
    iid integer REFERENCES blobs(id) ON DELETE SET NULL,
    dark_filter jsonb NOT NULL DEFAULT '{"id":"smart","invert":100,"grayscale":0,"sepia":0,"saturate":100,"hue":180,"brightness":100,"contrast":100}',
    timezone text NOT NULL DEFAULT 'UTC'
);

CREATE TABLE seat (
    id SERIAL PRIMARY KEY,
    pid integer NOT NULL,
    zid integer NOT NULL,
    name text NOT NULL,
    x integer NOT NULL,
    y integer NOT NULL,
    enabled boolean NOT NULL DEFAULT TRUE,
    FOREIGN KEY (pid) REFERENCES plan(id) ON DELETE CASCADE,
    FOREIGN KEY (zid) REFERENCES zone(id) ON DELETE CASCADE
    );

CREATE TABLE seat_assign (
    sid integer NOT NULL,
    login text,
    days_in_advance integer,
    FOREIGN KEY (sid) REFERENCES seat(id) ON DELETE CASCADE,
    FOREIGN KEY (login) REFERENCES users(login) ON DELETE CASCADE
    );

CREATE UNIQUE INDEX seat_assign_uq          ON seat_assign(sid, login) WHERE login IS NOT NULL;
CREATE UNIQUE INDEX seat_assign_everyone_uq ON seat_assign(sid)         WHERE login IS NULL;

CREATE INDEX seat_pid ON seat(pid);
CREATE INDEX seat_zid ON seat(zid);

CREATE TABLE user_prefs (
    login text PRIMARY KEY,
    default_plan integer,
    default_day text NOT NULL DEFAULT 'same',
    default_time_from integer NOT NULL DEFAULT 32400,
    default_time_to integer NOT NULL DEFAULT 61200,
    ical_enabled boolean NOT NULL DEFAULT FALSE,
    ical_token text,
    reminder_weekdays integer NOT NULL DEFAULT 0,
    reminder_ahead_days integer NOT NULL DEFAULT 0,
    reminder_time integer NOT NULL DEFAULT 79200,
    reminder_release_ahead_days integer NOT NULL DEFAULT 0,
    reminder_zones integer[] NOT NULL DEFAULT '{}',
    zone_show_seat_names boolean NOT NULL DEFAULT FALSE,
    zone_show_booking_preview boolean NOT NULL DEFAULT FALSE,
    zone_show_assigned_names boolean NOT NULL DEFAULT FALSE,
    language text,
    FOREIGN KEY (login) REFERENCES users(login) ON DELETE CASCADE,
    FOREIGN KEY (default_plan) REFERENCES plan(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX user_prefs_ical_token_idx ON user_prefs(ical_token) WHERE ical_token IS NOT NULL;

CREATE TABLE book (
    id SERIAL PRIMARY KEY,
    login text NOT NULL,
    sid integer NOT NULL,
    fromts integer NOT NULL,
    tots integer NOT NULL,
    FOREIGN KEY (login) REFERENCES users(login) ON DELETE CASCADE,
    FOREIGN KEY (sid) REFERENCES seat(id) ON DELETE CASCADE
    );

CREATE INDEX book_login
ON book(login);

CREATE INDEX book_sid
ON book(sid);

CREATE INDEX book_fromTS
ON book(fromts);

CREATE INDEX book_toTS
ON book(tots);

-- Derives real UTC instants from wall-clock storage + per-plan IANA timezone.
-- Used by the overlap trigger for cross-TZ conflict comparison and any read-side
-- logic that needs real instants. Being a plain view it reflects plan.timezone
-- edits automatically — no stored UTC to keep in sync.
CREATE VIEW book_utc AS
SELECT b.id AS bid, b.login, b.sid, s.zid, z.zone_group, p.timezone,
       b.fromts, b.tots,
       (to_timestamp(b.fromts) AT TIME ZONE 'UTC' AT TIME ZONE p.timezone) AS from_utc,
       (to_timestamp(b.tots)   AT TIME ZONE 'UTC' AT TIME ZONE p.timezone) AS to_utc
FROM book b
JOIN seat s ON s.id = b.sid
JOIN zone z ON z.id = s.zid
JOIN plan p ON p.id = s.pid;

-- Single source of truth for zone access.  A row exists iff the user has
-- effective access to the zone; zone_role is the effective (minimum) role,
-- already resolving the public-zone "everyone" role.  No row means no access
-- (except the flask.g.isAdmin site-admin bypass, which stays in Python).
--
-- DISABLED zones keep ADMIN rows only — a user with explicit USER/VIEWER on a
-- DISABLED zone gets no row (no access).  PUBLIC_BOOK (type 40) grants every
-- user with account_type < 100 a synthetic USER (20) row; PUBLIC_VIEW (type 30)
-- grants VIEWER (30).  MIN(zone_role) merges explicit and synthetic: a user
-- with explicit ADMIN on a PUBLIC_BOOK zone keeps ADMIN (10), not USER (20).
-- Blocked users (account_type = 90) are included (same < 100 filter); blocked
-- status is enforced only at the auth layer.
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

CREATE FUNCTION update_user_to_zone_roles()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY user_to_zone_roles;
    RETURN NEW;
END
$$;

CREATE TRIGGER zone_assign_update
AFTER INSERT OR UPDATE OR DELETE ON zone_assign
FOR STATEMENT
EXECUTE PROCEDURE update_user_to_zone_roles();

CREATE TRIGGER groups_update
AFTER INSERT OR UPDATE OR DELETE ON groups
FOR STATEMENT
EXECUTE PROCEDURE update_user_to_zone_roles();

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


CREATE FUNCTION book_overlap_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
DECLARE
    booking_zid  INTEGER;
    zone_grp     TEXT;
    new_tz       TEXT;
    new_from_utc timestamptz;
    new_to_utc   timestamptz;
BEGIN
    IF NEW.fromTS >= NEW.toTS THEN
        RAISE EXCEPTION 'Incorrect time';
    END IF;

    -- Same seat: same plan => same TZ => raw integer overlap is correct and index-friendly
    IF EXISTS (
        SELECT 1 FROM book b
        WHERE b.sid = NEW.sid
          AND b.fromTS < NEW.toTS AND b.toTS > NEW.fromTS
    ) THEN
        RAISE 'Overlapping time for this seat or users' USING ERRCODE = 'exclusion_violation';
    END IF;

    SELECT s.zid, z.zone_group, p.timezone
      INTO booking_zid, zone_grp, new_tz
    FROM seat s JOIN zone z ON z.id = s.zid JOIN plan p ON p.id = s.pid
    WHERE s.id = NEW.sid;

    new_from_utc := to_timestamp(NEW.fromTS) AT TIME ZONE 'UTC' AT TIME ZONE new_tz;
    new_to_utc   := to_timestamp(NEW.toTS)   AT TIME ZONE 'UTC' AT TIME ZONE new_tz;

    IF zone_grp IS NOT NULL THEN
        -- Zone-group may span plans/TZs: compare real instants via book_utc
        IF EXISTS (
            SELECT 1 FROM book_utc bu
            WHERE bu.login = NEW.login
              AND bu.zone_group = zone_grp
              AND bu.from_utc < new_to_utc AND bu.to_utc > new_from_utc
        ) THEN
            RAISE 'Overlapping time for this seat or users' USING ERRCODE = 'exclusion_violation';
        END IF;
    ELSE
        -- Ungrouped: same zone (a zone may also span plans) -> real instants
        IF EXISTS (
            SELECT 1 FROM book_utc bu
            WHERE bu.login = NEW.login
              AND bu.zid = booking_zid
              AND bu.from_utc < new_to_utc AND bu.to_utc > new_from_utc
        ) THEN
            RAISE 'Overlapping time for this seat or users' USING ERRCODE = 'exclusion_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER book_overlap_insert_trig
BEFORE INSERT ON book
FOR EACH ROW
EXECUTE PROCEDURE book_overlap_insert();

CREATE UNLOGGED TABLE calendar_cache (
    login text NOT NULL,
    type text NOT NULL CHECK (type IN ('bookings', 'reminders')),
    ics text NOT NULL,
    day integer NOT NULL,
    generated_at integer NOT NULL,
    FOREIGN KEY (login) REFERENCES users(login) ON DELETE CASCADE,
    PRIMARY KEY (login, type)
);

CREATE TABLE db_initialized (version INTEGER NOT NULL);

INSERT INTO db_initialized(version) VALUES(19);
