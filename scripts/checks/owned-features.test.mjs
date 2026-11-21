// Features that exist only in Anviq Agents. An upstream sync can drop them without a conflict when
// upstream moves or rewrites the files around them, so each one names the files and identifiers it
// cannot work without. A PR that adds a feature of ours adds its entry here.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const FEATURES = {
  "company memory": {
    "packages/db/src/company-memory.ts": ["readCompanyMemory", "decideMemoryProposal"],
    "packages/adapters/src/memory/memory-context.ts": ["companyMemory"],
  },
  "organization key custody": {
    "packages/db/src/org-keys.ts": ["setOrganizationKey"],
    "packages/adapters/src/org-key-provider.ts": ["OrgKeyProvider"],
    "apps/api/src/cli/content-encryption.ts": ["org-key"],
  },
  "linked bots": {
    "packages/db/src/linked-bots.ts": ["linkBotIntoSpace", "resolveGroupBotIds"],
    "packages/db/src/linked-bot-lifecycle.ts": ["unlinkBotsInOrganization"],
  },
};

for (const [feature, files] of Object.entries(FEATURES)) {
  test(`${feature} is still in the tree`, () => {
    for (const [file, identifiers] of Object.entries(files)) {
      const full = path.join(root, file);
      assert.ok(
        existsSync(full),
        `${file} is missing; ${feature} is ours, see docs/upstream-sync.md`,
      );
      const text = readFileSync(full, "utf8");
      for (const identifier of identifiers)
        assert.ok(text.includes(identifier), `${file} no longer has ${identifier}`);
    }
  });
}
