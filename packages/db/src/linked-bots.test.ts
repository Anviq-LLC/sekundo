import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./database/client.js";
import { withLinkedBotHome, withoutLinkedBots } from "./linked-bots.js";

describe("withoutLinkedBots", () => {
  it("leaves link rows out of reads, counts and bulk writes", () => {
    for (const operation of [
      "findFirst",
      "findMany",
      "findUnique",
      "count",
      "aggregate",
      "groupBy",
      "updateMany",
      "deleteMany",
    ]) {
      expect(
        withoutLinkedBots(operation, { where: { spaceId: "s", userId: "u" } }),
        operation,
      ).toEqual({ where: { spaceId: "s", userId: "u", linkedFromBotId: null } });
    }
  });

  it("filters a query that has no where at all", () => {
    expect(withoutLinkedBots("findMany", undefined)).toEqual({ where: { linkedFromBotId: null } });
    expect(withoutLinkedBots("count", {})).toEqual({ where: { linkedFromBotId: null } });
  });

  it("keeps the other arguments", () => {
    expect(
      withoutLinkedBots("findMany", { where: { id: "b" }, select: { id: true }, take: 3 }),
    ).toEqual({ where: { id: "b", linkedFromBotId: null }, select: { id: true }, take: 3 });
  });

  it("lets a query that names linkedFromBotId, even as undefined, see link rows", () => {
    const named = { where: { id: "b", linkedFromBotId: "original" } };
    expect(withoutLinkedBots("findFirst", named)).toBe(named);
    const any = { where: { id: "b", linkedFromBotId: undefined } };
    expect(withoutLinkedBots("findFirst", any)).toBe(any);
  });

  it("does not touch single-row writes or creates", () => {
    const args = { where: { id: "b" }, data: { name: "n" } };
    for (const operation of ["update", "create", "delete", "upsert", "createMany"])
      expect(withoutLinkedBots(operation, args), operation).toBe(args);
  });
});

describe("withLinkedBotHome", () => {
  const link = {
    id: "link",
    userId: "owner",
    linkedFromBotId: "home",
    instructions: "",
    modelProvider: null,
    modelId: null,
    thinkingLevel: null,
    disabledBuiltinTools: [] as string[],
  };
  const prismaWith = (home: unknown) =>
    ({ bot: { findFirst: vi.fn(async () => home) } }) as unknown as PrismaClient;

  it("answers with the persona and model of the bot behind the link", async () => {
    const prisma = prismaWith({
      instructions: "Be brief.",
      modelProvider: "p",
      modelId: "m",
      thinkingLevel: "low",
      disabledBuiltinTools: ["shell"],
    });
    expect(await withLinkedBotHome(prisma, link)).toMatchObject({
      id: "link",
      instructions: "Be brief.",
      modelProvider: "p",
      modelId: "m",
      thinkingLevel: "low",
      disabledBuiltinTools: ["shell"],
    });
  });

  it("reads the original for its owner only, while it is not archived", async () => {
    const prisma = prismaWith({
      instructions: "",
      modelProvider: null,
      modelId: null,
      thinkingLevel: null,
      disabledBuiltinTools: [],
    });
    await withLinkedBotHome(prisma, link);
    expect(prisma.bot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "home", userId: "owner", archivedAt: null, linkedFromBotId: null },
      }),
    );
  });

  it("fails the run when the bot behind the link is gone", async () => {
    await expect(withLinkedBotHome(prismaWith(null), link)).rejects.toThrow("no longer available");
  });

  it("returns an ordinary bot as it is, without reading anything", async () => {
    const prisma = prismaWith(null);
    const bot = { ...link, linkedFromBotId: null };
    expect(await withLinkedBotHome(prisma, bot)).toBe(bot);
    expect(prisma.bot.findFirst).not.toHaveBeenCalled();
  });
});
