-- Enforce that groups.group always references a user with account_type = 100.
-- Prevents the bug where a normal user could be added as a member of another user.

-- Remove any existing invalid rows that violate the new rule before the trigger is added.
DELETE FROM groups
WHERE EXISTS (
    SELECT 1 FROM users
    WHERE users.login = groups."group"
      AND users.account_type < 100
);

CREATE FUNCTION check_group_is_group()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM users
        WHERE login = NEW."group"
          AND account_type >= 100
    ) THEN
        RAISE EXCEPTION 'Only group accounts (account_type >= 100) can be used as a group';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER groups_account_type_check
BEFORE INSERT OR UPDATE ON groups
FOR EACH ROW
EXECUTE PROCEDURE check_group_is_group();
