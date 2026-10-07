-- CreateEnum
CREATE TYPE "StatementSource" AS ENUM ('RULE', 'AI');

-- AlterTable
ALTER TABLE "AnalysisRun" ADD COLUMN     "precheck" JSONB;

-- AlterTable
ALTER TABLE "GeneratedStatement" ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "source" "StatementSource" NOT NULL DEFAULT 'AI';
