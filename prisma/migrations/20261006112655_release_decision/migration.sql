-- AlterTable
ALTER TABLE "Release" ADD COLUMN     "decidedVersionNumber" INTEGER;

-- Human-only release decisions, enforced by the database:

-- 1. Releases are created undecided.
CREATE FUNCTION release_insert_draft() RETURNS trigger AS $$
BEGIN
  IF NEW."status" <> 'DRAFT' OR NEW."decidedBy" IS NOT NULL OR NEW."decidedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Releases must be created as DRAFT without a decision';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER release_insert_draft
  BEFORE INSERT ON "Release"
  FOR EACH ROW EXECUTE FUNCTION release_insert_draft();

-- 2. Moving to APPROVED / REJECTED must record a new human decision in the same update.
CREATE FUNCTION release_decision_recorded() RETURNS trigger AS $$
BEGIN
  IF NEW."status" IN ('APPROVED', 'REJECTED')
     AND (NEW."status" IS DISTINCT FROM OLD."status" OR NEW."decidedAt" IS DISTINCT FROM OLD."decidedAt")
     AND (NEW."decidedAt" IS NOT DISTINCT FROM OLD."decidedAt"
          OR NEW."decidedBy" IS NULL OR length(trim(NEW."decidedBy")) = 0
          OR NEW."decidedVersionNumber" IS NULL) THEN
    RAISE EXCEPTION 'A release decision must record a new decidedAt, decidedBy and decidedVersionNumber';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER release_decision_recorded
  BEFORE UPDATE ON "Release"
  FOR EACH ROW EXECUTE FUNCTION release_decision_recorded();

-- 3. A decided release always names who decided, when, and for which version.
ALTER TABLE "Release" ADD CONSTRAINT release_decided_by_human CHECK (
  "status" NOT IN ('APPROVED', 'REJECTED')
  OR ("decidedBy" IS NOT NULL AND length(trim("decidedBy")) > 0 AND "decidedAt" IS NOT NULL AND "decidedVersionNumber" IS NOT NULL)
);
