// Copyright 2026 Anviq LLC. All rights reserved.
import { linkBotIntoSpace, runAsTenant } from "@anviq/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Person } from "./team-harness.js";
import { createTeamHarness } from "./team-harness.js";

const hasDb = process.env.VERIFY_DATABASE === "1" && Boolean(process.env.DATABASE_URL);
const describeWithDatabase = hasDb ? describe : describe.skip;

/**
 * A person's own bot takes part in a team space through a link row. The row shows the team the
 * bot's name and look and nothing else, only its owner can create one, and the original bot stays
 * out of reach of everyone in the team, its owner included while they are working in the team.
 */
describeWithDatabase("linked bots", () => {
  let harness: Awaited<ReturnType<typeof createTeamHarness>>["harness"];
  let ana: Person;
  let ben: Person;
  let anaPersonalSpaceId: string;
  let benPersonalSpaceId: string;
  let originalId: string;
  let secret: string;
  let mixedGroupId: string;
  let linkId: string;

  const personalSpaceOf = async (person: Person) => {
    const memberships = await harness.db.spaceMember.findMany({
      where: { userId: person.userId },
      select: { spaceId: true },
    });
    const space = memberships.find((row) => row.spaceId !== harness.teamSpaceId);
    if (!space) throw new Error("no personal space");
    return space.spaceId;
  };

  beforeAll(async () => {
    const created = await createTeamHarness("linked-bots", ["cy", "ana", "ben"]);
    harness = created.harness;
    [, ana, ben] = created.people as [Person, Person, Person];
    anaPersonalSpaceId = await personalSpaceOf(ana);
    benPersonalSpaceId = await personalSpaceOf(ben);
    secret = `secret-instructions-${harness.stamp}`;
    const original = await harness.db.bot.create({
      data: {
        spaceId: anaPersonalSpaceId,
        userId: ana.userId,
        name: "Ana Original",
        description: "Reads papers",
        instructions: secret,
        color: "#5b8def",
      },
      select: { id: true },
    });
    originalId = original.id;
  }, 120_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it("creates a team row that carries the presentation and never the instructions", async () => {
    const link = await linkBotIntoSpace(
      harness.handles.prisma,
      { userId: ana.userId },
      { botId: originalId, spaceId: harness.teamSpaceId },
    );
    expect(link.created).toBe(true);
    const row = await harness.db.bot.findFirstOrThrow({
      where: { id: link.id, linkedFromBotId: originalId },
    });
    expect(row).toMatchObject({
      spaceId: harness.teamSpaceId,
      userId: ana.userId,
      name: "Ana Original",
      description: "",
      instructions: "",
      color: "#5b8def",
    });
    for (const person of [ana, ben]) {
      const response = await harness.call(person, "bots/list", {});
      const text = await response.text();
      expect(text, "bots/list leaked").not.toContain(secret);
      expect(text, "a link row is not a personal bot").not.toContain(link.id);
    }
  });

  it("is idempotent, so linking again returns the same row", async () => {
    const again = await linkBotIntoSpace(
      harness.handles.prisma,
      { userId: ana.userId },
      { botId: originalId, spaceId: harness.teamSpaceId },
    );
    expect(again.created).toBe(false);
    const count = await harness.db.bot.count({
      where: { spaceId: harness.teamSpaceId, linkedFromBotId: originalId, archivedAt: null },
    });
    expect(count).toBe(1);
  });

  it("keeps link rows out of ordinary bot queries unless one names the link", async () => {
    const ordinary = await harness.db.bot.findMany({
      where: { spaceId: harness.teamSpaceId, userId: ana.userId },
    });
    expect(ordinary).toEqual([]);
    expect(
      await harness.db.bot.count({ where: { spaceId: harness.teamSpaceId, userId: ana.userId } }),
    ).toBe(0);
    const named = await harness.db.bot.findMany({
      where: { spaceId: harness.teamSpaceId, userId: ana.userId, linkedFromBotId: { not: null } },
    });
    expect(named).toHaveLength(1);
  });

  it("keeps link rows out of unique lookups as well", async () => {
    const link = await harness.db.bot.findFirstOrThrow({
      where: { spaceId: harness.teamSpaceId, linkedFromBotId: originalId },
      select: { id: true },
    });
    expect(await harness.db.bot.findUnique({ where: { id: link.id } })).toBeNull();
    await expect(harness.db.bot.findUniqueOrThrow({ where: { id: link.id } })).rejects.toThrow();
    const named = await harness.db.bot.findUnique({
      where: { id: link.id, linkedFromBotId: originalId },
    });
    expect(named).not.toBeNull();
  });

  it("leaves the original unreadable from the team space, even to its owner", async () => {
    for (const person of [ana, ben]) {
      const rows = await runAsTenant({ spaceId: harness.teamSpaceId, userId: person.userId }, () =>
        harness.handles.prisma.bot.findMany({
          where: { id: originalId, linkedFromBotId: undefined },
        }),
      );
      expect(rows, `${person.email} read the original`).toEqual([]);
    }
  });

  it("lets only the owner link a bot", async () => {
    await expect(
      linkBotIntoSpace(
        harness.handles.prisma,
        { userId: ben.userId },
        { botId: originalId, spaceId: harness.teamSpaceId },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses to link into a space the owner does not belong to", async () => {
    await expect(
      linkBotIntoSpace(
        harness.handles.prisma,
        { userId: ana.userId },
        { botId: originalId, spaceId: benPersonalSpaceId },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is refused by the database when a row points at someone else's bot", async () => {
    await expect(
      harness.db.bot.create({
        data: {
          spaceId: harness.teamSpaceId,
          userId: ben.userId,
          linkedFromBotId: originalId,
          name: "Not Ben's",
          color: "#000000",
        },
      }),
    ).rejects.toThrow(/linked bot must point at its owner/);
  });

  it("is refused by the database when the owner is not in the space", async () => {
    await expect(
      harness.db.bot.create({
        data: {
          spaceId: benPersonalSpaceId,
          userId: ana.userId,
          linkedFromBotId: originalId,
          name: "Nowhere",
          color: "#000000",
        },
      }),
    ).rejects.toThrow(/owner must belong to the space/);
  });

  it("offers a person only their own other bots, with the link once there is one", async () => {
    const anaList = await harness.ok<Array<{ id: string; linkedBotId: string | null }>>(
      ana,
      "bots/linkable",
      {},
    );
    expect(anaList.map((bot) => bot.id)).toContain(originalId);
    const benList = await harness.ok<Array<{ id: string }>>(ben, "bots/linkable", {});
    expect(benList.map((bot) => bot.id)).not.toContain(originalId);
    expect(JSON.stringify(benList)).not.toContain(secret);
  });

  it("puts a personal bot into a team group through its link", async () => {
    const teamBot = await harness.ok<{ id: string }>(ana, "bots/create", {
      name: "Ana Team Bot",
      title: "",
      description: "",
      instructions: "",
      notifyOnFinish: false,
    });
    const group = await harness.ok<{ id: string; members: Array<{ botId: string }> }>(
      ana,
      "groups/create",
      { name: "Mixed", botIds: [teamBot.id, originalId] },
    );
    const link = await harness.db.bot.findFirstOrThrow({
      where: { spaceId: harness.teamSpaceId, linkedFromBotId: originalId },
    });
    expect(group.members.map((member) => member.botId).sort()).toEqual(
      [teamBot.id, link.id].sort(),
    );
    expect(JSON.stringify(group)).not.toContain(secret);
    mixedGroupId = group.id;
    linkId = link.id;
  });

  it("answers in the team group as the linked bot", async () => {
    const sent = await harness.ok<{ runId: string; runIds?: string[] }>(ana, "threads/send", {
      groupId: mixedGroupId,
      text: "Ana Original, please say hello",
      mentions: [linkId],
    });
    const runIds = sent.runIds ?? [sent.runId];
    const runs = await harness.db.run.findMany({
      where: { id: { in: runIds }, botId: linkId },
      select: { id: true, spaceId: true, userId: true },
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ spaceId: harness.teamSpaceId, userId: ana.userId });
    const runId = runs[0]!.id;
    const finished = await vi.waitFor(
      async () => {
        const run = await harness.db.run.findUniqueOrThrow({
          where: { id: runId },
          select: { status: true, error: true },
        });
        expect(["completed", "failed", "cancelled"]).toContain(run.status);
        return run;
      },
      { timeout: 20_000, interval: 100 },
    );
    expect(finished).toEqual({ status: "completed", error: null });
    const reply = await harness.db.message.findFirst({
      where: { role: "bot", botId: linkId, thread: { groupId: mixedGroupId } },
      select: { id: true },
    });
    expect(reply, "the linked bot's reply").not.toBeNull();
    const thread = await harness.db.message.findMany({
      where: { thread: { groupId: mixedGroupId } },
      select: { blocks: true },
    });
    expect(
      JSON.stringify(thread),
      "the original's instructions reached the team thread",
    ).not.toContain(secret);
  }, 60_000);

  it("refuses to put someone else's bot into a group", async () => {
    const anaBot = await harness.ok<{ id: string }>(ana, "bots/create", {
      name: "Ana Another",
      title: "",
      description: "",
      instructions: "",
      notifyOnFinish: false,
    });
    const response = await harness.call(ben, "groups/create", {
      name: "Borrowed",
      botIds: [anaBot.id, originalId],
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(
      await harness.db.bot.count({
        where: { spaceId: harness.teamSpaceId, userId: ben.userId, linkedFromBotId: { not: null } },
      }),
    ).toBe(0);
  });

  it("takes a leaving person's links out of the team's groups without touching their bots", async () => {
    const benOriginal = await harness.db.bot.create({
      data: {
        spaceId: benPersonalSpaceId,
        userId: ben.userId,
        name: "Ben Original",
        instructions: `ben-${secret}`,
        color: "#22aa66",
      },
      select: { id: true },
    });
    const benTeamBot = await harness.ok<{ id: string }>(ben, "bots/create", {
      name: "Ben Team Bot",
      title: "",
      description: "",
      instructions: "",
      notifyOnFinish: false,
    });
    const group = await harness.ok<{ id: string }>(ben, "groups/create", {
      name: "Ben mixed",
      botIds: [benTeamBot.id, benOriginal.id],
    });
    const benLink = await harness.db.bot.findFirstOrThrow({
      where: { spaceId: harness.teamSpaceId, linkedFromBotId: benOriginal.id },
      select: { id: true },
    });
    // Ben's own team bot is archived; his link does not count as an active bot.
    await harness.db.bot.update({ where: { id: benTeamBot.id }, data: { archivedAt: new Date() } });
    const organizationId = (
      await harness.db.space.findFirstOrThrow({
        where: { id: harness.teamSpaceId },
        select: { organizationId: true },
      })
    ).organizationId;
    await harness.ok(ben, "organizations/leave", { organizationId });
    const link = await harness.db.bot.findFirstOrThrow({
      where: { id: benLink.id, linkedFromBotId: benOriginal.id },
      select: { archivedAt: true },
    });
    expect(link.archivedAt).not.toBeNull();
    expect(
      await harness.db.chatGroupMember.count({ where: { groupId: group.id, botId: benLink.id } }),
    ).toBe(0);
    const original = await harness.db.bot.findUniqueOrThrow({
      where: { id: benOriginal.id },
      select: { archivedAt: true, instructions: true },
    });
    expect(original).toMatchObject({ archivedAt: null, instructions: `ben-${secret}` });
  });

  it("follows the original's name and look, and its archiving", async () => {
    await harness.db.bot.update({
      where: { id: originalId },
      data: { name: "Ana Renamed", color: "#ff8800" },
    });
    const link = await harness.db.bot.findFirstOrThrow({
      where: { spaceId: harness.teamSpaceId, linkedFromBotId: originalId },
    });
    expect(link).toMatchObject({ name: "Ana Renamed", color: "#ff8800", instructions: "" });
    await harness.db.bot.update({ where: { id: originalId }, data: { archivedAt: new Date() } });
    const archived = await harness.db.bot.findFirstOrThrow({
      where: { id: link.id, linkedFromBotId: originalId },
    });
    expect(archived.archivedAt).not.toBeNull();
  });
});
