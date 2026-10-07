// Readiness of a release's current version for the final brief and the human
// release decision. One read model shared by the brief API, the decision API and
// the pages, so they can never disagree about what is blocking.

import { getDb } from "@/lib/db";
import {
  approvalBlockers,
  assembleBrief,
  briefBlockers,
  type AssembledBrief,
  type Blocker,
  type BriefStatement,
  type CitableItem,
} from "@/lib/domain/brief";
import { summarizeReview, type ReviewSummary } from "@/lib/domain/review";
import { validatePackage, type ValidationResult } from "@/lib/domain/validate-package";
import { listChangeItems, listItems, type ReleasePackage } from "@/lib/schema/release-package";
import { getReviewData, type ReviewData } from "@/lib/services/analysis";
import { getRelease, getVersion, type ReleaseDetail, type VersionDetail } from "@/lib/services/releases";

export interface FinalBriefDto {
  id: string;
  versionNumber: number;
  markdown: string;
  statementIds: string[];
  generatedBy: string;
  createdAt: string;
}

export interface ReleaseReadiness {
  release: ReleaseDetail;
  current: VersionDetail;
  validation: ValidationResult;
  review: ReviewData;
  reviewSummary: ReviewSummary;
  statements: BriefStatement[];
  items: Record<string, CitableItem>;
  briefBlockers: Blocker[];
  /** What the brief would be right now (null while blocked). */
  assembled: AssembledBrief | null;
  /** Latest brief generated for the current version. */
  latestBrief: FinalBriefDto | null;
  briefUpToDate: boolean;
  approvalBlockers: Blocker[];
}

const SECTION_LABEL: Record<string, string> = {
  features: "Feature",
  bugFixes: "Bug fix",
  changedBehaviour: "Changed behaviour",
  qaEvidence: "QA evidence",
  knownLimitations: "Known limitation",
  migrationNotes: "Migration note",
};

function citableItems(pkg: ReleasePackage): Record<string, CitableItem> {
  return Object.fromEntries(
    listItems(pkg).map(({ section, item }) => [
      item.id,
      { section: SECTION_LABEL[section], label: "title" in item ? item.title : item.text },
    ]),
  );
}

export async function getReleaseReadiness(releaseId: string): Promise<ReleaseReadiness | null> {
  const release = await getRelease(releaseId);
  if (!release || !release.latestVersion) return null;
  const current = await getVersion(releaseId, release.latestVersion.versionNumber);
  const review = current ? await getReviewData(releaseId, current.versionNumber) : null;
  if (!current || !review) return null;

  const source = review.carriedFrom ? await getVersion(releaseId, review.carriedFrom) : null;
  const items = { ...(source ? citableItems(source.package) : {}), ...citableItems(current.package) };
  const validation = validatePackage(current.package);

  const statements: BriefStatement[] = review.statements.map((s) => ({
    id: s.id,
    kind: s.kind,
    reviewStatus: s.reviewStatus,
    content: s.content,
    citations: s.citations,
    stale: s.stale.stale,
    order: s.order,
  }));
  const analysedIds = new Set(source ? listChangeItems(source.package).map(({ item }) => item.id) : []);
  const unanalysedItemIds = source
    ? listChangeItems(current.package).map(({ item }) => item.id).filter((id) => !analysedIds.has(id))
    : [];

  const blockers = briefBlockers({
    versionNumber: current.versionNumber,
    validationErrorCount: validation.errors.length,
    hasAnalysis: review.statementsRun !== null,
    unanalysedItemIds,
    statements,
  });
  const assembled =
    blockers.length === 0 ? assembleBrief(release, current.versionNumber, statements, items) : null;

  const row = await getDb().finalBrief.findFirst({
    where: { releaseId, versionId: current.id },
    orderBy: { createdAt: "desc" },
  });
  const latestBrief: FinalBriefDto | null = row
    ? {
        id: row.id,
        versionNumber: current.versionNumber,
        markdown: row.markdown,
        statementIds: row.statementIds as string[],
        generatedBy: row.generatedBy,
        createdAt: row.createdAt.toISOString(),
      }
    : null;

  return {
    release,
    current,
    validation,
    review,
    reviewSummary: summarizeReview(statements.map((s) => ({ reviewStatus: s.reviewStatus, stale: s.stale }))),
    statements,
    items,
    briefBlockers: blockers,
    assembled,
    latestBrief,
    briefUpToDate: Boolean(latestBrief && assembled && latestBrief.markdown === assembled.markdown),
    approvalBlockers: approvalBlockers(blockers, latestBrief, assembled?.markdown ?? null),
  };
}
