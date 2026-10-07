-- Release versions are immutable snapshots. Enforce it in the database so no
-- code path (application bug, manual query, future feature) can rewrite history.
-- Deletes are still allowed so that deleting a Release cascades.
CREATE FUNCTION prevent_release_version_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ReleaseVersion rows are immutable (id=%)', OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER release_version_immutable
  BEFORE UPDATE ON "ReleaseVersion"
  FOR EACH ROW EXECUTE FUNCTION prevent_release_version_update();
