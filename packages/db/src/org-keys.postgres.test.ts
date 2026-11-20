// Copyright 2026 Anviq LLC. All rights reserved.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./database/client.js";
import { runAsSystem } from "./database/row-security.js";
import {
  clearOrganizationKey,
  organizationKeys,
  PgOrgKeyLookup,
  setOrganizationKey,
} from "./org-keys.js";

const url = process.env.DATABASE_URL;
const describePostgres = process.env.VERIFY_DATABASE === "1" && url ? describe : describe.skip;

const arn = (name: string) => `arn:aws:kms:eu-central-1:111111111111:key/${name}`;

describePostgres("organization keys (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const organizationId = `okey-org-${suffix}`;
  const spaceId = `okey-space-${suffix}`;
  let db: ReturnType<typeof createDb>;

  beforeAll(() =>
    runAsSystem("test fixture", async () => {
      db = createDb(url!, { encryptContent: false });
      await db.prisma.organization.create({
        data: { id: organizationId, name: "Keys", slug: organizationId, createdAt: new Date() },
      });
      await db.prisma.space.create({ data: { id: spaceId, organizationId, name: "General" } });
    }),
  );

  afterAll(async () => {
    if (!db) return;
    await runAsSystem("test cleanup", () =>
      db.prisma.organization.deleteMany({ where: { id: organizationId } }),
    );
    await db.prisma.$disconnect();
    await db.pool.end();
  });

  it("finds an organization's key by space and keeps earlier keys when it changes", () =>
    runAsSystem("test", async () => {
      const lookup = new PgOrgKeyLookup(db.pool);
      expect(await lookup.forSpace(spaceId)).toBeUndefined();

      await setOrganizationKey(db.prisma, organizationId, arn("one"));
      expect(await lookup.forSpace(spaceId)).toEqual({
        organizationId,
        keyArn: arn("one"),
        previousKeyArns: [],
      });

      await setOrganizationKey(db.prisma, organizationId, arn("two"));
      expect(await lookup.forSpace(spaceId)).toMatchObject({
        keyArn: arn("two"),
        previousKeyArns: [arn("one")],
      });
      expect((await organizationKeys(db.prisma)).map((row) => row.organizationId)).toContain(
        organizationId,
      );
    }));

  it("goes back to the deployment key and removes the setting with the organization", () =>
    runAsSystem("test", async () => {
      expect(await clearOrganizationKey(db.prisma, organizationId)).toBe(true);
      expect(await new PgOrgKeyLookup(db.pool).forSpace(spaceId)).toMatchObject({
        keyArn: "",
        previousKeyArns: expect.arrayContaining([arn("one"), arn("two")]),
      });

      await db.prisma.organization.delete({ where: { id: organizationId } });
      expect(await new PgOrgKeyLookup(db.pool).forSpace(spaceId)).toBeUndefined();
      expect(await clearOrganizationKey(db.prisma, organizationId)).toBe(false);
    }));
});
