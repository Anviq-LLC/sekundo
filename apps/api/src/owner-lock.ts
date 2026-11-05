import type { Prisma } from "@anviq/db";

/** Serializes one owner's writes of a kind across all their spaces, until the transaction ends. */
export function lockOwner(tx: Prisma.TransactionClient, userId: string, scope: string) {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${scope}:${userId}`}, 0))`;
}
