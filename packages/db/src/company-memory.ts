// Copyright 2026 Anviq LLC. All rights reserved.
import { ClientError } from "@anviq/core";
import type { PrismaClient } from "./database/client.js";
import { Prisma } from "./database/client.js";
import { runAsSystem } from "./database/row-security.js";
import { withTransactionRetry } from "./database/transaction-retry.js";

async function membership(prisma: PrismaClient, userId: string, organizationId: string) {
  const row = await prisma.member.findFirst({
    where: { userId, organizationId },
    select: { role: true },
  });
  if (!row) throw new ClientError("NOT_FOUND", "Organization not found");
  return row.role;
}

async function managerOf(prisma: PrismaClient, userId: string, organizationId: string) {
  const role = await membership(prisma, userId, organizationId);
  if (!role.includes("owner") && !role.includes("admin")) {
    throw new ClientError(
      "FORBIDDEN",
      "Only an organization owner or admin can manage company memory",
    );
  }
}

export const COMPANY_MEMORY_PATH = "company.md";
export const COMPANY_MEMORY_MAX_CHARS = 20_000;
const SCOPE = "org";

/**
 * Company memory is one markdown document kept in the team's general space, so it is sealed with
 * that space's key and keeps a revision history like any other memory. Its owner is the team itself,
 * never a person, so no person's own memory listing, export or search ever returns it.
 */
const companyOwner = (organizationId: string) => `org:${organizationId}`;

async function generalSpaceOf(prisma: Pick<PrismaClient, "space">, organizationId: string) {
  const space = await prisma.space.findFirst({
    where: { organizationId, isDefault: true },
    select: { id: true },
  });
  if (!space) throw new ClientError("NOT_FOUND", "Team not found");
  return space.id;
}

export interface CompanyMemoryView {
  content: string;
  revision: number;
  updatedAt: Date | null;
  canEdit: boolean;
}

/** What the team's bots all know. Any member may read it; only an owner or admin may change it. */
export async function readCompanyMemory(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
): Promise<CompanyMemoryView> {
  const role = await membership(prisma, userId, organizationId);
  const spaceId = await generalSpaceOf(prisma, organizationId);
  const doc = await runAsSystem("read company memory", () =>
    prisma.memoryDocument.findFirst({
      where: {
        spaceId,
        userId: companyOwner(organizationId),
        scope: SCOPE,
        botId: null,
        path: COMPANY_MEMORY_PATH,
      },
    }),
  );
  return {
    content: doc?.content ?? "",
    revision: doc?.revision ?? 0,
    updatedAt: doc?.updatedAt ?? null,
    canEdit: role === "owner" || role === "admin",
  };
}

export async function writeCompanyMemory(
  prisma: PrismaClient,
  input: { userId: string; organizationId: string; content: string; expectedRevision?: number },
): Promise<{ revision: number }> {
  await managerOf(prisma, input.userId, input.organizationId);
  if (input.content.length > COMPANY_MEMORY_MAX_CHARS)
    throw new ClientError("BAD_REQUEST", "Company memory is too long");
  const spaceId = await generalSpaceOf(prisma, input.organizationId);
  const userId = companyOwner(input.organizationId);
  return runAsSystem("write company memory", () =>
    withTransactionRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const existing = await tx.memoryDocument.findFirst({
            where: { spaceId, userId, scope: SCOPE, botId: null, path: COMPANY_MEMORY_PATH },
          });
          if (
            input.expectedRevision !== undefined &&
            (existing?.revision ?? 0) !== input.expectedRevision
          )
            throw new ClientError("CONFLICT", "Someone else changed company memory first");
          const doc = existing
            ? await tx.memoryDocument.update({
                where: { id: existing.id },
                data: { content: input.content, revision: existing.revision + 1 },
              })
            : await tx.memoryDocument.create({
                data: {
                  spaceId,
                  userId,
                  scope: SCOPE,
                  path: COMPANY_MEMORY_PATH,
                  content: input.content,
                },
              });
          await tx.memoryRevision.create({
            data: { documentId: doc.id, revision: doc.revision, content: input.content },
          });
          return { revision: doc.revision };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    ),
  );
}

/**
 * The company memory that applies to a run in this space, or nothing for a personal workspace.
 * A run carries no person's authority over a team, so this reads as the system and returns only
 * the team's own document.
 */
export async function companyMemoryForSpace(
  prisma: PrismaClient,
  spaceId: string,
): Promise<string | undefined> {
  return runAsSystem("read company memory for a run", async () => {
    const space = await prisma.space.findUnique({
      where: { id: spaceId },
      select: { organizationId: true, organization: { select: { metadata: true } } },
    });
    if (!space?.organization.metadata?.includes('"kind":"team"')) return undefined;
    const general = await prisma.space.findFirst({
      where: { organizationId: space.organizationId, isDefault: true },
      select: { id: true },
    });
    if (!general) return undefined;
    const doc = await prisma.memoryDocument.findFirst({
      where: {
        spaceId: general.id,
        userId: companyOwner(space.organizationId),
        scope: SCOPE,
        botId: null,
        path: COMPANY_MEMORY_PATH,
      },
      select: { content: true },
    });
    return doc?.content.trim() ? doc.content : undefined;
  });
}

const PROPOSAL_SCOPE = "org_proposal";
export const COMPANY_MEMORY_PROPOSAL_MAX_CHARS = 4000;
const MAX_PENDING_PROPOSALS = 50;
const proposalPath = (id: string) => `proposals/${id}.md`;

