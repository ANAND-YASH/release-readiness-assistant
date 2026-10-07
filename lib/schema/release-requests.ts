// Request body schemas for the release APIs. Shared by route handlers and forms.

import { z } from "zod";
import { ReleasePackageSchema } from "@/lib/schema/release-package";

const isoDate = z.iso.date("Use a valid date in the format YYYY-MM-DD");

export const ReleaseMetadataSchema = z.object({
  name: z.string().trim().min(1, "Release name is required").max(120),
  product: z.string().trim().min(1, "Product is required").max(120),
  targetDate: z.preprocess((value) => (value === "" ? null : value), isoDate.nullable().default(null)),
});

export const ChangeNoteSchema = z
  .string()
  .trim()
  .min(3, "Describe what changed in this version (at least 3 characters)")
  .max(500);

export const CreateReleaseBodySchema = ReleaseMetadataSchema.extend({
  package: ReleasePackageSchema,
});

export const CreateVersionBodySchema = z.object({
  package: ReleasePackageSchema,
  changeNote: ChangeNoteSchema,
  /** The version the edit started from; must still be the latest (optimistic concurrency). */
  baseVersionNumber: z.number().int().positive(),
});

export const ValidateBodySchema = z.object({ package: ReleasePackageSchema });

export type ReleaseMetadataInput = z.input<typeof ReleaseMetadataSchema>;
export type CreateReleaseBody = z.output<typeof CreateReleaseBodySchema>;
export type CreateVersionBody = z.output<typeof CreateVersionBodySchema>;
