import { ClientError } from "@anviq/core";
import { ensureComputerRecord } from "./computers/computers.js";
import type { PrismaClient } from "./database/client.js";
import { runAsSystem } from "./database/row-security.js";
import { lockSpaceForContentCreation } from "./spaces/spaces.js";

/*
 * A person's bot takes part in a team space through a link: a thin bot row in that space that
 * points at the person's own bot (`linkedFromBotId`). It carries only what the team may see of
 * the bot (name, title and look), which the database keeps in step with the original. Its
 * description, instructions, notes and history stay with the original.
 *
 * Link rows are hidden from ordinary bot queries so no list, count or lookup can surface one
 * by oversight. Code that means to work with links names `linkedFromBotId` in its filter.
 */

const FILTERED_OPERATIONS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "deleteMany",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The arguments of a bot query with link rows left out, unless the query names `linkedFromBotId`. */
export function withoutLinkedBots(operation: string, args: unknown): unknown {
  if (!FILTERED_OPERATIONS.has(operation)) return args;
  const base = isPlainObject(args) ? args : {};
  const where = isPlainObject(base.where) ? base.where : {};
  if ("linkedFromBotId" in where) return args;
  return { ...base, where: { ...where, linkedFromBotId: null } };
}

export function withLinkedBotsHidden(prisma: PrismaClient): PrismaClient {
  return prisma.$extends({
    query: {
      bot: {
        $allOperations({ operation, args, query }) {
          return query(withoutLinkedBots(operation, args) as typeof args);
        },
      },
    },
  }) as unknown as PrismaClient;
}

