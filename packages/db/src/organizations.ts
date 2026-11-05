// Copyright 2026 Anviq LLC. All rights reserved.
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";
import { createSpace, createSpaceDefaults } from "./spaces.js";
import { withTransactionRetry } from "./transaction-retry.js";

export const ORGANIZATION_ROLES = ["owner", "admin", "member"] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const MAX_COMPANY_ORGANIZATIONS_PER_USER = 10;
export const MAX_PENDING_INVITATIONS = 50;
export const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export type OrganizationErrorCode = "NOT_FOUND" | "FORBIDDEN" | "INVALID" | "CONFLICT" | "LIMIT";

/** A rule of organization membership that a request broke; `code` says how to report it. */
export class OrganizationError extends Error {
  constructor(
    readonly code: OrganizationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OrganizationError";
  }
}

/** Roles are stored as a comma-separated list ("admin, owner"); the highest one counts. */
export function organizationRole(stored: string): OrganizationRole {
  const roles = stored.split(",").map((role) => role.trim());
  return ORGANIZATION_ROLES.find((role) => roles.includes(role)) ?? "member";
}

const canManage = (role: OrganizationRole) => role === "owner" || role === "admin";

function normalizeName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > 60)
    throw new OrganizationError("INVALID", "Name a team in 1 to 60 characters");
  return trimmed;
}

