BEGIN TRANSACTION;

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS book;
DROP TABLE IF EXISTS seat;
DROP TABLE IF EXISTS zone;
DROP TABLE IF EXISTS user;

CREATE TABLE user (
    id integer PRIMARY KEY ASC, 
    username text UNIQUE NOT NULL, 
    password text,
    role integer NOT NULL
    );

CREATE TABLE zone (
    id integer PRIMARY KEY ASC, 
    name text NOT NULL,
    image text
    );

CREATE TABLE seat (
    id integer PRIMARY KEY ASC, 
    zid integer,
    name text NOT NULL,
    x integer NOT NULL,
    y integer NOT NULL,
    FOREIGN KEY (zid) REFERENCES zone(id)
    );

CREATE TABLE book (
    id integer primary key asc, 
    uid integer,
    sid integer,
    fromTS integer,
    toTS integer,
    comment text,
    FOREIGN KEY (uid) REFERENCES user(id)
    FOREIGN KEY (sid) REFERENCES seat(id)
    );

COMMIT;