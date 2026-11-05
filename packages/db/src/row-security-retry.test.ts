import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./generated/prisma/client.js";
import { withRowLevelSecurity } from "./row-security.js";

type Operation = (input: {
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
  __internalParams?: { transaction?: { kind: string } };
}) => Promise<unknown>;

function operation(): Operation {
  const extension = withRowLevelSecurity({
    $extends: (value: unknown) => value,
  } as unknown as PrismaClient) as unknown as { query: { $allOperations: Operation } };
  return extension.query.$allOperations;
}

const writeConflict = () => Object.assign(new Error("write conflict"), { code: "P2034" });

describe("row-security retries", () => {
  it("runs a lone statement again after a write conflict", async () => {
    const query = vi.fn().mockRejectedValueOnce(writeConflict()).mockResolvedValue("rows");

    await expect(operation()({ operation: "findMany", args: {}, query })).resolves.toBe("rows");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("leaves a statement inside a transaction to whoever opened the transaction", async () => {
    const query = vi.fn().mockRejectedValue(writeConflict());

    await expect(
      operation()({
        operation: "findMany",
        args: {},
        query,
        __internalParams: { transaction: { kind: "itx" } },
      }),
    ).rejects.toThrow("write conflict");
    expect(query).toHaveBeenCalledTimes(1);
  });
});
