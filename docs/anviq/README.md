# What this fork adds

Sekundo follows [rakazo](https://github.com/elie222/rakazo) and adds the features below. Each has
its own page here. Everything not listed is upstream's behavior, documented in the pages next to this
folder.

## Features

| Feature | Page | Where it lives |
| --- | --- | --- |
| Organizations: roles, invitations, deleting one, the team activity log | [Organizations](./organizations.md) | Upstream's Organization settings, extended |
| Company memory and suggestions | [Company memory](./company-memory.md) | Settings, Organization, Company memory |
| Linked bots: a personal bot taking part in a team space | [Linked bots](./linked-bots.md) | Team groups, member picker |
| Organization key custody and extra sealed content | [Content encryption](../content-encryption.md) | `content-encryption org-key` command |
| Phone-width layout rules for the web app | [Phone-width layout](./mobile-web.md) | Shared dialogs and overlays |
| Fleet updates with backup, canary stages and rollback | [Fleet management](../fleet-management.md) | `infra/compose/fleet.sh` |

The key custody and fleet rows still live in pages that mix upstream and fork material. They move into this folder
as they are rewritten.

## How the fork relates to upstream

- **Upstream owns the base product.** Chat, bots, spaces, models, memory, voice, integrations and the
  desktop and mobile apps. We take its changes through [syncing upstream](./upstream-sync.md).
- **We own the features above.** A sync can silently drop them when upstream moves the files around
  them, which has happened once. Two things prevent it: each feature is listed in
  `scripts/checks/owned-features.test.mjs`, and the sync procedure ends with a check of this table.
- **Branded builds** (such as Sekundo) are forks of this repository that change only names, logos and
  store details. They take every feature on this page unchanged.

## Principles behind the features

- **Private stays private.** A person's chats with their own bots are never visible to organization
  owners or admins. No feature here adds a setting that weakens that.
- **Content is sealed.** Anything new that holds user text is encrypted with the same space keys as
  existing content, and the organization can hold a key of its own.
- **Upstream's model first.** Where upstream added something that overlaps with ours, we adopt
  upstream's version and keep only the gap.
