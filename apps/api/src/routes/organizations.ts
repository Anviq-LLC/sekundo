// Copyright 2026 Anviq LLC. All rights reserved.
import { teamInvitationEmail } from "@anviq/auth";
import {
  acceptInvitation,
  assertTeamCanBeDeleted,
  cancelInvitation,
  createOrganization,
  decideMemoryProposal,
  deleteEmptyTeam,
  inviteToOrganization,
  leaveOrganization,
  listInvitations,
  listMemoryProposals,
  listMyInvitations,
  listOrganizationEvents,
  listOrganizationMembers,
  listTeams,
  OrganizationError,
  personalSpaceId,
  proposeCompanyMemory,
  readCompanyMemory,
  recordOrganizationEvent,
  removeMember,
  runAsSystem,
  setMemberRole,
  transferOwnership,
  writeCompanyMemory,
} from "@anviq/db";
import { getLogger } from "@anviq/logging";
import { ORPCError } from "@orpc/server";
import { deleteAccountContent } from "../account-deletion.js";
import { requireIdentityConfirmation } from "../identity-confirmation.js";
import type { RouterContext } from "./context.js";

const CODES = {
  NOT_FOUND: "NOT_FOUND",
  FORBIDDEN: "FORBIDDEN",
  INVALID: "BAD_REQUEST",
  CONFLICT: "CONFLICT",
  LIMIT: "BAD_REQUEST",
} as const;

/** Reports a broken membership rule as the matching API error; anything else is not ours to describe. */
export async function reportRules<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof OrganizationError)
      throw new ORPCError(CODES[error.code], { message: error.message });
    throw error;
  }
}

const iso = (date: Date) => date.toISOString();
const done = { ok: true as const };

/**
 * Team membership. These calls act across spaces on behalf of the signed-in person, so they run as
 * the system and every function checks the caller's own membership and role before it reads or writes.
 */
