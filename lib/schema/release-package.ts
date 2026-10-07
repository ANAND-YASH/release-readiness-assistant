// Release package: the structured input a user supplies for one release version.
//
// This schema checks *shape* only (types, enums, ID formats) so that incomplete
// drafts can still be saved as versions. Business rules such as "QA summary is
// required" live in lib/domain/validate-package.ts and produce errors/warnings.

import { z } from "zod";

/** Stable item ID prefixes, one per section. IDs are what citations point at. */
export const ITEM_ID_PREFIX = {
  features: "FEAT",
  bugFixes: "FIX",
  changedBehaviour: "CHG",
  qaEvidence: "QA",
  knownLimitations: "LIM",
  migrationNotes: "MIG",
} as const;

export type ItemSection = keyof typeof ITEM_ID_PREFIX;
export type ChangeSection = "features" | "bugFixes" | "changedBehaviour";

export const CHANGE_SECTIONS: readonly ChangeSection[] = ["features", "bugFixes", "changedBehaviour"];
export const ITEM_SECTIONS = Object.keys(ITEM_ID_PREFIX) as ItemSection[];

const itemId = (section: ItemSection) =>
  z
    .string()
    .regex(new RegExp(`^${ITEM_ID_PREFIX[section]}-\\d+$`), `ID must look like ${ITEM_ID_PREFIX[section]}-1`);

const text = (max: number) => z.string().trim().max(max);

const changeItemFields = {
  title: text(200),
  description: text(5000).default(""),
  userGroups: z.array(text(100)).default([]),
};

export const FeatureItemSchema = z.object({ id: itemId("features"), ...changeItemFields });
export const BugFixItemSchema = z.object({ id: itemId("bugFixes"), ...changeItemFields });
export const ChangedBehaviourItemSchema = z.object({
  id: itemId("changedBehaviour"),
  ...changeItemFields,
  breaking: z.boolean().default(false),
});

export const QA_RESULTS = ["pass", "fail", "partial", "not_run"] as const;

export const QaItemSchema = z.object({
  id: itemId("qaEvidence"),
  title: text(200),
  result: z.enum(QA_RESULTS),
  /** IDs of the change items (FEAT/FIX/CHG) this evidence covers. */
  coversItemIds: z.array(z.string()).default([]),
  notes: text(5000).default(""),
});

export const LimitationItemSchema = z.object({ id: itemId("knownLimitations"), text: text(2000) });
export const MigrationNoteItemSchema = z.object({ id: itemId("migrationNotes"), text: text(2000) });

export const ReleasePackageSchema = z.object({
  features: z.array(FeatureItemSchema).default([]),
  bugFixes: z.array(BugFixItemSchema).default([]),
  changedBehaviour: z.array(ChangedBehaviourItemSchema).default([]),
  qaEvidence: z.array(QaItemSchema).default([]),
  qaSummary: text(10000).default(""),
  knownLimitations: z.array(LimitationItemSchema).default([]),
  migrationNotes: z.array(MigrationNoteItemSchema).default([]),
  affectedUserGroups: z.array(text(100)).default([]),
  /** Explicit "none" declarations, so an intentionally empty section is distinguishable from a missing one. */
  noneDeclared: z
    .object({
      knownLimitations: z.boolean().default(false),
      migrationNotes: z.boolean().default(false),
    })
    .default({ knownLimitations: false, migrationNotes: false }),
});

export type FeatureItem = z.infer<typeof FeatureItemSchema>;
export type BugFixItem = z.infer<typeof BugFixItemSchema>;
export type ChangedBehaviourItem = z.infer<typeof ChangedBehaviourItemSchema>;
export type ChangeItem = FeatureItem | BugFixItem | ChangedBehaviourItem;
export type QaItem = z.infer<typeof QaItemSchema>;
export type QaResult = (typeof QA_RESULTS)[number];
export type LimitationItem = z.infer<typeof LimitationItemSchema>;
export type MigrationNoteItem = z.infer<typeof MigrationNoteItemSchema>;
export type ReleaseItem = ChangeItem | QaItem | LimitationItem | MigrationNoteItem;

export type ReleasePackage = z.infer<typeof ReleasePackageSchema>;
/** Shape accepted from clients before defaults are applied. */
export type ReleasePackageInput = z.input<typeof ReleasePackageSchema>;

export interface SectionedItem<S extends ItemSection = ItemSection, T extends ReleaseItem = ReleaseItem> {
  section: S;
  index: number;
  item: T;
}

/** Every identifiable item in the package, in section order. */
export function listItems(pkg: ReleasePackage): SectionedItem[] {
  return ITEM_SECTIONS.flatMap((section) =>
    (pkg[section] as ReleaseItem[]).map((item, index) => ({ section, index, item })),
  );
}

export function listChangeItems(pkg: ReleasePackage): SectionedItem<ChangeSection, ChangeItem>[] {
  return CHANGE_SECTIONS.flatMap((section) =>
    (pkg[section] as ChangeItem[]).map((item, index) => ({ section, index, item })),
  );
}
