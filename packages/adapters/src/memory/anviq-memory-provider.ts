// Copyright 2026 Anviq LLC. All rights reserved.
import type {
  AdapterContext,
  DurableMemoryScope,
  SemanticMemoryForgetRequest,
  SemanticMemoryProvider,
  SemanticMemoryPurgeHistoryRequest,
  SemanticMemoryRecallRequest,
  SemanticMemoryResponse,
  SemanticMemoryResult,
  SemanticMemorySaveRequest,
} from "@anviq/adapter-kit";
import type { MemoryEngine, Namespace } from "@anviq/memory-engine";

export const ANVIQ_MEMORY_PROVIDER_ID = "anviq";

function durableNamespaces(scope: DurableMemoryScope, botId: string, spaceId: string): Namespace[] {
  const bot: Namespace = { kind: "bot", id: botId };
  return scope === "shared" ? [bot, { kind: "space", id: spaceId }] : [bot];
}

function failure(error: unknown): { ok: false; error: string } {
  return { ok: false, error: error instanceof Error ? error.message : "Memory request failed" };
}

export class AnviqMemoryProvider implements SemanticMemoryProvider {
  constructor(private readonly engine: MemoryEngine) {}

  describe() {
    return {
      id: ANVIQ_MEMORY_PROVIDER_ID,
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: {
        recall: true,
        save: true,
        purgeHistory: true,
        sharedScope: true,
      } as const,
    };
  }

  async recall(
    request: SemanticMemoryRecallRequest,
    context: AdapterContext,
  ): Promise<SemanticMemoryResponse<SemanticMemoryResult[]>> {
    const namespaces = durableNamespaces(request.scope, request.botId, context.spaceId);
    if (request.historyGeneration !== undefined) {
      namespaces.push({
        kind: "history",
        id: request.botId,
        generation: request.historyGeneration,
      });
    }
    try {
      const found = await this.engine.recall({
        namespaces,
        spaceId: context.spaceId,
        query: request.query,
        limit: request.limit,
      });
      return {
        ok: true,
        value: found.map((memory) => ({
          id: memory.id,
          memory: memory.content,
          score: memory.score,
          updatedAt: memory.updatedAt,
        })),
      };
    } catch (error) {
      return failure(error);
    }
  }

  async save(
    request: SemanticMemorySaveRequest,
    context: AdapterContext,
  ): Promise<SemanticMemoryResponse> {
    const namespace: Namespace =
      request.source.kind === "history"
        ? { kind: "history", id: request.botId, generation: request.source.generation }
        : request.scope === "shared"
          ? { kind: "space", id: context.spaceId }
          : { kind: "bot", id: request.botId };
    try {
      await this.engine.save({ namespace, spaceId: context.spaceId, content: request.content });
      return { ok: true, value: undefined };
    } catch (error) {
      return failure(error);
    }
  }

  async purgeHistory(request: SemanticMemoryPurgeHistoryRequest): Promise<SemanticMemoryResponse> {
    try {
      await this.engine.purgeHistory(request.botId, request.generations);
      return { ok: true, value: undefined };
    } catch (error) {
      return failure(error);
    }
  }

  async forget(
    request: SemanticMemoryForgetRequest,
    context: AdapterContext,
  ): Promise<SemanticMemoryResponse<{ id: string; expired: boolean; reason: string | null }>> {
    try {
      const removed = await this.engine.forget({
        id: request.id,
        namespaces: durableNamespaces(request.scope, request.botId, context.spaceId),
      });
      return removed
        ? { ok: true, value: { id: request.id, expired: true, reason: request.reason ?? null } }
        : { ok: false, error: "Memory not found" };
    } catch (error) {
      return failure(error);
    }
  }
}
