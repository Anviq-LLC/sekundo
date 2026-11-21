# Company memory

One note per organization that every bot in its team spaces reads. It holds what the whole company
should know: how it writes, who the customers are, what is off limits. It is an addition to a person's
own memory, never a replacement.

Company memory exists only in an organization with other people in it. A personal workspace has none.

## Using it

Open Settings, Organization, Company memory.

- **Owners and admins** edit the note. Saving fails with a conflict if someone else saved first, so
  two admins never overwrite each other silently.
- **Members** read it and suggest an addition. A suggestion is a short text of up to 4,000
  characters. It joins the note only when an owner or admin approves it, and is appended to the end.
  Rejecting it discards the text.
- The note holds up to 20,000 characters.

## What bots see

Every run in a team space loads the company note before the person's own memory. Bots answering an
outside chat channel do not get it. A bot never writes to it: only people change it.

## What stays private

- The note belongs to the organization, not to a person. Nobody's memory list, search or export
  returns it, so leaving the organization does not take it along.
- It is sealed with the key of the organization's general space, and with the organization's own key
  when one is configured (see [content encryption](../content-encryption.md)).
- Suggestions are sealed the same way and are deleted once decided. Only owners and admins can list
  them, plus the member's own pending ones.
- The activity log records that the note was edited, approved or rejected, and by whom. It never
  records the text.

## How it works

| Part | Where |
| --- | --- |
| Storage and rules | `packages/db/src/company-memory.ts` |
| Routes | `organizations.memory.*` in `apps/api/src/routes/organizations.ts` |
| Screen | `CompanyMemorySettings.tsx`, opened from `OrganizationSettingsPanel.tsx` |
| Read at run time | `companyMemoryForSpace` in `packages/adapters/src/runs/assembly/run-assembly-history.ts` |

The note is a memory document at path `company.md`, owned by `org:<organization id>` in the general
space, so it gets revisions and sealing from the memory system. The run reads it as the system
because a run carries no person's authority over an organization. A failure to load it is logged and
the run continues without it.

## Tests

`packages/testkit/src/company-memory.postgres.test.ts` covers roles, conflicts, approval, and that no
person's own memory returns the note. Run it with the embedded Postgres setup used for the other
`*.postgres.test.ts` files.

## If a sync drops it

`scripts/checks/owned-features.test.mjs` names the files above and fails when one goes missing. Restore
them from the last release that had them, then re-apply the wiring in the run assembly and the
organization settings page.
