-- AlterTable
ALTER TABLE "GeneratedStatement" ADD COLUMN     "reviewNote" TEXT;

-- Human-only review, enforced by the database:

-- 1. Statements are always created unreviewed. No generation path (AI or rule)
--    can insert an APPROVED / EDITED / REJECTED statement.
CREATE FUNCTION generated_statement_insert_pending() RETURNS trigger AS $$
BEGIN
  IF NEW."reviewStatus" <> 'PENDING' OR NEW."reviewedBy" IS NOT NULL OR NEW."reviewedAt" IS NOT NULL
     OR NEW."editedContent" IS NOT NULL OR NEW."reviewNote" IS NOT NULL THEN
    RAISE EXCEPTION 'GeneratedStatement rows must be created as PENDING and unreviewed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER generated_statement_insert_pending
  BEFORE INSERT ON "GeneratedStatement"
  FOR EACH ROW EXECUTE FUNCTION generated_statement_insert_pending();

-- 2. Generated content and its provenance are immutable; reviews only touch the
--    review columns (editedContent, reviewStatus, reviewedBy, reviewedAt, reviewNote).
CREATE FUNCTION generated_statement_protect_generated() RETURNS trigger AS $$
BEGIN
  IF NEW."aiContent" IS DISTINCT FROM OLD."aiContent"
     OR NEW."citations" IS DISTINCT FROM OLD."citations"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."source" IS DISTINCT FROM OLD."source"
     OR NEW."level" IS DISTINCT FROM OLD."level"
     OR NEW."metadata" IS DISTINCT FROM OLD."metadata"
     OR NEW."runId" IS DISTINCT FROM OLD."runId"
     OR NEW."versionId" IS DISTINCT FROM OLD."versionId" THEN
    RAISE EXCEPTION 'Generated statement content is immutable (id=%)', OLD.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER generated_statement_protect_generated
  BEFORE UPDATE ON "GeneratedStatement"
  FOR EACH ROW EXECUTE FUNCTION generated_statement_protect_generated();

-- 3. A reviewed statement always names its reviewer and review time;
--    an edited statement always has non-empty edited content.
ALTER TABLE "GeneratedStatement" ADD CONSTRAINT generated_statement_reviewed_by_human CHECK (
  "reviewStatus" = 'PENDING' OR ("reviewedBy" IS NOT NULL AND length(trim("reviewedBy")) > 0 AND "reviewedAt" IS NOT NULL)
);
ALTER TABLE "GeneratedStatement" ADD CONSTRAINT generated_statement_edited_has_content CHECK (
  "reviewStatus" <> 'EDITED' OR ("editedContent" IS NOT NULL AND length(trim("editedContent")) > 0)
);