function slugFor(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "team"}-${randomUUID().slice(0, 8)}`;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  role: OrganizationRole;
  memberCount: number;
  /** The team's general space, where the person lands when switching to it. */
  spaceId: string;
}

export async function membership(
  prisma: Pick<PrismaClient, "member">,
  userId: string,
  organizationId: string,
): Promise<OrganizationRole> {
  const member = await prisma.member.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { role: true },
  });
  if (!member) throw new OrganizationError("NOT_FOUND", "Team not found");
  return organizationRole(member.role);
}

export async function managerOf(
  prisma: Pick<PrismaClient, "member">,
  userId: string,
  organizationId: string,
): Promise<OrganizationRole> {
  const role = await membership(prisma, userId, organizationId);
  if (!canManage(role))
    throw new OrganizationError("FORBIDDEN", "Only an owner or admin can do this");
  return role;
}

/** A team is any organization that someone other than its creator can join; personal ones stay private. */
export async function createOrganization(
  prisma: PrismaClient,
  input: { userId: string; name: string },
): Promise<{ id: string; name: string; defaultSpaceId: string }> {
  const name = normalizeName(input.name);
  const organizationId = randomUUID();
  const spaceId = randomUUID();
  const createdAt = new Date();
  await withTransactionRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const owned = await tx.member.count({
          where: {
            userId: input.userId,
            role: { contains: "owner" },
            organization: { metadata: { contains: '"kind":"team"' } },
          },
        });
        if (owned >= MAX_COMPANY_ORGANIZATIONS_PER_USER)
          throw new OrganizationError(
            "LIMIT",
            "You have reached the number of teams you can create",
          );
        await tx.organization.create({
          data: {
            id: organizationId,
            name,
            slug: slugFor(name),
            createdAt,
            metadata: JSON.stringify({ kind: "team" }),
          },
        });
        await tx.member.create({
          data: {
            id: randomUUID(),
            organizationId,
            userId: input.userId,
            role: "owner",
            createdAt,
          },
        });
        await createSpace(tx, {
          spaceId,
          spaceMembershipId: randomUUID(),
          organizationId,
          userId: input.userId,
          name: "General",
          createdAt,
          isDefault: true,
        });
        await createSpaceDefaults(tx, {
          spaceId,
          userId: input.userId,
          memoryContent: "# Space memory\n\n",
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
  return { id: organizationId, name, defaultSpaceId: spaceId };
}

/** Teams the user belongs to. Personal workspaces are not listed. */
export async function listTeams(
  prisma: PrismaClient,
  userId: string,
): Promise<OrganizationSummary[]> {
  const rows = await prisma.member.findMany({
    where: { userId, organization: { metadata: { contains: '"kind":"team"' } } },
    select: {
      role: true,
      organization: {
        select: {
          id: true,
          name: true,
          _count: { select: { members: true } },
          spaces: {
            where: { isDefault: true, memberships: { some: { userId } } },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.flatMap((row) => {
    const space = row.organization.spaces[0];
    return space
      ? [
          {
            id: row.organization.id,
            name: row.organization.name,
            role: organizationRole(row.role),
            memberCount: row.organization._count.members,
            spaceId: space.id,
          },
        ]
      : [];
  });
}

/** The person's own workspace, so the app can switch back to it from a team. */
export async function personalSpaceId(
  prisma: PrismaClient,
  userId: string,
): Promise<string | null> {
  const space = await prisma.space.findFirst({
    where: {
      isDefault: true,
      memberships: { some: { userId } },
      organization: {
        OR: [{ metadata: null }, { NOT: { metadata: { contains: '"kind":"team"' } } }],
      },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return space?.id ?? null;
}

export interface OrganizationMemberView {
  userId: string;
  name: string;
  email: string;
  role: OrganizationRole;
  joinedAt: Date;
}

export async function listOrganizationMembers(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
): Promise<OrganizationMemberView[]> {
  await membership(prisma, userId, organizationId);
  const rows = await prisma.member.findMany({
    where: { organizationId },
    select: {
      role: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => ({
    userId: row.user.id,
    name: row.user.name,
    email: row.user.email,
    role: organizationRole(row.role),
    joinedAt: row.createdAt,
  }));
}

export interface InvitationView {
  id: string;
  email: string;
  role: OrganizationRole;
  expiresAt: Date;
}

export async function inviteToOrganization(
  prisma: PrismaClient,
  input: { userId: string; organizationId: string; email: string; role: "admin" | "member" },
): Promise<{ invitation: InvitationView; organizationName: string; inviterName: string }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    throw new OrganizationError("INVALID", "Enter a valid email address");
  const inviterRole = await managerOf(prisma, input.userId, input.organizationId);
  if (input.role === "admin" && inviterRole !== "owner")
    throw new OrganizationError("FORBIDDEN", "Only an owner can invite an admin");
  const organization = await prisma.organization.findUnique({
    where: { id: input.organizationId },
    select: { name: true, metadata: true },
  });
  if (!organization?.metadata?.includes('"kind":"team"'))
    throw new OrganizationError("NOT_FOUND", "Team not found");
  const alreadyMember = await prisma.member.findFirst({
    where: {
      organizationId: input.organizationId,
      user: { email: { equals: email, mode: "insensitive" } },
    },
    select: { id: true },
  });
  if (alreadyMember) throw new OrganizationError("CONFLICT", "That person is already in the team");
  const pending = await prisma.invitation.count({
    where: {
      organizationId: input.organizationId,
      status: "pending",
      expiresAt: { gt: new Date() },
    },
  });
  if (pending >= MAX_PENDING_INVITATIONS)
    throw new OrganizationError("LIMIT", "Too many invitations are waiting; cancel some first");
  const existing = await prisma.invitation.findFirst({
    where: {
      organizationId: input.organizationId,
      email: { equals: email, mode: "insensitive" },
      status: "pending",
    },
  });
  const expiresAt = new Date(Date.now() + INVITATION_LIFETIME_MS);
  const invitation = existing
    ? await prisma.invitation.update({
        where: { id: existing.id },
        data: { role: input.role, expiresAt, inviterId: input.userId },
      })
    : await prisma.invitation.create({
        data: {
          id: randomUUID(),
          organizationId: input.organizationId,
          email,
          role: input.role,
          status: "pending",
          expiresAt,
          inviterId: input.userId,
        },
      });
  const inviter = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { name: true },
  });
  return {
    invitation: {
      id: invitation.id,
      email,
      role: organizationRole(invitation.role ?? "member"),
      expiresAt: invitation.expiresAt,
    },
    organizationName: organization.name,
    inviterName: inviter?.name ?? "A teammate",
  };
}

export interface MyInvitationView {
  id: string;
  organizationName: string;
  inviterName: string;
  role: OrganizationRole;
  expiresAt: Date;
}

/** Pending invitations addressed to the signed-in person's own verified email. */
export async function listMyInvitations(
  prisma: PrismaClient,
  userId: string,
): Promise<MyInvitationView[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true },
  });
  if (!user?.emailVerified) return [];
  const rows = await prisma.invitation.findMany({
    where: {
      email: { equals: user.email, mode: "insensitive" },
      status: "pending",
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      role: true,
      expiresAt: true,
      organization: { select: { name: true } },
      user: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    organizationName: row.organization.name,
    inviterName: row.user.name,
    role: organizationRole(row.role ?? "member"),
    expiresAt: row.expiresAt,
  }));
}

export async function listInvitations(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
): Promise<InvitationView[]> {
  await managerOf(prisma, userId, organizationId);
  const rows = await prisma.invitation.findMany({
    where: { organizationId, status: "pending", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    role: organizationRole(row.role ?? "member"),
    expiresAt: row.expiresAt,
  }));
}

export async function cancelInvitation(
  prisma: PrismaClient,
  userId: string,
  invitationId: string,
): Promise<void> {
  const invitation = await prisma.invitation.findUnique({ where: { id: invitationId } });
  if (invitation?.status !== "pending")
    throw new OrganizationError("NOT_FOUND", "Invitation not found");
  await managerOf(prisma, userId, invitation.organizationId);
  await prisma.invitation.update({ where: { id: invitationId }, data: { status: "canceled" } });
}

/** An invitation the signed-in user can accept: it names their verified email and has not lapsed. */
export async function acceptInvitation(
  prisma: PrismaClient,
  input: { userId: string; invitationId: string },
): Promise<{ organizationId: string; spaceId: string }> {
  return withTransactionRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: input.userId },
          select: { email: true, emailVerified: true },
        });
        const invitation = await tx.invitation.findUnique({ where: { id: input.invitationId } });
        if (
          !user ||
          !invitation ||
          invitation.status !== "pending" ||
          invitation.expiresAt <= new Date() ||
          invitation.email.toLowerCase() !== user.email.toLowerCase()
        )
          throw new OrganizationError("NOT_FOUND", "This invitation is not available");
        if (!user.emailVerified)
          throw new OrganizationError("FORBIDDEN", "Verify your email before joining a team");
        const space = await tx.space.findFirst({
          where: { organizationId: invitation.organizationId, isDefault: true },
          select: { id: true },
        });
        if (!space) throw new OrganizationError("NOT_FOUND", "This team has no space to join");
        const already = await tx.member.findUnique({
          where: {
            organizationId_userId: {
              organizationId: invitation.organizationId,
              userId: input.userId,
            },
          },
          select: { id: true },
        });
        const createdAt = new Date();
        if (!already) {
          await tx.member.create({
            data: {
              id: randomUUID(),
              organizationId: invitation.organizationId,
              userId: input.userId,
              role: organizationRole(invitation.role ?? "member"),
              createdAt,
            },
          });
          // A database trigger adds the person to the default space when the member row is created.
          await createSpaceDefaults(tx, {
            spaceId: space.id,
            userId: input.userId,
            memoryContent: "# Space memory\n\n",
          });
        }
        await tx.invitation.update({ where: { id: invitation.id }, data: { status: "accepted" } });
        return { organizationId: invitation.organizationId, spaceId: space.id };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

export async function setMemberRole(
  prisma: PrismaClient,
  input: { userId: string; organizationId: string; targetUserId: string; role: "admin" | "member" },
): Promise<void> {
  const actorRole = await membership(prisma, input.userId, input.organizationId);
  if (actorRole !== "owner")
    throw new OrganizationError("FORBIDDEN", "Only an owner can change roles");
  const target = await prisma.member.findUnique({
    where: {
      organizationId_userId: { organizationId: input.organizationId, userId: input.targetUserId },
    },
  });
  if (!target) throw new OrganizationError("NOT_FOUND", "That person is not in the team");
  if (organizationRole(target.role) === "owner")
    throw new OrganizationError(
      "FORBIDDEN",
      "Transfer ownership instead of changing an owner's role",
    );
  await prisma.member.update({ where: { id: target.id }, data: { role: input.role } });
}

/** Makes another member the owner and the current owner an admin, in one step. */
export async function transferOwnership(
  prisma: PrismaClient,
  input: { userId: string; organizationId: string; targetUserId: string },
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const role = await membership(tx, input.userId, input.organizationId);
    if (role !== "owner")
      throw new OrganizationError("FORBIDDEN", "Only an owner can transfer ownership");
    const target = await tx.member.findUnique({
      where: {
        organizationId_userId: { organizationId: input.organizationId, userId: input.targetUserId },
      },
    });
    if (!target || input.targetUserId === input.userId)
      throw new OrganizationError("NOT_FOUND", "That person is not in the team");
    await tx.member.update({ where: { id: target.id }, data: { role: "owner" } });
    await tx.member.update({
      where: {
        organizationId_userId: { organizationId: input.organizationId, userId: input.userId },
      },
      data: { role: "admin" },
    });
  });
}

/** Bots a person still owns in a team's spaces; they must be dealt with before the person leaves. */
async function activeBotCount(
  prisma: Pick<PrismaClient, "bot">,
  organizationId: string,
  userId: string,
): Promise<number> {
  return prisma.bot.count({
    where: { userId, archivedAt: null, space: { organizationId } },
  });
}

export async function removeMember(
  prisma: PrismaClient,
  input: { userId: string; organizationId: string; targetUserId: string },
): Promise<void> {
  const actorRole = await managerOf(prisma, input.userId, input.organizationId);
  if (input.targetUserId === input.userId)
    throw new OrganizationError("INVALID", "Use leave to remove yourself");
  const target = await prisma.member.findUnique({
    where: {
      organizationId_userId: { organizationId: input.organizationId, userId: input.targetUserId },
    },
  });
  if (!target) throw new OrganizationError("NOT_FOUND", "That person is not in the team");
  const targetRole = organizationRole(target.role);
  if (targetRole === "owner" || (targetRole === "admin" && actorRole !== "owner"))
    throw new OrganizationError("FORBIDDEN", "You cannot remove that person");
  if ((await activeBotCount(prisma, input.organizationId, input.targetUserId)) > 0)
    throw new OrganizationError(
      "CONFLICT",
      "Their bots are still active in this team; they need to archive or delete them first",
    );
  await prisma.member.delete({ where: { id: target.id } });
}

export async function leaveOrganization(
  prisma: PrismaClient,
  input: { userId: string; organizationId: string },
): Promise<void> {
  const role = await membership(prisma, input.userId, input.organizationId);
  if (role === "owner") {
    const otherOwners = await prisma.member.count({
      where: {
        organizationId: input.organizationId,
        userId: { not: input.userId },
        role: { contains: "owner" },
      },
    });
    if (otherOwners === 0)
      throw new OrganizationError("FORBIDDEN", "Transfer ownership before leaving the team");
  }
  if ((await activeBotCount(prisma, input.organizationId, input.userId)) > 0)
    throw new OrganizationError(
      "CONFLICT",
      "Archive or delete your bots in this team before leaving",
    );
  await prisma.member.delete({
    where: {
      organizationId_userId: { organizationId: input.organizationId, userId: input.userId },
    },
  });
}

/** A team cannot be left without an owner by deleting an account. */
export async function assertAccountCanBeDeleted(
  prisma: Pick<PrismaClient, "member">,
  userId: string,
): Promise<void> {
  const owned = await prisma.member.findMany({
    where: { userId, role: { contains: "owner" } },
    select: {
      organization: {
        select: {
          name: true,
          members: { select: { userId: true, role: true } },
        },
      },
    },
  });
  const stranded = owned.find(({ organization }) => {
    const others = organization.members.filter((member) => member.userId !== userId);
    return others.length > 0 && !others.some((member) => organizationRole(member.role) === "owner");
  });
  if (stranded)
    throw new OrganizationError(
      "CONFLICT",
      `Transfer ownership of ${stranded.organization.name} before deleting your account`,
    );
}

/** Only a team's owner can delete it, and only once nobody else is in it. */
export async function assertTeamCanBeDeleted(
  prisma: Pick<PrismaClient, "organization">,
  input: { userId: string; organizationId: string },
): Promise<void> {
  const team = await prisma.organization.findFirst({
    where: {
      id: input.organizationId,
      metadata: { contains: '"kind":"team"' },
      members: { some: { userId: input.userId } },
    },
    select: { members: { select: { userId: true, role: true } } },
  });
  const self = team?.members.find((member) => member.userId === input.userId);
  if (!team || !self) throw new OrganizationError("NOT_FOUND", "Team not found");
  if (organizationRole(self.role) !== "owner")
    throw new OrganizationError("FORBIDDEN", "Only the owner can delete a team");
  if (team.members.length > 1)
    throw new OrganizationError("CONFLICT", "Remove the other members before deleting the team");
}

/** Removes a team once its spaces are gone. Invitations, events and keys go with it. */
export async function deleteEmptyTeam(
  prisma: PrismaClient,
  input: { userId: string; organizationId: string },
): Promise<void> {
  await assertTeamCanBeDeleted(prisma, input);
  if ((await prisma.space.count({ where: { organizationId: input.organizationId } })) > 0)
    throw new OrganizationError("CONFLICT", "The team still has content. Try again");
  await prisma.organization.delete({ where: { id: input.organizationId } });
}
