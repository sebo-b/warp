ALTER TABLE seat_assign DROP CONSTRAINT seat_assign_pkey;
ALTER TABLE seat_assign ALTER COLUMN login DROP NOT NULL;
CREATE UNIQUE INDEX seat_assign_uq          ON seat_assign(sid, login) WHERE login IS NOT NULL;
CREATE UNIQUE INDEX seat_assign_everyone_uq ON seat_assign(sid)         WHERE login IS NULL;
