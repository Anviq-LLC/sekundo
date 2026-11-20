// Copyright 2026 Anviq LLC. All rights reserved.
import { randomBytes } from "node:crypto";
import type { SpaceKeyRecord, SpaceKeyStore } from "@anviq/db";
import { ContentKeyRing, LocalKeyProvider } from "@anviq/db";
import { describe, expect, it } from "vitest";
import { createMemorySealer } from "./memory-sealer.js";

function memoryStore(): SpaceKeyStore {
  const rows: SpaceKeyRecord[] = [];
  return {
    async forSpace(spaceId) {
      return rows.filter((row) => row.spaceId === spaceId).sort((a, b) => a.version - b.version);
    },
    async byId(id) {
      return rows.find((row) => row.id === id);
    },
    async insert(record) {
      const existing = rows.find(
        (row) => row.spaceId === record.spaceId && row.version === record.version,
      );
      if (existing) return existing;
      rows.push(record);
      return record;
    },
    async sampleByMasterKey() {
      return [];
    },
    async rowContext() {
      return undefined;
    },
  };
}

const ring = (encryptWrites = true) =>
  new ContentKeyRing(new LocalKeyProvider([{ id: "a", key: randomBytes(32) }]), memoryStore(), {
    encryptWrites,
  });

const row = (id: string, scope = "space-1") => ({
  id,
  kind: "bot" as const,
  scope,
  owner: "bot-1",
});

describe("memory sealer", () => {
  it("seals and opens a value bound to its row and space", async () => {
    const sealer = createMemorySealer(ring());
    const sealed = await sealer.seal(row("m1"), "Allergic to kiwi");
    expect(sealed).toMatch(/^rkz1:/);
    expect(sealed).not.toContain("kiwi");
    expect(await sealer.open(row("m1"), sealed)).toBe("Allergic to kiwi");
    await expect(sealer.open(row("m2"), sealed)).rejects.toThrow();
    await expect(sealer.open({ ...row("m1"), owner: "bot-2" }, sealed)).rejects.toThrow();
    await expect(sealer.open(row("m1", "space-2"), sealed)).rejects.toThrow("another space");
  });

  it("returns plaintext rows as stored", async () => {
    const sealer = createMemorySealer(ring());
    expect(await sealer.open(row("m1"), "written before sealing")).toBe("written before sealing");
  });

  it("follows the ring's encryption switch", () => {
    expect(createMemorySealer(ring(true)).enabled).toBe(true);
    expect(createMemorySealer(ring(false)).enabled).toBe(false);
  });

  it("hashes and tokenises per space", async () => {
    const sealer = createMemorySealer(ring());
    expect(await sealer.hash("space-1", "same")).toBe(await sealer.hash("space-1", "same"));
    expect(await sealer.hash("space-1", "same")).not.toBe(await sealer.hash("space-2", "same"));
    const stored = await sealer.tokens("space-1", "kiwi smoothie");
    const [kiwi, smoothie] = await sealer.queryTokens("space-1", "kiwi smoothie");
    expect(stored).toEqual(expect.arrayContaining([...kiwi!, ...smoothie!]));
    const [other] = await sealer.queryTokens("space-2", "kiwi");
    expect(stored).not.toEqual(expect.arrayContaining(other!));
  });

  it("still finds rows sealed under an older key after a rotation", async () => {
    const keys = ring();
    const sealer = createMemorySealer(keys);
    const before = await sealer.tokens("space-1", "kiwi");
    await keys.rotate("space-1");
    const [kiwi] = await sealer.queryTokens("space-1", "kiwi");
    expect(kiwi).toEqual(expect.arrayContaining(before));
    expect(kiwi).toHaveLength(2);
  });
});
