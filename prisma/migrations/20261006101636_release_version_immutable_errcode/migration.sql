-- Raise with the default SQLSTATE (P0001 raise_exception). The original
-- restrict_violation code was reported by Prisma as a foreign key error,
-- which hid the real reason.
CREATE OR REPLACE FUNCTION prevent_release_version_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ReleaseVersion rows are immutable (id=%)', OLD.id;
END;
$$ LANGUAGE plpgsql;
