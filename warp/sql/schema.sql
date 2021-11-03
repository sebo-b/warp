DROP MATERIALIZED VIEW IF EXISTS user_to_zone_roles;
DROP TABLE IF EXISTS seat_assign;
DROP TABLE IF EXISTS book;
DROP TABLE IF EXISTS seat;
DROP TABLE IF EXISTS zone_assign;
DROP TABLE IF EXISTS zone;
DROP TABLE IF EXISTS groups;
DROP TABLE IF EXISTS users;

-- TODO_X type limit
CREATE TABLE users (
    login text PRIMARY KEY,
    password text,
    name text,
    account_type integer NOT NULL
    );

CREATE INDEX users_account_type_idx ON users(account_type);

CREATE TABLE groups (
    "group" text NOT NULL,
    login text NOT NULL,
    PRIMARY KEY ("group",login),
    FOREIGN KEY ("group") REFERENCES users(login) ON DELETE CASCADE,
    FOREIGN KEY (login) REFERENCES users(login) ON DELETE CASCADE
    );


CREATE TABLE zone (
    id SERIAL PRIMARY KEY,
    zone_group integer NOT NULL,
    name text NOT NULL,
    image text
    );

-- TODO_X zone_role limit
CREATE TABLE zone_assign (
    zid integer NOT NULL,
    login text NOT NULL,
    zone_role integer NOT NULL,
    PRIMARY KEY (zid,login),
    FOREIGN KEY (zid) REFERENCES zone(id),
    FOREIGN KEY (login) REFERENCES users(login) ON DELETE CASCADE
    );

CREATE TABLE seat (
    id SERIAL PRIMARY KEY,
    zid integer NOT NULL,
    name text NOT NULL,
    x integer NOT NULL,
    y integer NOT NULL,
    enabled boolean NOT NULL DEFAULT TRUE,
    FOREIGN KEY (zid) REFERENCES zone(id)
    );

CREATE TABLE seat_assign (
    sid integer NOT NULL,
    login text NOT NULL,
    PRIMARY KEY (sid,login),
    FOREIGN KEY (sid) REFERENCES seat(id),
    FOREIGN KEY (login) REFERENCES users(login) ON DELETE CASCADE
    );

CREATE INDEX seat_zid
ON seat(zid);

CREATE TABLE book (
    id SERIAL PRIMARY KEY,
    login text NOT NULL,
    sid integer NOT NULL,
    fromts integer NOT NULL,
    tots integer NOT NULL,
    FOREIGN KEY (login) REFERENCES users(login) ON DELETE CASCADE,
    FOREIGN KEY (sid) REFERENCES seat(id)
    );

CREATE INDEX book_login
ON book(login);

CREATE INDEX book_sid
ON book(sid);

CREATE INDEX book_fromTS
ON book(fromts);

CREATE INDEX book_toTS
ON book(tots);

CREATE MATERIALIZED VIEW user_to_zone_roles ("login",zid,zone_role) AS
    with recursive zone_assign_expanded("login",zid,zone_role,account_type) as (
        select za."login",za.zid,za.zone_role,u.account_type from zone_assign za
        join users u on za."login" = u."login"
    union
        select g."login",za.zid, za.zone_role,u.account_type from zone_assign_expanded za
        join groups g on g."group" = za."login"
        join users u on g."login" = u."login"
    )
    select login,zid,MIN(zone_role) from zone_assign_expanded
    where account_type < 100
    group by zid,login;

-- CREATE MATERIALIZED VIEW user_to_zone_roles (login,zid,zone_role) AS
-- with recursive user_group(login,"group") as (
--   select login,login from users
--   where account_type < 100
--   union
--   select u.login,g."group" from user_group u
--   join "groups" g on g.login = u."group"
-- )
-- select ug."login", za.zid, MIN(za.zone_role) from user_group ug
-- join zone_assign za on za.login = ug."group"
-- group by ug."login", za.zid;

CREATE UNIQUE INDEX user_to_zone_roles_idx
ON user_to_zone_roles("login",zid,zone_role);

CREATE INDEX user_to_zone_roles_zid_idx
ON user_to_zone_roles(zid);

CREATE OR REPLACE FUNCTION update_user_to_zone_roles()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY user_to_zone_roles;
    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS zone_assign_update on zone_assign;
CREATE TRIGGER zone_assign_update
AFTER INSERT OR UPDATE OR DELETE ON zone_assign
FOR STATEMENT
EXECUTE PROCEDURE update_user_to_zone_roles();

DROP TRIGGER IF EXISTS groups_update on groups;
CREATE TRIGGER groups_update
AFTER INSERT OR UPDATE OR DELETE ON groups
FOR STATEMENT
EXECUTE PROCEDURE update_user_to_zone_roles();


-- with recursive user_group(login,"group") as (
--   select login,login from users
--   where account_type < 100
--   union
--   select u.login,g."group" from user_group u
--   join "groups" g on g.login = u."group"
--
-- )
-- select * from user_group;

-- CREATE VIEW user_to_zone_roles (login,zid,zone_role) AS
-- SELECT u.login,za.zid,MIN(za.zone_role) FROM users u
-- LEFT JOIN "groups" g ON g.login = u.login
-- JOIN zone_assign za ON za.login = g."group" OR za.login = u.login
-- WHERE u.account_type < 100
-- GROUP BY u.login, za.zid


CREATE OR REPLACE FUNCTION public.book_overlap_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.fromTS >= NEW.toTS THEN
        RAISE EXCEPTION 'Incorect time';
    END IF;

    IF
        (SELECT 1 FROM book b
         JOIN seat s on b.sid = s.id
         JOIN zone z on s.zid = z.id
         WHERE z.zone_group =
            (SELECT zone_group FROM zone z JOIN seat s on z.id = s.zid WHERE s.id = NEW.sid LIMIT 1)
         AND (b.sid = NEW.sid OR b.login = NEW.login)
         AND b.fromTS < NEW.toTS
         AND b.toTS > NEW.fromTS) IS NOT NULL
    THEN
        RAISE EXCEPTION 'Overlapping time for this seat or users';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS book_overlap_insert_trig on book;

CREATE TRIGGER book_overlap_insert_trig
BEFORE INSERT ON book
FOR EACH ROW
EXECUTE PROCEDURE book_overlap_insert();
