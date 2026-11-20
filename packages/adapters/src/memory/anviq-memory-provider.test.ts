// Copyright 2026 Anviq LLC. All rights reserved.
import type { AdapterContext } from "@anviq/adapter-kit";
import type { MemoryEngine } from "@anviq/memory-engine";
import { describe, expect, it, vi } from "vitest";
import { AnviqMemoryProvider } from "./anviq-memory-provider.js";

const context = {
  operationId: "op",
  traceId: "trace",
  spaceId: "space-1",
  userId: "user-1",
  botId: "bot-1",
  signal: new AbortController().signal,
} satisfies AdapterContext;

function setup() {
  const engine = {
    recall: vi.fn(async () => [
      {
        id: "m1",
        namespace: { kind: "bot", id: "bot-1" },
        content: "fact",
        origin: "bot",
        updatedAt: "2026-01-01T00:00:00.000Z",
        score: 0.5,
      },
    ]),
    save: vi.fn(async (_request: { namespace: unknown }) => ({ id: "m1" })),
    forget: vi.fn(async () => true),
    purgeHistory: vi.fn(async () => 1),
  };
  return { engine, provider: new AnviqMemoryProvider(engine as unknown as MemoryEngine) };
}

describe("AnviqMemoryProvider", () => {
  it("recalls the bot namespace for isolated scope", async () => {
    const { engine, provider } = setup();
    const result = await provider.recall(
      { query: "fact", scope: "isolated", botId: "bot-1", limit: 5 },
      context,
    );
    expect(engine.recall).toHaveBeenCalledWith({
      namespaces: [{ kind: "bot", id: "bot-1" }],
      spaceId: "space-1",
      query: "fact",
      limit: 5,
    });
    expect(result).toEqual({
      ok: true,
      value: [{ id: "m1", memory: "fact", score: 0.5, updatedAt: "2026-01-01T00:00:00.000Z" }],
    });
  });

  it("adds the space and the current history generation when asked", async () => {
    const { engine, provider } = setup();
    await provider.recall(
      { query: "fact", scope: "shared", botId: "bot-1", historyGeneration: 3, limit: 5 },
      context,
    );
    expect(engine.recall).toHaveBeenCalledWith(
      expect.objectContaining({
        namespaces: [
          { kind: "bot", id: "bot-1" },
          { kind: "space", id: "space-1" },
          { kind: "history", id: "bot-1", generation: 3 },
        ],
      }),
    );
  });

  it("saves to the bot, the space or a history generation", async () => {
    const { engine, provider } = setup();
    const base = { content: "note", botId: "bot-1" };
    await provider.save({ ...base, scope: "isolated", source: { kind: "durable" } }, context);
    await provider.save({ ...base, scope: "shared", source: { kind: "durable" } }, context);
    await provider.save(
      { ...base, scope: "shared", source: { kind: "history", generation: 2 } },
      context,
    );
    expect(engine.save.mock.calls.map(([request]) => request.namespace)).toEqual([
      { kind: "bot", id: "bot-1" },
      { kind: "space", id: "space-1" },
      { kind: "history", id: "bot-1", generation: 2 },
    ]);
  });

  it("purges history and forgets only within the bot and its space", async () => {
    const { engine, provider } = setup();
    expect(
      await provider.purgeHistory({ botId: "bot-1", threadId: "thread-1", generations: [1, 2] }),
    ).toEqual({
      ok: true,
      value: undefined,
    });
    expect(engine.purgeHistory).toHaveBeenCalledWith("bot-1", [1, 2]);
    await provider.forget({ id: "m1", scope: "shared", botId: "bot-1" }, context);
    expect(engine.forget).toHaveBeenCalledWith({
      id: "m1",
      namespaces: [
        { kind: "bot", id: "bot-1" },
        { kind: "space", id: "space-1" },
      ],
    });
  });

  it("reports engine failures instead of throwing", async () => {
    const { engine, provider } = setup();
    engine.recall.mockRejectedValueOnce(new Error("database down"));
    expect(
      await provider.recall({ query: "x", scope: "isolated", botId: "bot-1", limit: 1 }, context),
    ).toEqual({ ok: false, error: "database down" });
  });
});
