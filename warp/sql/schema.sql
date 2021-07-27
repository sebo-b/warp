BEGIN TRANSACTION;

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS book;
DROP TABLE IF EXISTS seat;
DROP TABLE IF EXISTS zone;
DROP TABLE IF EXISTS user;

CREATE TABLE user (
    id integer PRIMARY KEY ASC, 
    login text UNIQUE NOT NULL, 
    password text,
    name text,
    role integer NOT NULL
    );

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
    FOREIGN KEY (zid) REFERENCES zone(id)
    );

CREATE TABLE book (
    id integer PRIMARY KEY ASC, 
    uid integer NOT NULL,
    sid integer NOT NULL,
    fromTS integer NOT NULL,
    toTS integer NOT NULL,
    comment text,
    FOREIGN KEY (uid) REFERENCES user(id)
    FOREIGN KEY (sid) REFERENCES seat(id)
    );

CREATE INDEX book_fromTS
ON book(fromTS);

CREATE INDEX book_toTS
ON book(toTS);

CREATE TRIGGER book_overlap_insert
BEFORE INSERT ON book
BEGIN

    SELECT CASE WHEN NEW.fromTS >= NEW.toTS THEN
        RAISE(ABORT,"Incorect time")
    END;

    SELECT CASE WHEN
        (SELECT COUNT(*) FROM book b
         JOIN seat s on b.sid = s.id
         JOIN zone z on s.zid = z.id
         WHERE z.zone_group = 
            (SELECT zone_group FROM zone z JOIN seat s on z.id = s.zid WHERE s.id = NEW.sid LIMIT 1)
         AND (b.sid = NEW.sid OR b.uid = NEW.uid)
         AND b.fromTS < NEW.toTS
         AND b.toTS > NEW.fromTS) > 0
    THEN
        RAISE(ABORT,"Overlapping time for this seat or user")
    END;

END;

CREATE TRIGGER book_overlap_update
BEFORE UPDATE OF sid, uid, fromTS, toTS ON book 
BEGIN

    SELECT CASE WHEN NEW.fromTS >= NEW.toTS THEN
        RAISE(ABORT,"Incorect time")
    END;
    
    SELECT CASE WHEN
        (SELECT COUNT(*) FROM book 
         JOIN seat s on b.sid = s.id
         JOIN zone z on s.zid = z.id
         WHERE z.zone_group = 
            (SELECT zone_group FROM zone z JOIN seat s on z.id = s.zid WHERE s.id = NEW.sid LIMIT 1)
         AND (sid = NEW.sid OR uid = NEW.uid)
         AND fromTS < NEW.toTS
         AND toTS > NEW.fromTS
         AND id <> OLD.id ) > 0
    THEN
        RAISE(ABORT,"Overlapping time for this seat or user")
    END;
END;


COMMIT;