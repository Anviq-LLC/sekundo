// Copyright 2026 Anviq LLC. All rights reserved.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./client.js";
import {
  acceptInvitation,
  assertAccountCanBeDeleted,
  assertTeamCanBeDeleted,
  cancelInvitation,
  createOrganization,
  deleteEmptyTeam,
  inviteToOrganization,
  leaveOrganization,
  listInvitations,
  listOrganizationMembers,
  listTeams,
  OrganizationError,
  personalSpaceId,
  removeMember,
  setMemberRole,
  transferOwnership,
} from "./organizations.js";
import { runAsSystem } from "./row-security.js";

const url = process.env.DATABASE_URL;
const describePostgres =
  process.env.VERIFY_DATABASE === "1" && url ? describe.sequential : describe.skip;

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof OrganizationError ? error.code : `unexpected: ${String(error)}`;
  }
}

describePostgres("organization membership (PostgreSQL)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const ids = {
    owner: `org-own-${suffix}`,
    ben: `org-ben-${suffix}`,
    cara: `org-cara-${suffix}`,
    dan: `org-dan-${suffix}`,
  };
  const email = (name: keyof typeof ids) => `${ids[name]}@anviq.test`;
  const created: string[] = [];
  let db: ReturnType<typeof createDb>;
  let teamId: string;
  let spaceId: string;

  const run = <T>(work: () => Promise<T>) => runAsSystem("organization test", work);

  beforeAll(() =>
    run(async () => {
      db = createDb(url!, { encryptContent: false });
      for (const [key, id] of Object.entries(ids)) {
        await db.prisma.user.create({
          data: { id, name: key, email: `${id}@anviq.test`, emailVerified: key !== "dan" },
        });
      }
      const team = await createOrganization(db.prisma, {
        userId: ids.owner,
        name: "  Acme   Corp ",
      });
      teamId = team.id;
      spaceId = team.defaultSpaceId;
      created.push(teamId);
    }),
  );

  afterAll(async () => {
    if (!db) return;
    await run(async () => {
      await db.prisma.organization.deleteMany({ where: { id: { in: created } } });
      await db.prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    });
    await db.prisma.$disconnect();
    await db.pool.end();
  });

  it("creates a team with its owner and a default space", () =>
    run(async () => {
      const teams = await listTeams(db.prisma, ids.owner);
      expect(teams).toEqual([
        { id: teamId, name: "Acme Corp", role: "owner", memberCount: 1, spaceId },
      ]);
      expect(await personalSpaceId(db.prisma, ids.owner)).toBeNull();
      const space = await db.prisma.space.findUnique({ where: { id: spaceId } });
      expect(space).toMatchObject({ organizationId: teamId, isDefault: true, name: "General" });
      expect(await listTeams(db.prisma, ids.ben)).toEqual([]);
    }));

  it("keeps a team private from people who are not in it", () =>
    run(async () => {
      expect(await codeOf(listOrganizationMembers(db.prisma, ids.ben, teamId))).toBe("NOT_FOUND");
      expect(
        await codeOf(
          inviteToOrganization(db.prisma, {
            userId: ids.ben,
            organizationId: teamId,
            email: email("cara"),
            role: "member",
          }),
        ),
      ).toBe("NOT_FOUND");
      expect(await codeOf(listInvitations(db.prisma, ids.ben, teamId))).toBe("NOT_FOUND");
    }));

  it("invites by email and lets only that verified person accept", () =>
    run(async () => {
      const invited = await inviteToOrganization(db.prisma, {
        userId: ids.owner,
        organizationId: teamId,
        email: ` ${email("ben").toUpperCase()} `,
        role: "member",
      });
      expect(invited.invitation.email).toBe(email("ben"));
      expect(invited.organizationName).toBe("Acme Corp");

      expect(
        await codeOf(
          acceptInvitation(db.prisma, { userId: ids.cara, invitationId: invited.invitation.id }),
        ),
      ).toBe("NOT_FOUND");
      const result = await acceptInvitation(db.prisma, {
        userId: ids.ben,
        invitationId: invited.invitation.id,
      });
      expect(result).toEqual({ organizationId: teamId, spaceId });
      expect(
        await codeOf(
          acceptInvitation(db.prisma, { userId: ids.ben, invitationId: invited.invitation.id }),
        ),
      ).toBe("NOT_FOUND");

      const members = await listOrganizationMembers(db.prisma, ids.ben, teamId);
      expect(members.map((member) => [member.userId, member.role])).toEqual([
        [ids.owner, "owner"],
        [ids.ben, "member"],
      ]);
      expect(
        await db.prisma.spaceMember.count({ where: { spaceId, userId: ids.ben, role: "member" } }),
      ).toBe(1);
    }));

  it("refuses an unverified email and a lapsed invitation", () =>
    run(async () => {
      const unverified = await inviteToOrganization(db.prisma, {
        userId: ids.owner,
        organizationId: teamId,
        email: email("dan"),
        role: "member",
      });
      expect(
        await codeOf(
          acceptInvitation(db.prisma, { userId: ids.dan, invitationId: unverified.invitation.id }),
        ),
      ).toBe("FORBIDDEN");

      const lapsed = await inviteToOrganization(db.prisma, {
        userId: ids.owner,
        organizationId: teamId,
        email: email("cara"),
        role: "member",
      });
      await db.prisma.invitation.update({
        where: { id: lapsed.invitation.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect(
        await codeOf(
          acceptInvitation(db.prisma, { userId: ids.cara, invitationId: lapsed.invitation.id }),
        ),
      ).toBe("NOT_FOUND");
    }));

  it("lets a member see the team but not manage it", () =>
    run(async () => {
      expect(
        await codeOf(
          inviteToOrganization(db.prisma, {
            userId: ids.ben,
            organizationId: teamId,
            email: email("cara"),
            role: "member",
          }),
        ),
      ).toBe("FORBIDDEN");
      expect(await codeOf(listInvitations(db.prisma, ids.ben, teamId))).toBe("FORBIDDEN");
      expect(
        await codeOf(
          setMemberRole(db.prisma, {
            userId: ids.ben,
            organizationId: teamId,
            targetUserId: ids.owner,
            role: "member",
          }),
        ),
      ).toBe("FORBIDDEN");
      expect(
        await codeOf(
          removeMember(db.prisma, {
            userId: ids.ben,
            organizationId: teamId,
            targetUserId: ids.owner,
          }),
        ),
      ).toBe("FORBIDDEN");
    }));

  it("lets an owner promote an admin, who can invite members but not admins", () =>
    run(async () => {
      await setMemberRole(db.prisma, {
        userId: ids.owner,
        organizationId: teamId,
        targetUserId: ids.ben,
        role: "admin",
      });
      const invited = await inviteToOrganization(db.prisma, {
        userId: ids.ben,
        organizationId: teamId,
        email: email("cara"),
        role: "member",
      });
      expect(invited.invitation.role).toBe("member");
      expect(
        await codeOf(
          inviteToOrganization(db.prisma, {
            userId: ids.ben,
            organizationId: teamId,
            email: email("dan"),
            role: "admin",
          }),
        ),
      ).toBe("FORBIDDEN");
      const pending = await listInvitations(db.prisma, ids.ben, teamId);
      expect(pending.map((invitation) => invitation.email)).toContain(email("cara"));
      await cancelInvitation(db.prisma, ids.ben, invited.invitation.id);
      expect(
        await codeOf(
          acceptInvitation(db.prisma, { userId: ids.cara, invitationId: invited.invitation.id }),
        ),
      ).toBe("NOT_FOUND");
    }));

  it("does not invite someone already in the team or into a personal workspace", () =>
    run(async () => {
      expect(
        await codeOf(
          inviteToOrganization(db.prisma, {
            userId: ids.owner,
            organizationId: teamId,
            email: email("ben"),
            role: "member",
          }),
        ),
      ).toBe("CONFLICT");
      await db.prisma.organization.create({
        data: {
          id: `personal-${suffix}`,
          name: "Personal",
          slug: `personal-${suffix}`,
          createdAt: new Date(),
        },
      });
      created.push(`personal-${suffix}`);
      await db.prisma.member.create({
        data: {
          id: `m-${suffix}`,
          organizationId: `personal-${suffix}`,
          userId: ids.owner,
          role: "owner",
          createdAt: new Date(),
        },
      });
      expect(
        await codeOf(
          inviteToOrganization(db.prisma, {
            userId: ids.owner,
            organizationId: `personal-${suffix}`,
            email: email("cara"),
            role: "member",
          }),
        ),
      ).toBe("NOT_FOUND");
      expect((await listTeams(db.prisma, ids.owner)).map((team) => team.id)).toEqual([teamId]);
    }));

  it("keeps ownership with an owner and refuses to strand a team", () =>
    run(async () => {
      expect(
        await codeOf(leaveOrganization(db.prisma, { userId: ids.owner, organizationId: teamId })),
      ).toBe("FORBIDDEN");
      expect(await codeOf(assertAccountCanBeDeleted(db.prisma, ids.owner))).toBe("CONFLICT");
      expect(await codeOf(assertAccountCanBeDeleted(db.prisma, ids.ben))).toBeUndefined();
      expect(
        await codeOf(
          removeMember(db.prisma, {
            userId: ids.ben,
            organizationId: teamId,
            targetUserId: ids.owner,
          }),
        ),
      ).toBe("FORBIDDEN");
    }));

  it("keeps a member who still owns active bots", () =>
    run(async () => {
      await db.prisma.bot.create({
        data: { id: `bot-${suffix}`, spaceId, userId: ids.ben, name: "Ada", color: "ink" },
      });
      expect(
        await codeOf(
          removeMember(db.prisma, {
            userId: ids.owner,
            organizationId: teamId,
            targetUserId: ids.ben,
          }),
        ),
      ).toBe("CONFLICT");
      expect(
        await codeOf(leaveOrganization(db.prisma, { userId: ids.ben, organizationId: teamId })),
      ).toBe("CONFLICT");
      await db.prisma.bot.update({
        where: { id: `bot-${suffix}` },
        data: { archivedAt: new Date() },
      });
    }));

  it("transfers ownership and removes a member who has nothing left in the team", () =>
    run(async () => {
      await transferOwnership(db.prisma, {
        userId: ids.owner,
        organizationId: teamId,
        targetUserId: ids.ben,
      });
      expect(
        (await listOrganizationMembers(db.prisma, ids.ben, teamId)).map((member) => [
          member.userId,
          member.role,
        ]),
      ).toEqual([
        [ids.owner, "admin"],
        [ids.ben, "owner"],
      ]);
      await assertAccountCanBeDeleted(db.prisma, ids.owner);

      await removeMember(db.prisma, {
        userId: ids.ben,
        organizationId: teamId,
        targetUserId: ids.owner,
      });
      expect(await listTeams(db.prisma, ids.owner)).toEqual([]);
      expect(await db.prisma.spaceMember.count({ where: { spaceId, userId: ids.owner } })).toBe(0);
      expect(await codeOf(listOrganizationMembers(db.prisma, ids.owner, teamId))).toBe("NOT_FOUND");
    }));

  it("limits how many teams one person creates", () =>
    run(async () => {
      for (let count = 0; count < 9; count += 1) {
        const team = await createOrganization(db.prisma, {
          userId: ids.cara,
          name: `Team ${count}`,
        });
        created.push(team.id);
      }
      const tenth = await createOrganization(db.prisma, { userId: ids.cara, name: "Team 9" });
      created.push(tenth.id);
      expect(
        await codeOf(createOrganization(db.prisma, { userId: ids.cara, name: "One too many" })),
      ).toBe("LIMIT");
      expect(await codeOf(createOrganization(db.prisma, { userId: ids.cara, name: "   " }))).toBe(
        "INVALID",
      );
    }));
  it("deletes a team only for its owner, once nobody else is in it and its spaces are gone", () =>
    run(async () => {
      const solo = await createOrganization(db.prisma, { userId: ids.dan, name: "Solo" });
      const busy = await createOrganization(db.prisma, { userId: ids.dan, name: "Busy" });
      created.push(solo.id, busy.id);
      await db.prisma.member.create({
        data: {
          id: `mem-${suffix}`,
          organizationId: busy.id,
          userId: ids.ben,
          role: "member",
          createdAt: new Date(),
        },
      });
      const target = (userId: string, organizationId: string) => ({ userId, organizationId });
      expect(await codeOf(assertTeamCanBeDeleted(db.prisma, target(ids.cara, solo.id)))).toBe(
        "NOT_FOUND",
      );
      expect(await codeOf(assertTeamCanBeDeleted(db.prisma, target(ids.ben, busy.id)))).toBe(
        "FORBIDDEN",
      );
      expect(await codeOf(assertTeamCanBeDeleted(db.prisma, target(ids.dan, busy.id)))).toBe(
        "CONFLICT",
      );
      expect(await codeOf(deleteEmptyTeam(db.prisma, target(ids.dan, solo.id)))).toBe("CONFLICT");
      await db.prisma.space.deleteMany({ where: { organizationId: solo.id } });
      await deleteEmptyTeam(db.prisma, target(ids.dan, solo.id));
      expect(await db.prisma.organization.findUnique({ where: { id: solo.id } })).toBeNull();
      expect(await db.prisma.organization.findUnique({ where: { id: busy.id } })).not.toBeNull();
    }));
});
