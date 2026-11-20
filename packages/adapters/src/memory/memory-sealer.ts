// Copyright 2026 Anviq LLC. All rights reserved.
import type { ContentKeyRing } from "@anviq/db";
import {
  ContentDecryptionError,
  ciphertextKeyId,
  decryptText,
  encryptText,
  isCiphertext,
  keyedHash,
  querySearchTokens,
  searchTerms,
  searchTokens,
} from "@anviq/db";
import type { MemorySealer, SealedRowRef } from "@anviq/memory-engine";

const location = (row: SealedRowRef) => ({
  table: "anviq_memory.memories",
  column: "content",
  rowId: row.id,
  owner: `${row.kind}:${row.owner}`,
});

/**
 * Seals built-in memory with the space keys the rest of the content uses, so memory follows the same
 * switch, rotation and key custody. Each value is bound to its row and space, and recall matches on
 * blind-index tokens made under every key a space has had.
 */
export function createMemorySealer(ring: ContentKeyRing): MemorySealer {
  return {
    get enabled() {
      return ring.encryptWrites;
    },
    async seal(row, text) {
      return encryptText(await ring.current(row.scope), location(row), text);
    },
    async open(row, stored) {
      if (!isCiphertext(stored)) return stored;
      const key = await ring.byId(ciphertextKeyId(stored) as string);
      if (key.spaceId !== row.scope)
        throw new ContentDecryptionError("Encrypted memory belongs to another space");
      return decryptText(key, location(row), stored);
    },
    async hash(scope, text) {
      return keyedHash(await ring.current(scope), text);
    },
    async tokens(scope, text) {
      return searchTokens(await ring.current(scope), { words: text, strings: [] });
    },
    async queryTokens(scope, query) {
      const keys = await ring.allFresh(scope);
      return searchTerms(query).map((term) =>
        keys.flatMap((key) => querySearchTokens(key, term, "word")),
      );
    },
  };
}
