BEGIN TRANSACTION;

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS book;
DROP TABLE IF EXISTS seat;
DROP TABLE IF EXISTS zone;
DROP TABLE IF EXISTS user;

CREATE TABLE user (
    id integer primary key asc, 
    username text unique not null, 
    password text,
    role integer
    );

CREATE TABLE zone (
    id integer primary key asc, 
    name text,
    image text
    );

CREATE TABLE seat (
    id integer primary key asc, 
    zid integer,
    name text,
    x integer,
    y integer,
    FOREIGN KEY (zid) REFERENCES zone(id)
    );

CREATE TABLE book (
    id integer primary key asc, 
    uid integer,
    zid integer,
    sid integer,
    fromTS integer,
    toTS integer,
    comment text,
    FOREIGN KEY (uid) REFERENCES user(id)
    FOREIGN KEY (zid) REFERENCES zone(id)
    FOREIGN KEY (sid) REFERENCES seat(id)
    );

COMMIT;