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

CREATE TABLE groups (
    "group" text NOT NULL,
    login text NOT NULL,
    PRIMARY KEY ("group",login),
    FOREIGN KEY ("group") REFERENCES users(login),
    FOREIGN KEY (login) REFERENCES users(login)
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
    FOREIGN KEY (login) REFERENCES users(login)
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
    FOREIGN KEY (login) REFERENCES users(login)
    );

CREATE INDEX seat_zid
ON seat(zid);

CREATE TABLE book (
    id SERIAL PRIMARY KEY,
    login text NOT NULL,
    sid integer NOT NULL,
    fromts integer NOT NULL,
    tots integer NOT NULL,
    FOREIGN KEY (login) REFERENCES users(login),
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
