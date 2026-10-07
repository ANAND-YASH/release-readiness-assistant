// Realistic demo release with two versions. Version 2 modifies, removes and adds
// items so the Compare and Staleness features have meaningful differences:
//   modified:  FEAT-1, CHG-1, QA-1, QA-2, LIM-1, qaSummary
//   removed:   FEAT-3 (descoped), LIM-2, QA-6
//   added:     FIX-3, QA-7, MIG-3
//   unchanged: FEAT-2, FIX-1, FIX-2, CHG-2, QA-3, QA-4, QA-5, MIG-1, MIG-2
//
// Deliberate unsupported claims for the AI workflow demo:
//   CHG-2 "Fully tested" with no QA evidence at all        → caught by a deterministic rule
//   FEAT-1 (v2) "No performance impact" while QA-1 only covers export throughput → model judgement

import type { ReleasePackageInput } from "@/lib/schema/release-package";

export const SAMPLE_RELEASE = {
  name: "Billing Portal 4.2",
  product: "Billing Portal",
  targetDate: "2026-11-03",
} as const;

export const SAMPLE_V1: ReleasePackageInput = {
  features: [
    {
      id: "FEAT-1",
      title: "Bulk invoice export",
      description:
        "Billing admins can export up to 10,000 invoices at once as CSV from the Invoices page, filtered by date range and status.",
    },
    {
      id: "FEAT-2",
      title: "Saved payment methods for teams",
      description:
        "Team owners can save a shared card or bank account that any team member can use at checkout without re-entering details.",
    },
    {
      id: "FEAT-3",
      title: "Scheduled invoice reminder emails",
      description:
        "Customers with unpaid invoices receive automatic reminder emails 7, 14 and 30 days after the due date.",
    },
  ],
  bugFixes: [
    {
      id: "FIX-1",
      title: "Receipts showed the wrong timezone",
      description: "Receipt timestamps now render in the account's configured timezone instead of UTC.",
    },
    {
      id: "FIX-2",
      title: "Duplicate charge when a payment was retried",
      description:
        "Retrying a payment after a gateway timeout could charge the customer twice. Retries now reuse an idempotency key.",
    },
  ],
  changedBehaviour: [
    {
      id: "CHG-1",
      title: "Idle session timeout reduced to 30 minutes",
      description:
        "Signed-in sessions now expire after 30 minutes of inactivity instead of 8 hours, to meet the new security policy.",
      breaking: true,
    },
    {
      id: "CHG-2",
      title: "Redesigned invoice PDF layout",
      description:
        "Invoice PDFs use the new brand template; line items are grouped by product and tax is shown per line. Fully tested across all invoice templates.",
      breaking: false,
    },
  ],
  qaEvidence: [
    {
      id: "QA-1",
      title: "Export regression suite (10k invoices)",
      result: "pass",
      coversItemIds: ["FEAT-1"],
      notes: "Run on staging build 4.2.0-rc1; export of 10,000 invoices completed in 41s.",
    },
    {
      id: "QA-2",
      title: "Saved payment methods end-to-end tests",
      result: "partial",
      coversItemIds: ["FEAT-2"],
      notes: "Password-login teams pass. SSO-only teams not yet tested.",
    },
    {
      id: "QA-3",
      title: "Receipt rendering unit tests",
      result: "pass",
      coversItemIds: ["FIX-1"],
      notes: "Covers 12 timezones including DST transitions.",
    },
    {
      id: "QA-4",
      title: "Payment retry idempotency test",
      result: "pass",
      coversItemIds: ["FIX-2"],
      notes: "Simulated gateway timeouts; no duplicate charges across 500 retries.",
    },
    {
      id: "QA-5",
      title: "Session expiry end-to-end test",
      result: "pass",
      coversItemIds: ["CHG-1"],
      notes: "Verified expiry at 30 minutes and redirect to sign-in.",
    },
    {
      id: "QA-6",
      title: "Reminder email template review",
      result: "not_run",
      coversItemIds: ["FEAT-3"],
      notes: "Scheduled for after copy sign-off.",
    },
  ],
  qaSummary:
    "Regression suite passed on staging build 4.2.0-rc1. Saved payment methods are only partially verified (SSO teams untested). Reminder emails have not been tested. The invoice PDF redesign was reviewed visually by the design team but has no automated coverage.",
  knownLimitations: [
    { id: "LIM-1", text: "Exports larger than 10,000 invoices are truncated without a warning." },
    { id: "LIM-2", text: "Reminder emails are sent in English only." },
  ],
  migrationNotes: [
    {
      id: "MIG-1",
      text: "Set SESSION_TIMEOUT_MINUTES to override the new 30-minute idle timeout for self-hosted installs.",
    },
    {
      id: "MIG-2",
      text: "Run the billing:backfill-payment-method-owners job before enabling saved payment methods.",
    },
  ],
  affectedUserGroups: ["Billing admins", "Team owners", "All signed-in users", "Finance teams", "Support agents"],
};

export const SAMPLE_V2_CHANGE_NOTE =
  "Raise export limit to 50k with async delivery, descope reminder emails, add SSO test coverage and webhook retry fix.";

export const SAMPLE_V2: ReleasePackageInput = {
  ...SAMPLE_V1,
  features: [
    {
      id: "FEAT-1",
      title: "Bulk invoice export",
      description:
        "Billing admins can export up to 50,000 invoices as CSV. Exports over 5,000 rows run in the background and a download link is emailed when ready. No performance impact on the Invoices page.",
    },
    SAMPLE_V1.features![1],
  ],
  bugFixes: [
    ...SAMPLE_V1.bugFixes!,
    {
      id: "FIX-3",
      title: "Webhook events dropped after repeated failures",
      description:
        "Webhook deliveries that failed three times were silently discarded. They are now retried with backoff for up to 24 hours.",
    },
  ],
  changedBehaviour: [
    {
      id: "CHG-1",
      title: "Idle session timeout reduced to 30 minutes (configurable)",
      description:
        "Signed-in sessions now expire after 30 minutes of inactivity by default. Workspace admins can raise this to 4 hours in security settings.",
      breaking: true,
    },
    SAMPLE_V1.changedBehaviour![1],
  ],
  qaEvidence: [
    {
      id: "QA-1",
      title: "Export regression and load test (50k invoices)",
      result: "pass",
      coversItemIds: ["FEAT-1"],
      notes: "Staging build 4.2.0-rc2; 50,000-invoice async export completed in 6m12s and the email link worked.",
    },
    {
      id: "QA-2",
      title: "Saved payment methods end-to-end tests",
      result: "pass",
      coversItemIds: ["FEAT-2"],
      notes: "Password-login and SSO-only teams both pass.",
    },
    ...SAMPLE_V1.qaEvidence!.slice(2, 5),
    {
      id: "QA-7",
      title: "Webhook retry integration test",
      result: "pass",
      coversItemIds: ["FIX-3"],
      notes: "Endpoint returned 500 for 2 hours, then recovered; all events delivered once.",
    },
  ],
  qaSummary:
    "Regression and load tests passed on staging build 4.2.0-rc2, including SSO teams for saved payment methods. The invoice PDF redesign was reviewed visually by the design team but still has no automated coverage.",
  knownLimitations: [
    { id: "LIM-1", text: "Exports larger than 50,000 invoices are rejected; split by date range instead." },
  ],
  migrationNotes: [
    ...SAMPLE_V1.migrationNotes!,
    {
      id: "MIG-3",
      text: "Configure EXPORT_STORAGE_BUCKET so background exports can be stored for download (links expire after 7 days).",
    },
  ],
};
