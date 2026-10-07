import { describe, expect, it } from "vitest";
import { computeItemHashes, hashItem, hashPackage, stableStringify } from "@/lib/domain/hash";
import { validPackage } from "../fixtures/release-package";

describe("stableStringify", () => {
  it("is independent of object key order, at any depth", () => {
    const a = { b: 1, a: { y: [1, { q: 1, p: 2 }], x: "s" } };
    const b = { a: { x: "s", y: [1, { p: 2, q: 1 }] }, b: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(stableStringify(a)).toBe('{"a":{"x":"s","y":[1,{"p":2,"q":1}]},"b":1}');
  });

  it("preserves array order", () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it("follows JSON semantics for undefined", () => {
    expect(stableStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(stableStringify([undefined])).toBe("[null]");
  });

  it("distinguishes values that naive concatenation would conflate", () => {
    expect(stableStringify({ a: "1", b: "" })).not.toBe(stableStringify({ a: "", b: "1" }));
    expect(stableStringify("1")).not.toBe(stableStringify(1));
  });

  it.each([NaN, Infinity, () => 1, BigInt(1), Symbol("x"), new Date(0), new Map()])("rejects unhashable value %s", (value) => {
    expect(() => stableStringify(value)).toThrow(TypeError);
  });
});

describe("hashItem", () => {
  it("produces a 64-char hex sha256", () => {
    expect(hashItem(validPackage().features[0])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable across key order and object identity", () => {
    const item = validPackage().features[0];
    const reordered = { userGroups: item.userGroups, description: item.description, title: item.title, id: item.id };
    expect(hashItem(reordered)).toBe(hashItem(item));
  });

  it("changes when any content field changes", () => {
    const base = validPackage().changedBehaviour[0];
    const baseHash = hashItem(base);
    expect(hashItem({ ...base, title: base.title + "!" })).not.toBe(baseHash);
    expect(hashItem({ ...base, description: base.description + " " })).not.toBe(baseHash);
    expect(hashItem({ ...base, breaking: !base.breaking })).not.toBe(baseHash);
    expect(hashItem({ ...base, userGroups: ["New group"] })).not.toBe(baseHash);
  });

  it("ignores the item ID (identity, not content)", () => {
    const item = validPackage().features[0];
    expect(hashItem({ ...item, id: "FEAT-2" })).toBe(hashItem(item));
  });
});

describe("computeItemHashes", () => {
  it("hashes every identifiable item in every section", () => {
    const hashes = computeItemHashes(validPackage());
    expect(Object.keys(hashes).sort()).toEqual(
      ["CHG-1", "FEAT-1", "FIX-1", "LIM-1", "MIG-1", "QA-1", "QA-2", "QA-3"].sort(),
    );
  });

  it("changes only the hash of the edited item", () => {
    const before = computeItemHashes(validPackage());
    const edited = validPackage();
    edited.qaEvidence[1].result = "fail";
    const after = computeItemHashes(edited);

    const changed = Object.keys(before).filter((id) => before[id] !== after[id]);
    expect(changed).toEqual(["QA-2"]);
  });
});

describe("hashPackage", () => {
  it("is deterministic and sensitive to non-item fields", () => {
    const pkg = validPackage();
    expect(hashPackage(pkg)).toBe(hashPackage(structuredClone(pkg)));
    expect(hashPackage({ ...pkg, qaSummary: "Different" })).not.toBe(hashPackage(pkg));
  });
});