export interface MemoryProposalView {
  id: string;
  content: string;
  proposedBy: string;
  mine: boolean;
  createdAt: Date;
}

/** Any member may suggest an addition. It joins company memory only when an owner or admin approves it. */
export async function proposeCompanyMemory(
  prisma: PrismaClient,
  input: { userId: string; organizationId: string; content: string },
): Promise<{ id: string }> {
  await membership(prisma, input.userId, input.organizationId);
  const text = input.content.trim();
  if (!text || text.length > COMPANY_MEMORY_PROPOSAL_MAX_CHARS)
    throw new ClientError("BAD_REQUEST", "Suggest a short note");
  const spaceId = await generalSpaceOf(prisma, input.organizationId);
  const pending = await prisma.organizationMemoryProposal.count({
    where: { organizationId: input.organizationId, status: "pending" },
  });
  if (pending >= MAX_PENDING_PROPOSALS)
    throw new ClientError("TOO_MANY_REQUESTS", "Too many suggestions are waiting");
  return runAsSystem("suggest company memory", () =>
    prisma.$transaction(async (tx) => {
      const proposal = await tx.organizationMemoryProposal.create({
        data: { organizationId: input.organizationId, proposedByUserId: input.userId },
      });
      await tx.memoryDocument.create({
        data: {
          spaceId,
          userId: companyOwner(input.organizationId),
          scope: PROPOSAL_SCOPE,
          path: proposalPath(proposal.id),
          content: text,
        },
      });
      return { id: proposal.id };
    }),
  );
}

/** Owners and admins see every waiting suggestion; a member sees only their own. */
export async function listMemoryProposals(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
): Promise<MemoryProposalView[]> {
  const role = await membership(prisma, userId, organizationId);
  const manager = role === "owner" || role === "admin";
  const rows = await prisma.organizationMemoryProposal.findMany({
    where: {
      organizationId,
      status: "pending",
      ...(manager ? {} : { proposedByUserId: userId }),
    },
    orderBy: { createdAt: "asc" },
  });
  if (rows.length === 0) return [];
  const spaceId = await generalSpaceOf(prisma, organizationId);
  const [docs, people] = await Promise.all([
    runAsSystem("read company memory suggestions", () =>
      prisma.memoryDocument.findMany({
        where: {
          spaceId,
          userId: companyOwner(organizationId),
          scope: PROPOSAL_SCOPE,
          path: { in: rows.map((row) => proposalPath(row.id)) },
        },
        select: { path: true, content: true },
      }),
    ),
    prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.proposedByUserId))] } },
      select: { id: true, name: true },
    }),
  ]);
  const contentByPath = new Map(docs.map((doc) => [doc.path, doc.content]));
  const names = new Map(people.map((person) => [person.id, person.name]));
  return rows.map((row) => ({
    id: row.id,
    content: contentByPath.get(proposalPath(row.id)) ?? "",
    proposedBy: names.get(row.proposedByUserId) ?? "Someone",
    mine: row.proposedByUserId === userId,
    createdAt: row.createdAt,
  }));
}

/** Approving appends the note to company memory; rejecting discards it. Either way it is decided once. */
export async function decideMemoryProposal(
  prisma: PrismaClient,
  input: { userId: string; proposalId: string; approve: boolean },
): Promise<{ organizationId: string; proposedByUserId: string }> {
  const proposal = await prisma.organizationMemoryProposal.findUnique({
    where: { id: input.proposalId },
  });
  if (!proposal || proposal.status !== "pending")
    throw new ClientError("NOT_FOUND", "Suggestion not found");
  await managerOf(prisma, input.userId, proposal.organizationId);
  const claimed = await prisma.organizationMemoryProposal.updateMany({
    where: { id: proposal.id, status: "pending" },
    data: {
      status: input.approve ? "approved" : "rejected",
      decidedByUserId: input.userId,
      decidedAt: new Date(),
    },
  });
  if (claimed.count !== 1) throw new ClientError("NOT_FOUND", "Suggestion not found");
  const spaceId = await generalSpaceOf(prisma, proposal.organizationId);
  const where = {
    spaceId,
    userId: companyOwner(proposal.organizationId),
    scope: PROPOSAL_SCOPE,
    path: proposalPath(proposal.id),
  };
  try {
    if (input.approve) {
      const note = await runAsSystem("read a company memory suggestion", () =>
        prisma.memoryDocument.findFirst({ where, select: { content: true } }),
      );
      const current = await readCompanyMemory(prisma, input.userId, proposal.organizationId);
      const base = current.content.trimEnd();
      await writeCompanyMemory(prisma, {
        userId: input.userId,
        organizationId: proposal.organizationId,
        content: base ? `${base}\n\n${note?.content ?? ""}` : (note?.content ?? ""),
        expectedRevision: current.revision,
      });
    }
  } catch (error) {
    await prisma.organizationMemoryProposal.update({
      where: { id: proposal.id },
      data: { status: "pending", decidedByUserId: null, decidedAt: null },
    });
    throw error;
  }
  await runAsSystem("discard a decided company memory suggestion", () =>
    prisma.memoryDocument.deleteMany({ where }),
  );
  return { organizationId: proposal.organizationId, proposedByUserId: proposal.proposedByUserId };
}
