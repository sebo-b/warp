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
    enabled boolean NOT NULL DEFAULT TRUE,
    FOREIGN KEY (zid) REFERENCES zone(id)
    );

CREATE TABLE assign (
    sid integer NOT NULL,
    uid integer NOT NULL,
    PRIMARY KEY (sid,uid),
    FOREIGN KEY (sid) REFERENCES seat(id),
    FOREIGN KEY (uid) REFERENCES user(id)
    );

CREATE INDEX seat_zid
ON seat(zid);

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

CREATE INDEX book_uid
ON book(uid);

CREATE INDEX book_sid
ON book(sid);

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
        (SELECT CASE WHEN COUNT(*) > 0 AND SUM(CASE WHEN uid = NEW.uid THEN 1 ELSE 0 END) = 0 THEN TRUE ELSE FALSE END 
        FROM assign WHERE sid = NEW.sid) > 0
    THEN
        RAISE(ABORT,"Seat is assigned to another person")
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

    RAISE(ABORT,"Not implemented")
--    SELECT CASE WHEN NEW.fromTS >= NEW.toTS THEN
--        RAISE(ABORT,"Incorect time")
--    END;
--    
--    SELECT CASE WHEN
--        (SELECT COUNT(*) FROM book 
--         JOIN seat s on b.sid = s.id
--         JOIN zone z on s.zid = z.id
--         WHERE z.zone_group = 
--            (SELECT zone_group FROM zone z JOIN seat s on z.id = s.zid WHERE s.id = NEW.sid LIMIT 1)
--         AND (sid = NEW.sid OR uid = NEW.uid)
--         AND fromTS < NEW.toTS
--         AND toTS > NEW.fromTS
--         AND id <> OLD.id ) > 0
--    THEN
--        RAISE(ABORT,"Overlapping time for this seat or user")
--    END;
END;


COMMIT;