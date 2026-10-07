import { ReleasePackageSchema, type ReleasePackage } from "@/lib/schema/release-package";

/** A complete package that passes validation with no errors or warnings. */
export function validPackage(): ReleasePackage {
  return ReleasePackageSchema.parse({
    features: [
      {
        id: "FEAT-1",
        title: "Bulk export of invoices",
        description: "Admins can export up to 10,000 invoices as CSV from the billing page.",
        userGroups: ["Billing admins"],
      },
    ],
    bugFixes: [
      {
        id: "FIX-1",
        title: "Timezone shown incorrectly on receipts",
        description: "Receipts now render timestamps in the account's configured timezone.",
      },
    ],
    changedBehaviour: [
      {
        id: "CHG-1",
        title: "Session timeout reduced to 30 minutes",
        description: "Idle sessions now expire after 30 minutes instead of 8 hours.",
        breaking: true,
      },
    ],
    qaEvidence: [
      { id: "QA-1", title: "Export regression suite", result: "pass", coversItemIds: ["FEAT-1"] },
      { id: "QA-2", title: "Receipt rendering tests", result: "pass", coversItemIds: ["FIX-1"] },
      { id: "QA-3", title: "Session expiry e2e", result: "pass", coversItemIds: ["CHG-1"] },
    ],
    qaSummary: "All regression suites passed on staging build 4.2.0-rc1.",
    knownLimitations: [{ id: "LIM-1", text: "Exports above 10,000 rows are truncated." }],
    migrationNotes: [{ id: "MIG-1", text: "Set SESSION_TIMEOUT_MINUTES if a different timeout is required." }],
    affectedUserGroups: ["Billing admins", "All signed-in users"],
  });
}
