// Copyright 2026 Anviq LLC. All rights reserved.
import { randomUUID } from "node:crypto";
import type { AdapterContext } from "@anviq/adapter-kit";
import { createDb, LocalKeyProvider, masterKeysFromEnv, runAsSystem } from "@anviq/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rewriteBuiltInMemory, SpaceMemoryProviderResolver } from "./memory-provider-factory.js";

const url = process.env.DATABASE_URL;
const describePostgres = process.env.VERIFY_DATABASE === "1" && url ? describe : describe.skip;

describePostgres("sealed built-in memory (PostgreSQL)", () => {
  const stamp = randomUUID();
  const userId = `${stamp}-user`;
  const organizationId = `${stamp}-org`;
  const spaceId = `${stamp}-space`;
  const botId = `${stamp}-bot`;
  const context: AdapterContext = {
    operationId: "memory-test",
    traceId: "memory-test",
    spaceId,
    userId,
    botId,
    signal: new AbortController().signal,
  };
  let db: ReturnType<typeof createDb>;
  let resolver: SpaceMemoryProviderResolver;

  const stored = async () =>
    (
      await db.pool.query(
        `SELECT content, sealed FROM anviq_memory.memories WHERE space_id = $1 ORDER BY created_at`,
        [spaceId],
      )
    ).rows as Array<{ content: string; sealed: boolean }>;

  beforeAll(() =>
    runAsSystem("test fixture", async () => {
      db = createDb(url!, {
        keyProvider: new LocalKeyProvider(masterKeysFromEnv()),
        encryptContent: true,
      });
      await db.prisma.user.create({
        data: { id: userId, name: "Memory", email: `${userId}@anviq.test`, emailVerified: false },
      });
      await db.prisma.organization.create({
        data: { id: organizationId, name: "Memory", slug: organizationId, createdAt: new Date() },
      });
      await db.prisma.space.create({ data: { id: spaceId, organizationId, name: "General" } });
      resolver = new SpaceMemoryProviderResolver(db.prisma, {} as never);
    }),
  );

  afterAll(async () => {
    if (!db) return;
    await runAsSystem("test cleanup", async () => {
      await resolver.purgeSpace(spaceId).catch(() => undefined);
      await db.prisma.organization.deleteMany({ where: { id: organizationId } });
      await db.prisma.user.deleteMany({ where: { id: userId } });
    });
    await db.prisma.$disconnect();
    await db.pool.end();
  });

  it("stores memory as ciphertext under the space key and recalls it", () =>
    runAsSystem("test", async () => {
      const configured = await resolver.resolve(spaceId);
      const provider = configured!.provider;
      const saved = await provider.save(
        {
          content: "Invoices are due on Friday",
          scope: "isolated",
          botId,
          source: { kind: "durable" },
        },
        context,
      );
      expect(saved.ok).toBe(true);

      const rows = await stored();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.sealed).toBe(true);
      expect(rows[0]!.content).toMatch(/^rkz1:/);
      expect(rows[0]!.content).not.toContain("Invoices");

      const found = await provider.recall(
        { query: "when are invoices due", scope: "isolated", botId, limit: 5 },
        context,
      );
      expect(found.ok && found.value.map((item) => item.memory)).toEqual([
        "Invoices are due on Friday",
      ]);
    }));

  it("seals memory written as plaintext and writes it back", () =>
    runAsSystem("test", async () => {
      await db.pool.query(
        `INSERT INTO anviq_memory.memories
           (id, kind, owner_id, space_id, bot_id, content, content_hash, origin)
         VALUES ($1, 'bot', $2, $3, $2, 'Plain note about olives', $4, 'bot')`,
        [`${stamp}-plain`, botId, spaceId, `${stamp}-hash`],
      );
      const sealed = await rewriteBuiltInMemory(db.prisma, "seal");
      expect(sealed?.updated).toBeGreaterThanOrEqual(1);
      expect((await stored()).every((row) => row.sealed)).toBe(true);

      const found = await (await resolver.resolve(spaceId))!.provider.recall(
        { query: "olives", scope: "isolated", botId, limit: 5 },
        context,
      );
      expect(found.ok && found.value.map((item) => item.memory)).toEqual([
        "Plain note about olives",
      ]);

      await rewriteBuiltInMemory(db.prisma, "unseal");
      expect((await stored()).some((row) => row.sealed)).toBe(false);
      await rewriteBuiltInMemory(db.prisma, "seal");
    }));
});
