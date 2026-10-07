-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AnalysisRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "StatementKind" AS ENUM ('IMPACT', 'MISSING_INFO', 'UNSUPPORTED_CLAIM', 'RISK', 'TECH_SUMMARY', 'NONTECH_SUMMARY');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'EDITED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "Release" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "targetDate" TIMESTAMP(3),
    "status" "ReleaseStatus" NOT NULL DEFAULT 'DRAFT',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseVersion" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "package" JSONB NOT NULL,
    "itemHashes" JSONB NOT NULL,
    "packageHash" TEXT NOT NULL,
    "validation" JSONB NOT NULL,
    "changeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisRun" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "status" "AnalysisRunStatus" NOT NULL DEFAULT 'RUNNING',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "rawOutput" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedStatement" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "kind" "StatementKind" NOT NULL,
    "level" TEXT,
    "aiContent" TEXT NOT NULL,
    "editedContent" TEXT,
    "citations" JSONB NOT NULL,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinalBrief" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "statementIds" JSONB NOT NULL,
    "generatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinalBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppLog" (
    "id" TEXT NOT NULL,
    "level" "LogLevel" NOT NULL,
    "event" TEXT NOT NULL,
    "requestId" TEXT,
    "releaseId" TEXT,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseVersion_releaseId_versionNumber_key" ON "ReleaseVersion"("releaseId", "versionNumber");

-- CreateIndex
CREATE INDEX "AnalysisRun_versionId_idx" ON "AnalysisRun"("versionId");

-- CreateIndex
CREATE INDEX "GeneratedStatement_versionId_idx" ON "GeneratedStatement"("versionId");

-- CreateIndex
CREATE INDEX "GeneratedStatement_runId_idx" ON "GeneratedStatement"("runId");

-- CreateIndex
CREATE INDEX "FinalBrief_releaseId_idx" ON "FinalBrief"("releaseId");

-- CreateIndex
CREATE INDEX "AppLog_event_idx" ON "AppLog"("event");

-- CreateIndex
CREATE INDEX "AppLog_releaseId_idx" ON "AppLog"("releaseId");

-- CreateIndex
CREATE INDEX "AppLog_createdAt_idx" ON "AppLog"("createdAt");

-- AddForeignKey
ALTER TABLE "ReleaseVersion" ADD CONSTRAINT "ReleaseVersion_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ReleaseVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedStatement" ADD CONSTRAINT "GeneratedStatement_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedStatement" ADD CONSTRAINT "GeneratedStatement_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ReleaseVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalBrief" ADD CONSTRAINT "FinalBrief_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalBrief" ADD CONSTRAINT "FinalBrief_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ReleaseVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
