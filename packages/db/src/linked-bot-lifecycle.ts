import type { PrismaClient } from "./database/client.js";
import { cancelRunsInTransaction } from "./runs/cancel-runs.js";

const ACTIVE_RUN_STATUSES = ["queued", "leased", "running", "waiting_input", "waiting_takeover"];

/**
 * Takes a person's linked bots out of a team when they leave it or are removed: the links leave
 * every group, what they were running stops, and the links are archived. The bots behind the
 * links are not touched. Links are not counted as active bots, so they never block leaving.
 */
export async function unlinkBotsInOrganization(
  prisma: PrismaClient,
  input: { organizationId: string; userId: string },
): Promise<{ cancelledRunIds: string[] }> {
  return prisma.$transaction(async (tx) => {
    const links = await tx.bot.findMany({
      where: {
        userId: input.userId,
        archivedAt: null,
        linkedFromBotId: { not: null },
        space: { organizationId: input.organizationId },
      },
      select: { id: true },
    });
    if (links.length === 0) return { cancelledRunIds: [] };
    const botIds = links.map((link) => link.id);
    const runs = await tx.run.findMany({
      where: { botId: { in: botIds }, status: { in: ACTIVE_RUN_STATUSES } },
      select: { id: true, taskId: true, userId: true, spaceId: true },
    });
    if (runs.length) await cancelRunsInTransaction(tx, runs, new Date());
    await tx.chatGroupMember.deleteMany({ where: { botId: { in: botIds } } });
    await tx.bot.updateMany({
      where: { id: { in: botIds }, linkedFromBotId: { not: null } },
      data: { archivedAt: new Date() },
    });
    return { cancelledRunIds: runs.map((run) => run.id) };
  });
}
