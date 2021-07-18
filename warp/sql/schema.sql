DROP TABLE IF EXISTS user;

CREATE TABLE user (
    id integer primary key asc, 
    username text unique not null, 
    password text,
    role integer
    );