export function organizationsRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  const prisma = deps.prisma;
  const system = <T>(work: () => Promise<T>) =>
    reportRules(() => runAsSystem("team membership", work));
  const note = (
    actorUserId: string,
    organizationId: string,
    type: Parameters<typeof recordOrganizationEvent>[1]["type"],
    subject?: string,
  ) => recordOrganizationEvent(prisma, { organizationId, actorUserId, type, subject });
  return {
    organizations: {
      list: authed.organizations.list.handler(({ context }) =>
        system(() => listTeams(prisma, context.actor.userId)),
      ),
      personalSpace: authed.organizations.personalSpace.handler(({ context }) =>
        system(async () => ({ spaceId: await personalSpaceId(prisma, context.actor.userId) })),
      ),
      create: authed.organizations.create.handler(({ context, input }) =>
        system(async () => {
          const team = await createOrganization(prisma, {
            userId: context.actor.userId,
            name: input.name,
          });
          await note(context.actor.userId, team.id, "team.created");
          return team;
        }),
      ),
      members: authed.organizations.members.handler(({ context, input }) =>
        system(async () =>
          (await listOrganizationMembers(prisma, context.actor.userId, input.organizationId)).map(
            (member) => ({ ...member, joinedAt: iso(member.joinedAt) }),
          ),
        ),
      ),
      setRole: authed.organizations.setRole.handler(({ context, input }) =>
        system(async () => {
          await setMemberRole(prisma, {
            userId: context.actor.userId,
            organizationId: input.organizationId,
            targetUserId: input.userId,
            role: input.role,
          });
          await note(
            context.actor.userId,
            input.organizationId,
            "member.role_changed",
            input.userId,
          );
          return done;
        }),
      ),
      transferOwnership: authed.organizations.transferOwnership.handler(({ context, input }) =>
        system(async () => {
          await transferOwnership(prisma, {
            userId: context.actor.userId,
            organizationId: input.organizationId,
            targetUserId: input.userId,
          });
          await note(
            context.actor.userId,
            input.organizationId,
            "ownership.transferred",
            input.userId,
          );
          return done;
        }),
      ),
      removeMember: authed.organizations.removeMember.handler(({ context, input }) =>
        system(async () => {
          await removeMember(prisma, {
            userId: context.actor.userId,
            organizationId: input.organizationId,
            targetUserId: input.userId,
          });
          await note(context.actor.userId, input.organizationId, "member.removed", input.userId);
          return done;
        }),
      ),
      leave: authed.organizations.leave.handler(({ context, input }) =>
        system(async () => {
          await leaveOrganization(prisma, {
            userId: context.actor.userId,
            organizationId: input.organizationId,
          });
          await note(context.actor.userId, input.organizationId, "member.left");
          return done;
        }),
      ),
      remove: authed.organizations.remove.handler(async ({ context, input }) => {
        await requireIdentityConfirmation(deps.auth, context);
        return system(async () => {
          const target = { userId: context.actor.userId, organizationId: input.organizationId };
          await assertTeamCanBeDeleted(prisma, target);
          await deleteAccountContent(deps, target.userId, target.organizationId);
          await deleteEmptyTeam(prisma, target);
          return done;
        });
      }),
      invitations: authed.organizations.invitations.handler(({ context, input }) =>
        system(async () =>
          (await listInvitations(prisma, context.actor.userId, input.organizationId)).map(
            (invitation) => ({ ...invitation, expiresAt: iso(invitation.expiresAt) }),
          ),
        ),
      ),
      invite: authed.organizations.invite.handler(({ context, input }) =>
        system(async () => {
          const { invitation, organizationName, inviterName } = await inviteToOrganization(prisma, {
            userId: context.actor.userId,
            organizationId: input.organizationId,
            email: input.email,
            role: input.role,
          });
          await note(
            context.actor.userId,
            input.organizationId,
            "member.invited",
            invitation.email,
          );
          if (deps.email) {
            const url = new URL(`/accept-invitation/${invitation.id}`, deps.env.webOrigin).href;
            // The invitation exists either way; a delivery failure is reported, and the invite can be resent.
            await deps.email
              .send(
                await teamInvitationEmail(invitation.email, { organizationName, inviterName, url }),
              )
              .catch((error) => getLogger().error("team invitation email failed", error));
          }
          return { ...invitation, expiresAt: iso(invitation.expiresAt) };
        }),
      ),
      cancelInvitation: authed.organizations.cancelInvitation.handler(({ context, input }) =>
        system(async () => {
          await cancelInvitation(prisma, context.actor.userId, input.invitationId);
          return done;
        }),
      ),
      myInvitations: authed.organizations.myInvitations.handler(({ context }) =>
        system(async () =>
          (await listMyInvitations(prisma, context.actor.userId)).map((invitation) => ({
            ...invitation,
            expiresAt: iso(invitation.expiresAt),
          })),
        ),
      ),
      acceptInvitation: authed.organizations.acceptInvitation.handler(({ context, input }) =>
        system(async () => {
          const joined = await acceptInvitation(prisma, {
            userId: context.actor.userId,
            invitationId: input.invitationId,
          });
          await note(context.actor.userId, joined.organizationId, "member.joined");
          return joined;
        }),
      ),
      memory: authed.organizations.memory.handler(({ context, input }) =>
        system(async () => {
          const memory = await readCompanyMemory(
            prisma,
            context.actor.userId,
            input.organizationId,
          );
          return { ...memory, updatedAt: memory.updatedAt ? iso(memory.updatedAt) : null };
        }),
      ),
      setMemory: authed.organizations.setMemory.handler(({ context, input }) =>
        system(async () => {
          const saved = await writeCompanyMemory(prisma, {
            userId: context.actor.userId,
            organizationId: input.organizationId,
            content: input.content,
            expectedRevision: input.expectedRevision,
          });
          await note(context.actor.userId, input.organizationId, "memory.updated");
          return saved;
        }),
      ),
      proposeMemory: authed.organizations.proposeMemory.handler(({ context, input }) =>
        system(async () => {
          const proposal = await proposeCompanyMemory(prisma, {
            userId: context.actor.userId,
            organizationId: input.organizationId,
            content: input.content,
          });
          await note(context.actor.userId, input.organizationId, "memory.proposed");
          return proposal;
        }),
      ),
      memoryProposals: authed.organizations.memoryProposals.handler(({ context, input }) =>
        system(async () =>
          (await listMemoryProposals(prisma, context.actor.userId, input.organizationId)).map(
            (proposal) => ({ ...proposal, createdAt: iso(proposal.createdAt) }),
          ),
        ),
      ),
      decideMemoryProposal: authed.organizations.decideMemoryProposal.handler(
        ({ context, input }) =>
          system(async () => {
            const decided = await decideMemoryProposal(prisma, {
              userId: context.actor.userId,
              proposalId: input.proposalId,
              approve: input.approve,
            });
            await note(
              context.actor.userId,
              decided.organizationId,
              input.approve ? "memory.approved" : "memory.rejected",
              decided.proposedByUserId,
            );
            return done;
          }),
      ),
      events: authed.organizations.events.handler(({ context, input }) =>
        system(async () =>
          (await listOrganizationEvents(prisma, context.actor.userId, input.organizationId)).map(
            (event) => ({ ...event, createdAt: iso(event.createdAt) }),
          ),
        ),
      ),
    },
  };
}
