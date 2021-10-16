
DROP VIEW IF EXISTS user_to_zone_roles;
DROP TABLE IF EXISTS seat_assign;
DROP TABLE IF EXISTS book;
DROP TABLE IF EXISTS seat;
DROP TABLE IF EXISTS zone;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
    login text PRIMARY KEY,
    password text,
    name text,
    account_type integer NOT NULL
    ) WITHOUT ROWID;

CREATE TABLE zone (
    id integer PRIMARY KEY ASC,
    zone_group integer NOT NULL,
    name text NOT NULL,
    image text
    );

CREATE TABLE seat (
    id integer PRIMARY KEY ASC,
    zid integer NOT NULL,
    name text NOT NULL,
    x integer NOT NULL,
    y integer NOT NULL,
    enabled boolean NOT NULL DEFAULT 1,
    FOREIGN KEY (zid) REFERENCES zone(id)
    );

CREATE TABLE seat_assign (
    sid integer NOT NULL,
    login text NOT NULL,
    PRIMARY KEY (sid,login),
    FOREIGN KEY (sid) REFERENCES seat(id),
    FOREIGN KEY (login) REFERENCES users(login)
    );

CREATE TABLE book (
    id integer PRIMARY KEY ASC,
    login text NOT NULL,
    sid integer NOT NULL,
    fromts integer NOT NULL,
    tots integer NOT NULL,
    FOREIGN KEY (login) REFERENCES users(login),
    FOREIGN KEY (sid) REFERENCES seat(id)
    );

CREATE VIEW user_to_zone_roles (login,zid,zone_role) AS
SELECT u.login,z.id, u.account_type FROM users u, zone z
WHERE u.account_type in (10,20);

CREATE TRIGGER book_overlap_insert
BEFORE INSERT ON book
BEGIN

    SELECT CASE WHEN NEW.fromTS >= NEW.toTS THEN
        RAISE(ABORT,"Incorect time")
    END;

    SELECT CASE WHEN
        (SELECT 1 FROM book b
         JOIN seat s on b.sid = s.id
         JOIN zone z on s.zid = z.id
         WHERE z.zone_group =
            (SELECT zone_group FROM zone z JOIN seat s on z.id = s.zid WHERE s.id = NEW.sid LIMIT 1)
         AND (b.sid = NEW.sid OR b.login = NEW.login)
         AND b.fromTS < NEW.toTS
         AND b.toTS > NEW.fromTS) IS NOT NULL
    THEN
        RAISE(ABORT,"Overlapping time for this seat or user")
    END;

END;
