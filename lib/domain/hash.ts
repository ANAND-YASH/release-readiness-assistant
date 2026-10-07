// Stable content hashing. Item hashes are stored on each version and later used
// to diff versions and to detect generated statements whose cited items changed.

import { createHash } from "node:crypto";
import { listItems, type ReleaseItem, type ReleasePackage } from "@/lib/schema/release-package";

/**
 * JSON serialization with recursively sorted object keys, so logically equal
 * values always produce the same string. Array order is preserved (it is
 * meaningful). Follows JSON semantics for `undefined`: omitted from objects,
 * `null` inside arrays.
 */
export function stableStringify(value: unknown): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(`Cannot hash non-finite number: ${value}`);
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new TypeError(`Cannot hash value of type ${typeof value}`);
  }

  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? "null" : stableStringify(v))).join(",")}]`;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError("Cannot hash non-plain object");
  }

  const entries = Object.keys(value)
    .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(",")}}`;
}

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Hash of an item's content. The ID is excluded: it is the item's identity, not its content. */
export function hashItem(item: ReleaseItem): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, ...content } = item;
  return sha256(stableStringify(content));
}

export type ItemHashes = Record<string, string>;

export function computeItemHashes(pkg: ReleasePackage): ItemHashes {
  const hashes: ItemHashes = {};
  for (const { item } of listItems(pkg)) hashes[item.id] = hashItem(item);
  return hashes;
}

export function hashPackage(pkg: ReleasePackage): string {
  return sha256(stableStringify(pkg));
}
