DROP MATERIALIZED VIEW IF EXISTS user_to_zone_roles;
DROP TABLE IF EXISTS seat_assign;
DROP TABLE IF EXISTS book;
DROP TABLE IF EXISTS seat;
DROP TABLE IF EXISTS zone_assign;
DROP TABLE IF EXISTS zone;
DROP TABLE IF EXISTS groups;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS blobs;

DROP TRIGGER IF EXISTS zone_assign_update on zone_assign;
DROP TRIGGER IF EXISTS groups_update on groups;
DROP TRIGGER IF EXISTS book_overlap_insert_trig on book;

DROP FUNCTION IF EXISTS update_user_to_zone_roles;
DROP FUNCTION IF EXISTS book_overlap_insert;

DROP TABLE IF EXISTS db_initialized;
