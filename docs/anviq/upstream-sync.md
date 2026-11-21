# Syncing upstream

This page is the procedure for taking upstream changes. Read [what this fork adds](./README.md) first:
it is the list of what a sync must not lose.

Sekundo follows [rakazo](https://github.com/elie222/rakazo). The `upstream` remote points at it and
`anviq-upstream` is a branch holding upstream with the Sekundo rename already applied, so merges only
conflict where Sekundo really diverges.

```bash
git remote add upstream https://github.com/elie222/rakazo.git   # once
scripts/upstream/sync.sh v0.3.0                                  # or upstream/main
git switch -c sync-upstream main
git merge anviq-upstream
```

If `pnpm-lock.yaml` conflicts, take the incoming side and run `pnpm install --lockfile-only`. Run
`pnpm check` and `pnpm test` before merging into `main`.

Each commit on `anviq-upstream` has only the previous mirror commit as its parent and names the
upstream commit in its message, so upstream authors never enter this repository's history.

Never merge `upstream/*` directly, and do not use GitHub's "Sync fork" button: both bring the
unrenamed code straight into `main`.

## Rename rules

`scripts/upstream/rebrand.mjs` holds the rename rules and the list of upstream paths that are
dropped. It fails when it finds an upstream name it does not know, so add a rule there and run the
sync again. Files listed in `DROP` do not exist in `anviq-upstream`, so upstream edits to them never
conflict.

## Code that is ours

Some features exist only in Sekundo and Anviq Agents, so a sync can drop them without any conflict when upstream
moves or rewrites the files around them. After every sync, confirm each one still works before
merging:

- Company memory and suggestions: `packages/db/src/company-memory.ts`, the `memory` routes in
  `apps/api/src/routes/organizations.ts`, and `CompanyMemorySettings.tsx` in the organization
  settings. Bots read it through `loadAgentMemoryContext` in the run assembly.
- Organization key custody: `packages/db/src/org-keys.ts` and `packages/adapters/src/org-key-provider.ts`.
- Linked bots: `packages/db/src/linked-bots.ts`.

The isolation tests `company-memory.postgres.test.ts` and `linked-bots.postgres.test.ts` in
`packages/testkit` fail when these go missing, so a green run is the check.
