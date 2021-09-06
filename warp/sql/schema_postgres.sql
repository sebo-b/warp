DROP TABLE IF EXISTS assign;
DROP TABLE IF EXISTS book;
DROP TABLE IF EXISTS seat;
DROP TABLE IF EXISTS zone;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
    id SERIAL PRIMARY KEY, 
    login text UNIQUE NOT NULL, 
    password text,
    name text,
    role integer NOT NULL
    );

CREATE TABLE zone (
    id SERIAL PRIMARY KEY,
    zone_group integer NOT NULL,
    name text NOT NULL,
    image text
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

CREATE TABLE assign (
    sid integer NOT NULL,
    uid integer NOT NULL,
    PRIMARY KEY (sid,uid),
    FOREIGN KEY (sid) REFERENCES seat(id),
    FOREIGN KEY (uid) REFERENCES users(id)
    );

CREATE INDEX seat_zid
ON seat(zid);

CREATE TABLE book (
    id SERIAL PRIMARY KEY, 
    uid integer NOT NULL,
    sid integer NOT NULL,
    fromts integer NOT NULL,
    tots integer NOT NULL,
    FOREIGN KEY (uid) REFERENCES users(id),
    FOREIGN KEY (sid) REFERENCES seat(id)
    );

CREATE INDEX book_uid
ON book(uid);

CREATE INDEX book_sid
ON book(sid);

CREATE INDEX book_fromTS
ON book(fromts);

CREATE INDEX book_toTS
ON book(tots);

CREATE OR REPLACE FUNCTION public.book_overlap_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.fromTS >= NEW.toTS THEN
        RAISE EXCEPTION 'Incorect time';
    END IF;

    IF
        (SELECT CASE WHEN COUNT(*) > 0 AND SUM(CASE WHEN uid = NEW.uid THEN 1 ELSE 0 END) = 0 THEN TRUE ELSE FALSE END 
        FROM assign WHERE sid = NEW.sid) IS TRUE
    THEN
        RAISE EXCEPTION 'Seat is assigned to another person';
    END IF;

    IF
        (SELECT COUNT(*) FROM book b
         JOIN seat s on b.sid = s.id
         JOIN zone z on s.zid = z.id
         WHERE z.zone_group = 
            (SELECT zone_group FROM zone z JOIN seat s on z.id = s.zid WHERE s.id = NEW.sid LIMIT 1)
         AND (b.sid = NEW.sid OR b.uid = NEW.uid)
         AND b.fromTS < NEW.toTS
         AND b.toTS > NEW.fromTS) > 0
    THEN
        RAISE EXCEPTION 'Overlapping time for this seat or users';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE TRIGGER book_overlap_insert_trig
BEFORE INSERT ON book
EXECUTE PROCEDURE book_overlap_insert();