/** Whether a person is in a space whose organization has other people in it. */
async function isTeamSpace(prisma: PrismaClient, spaceId: string, userId: string) {
  const space = await prisma.space.findFirst({
    where: { id: spaceId, deletingAt: null, memberships: { some: { userId } } },
    select: { organization: { select: { _count: { select: { members: true } } } } },
  });
  return (space?.organization._count.members ?? 0) > 1;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Links a person's own bot into a team space they belong to, and returns the link, which is the
 * existing one when the bot is already linked there. Only the owner can link a bot, and only
 * into a space they are a member of; the database refuses anything else.
 */
export async function linkBotIntoSpace(
  prisma: PrismaClient,
  actor: { userId: string },
  input: { botId: string; spaceId: string },
): Promise<{ id: string; created: boolean }> {
  return runAsSystem("link a person's own bot into a team space", async () => {
    const original = await prisma.bot.findFirst({
      where: { id: input.botId, userId: actor.userId, archivedAt: null, linkedFromBotId: null },
      select: { id: true, spaceId: true, name: true, color: true },
    });
    if (!original || original.spaceId === input.spaceId)
      throw new ClientError("NOT_FOUND", "Bot not found");
    if (!(await isTeamSpace(prisma, input.spaceId, actor.userId)))
      throw new ClientError("NOT_FOUND", "Space not found");
    const existing = () =>
      prisma.bot.findFirst({
        where: { spaceId: input.spaceId, linkedFromBotId: original.id, archivedAt: null },
        select: { id: true },
      });
    const found = await existing();
    if (found) return { id: found.id, created: false };
    const settings = await prisma.deploymentSettings.findUnique({ where: { id: "default" } });
    const envKind = process.env.SANDBOX_PROVIDER ?? "docker";
    const kind =
      envKind === "docker" && settings?.computerHost === "this-mac" ? "desktop" : envKind;
    try {
      const link = await prisma.$transaction(async (tx) => {
        await lockSpaceForContentCreation(tx, { spaceId: input.spaceId, userId: actor.userId });
        // Like any bot of the team space, a link works on the owner's computer there.
        const computer = await ensureComputerRecord(tx, {
          mode: "team",
          spaceId: input.spaceId,
          userId: actor.userId,
          kind,
        });
        const created = await tx.bot.create({
          data: {
            spaceId: input.spaceId,
            userId: actor.userId,
            linkedFromBotId: original.id,
            name: original.name,
            color: original.color,
            notifyOnFinish: false,
            computerId: computer.id,
          },
          select: { id: true },
        });
        await tx.browserProfile.create({
          data: { spaceId: input.spaceId, botId: created.id, userId: actor.userId },
        });
        return created;
      });
      return { id: link.id, created: true };
    } catch (error) {
      // A concurrent link won the unique index: use theirs.
      if (!isUniqueViolation(error)) throw error;
      const winner = await existing();
      if (!winner) throw error;
      return { id: winner.id, created: false };
    }
  });
}

export type LinkableBot = {
  id: string;
  name: string;
  title: string;
  color: string;
  spaceId: string;
  spaceName: string;
  /** The link in the current space, when the bot is already linked there. */
  linkedBotId: string | null;
};

/**
 * A person's bots in their other spaces that can take part in the team space they are working
 * in, with the link where one exists. Nothing is offered outside a team space.
 */
export async function listLinkableBots(
  prisma: PrismaClient,
  actor: { userId: string; spaceId: string },
): Promise<LinkableBot[]> {
  return runAsSystem("list a person's own bots that can join a team space", async () => {
    if (!(await isTeamSpace(prisma, actor.spaceId, actor.userId))) return [];
    const originals = await prisma.bot.findMany({
      where: {
        userId: actor.userId,
        archivedAt: null,
        linkedFromBotId: null,
        spaceId: { not: actor.spaceId },
        space: { deletingAt: null, memberships: { some: { userId: actor.userId } } },
      },
      select: {
        id: true,
        name: true,
        color: true,
        spaceId: true,
        space: { select: { name: true } },
      },
      orderBy: [{ spaceId: "asc" }, { position: "asc" }, { createdAt: "asc" }],
    });
    const links = await prisma.bot.findMany({
      where: {
        spaceId: actor.spaceId,
        userId: actor.userId,
        archivedAt: null,
        linkedFromBotId: { in: originals.map((bot) => bot.id) },
      },
      select: { id: true, linkedFromBotId: true },
    });
    const linked = new Map(links.map((link) => [link.linkedFromBotId, link.id]));
    return originals.map((bot) => ({
      id: bot.id,
      name: bot.name,
      title: "",
      color: bot.color,
      spaceId: bot.spaceId,
      spaceName: bot.space.name,
      linkedBotId: linked.get(bot.id) ?? null,
    }));
  });
}

/**
 * The bot ids of a group edit with each of the person's own bots from another space replaced by
 * its link in this one, creating the link when there is none. Ids that already belong to this
 * space, or that cannot be linked, are left as they are for the caller's own checks to refuse.
 */
export async function resolveGroupBotIds(
  prisma: PrismaClient,
  actor: { userId: string; spaceId: string },
  botIds: readonly string[],
): Promise<string[]> {
  const unique = [...new Set(botIds)];
  if (unique.length === 0) return [...botIds];
  const here = await prisma.bot.findMany({
    where: {
      id: { in: unique },
      spaceId: actor.spaceId,
      userId: actor.userId,
      archivedAt: null,
      linkedFromBotId: undefined,
    },
    select: { id: true },
  });
  const inSpace = new Set(here.map((bot) => bot.id));
  const replacement = new Map<string, string>();
  for (const botId of unique) {
    if (inSpace.has(botId)) continue;
    try {
      const link = await linkBotIntoSpace(prisma, actor, { botId, spaceId: actor.spaceId });
      replacement.set(botId, link.id);
    } catch (error) {
      if (!(error instanceof ClientError && error.kind === "NOT_FOUND")) throw error;
    }
  }
  return botIds.map((botId) => replacement.get(botId) ?? botId);
}

/** What a run of a linked bot takes from the person's own bot behind the link. */
export type LinkedBotHome = {
  instructions: string;
  modelProvider: string | null;
  modelId: string | null;
  thinkingLevel: string | null;
  disabledBuiltinTools: string[];
};

/**
 * The persona and model of the bot behind a link, read for the link's owner only and only while
 * that bot is not archived. This is the one place a team-space run reads the original, and it
 * reads nothing but these fields.
 */
export async function loadLinkedBotHome(
  prisma: PrismaClient,
  link: { linkedFromBotId: string; userId: string },
): Promise<LinkedBotHome> {
  return runAsSystem("read the bot behind a link for its owner's run", async () => {
    const home = await prisma.bot.findFirst({
      where: {
        id: link.linkedFromBotId,
        userId: link.userId,
        archivedAt: null,
        linkedFromBotId: null,
      },
      select: {
        instructions: true,
        modelProvider: true,
        modelId: true,
        thinkingLevel: true,
        disabledBuiltinTools: true,
      },
    });
    if (!home) throw new Error("The bot behind this link is no longer available");
    return home;
  });
}

/**
 * The bot as a run sees it: a linked bot answers with the persona and model of the bot behind
 * its link and never rewrites that bot's instructions; any other bot is returned as it is.
 */
export async function withLinkedBotHome<
  T extends { linkedFromBotId: string | null; userId: string },
>(prisma: PrismaClient, bot: T): Promise<T> {
  if (!bot.linkedFromBotId) return bot;
  const home = await loadLinkedBotHome(prisma, {
    linkedFromBotId: bot.linkedFromBotId,
    userId: bot.userId,
  });
  return { ...bot, ...home };
}
